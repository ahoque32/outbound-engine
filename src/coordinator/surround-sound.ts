// Surround Sound Coordinator
// Multi-channel orchestration brain - coordinates sequences across Email, LinkedIn, X, and Voice

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import {
  Channel,
  Prospect,
  Campaign,
  Sequence,
  Touchpoint,
  SequenceStep,
  TouchpointResult,
} from '../types';
import { ReplyDetector } from './reply-detector';
import { RateLimiter, DEFAULT_LIMITS } from '../core/rate-limiter';
import { EmailAdapter } from '../channels/email-adapter';
import { LinkedInAdapter } from '../channels/linkedin-adapter';
import { XAdapter } from '../channels/x-adapter';
import { VoiceAdapter } from '../channels/voice-adapter';
import { getTemplate, getRecommendedTemplate, FULL_SURROUND_TEMPLATE } from '../templates/surround-sound-sequences';

// Coordination configuration
interface CoordinatorConfig {
  dryRun: boolean;
  respectBusinessHours: boolean;
  maxTouchesPerDay: number;
  escalationWindowHours: number; // Hours after email open to escalate
  unresponsiveThreshold: number; // Touches before deprioritizing channel
}

const DEFAULT_CONFIG: CoordinatorConfig = {
  dryRun: true,
  respectBusinessHours: true,
  maxTouchesPerDay: 1, // Never hit 2 channels on same day
  escalationWindowHours: 48,
  unresponsiveThreshold: 3,
};

// Action to take for a prospect
interface ProspectiveAction {
  prospect: Prospect;
  campaign: Campaign;
  sequence: Sequence;
  step: SequenceStep;
  channel: Channel;
  action: string;
  shouldExecute: boolean;
  reason?: string;
  escalation?: 'escalated' | 'delayed' | 'normal';
}

// Execution result
interface ExecutionResult {
  success: boolean;
  prospectId: string;
  channel: Channel;
  action: string;
  outcome?: string;
  error?: string;
  touchpointId?: string;
  metadata?: Record<string, any>;
}

// Daily summary
interface DailySummary {
  date: string;
  totalProspects: number;
  actionsPlanned: number;
  actionsExecuted: number;
  actionsSkipped: number;
  byChannel: Record<Channel, { planned: number; executed: number; failed: number }>;
  escalations: number;
  repliesDetected: number;
  errors: string[];
}

export class SurroundSoundCoordinator {
  private supabase: SupabaseClient;
  private replyDetector: ReplyDetector;
  private rateLimiter: RateLimiter;
  private config: CoordinatorConfig;

  // Channel adapters
  private emailAdapter: EmailAdapter;
  private linkedInAdapter: LinkedInAdapter;
  private xAdapter: XAdapter;
  private voiceAdapter: VoiceAdapter;

  // Tracking for daily coordination
  private dailyTouchTracking: Map<string, Set<string>> = new Map(); // prospectId -> Set of dates touched

  constructor(
    supabaseUrl: string,
    supabaseKey: string,
    config: Partial<CoordinatorConfig> = {}
  ) {
    this.supabase = createClient(supabaseUrl, supabaseKey);
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.replyDetector = new ReplyDetector(
      supabaseUrl,
      supabaseKey,
      process.env.AGENTMAIL_API_KEY,
      this.config.dryRun
    );
    this.rateLimiter = new RateLimiter(DEFAULT_LIMITS);

    // Initialize adapters
    this.emailAdapter = new EmailAdapter();
    this.linkedInAdapter = new LinkedInAdapter();
    this.xAdapter = new XAdapter();
    this.voiceAdapter = new VoiceAdapter();

    console.log(`[SurroundSound] Initialized (dryRun: ${this.config.dryRun})`);
  }

