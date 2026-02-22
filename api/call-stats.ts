import type { VercelRequest, VercelResponse } from '@vercel/node';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_KEY || '';

async function supabaseSelect(query: string) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/call_logs?${query}`, {
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
    },
  });
  return res.json();
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  try {
    // Fetch all call logs (select only needed fields)
    const logs = await supabaseSelect('select=outcome,duration_seconds,booking_made,created_at&order=created_at.desc');

    if (!Array.isArray(logs)) {
      return res.status(500).json({ error: 'Failed to query call_logs' });
    }

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const weekStart = new Date(now.getTime() - now.getDay() * 86400000);
    weekStart.setHours(0, 0, 0, 0);
    const weekStartISO = weekStart.toISOString();

    const today = logs.filter(l => l.created_at >= todayStart);
    const thisWeek = logs.filter(l => l.created_at >= weekStartISO);

    // Outcome breakdown
    const outcomes: Record<string, number> = {};
    for (const l of logs) {
      outcomes[l.outcome || 'unknown'] = (outcomes[l.outcome || 'unknown'] || 0) + 1;
    }

    // Average duration
    const durations = logs.filter(l => l.duration_seconds != null).map(l => l.duration_seconds);
    const avgDuration = durations.length > 0 ? Math.round(durations.reduce((a: number, b: number) => a + b, 0) / durations.length) : 0;

    // Booking rate
    const booked = logs.filter(l => l.booking_made).length;
    const bookingRate = logs.length > 0 ? Math.round((booked / logs.length) * 10000) / 100 : 0;

    res.json({
      total_calls: logs.length,
      calls_today: today.length,
      calls_this_week: thisWeek.length,
      outcomes,
      booking_rate_percent: bookingRate,
      bookings: booked,
      avg_duration_seconds: avgDuration,
    });
  } catch (error: any) {
    console.error('[call-stats] Error:', error);
    res.status(500).json({ error: error.message });
  }
}
