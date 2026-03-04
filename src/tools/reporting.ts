import { getTodayStats } from './prospects';
import { queryGapBackfill } from './gap-backfill';
import { DailySummary, GapReport } from './types';
import { getSupabaseClient, getTodayUtcRange } from './shared';

/**
 * Generates a daily aggregate summary from Supabase activity.
 */
export async function generateDailySummary(): Promise<DailySummary> {
  const supabase = getSupabaseClient();
  const baseStats = await getTodayStats();
  const channelGaps = await queryGapBackfill();
  const { start, end } = getTodayUtcRange();

  const { count: touchpointCount, error } = await supabase
    .from('touchpoints')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', start)
    .lte('created_at', end);

  if (error) {
    throw new Error(`Failed loading touchpoint count: ${error.message}`);
  }

  return {
    date: baseStats.date,
    callsMadeToday: baseStats.callsMadeToday,
    emailsSentToday: baseStats.emailsSentToday,
    touchpointsToday: touchpointCount || 0,
    outcomesBreakdown: baseStats.outcomesBreakdown,
    channelGaps,
  };
}

/**
 * Returns prospects with cross-channel coverage gaps.
 */
export async function getChannelGaps(): Promise<GapReport> {
  return queryGapBackfill();
}