  // Main entry: run surround sound for active campaigns
  async run(options: {
    campaignId?: string;
    prospectLimit?: number;
  } = {}): Promise<DailySummary> {
    console.log('[SurroundSound] Starting surround sound run...');

    const summary: DailySummary = {
      date: new Date().toISOString().split('T')[0],
      totalProspects: 0,
      actionsPlanned: 0,
      actionsExecuted: 0,
      actionsSkipped: 0,
      byChannel: {
        email: { planned: 0, executed: 0, failed: 0 },
        linkedin: { planned: 0, executed: 0, failed: 0 },
        x: { planned: 0, executed: 0, failed: 0 },
        voice: { planned: 0, executed: 0, failed: 0 },
      },
      escalations: 0,
      repliesDetected: 0,
      errors: [],
    };

    try {
      // 1. Check for replies first - pause sequences if needed
      console.log('[SurroundSound] Checking for replies...');
      const { detections, alerts } = await this.replyDetector.checkAllChannels(options.campaignId);
      summary.repliesDetected = detections.filter(d => d.eventType === 'reply').length;

      for (const alert of alerts) {
        console.log(`[SurroundSound] ${alert}`);
      }

      // 2. Load active surround-sound campaigns
      console.log('[SurroundSound] Loading campaigns...');
      const campaigns = await this.loadCampaigns(options.campaignId);

      // 3. For each campaign, process prospects
      for (const campaign of campaigns) {
        console.log(`[SurroundSound] Processing campaign: ${campaign.name}`);

        const prospects = await this.loadProspectsForCampaign(campaign.id, options.prospectLimit);
        summary.totalProspects += prospects.length;

        for (const prospect of prospects) {
          try {
            // Check if prospect has replied (should be paused already, but double-check)
            const hasReplied = await this.replyDetector.hasProspectReplied(prospect.id);
            if (hasReplied) {
              console.log(`[SurroundSound] Skipping ${prospect.id} - already replied`);
              continue;
            }

            // Determine next action for this prospect
            const action = await this.determineNextAction(prospect, campaign);

            if (action.shouldExecute) {
              summary.actionsPlanned++;
              summary.byChannel[action.channel].planned++;

              // Execute the action
              const result = await this.executeAction(action);

              if (result.success) {
                summary.actionsExecuted++;
                summary.byChannel[action.channel].executed++;
              } else {
                summary.byChannel[action.channel].failed++;
                summary.errors.push(`Failed ${action.action} on ${action.channel} for ${prospect.id}: ${result.error}`);
              }
            } else {
              summary.actionsSkipped++;
              console.log(`[SurroundSound] Skipped ${prospect.id}: ${action.reason}`);
            }
          } catch (err: any) {
            console.error(`[SurroundSound] Error processing ${prospect.id}:`, err.message);
            summary.errors.push(`Error processing ${prospect.id}: ${err.message}`);
          }
        }
      }

      // 4. Check for escalations (email opened but no reply)
      const escalations = await this.processEscalations(campaigns);
      summary.escalations = escalations.length;

    } catch (err: any) {
      console.error('[SurroundSound] Fatal error:', err.message);
      summary.errors.push(`Fatal error: ${err.message}`);
    }

    console.log('[SurroundSound] Run complete:', summary);
    return summary;
  }

  // Load active surround-sound campaigns
  private async loadCampaigns(campaignId?: string): Promise<Campaign[]> {
    let query = this.supabase
      .from('campaigns')
      .select('*')
      .eq('status', 'active');

    if (campaignId) {
      query = query.eq('id', campaignId);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(`Failed to load campaigns: ${error.message}`);
    }

    // Filter to surround-sound campaigns (those with coordination_mode = 'surround')
    const surroundCampaigns = (data || []).filter(
      (c: any) => c.coordination_mode === 'surround' || c.sequence_template?.type === 'surround'
    );

    console.log(`[SurroundSound] Loaded ${surroundCampaigns.length} surround-sound campaigns`);
    return surroundCampaigns.map(this.mapCampaignFromRow);
  }

  // Load prospects for a campaign
  private async loadProspectsForCampaign(
    campaignId: string,
    limit?: number
  ): Promise<Prospect[]> {
    let query = this.supabase
      .from('prospects')
      .select('*')
      .eq('campaign_id', campaignId)
      .not('state', 'in', '(engaged,booked,converted,not_interested)');

    if (limit) {
      query = query.limit(limit);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(`Failed to load prospects: ${error.message}`);
    }

    return (data || []).map(this.mapProspectFromRow);
  }

