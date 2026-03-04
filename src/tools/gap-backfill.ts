import { Prospect, ProspectRow, prospectFromRow } from '../types';
import { GapEntry, GapReport } from './types';
import { getSupabaseClient, getTodayUtcRange } from './shared';

interface CampaignLimitRow {
  daily_limits?: {
    email?: number;
    voice?: number;
    [key: string]: number | undefined;
  };
}

function toNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function mapGapEntry(row: ProspectRow, missingChannel: 'email' | 'voice', reason: string): GapEntry {
  return {
    prospect: prospectFromRow(row),
    missingChannel,
    reason,
  };
}

/**
 * Queries cross-channel outreach gaps and limits results to remaining daily capacity.
 */
export async function queryGapBackfill(): Promise<GapReport> {
  const supabase = getSupabaseClient();
  const { start, end } = getTodayUtcRange();

  const [
    { data: campaigns, error: campaignsErr },
    { count: emailCount, error: emailCountErr },
    { count: voiceCount, error: voiceCountErr },
  ] = await Promise.all([
    supabase.from('campaigns').select('daily_limits').eq('status', 'active'),
    supabase
      .from('touchpoints')
      .select('id', { count: 'exact', head: true })
      .eq('channel', 'email')
      .gte('created_at', start)
      .lte('created_at', end),
    supabase
      .from('call_logs')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', start)
      .lte('created_at', end),
  ]);

  if (campaignsErr) throw new Error(`Failed loading campaign limits: ${campaignsErr.message}`);
  if (emailCountErr) throw new Error(`Failed loading today's email counts: ${emailCountErr.message}`);
  if (voiceCountErr) throw new Error(`Failed loading today's call counts: ${voiceCountErr.message}`);

  const campaignLimitRows = (campaigns || []) as CampaignLimitRow[];
  const totalEmailCap = campaignLimitRows.reduce(
    (sum, row) => sum + toNumber(row.daily_limits?.email, 50),
    0
  );
  const totalVoiceCap = campaignLimitRows.reduce(
    (sum, row) => sum + toNumber(row.daily_limits?.voice, 50),
    0
  );

  const remainingEmailCapacity = Math.max(totalEmailCap - (emailCount || 0), 0);
  const remainingVoiceCapacity = Math.max(totalVoiceCap - (voiceCount || 0), 0);

  const [{ data: calledNotEmailed, error: callGapErr }, { data: emailedNotCalled, error: emailGapErr }] =
    await Promise.all([
      supabase
        .from('prospects')
        .select('*')
        .neq('voice_state', 'not_called')
        .eq('email_state', 'not_sent')
        .limit(Math.max(remainingEmailCapacity, 1)),
      supabase
        .from('prospects')
        .select('*')
        .neq('email_state', 'not_sent')
        .eq('voice_state', 'not_called')
        .limit(Math.max(remainingVoiceCapacity, 1)),
    ]);

  if (callGapErr) throw new Error(`Failed loading called-but-not-emailed prospects: ${callGapErr.message}`);
  if (emailGapErr) throw new Error(`Failed loading emailed-but-not-called prospects: ${emailGapErr.message}`);

  const calledNotEmailedRows = (calledNotEmailed || []) as ProspectRow[];
  const emailedNotCalledRows = (emailedNotCalled || []) as ProspectRow[];

  const emailGapEntries = calledNotEmailedRows
    .slice(0, remainingEmailCapacity)
    .map((row) => mapGapEntry(row, 'email', 'Prospect has voice activity but no email sent'));
  const voiceGapEntries = emailedNotCalledRows
    .slice(0, remainingVoiceCapacity)
    .map((row) => mapGapEntry(row, 'voice', 'Prospect has email activity but no voice call'));

  const prospects = [...emailGapEntries, ...voiceGapEntries];
  const totalFound = calledNotEmailedRows.length + emailedNotCalledRows.length;

  return {
    generatedAt: new Date().toISOString(),
    totalFound,
    limitedToDailyCapacity: prospects.length,
    remainingCapacity: {
      email: remainingEmailCapacity,
      voice: remainingVoiceCapacity,
    },
    prospects,
  };
}

/**
 * Lists prospects with missing channels and optional channel filtering.
 */
export async function listGapProspects(options: {
  limit?: number;
  missingChannel?: 'email' | 'voice';
} = {}): Promise<Prospect[]> {
  const report = await queryGapBackfill();
  const filtered = report.prospects.filter((entry) => {
    if (!options.missingChannel) return true;
    return entry.missingChannel === options.missingChannel;
  });
  const limit = options.limit ?? filtered.length;
  return filtered.slice(0, limit).map((entry) => entry.prospect);
}
