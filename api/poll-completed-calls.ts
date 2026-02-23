import type { VercelRequest, VercelResponse } from '@vercel/node';
import { checkSpamStatus, getCallMetrics, analyzeCallMetrics } from '../src/monitoring/spam-monitor';

/**
 * Poll for completed ElevenLabs conversations that may have been missed by the webhook.
 * Hunter calls this periodically as a safeguard.
 * 
 * Flow:
 * 1. List recent conversations from ElevenLabs (last N hours)
 * 2. Check which ones are NOT in our call_logs table
 * 3. For any missing, forward to post-call-webhook for processing
 * 4. Check spam status for our number and alert if flagged
 */

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || '';
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY || '';
const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER || '+17704077842';

const sbHeaders = {
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  try {
    const hoursBack = parseInt(req.query.hours as string) || 6;
    
    // 1. List recent conversations from ElevenLabs
    const listRes = await fetch(
      `https://api.elevenlabs.io/v1/convai/conversations?page_size=50`,
      { headers: { 'xi-api-key': ELEVENLABS_API_KEY } }
    );
    
    if (!listRes.ok) {
      const errText = await listRes.text();
      console.error('[poll-completed] ElevenLabs list error:', listRes.status, errText);
      return res.status(502).json({ error: 'Failed to list conversations from ElevenLabs' });
    }

    const listData = await listRes.json() as any;
    const conversations = listData.conversations || [];
    
    // Filter to completed conversations within the time window
    const cutoff = Date.now() / 1000 - (hoursBack * 3600);
    const recentCompleted = conversations.filter((c: any) => {
      return c.status === 'done' && 
             c.start_time_unix_secs > cutoff &&
             c.call_duration_secs > 0;
    });
    
    console.log(`[poll-completed] Found ${recentCompleted.length} completed conversations in last ${hoursBack}h`);
    
    if (recentCompleted.length === 0) {
      return res.json({ processed: 0, missing: 0, message: 'No recent completed calls' });
    }
    
    // 2. Check which ones are already in our DB
    const convIds = recentCompleted.map((c: any) => c.conversation_id);
    const existingRes = await fetch(
      `${SUPABASE_URL}/rest/v1/call_logs?conversation_id=in.(${convIds.map(encodeURIComponent).join(',')})&select=conversation_id`,
      { headers: sbHeaders }
    );
    const existingLogs = await existingRes.json() as any[];
    const existingIds = new Set((existingLogs || []).map((l: any) => l.conversation_id));
    
    const missing = recentCompleted.filter((c: any) => !existingIds.has(c.conversation_id));
    
    console.log(`[poll-completed] ${existingIds.size} already logged, ${missing.length} missing`);
    
    if (missing.length === 0) {
      return res.json({ processed: 0, missing: 0, message: 'All calls already logged' });
    }
    
    // 3. Process missing conversations by forwarding to post-call-webhook
    const results: Array<{ conversation_id: string; status: string; error?: string }> = [];
    
    for (const conv of missing) {
      try {
        console.log(`[poll-completed] Processing missed call: ${conv.conversation_id} (agent: ${conv.agent_id})`);
        
        const webhookRes = await fetch(
          `https://outbound-engine-one.vercel.app/api/post-call-webhook`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              conversation_id: conv.conversation_id,
              agent_id: conv.agent_id,
            }),
          }
        );
        
        const webhookData = await webhookRes.json() as any;
        results.push({
          conversation_id: conv.conversation_id,
          status: webhookData.success ? 'processed' : 'failed',
          error: webhookData.error,
        });
        
        console.log(`[poll-completed] Processed ${conv.conversation_id}: ${webhookData.outcome || 'unknown'}`);
      } catch (err: any) {
        console.error(`[poll-completed] Error processing ${conv.conversation_id}:`, err.message);
        results.push({
          conversation_id: conv.conversation_id,
          status: 'error',
          error: err.message,
        });
      }
    }
    
    // 4. Check spam status and call metrics
    let spamAlert = false;
    let spamStatus = null;
    let callMetrics = null;
    let metricWarnings: string[] = [];
    
    try {
      // Check spam status for our number
      spamStatus = await checkSpamStatus(TWILIO_PHONE_NUMBER);
      
      if (spamStatus.flagged) {
        spamAlert = true;
        console.error(`[poll-completed] CRITICAL: Number ${TWILIO_PHONE_NUMBER} flagged as spam! Score: ${spamStatus.score}`);
      }
      
      // Get call metrics for analysis
      callMetrics = await getCallMetrics(hoursBack);
      const analysis = analyzeCallMetrics(callMetrics);
      metricWarnings = analysis.warnings;
      
      if (!analysis.healthy) {
        console.warn(`[poll-completed] Call quality warnings:`, analysis.warnings);
      }
    } catch (spamErr: any) {
      console.error('[poll-completed] Spam/metrics check error:', spamErr.message);
      // Don't fail the whole request if spam check fails
    }
    
    const response: any = {
      processed: results.length,
      missing: missing.length,
      results,
    };
    
    // Add spam alert if flagged
    if (spamAlert) {
      response.spam_alert = true;
      response.spam_status = spamStatus;
      console.error('[poll-completed] CRITICAL ALERT: Spam flag detected on our number');
    }
    
    // Add metrics if available
    if (callMetrics) {
      response.call_metrics = callMetrics;
      response.metric_warnings = metricWarnings;
    }
    
    res.json(response);
  } catch (error: any) {
    console.error('[poll-completed] Error:', error);
    res.status(500).json({ error: error.message });
  }
}