  // Determine next action for a prospect
  private async determineNextAction(
    prospect: Prospect,
    campaign: Campaign
  ): Promise<ProspectiveAction> {
    console.log(`[SurroundSound] Determining action for ${prospect.name} (${prospect.id})`);

    // 1. Check if already contacted today (never hit 2 channels same day)
    if (await this.hasBeenContactedToday(prospect.id)) {
      return {
        prospect,
        campaign,
        sequence: null as any,
        step: null as any,
        channel: 'email',
        action: 'skip',
        shouldExecute: false,
        reason: 'Already contacted today',
      };
    }

    // 2. Get or create sequence for this prospect
    const sequence = await this.getOrCreateSequence(prospect, campaign);

    if (!sequence || sequence.status !== 'active') {
      return {
        prospect,
        campaign,
        sequence: null as any,
        step: null as any,
        channel: 'email',
        action: 'skip',
        shouldExecute: false,
        reason: `Sequence not active (status: ${sequence?.status})`,
      };
    }

    // 3. Get the template
    const template = getTemplate(sequence.templateId) || campaign.sequenceTemplate;
    if (!template || !template.steps || sequence.currentStep >= template.steps.length) {
      return {
        prospect,
        campaign,
        sequence,
        step: null as any,
        channel: 'email',
        action: 'skip',
        shouldExecute: false,
        reason: 'Sequence complete or no template',
      };
    }

    // 4. Get current step
    const step = template.steps[sequence.currentStep];
    if (!step) {
      return {
        prospect,
        campaign,
        sequence,
        step: null as any,
        channel: 'email',
        action: 'skip',
        shouldExecute: false,
        reason: 'No step found at current position',
      };
    }

    // 5. Check if step is due (based on day delay)
    const isDue = await this.isStepDue(sequence, step);
    if (!isDue.due) {
      return {
        prospect,
        campaign,
        sequence,
        step,
        channel: step.channel,
        action: step.action,
        shouldExecute: false,
        reason: `Step not due yet: ${isDue.reason}`,
      };
    }

    // 6. Check if prospect has required data for this channel
    if (!this.hasRequiredData(prospect, step.channel)) {
      // Skip to next step
      console.log(`[SurroundSound] Skipping ${step.channel} step - no data for ${prospect.id}`);
      await this.advanceSequence(sequence);
      return {
        prospect,
        campaign,
        sequence,
        step,
        channel: step.channel,
        action: step.action,
        shouldExecute: false,
        reason: `Missing required data for ${step.channel}`,
      };
    }

    // 7. Check rate limits
    const rateLimitCheck = await this.checkRateLimit(step.channel, campaign.id);
    if (!rateLimitCheck.allowed) {
      return {
        prospect,
        campaign,
        sequence,
        step,
        channel: step.channel,
        action: step.action,
        shouldExecute: false,
        reason: `Rate limit: ${rateLimitCheck.reason}`,
      };
    }

    // 8. Check for escalation (email opened but no reply after 48h)
    const escalationStatus = await this.checkEscalationStatus(prospect, step);

    // 9. Check if channel should be deprioritized (3+ touches, no response)
    const shouldDeprioritize = await this.shouldDeprioritizeChannel(prospect.id, step.channel);
    if (shouldDeprioritize) {
      console.log(`[SurroundSound] Deprioritizing ${step.channel} for ${prospect.id} - no response after 3+ touches`);
      // Continue anyway but log it
    }

    return {
      prospect,
      campaign,
      sequence,
      step,
      channel: step.channel,
      action: step.action,
      shouldExecute: true,
      escalation: escalationStatus,
    };
  }

