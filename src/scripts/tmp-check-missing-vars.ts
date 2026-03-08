import { createClient } from '@supabase/supabase-js';
import { voiceAgent } from '../dialer/voice-agent';

const url = 'https://xajpuwodptmwuqoaglfw.supabase.co';
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';

if (!key) {
  console.error('missing supabase key env');
  process.exit(1);
}

const s = createClient(url, key);

(async () => {
  const { data, error } = await s
    .from('call_logs')
    .select('id,created_at,conversation_id,outcome,status')
    .gte('created_at', '2026-03-05T05:00:00Z')
    .lt('created_at', '2026-03-06T05:00:00Z')
    .order('created_at', { ascending: true })
    .limit(40);

  if (error) {
    console.error(error);
    process.exit(1);
  }

  const rows = (data || []).filter((r: any) => r.conversation_id);
  let miss = 0;
  let checked = 0;

  for (const r of rows.slice(0, 20)) {
    checked++;
    try {
      const c: any = await voiceAgent.getConversation(r.conversation_id);
      const term = c?.metadata?.termination_reason || '';
      if (String(term).includes('Missing required dynamic variables')) miss++;
      console.log(`${String(r.id).slice(0, 8)} ${r.outcome} | ${term || 'ok'}`);
    } catch (e: any) {
      console.log(`${String(r.id).slice(0, 8)} err | ${e.message}`);
    }
  }

  console.log(`checked=${checked} missingVars=${miss}`);
})();
