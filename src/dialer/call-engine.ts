// Call Engine - Orchestrates the full call flow: pick prospect → call → handle → log
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { twilioClient, TwilioCallResult } from './twilio-client';
import { voiceAgent, ConversationResult } from './voice-agent';
import { voicemailHandler, AMDResult, VoicemailDeliveryResult } from './voicemail-handler';
import { personalizeScript, ProspectData, generateObservation } from './call-script';
import { handleObjection, detectInterest } from './objection-handler';
import { selectVariant, VariantConfig } from '../core/ab-router';
import * as dotenv from 'dotenv';

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const DRY_RUN = process.env.DRY_RUN === 'true';
const CALL_COOLDOWN_DAYS = parseInt(process.env.CALL_COOLDOWN_DAYS || '3', 10);

// Rate limits
const MAX_CALLS_PER_DAY = 50;
const MAX_CALLS_PER_HOUR = 10;
const MIN_GAP_BETWEEN_CALLS_MS = 30000; // 30 seconds

// Business hours (9am-5pm)
const BUSINESS_HOURS_START = 9;
const BUSINESS_HOURS_END = 17;

export interface CallEngineConfig {
  maxCallsPerDay?: number;
  maxCallsPerHour?: number;
  minGapMs?: number;
  businessHoursStart?: number;
  businessHoursEnd?: number;
  respectBusinessHours?: boolean;
  dryRun?: boolean;
}

export interface ProspectForCall {
  id: string;
  campaignId: string;
  firstName: string;
  lastName?: string;
  company: string;
  phone: string;
  website?: string;
  industry?: string;
  location?: string;
  timezone?: string;
  observation?: string;
  // Dynamic variable fields for voice agent personalization
  email?: string;
  city?: string;
  state?: string;
  
  productService?: string;
  specificDetail?: string;
  desiredBenefit?: string;
}

export interface CallResult {
  success: boolean;
  prospectId: string;
  callSid?: string;
  status: 'initiated' | 'ringing' | 'answered' | 'voicemail' | 'no_answer' | 'busy' | 'failed';
  amdResult?: AMDResult;
  outcome?: 'interested' | 'not_interested' | 'callback' | 'email_requested' | 'booked' | 'no_answer' | 'voicemail' | 'failed';
  duration?: number;
  transcript?: string;
  recordingUrl?: string;
  notes?: string;
  callbackAt?: Date;
  error?: string;
}

export interface BatchResult {
  total: number;
  successful: number;
  failed: number;
  results: CallResult[];
  summary: {
    interested: number;
    notInterested: number;
    callback: number;
    emailRequested: number;
    booked: number;
    voicemail: number;
    noAnswer: number;
    failed: number;
  };
}

export class CallEngine {
  private supabase: SupabaseClient;
  private config: Required<CallEngineConfig>;
  private lastCallTime: Date | null = null;
  private consecutiveNotInterested = 0;

  constructor(config: CallEngineConfig = {}) {
    this.config = {
      maxCallsPerDay: config.maxCallsPerDay || MAX_CALLS_PER_DAY,
      maxCallsPerHour: config.maxCallsPerHour || MAX_CALLS_PER_HOUR,
      minGapMs: config.minGapMs || MIN_GAP_BETWEEN_CALLS_MS,
      businessHoursStart: config.businessHoursStart || BUSINESS_HOURS_START,
      businessHoursEnd: config.businessHoursEnd || BUSINESS_HOURS_END,
      respectBusinessHours: config.respectBusinessHours ?? true,
      dryRun: config.dryRun ?? DRY_RUN,
    };

    if (!this.config.dryRun && (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY)) {
      throw new Error('Supabase credentials not configured');
    }

    this.supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    console.log('[CallEngine] Initialized');
    console.log('[CallEngine] Config:', {
      maxCallsPerDay: this.config.maxCallsPerDay,
      maxCallsPerHour: this.config.maxCallsPerHour,
      minGapMs: this.config.minGapMs,
      dryRun: this.config.dryRun,
    });
  }

