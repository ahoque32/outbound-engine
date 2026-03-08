import { getSupabaseClient, toErrorMessage } from './shared';

/**
 * Valid call-log outcomes.
 */
const VALID_OUTCOMES = [
  'voicemail',
  'interested',
  'not_interested',
  'booked',
  'callback',
  'unknown',
  'no_answer',
  'busy',
  'failed',
] as const;

type CallOutcome = (typeof VALID_OUTCOMES)[number];

export interface CallLogUpdateResult {
  success: boolean;
  callLogId: string;
  conversationId: string;
  prospectId?: string;
  outcome: string;
  prospectVoiceStateUpdated: boolean;
  error?: string;
}

/**
 * Maps a call-log outcome to the corresponding prospect voiceState value.
 */
function outcomeToVoiceState(outcome: CallOutcome): string {
  switch (outcome) {
    case 'voicemail':
      return 'voicemail';
    case 'interested':
      return 'interested';
    case 'not_interested':
      return 'not_interested';
    case 'booked':
      return 'booked';
    case 'callback':
      return 'called';
    case 'no_answer':
      return 'called';
    case 'busy':
      return 'called';
    case 'failed':
      return 'called';
    default:
      return 'called';
  }
}

/**
 * Update a call_log outcome by conversation_id.
 * Also mirrors the outcome to prospects.voice_state (fix #3).
 *
 * @param conversationId  ElevenLabs conversation ID (e.g. conv_xxx)
 * @param outcome         One of VALID_OUTCOMES
 * @param notes           Optional notes to append
 */
export async function updateCallLogOutcome(
  conversationId: string,
  outcome: string,
  notes?: string
): Promise<CallLogUpdateResult> {
  const supabase = getSupabaseClient();

  // Validate outcome
  if (!VALID_OUTCOMES.includes(outcome as CallOutcome)) {
    return {
      success: false,
      callLogId: '',
      conversationId,
      outcome,
      prospectVoiceStateUpdated: false,
      error: `Invalid outcome "${outcome}". Valid: ${VALID_OUTCOMES.join(', ')}`,
    };
  }

  // Find the call_log by conversation_id
  const { data: callLog, error: findErr } = await supabase
    .from('call_logs')
    .select('id, prospect_id, outcome, notes')
    .eq('conversation_id', conversationId)
    .single();

  if (findErr || !callLog) {
    return {
      success: false,
      callLogId: '',
      conversationId,
      outcome,
      prospectVoiceStateUpdated: false,
      error: `call_log not found for conversation_id=${conversationId}: ${findErr?.message || 'not found'}`,
    };
  }

  // Update call_log.outcome (and optionally notes)
  const updatePayload: Record<string, unknown> = { outcome };
  if (notes) {
    const existing = callLog.notes ? `${callLog.notes} | ` : '';
    updatePayload.notes = `${existing}${notes}`;
  }

  const { error: updateErr } = await supabase
    .from('call_logs')
    .update(updatePayload)
    .eq('id', callLog.id);

  if (updateErr) {
    return {
      success: false,
      callLogId: callLog.id,
      conversationId,
      prospectId: callLog.prospect_id,
      outcome,
      prospectVoiceStateUpdated: false,
      error: `Failed to update call_log: ${updateErr.message}`,
    };
  }

  // Mirror to prospects.voice_state (fix #3)
  let prospectUpdated = false;
  if (callLog.prospect_id) {
    const voiceState = outcomeToVoiceState(outcome as CallOutcome);
    const { error: prospectErr } = await supabase
      .from('prospects')
      .update({ voice_state: voiceState })
      .eq('id', callLog.prospect_id);

    if (prospectErr) {
      console.error(
        `[calllog:update-outcome] Warning: call_log updated but prospect voice_state failed: ${prospectErr.message}`
      );
    } else {
      prospectUpdated = true;
    }
  }

  return {
    success: true,
    callLogId: callLog.id,
    conversationId,
    prospectId: callLog.prospect_id,
    outcome,
    prospectVoiceStateUpdated: prospectUpdated,
  };
}
