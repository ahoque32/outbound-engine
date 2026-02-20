// Daily Sequence Execution Script
// Runs daily to execute pending sequence steps

import { createClient } from '@supabase/supabase-js';
import { SequenceEngine } from '../core/sequence-engine';
import { RateLimiter } from '../core/rate-limiter';
import { ProspectStateMachine } from '../core/state-machine';
import { LinkedInAdapter } from '../channels/linkedin-adapter';
import { XAdapter } from '../channels/x-adapter';
import { EmailAdapter } from '../channels/email-adapter';
import { VoiceAdapter } from '../channels/voice-adapter';
import { Campaign, Sequence, Prospect, Touchpoint, Channel } from '../types';

const CHANNEL_ADAPTERS = {
  linkedin: new LinkedInAdapter(),
  x: new XAdapter(),
  email: new EmailAdapter(),
  voice: new VoiceAdapter(),
};

async function executeDailySequences() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  
  if (!supabaseUrl || !supabaseKey) {
    console.error('Error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required');
    process.exit(1);
  }
  
  const supabase = createClient(supabaseUrl, supabaseKey);
  
  console.log('🚀 Starting daily sequence execution...\n');
  
  // Get all active campaigns
  const { data: campaigns } = await supabase
    .from('campaigns')
    .select('*')
    .eq('status', 'active');
  
  if (!campaigns || campaigns.length === 0) {
    console.log('No active campaigns');
    return;
  }
  
  for (const campaign of campaigns as Campaign[]) {
    console.log(`📋 Campaign: ${campaign.name}`);
    
    const engine = new SequenceEngine(campaign);
    const rateLimiter = new RateLimiter({
      linkedin: { daily: campaign.dailyLimits.linkedin, hourly: 5 },
      x: { daily: campaign.dailyLimits.x, hourly: 20 },
      email: { daily: campaign.dailyLimits.email, hourly: 10 },
      voice: { daily: campaign.dailyLimits.voice, hourly: 10 },
    });
    
    // Get rate limits for today
    const today = new Date().toISOString().split('T')[0];
    const { data: rateLimits } = await supabase
      .from('rate_limits')
      .select('*')
      .eq('campaign_id', campaign.id)
      .eq('date', today);
    
    const rateLimitMap = new Map(
      (rateLimits || []).map(r => [r.channel as Channel, r])
    );
    
    // Get active sequences
    const { data: sequences } = await supabase
      .from('sequences')
      .select('*')
      .eq('campaign_id', campaign.id)
      .eq('status', 'active')
      .lte('next_step_at', new Date().toISOString());
    
    if (!sequences || sequences.length === 0) {
      console.log('  No pending sequences\n');
      continue;
    }
    
    console.log(`  ${sequences.length} pending sequences`);
    
    // Get all prospects for these sequences
    const prospectIds = sequences.map(s => s.prospectId);
    const { data: prospects } = await supabase
      .from('prospects')
      .select('*')
      .in('id', prospectIds);
    
    const prospectMap = new Map(
      (prospects || []).map(p => [p.id, p as Prospect])
    );
    
    // Get touchpoints for these prospects
    const { data: touchpoints } = await supabase
      .from('touchpoints')
      .select('*')
      .in('prospect_id', prospectIds);
    
    const touchpointsMap = new Map<string, Touchpoint[]>();
    for (const t of touchpoints || []) {
      const list = touchpointsMap.get(t.prospect_id) || [];
      list.push(t as Touchpoint);
      touchpointsMap.set(t.prospect_id, list);
    }
    
    // Execute sequences
    let executed = 0;
    let skipped = 0;
    let errors = 0;
    
    for (const sequence of sequences as Sequence[]) {
      const prospect = prospectMap.get(sequence.prospectId);
      if (!prospect) continue;
      
      const prospectTouchpoints = touchpointsMap.get(prospect.id) || [];
      
      // Get next step
      const next = engine.getNextStep(sequence, prospectTouchpoints);
      if (!next) {
        // Sequence complete
        await supabase
          .from('sequences')
          .update({ status: 'completed', completed_at: new Date().toISOString() })
          .eq('id', sequence.id);
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
        const result = await adapter.send(prospect, next.step.action, next.step.template);
        
        if (result.success) {
          // Record touchpoint
          await supabase.from('touchpoints').insert({
            prospect_id: prospect.id,
            campaign_id: campaign.id,
            channel: next.step.channel,
            action: next.step.action,
            content: next.step.template,
            outcome: result.outcome,
            metadata: result.metadata,
            sent_at: new Date().toISOString(),
          });
          
          // Update prospect state
          const newState = ProspectStateMachine.updateLinkedInState(
            prospect.linkedinState as any,
            next.step.action,
            result.outcome || 'sent'
          );
          
          await supabase
            .from('prospects')
            .update({ 
              [`${next.step.channel}_state`]: newState,
              last_touchpoint_at: new Date().toISOString(),
            })
            .eq('id', prospect.id);
          
          // Update rate limit
          await supabase
            .from('rate_limits')
            .upsert({
              campaign_id: campaign.id,
              channel: next.step.channel,
              date: today,
              count: currentCount + 1,
              limit: campaign.dailyLimits[next.step.channel],
            }, { onConflict: 'campaign_id,channel,date' });
          
          // Advance sequence
          const updates = engine.advanceSequence(sequence);
          const nextExecution = engine.calculateNextExecution(sequence, 1);
          
          await supabase
            .from('sequences')
            .update({
              ...updates,
              next_step_at: nextExecution.toISOString(),
            })
            .eq('id', sequence.id);
          
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

executeDailySequences().catch(console.error);