  /**
   * Check if we're within business hours for a prospect's timezone
   */
  isBusinessHours(timezone: string = 'America/New_York'): boolean {
    if (!this.config.respectBusinessHours) return true;

    const now = new Date();
    const prospectTime = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
    const hour = prospectTime.getHours();

    const inBusinessHours = hour >= this.config.businessHoursStart && hour < this.config.businessHoursEnd;
    
    console.log('[CallEngine.isBusinessHours] Prospect time:', prospectTime.toLocaleString(), 'hour:', hour);
    console.log('[CallEngine.isBusinessHours] In business hours:', inBusinessHours);
    
    return inBusinessHours;
  }

  /**
   * Check rate limits before making a call
   */
  async checkRateLimits(): Promise<{ allowed: boolean; reason?: string }> {
    console.log('[CallEngine.checkRateLimits] Checking rate limits...');

    // Check gap between calls
    if (this.lastCallTime) {
      const timeSinceLastCall = Date.now() - this.lastCallTime.getTime();
      if (timeSinceLastCall < this.config.minGapMs) {
        const waitTime = this.config.minGapMs - timeSinceLastCall;
        console.log(`[CallEngine.checkRateLimits] Must wait ${waitTime}ms before next call`);
        return { allowed: false, reason: `Must wait ${Math.ceil(waitTime / 1000)}s between calls` };
      }
    }

    // Check daily limit
    const today = new Date().toISOString().split('T')[0];
    const { data: dailyCount, error: dailyError } = await this.supabase
      .from('call_logs')
      .select('id', { count: 'exact' })
      .gte('created_at', `${today}T00:00:00Z`)
      .lte('created_at', `${today}T23:59:59Z`);

    if (dailyError) {
      console.error('[CallEngine.checkRateLimits] Error checking daily count:', dailyError);
    } else if ((dailyCount?.length || 0) >= this.config.maxCallsPerDay) {
      console.log('[CallEngine.checkRateLimits] Daily limit reached:', dailyCount?.length);
      return { allowed: false, reason: `Daily limit of ${this.config.maxCallsPerDay} calls reached` };
    }

    // Check hourly limit
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { data: hourlyCount, error: hourlyError } = await this.supabase
      .from('call_logs')
      .select('id', { count: 'exact' })
      .gte('created_at', hourAgo);

    if (hourlyError) {
      console.error('[CallEngine.checkRateLimits] Error checking hourly count:', hourlyError);
    } else if ((hourlyCount?.length || 0) >= this.config.maxCallsPerHour) {
      console.log('[CallEngine.checkRateLimits] Hourly limit reached:', hourlyCount?.length);
      return { allowed: false, reason: `Hourly limit of ${this.config.maxCallsPerHour} calls reached` };
    }

    // Check for pattern break (3+ not interested in a row)
    if (this.consecutiveNotInterested >= 3) {
      console.log('[CallEngine.checkRateLimits] Pattern break needed - 3+ not interested in a row');
      return { allowed: false, reason: 'Pattern break - 3 consecutive not interested. Pause 15 min.' };
    }

    console.log('[CallEngine.checkRateLimits] Rate limits passed');
    return { allowed: true };
  }

