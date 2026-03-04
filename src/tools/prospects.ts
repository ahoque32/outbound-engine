import { Prospect, ProspectRow, Touchpoint, TouchpointRow, prospectFromRow, touchpointFromRow } from '../types';
import { DailyStats, ProspectHistory } from './types';
import { getSupabaseClient, getTodayUtcRange, toErrorMessage } from './shared';

type OutreachOptions = {
  limit?: number;
  missingChannel?: 'email' | 'voice';
};

function mapProspectUpdatesToRow(updates: Partial<Prospect>): Partial<ProspectRow> {
  const row: Partial<ProspectRow> = {};

  if (updates.campaignId !== undefined) row.campaign_id = updates.campaignId;
  if (updates.name !== undefined) row.name = updates.name;
  if (updates.company !== undefined) row.company = updates.company;
  if (updates.title !== undefined) row.title = updates.title;
  if (updates.email !== undefined) row.email = updates.email;
  if (updates.phone !== undefined) row.phone = updates.phone;
  if (updates.linkedinUrl !== undefined) row.linkedin_url = updates.linkedinUrl;
  if (updates.xHandle !== undefined) row.x_handle = updates.xHandle;
  if (updates.website !== undefined) row.website = updates.website;
  if (updates.industry !== undefined) row.industry = updates.industry;
  if (updates.companySize !== undefined) row.company_size = updates.companySize;
  if (updates.location !== undefined) row.location = updates.location;
  if (updates.pipeline_state !== undefined) row.pipeline_state = updates.pipeline_state;
  if (updates.state !== undefined) row.state = updates.state;
  if (updates.linkedinState !== undefined) row.linkedin_state = updates.linkedinState;
  if (updates.xState !== undefined) row.x_state = updates.xState;
  if (updates.emailState !== undefined) row.email_state = updates.emailState;
  if (updates.voiceState !== undefined) row.voice_state = updates.voiceState;
  if (updates.score !== undefined) row.score = updates.score;
  if (updates.notes !== undefined) row.notes = updates.notes;
  if (updates.source !== undefined) row.source = updates.source;
  if (updates.lastTouchpointAt !== undefined) {
    row.last_touchpoint_at = updates.lastTouchpointAt?.toISOString();
  }

  return row;
}

/**
 * Returns the full prospect record for a given prospect ID from Supabase.
 */
export async function getProspect(id: string): Promise<Prospect> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from('prospects').select('*').eq('id', id).single<ProspectRow>();

  if (error || !data) {
    throw new Error(`Failed to load prospect ${id}: ${error?.message || 'not found'}`);
  }

  return prospectFromRow(data);
}

/**
 * Lists prospects that are due for outreach with optional channel-gap filtering.
 */
export async function listProspectsForOutreach(options: OutreachOptions = {}): Promise<Prospect[]> {
  const supabase = getSupabaseClient();
  const limit = options.limit ?? 25;
  const fetchLimit = Math.max(limit * 3, limit);

  const { data, error } = await supabase
    .from('prospects')
    .select('*')
    .in('pipeline_state', ['discovered', 'researched', 'contacted'])
    .order('score', { ascending: false })
    .limit(fetchLimit);

  if (error) {
    throw new Error(`Failed to list outreach prospects: ${error.message}`);
  }

  const prospects = (data || []).map((row) => prospectFromRow(row as ProspectRow));

  const filtered = prospects.filter((prospect) => {
    if (options.missingChannel === 'email') {
      return Boolean(prospect.email) && prospect.emailState === 'not_sent';
    }
    if (options.missingChannel === 'voice') {
      return Boolean(prospect.phone) && prospect.voiceState === 'not_called';
    }
    return (
      (Boolean(prospect.email) && prospect.emailState === 'not_sent') ||
      (Boolean(prospect.phone) && prospect.voiceState === 'not_called')
    );
  });

  return filtered.slice(0, limit);
}

/**
 * Updates prospect fields in Supabase.
 */
export async function updateProspect(id: string, updates: Partial<Prospect>): Promise<void> {
  const supabase = getSupabaseClient();
  const payload = mapProspectUpdatesToRow(updates);

  if (Object.keys(payload).length === 0) {
    return;
  }

  const { error } = await supabase.from('prospects').update(payload).eq('id', id);
  if (error) {
    throw new Error(`Failed to update prospect ${id}: ${error.message}`);
  }
}

/**
 * Returns all touchpoints for a prospect in chronological order.
 */
export async function getProspectHistory(id: string): Promise<ProspectHistory> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('touchpoints')
    .select('*')
    .eq('prospect_id', id)
    .order('created_at', { ascending: true });

  if (error) {
    throw new Error(`Failed to load touchpoint history for prospect ${id}: ${error.message}`);
  }

  return (data || []).map((row) => touchpointFromRow(row as TouchpointRow));
}

/**
 * Returns aggregated today stats (calls, emails, and outcomes breakdown).
 */
export async function getTodayStats(): Promise<DailyStats> {
  const supabase = getSupabaseClient();
  const { start, end, date } = getTodayUtcRange();

  const [{ data: touchpoints, error: touchErr }, { data: calls, error: callErr }] = await Promise.all([
    supabase.from('touchpoints').select('channel,outcome').gte('created_at', start).lte('created_at', end),
    supabase.from('call_logs').select('outcome').gte('created_at', start).lte('created_at', end),
  ]);

  if (touchErr) {
    throw new Error(`Failed to load today's touchpoints: ${touchErr.message}`);
  }
  if (callErr) {
    throw new Error(`Failed to load today's call logs: ${callErr.message}`);
  }

  const outcomesBreakdown: Record<string, number> = {};
  const touchpointRows = touchpoints || [];
  const callRows = calls || [];

  for (const row of touchpointRows) {
    const outcome = row.outcome || 'unknown';
    outcomesBreakdown[outcome] = (outcomesBreakdown[outcome] || 0) + 1;
  }
  for (const row of callRows) {
    const outcome = row.outcome || 'unknown';
    outcomesBreakdown[outcome] = (outcomesBreakdown[outcome] || 0) + 1;
  }

  const emailsSentToday = touchpointRows.filter((row) => row.channel === 'email').length;
  const callsMadeToday = callRows.length;

  return {
    date,
    callsMadeToday,
    emailsSentToday,
    outcomesBreakdown,
  };
}

/**
 * Safe wrapper that returns null on read failures.
 */
export async function tryGetProspect(id: string): Promise<Prospect | null> {
  try {
    return await getProspect(id);
  } catch (error) {
    console.error(`[tools.prospects] ${toErrorMessage(error)}`);
    return null;
  }
}
