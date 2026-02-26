import type { VercelRequest, VercelResponse } from '@vercel/node';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY || '';

// ── Types ──────────────────────────────────────────────────────────────────────

interface FunnelStage {
  state: string;
  count: number;
  pct: number;
}

interface ChannelBreakdown {
  state: string;
  count: number;
  pct: number;
}

interface VerificationStats {
  verified: number;
  unverified: number;
  failed: number;
  total: number;
  verified_rate: number;
}

interface DailyActivity {
  date: string;
  email: number;
  voice: number;
  linkedin: number;
  x: number;
  total: number;
}

interface TopProspect {
  name: string;
  company: string | null;
  score: number;
  pipeline_state: string;
  email_state: string;
  voice_state: string;
  email: string | null;
  phone: string | null;
}

interface PipelineSummary {
  total_leads: number;
  contacted_rate: number;
  engaged_rate: number;
  booking_rate: number;
  verified_rate: number;
  generated_at: string;
}

interface PipelineAnalyticsResponse {
  funnel: FunnelStage[];
  channels: {
    email: ChannelBreakdown[];
    voice: ChannelBreakdown[];
  };
  verification: VerificationStats;
  activity: DailyActivity[];
  top_prospects: TopProspect[];
  summary: PipelineSummary;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const sbHeaders = () => ({
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
});

async function sbGet<T = any>(path: string): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: sbHeaders() });
  if (!res.ok) throw new Error(`Supabase ${path}: ${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

function countBy<T>(arr: T[], key: keyof T): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of arr) {
    const k = String(item[key] ?? 'unknown');
    out[k] = (out[k] || 0) + 1;
  }
  return out;
}

function toBreakdown(counts: Record<string, number>, total: number): ChannelBreakdown[] {
  return Object.entries(counts)
    .map(([state, count]) => ({
      state,
      count,
      pct: total > 0 ? Math.round((count / total) * 10000) / 100 : 0,
    }))
    .sort((a, b) => b.count - a.count);
}

// ── Handler ────────────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  try {
    const days = Math.min(Math.max(parseInt(req.query.days as string) || 7, 1), 90);
    const campaignId = req.query.campaign_id as string | undefined;

    // Build prospect filter
    const prospectFilter = campaignId
      ? `prospects?campaign_id=eq.${encodeURIComponent(campaignId)}&select=id,name,company,email,phone,score,pipeline_state,email_state,voice_state,email_verification_status`
      : `prospects?select=id,name,company,email,phone,score,pipeline_state,email_state,voice_state,email_verification_status`;

    // Build touchpoint filter (last N days)
    const since = new Date();
    since.setDate(since.getDate() - days);
    const sinceStr = since.toISOString();
    const touchpointFilter = campaignId
      ? `touchpoints?campaign_id=eq.${encodeURIComponent(campaignId)}&sent_at=gte.${sinceStr}&select=channel,sent_at`
      : `touchpoints?sent_at=gte.${sinceStr}&select=channel,sent_at`;

    // Parallel fetch
    const [prospects, touchpoints] = await Promise.all([
      sbGet<any[]>(prospectFilter),
      sbGet<any[]>(touchpointFilter),
    ]);

    const total = prospects.length;

    // ── Funnel ───────────────────────────────────────────────────────────────
    const pipelineCounts = countBy(prospects, 'pipeline_state');
    const FUNNEL_ORDER = [
      'discovered', 'researched', 'contacted', 'engaged',
      'qualified', 'booked', 'converted', 'not_interested', 'unresponsive',
    ];
    const funnel: FunnelStage[] = FUNNEL_ORDER.map(state => ({
      state,
      count: pipelineCounts[state] || 0,
      pct: total > 0 ? Math.round(((pipelineCounts[state] || 0) / total) * 10000) / 100 : 0,
    }));
    // Include any states not in the standard order
    for (const [state, count] of Object.entries(pipelineCounts)) {
      if (!FUNNEL_ORDER.includes(state)) {
        funnel.push({ state, count, pct: total > 0 ? Math.round((count / total) * 10000) / 100 : 0 });
      }
    }

    // ── Channels ─────────────────────────────────────────────────────────────
    const emailCounts = countBy(prospects, 'email_state');
    const voiceCounts = countBy(prospects, 'voice_state');

    // ── Verification ─────────────────────────────────────────────────────────
    const verifCounts = countBy(prospects, 'email_verification_status');
    const verified = verifCounts['valid'] || verifCounts['verified'] || 0;
    const failed = verifCounts['invalid'] || verifCounts['failed'] || verifCounts['risky'] || 0;
    const unverified = total - verified - failed;

    // ── Activity (last N days) ───────────────────────────────────────────────
    const dayMap: Record<string, Record<string, number>> = {};
    for (let i = 0; i < days; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      dayMap[d.toISOString().split('T')[0]] = { email: 0, voice: 0, linkedin: 0, x: 0 };
    }
    for (const tp of touchpoints) {
      const date = (tp.sent_at || '').split('T')[0];
      if (dayMap[date]) {
        const ch = tp.channel as string;
        if (ch in dayMap[date]) dayMap[date][ch]++;
      }
    }
    const activity: DailyActivity[] = Object.entries(dayMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, chs]) => ({
        date,
        ...chs,
        total: Object.values(chs).reduce((s, n) => s + n, 0),
      })) as DailyActivity[];

    // ── Top Prospects ────────────────────────────────────────────────────────
    const engaged = prospects
      .filter(p => ['engaged', 'qualified'].includes(p.pipeline_state))
      .sort((a: any, b: any) => (b.score || 0) - (a.score || 0))
      .slice(0, 10);

    const top_prospects: TopProspect[] = engaged.map((p: any) => ({
      name: p.name,
      company: p.company || null,
      score: p.score || 0,
      pipeline_state: p.pipeline_state,
      email_state: p.email_state || 'unknown',
      voice_state: p.voice_state || 'unknown',
      email: p.email || null,
      phone: p.phone || null,
    }));

    // ── Summary ──────────────────────────────────────────────────────────────
    const contacted = (pipelineCounts['contacted'] || 0)
      + (pipelineCounts['engaged'] || 0)
      + (pipelineCounts['qualified'] || 0)
      + (pipelineCounts['booked'] || 0)
      + (pipelineCounts['converted'] || 0);
    const engagedCount = (pipelineCounts['engaged'] || 0)
      + (pipelineCounts['qualified'] || 0)
      + (pipelineCounts['booked'] || 0)
      + (pipelineCounts['converted'] || 0);
    const bookedCount = (pipelineCounts['booked'] || 0) + (pipelineCounts['converted'] || 0);

    const pct = (n: number, d: number) => d > 0 ? Math.round((n / d) * 10000) / 100 : 0;

    const response: PipelineAnalyticsResponse = {
      funnel,
      channels: {
        email: toBreakdown(emailCounts, total),
        voice: toBreakdown(voiceCounts, total),
      },
      verification: {
        verified,
        unverified,
        failed,
        total,
        verified_rate: pct(verified, total),
      },
      activity,
      top_prospects,
      summary: {
        total_leads: total,
        contacted_rate: pct(contacted, total),
        engaged_rate: pct(engagedCount, total),
        booking_rate: pct(bookedCount, total),
        verified_rate: pct(verified, total),
        generated_at: new Date().toISOString(),
      },
    };

    return res.status(200).json(response);
  } catch (error: any) {
    console.error('[pipeline-analytics] Error:', error);
    return res.status(500).json({ error: error.message || 'Internal error' });
  }
}