  /**
   * Get prospects ready for calling
   */
  async getProspectsForCalling(limit: number = 10): Promise<ProspectForCall[]> {
    console.log('[CallEngine.getProspectsForCalling] Fetching up to', limit, 'prospects');

    // Get prospects who:
    // 1. Have a phone number
    // 2. Haven't been called today
    // 3. Are in active campaigns
    const today = new Date().toISOString().split('T')[0];
    
    const { data: prospects, error } = await this.supabase
      .from('prospects')
      .select(`
        id,
        campaign_id,
        name,
        company,
        company_name,
        phone,
        website,
        industry,
        location,
        email,
        state,
        state,
        product_service,
        specific_detail,
        desired_benefit
      `)
      .not('phone', 'is', null)
      .in('pipeline_state', ['discovered', 'contacted', 'researched'])
      .limit(limit);

    if (error) {
      console.error('[CallEngine.getProspectsForCalling] Error:', error);
      return [];
    }

    // Filter out prospects already called today
    const prospectIds = prospects?.map(p => p.id) || [];
    
    if (prospectIds.length === 0) {
      console.log('[CallEngine.getProspectsForCalling] No prospects found');
      return [];
    }

    const { data: todaysCalls } = await this.supabase
      .from('call_logs')
      .select('prospect_id')
      .in('prospect_id', prospectIds)
      .gte('created_at', `${today}T00:00:00Z`);

    const calledToday = new Set(todaysCalls?.map(c => c.prospect_id) || []);
    
    // Check for prospects called in the last N days (cooldown period)
    const cooldownDate = new Date();
    cooldownDate.setDate(cooldownDate.getDate() - CALL_COOLDOWN_DAYS);
    const cooldownDateStr = cooldownDate.toISOString();
    
    console.log(`[CallEngine.getProspectsForCalling] Checking cooldown for calls since ${cooldownDateStr}`);
    
    const { data: recentCalls } = await this.supabase
      .from('call_logs')
      .select('prospect_id, outcome, callback_at')
      .in('prospect_id', prospectIds)
      .gte('created_at', cooldownDateStr)
      .lt('created_at', `${today}T00:00:00Z`); // Exclude today's calls (already filtered)
    
    // Build a map of prospect_id -> most recent call info
    const recentCallsMap = new Map<string, { outcome: string; callbackAt?: string }>();
    recentCalls?.forEach(call => {
      // Keep the most recent call for each prospect
      recentCallsMap.set(call.prospect_id, {
        outcome: call.outcome,
        callbackAt: call.callback_at,
      });
    });
    
    const now = new Date().toISOString();
    
    const availableProspects = prospects
      ?.filter(p => {
        // Filter out if called today
        if (calledToday.has(p.id)) {
          return false;
        }
        
        // Check if in cooldown period
        const recentCall = recentCallsMap.get(p.id);
        if (recentCall) {
          // Exception: if outcome is 'callback' and callback_at is due, allow the call
          if (recentCall.outcome === 'callback' && recentCall.callbackAt && recentCall.callbackAt <= now) {
            console.log(`[CallEngine.getProspectsForCalling] Prospect ${p.id} has callback due, including`);
            return true;
          }
          
          console.log(`[CallEngine.getProspectsForCalling] Prospect ${p.id} called recently (${recentCall.outcome}), skipping`);
          return false;
        }
        
        return true;
      })
      .map(p => {
        const nameParts = (p.name || '').split(' ');
        return {
          id: p.id,
          campaignId: p.campaign_id,
          firstName: nameParts[0] || p.name,
          lastName: nameParts.slice(1).join(' '),
          company: p.company_name || p.company,
          phone: p.phone,
          website: p.website,
          industry: p.industry,
          location: p.location,
          email: p.email,
          city: p.location?.split(',')[0]?.trim(),
          state: p.state,
          productService: p.product_service,
          specificDetail: p.specific_detail,
          desiredBenefit: p.desired_benefit,
        };
      }) || [];

    console.log('[CallEngine.getProspectsForCalling] Found', availableProspects.length, 'prospects ready for calling');
    
    return availableProspects;
  }

