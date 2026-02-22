import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';

/**
 * Incoming SMS webhook — Twilio sends here when a prospect texts back.
 * 
 * Flow:
 * 1. Validate Twilio signature (optional but recommended)
 * 2. Look up prospect by phone number
 * 3. Log the inbound message to touchpoints
 * 4. Update prospect state (contacted → engaged)
 * 5. If message contains booking intent, flag for follow-up
 * 6. Auto-reply if configured
 */

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY || '';
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || '';

const sbHeaders = {
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
};

// Keywords that suggest booking intent
const BOOKING_KEYWORDS = ['yes', 'sure', 'interested', 'book', 'schedule', 'calendar', 'meet', 'call me', 'sounds good', 'let\'s do it', 'sign me up', 'available'];
const STOP_KEYWORDS = ['stop', 'unsubscribe', 'remove', 'opt out', 'don\'t text', 'dont text', 'leave me alone', 'no thanks'];

function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return digits.startsWith('1') && digits.length === 11 ? `+${digits}` : `+1${digits}`;
}

function detectIntent(body: string): 'interested' | 'stop' | 'question' | 'neutral' {
  const lower = body.toLowerCase().trim();
  if (STOP_KEYWORDS.some(k => lower.includes(k))) return 'stop';
  if (BOOKING_KEYWORDS.some(k => lower.includes(k))) return 'interested';
  if (lower.includes('?')) return 'question';
  return 'neutral';
}

function validateTwilioSignature(req: VercelRequest): boolean {
  if (!TWILIO_AUTH_TOKEN) return true; // Skip validation if no token set
  
  const signature = req.headers['x-twilio-signature'] as string;
  if (!signature) return false;
  
  const protocol = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers.host || '';
  const url = `${protocol}://${host}${req.url}`;
  
  const params = req.body || {};
  const sortedKeys = Object.keys(params).sort();
  const paramString = sortedKeys.map(k => `${k}${params[k]}`).join('');
  
  const expected = crypto
    .createHmac('sha1', TWILIO_AUTH_TOKEN)
    .update(url + paramString)
    .digest('base64');
  
  return signature === expected;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' });
  }

  try {
    // Twilio sends form-encoded data
    const {
      From: fromPhone,
      To: toPhone,
      Body: body,
      MessageSid: messageSid,
      NumMedia: numMedia,
    } = req.body;

    console.log(`[incoming-sms] From: ${fromPhone}, To: ${toPhone}, Body: "${body?.substring(0, 100)}"`);

    if (!fromPhone || !body) {
      // Return valid TwiML even on error so Twilio doesn't retry
      res.setHeader('Content-Type', 'text/xml');
      return res.status(200).send('<Response></Response>');
    }

    // Validate signature (non-blocking — log warning but don't reject)
    if (TWILIO_AUTH_TOKEN && !validateTwilioSignature(req)) {
      console.warn('[incoming-sms] ⚠️ Invalid Twilio signature — processing anyway');
    }

    const normalizedPhone = normalizePhone(fromPhone);
    const intent = detectIntent(body);
    console.log(`[incoming-sms] Intent: ${intent}, Phone: ${normalizedPhone}`);

    // 1. Look up prospect by phone
    const prospectRes = await fetch(
      `${SUPABASE_URL}/rest/v1/prospects?phone=eq.${encodeURIComponent(normalizedPhone)}&select=id,first_name,last_name,company_name,email,state,campaign_id&limit=1`,
      { headers: sbHeaders }
    );
    const prospects = await prospectRes.json() as any[];
    const prospect = prospects?.[0];

    if (!prospect) {
      // Also try without +1 prefix
      const altPhone = fromPhone.replace(/\D/g, '');
      const altRes = await fetch(
        `${SUPABASE_URL}/rest/v1/prospects?phone=like.*${altPhone.slice(-10)}&select=id,first_name,last_name,company_name,email,state,campaign_id&limit=1`,
        { headers: sbHeaders }
      );
      const altProspects = await altRes.json() as any[];
      if (altProspects?.[0]) {
        Object.assign(prospect || {}, altProspects[0]);
      }
    }

    const prospectId = prospect?.id || null;
    const prospectName = prospect ? `${prospect.first_name || ''} ${prospect.last_name || ''}`.trim() : fromPhone;
    console.log(`[incoming-sms] Prospect: ${prospectName} (${prospectId || 'unknown'})`);

    // 2. Log to touchpoints
    const touchpoint = {
      prospect_id: prospectId,
      campaign_id: prospect?.campaign_id || null,
      channel: 'sms',
      direction: 'inbound',
      action: 'sms_reply',
      outcome: intent,
      metadata: {
        from: fromPhone,
        to: toPhone,
        body: body,
        message_sid: messageSid,
        num_media: numMedia || '0',
        intent,
        timestamp: new Date().toISOString(),
      },
      created_at: new Date().toISOString(),
    };

    const tpRes = await fetch(`${SUPABASE_URL}/rest/v1/touchpoints`, {
      method: 'POST',
      headers: { ...sbHeaders, 'Prefer': 'return=minimal' },
      body: JSON.stringify(touchpoint),
    });
    console.log(`[incoming-sms] Touchpoint logged: ${tpRes.status}`);

    // 3. Update prospect state if applicable
    if (prospectId) {
      let newState: string | null = null;
      
      if (intent === 'stop') {
        newState = 'not_interested';
        // Also log to channel_events for DNC tracking
        await fetch(`${SUPABASE_URL}/rest/v1/channel_events`, {
          method: 'POST',
          headers: { ...sbHeaders, 'Prefer': 'return=minimal' },
          body: JSON.stringify({
            prospect_id: prospectId,
            channel: 'sms',
            event_type: 'opt_out',
            metadata: { message_sid: messageSid, body },
            created_at: new Date().toISOString(),
          }),
        });
        console.log(`[incoming-sms] ⛔ OPT-OUT: ${prospectName} — marked not_interested`);
      } else if (intent === 'interested') {
        newState = 'engaged';
        console.log(`[incoming-sms] 🎯 INTERESTED: ${prospectName} — flagged for follow-up`);
      } else if (prospect?.state === 'contacted') {
        newState = 'engaged'; // Any reply = engagement
      }

      if (newState) {
        await fetch(`${SUPABASE_URL}/rest/v1/prospects?id=eq.${prospectId}`, {
          method: 'PATCH',
          headers: { ...sbHeaders, 'Prefer': 'return=minimal' },
          body: JSON.stringify({ state: newState, sms_state: intent === 'stop' ? 'opted_out' : 'replied' }),
        });
        console.log(`[incoming-sms] State updated: ${prospect.state} → ${newState}`);
      }
    }

    // 4. Return TwiML response
    // For STOP: Twilio handles auto-opt-out, but we acknowledge
    // For interested: no auto-reply — Hunter will follow up
    // For questions: no auto-reply — flag for human/agent review
    let twimlResponse = '<Response></Response>'; // Silent by default

    if (intent === 'stop') {
      twimlResponse = `<Response><Message>You've been removed from our list. Sorry for the inconvenience.</Message></Response>`;
    }

    res.setHeader('Content-Type', 'text/xml');
    return res.status(200).send(twimlResponse);

  } catch (error: any) {
    console.error('[incoming-sms] Error:', error);
    // Always return valid TwiML so Twilio doesn't retry
    res.setHeader('Content-Type', 'text/xml');
    return res.status(200).send('<Response></Response>');
  }
}
