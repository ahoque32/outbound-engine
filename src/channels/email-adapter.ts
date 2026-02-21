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
  private validInboxes: Set<string> | null = null;
  private inboxValidationPromise: Promise<void> | null = null;

  constructor(apiKey?: string) {
    super();
    this.apiKey = apiKey || process.env.AGENTMAIL_API_KEY || '';
    if (!this.apiKey) {
      console.warn('[Email] WARNING: AGENTMAIL_API_KEY not set');
    }
  }
  
  /**
   * Validate inboxes on first use by fetching from AgentMail API
   */
  private async validateInboxes(): Promise<void> {
    // If already validated, return immediately
    if (this.validInboxes !== null) {
      return;
    }
    
    // If validation is in progress, wait for it
    if (this.inboxValidationPromise !== null) {
      return this.inboxValidationPromise;
    }
    
    // Start validation
    this.inboxValidationPromise = this.fetchValidInboxes();
    return this.inboxValidationPromise;
  }
  
  private async fetchValidInboxes(): Promise<void> {
    console.log('[Email] Fetching valid inboxes from AgentMail...');
    
    try {
      const response = await fetch('https://api.agentmail.to/v0/inboxes', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
      });
      
      if (!response.ok) {
        console.error(`[Email] Failed to fetch inboxes: ${response.status}`);
        // Fall back to allowing all configured inboxes
        this.validInboxes = new Set(SENDER_INBOXES);
        return;
      }
      
      const data: any = await response.json();
      const inboxes = data.inboxes || data.data || [];
      
      // Extract email addresses from the response
      const validEmails = inboxes.map((inbox: any) => inbox.email || inbox.id || inbox);
      this.validInboxes = new Set(validEmails);
      
      console.log(`[Email] Loaded ${this.validInboxes.size} valid inboxes from AgentMail`);
    } catch (err: any) {
      console.error('[Email] Error fetching inboxes:', err.message);
      // Fall back to allowing all configured inboxes
      this.validInboxes = new Set(SENDER_INBOXES);
    }
  }
  
  /**
   * Check if an inbox is valid (exists in AgentMail)
   */
  private isInboxValid(inboxEmail: string): boolean {
    if (this.validInboxes === null) {
      // Validation hasn't completed yet, allow by default
      return true;
    }
    return this.validInboxes.has(inboxEmail);
  }

  async send(prospect: Prospect, action: string, content?: string): Promise<TouchpointResult> {
    if (!this.validateProspect(prospect, ['email'])) {
      return { success: false, error: 'Email address required' };
    }

    if (!this.isValidEmail(prospect.email!)) {
      return { success: false, error: 'Invalid email format', outcome: 'bounced' };
    }

    // Validate inboxes on first use
    await this.validateInboxes();

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
    
    // Validate inbox exists
    if (!this.isInboxValid(inboxEmail)) {
      console.error(`[Email] Inbox ${inboxEmail} does not exist in AgentMail, skipping send`);
      return { success: false, error: `Invalid inbox: ${inboxEmail}`, outcome: 'failed' };
    }

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
    
    // Validate inboxes on first use
    await this.validateInboxes();

    const inboxEmail = fromInbox || this.pickInbox(prospect.email!);
    
    // Validate inbox exists
    if (!this.isInboxValid(inboxEmail)) {
      console.error(`[Email] Inbox ${inboxEmail} does not exist in AgentMail, skipping send`);
      return { success: false, error: `Invalid inbox: ${inboxEmail}`, outcome: 'failed' };
    }

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
    
    // Retry configuration
    const MAX_RETRIES = 3;
    const BASE_DELAY_MS = 1000;
    
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      console.log(`[Email] POST ${url} (attempt ${attempt}/${MAX_RETRIES})`);
      
      try {
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

        if (response.ok) {
          let data: any;
          try {
            data = JSON.parse(responseText);
          } catch {
            data = {};
          }
          return { success: true, messageId: data.id || data.message_id };
        }

        // Handle error cases
        const status = response.status;
        
        // 429: Rate limited - respect Retry-After header or wait 5s
        if (status === 429) {
          const retryAfter = response.headers.get('Retry-After');
          const delayMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : 5000;
          console.log(`[Email] Rate limited (429), waiting ${delayMs}ms before retry`);
          await this.sleep(delayMs);
          continue; // Retry
        }
        
        // 5xx: Server error - retry with exponential backoff
        if (status >= 500) {
          if (attempt < MAX_RETRIES) {
            const delayMs = BASE_DELAY_MS * Math.pow(3, attempt - 1); // 1s, 3s, 9s
            console.log(`[Email] Server error (${status}), waiting ${delayMs}ms before retry ${attempt + 1}`);
            await this.sleep(delayMs);
            continue; // Retry
          }
          return { success: false, error: `AgentMail ${status}: ${responseText} (max retries exceeded)` };
        }
        
        // 4xx (other than 429): Client error - don't retry
        if (status >= 400 && status < 500) {
          console.log(`[Email] Client error (${status}), not retrying`);
          return { success: false, error: `AgentMail ${status}: ${responseText}` };
        }
        
        // Other errors - don't retry
        return { success: false, error: `AgentMail ${status}: ${responseText}` };
        
      } catch (err: any) {
        console.error(`[Email] Network error on attempt ${attempt}:`, err.message);
        if (attempt < MAX_RETRIES) {
          const delayMs = BASE_DELAY_MS * Math.pow(3, attempt - 1);
          console.log(`[Email] Waiting ${delayMs}ms before retry ${attempt + 1}`);
          await this.sleep(delayMs);
        } else {
          return { success: false, error: `Network error: ${err.message} (max retries exceeded)` };
        }
      }
    }
    
    return { success: false, error: 'Max retries exceeded' };
  }
  
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
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