  /**
   * Make a single call to a prospect
   */
  async callProspect(prospect: ProspectForCall, templateId: string = 'web-design'): Promise<CallResult> {
    console.log('\n[CallEngine.callProspect] =========================================');
    console.log('[CallEngine.callProspect] Calling:', prospect.firstName, prospect.company);
    console.log('[CallEngine.callProspect] Phone:', prospect.phone);

    const startTime = Date.now();
    
    // Check business hours
    if (!this.isBusinessHours()) {
      console.log('[CallEngine.callProspect] Outside business hours, skipping');
      return {
        success: false,
        prospectId: prospect.id,
        status: 'failed',
        error: 'Outside business hours (9am-5pm)',
      };
    }

    // Check rate limits
    const rateLimitCheck = await this.checkRateLimits();
    if (!rateLimitCheck.allowed) {
      console.log('[CallEngine.callProspect] Rate limit check failed:', rateLimitCheck.reason);
      return {
        success: false,
        prospectId: prospect.id,
        status: 'failed',
        error: rateLimitCheck.reason,
      };
    }

    // Generate observation if not provided
    const prospectData: ProspectData = {
      firstName: prospect.firstName,
      lastName: prospect.lastName,
      company: prospect.company,
      phone: prospect.phone,
      website: prospect.website,
      industry: prospect.industry,
      observation: prospect.observation || generateObservation({
        firstName: prospect.firstName,
        company: prospect.company,
        phone: prospect.phone,
        industry: prospect.industry,
        city: prospect.location,
      }),
    };

    // Personalize script
    const script = personalizeScript(templateId, prospectData);
    console.log('[CallEngine.callProspect] Script intro:', script.intro);

    // Create call log entry
    const callLogId = await this.createCallLog(prospect);
    console.log('[CallEngine.callProspect] Created call log:', callLogId);

    let callResult: CallResult = {
      success: false,
      prospectId: prospect.id,
      status: 'initiated',
    };

    try {
      // Step 1: Make the call with AMD
      console.log('[CallEngine.callProspect] Step 1: Initiating call with AMD...');
      
      // Use ElevenLabs native Twilio integration for outbound calls
      // ElevenLabs handles: Twilio media bridge, STT, LLM (Gemini Flash), TTS, AMD
      
      // Select A/B variant for this call
      const variant: VariantConfig = selectVariant();
      console.log(`[CallEngine.callProspect] A/B variant selected: ${variant.id} (${variant.name}, agent: ${variant.agentId})`);

      // Build dynamic variables for personalization
      const dynamicVariables: Record<string, string> = {
        first_name: prospect.firstName || '',
        last_name: prospect.lastName || '',
        company_name: prospect.company || '',
        website: prospect.website || '',
        city: prospect.city || prospect.location || '',
        state: prospect.state || '',
        product_service: prospect.productService || '',
        specific_detail: prospect.specificDetail || '',
        desired_benefit: prospect.desiredBenefit || '',
        email: prospect.email || '',
      };

      if (this.config.dryRun) {
        console.log('[CallEngine.callProspect] DRY RUN - Simulating call');
        console.log('[CallEngine.callProspect] Would use variant:', variant.id);
        console.log('[CallEngine.callProspect] Dynamic vars:', JSON.stringify(dynamicVariables));
        const simulation = await voiceAgent.simulateConversation({
          firstName: prospect.firstName,
          company: prospect.company,
        });

        callResult.callSid = `DRY_RUN_${Date.now()}`;
        callResult.status = 'answered';
        callResult.outcome = simulation.outcome;
        callResult.transcript = JSON.stringify(simulation.transcript);
        callResult.notes = `DRY RUN — variant: ${variant.id}. ${simulation.notes}`;

        if (simulation.outcome === 'not_interested') {
          this.consecutiveNotInterested++;
        } else {
          this.consecutiveNotInterested = 0;
        }
      } else {
        // Make the call via ElevenLabs outbound API with A/B variant + dynamic variables
        const outboundResult = await voiceAgent.makeOutboundCall(prospect.phone, {
          agentIdOverride: variant.agentId,
          prospectData: dynamicVariables,
        });

        if (!outboundResult.success) {
          throw new Error('Failed to initiate call: ' + outboundResult.error);
        }

        callResult.callSid = outboundResult.callSid;
        callResult.status = 'answered';
        callResult.notes = `ElevenLabs conversation: ${outboundResult.conversationId} | variant: ${variant.id}`;

        console.log('[CallEngine.callProspect] Call initiated via ElevenLabs');
        console.log('[CallEngine.callProspect] Conversation ID:', outboundResult.conversationId);
        console.log('[CallEngine.callProspect] Call SID:', outboundResult.callSid);
        console.log('[CallEngine.callProspect] Variant:', variant.id);

        // ElevenLabs handles the full conversation
        // Outcome will be determined via post-call webhook or polling
        callResult.outcome = 'interested'; // Default — webhook will update
      }

      await this.updateCallLog(callLogId, {
        twilio_call_sid: callResult.callSid,
        agent_variant: variant.id,
        agent_id_used: variant.agentId,
        status: callResult.status,
      });

      callResult.success = true;
      callResult.duration = Math.floor((Date.now() - startTime) / 1000);

      // Update call log with final result
      await this.updateCallLog(callLogId, {
        status: callResult.status,
        outcome: callResult.outcome,
        duration_seconds: callResult.duration,
        transcript: callResult.transcript,
        notes: callResult.notes,
        callback_at: callResult.callbackAt?.toISOString(),
        ended_at: new Date().toISOString(),
      });

    } catch (error) {
      console.error('[CallEngine.callProspect] Error during call:', error);
      callResult.success = false;
      callResult.status = 'failed';
      callResult.error = error instanceof Error ? error.message : 'Unknown error';
      
      await this.updateCallLog(callLogId, {
        status: 'failed',
        notes: callResult.error,
        ended_at: new Date().toISOString(),
      });
    }

    // Update last call time
    this.lastCallTime = new Date();

    console.log('[CallEngine.callProspect] Call completed:', {
      success: callResult.success,
      status: callResult.status,
      outcome: callResult.outcome,
      duration: callResult.duration,
    });
    console.log('[CallEngine.callProspect] =========================================\n');

    return callResult;
  }