  // Execute an action via the appropriate adapter
  private async executeAction(action: ProspectiveAction): Promise<ExecutionResult> {
    const { prospect, channel, step } = action;

    console.log(`[SurroundSound] Executing ${step.action} on ${channel} for ${prospect.name}`);

    if (this.config.dryRun) {
      console.log(`[SurroundSound] DRY_RUN: Would execute ${step.action} on ${channel}`);
      return {
        success: true,
        prospectId: prospect.id,
        channel,
        action: step.action,
        outcome: 'dry_run',
        metadata: { dryRun: true },
      };
    }

    let result: TouchpointResult;

    try {
      switch (channel) {
        case 'email':
          result = await this.executeEmailAction(prospect, step);
          break;
        case 'linkedin':
          result = await this.executeLinkedInAction(prospect, step);
          break;
        case 'x':
          result = await this.executeXAction(prospect, step);
          break;
        case 'voice':
          result = await this.executeVoiceAction(prospect, step);
          break;
        default:
          throw new Error(`Unknown channel: ${channel}`);
      }

      // Log touchpoint
      const touchpointId = await this.logTouchpoint(prospect, action.campaign.id, channel, step, result);

      // Update rate limits
      await this.incrementRateLimit(channel, action.campaign.id);

      // Advance sequence on success
      if (result.success) {
        await this.advanceSequence(action.sequence);
      }

      return {
        success: result.success,
        prospectId: prospect.id,
        channel,
        action: step.action,
        outcome: result.outcome,
        error: result.error,
        touchpointId,
        metadata: result.metadata,
      };
    } catch (err: any) {
      console.error(`[SurroundSound] Error executing ${channel} action:`, err.message);
      return {
        success: false,
        prospectId: prospect.id,
        channel,
        action: step.action,
        error: err.message,
      };
    }
  }

  // Execute email action
  private async executeEmailAction(
    prospect: Prospect,
    step: SequenceStep
  ): Promise<TouchpointResult> {
    const content = this.generateEmailContent(prospect, step);

    switch (step.action) {
      case 'cold_email':
        return this.emailAdapter.sendColdEmail(prospect, content.subject, content.body);
      case 'follow_up':
      case 'case_study':
        return this.emailAdapter.sendFollowUp(prospect, content.subject, content.body);
      case 'breakup':
        return this.emailAdapter.send(prospect, 'breakup', `${content.subject}\n\n${content.body}`);
      default:
        return this.emailAdapter.send(prospect, step.action, `${content.subject}\n\n${content.body}`);
    }
  }

  // LinkedIn channel — DISABLED (pending aged account)
  // Kept for future re-enablement
  private async executeLinkedInAction(
    prospect: Prospect,
    step: SequenceStep
  ): Promise<TouchpointResult> {
    console.log(`[SurroundSound] LinkedIn DISABLED — skipping ${step.action} for ${prospect.name}`);
    return {
      success: false,
      error: 'LinkedIn channel disabled — no account configured',
      metadata: { channel_disabled: true },
    };
  }

  // X/Twitter channel — DISABLED (pending setup)
  // Kept for future re-enablement
  private async executeXAction(
    prospect: Prospect,
    step: SequenceStep
  ): Promise<TouchpointResult> {
    console.log(`[SurroundSound] X/Twitter DISABLED — skipping ${step.action} for ${prospect.name}`);
    return {
      success: false,
      error: 'X channel disabled — no account configured',
      metadata: { channel_disabled: true },
    };
  }

  // Execute voice action
  private async executeVoiceAction(
    prospect: Prospect,
    step: SequenceStep
  ): Promise<TouchpointResult> {
    console.log(`[SurroundSound] Voice ${step.action} - using dialer`);

    // Use the voice adapter
    const script = this.generateVoiceScript(prospect, step);
    return this.voiceAdapter.makeCall(prospect, script);
  }

