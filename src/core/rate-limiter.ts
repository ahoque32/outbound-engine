// Rate Limiter
// Prevents hitting channel limits and manages daily quotas

import { Channel, Campaign, RateLimit } from '../types';

export interface RateLimitConfig {
  linkedin: { daily: number; hourly: number };
  x: { daily: number; hourly: number };
  email: { daily: number; hourly: number };
  voice: { daily: number; hourly: number };
}

export const DEFAULT_LIMITS: RateLimitConfig = {
  linkedin: { daily: 25, hourly: 5 },
  x: { daily: 100, hourly: 20 },
  email: { daily: 50, hourly: 10 },
  voice: { daily: 50, hourly: 10 },
};

export class RateLimiter {
  private config: RateLimitConfig;

  constructor(config: Partial<RateLimitConfig> = {}) {
    this.config = { ...DEFAULT_LIMITS, ...config };
  }

  // Check if action is allowed for a channel
  canExecute(channel: Channel, currentCount: number): { allowed: boolean; reason?: string } {
    const limits = this.config[channel];

    if (currentCount >= limits.daily) {
      return { allowed: false, reason: `Daily limit reached for ${channel}` };
    }

    // Check hourly limit (simplified - assumes count is for current hour)
    if (currentCount >= limits.hourly) {
      return { allowed: false, reason: `Hourly limit reached for ${channel}` };
    }

    return { allowed: true };
  }

  // Get remaining quota for a channel
  getRemaining(channel: Channel, currentCount: number): number {
    const limits = this.config[channel];
    return Math.max(0, limits.daily - currentCount);
  }

  // Get next reset time (start of next day)
  getNextResetTime(): Date {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    return tomorrow;
  }

  // Validate campaign limits against defaults
  static validateCampaignLimits(campaign: Campaign): { valid: boolean; warnings: string[] } {
    const warnings: string[] = [];
    const limits = campaign.dailyLimits;

    if (limits.linkedin > DEFAULT_LIMITS.linkedin.daily) {
      warnings.push(`LinkedIn limit (${limits.linkedin}) exceeds safe default (${DEFAULT_LIMITS.linkedin.daily})`);
    }
    if (limits.x > DEFAULT_LIMITS.x.daily) {
      warnings.push(`X limit (${limits.x}) exceeds safe default (${DEFAULT_LIMITS.x.daily})`);
    }
    if (limits.email > DEFAULT_LIMITS.email.daily) {
      warnings.push(`Email limit (${limits.email}) exceeds safe default (${DEFAULT_LIMITS.email.daily})`);
    }
    if (limits.voice > DEFAULT_LIMITS.voice.daily) {
      warnings.push(`Voice limit (${limits.voice}) exceeds safe default (${DEFAULT_LIMITS.voice.daily})`);
    }

    return { valid: warnings.length === 0, warnings };
  }

  // Check if prospect has been contacted on any channel today
  static hasBeenContactedToday(touchpoints: { sentAt: Date; channel: Channel }[]): boolean {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return touchpoints.some(t => {
      const sentDate = new Date(t.sentAt);
      sentDate.setHours(0, 0, 0, 0);
      return sentDate.getTime() === today.getTime();
    });
  }

  // Get channel priority for multi-channel coordination
  // Lower number = higher priority
  static getChannelPriority(channel: Channel): number {
    const priorities: Record<Channel, number> = {
      'x': 1,        // Lowest friction
      'linkedin': 2, // Professional
      'email': 3,    // Direct
      'voice': 4,    // Highest friction
    };
    return priorities[channel];
  }

  // Sort channels by priority (lowest first)
  static sortByPriority(channels: Channel[]): Channel[] {
    return [...channels].sort((a, b) => 
      RateLimiter.getChannelPriority(a) - RateLimiter.getChannelPriority(b)
    );
  }
}