  /**
   * Run a batch of calls
   */
  async runBatch(limit: number = 10, templateId: string = 'web-design'): Promise<BatchResult> {
    console.log('[CallEngine.runBatch] Starting batch of up to', limit, 'calls');

    const prospects = await this.getProspectsForCalling(limit);
    
    if (prospects.length === 0) {
      console.log('[CallEngine.runBatch] No prospects available for calling');
      return {
        total: 0,
        successful: 0,
        failed: 0,
        results: [],
        summary: {
          interested: 0,
          notInterested: 0,
          callback: 0,
          emailRequested: 0,
          booked: 0,
          voicemail: 0,
          noAnswer: 0,
          failed: 0,
        },
      };
    }

    const results: CallResult[] = [];

    for (const prospect of prospects) {
      const result = await this.callProspect(prospect, templateId);
      results.push(result);

      // Wait between calls (rate limiting)
      if (this.config.minGapMs > 0 && prospect !== prospects[prospects.length - 1]) {
        console.log(`[CallEngine.runBatch] Waiting ${this.config.minGapMs}ms before next call...`);
        await new Promise(resolve => setTimeout(resolve, this.config.minGapMs));
      }
    }

    // Build summary
    const summary = {
      interested: results.filter(r => r.outcome === 'interested').length,
      notInterested: results.filter(r => r.outcome === 'not_interested').length,
      callback: results.filter(r => r.outcome === 'callback').length,
      emailRequested: results.filter(r => r.outcome === 'email_requested').length,
      booked: results.filter(r => r.outcome === 'booked').length,
      voicemail: results.filter(r => r.outcome === 'voicemail').length,
      noAnswer: results.filter(r => r.outcome === 'no_answer').length,
      failed: results.filter(r => !r.success).length,
    };

    const batchResult: BatchResult = {
      total: results.length,
      successful: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
      results,
      summary,
    };

    console.log('[CallEngine.runBatch] Batch complete:', batchResult);
    
    return batchResult;
  }

  /**
   * Create a call log entry
   */
  private async createCallLog(prospect: ProspectForCall): Promise<string> {
    console.log('[CallEngine.createCallLog] Creating call log for prospect:', prospect.id);

    const { data, error } = await this.supabase
      .from('call_logs')
      .insert({
        prospect_id: prospect.id,
        campaign_id: prospect.campaignId,
        status: this.config.dryRun ? 'dry_run' : 'initiated',
        direction: 'outbound',
      })
      .select('id')
      .single();

    if (error) {
      console.error('[CallEngine.createCallLog] Error:', error);
      throw new Error('Failed to create call log: ' + error.message);
    }

    console.log(`[CallEngine.createCallLog] Created: ${data.id} ${this.config.dryRun ? '(DRY_RUN)' : ''}`);
    return data.id;
  }

  /**
   * Update a call log entry
   */
  private async updateCallLog(logId: string, updates: Record<string, any>): Promise<void> {
    console.log('[CallEngine.updateCallLog] Updating log:', logId, 'with:', Object.keys(updates));

    const { error } = await this.supabase
      .from('call_logs')
      .update(updates)
      .eq('id', logId);

    if (error) {
      console.error('[CallEngine.updateCallLog] Error:', error);
    }
  }
}

export const callEngine = new CallEngine();
