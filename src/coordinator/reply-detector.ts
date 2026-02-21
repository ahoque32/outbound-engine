// Reply Detector
// Monitors all channels for prospect replies and triggers pause logic

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Channel, Prospect, Touchpoint, ChannelEvent } from '../types';

// AgentMail API types
interface AgentMailMessage {
  id: string;
  inbox_id: string;
  subject: string;
  from: { email: string; name?: string };
  to: { email: string; name?: string }[];
  text?: string;
  html?: string;
  created_at: string;
  thread_id?: string;
}

export interface ReplyDetectionResult {
  prospectId: string;
  campaignId: string;
  channel: Channel;
  eventType: 'reply' | 'open' | 'click' | 'accept' | 'follow_back';
  detectedAt: Date;
  metadata?: Record<string, any>;
}

export interface PauseAction {
  sequenceId: string;
  prospectId: string;
  campaignId: string;
  pausedReason: string;
  pausedByEvent: string;
}

export class ReplyDetector {
  private supabase: SupabaseClient;
  private agentMailApiKey: string;
  private dryRun: boolean;

  constructor(
    supabaseUrl: string,
    supabaseKey: string,
    agentMailApiKey?: string,
    dryRun: boolean = true
  ) {
    this.supabase = createClient(supabaseUrl, supabaseKey);
    this.agentMailApiKey = agentMailApiKey || process.env.AGENTMAIL_API_KEY || '';
    this.dryRun = dryRun;

    console.log(`[ReplyDetector] Initialized (dryRun: ${dryRun})`);
  }

  // Main entry point: check all channels for replies
  async checkAllChannels(campaignId?: string): Promise<{
    detections: ReplyDetectionResult[];
    pauses: PauseAction[];
    alerts: string[];
  }> {
    console.log(`[ReplyDetector] Checking all channels${campaignId ? ` for campaign ${campaignId}` : ''}`);

    const detections: ReplyDetectionResult[] = [];
    const pauses: PauseAction[] = [];
    const alerts: string[] = [];

    // 1. Check email replies via AgentMail
    const emailReplies = await this.checkEmailReplies(campaignId);
    detections.push(...emailReplies);

    // 2. Check touchpoints table for replied_at timestamps
    const touchpointReplies = await this.checkTouchpointReplies(campaignId);
    detections.push(...touchpointReplies);

    // 3. Check for LinkedIn connection accepts
    const linkedInAccepts = await this.checkLinkedInAccepts(campaignId);
    detections.push(...linkedInAccepts);

    // 4. Check for X follow-backs
    const xFollowBacks = await this.checkXFollowBacks(campaignId);
    detections.push(...xFollowBacks);

    // 5. Check for email opens (escalation trigger)
    const emailOpens = await this.checkEmailOpens(campaignId);
    detections.push(...emailOpens);

    // Process all detections - pause sequences and create alerts
    for (const detection of detections) {
      // Log channel event
      await this.logChannelEvent(detection);

      // If it's a reply, pause all sequences for this prospect
      if (detection.eventType === 'reply') {
        const pauseActions = await this.pauseAllSequencesForProspect(
          detection.prospectId,
          detection.campaignId,
          detection.channel
        );
        pauses.push(...pauseActions);

        // Update prospect state to engaged
        await this.updateProspectState(detection.prospectId, 'engaged');

        // Create alert
        const alert = this.createAlert(detection);
        alerts.push(alert);
        console.log(`[ReplyDetector] 🚨 ALERT: ${alert}`);
      }
    }

    return { detections, pauses, alerts };
  }

