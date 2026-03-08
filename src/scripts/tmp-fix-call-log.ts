import { voiceAgent } from '../dialer/voice-agent';
import { createClient } from '@supabase/supabase-js';

async function main() {
  const convId = 'conv_0001kk2190f8f19v46dz32c4kfcf';
  const callLogId = '6a175e47-4acf-4126-9680-0ccf3b406743';

  const c: any = await voiceAgent.getConversation(convId);
  const s = createClient(process.env.SUPABASE_URL || '', process.env.SUPABASE_SERVICE_ROLE_KEY || '');

  const upd = {
    transcript: JSON.stringify(c?.transcript || []),
    outcome: 'booked',
    duration_seconds: c?.metadata?.call_duration_secs || 63,
    notes: `ElevenLabs conversation: ${convId} | corrected from provider transcript | termination_reason: ${c?.metadata?.termination_reason || ''}`,
  };

  const { error } = await s.from('call_logs').update(upd).eq('id', callLogId);
  if (error) throw error;

  console.log(JSON.stringify({ updated: callLogId, turns: Array.isArray(c?.transcript) ? c.transcript.length : 0, duration: c?.metadata?.call_duration_secs }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
