import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * SMS Delivery Status webhook — Twilio calls this with delivery updates.
 * 
 * Statuses: queued → sent → delivered → (read) | failed | undelivered
 * 
 * We log terminal statuses (delivered, failed, undelivered) to update
 * our touchpoints with delivery confirmation.
 */

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY || '';

const sbHeaders = {
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
};

// Only log terminal statuses to avoid noise
const TERMINAL_STATUSES = ['delivered', 'failed', 'undelivered', 'read'];

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' });
  }

  try {
    const {
      MessageSid: messageSid,
      MessageStatus: status,
      To: toPhone,
      From: fromPhone,
      ErrorCode: errorCode,
      ErrorMessage: errorMessage,
    } = req.body;

    console.log(`[sms-status] SID: ${messageSid}, Status: ${status}, To: ${toPhone}`);

    // Only process terminal statuses
    if (!TERMINAL_STATUSES.includes(status)) {
      return res.status(200).json({ ok: true, skipped: true });
    }

    // Log to channel_events
    const event = {
      channel: 'sms',
      event_type: `sms_${status}`,
      metadata: {
        message_sid: messageSid,
        status,
        to: toPhone,
        from: fromPhone,
        error_code: errorCode || null,
        error_message: errorMessage || null,
        timestamp: new Date().toISOString(),
      },
      created_at: new Date().toISOString(),
    };

    // Try to find the prospect by phone to attach prospect_id
    if (toPhone) {
      const digits = toPhone.replace(/\D/g, '').slice(-10);
      const prospectRes = await fetch(
        `${SUPABASE_URL}/rest/v1/prospects?phone=like.*${digits}&select=id&limit=1`,
        { headers: sbHeaders }
      );
      const prospects = await prospectRes.json() as any[];
      if (prospects?.[0]?.id) {
        (event as any).prospect_id = prospects[0].id;
      }
    }

    const evtRes = await fetch(`${SUPABASE_URL}/rest/v1/channel_events`, {
      method: 'POST',
      headers: { ...sbHeaders, 'Prefer': 'return=minimal' },
      body: JSON.stringify(event),
    });
    console.log(`[sms-status] Event logged: ${evtRes.status}`);

    // If failed/undelivered, update the touchpoint outcome
    if (status === 'failed' || status === 'undelivered') {
      console.warn(`[sms-status] ⚠️ SMS ${status} to ${toPhone}: ${errorCode} ${errorMessage}`);
      
      // Update the original outbound touchpoint if we can find it by message_sid
      // touchpoints.metadata->>'message_sid' = messageSid
      const tpRes = await fetch(
        `${SUPABASE_URL}/rest/v1/touchpoints?metadata->>message_sid=eq.${messageSid}`,
        { headers: sbHeaders }
      );
      const touchpoints = await tpRes.json() as any[];
      if (touchpoints?.[0]?.id) {
        await fetch(`${SUPABASE_URL}/rest/v1/touchpoints?id=eq.${touchpoints[0].id}`, {
          method: 'PATCH',
          headers: { ...sbHeaders, 'Prefer': 'return=minimal' },
          body: JSON.stringify({
            outcome: status,
            metadata: {
              ...touchpoints[0].metadata,
              delivery_status: status,
              error_code: errorCode,
              error_message: errorMessage,
            },
          }),
        });
        console.log(`[sms-status] Touchpoint ${touchpoints[0].id} updated to ${status}`);
      }
    }

    res.status(200).json({ ok: true, status });

  } catch (error: any) {
    console.error('[sms-status] Error:', error);
    res.status(200).json({ ok: true, error: error.message }); // Don't fail — Twilio retries on 5xx
  }
}
