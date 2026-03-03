// Email Adapter — Instantly campaign-based delivery with warmup health gate

import { BaseChannelAdapter } from './base-adapter';
import { Prospect, TouchpointResult } from '../types';
import { InstantlyAdapter } from './instantly-adapter';

// Available sender inboxes for rotation
const SENDER_INBOXES = [
  'jake@growthsiteai.org',
  'jake.mitchell@growthsiteai.org',
  'hello@growthsiteai.org',
  'alex.turner@siteflowagency.org',
  'hello@siteflowagency.org',
  'mike@nextwavedesigns.org',
];

// Minimum warmup score required to send emails
const MIN_WARMUP_SCORE = 80;
const CAMPAIGN_TIMEZONE = 'America/New_York';
const CAMPAIGN_NAME_PREFIX = 'RenderWise Outbound';
const MAX_RETRIES = 3;
const BASE_RETRY_DELAY_MS = 1000;

export class EmailAdapter extends BaseChannelAdapter {
  name = 'email' as const;
  private instantlyAdapter: InstantlyAdapter | null = null;
  private healthCheckCache: Map<string, { healthy: boolean; timestamp: number }> = new Map();
  private readonly HEALTH_CACHE_TTL_MS = 60000; // 1 minute cache
  private campaignCache: { date: string; campaignId: string } | null = null;

  constructor() {
    super();
    if (!process.env.INSTANTLY_API_KEY) {
      console.warn('[Email] WARNING: INSTANTLY_API_KEY not set');
    }
  }

  /**
   * Get or create Instantly adapter instance
   */
  private getInstantlyAdapter(): InstantlyAdapter {
    if (!this.instantlyAdapter) {
      this.instantlyAdapter = new InstantlyAdapter();
    }
    return this.instantlyAdapter;
  }

  private getCampaignDateEt(): string {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: CAMPAIGN_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date());

    const year = parts.find(part => part.type === 'year')?.value || '0000';
    const month = parts.find(part => part.type === 'month')?.value || '00';
    const day = parts.find(part => part.type === 'day')?.value || '00';

