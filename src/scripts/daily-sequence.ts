// Daily Sequence Execution Script
// Runs daily to execute pending sequence steps

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { SequenceEngine } from '../core/sequence-engine';
import { RateLimiter } from '../core/rate-limiter';
import { ProspectStateMachine } from '../core/state-machine';
import { LinkedInAdapter } from '../channels/linkedin-adapter';
import { XAdapter } from '../channels/x-adapter';
import { EmailAdapter } from '../channels/email-adapter';
import { VoiceAdapter } from '../channels/voice-adapter';
import { 
  CampaignRow, 
  SequenceRow, 
  ProspectRow, 
  TouchpointRow, 
  Channel,
  campaignFromRow,
  prospectFromRow,
  touchpointFromRow,
} from '../types';

const CHANNEL_ADAPTERS = {
  linkedin: new LinkedInAdapter(),
  x: new XAdapter(),
  email: new EmailAdapter(),
  voice: new VoiceAdapter(),
};

export async function executeDailySequences() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  
  if (!supabaseUrl || !supabaseKey) {
    console.error('Error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required');
    process.exit(1);
  }
  
  const supabase = createClient(supabaseUrl, supabaseKey);
  
  console.log('🚀 Starting daily sequence execution...\n');
  
  // Get all active campaigns
  console.log('[DB] Fetching active campaigns...');
  const { data: campaigns, error: campaignsError } = await supabase
    .from('campaigns')
    .select('*')
    .eq('status', 'active');
  
  if (campaignsError) {
    console.error('[DB] Error fetching campaigns:', campaignsError);
    process.exit(1);
  }
  
  if (!campaigns || campaigns.length === 0) {
    console.log('No active campaigns');
    return;
  }
  
  console.log(`[DB] Found ${campaigns.length} active campaigns`);
  
  for (const campaignRow of campaigns as CampaignRow[]) {
    const campaign = campaignFromRow(campaignRow);
    console.log(`📋 Campaign: ${campaign.name} (${campaign.id})`);
    
    const engine = new SequenceEngine(campaign);
    const rateLimiter = new RateLimiter({
      linkedin: { daily: campaign.dailyLimits.linkedin, hourly: 5 },
      x: { daily: campaign.dailyLimits.x, hourly: 20 },
      email: { daily: campaign.dailyLimits.email, hourly: 10 },
      voice: { daily: campaign.dailyLimits.voice, hourly: 10 },
    });
    
    // Get rate limits for today
    const today = new Date().toISOString().split('T')[0];
    console.log(`[DB] Fetching rate limits for ${today}...`);
    const { data: rateLimits, error: rateLimitError } = await supabase
      .from('rate_limits')
      .select('*')
      .eq('campaign_id', campaign.id)
      .eq('date', today);
    
    if (rateLimitError) {
      console.error('[DB] Error fetching rate limits:', rateLimitError);
    }
    
    const rateLimitMap = new Map(
      (rateLimits || []).map(r => [r.channel as Channel, r])
    );
    console.log(`[DB] Found ${rateLimits?.length || 0} rate limit records`);
    
    // Get active sequences
    console.log(`[DB] Fetching active sequences with next_step_at <= now...`);
    const { data: sequences, error: seqError } = await supabase
      .from('sequences')
      .select('*')
      .eq('campaign_id', campaign.id)
      .eq('status', 'active')
      .lte('next_step_at', new Date().toISOString());
    
    if (seqError) {
      console.error('[DB] Error fetching sequences:', seqError);
      continue;
    }
    
    if (!sequences || sequences.length === 0) {
      console.log('  No pending sequences\n');
      continue;
    }
    
    console.log(`  ${sequences.length} pending sequences`);
    
    // Get all prospects for these sequences
    const prospectIds = sequences.map(s => s.prospect_id);
    console.log(`[DB] Fetching ${prospectIds.length} prospects...`);
    const { data: prospects, error: prospectError } = await supabase
      .from('prospects')
      .select('*')
      .in('id', prospectIds);
    
    if (prospectError) {
      console.error('[DB] Error fetching prospects:', prospectError);
      continue;
    }
    
    const prospectMap = new Map(
      (prospects || []).map(p => [p.id, prospectFromRow(p as ProspectRow)])
    );
    console.log(`[DB] Found ${prospects?.length || 0} prospects`);
    
    // Get touchpoints for these prospects
    console.log(`[DB] Fetching touchpoints for prospects...`);
    const { data: touchpoints, error: touchError } = await supabase
      .from('touchpoints')
      .select('*')
      .in('prospect_id', prospectIds);
    
    if (touchError) {
      console.error('[DB] Error fetching touchpoints:', touchError);
    }
    
    const touchpointsMap = new Map<string, ReturnType<typeof touchpointFromRow>[]>();
    for (const t of touchpoints || []) {
      const list = touchpointsMap.get(t.prospect_id) || [];
      list.push(touchpointFromRow(t as TouchpointRow));
      touchpointsMap.set(t.prospect_id, list);
    }
    console.log(`[DB] Found ${touchpoints?.length || 0} touchpoints`);
    
    // Execute sequences
    let executed = 0;
    let skipped = 0;
    let errors = 0;
    
    for (const sequenceRow of sequences as SequenceRow[]) {
      const prospect = prospectMap.get(sequenceRow.prospect_id);
      if (!prospect) {
        console.log(`  ⚠️  Prospect ${sequenceRow.prospect_id} not found, skipping`);
        continue;
      }
      
      const prospectTouchpoints = touchpointsMap.get(prospect.id) || [];
      
      // Get next step
      const sequence = sequenceFromRow(sequenceRow);
      const next = engine.getNextStep(sequence, prospectTouchpoints);
      if (!next) {
        // Sequence complete
        console.log(`[DB] Marking sequence ${sequence.id} as completed`);
        const { error: updateError } = await supabase
          .from('sequences')
          .update({ status: 'completed', completed_at: new Date().toISOString() })
          .eq('id', sequence.id);
        
        if (updateError) {
          console.error('[DB] Error updating sequence:', updateError);
        }
        continue;
      }
      
      // Check rate limits
      const rateLimit = rateLimitMap.get(next.step.channel);
      const currentCount = rateLimit?.count || 0;
      
      const canExecute = rateLimiter.canExecute(next.step.channel, currentCount);
      if (!canExecute.allowed) {
        skipped++;
        console.log(`  ⏭️  Skipped ${prospect.name}: ${canExecute.reason}`);
        continue;
      }
      
      // Check if already contacted today
      if (RateLimiter.hasBeenContactedToday(prospectTouchpoints)) {
        skipped++;
        console.log(`  ⏭️  Skipped ${prospect.name}: Already contacted today`);
        continue;
      }
      
      // Execute via channel adapter
      const adapter = CHANNEL_ADAPTERS[next.step.channel];
      if (!adapter) {
        errors++;
        console.log(`  ❌ Error: No adapter for ${next.step.channel}`);
        continue;
      }
      
      try {
        // Replace template placeholders with prospect data
        const nameParts = (prospect.name || '').split(' ');
        const firstName = nameParts[0] || '';
        const lastName = nameParts.slice(1).join(' ') || '';
        const personalizedContent = (next.step.template || '')
          .replace(/\{\{first_name\}\}/g, firstName)
          .replace(/\{\{last_name\}\}/g, lastName)
          .replace(/\{\{company\}\}/g, prospect.company || '')
          .replace(/\{\{website\}\}/g, prospect.website || '')
          .replace(/\{\{industry\}\}/g, prospect.industry || '')
          .replace(/\{\{name\}\}/g, prospect.name || '');

        console.log(`[Adapter] Sending ${next.step.channel} ${next.step.action} to ${prospect.name}...`);
        const result = await adapter.send(prospect, next.step.action, personalizedContent);
        
        if (result.success) {
          // Record touchpoint
          console.log(`[DB] Recording touchpoint for ${prospect.name}...`);
          const { error: touchError } = await supabase.from('touchpoints').insert({
            prospect_id: prospect.id,
            campaign_id: campaign.id,
            channel: next.step.channel,
            action: next.step.action,
            content: personalizedContent,
            outcome: result.outcome,
            metadata: result.metadata,
            sent_at: new Date().toISOString(),
          });
          
          if (touchError) {
            console.error('[DB] Error recording touchpoint:', touchError);
          }
          
          // Update prospect state based on channel
          let newState: string;
          switch (next.step.channel) {
            case 'email':
              newState = ProspectStateMachine.updateEmailState(
                prospect.emailState,
                next.step.action,
                result.outcome || 'sent'
              );
              break;
            case 'linkedin':
              newState = ProspectStateMachine.updateLinkedInState(
                prospect.linkedinState,
                next.step.action,
                result.outcome || 'sent'
              );
              break;
            case 'x':
              newState = ProspectStateMachine.updateXState(
                prospect.xState,
                next.step.action,
                result.outcome || 'sent'
              );
              break;
            case 'voice':
              newState = ProspectStateMachine.updateVoiceState(
                prospect.voiceState,
                next.step.action,
                result.outcome || 'sent'
              );
              break;
            default:
              newState = prospect.pipeline_state;
          }
          
          console.log(`[DB] Updating prospect ${prospect.id} state...`);
          const { error: prospectUpdateError } = await supabase
            .from('prospects')
            .update({ 
              [`${next.step.channel}_state`]: newState,
              last_touchpoint_at: new Date().toISOString(),
            })
            .eq('id', prospect.id);
          
          if (prospectUpdateError) {
            console.error('[DB] Error updating prospect:', prospectUpdateError);
          }
          
          // Update rate limit
          console.log(`[DB] Updating rate limit for ${next.step.channel}...`);
          const { error: rateError } = await supabase
            .from('rate_limits')
            .upsert({
              campaign_id: campaign.id,
              channel: next.step.channel,
              date: today,
              count: currentCount + 1,
              max_limit: campaign.dailyLimits[next.step.channel],
            }, { onConflict: 'campaign_id,channel,date' });
          
          if (rateError) {
            console.error('[DB] Error updating rate limit:', rateError);
          }
          
          // Advance sequence
          const updates = engine.advanceSequence(sequence);
          const nextExecution = engine.calculateNextExecution(sequence, 1);
          
          console.log(`[DB] Advancing sequence ${sequence.id} to step ${updates.currentStep}...`);
          const { error: seqUpdateError } = await supabase
            .from('sequences')
            .update({
              current_step: updates.currentStep,
              next_step_at: nextExecution.toISOString(),
            })
            .eq('id', sequence.id);
          
          if (seqUpdateError) {
            console.error('[DB] Error updating sequence:', seqUpdateError);
          }
          
          executed++;
          console.log(`  ✓ ${prospect.name}: ${next.step.channel} ${next.step.action}`);
        } else {
          errors++;
          console.log(`  ❌ ${prospect.name}: ${result.error}`);
        }
      } catch (err) {
        errors++;
        console.log(`  ❌ ${prospect.name}: ${err}`);
      }
    }
    
    console.log(`\n  Summary: ${executed} executed, ${skipped} skipped, ${errors} errors\n`);
  }
  
  console.log('✅ Daily sequence execution complete');
}

// Import sequenceFromRow for use in the loop
function sequenceFromRow(row: SequenceRow) {
  return {
    id: row.id,
    prospectId: row.prospect_id,
    campaignId: row.campaign_id,
    templateId: row.template_id,
    currentStep: row.current_step,
    nextStepAt: row.next_step_at ? new Date(row.next_step_at) : undefined,
    status: row.status,
    startedAt: new Date(row.started_at),
    completedAt: row.completed_at ? new Date(row.completed_at) : undefined,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

executeDailySequences().catch(console.error);
