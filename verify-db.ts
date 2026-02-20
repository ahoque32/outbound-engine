import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

async function verify() {
  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  
  console.log('=== Verifying DB State ===\n');
  
  // Check prospects
  const { data: prospects } = await supabase.from('prospects').select('*');
  console.log('Prospects:');
  prospects?.forEach(p => {
    console.log(`  - ${p.name} (${p.email}): state=${p.state}, email_state=${p.email_state}`);
  });
  
  // Check touchpoints
  const { data: touchpoints } = await supabase.from('touchpoints').select('*');
  console.log(`\nTouchpoints (${touchpoints?.length || 0}):`);
  touchpoints?.forEach(t => {
    console.log(`  - ${t.channel} ${t.action}: ${t.outcome} at ${t.sent_at}`);
  });
  
  // Check sequences
  const { data: sequences } = await supabase.from('sequences').select('*');
  console.log(`\nSequences (${sequences?.length || 0}):`);
  sequences?.forEach(s => {
    console.log(`  - Step ${s.current_step}, status=${s.status}, next=${s.next_step_at}`);
  });
  
  // Check rate limits
  const { data: limits } = await supabase.from('rate_limits').select('*');
  console.log(`\nRate Limits (${limits?.length || 0}):`);
  limits?.forEach(l => {
    console.log(`  - ${l.channel}: ${l.count}/${l.max_limit} on ${l.date}`);
  });
}

verify().catch(console.error);
