import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * Send SMS endpoint — Hunter calls this to text prospects.
 * 
 * Uses Twilio REST API directly (no SDK needed on Vercel).
 * Logs outbound message to touchpoints.
 */

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || '';
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || '';
const TWILIO_PHONE = process.env.TWILIO_PHONE || '+17704077842';
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY || '';
const STATUS_CALLBACK_URL = 'https://outbound-engine-one.vercel.app/api/sms-status';

const sbHeaders = {
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' });
  }

  const { to, body, prospect_id, campaign_id, action } = req.body;

  if (!to || !body) {
    return res.status(400).json({ error: 'Missing required fields: to, body' });
  }

  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
    return res.status(500).json({ error: 'Twilio credentials not configured' });
  }

  try {
    console.log(`[send-sms] Sending to ${to}: "${body.substring(0, 80)}..."`);

    // Send via Twilio REST API
    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
    const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64');

    const params = new URLSearchParams({
      To: to,
      From: TWILIO_PHONE,
      Body: body,
      StatusCallback: STATUS_CALLBACK_URL,
    });

    const twilioRes = await fetch(twilioUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    const twilioData = await twilioRes.json() as any;

    if (!twilioRes.ok) {
      console.error(`[send-sms] Twilio error: ${twilioData.code} ${twilioData.message}`);
      return res.status(twilioRes.status).json({
        success: false,
        error: twilioData.message,
        code: twilioData.code,
      });
    }

    console.log(`[send-sms] ✓ Sent: SID=${twilioData.sid}, Status=${twilioData.status}`);

    // Log to touchpoints
    if (SUPABASE_URL && SUPABASE_KEY) {
      const touchpoint = {
        prospect_id: prospect_id || null,
        campaign_id: campaign_id || null,
        channel: 'sms',
        direction: 'outbound',
        action: action || 'sms_outbound',
        outcome: 'sent',
        metadata: {
          to,
          from: TWILIO_PHONE,
          body,
          message_sid: twilioData.sid,
          status: twilioData.status,
          timestamp: new Date().toISOString(),
        },
        created_at: new Date().toISOString(),
      };

      const tpRes = await fetch(`${SUPABASE_URL}/rest/v1/touchpoints`, {
        method: 'POST',
        headers: { ...sbHeaders, 'Prefer': 'return=minimal' },
        body: JSON.stringify(touchpoint),
      });
      console.log(`[send-sms] Touchpoint logged: ${tpRes.status}`);
    }

    res.json({
      success: true,
      message_sid: twilioData.sid,
      status: twilioData.status,
    });

  } catch (error: any) {
    console.error('[send-sms] Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
}
