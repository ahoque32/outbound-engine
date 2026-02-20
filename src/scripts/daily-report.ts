// Daily Report Script
// Generates daily activity report

import { createClient } from '@supabase/supabase-js';

interface DailyStats {
  date: string;
  campaignId: string;
  campaignName: string;
  
  // Prospects
  totalProspects: number;
  newProspects: number;
  
  // Touchpoints by channel
  touchpoints: {
    linkedin: number;
    x: number;
    email: number;
    voice: number;
  };
  
  // Outcomes
  replies: number;
  bounces: number;
  meetings: number;
  
  // Costs
  estimatedCost: number;
}

async function generateDailyReport() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  
  if (!supabaseUrl || !supabaseKey) {
    console.error('Error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required');
    process.exit(1);
  }
  
  const supabase = createClient(supabaseUrl, supabaseKey);
  
  // Get date range (yesterday)
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const dateStr = yesterday.toISOString().split('T')[0];
  
  console.log(`\n📊 Daily Report: ${dateStr}\n`);
  
  // Get all campaigns
  const { data: campaigns } = await supabase
    .from('campaigns')
    .select('id, name');
  
  if (!campaigns || campaigns.length === 0) {
    console.log('No campaigns found');
    return;
  }
  
  for (const campaign of campaigns) {
    // Get touchpoints for this campaign on this date
    const { data: touchpoints } = await supabase
      .from('touchpoints')
      .select('*')
      .eq('campaign_id', campaign.id)
      .gte('created_at', `${dateStr}T00:00:00`)
      .lt('created_at', `${dateStr}T23:59:59`);
    
    // Get new prospects
    const { count: newProspects } = await supabase
      .from('prospects')
      .select('*', { count: 'exact', head: true })
      .eq('campaign_id', campaign.id)
      .gte('created_at', `${dateStr}T00:00:00`)
      .lt('created_at', `${dateStr}T23:59:59`);
    
    // Get total prospects
    const { count: totalProspects } = await supabase
      .from('prospects')
      .select('*', { count: 'exact', head: true })
      .eq('campaign_id', campaign.id);
    
    // Calculate stats
    const stats = {
      linkedin: touchpoints?.filter(t => t.channel === 'linkedin').length || 0,
      x: touchpoints?.filter(t => t.channel === 'x').length || 0,
      email: touchpoints?.filter(t => t.channel === 'email').length || 0,
      voice: touchpoints?.filter(t => t.channel === 'voice').length || 0,
    };
    
    const replies = touchpoints?.filter(t => t.outcome === 'replied').length || 0;
    const bounces = touchpoints?.filter(t => t.outcome === 'bounced').length || 0;
    const meetings = touchpoints?.filter(t => t.outcome === 'booked').length || 0;
    
    // Estimate costs
    const voiceCalls = stats.voice;
    const estimatedCost = (voiceCalls * 0.15) + (stats.email * 0.001); // Voice ~$0.15/call, Email ~$0.001
    
    console.log(`📌 ${campaign.name}`);
    console.log(`   Total Prospects: ${totalProspects || 0} (+${newProspects || 0} new)`);
    console.log(`   Touchpoints: ${touchpoints?.length || 0}`);
    console.log(`     • LinkedIn: ${stats.linkedin}`);
    console.log(`     • X/Twitter: ${stats.x}`);
    console.log(`     • Email: ${stats.email}`);
    console.log(`     • Voice: ${stats.voice}`);
    console.log(`   Outcomes:`);
    console.log(`     • Replies: ${replies}`);
    console.log(`     • Bounces: ${bounces}`);
    console.log(`     • Meetings: ${meetings}`);
    console.log(`   Est. Cost: $${estimatedCost.toFixed(2)}`);
    console.log('');
  }
  
  // Overall summary
  const { data: allTouchpoints } = await supabase
    .from('touchpoints')
    .select('*')
    .gte('created_at', `${dateStr}T00:00:00`)
    .lt('created_at', `${dateStr}T23:59:59`);
  
  console.log('═'.repeat(50));
  console.log(`📈 Overall: ${allTouchpoints?.length || 0} touchpoints across all campaigns`);
  console.log('═'.repeat(50));
}

generateDailyReport().catch(console.error);
