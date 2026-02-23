/**
 * Spam monitoring utilities for outbound voice calls.
 * Tracks spam flags and call quality metrics to detect reputation issues.
 */

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY || '';
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || '';
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || '';

const sbHeaders = {
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
};

export interface SpamStatusResult {
  flagged: boolean;
  score: number | null;
  carrier_flags: string[];
  checked_at: string;
}

export interface CallMetrics {
  total_calls: number;
  answered: number;
  answer_rate: number;
  avg_duration_seconds: number;
  short_calls: number; // < 10 seconds, robocall pattern
}

/**
 * Check spam status for a phone number using Twilio Lookup API v2.
 */
export async function checkSpamStatus(phoneNumber: string): Promise<SpamStatusResult> {
  const fields = 'nomorobo_spam_score,line_type_intelligence';
  const url = `https://lookups.twilio.com/v2/PhoneNumbers/${encodeURIComponent(phoneNumber)}?Fields=${fields}`;
  
  const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64');
  
  const res = await fetch(url, {
    headers: {
      'Authorization': `Basic ${auth}`,
    },
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error('[spam-monitor] Twilio Lookup error:', res.status, errText);
    throw new Error(`Twilio Lookup failed: ${res.status}`);
  }

  const data = await res.json() as any;
  
  const nomorobo = data.nomorobo_spam_score || {};
  const spamScore = nomorobo.score ?? null;
  
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
  
  const flagged = spamScore !== null && spamScore >= 1;
  
  return {
    flagged,
    score: spamScore,
    carrier_flags: carrierFlags,
    checked_at: new Date().toISOString(),
  };
}

/**
 * Get call metrics for the specified time window from Supabase.
 */
export async function getCallMetrics(hours: number): Promise<CallMetrics> {
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  
  // Query call_logs for calls in the time window
  const url = `${SUPABASE_URL}/rest/v1/call_logs?completed_at=gte.${encodeURIComponent(cutoff)}&select=duration_seconds,outcome`;
  
  const res = await fetch(url, { headers: sbHeaders });
  
  if (!res.ok) {
    const errText = await res.text();
    console.error('[spam-monitor] Supabase query error:', res.status, errText);
    throw new Error(`Failed to fetch call metrics: ${res.status}`);
  }
  
  const logs = await res.json() as any[];
  
  const totalCalls = logs.length;
  
  // Count answered calls (outcome indicates human answered)
  const answeredOutcomes = ['answered', 'booked', 'interested', 'callback'];
  const answered = logs.filter(l => answeredOutcomes.includes(l.outcome)).length;
  
  // Calculate average duration
  const durations = logs
    .filter(l => l.duration_seconds != null)
    .map(l => l.duration_seconds);
  
  const avgDuration = durations.length > 0 
    ? durations.reduce((a, b) => a + b, 0) / durations.length 
    : 0;
  
  // Short calls (< 10 seconds) - robocall pattern
  const shortCalls = durations.filter(d => d < 10).length;
  
  const answerRate = totalCalls > 0 ? (answered / totalCalls) * 100 : 0;
  
  return {
    total_calls: totalCalls,
    answered,
    answer_rate: Math.round(answerRate * 100) / 100,
    avg_duration_seconds: Math.round(avgDuration * 100) / 100,
    short_calls: shortCalls,
  };
}

/**
 * Check if call metrics indicate potential spam/reputation issues.
 * Returns warnings if answer rate is low or short call ratio is high.
 */
export function analyzeCallMetrics(metrics: CallMetrics): {
  healthy: boolean;
  warnings: string[];
} {
  const warnings: string[] = [];
  
  if (metrics.total_calls === 0) {
    return { healthy: true, warnings: [] };
  }
  
  // Low answer rate warning (< 30%)
  if (metrics.answer_rate < 30) {
    warnings.push(`Low answer rate: ${metrics.answer_rate}% (threshold: 30%)`);
  }
  
  // High short-call ratio warning (> 50%)
  const shortCallRatio = (metrics.short_calls / metrics.total_calls) * 100;
  if (shortCallRatio > 50) {
    warnings.push(`High short-call ratio: ${shortCallRatio.toFixed(1)}% (threshold: 50%)`);
  }
  
  return {
    healthy: warnings.length === 0,
    warnings,
  };
}
