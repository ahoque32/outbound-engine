// Setup Test Campaign — Creates a test campaign with 3 prospects (our own emails only)
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { webDesignSequence } from '../templates/email-sequences';

const TEST_CAMPAIGN_NAME = 'Web Design Outreach - Test';

// ONLY using our own inboxes for testing - NO real prospects
const TEST_PROSPECTS = [
  {
    name: 'Jake Test',
    email: 'jake@growthsiteai.org',
    company: 'Test Company A',
    title: 'Founder',
    website: 'https://example-a.com',
    industry: 'Technology',
  },
  {
    name: 'Hello Test',
    email: 'hello@growthsiteai.org',
    company: 'Test Company B',
    title: 'CEO',
    website: 'https://example-b.com',
    industry: 'Services',
  },
  {
    name: 'Mike Test',
    email: 'mike@nextwavedesigns.org',
    company: 'Test Company C',
    title: 'Owner',
    website: 'https://example-c.com',
    industry: 'Retail',
  },
];

async function setupTestCampaign() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('Error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  console.log('🚀 Setting up test campaign...\n');

  // 1. Check if campaign already exists
  console.log('[DB] Checking for existing test campaign...');
  const { data: existingCampaign } = await supabase
    .from('campaigns')
    .select('*')
    .eq('name', TEST_CAMPAIGN_NAME)
    .single();

  let campaignId: string;

  if (existingCampaign) {
    console.log(`[DB] Found existing campaign: ${existingCampaign.id}`);
    campaignId = existingCampaign.id;

    // Delete existing prospects and sequences for clean slate
    console.log('[DB] Cleaning up existing prospects and sequences...');
    const { data: existingProspects } = await supabase
      .from('prospects')
      .select('id')
      .eq('campaign_id', campaignId);

    if (existingProspects && existingProspects.length > 0) {
      const prospectIds = existingProspects.map(p => p.id);
      await supabase.from('touchpoints').delete().in('prospect_id', prospectIds);
      await supabase.from('sequences').delete().in('prospect_id', prospectIds);
      await supabase.from('prospects').delete().eq('campaign_id', campaignId);
      console.log(`[DB] Deleted ${existingProspects.length} existing prospects`);
    }
  } else {
    // 2. Create campaign
    console.log('[DB] Creating test campaign...');
    const { data: campaign, error: campaignError } = await supabase
      .from('campaigns')
      .insert({
        name: TEST_CAMPAIGN_NAME,
        client_id: 'renderwiseai-test',
        icp_criteria: {
          industries: ['Technology', 'Services', 'Retail'],
          companySize: 'small',
        },
        sequence_template: {
          id: 'web-design-v1',
          name: 'Web Design Outreach',
          steps: webDesignSequence,
        },
        status: 'active',
        daily_limits: {
          linkedin: 10,
          x: 20,
          email: 10,
          voice: 0,
        },
        business_hours: {
          start: '09:00',
          end: '17:00',
          timezone: 'America/New_York',
        },
        exclusion_list: [],
      })
      .select()
      .single();

    if (campaignError) {
      console.error('[DB] Error creating campaign:', campaignError);
      process.exit(1);
    }

    campaignId = campaign.id;
    console.log(`[DB] Created campaign: ${campaignId}`);
  }

  // 3. Create test prospects
  console.log(`[DB] Creating ${TEST_PROSPECTS.length} test prospects...`);
  for (const prospectData of TEST_PROSPECTS) {
    const { data: prospect, error: prospectError } = await supabase
      .from('prospects')
      .insert({
        campaign_id: campaignId,
        name: prospectData.name,
        email: prospectData.email,
        company: prospectData.company,
        title: prospectData.title,
        website: prospectData.website,
        industry: prospectData.industry,
        state: 'discovered',
        linkedin_state: 'not_connected',
        x_state: 'not_following',
        email_state: 'not_sent',
        voice_state: 'not_called',
        score: 75,
      })
      .select()
      .single();

    if (prospectError) {
      console.error(`[DB] Error creating prospect ${prospectData.email}:`, prospectError);
      continue;
    }

    console.log(`[DB] Created prospect: ${prospect.id} (${prospectData.email})`);

    // 4. Create sequence for this prospect
    const { data: sequence, error: seqError } = await supabase
      .from('sequences')
      .insert({
        prospect_id: prospect.id,
        campaign_id: campaignId,
        template_id: 'web-design-v1',
        current_step: 0,
        next_step_at: new Date().toISOString(), // Due now
        status: 'active',
        started_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (seqError) {
      console.error(`[DB] Error creating sequence for ${prospectData.email}:`, seqError);
      continue;
    }

    console.log(`[DB] Created sequence: ${sequence.id}`);
  }

  // 5. Initialize rate limits
  console.log('[DB] Initializing rate limits...');
  const today = new Date().toISOString().split('T')[0];
  const { error: rateError } = await supabase.from('rate_limits').upsert({
    campaign_id: campaignId,
    channel: 'email',
    date: today,
    count: 0,
    max_limit: 10,
  }, { onConflict: 'campaign_id,channel,date' });

  if (rateError) {
    console.error('[DB] Error setting rate limit:', rateError);
  } else {
    console.log('[DB] Rate limits initialized');
  }

  console.log('\n✅ Test campaign setup complete!');
  console.log(`Campaign ID: ${campaignId}`);
  console.log(`\nTo run the sequence:`);
  console.log(`  npm run daily`);
  console.log(`  or: npx ts-node src/scripts/daily-sequence.ts`);
}

setupTestCampaign().catch(console.error);
