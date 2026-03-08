import { callEngine, ProspectForCall } from '../dialer/call-engine';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE env vars');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function main() {
  const { data: campaigns, error: campErr } = await supabase
    .from('campaigns')
    .select('id')
    .limit(1);

  if (campErr || !campaigns || campaigns.length === 0) {
    throw new Error(`No campaign id available: ${campErr?.message || 'none'}`);
  }

  const { data: prospectRow, error: insErr } = await supabase
    .from('prospects')
    .insert({
      name: 'jhawk test',
      company: 'RenderWiseAI',
      phone: '+14049106217',
      email: 'admin@renderwise.net',
      website: 'https://renderwiseai.com',
      location: 'Atlanta, GA'
    })
    .select('id')
    .single();

  if (insErr || !prospectRow?.id) {
    throw new Error(`Failed creating temp prospect: ${insErr?.message || 'unknown'}`);
  }

  const p: ProspectForCall = {
    id: prospectRow.id,
    campaignId: campaigns[0].id,
    firstName: 'jhawk',
    company: 'RenderWiseAI',
    phone: '+14049106217',
    email: 'admin@renderwise.net',
    location: 'Atlanta',
    city: 'Atlanta',
    state: 'GA',
    website: 'https://renderwiseai.com',
  };

  const result = await callEngine.callProspect(p, 'web-design');
  console.log('CALL_RESULT', JSON.stringify(result, null, 2));

  if (!result.callSid) {
    console.log('NO_CALL_SID');
    return;
  }

  // Wait briefly for async updates
  await new Promise((r) => setTimeout(r, 4000));

  const { data: rows, error } = await supabase
    .from('call_logs')
    .select('id,created_at,twilio_call_sid,conversation_id,notes,outcome,status')
    .eq('twilio_call_sid', result.callSid)
    .order('created_at', { ascending: false })
    .limit(1);

  if (error) throw error;

  console.log('CALL_LOG_ROW', JSON.stringify(rows?.[0] || null, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