  // Generate email content based on step template
  private generateEmailContent(
    prospect: Prospect,
    step: SequenceStep
  ): { subject: string; body: string } {
    const templates: Record<string, { subject: string; body: string }> = {
      value_first_cold_email: {
        subject: `Quick question about ${prospect.company || 'your website'}`,
        body: `Hi ${prospect.name?.split(' ')[0] || 'there'},

I was looking at ${prospect.website || prospect.company || 'your site'} and noticed ${prospect.company || 'your company'} is doing impressive work in the ${prospect.industry || 'space'}.

We help companies like yours [value proposition].

Worth a brief conversation?

Best,
[Sender]`,
      },
      case_study_follow_up: {
        subject: 'Re: Quick question',
        body: `Hi ${prospect.name?.split(' ')[0] || 'there'},

Following up on my previous note. Thought you might find this case study relevant - we helped a similar ${prospect.industry || 'company'} increase [metric] by [result].

Happy to share more details if you're interested.

Best,
[Sender]`,
      },
      breakup_email: {
        subject: 'Should I close the loop?',
        body: `Hi ${prospect.name?.split(' ')[0] || 'there'},

I haven't heard back, so I'll assume now isn't the right time.

If priorities change and you'd like to explore how we can help ${prospect.company || 'your company'}, just reply and I'll be happy to reconnect.

Best of luck,
[Sender]`,
      },
      personalized_cold_outreach: {
        subject: `${prospect.company || 'Your company'} + [Our Company]`,
        body: `Hi ${prospect.name?.split(' ')[0] || 'there'},

[Personalized opening based on research]

I'd love to explore how we might help ${prospect.company || 'your team'} achieve [specific goal].

Open to a brief chat this week?

Best,
[Sender]`,
      },
      value_follow_up: {
        subject: 'Re: ' + (prospect.company || 'Your company') + ' + [Our Company]',
        body: `Hi ${prospect.name?.split(' ')[0] || 'there'},

Quick follow-up. I wanted to share a resource that might be valuable given ${prospect.company || 'your company'}'s focus on [relevant area].

[Value/resource]

Let me know if you'd like to discuss how this applies to your situation.

Best,
[Sender]`,
      },
      case_study_email: {
        subject: 'How [Similar Company] achieved [Result]',
        body: `Hi ${prospect.name?.split(' ')[0] || 'there'},

I thought you'd appreciate this case study about how we helped [Similar Company] in the ${prospect.industry || 'industry'} achieve [specific result].

Given ${prospect.company || 'your company'}'s similar challenges, this might be relevant.

Interested in learning more?

Best,
[Sender]`,
      },
      cold_email_social_reference: {
        subject: `Following up on LinkedIn`,
        body: `Hi ${prospect.name?.split(' ')[0] || 'there'},

Thanks for connecting on LinkedIn. I noticed your work at ${prospect.company || 'your company'} and thought there might be a fit with what we're building.

[Value proposition]

Worth a brief conversation?

Best,
[Sender]`,
      },
      email_follow_up: {
        subject: 'Re: Following up',
        body: `Hi ${prospect.name?.split(' ')[0] || 'there'},

Just bumping this to the top of your inbox. Any interest in exploring how we can help ${prospect.company || 'your company'}?

Happy to work around your schedule.

Best,
[Sender]`,
      },
    };

    return templates[step.template || ''] || templates.value_first_cold_email;
  }

  // Generate voice script based on step
  private generateVoiceScript(prospect: Prospect, step: SequenceStep): string {
    const scripts: Record<string, string> = {
      warm_call_linkedin_reference: `Hi ${prospect.name?.split(' ')[0] || 'there'}, this is [Name] from [Company]. We've been connected on LinkedIn, and I noticed your work at ${prospect.company || 'your company'}. I wanted to reach out personally because I think there might be a good fit between what you're building and how we help companies like yours. Do you have a quick minute to chat?`,
      warm_call_email_reference: `Hi ${prospect.name?.split(' ')[0] || 'there'}, this is [Name] from [Company]. I sent you an email earlier this week about helping ${prospect.company || 'your company'} with [value prop]. I know emails can get buried, so I wanted to reach out directly. Do you have a moment to discuss?`,
      final_call_attempt: `Hi ${prospect.name?.split(' ')[0] || 'there'}, this is [Name] from [Company]. I've reached out a couple of times about [value prop]. This is my last call - if now isn't the right time, I completely understand. Just wanted to make sure we didn't miss an opportunity to help ${prospect.company || 'your company'}. Feel free to call me back at [number] if you're interested.`,
    };

    return scripts[step.template || ''] || scripts.warm_call_linkedin_reference;
  }

  // Check if step is due based on timing
  private async isStepDue(
    sequence: Sequence,
    step: SequenceStep
  ): Promise<{ due: boolean; reason?: string }> {
    const now = new Date();

    // Check if next_step_at is set and passed
    if (sequence.nextStepAt && sequence.nextStepAt > now) {
      return { due: false, reason: `Next step scheduled for ${sequence.nextStepAt.toISOString()}` };
    }

    // Check business hours if configured
    if (this.config.respectBusinessHours) {
      const hour = now.getHours();
      if (hour < 9 || hour > 17) {
        return { due: false, reason: 'Outside business hours' };
      }

      const day = now.getDay();
      if (day === 0 || day === 6) {
        return { due: false, reason: 'Weekend' };
      }
    }

    return { due: true };
  }