    return `${year}-${month}-${day}`;
  }

  private getCampaignName(dateEt: string): string {
    return `${CAMPAIGN_NAME_PREFIX} - ${dateEt}`;
  }

  private async withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await fn();
      } catch (err: any) {
        if (attempt >= MAX_RETRIES) {
          throw err;
        }

        const backoffMs = BASE_RETRY_DELAY_MS * Math.pow(3, attempt - 1);
        console.warn(`[Email] ${label} failed (attempt ${attempt}/${MAX_RETRIES}): ${err.message}. Retrying in ${backoffMs}ms`);
        await this.sleep(backoffMs);
      }
    }

    throw new Error(`${label} failed: max retries exceeded`);
  }

  /**
   * Check if sender domain is healthy via Instantly
   * Returns the first healthy inbox or null if none are healthy
   */
  private async getHealthyInbox(preferredInbox?: string): Promise<string | null> {
    const instantly = this.getInstantlyAdapter();
    const now = Date.now();

    // Check cache first for all inboxes
    const cachedHealthy: string[] = [];
    const needCheck: string[] = [];

    const inboxesToCheck = preferredInbox ? [preferredInbox] : SENDER_INBOXES;

    for (const inbox of inboxesToCheck) {
      const cached = this.healthCheckCache.get(inbox);
      if (cached && now - cached.timestamp < this.HEALTH_CACHE_TTL_MS) {
        if (cached.healthy) {
          cachedHealthy.push(inbox);
        }
      } else {
        needCheck.push(inbox);
      }
    }

    // Return cached healthy inbox if available
    if (cachedHealthy.length > 0) {
      return cachedHealthy[0];
    }

    // Check remaining inboxes via Instantly API
    if (needCheck.length > 0) {
      try {
        const healthStatus = await instantly.getHealthStatus(needCheck);

        for (const [email, status] of Object.entries(healthStatus)) {
          this.healthCheckCache.set(email, {
            healthy: status.healthy,
            timestamp: now,
          });

          if (status.healthy) {
            return email;
          }
        }
      } catch (err: any) {
        console.error('[Email] Health check failed:', err.message);
        // If health check fails, allow sending (fail open)
        return needCheck[0];
      }
    }

    return null;
  }

  /**
   * Check if any sender domain is healthy
   */
  async hasHealthyDomain(): Promise<boolean> {
    const healthyInbox = await this.getHealthyInbox();
    return healthyInbox !== null;
  }

  /**
   * Get health status summary for all sender inboxes
   */
  async getHealthSummary(): Promise<Record<string, { healthy: boolean; score: number | null }>> {
    const instantly = this.getInstantlyAdapter();
    return instantly.getHealthStatus(SENDER_INBOXES);
  }

  /**
   * Ensure a daily campaign exists, is active, and has healthy sender accounts mapped.
   */
  async ensureCampaign(preferredInbox?: string): Promise<{ campaignId: string; mappedAccounts: string[]; selectedInbox: string }> {
    const instantly = this.getInstantlyAdapter();
    const dateEt = this.getCampaignDateEt();
    const campaignName = this.getCampaignName(dateEt);

    // Keep sender rotation logic by prioritizing the rotated sender first.
    const rotatedInbox = preferredInbox || this.pickInbox(dateEt);

    let healthySenders = await instantly.filterHealthyEmails(SENDER_INBOXES);

    if (preferredInbox) {
      const preferredHealthy = await this.getHealthyInbox(preferredInbox);
      if (preferredHealthy && !healthySenders.includes(preferredHealthy)) {
        healthySenders.unshift(preferredHealthy);
      }
    }

    if (healthySenders.length === 0) {
      console.error(`[Email] ❌ Health gate blocked: No healthy sender domains available (warmup score < ${MIN_WARMUP_SCORE})`);
      throw new Error(`All sender domains unhealthy (warmup score < ${MIN_WARMUP_SCORE}). Email sequence paused.`);
    }

    // Place preferred/rotated sender first in mapping order.
    if (healthySenders.includes(rotatedInbox)) {
      healthySenders = [rotatedInbox, ...healthySenders.filter(e => e !== rotatedInbox)];
    }

    let campaignId = this.campaignCache?.date === dateEt ? this.campaignCache.campaignId : '';

    if (!campaignId) {
      const campaigns = await this.withRetry('list campaigns', () => instantly.listCampaigns(200));
      const existing = campaigns.find(c => c.name === campaignName);

      if (existing) {
        campaignId = existing.id;
      } else {
        const created = await this.withRetry('create campaign', () => instantly.createCampaign({
          name: campaignName,
          campaign_schedule: {
            schedules: [
              {
                name: 'Business Hours ET',
                timing: {
                  from: '09:00',
                  to: '17:00',
                },
                days: {
                  monday: true,
                  tuesday: true,
                  wednesday: true,
                  thursday: true,
                  friday: true,
                  saturday: false,
                  sunday: false,
                },
                timezone: CAMPAIGN_TIMEZONE,
              },
            ],
          },
        }));

        campaignId = created.id;
      }

      this.campaignCache = { date: dateEt, campaignId };
    }

    await this.withRetry('activate campaign', async () => {
      try {
        await instantly.activateCampaign(campaignId);
      } catch (err: any) {
        // Activation is idempotent in practice; ignore already-active responses.
        if (!String(err.message || '').toLowerCase().includes('already')) {
          throw err;
        }
      }
    });

    await this.withRetry('map accounts to campaign', () => instantly.mapAccountsToCampaign(campaignId, healthySenders));

    return {
      campaignId,
      mappedAccounts: healthySenders,
      selectedInbox: healthySenders[0],
    };
  }

  async send(prospect: Prospect, action: string, content?: string): Promise<TouchpointResult> {
    return this.queueSend(prospect, action, content);
  }

  private async queueSend(
    prospect: Prospect,
    action: string,
    content?: string,
    preferredInboxOverride?: string
  ): Promise<TouchpointResult> {
    if (!this.validateProspect(prospect, ['email'])) {
      return { success: false, error: 'Email address required' };
    }

    if (!this.isValidEmail(prospect.email!)) {
      return { success: false, error: 'Invalid email format', outcome: 'bounced' };
    }

    // Parse subject and body from content (format: "subject\n\nbody")
    let subject = 'Quick question';
    let body = content || '';
    if (content && content.includes('\n\n')) {
      const idx = content.indexOf('\n\n');
      subject = content.substring(0, idx);
      body = content.substring(idx + 2);
    }

    // Pick sender inbox (round-robin based on prospect email hash)
    const preferredInbox = preferredInboxOverride || this.pickInbox(prospect.email!);

    try {
      const { campaignId, selectedInbox } = await this.ensureCampaign(preferredInbox);

      const instantly = this.getInstantlyAdapter();
      await this.withRetry('create lead', () => instantly.createLead({
        email: prospect.email!,
        first_name: this.firstNameFromProspect(prospect),
        last_name: this.lastNameFromProspect(prospect),
        company_name: prospect.company,
        website: prospect.website,
        phone: prospect.phone,
        campaign: campaignId,
        personalization: {
          subject,
          body,
          action,
          preferred_sender: selectedInbox,
        },
      }));

      console.log(`[Email] ✓ Queued ${prospect.email} in Instantly campaign ${campaignId} (preferred sender: ${selectedInbox})`);
      return {
        success: true,
        outcome: 'queued',
        metadata: {
          timestamp: new Date().toISOString(),
          action,
          email: prospect.email,
          from: selectedInbox,
          subject,
          campaignId,
        },
      };
    } catch (err: any) {
      const message = err.message || 'Unknown Instantly delivery error';
      const outcome = message.includes('unhealthy') ? 'paused' : 'failed';
      console.error(`[Email] ✗ ${message}`);
      return { success: false, error: message, outcome };
    }
  }

  async checkStatus(prospect: Prospect): Promise<string> {
    return prospect.emailState;
  }

  async sendColdEmail(prospect: Prospect, subject: string, body: string, fromInbox?: string): Promise<TouchpointResult> {
    return this.sendWithInbox(prospect, 'cold_email', subject, body, fromInbox);
  }

  async sendFollowUp(prospect: Prospect, subject: string, body: string, fromInbox?: string): Promise<TouchpointResult> {
    return this.sendWithInbox(prospect, 'follow_up', subject, body, fromInbox);
  }

  private async sendWithInbox(
    prospect: Prospect,
    action: string,
    subject: string,
    body: string,
    fromInbox?: string
  ): Promise<TouchpointResult> {
    if (!this.validateProspect(prospect, ['email'])) {
      return { success: false, error: 'Email address required' };
    }

    if (prospect.email && !this.isValidEmail(prospect.email)) {
      return { success: false, error: 'Invalid email format', outcome: 'bounced' };
    }

    const content = `${subject}\n\n${body}`;

    if (fromInbox) {
      // Keep explicit sender override path: enforce health gate for this inbox.
      const healthyInbox = await this.getHealthyInbox(fromInbox);
      if (!healthyInbox) {
        return {
          success: false,
          error: `Requested inbox ${fromInbox} is unhealthy (warmup score < ${MIN_WARMUP_SCORE}).`,
          outcome: 'paused',
        };
      }
      if (healthyInbox !== fromInbox) {
        console.log(`[Email] Requested inbox ${fromInbox} unhealthy, using ${healthyInbox}`);
      }
    }

    return this.queueSend(prospect, action, content, fromInbox);
  }

  private firstNameFromProspect(prospect: Prospect): string | undefined {
    if (!prospect.name) return undefined;
    const [first] = prospect.name.trim().split(/\s+/);
    return first || undefined;
  }

  private lastNameFromProspect(prospect: Prospect): string | undefined {
    if (!prospect.name) return undefined;
    const parts = prospect.name.trim().split(/\s+/);
    if (parts.length < 2) return undefined;
    return parts.slice(1).join(' ');
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private pickInbox(prospectEmail: string): string {
    // Simple hash-based rotation for consistent sender per prospect
    let hash = 0;
    for (let i = 0; i < prospectEmail.length; i++) {
      hash = ((hash << 5) - hash) + prospectEmail.charCodeAt(i);
      hash |= 0;
    }
    return SENDER_INBOXES[Math.abs(hash) % SENDER_INBOXES.length];
  }

  private isValidEmail(email: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  static getSenderInboxes(): string[] {
    return [...SENDER_INBOXES];
  }
}
