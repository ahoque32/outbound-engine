// Email Adapter (stub)
// Uses AgentMail or similar email service

import { BaseChannelAdapter } from './base-adapter';
import { Prospect, TouchpointResult } from '../types';

export class EmailAdapter extends BaseChannelAdapter {
  name = 'email' as const;

  async send(prospect: Prospect, action: string, content?: string): Promise<TouchpointResult> {
    if (!this.validateProspect(prospect, ['email'])) {
      return { success: false, error: 'Email address required' };
    }

    await this.randomDelay(500, 2000);

    console.log(`[Email] ${action} to ${prospect.name} <${prospect.email}>`);

    // Simulate email validation
    if (!this.isValidEmail(prospect.email!)) {
      return {
        success: false,
        error: 'Invalid email format',
        outcome: 'bounced'
      };
    }

    const success = Math.random() > 0.05; // 95% deliverability

    if (!success) {
      return {
        success: false,
        error: 'Email bounced or rejected',
        outcome: 'bounced'
      };
    }

    return {
      success: true,
      outcome: 'sent',
      metadata: {
        timestamp: new Date().toISOString(),
        action,
        email: prospect.email,
        subject: content?.substring(0, 50) + '...',
      }
    };
  }

  async checkStatus(prospect: Prospect): Promise<string> {
    // Would check email open/reply status via tracking pixel/webhook
    return prospect.emailState;
  }

  async sendColdEmail(prospect: Prospect, subject: string, body: string): Promise<TouchpointResult> {
    return this.send(prospect, 'cold_email', `${subject}\n\n${body}`);
  }

  async sendFollowUp(prospect: Prospect, subject: string, body: string): Promise<TouchpointResult> {
    return this.send(prospect, 'follow_up', `${subject}\n\n${body}`);
  }

  private isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }
}