  // Check if prospect has been contacted today
  private async hasBeenContactedToday(prospectId: string): Promise<boolean> {
    const today = new Date().toISOString().split('T')[0];

    // Check in-memory cache first
    const prospectTouches = this.dailyTouchTracking.get(prospectId);
    if (prospectTouches?.has(today)) {
      return true;
    }

    // Check database
    const { data: touchpoints, error } = await this.supabase
      .from('touchpoints')
      .select('id, sent_at')
      .eq('prospect_id', prospectId)
      .gte('sent_at', `${today}T00:00:00`)
      .lt('sent_at', `${today}T23:59:59`);

    if (error) {
      console.error('[SurroundSound] Error checking daily touches:', error.message);
      return false;
    }

    const hasTouch = (touchpoints || []).length > 0;

    if (hasTouch) {
      // Cache it
      if (!this.dailyTouchTracking.has(prospectId)) {
        this.dailyTouchTracking.set(prospectId, new Set());
      }
      this.dailyTouchTracking.get(prospectId)!.add(today);
    }

    return hasTouch;
  }

  // Channels currently enabled for outreach
  private static ENABLED_CHANNELS: Set<Channel> = new Set(['email', 'voice']);

  // Check if prospect has required data for channel
  private hasRequiredData(prospect: Prospect, channel: Channel): boolean {
    // Skip disabled channels entirely
    if (!SurroundSoundCoordinator.ENABLED_CHANNELS.has(channel)) {
      return false;
    }

    const requirements: Record<Channel, string[]> = {
      email: ['email'],
      linkedin: ['linkedinUrl'],
      x: ['xHandle'],
      voice: ['phone'],
    };

    const required = requirements[channel];
    return required.every(field => {
      const value = (prospect as any)[field];
      return value !== undefined && value !== null && value !== '';
    });
  }

  // Check rate limit for channel
  private async checkRateLimit(
    channel: Channel,
    campaignId: string
  ): Promise<{ allowed: boolean; reason?: string }> {
    const today = new Date().toISOString().split('T')[0];

    const { data: rateLimit, error } = await this.supabase
      .from('rate_limits')
      .select('*')
      .eq('campaign_id', campaignId)
      .eq('channel', channel)
      .eq('date', today)
      .single();

    if (error && error.code !== 'PGRST116') {
      // PGRST116 = no rows found
      console.error('[SurroundSound] Error checking rate limit:', error.message);
    }

    const currentCount = rateLimit?.count || 0;
    const maxLimit = rateLimit?.max_limit || DEFAULT_LIMITS[channel].daily;

    if (currentCount >= maxLimit) {
      return { allowed: false, reason: `Daily limit reached (${currentCount}/${maxLimit})` };
    }

    return { allowed: true };
  }

  // Increment rate limit counter
  private async incrementRateLimit(channel: Channel, campaignId: string): Promise<void> {
    const today = new Date().toISOString().split('T')[0];

    if (this.config.dryRun) {
      console.log(`[SurroundSound] DRY_RUN: Would increment rate limit for ${channel}`);
      return;
    }

    // Upsert rate limit
    const { error } = await this.supabase.rpc('increment_rate_limit', {
      p_campaign_id: campaignId,
      p_channel: channel,
      p_date: today,
      p_max_limit: DEFAULT_LIMITS[channel].daily,
    });

    if (error) {
      // Fallback to manual upsert if RPC doesn't exist
      const { data: existing } = await this.supabase
        .from('rate_limits')
        .select('id, count')
        .eq('campaign_id', campaignId)
        .eq('channel', channel)
        .eq('date', today)
        .single();

      if (existing) {
        await this.supabase
          .from('rate_limits')
          .update({ count: existing.count + 1 })
          .eq('id', existing.id);
      } else {
        await this.supabase.from('rate_limits').insert({
          campaign_id: campaignId,
          channel,
          date: today,
          count: 1,
          max_limit: DEFAULT_LIMITS[channel].daily,
        });
      }
    }
  }

