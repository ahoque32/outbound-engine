import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * Check spam status for our Twilio number using Twilio Lookup API v2.
 * Uses nomorobo_spam_score and line_type_intelligence add-ons.
 * 
 * GET /api/check-spam-status?number=+17704077842
 * Returns: { number, spam_score, flagged, checked_at }
 */

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || '';
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || '';
const DEFAULT_NUMBER = '+17704077842';

interface SpamCheckResult {
  number: string;
  spam_score: number | null;
  flagged: boolean;
  carrier_flags: string[];
  checked_at: string;
}

export async function checkSpamStatus(phoneNumber: string): Promise<SpamCheckResult> {
  // Build Twilio Lookup API URL with spam detection fields
  const fields = 'nomorobo_spam_score,line_type_intelligence';
  const url = `https://lookups.twilio.com/v2/PhoneNumbers/${encodeURIComponent(phoneNumber)}?Fields=${fields}`;
  
  // Basic auth header
  const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64');
  
  const res = await fetch(url, {
    headers: {
      'Authorization': `Basic ${auth}`,
    },
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error('[check-spam-status] Twilio Lookup error:', res.status, errText);
    throw new Error(`Twilio Lookup failed: ${res.status}`);
  }

  const data = await res.json() as any;
  
  // Parse spam score from Nomorobo add-on
  const nomorobo = data.nomorobo_spam_score || {};
  const spamScore = nomorobo.score ?? null;
  
  // Parse line type intelligence for carrier flags
  const lineIntel = data.line_type_intelligence || {};
  const carrierFlags: string[] = [];
  
  if (lineIntel.spam_risk?.level) {
    carrierFlags.push(`spam_risk:${lineIntel.spam_risk.level}`);
  }
  if (lineIntel.carrier_name) {
    carrierFlags.push(`carrier:${lineIntel.carrier_name}`);
  }
  if (lineIntel.type) {
    carrierFlags.push(`line_type:${lineIntel.type}`);
  }
  
  // Flag if spam score >= 1 (Nomorobo: 0=not spam, 1=spam)
  const flagged = spamScore !== null && spamScore >= 1;
  
  return {
    number: phoneNumber,
    spam_score: spamScore,
    flagged,
    carrier_flags: carrierFlags,
    checked_at: new Date().toISOString(),
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'GET only' });
  }

  try {
    const phoneNumber = (req.query.number as string) || DEFAULT_NUMBER;
    
    if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
      return res.status(500).json({ error: 'Twilio credentials not configured' });
    }

    const result = await checkSpamStatus(phoneNumber);
    
    res.json(result);
  } catch (error: any) {
    console.error('[check-spam-status] Error:', error);
    res.status(500).json({ error: error.message });
  }
}
