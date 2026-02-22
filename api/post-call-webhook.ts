import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

// Inline variant lookup to avoid module issues in Vercel serverless context
import variants from '../variants.json';

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || '';
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY || '';

function getVariantByAgentId(agentId: string) {
  return variants.variants.find((v: any) => v.agentId === agentId);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { conversation_id, agent_id } = req.body;

    if (!conversation_id) {
      return res.status(400).json({ error: 'Missing conversation_id' });
    }

    // Fetch conversation data from ElevenLabs
    const convRes = await fetch(
      `https://api.elevenlabs.io/v1/convai/conversations/${conversation_id}`,
      { headers: { 'xi-api-key': ELEVENLABS_API_KEY } }
    );

    if (!convRes.ok) {
      const errText = await convRes.text();
      console.error('[post-call-webhook] ElevenLabs fetch error:', convRes.status, errText);
      return res.status(502).json({ error: 'Failed to fetch conversation from ElevenLabs' });
    }

    const conversationData = await convRes.json() as any;
    const usedAgentId = agent_id || conversationData.agent_id;
    const variant = getVariantByAgentId(usedAgentId);

    // Extract transcript and analysis
    const transcript = conversationData.transcript || [];
    const analysis = conversationData.analysis || {};
    const duration = conversationData.metadata?.call_duration_secs || null;
    const outcome = analysis.outcome || analysis.call_successful === 'success' ? 'completed' : 'unknown';

    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

    // Try to find existing call log by conversation_id
    const { data: existingLog } = await supabase
      .from('call_logs')
      .select('id')
      .eq('conversation_id', conversation_id)
      .single();

    const updateData: Record<string, any> = {
      conversation_id,
      agent_variant: variant?.id || null,
      agent_id_used: usedAgentId,
      status: 'completed',
      duration_seconds: duration,
      outcome: analysis.outcome || null,
      transcript: JSON.stringify(transcript),
      analysis: JSON.stringify(analysis),
      completed_at: new Date().toISOString(),
    };

    if (existingLog) {
      await supabase
        .from('call_logs')
        .update(updateData)
        .eq('id', existingLog.id);
    } else {
      await supabase
        .from('call_logs')
        .insert(updateData);
    }

    console.log(`[post-call-webhook] Logged conversation ${conversation_id} — variant: ${variant?.id || 'unknown'}`);
    res.json({ success: true, variant: variant?.id, conversation_id });
  } catch (error: any) {
    console.error('[post-call-webhook] Error:', error);
    res.status(500).json({ error: error.message });
  }
}