  // Check escalation status (email opened but no reply after 48h)
  private async checkEscalationStatus(
    prospect: Prospect,
    step: SequenceStep
  ): Promise<'escalated' | 'delayed' | 'normal'> {
    if (step.channel !== 'x' && step.channel !== 'linkedin') {
      return 'normal';
    }

    // Check if email was opened recently
    const { data: emailTouchpoints } = await this.supabase
      .from('touchpoints')
      .select('*')
      .eq('prospect_id', prospect.id)
      .eq('channel', 'email')
      .not('opened_at', 'is', null)
      .is('replied_at', null)
      .order('opened_at', { ascending: false })
      .limit(1);

    if (!emailTouchpoints || emailTouchpoints.length === 0) {
      return 'normal';
    }

    const lastOpen = new Date(emailTouchpoints[0].opened_at);
    const hoursSinceOpen = (Date.now() - lastOpen.getTime()) / (1000 * 60 * 60);

    if (hoursSinceOpen > this.config.escalationWindowHours) {
      console.log(`[SurroundSound] ESCALATING ${prospect.id} - email opened ${Math.round(hoursSinceOpen)}h ago, no reply`);
      return 'escalated';
    }

    return 'normal';
  }

  // Process escalations across campaigns
  private async processEscalations(campaigns: Campaign[]): Promise<string[]> {
    const escalations: string[] = [];

    for (const campaign of campaigns) {
      // Find prospects with email opens but no reply after 48h
      const { data: prospects } = await this.supabase
        .from('prospects')
        .select('id, name')
        .eq('campaign_id', campaign.id)
        .eq('email_state', 'opened');

      for (const prospect of prospects || []) {
        // Check if we should escalate to DM
        const shouldEscalate = await this.shouldEscalateToDM(prospect.id);
        if (shouldEscalate) {
          escalations.push(prospect.id);
          console.log(`[SurroundSound] Escalation candidate: ${prospect.name} (${prospect.id})`);
        }
      }
    }

    return escalations;
  }

  // Check if prospect should be escalated to DM
  private async shouldEscalateToDM(prospectId: string): Promise<boolean> {
    // Get last email open
    const { data: touchpoints } = await this.supabase
      .from('touchpoints')
      .select('*')
      .eq('prospect_id', prospectId)
      .eq('channel', 'email')
      .not('opened_at', 'is', null)
      .is('replied_at', null)
      .order('opened_at', { ascending: false })
      .limit(1);

    if (!touchpoints || touchpoints.length === 0) {
      return false;
    }

    const lastOpen = new Date(touchpoints[0].opened_at);
    const hoursSinceOpen = (Date.now() - lastOpen.getTime()) / (1000 * 60 * 60);

    return hoursSinceOpen > this.config.escalationWindowHours;
  }

  // Check if channel should be deprioritized
  private async shouldDeprioritizeChannel(
    prospectId: string,
    channel: Channel
  ): Promise<boolean> {
    const { data: touchpoints } = await this.supabase
      .from('touchpoints')
      .select('*')
      .eq('prospect_id', prospectId)
      .eq('channel', channel);

    if (!touchpoints || touchpoints.length < this.config.unresponsiveThreshold) {
      return false;
    }

    // Check if any positive response
    const hasResponse = touchpoints.some(
      (t: any) => t.outcome === 'replied' || t.outcome === 'accepted' || t.outcome === 'connected'
    );

    return !hasResponse;
  }