  // Check AgentMail inboxes for replies
  private async checkEmailReplies(campaignId?: string): Promise<ReplyDetectionResult[]> {
    console.log('[ReplyDetector] Checking AgentMail for email replies...');
    const detections: ReplyDetectionResult[] = [];

    if (!this.agentMailApiKey) {
      console.warn('[ReplyDetector] No AgentMail API key configured');
      return detections;
    }

    // Get active prospects with emails
    const { data: prospects, error } = await this.supabase
      .from('prospects')
      .select('id, campaign_id, email, email_state')
      .eq('email_state', 'sent')
      .not('email', 'is', null);

    if (error) {
      console.error('[ReplyDetector] Error fetching prospects:', error.message);
      return detections;
    }

    if (!prospects || prospects.length === 0) {
      console.log('[ReplyDetector] No prospects awaiting replies');
      return detections;
    }

    // Get sender inboxes
    const senderInboxes = [
      'jake@growthsiteai.org',
      'jake.mitchell@growthsiteai.org',
      'hello@growthsiteai.org',
      'alex.turner@siteflowagency.org',
      'hello@siteflowagency.org',
      'mike@nextwavedesigns.org',
      'mike.chen@nextwavedesigns.org',
      'hello@nextwavedesigns.org',
    ];

    for (const inbox of senderInboxes) {
      try {
        const messages = await this.fetchAgentMailMessages(inbox);

        for (const message of messages) {
          // Check if this is a reply (not a sent message)
          const isReply = message.to.some(
            (to) => !senderInboxes.includes(to.email)
          );

          if (!isReply) continue;

          // Find matching prospect
          const prospect = prospects.find(
            (p) => p.email?.toLowerCase() === message.from.email.toLowerCase()
          );

          if (prospect) {
            console.log(`[ReplyDetector] ✉️ Email reply detected from ${prospect.email}`);
            detections.push({
              prospectId: prospect.id,
              campaignId: prospect.campaign_id,
              channel: 'email',
              eventType: 'reply',
              detectedAt: new Date(message.created_at),
              metadata: {
                subject: message.subject,
                messageId: message.id,
                preview: message.text?.substring(0, 100),
              },
            });
          }
        }
      } catch (err: any) {
        console.error(`[ReplyDetector] Error checking inbox ${inbox}:`, err.message);
      }
    }

    return detections;
  }

  // Fetch messages from AgentMail inbox
  private async fetchAgentMailMessages(inboxId: string): Promise<AgentMailMessage[]> {
    if (this.dryRun) {
      console.log(`[ReplyDetector] DRY_RUN: Would fetch messages from ${inboxId}`);
      return [];
    }

    const encodedInbox = encodeURIComponent(inboxId);
    const url = `https://api.agentmail.to/v0/inboxes/${encodedInbox}/messages`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${this.agentMailApiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`AgentMail ${response.status}: ${await response.text()}`);
    }

