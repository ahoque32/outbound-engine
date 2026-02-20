// Email Adapter — AgentMail integration
// Sends real emails via AgentMail API and logs to Supabase

import { BaseChannelAdapter } from './base-adapter';
import { Prospect, TouchpointResult } from '../types';

interface AgentMailRecipient {
  email: string;
  name?: string;
}

interface AgentMailMessage {
  to: AgentMailRecipient[];
  subject: string;
  body: string;
}

// Available sender inboxes for rotation
const SENDER_INBOXES = [
  'jake@growthsiteai.org',
  'jake.mitchell@growthsiteai.org',
  'hello@growthsiteai.org',
  'alex.turner@siteflowagency.org',
  'hello@siteflowagency.org',
  'mike@nextwavedesigns.org',
  'mike.chen@nextwavedesigns.org',
  'hello@nextwavedesigns.org',
];

export class EmailAdapter extends BaseChannelAdapter {
  name = 'email' as const;
  private apiKey: string;

  constructor(apiKey?: string) {
    super();
    this.apiKey = apiKey || process.env.AGENTMAIL_API_KEY || '';
    if (!this.apiKey) {
      console.warn('[Email] WARNING: AGENTMAIL_API_KEY not set');
    }
  }

  async send(prospect: Prospect, action: string, content?: string): Promise<TouchpointResult> {
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
    const inboxEmail = this.pickInbox(prospect.email!);

    console.log(`[Email] Sending "${subject}" to ${prospect.name} <${prospect.email}> from ${inboxEmail}`);

    try {
      const result = await this.sendViaAgentMail(inboxEmail, {
        to: [{ email: prospect.email!, name: prospect.name || undefined }],
        subject,
        body,
      });

      if (result.success) {
        console.log(`[Email] ✓ Sent to ${prospect.email} via ${inboxEmail}`);
        return {
          success: true,
          outcome: 'sent',
          metadata: {
            timestamp: new Date().toISOString(),
            action,
            email: prospect.email,
            from: inboxEmail,
            subject,
            messageId: result.messageId,
          },
        };
      } else {
        console.error(`[Email] ✗ Failed: ${result.error}`);
        return { success: false, error: result.error, outcome: 'failed' };
      }
    } catch (err: any) {
      console.error(`[Email] ✗ Exception: ${err.message}`);
      return { success: false, error: err.message, outcome: 'failed' };
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

    const inboxEmail = fromInbox || this.pickInbox(prospect.email!);

    console.log(`[Email] ${action}: "${subject}" to ${prospect.name} <${prospect.email}> from ${inboxEmail}`);

    try {
      const result = await this.sendViaAgentMail(inboxEmail, {
        to: [{ email: prospect.email!, name: prospect.name || undefined }],
        subject,
        body,
      });

      if (result.success) {
        console.log(`[Email] ✓ ${action} sent to ${prospect.email}`);
        return {
          success: true,
          outcome: 'sent',
          metadata: {
            timestamp: new Date().toISOString(),
            action,
            email: prospect.email,
            from: inboxEmail,
            subject,
            messageId: result.messageId,
          },
        };
      } else {
        return { success: false, error: result.error, outcome: 'failed' };
      }
    } catch (err: any) {
      return { success: false, error: err.message, outcome: 'failed' };
    }
  }

  private async sendViaAgentMail(
    inboxEmail: string,
    message: AgentMailMessage
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    // First, resolve inbox ID from email
    const inboxId = await this.resolveInboxId(inboxEmail);
    if (!inboxId) {
      return { success: false, error: `Could not resolve inbox for ${inboxEmail}` };
    }

    const encodedInbox = encodeURIComponent(inboxId);
    const url = `https://api.agentmail.to/v0/inboxes/${encodedInbox}/messages/send`;
    console.log(`[Email] POST ${url}`);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to: message.to[0].email,
        subject: message.subject,
        text: message.body,
        html: message.body.replace(/\n/g, '<br>'),
      }),
    });

    const responseText = await response.text();
    console.log(`[Email] Response ${response.status}: ${responseText.substring(0, 200)}`);

    if (!response.ok) {
      return { success: false, error: `AgentMail ${response.status}: ${responseText}` };
    }

    let data: any;
    try {
      data = JSON.parse(responseText);
    } catch {
      data = {};
    }

    return { success: true, messageId: data.id || data.message_id };
  }

  private async resolveInboxId(email: string): Promise<string> {
    // AgentMail uses the email address itself as the inbox_id
    return email;
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
