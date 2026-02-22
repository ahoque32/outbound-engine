import type { VercelRequest, VercelResponse } from '@vercel/node';

const GHL_API_KEY = process.env.GHL_API_KEY || '';
const GHL_CALENDAR_ID = process.env.GHL_CALENDAR_ID || '';

function ghlHeaders() {
  return {
    'Authorization': `Bearer ${GHL_API_KEY}`,
    'Version': '2021-04-15',
    'Content-Type': 'application/json',
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const now = new Date();
    const startDate = req.body?.start_date || new Date(now.getTime() + 86400000).toISOString().split('T')[0];
    const endDate = req.body?.end_date || new Date(now.getTime() + 5 * 86400000).toISOString().split('T')[0];

    const start = new Date(startDate).getTime();
    const end = new Date(endDate + 'T23:59:59').getTime();

    const response = await fetch(
      `https://services.leadconnectorhq.com/calendars/${GHL_CALENDAR_ID}/free-slots?startDate=${start}&endDate=${end}`,
      { headers: ghlHeaders() }
    );
    const data = await response.json() as Record<string, any>;

    const formatted: string[] = [];
    for (const [date, info] of Object.entries(data)) {
      if (date === 'traceId') continue;
      const times = (info as any).slots || [];
      const dateStr = new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
      
      const morning = times.filter((t: string) => { const h = parseInt(t.split('T')[1]); return h >= 8 && h < 12; });
      const afternoon = times.filter((t: string) => { const h = parseInt(t.split('T')[1]); return h >= 12 && h < 17; });
      const evening = times.filter((t: string) => { const h = parseInt(t.split('T')[1]); return h >= 17; });

      const parts: string[] = [];
      if (morning.length) parts.push(`morning (${morning[0].split('T')[1].substring(0,5)} to ${morning[morning.length-1].split('T')[1].substring(0,5)})`);
      if (afternoon.length) parts.push(`afternoon (${afternoon[0].split('T')[1].substring(0,5)} to ${afternoon[afternoon.length-1].split('T')[1].substring(0,5)})`);
      if (evening.length) parts.push(`evening (${evening[0].split('T')[1].substring(0,5)} to ${evening[evening.length-1].split('T')[1].substring(0,5)})`);

      if (parts.length) formatted.push(`${dateStr}: ${parts.join(' and ')}`);
    }

    res.json({ available_slots: formatted.join('. '), raw_slots: data });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
}