    const data = await response.json() as { messages?: AgentMailMessage[] };
    return data.messages || [];
  }

  // Check touchpoints table for replied_at timestamps
  private async checkTouchpointReplies(campaignId?: string): Promise<ReplyDetectionResult[]> {
    console.log('[ReplyDetector] Checking touchpoints for replies...');
    const detections: ReplyDetectionResult[] = [];

    let query = this.supabase
      .from('touchpoints')
      .select('id, prospect_id, campaign_id, channel, replied_at, metadata')
      .not('replied_at', 'is', null)
      .is('reply_processed', null); // Only get unprocessed replies

    if (campaignId) {
      query = query.eq('campaign_id', campaignId);
    }

    const { data: touchpoints, error } = await query;

    if (error) {
      console.error('[ReplyDetector] Error fetching touchpoints:', error.message);
      return detections;
    }

    if (!touchpoints || touchpoints.length === 0) {
      console.log('[ReplyDetector] No new replies in touchpoints');
      return detections;
    }

    for (const touchpoint of touchpoints) {
      console.log(`[ReplyDetector] 📨 Reply detected on ${touchpoint.channel} for prospect ${touchpoint.prospect_id}`);
      detections.push({
        prospectId: touchpoint.prospect_id,
        campaignId: touchpoint.campaign_id,
        channel: touchpoint.channel as Channel,
        eventType: 'reply',
        detectedAt: new Date(touchpoint.replied_at),
        metadata: touchpoint.metadata || {},
      });

      // Mark as processed
      if (!this.dryRun) {
        await this.supabase
          .from('touchpoints')
          .update({ reply_processed: true })
          .eq('id', touchpoint.id);
      }
    }

    return detections;
  }

  // Check for LinkedIn connection accepts
  private async checkLinkedInAccepts(campaignId?: string): Promise<ReplyDetectionResult[]> {
    console.log('[ReplyDetector] Checking for LinkedIn accepts...');
    const detections: ReplyDetectionResult[] = [];

    // In a real implementation, this would poll LinkedIn via Camoufox
    // For now, we check the channel_events table for 'accept' events
    let query = this.supabase
      .from('channel_events')
      .select('*')
      .eq('channel', 'linkedin')
      .eq('event_type', 'accept')
      .is('processed', null);

    if (campaignId) {
      query = query.eq('campaign_id', campaignId);
    }

    const { data: events, error } = await query;

    if (error) {
      console.error('[ReplyDetector] Error checking LinkedIn accepts:', error.message);
      return detections;
    }

    for (const event of events || []) {
      detections.push({
        prospectId: event.prospect_id,
        campaignId: event.campaign_id,
        channel: 'linkedin',
        eventType: 'accept',
        detectedAt: new Date(event.detected_at),
        metadata: event.metadata,
      });
    }

    return detections;
  }

  // Check for X follow-backs
  private async checkXFollowBacks(campaignId?: string): Promise<ReplyDetectionResult[]> {
    console.log('[ReplyDetector] Checking for X follow-backs...');
    const detections: ReplyDetectionResult[] = [];

    // Similar to LinkedIn - check channel_events table
    let query = this.supabase
      .from('channel_events')
      .select('*')
      .eq('channel', 'x')
      .eq('event_type', 'follow_back')
      .is('processed', null);

    if (campaignId) {
      query = query.eq('campaign_id', campaignId);
    }

    const { data: events, error } = await query;

    if (error) {
      console.error('[ReplyDetector] Error checking X follow-backs:', error.message);
      return detections;
    }

    for (const event of events || []) {
      detections.push({
        prospectId: event.prospect_id,
        campaignId: event.campaign_id,
        channel: 'x',
        eventType: 'follow_back',
        detectedAt: new Date(event.detected_at),
        metadata: event.metadata,
      });
    }

    return detections;
  }

  // Check for email opens (escalation trigger)
  private async checkEmailOpens(campaignId?: string): Promise<ReplyDetectionResult[]> {
    console.log('[ReplyDetector] Checking for email opens...');
    const detections: ReplyDetectionResult[] = [];

    // Get touchpoints that were opened but not replied
    let query = this.supabase
      .from('touchpoints')
      .select('id, prospect_id, campaign_id, channel, opened_at, metadata')
      .eq('channel', 'email')
      .not('opened_at', 'is', null)
      .is('replied_at', null)
      .is('open_processed', null);

    if (campaignId) {
      query = query.eq('campaign_id', campaignId);
    }

    const { data: touchpoints, error } = await query;

    if (error) {
      console.error('[ReplyDetector] Error checking email opens:', error.message);
      return detections;
    }

    for (const touchpoint of touchpoints || []) {
      // Check if open is recent (within last check window)
      const openedAt = new Date(touchpoint.opened_at);
      const hoursSinceOpen = (Date.now() - openedAt.getTime()) / (1000 * 60 * 60);

      if (hoursSinceOpen < 24) {
        console.log(`[ReplyDetector] 📧 Email open detected for prospect ${touchpoint.prospect_id}`);
        detections.push({
          prospectId: touchpoint.prospect_id,
          campaignId: touchpoint.campaign_id,
          channel: 'email',
          eventType: 'open',
          detectedAt: openedAt,
          metadata: touchpoint.metadata,
        });

        // Mark as processed
        if (!this.dryRun) {
          await this.supabase
            .from('touchpoints')
            .update({ open_processed: true })
            .eq('id', touchpoint.id);
        }
      }
    }

    return detections;
  }

  // Log channel event to database
  private async logChannelEvent(detection: ReplyDetectionResult): Promise<void> {
    console.log(`[ReplyDetector] Logging ${detection.eventType} event for ${detection.prospectId}`);

    if (this.dryRun) {
      console.log(`[ReplyDetector] DRY_RUN: Would log event to channel_events table`);
      return;
    }

    const { error } = await this.supabase.from('channel_events').insert({
      prospect_id: detection.prospectId,
      campaign_id: detection.campaignId,
      channel: detection.channel,
      event_type: detection.eventType,
      detected_at: detection.detectedAt.toISOString(),
      metadata: detection.metadata || {},
    });

    if (error) {
      console.error('[ReplyDetector] Error logging channel event:', error.message);
    }
  }

  // Pause all active sequences for a prospect
  private async pauseAllSequencesForProspect(
    prospectId: string,
    campaignId: string,
    triggeredByChannel: Channel
  ): Promise<PauseAction[]> {
    console.log(`[ReplyDetector] Pausing all sequences for prospect ${prospectId}`);
    const pauses: PauseAction[] = [];

    if (this.dryRun) {
      console.log(`[ReplyDetector] DRY_RUN: Would pause sequences for ${prospectId}`);
      return [
        {
          sequenceId: 'dry-run-sequence-id',
          prospectId,
          campaignId,
          pausedReason: `Reply detected on ${triggeredByChannel}`,
          pausedByEvent: 'dry-run-event-id',
        },
      ];
    }

    // Get active sequences for this prospect
    const { data: sequences, error } = await this.supabase
      .from('sequences')
      .select('id')
      .eq('prospect_id', prospectId)
      .eq('status', 'active');

    if (error) {
      console.error('[ReplyDetector] Error fetching sequences:', error.message);
      return pauses;
    }

    // Get or create the channel event that triggered this
    const { data: eventData } = await this.supabase
      .from('channel_events')
      .select('id')
      .eq('prospect_id', prospectId)
      .eq('event_type', 'reply')
      .order('detected_at', { ascending: false })
      .limit(1)
      .single();

    const pausedByEvent = eventData?.id || null;

    // Pause each sequence
    for (const sequence of sequences || []) {
      const { error: updateError } = await this.supabase
        .from('sequences')
        .update({
          status: 'paused',
          paused_reason: `Reply detected on ${triggeredByChannel}`,
          paused_by_event: pausedByEvent,
          updated_at: new Date().toISOString(),
        })
        .eq('id', sequence.id);

      if (updateError) {
        console.error(`[ReplyDetector] Error pausing sequence ${sequence.id}:`, updateError.message);
      } else {
        pauses.push({
          sequenceId: sequence.id,
          prospectId,
          campaignId,
          pausedReason: `Reply detected on ${triggeredByChannel}`,
          pausedByEvent: pausedByEvent || '',
        });
        console.log(`[ReplyDetector] Paused sequence ${sequence.id}`);
      }
    }

    return pauses;
  }

  // Update prospect state
  private async updateProspectState(prospectId: string, newState: string): Promise<void> {
    console.log(`[ReplyDetector] Updating prospect ${prospectId} state to ${newState}`);

    if (this.dryRun) {
      console.log(`[ReplyDetector] DRY_RUN: Would update prospect state`);
      return;
    }

    const { error } = await this.supabase
      .from('prospects')
      .update({
        state: newState,
        updated_at: new Date().toISOString(),
      })
      .eq('id', prospectId);

    if (error) {
      console.error('[ReplyDetector] Error updating prospect state:', error.message);
    }
  }

  // Create alert message
  private createAlert(detection: ReplyDetectionResult): string {
    const channelEmoji = {
      email: '✉️',
      linkedin: '💼',
      x: '🐦',
      voice: '📞',
    };

    return `${channelEmoji[detection.channel]} PROSPECT REPLY: ${detection.prospectId} replied on ${detection.channel.toUpperCase()} at ${detection.detectedAt.toISOString()}. All sequences PAUSED.`;
  }

  // Check if a prospect has replied on any channel
  async hasProspectReplied(prospectId: string): Promise<boolean> {
    const { data: events, error } = await this.supabase
      .from('channel_events')
      .select('id')
      .eq('prospect_id', prospectId)
      .eq('event_type', 'reply')
      .limit(1);

    if (error) {
      console.error('[ReplyDetector] Error checking prospect replies:', error.message);
      return false;
    }

    return (events || []).length > 0;
  }

  // Get recent channel events for a prospect
  async getProspectEvents(
    prospectId: string,
    eventTypes?: string[]
  ): Promise<ChannelEvent[]> {
    let query = this.supabase
      .from('channel_events')
      .select('*')
      .eq('prospect_id', prospectId)
      .order('detected_at', { ascending: false });

    if (eventTypes && eventTypes.length > 0) {
      query = query.in('event_type', eventTypes);
    }

    const { data, error } = await query;

    if (error) {
      console.error('[ReplyDetector] Error fetching prospect events:', error.message);
      return [];
    }

    return (data || []) as ChannelEvent[];
  }
}

// Extend types for channel_events table
declare module '../types' {
  interface ChannelEvent {
    id: string;
    prospectId: string;
    campaignId: string;
    channel: Channel;
    eventType: string;
    detectedAt: Date;
    metadata?: Record<string, any>;
    createdAt: Date;
  }
}