  // Get or create sequence for prospect
  private async getOrCreateSequence(
    prospect: Prospect,
    campaign: Campaign
  ): Promise<Sequence | null> {
    // Check for existing active sequence
    const { data: existing, error } = await this.supabase
      .from('sequences')
      .select('*')
      .eq('prospect_id', prospect.id)
      .eq('campaign_id', campaign.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (existing) {
      return this.mapSequenceFromRow(existing);
    }

    // Create new sequence
    const templateId = getRecommendedTemplate(prospect);

    const { data: created, error: createError } = await this.supabase
      .from('sequences')
      .insert({
        prospect_id: prospect.id,
        campaign_id: campaign.id,
        template_id: templateId,
        current_step: 0,
        status: 'active',
        started_at: new Date().toISOString(),
        coordination_mode: 'surround',
      })
      .select()
      .single();

    if (createError) {
      console.error('[SurroundSound] Error creating sequence:', createError.message);
      return null;
    }

    return this.mapSequenceFromRow(created);
  }

  // Advance sequence to next step
  private async advanceSequence(sequence: Sequence): Promise<void> {
    const nextStep = sequence.currentStep + 1;

    const update: any = {
      current_step: nextStep,
      updated_at: new Date().toISOString(),
    };

    // Calculate next step time (default: 2 days)
    const nextStepAt = new Date();
    nextStepAt.setDate(nextStepAt.getDate() + 2);
    update.next_step_at = nextStepAt.toISOString();

    if (this.config.dryRun) {
      console.log(`[SurroundSound] DRY_RUN: Would advance sequence ${sequence.id} to step ${nextStep}`);
      return;
    }

    const { error } = await this.supabase
      .from('sequences')
      .update(update)
      .eq('id', sequence.id);

    if (error) {
      console.error('[SurroundSound] Error advancing sequence:', error.message);
    }
  }

  // Log touchpoint to database
  private async logTouchpoint(
    prospect: Prospect,
    campaignId: string,
    channel: Channel,
    step: SequenceStep,
    result: TouchpointResult
  ): Promise<string | undefined> {
    if (this.config.dryRun) {
      console.log(`[SurroundSound] DRY_RUN: Would log touchpoint`);
      return undefined;
    }

    const { data, error } = await this.supabase
      .from('touchpoints')
      .insert({
        prospect_id: prospect.id,
        campaign_id: campaignId,
        channel,
        action: step.action,
        content: step.template,
        outcome: result.outcome || (result.success ? 'sent' : 'failed'),
        metadata: {
          ...result.metadata,
          step_template: step.template,
          step_day: step.day,
        },
        sent_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      console.error('[SurroundSound] Error logging touchpoint:', error.message);
      return undefined;
    }

    // Update prospect last_touchpoint_at
    await this.supabase
      .from('prospects')
      .update({ last_touchpoint_at: new Date().toISOString() })
      .eq('id', prospect.id);

    return data?.id;
  }

  // Database row mappers
  private mapCampaignFromRow(row: any): Campaign {
    return {
      id: row.id,
      name: row.name,
      clientId: row.client_id,
      icpCriteria: row.icp_criteria || {},
      sequenceTemplate: row.sequence_template || FULL_SURROUND_TEMPLATE,
      status: row.status,
      dailyLimits: row.daily_limits || DEFAULT_LIMITS,
      businessHours: row.business_hours || { start: '09:00', end: '17:00', timezone: 'America/New_York' },
      exclusionList: row.exclusion_list || [],
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  private mapProspectFromRow(row: any): Prospect {
    return {
      id: row.id,
      campaignId: row.campaign_id,
      name: row.name,
      company: row.company,
      title: row.title,
      email: row.email,
      phone: row.phone,
      linkedinUrl: row.linkedin_url,
      xHandle: row.x_handle,
      website: row.website,
      industry: row.industry,
      companySize: row.company_size,
      location: row.location,
      state: row.state,
      linkedinState: row.linkedin_state || 'not_connected',
      xState: row.x_state || 'not_following',
      emailState: row.email_state || 'not_sent',
      voiceState: row.voice_state || 'not_called',
      score: row.score || 0,
      notes: row.notes,
      source: row.source,
      lastTouchpointAt: row.last_touchpoint_at ? new Date(row.last_touchpoint_at) : undefined,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  private mapSequenceFromRow(row: any): Sequence {
    return {
      id: row.id,
      prospectId: row.prospect_id,
      campaignId: row.campaign_id,
      templateId: row.template_id,
      currentStep: row.current_step || 0,
      nextStepAt: row.next_step_at ? new Date(row.next_step_at) : undefined,
      status: row.status,
      startedAt: new Date(row.started_at),
      completedAt: row.completed_at ? new Date(row.completed_at) : undefined,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }
}

export { CoordinatorConfig, DailySummary, ProspectiveAction, ExecutionResult };
