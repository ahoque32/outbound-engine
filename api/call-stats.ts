import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY || '';

import variants from '../variants.json';

function getVariantName(id: string): string {
  return variants.variants.find((v: any) => v.id === id)?.name || id || 'unknown';
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  const by = req.query.by as string | undefined;

  try {
    if (by === 'variant') {
      const { data, error } = await supabase
        .from('call_logs')
        .select('agent_variant, outcome, duration_seconds');

      if (error) throw error;

      // Group by variant
      const grouped: Record<string, any[]> = {};
      for (const row of data || []) {
        const key = row.agent_variant || 'unknown';
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push(row);
      }

      const variantStats = Object.entries(grouped).map(([id, rows]) => {
        const total = rows.length;
        const booked = rows.filter(r => r.outcome === 'booked').length;
        const interested = rows.filter(r => r.outcome === 'interested').length;
        const not_interested = rows.filter(r => r.outcome === 'not_interested').length;
        const durations = rows.filter(r => r.duration_seconds).map(r => r.duration_seconds);
        const avg_duration = durations.length > 0
          ? Math.round(durations.reduce((a: number, b: number) => a + b, 0) / durations.length)
          : 0;

        return {
          id,
          name: getVariantName(id),
          total,
          booked,
          interested,
          not_interested,
          booking_rate: total > 0 ? Math.round((booked / total) * 10000) / 100 : 0,
          avg_duration,
        };
      });

      return res.json({ variants: variantStats });
    }

    // Default: overall stats
    const { data, error } = await supabase
      .from('call_logs')
      .select('outcome, duration_seconds, status');

    if (error) throw error;

    const rows = data || [];
    const total = rows.length;
    const completed = rows.filter(r => r.status === 'completed').length;
    const booked = rows.filter(r => r.outcome === 'booked').length;
    const interested = rows.filter(r => r.outcome === 'interested').length;
    const durations = rows.filter(r => r.duration_seconds).map(r => r.duration_seconds);
    const avg_duration = durations.length > 0
      ? Math.round(durations.reduce((a: number, b: number) => a + b, 0) / durations.length)
      : 0;

    res.json({
      total,
      completed,
      booked,
      interested,
      booking_rate: completed > 0 ? Math.round((booked / completed) * 10000) / 100 : 0,
      avg_duration,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
}
