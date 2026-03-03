/**
 * Email Adapter — Instantly campaign-based delivery
 * 
 * Flow:
 * 1. Get healthy sender accounts from Instantly
 * 2. Find or create today's campaign (with sequence template + senders)
 * 3. Add prospect as lead to campaign
 * 4. Instantly handles sending, rotation, and delivery
 */

import { BaseChannelAdapter } from './base-adapter';
import { Prospect, TouchpointResult } from '../types';
import * as instantly from './instantly-adapter';

// Burner domains only — never send from renderwise.net
const SENDER_DOMAINS = ['growthsiteai.org', 'siteflowagency.org', 'nextwavedesigns.org'];
const MIN_WARMUP_SCORE = 80;

export class EmailAdapter extends BaseChannelAdapter {
  name = 'email' as const;
  private todayCampaignId: string | null = null;
  private todayDate: string | null = null;

  /**
   * Get today's date string in ET
   */
  private getDateET(): string {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  }

  /**
   * Get or create today's campaign with sequence and senders
   */
  private async ensureCampaign(): Promise<string> {
    const today = this.getDateET();
    
    // Cache hit
    if (this.todayCampaignId && this.todayDate === today) {
      return this.todayCampaignId;
    }

    const campaignName = `RenderWise Outbound - ${today}`;

    // Check for existing campaign
    const campaigns = await instantly.listCampaigns();
    const existing = campaigns.find(c => c.name === campaignName);
    
    if (existing) {
      this.todayCampaignId = existing.id;
      this.todayDate = today;
      
      // Activate if not already
      if (existing.status !== 1) {
        await instantly.activateCampaign(existing.id);
      }
      return existing.id;
    }

    // Get healthy senders
    const senders = await instantly.getHealthySenders(MIN_WARMUP_SCORE);
    const validSenders = senders.filter(s => SENDER_DOMAINS.some(d => s.endsWith('@' + d)));
    
    if (validSenders.length === 0) {
      throw new Error('No healthy sender accounts available');
    }

    // Create campaign with 3-step sequence
    const campaign = await instantly.createCampaign(
      campaignName,
      validSenders,
      [{
        steps: [
          {
            type: 'email',
            delay: 0,
            variants: [{
              subject: '{{first_name}}, quick question about your site',
              body: `<p>Hi {{first_name}},</p><p>I was checking out your website and noticed a few things that might be costing you leads — slow load times, mobile layout issues, and a few UX friction points.</p><p>We help businesses like yours turn their websites into actual revenue generators. Recently redesigned a similar site and increased their inbound leads by 40% in the first month.</p><p>Worth a quick chat? Here's my calendar: <a href="https://renderwiseai.com/calendar">renderwiseai.com/calendar</a></p><p>Best,<br>Jake<br>RenderWiseAI</p>`,
            }],
          },
          {
            type: 'email',
            delay: 3,
            variants: [{
              subject: 'Re: your site improvements',
              body: `<p>Hi {{first_name}},</p><p>Wanted to follow up on my note about your website.</p><p>I ran a quick audit and found 3 specific issues that are likely hurting your conversion rate:</p><p>• Slow mobile loading (losing ~30% of visitors)<br>• Confusing navigation flow<br>• No clear call-to-action above the fold</p><p>Happy to share the full audit — no cost, just thought it might be useful.</p><p>Book 15 mins here if you're curious: <a href="https://renderwiseai.com/calendar">renderwiseai.com/calendar</a></p><p>Jake<br>RenderWiseAI</p>`,
            }],
          },
          {
            type: 'email',
            delay: 3,
            variants: [{
              subject: 'Last note — your website',
              body: `<p>Hi {{first_name}},</p><p>I'll keep this short since I know you're busy.</p><p>If you're happy with how your site is performing, no worries at all — just wanted to make sure this didn't get buried.</p><p>If you ever want that free audit I mentioned, just reply and I'll send it over.</p><p>Either way, best of luck!</p><p>Jake<br>RenderWiseAI</p><p>P.S. — Still have a few spots open this week: <a href="https://renderwiseai.com/calendar">renderwiseai.com/calendar</a></p>`,
            }],
          },
        ],
      }]
    );

    await instantly.activateCampaign(campaign.id);
    this.todayCampaignId = campaign.id;
    this.todayDate = today;
    
    console.log(`[Email] Created campaign "${campaignName}" with ${validSenders.length} senders`);
    return campaign.id;
  }

  /**
   * Send a cold email by adding prospect to today's Instantly campaign
   */
  async sendColdEmail(
    prospect: Prospect,
    subject: string,
    body: string,
    _fromInbox?: string
  ): Promise<TouchpointResult> {
    if (!prospect.email) {
      return { success: false, error: 'Email address required' };
    }

    try {
      const campaignId = await this.ensureCampaign();
      
      const nameParts = (prospect.name || '').split(' ');
      const firstName = nameParts[0] || '';
      const lastName = nameParts.slice(1).join(' ') || '';

      await instantly.addLead(campaignId, prospect.email, {
        firstName,
        lastName,
        companyName: prospect.company,
        website: prospect.website,
        phone: prospect.phone,
      });

      console.log(`[Email] ✓ Queued ${prospect.email} in campaign ${campaignId}`);
      return {
        success: true,
        outcome: 'queued',
        metadata: {
          timestamp: new Date().toISOString(),
          action: 'cold_email',
          email: prospect.email,
          campaignId,
          subject,
        },
      };
    } catch (err: any) {
      console.error(`[Email] ✗ ${err.message}`);
      return { success: false, error: err.message, outcome: 'failed' };
    }
  }

  async sendFollowUp(prospect: Prospect, subject: string, body: string): Promise<TouchpointResult> {
    // Instantly handles follow-ups automatically via the sequence
    return { success: true, outcome: 'handled_by_instantly' };
  }

  async send(prospect: Prospect, action: string, content?: string): Promise<TouchpointResult> {
    return this.sendColdEmail(prospect, 'Quick question', content || '', undefined);
  }

  async checkStatus(prospect: Prospect): Promise<string> {
    return prospect.emailState || 'unknown';
  }
}

export default EmailAdapter;
