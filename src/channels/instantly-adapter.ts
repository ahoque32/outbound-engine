// Instantly.ai Adapter
// Channel adapter for Instantly.ai email warmup, deliverability, and sending

import { BaseChannelAdapter } from './base-adapter';
import { Prospect, TouchpointResult, Channel } from '../types';
import {
  InstantlyAccount,
  WarmupAnalytics,
  VerificationResult,
  BackgroundJob,
  CampaignParams,
  Campaign,
  Lead,
  CampaignAnalytics,
} from './instantly-types';

const INSTANTLY_BASE_URL = 'https://api.instantly.ai/api/v2';
const DEFAULT_TIMEOUT_MS = 30000;

// Rate limiting configuration
const RATE_LIMIT = {
  maxRequestsPerSecond: 10,
  maxRequestsPerMinute: 100,
};

export class InstantlyAdapter extends BaseChannelAdapter {
  name: Channel = 'email';
  private apiKey: string;
  private requestTimestamps: number[] = [];
  private accountCache: Map<string, { account: InstantlyAccount; timestamp: number }> = new Map();
  private readonly CACHE_TTL_MS = 60000; // 1 minute cache

  constructor(apiKey?: string) {
    super();
    this.apiKey = apiKey || process.env.INSTANTLY_API_KEY || '';
    if (!this.apiKey) {
      console.warn('[Instantly] WARNING: INSTANTLY_API_KEY not set');
    }
  }

  // ==================== Rate Limiting ====================

  private async enforceRateLimit(): Promise<void> {
    const now = Date.now();
    
    // Clean up old timestamps (older than 1 minute)
    this.requestTimestamps = this.requestTimestamps.filter(
      ts => now - ts < 60000
    );

    // Check per-minute limit
    if (this.requestTimestamps.length >= RATE_LIMIT.maxRequestsPerMinute) {
      const oldestTimestamp = this.requestTimestamps[0];
      const waitMs = 60000 - (now - oldestTimestamp) + 100;
      console.log(`[Instantly] Rate limit (per minute) reached, waiting ${waitMs}ms`);
      await this.delay(waitMs);
      return this.enforceRateLimit();
    }

    // Check per-second limit
    const recentRequests = this.requestTimestamps.filter(
      ts => now - ts < 1000
    );
    if (recentRequests.length >= RATE_LIMIT.maxRequestsPerSecond) {
      const waitMs = 1000 - (now - recentRequests[0]) + 100;
      console.log(`[Instantly] Rate limit (per second) reached, waiting ${waitMs}ms`);
      await this.delay(waitMs);
      return this.enforceRateLimit();
    }

    this.requestTimestamps.push(now);
  }

  // ==================== HTTP Client ====================

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    await this.enforceRateLimit();

    const url = `${INSTANTLY_BASE_URL}${endpoint}`;
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      ...((options.headers as Record<string, string>) || {}),
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

    try {
      console.log(`[Instantly] ${options.method || 'GET'} ${endpoint}`);
      
      const response = await fetch(url, {
        ...options,
        headers,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const responseText = await response.text();
      
      if (!response.ok) {
        console.error(`[Instantly] HTTP ${response.status}: ${responseText}`);
        throw new Error(`Instantly API error: ${response.status} - ${responseText}`);
      }

      if (!responseText) {
        return {} as T;
      }

      return JSON.parse(responseText) as T;
    } catch (err: any) {
      if (err.name === 'AbortError') {
        throw new Error(`Instantly API request timeout after ${DEFAULT_TIMEOUT_MS}ms`);
      }
      throw err;
    }
  }

  // ==================== Account Management ====================

  async listAccounts(limit: number = 100): Promise<InstantlyAccount[]> {
    const response = await this.request<{ items?: InstantlyAccount[] }>(`/accounts?limit=${limit}`);
    return response.items || [];
  }

  async getAccount(email: string): Promise<InstantlyAccount | null> {
    // Check cache first
    const cached = this.accountCache.get(email);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL_MS) {
      return cached.account;
    }

    try {
      const accounts = await this.listAccounts();
      const account = accounts.find(a => a.email === email) || null;
      
      if (account) {
        this.accountCache.set(email, { account, timestamp: Date.now() });
      }
      
      return account;
    } catch (err: any) {
      console.error(`[Instantly] Failed to get account ${email}:`, err.message);
      return null;
    }
  }

  // ==================== Health Gate ====================

  /**
   * Check if an email account is healthy for sending
   * Requirements: warmup_score >= 80 AND status === 1 (Active)
   */
  async isHealthy(email: string): Promise<boolean> {
    const account = await this.getAccount(email);
    
    if (!account) {
      console.log(`[Instantly] Health check: ${email} - account not found`);
      return false;
    }

    const isActive = account.status === 1;
    const hasGoodScore = account.stat_warmup_score !== null && account.stat_warmup_score >= 80;

    const healthy = isActive && hasGoodScore;
    
    console.log(
      `[Instantly] Health check: ${email} - ` +
      `status=${account.status} (${isActive ? 'active' : 'inactive'}), ` +
      `score=${account.stat_warmup_score} (${hasGoodScore ? 'good' : 'poor'}) - ` +
      `${healthy ? '✅ HEALTHY' : '❌ UNHEALTHY'}`
    );

    return healthy;
  }

  /**
   * Get health status for multiple accounts
   */
  async getHealthStatus(emails: string[]): Promise<Record<string, {
    healthy: boolean;
    status: number;
    score: number | null;
    warmupStatus: number;
  }>> {
    const accounts = await this.listAccounts();
    const accountMap = new Map(accounts.map(a => [a.email, a]));

    const result: Record<string, {
      healthy: boolean;
      status: number;
      score: number | null;
      warmupStatus: number;
    }> = {};

    for (const email of emails) {
      const account = accountMap.get(email);
      if (account) {
        result[email] = {
          healthy: account.status === 1 && account.stat_warmup_score !== null && account.stat_warmup_score >= 80,
          status: account.status,
          score: account.stat_warmup_score,
          warmupStatus: account.warmup_status,
        };
      } else {
        result[email] = {
          healthy: false,
          status: 0,
          score: null,
          warmupStatus: 0,
        };
      }
    }

    return result;
  }

  // ==================== Warmup Management ====================

  async enableWarmup(emails: string[]): Promise<BackgroundJob> {
    return this.request<BackgroundJob>('/accounts/warmup/enable', {
      method: 'POST',
      body: JSON.stringify({ emails }),
    });
  }

  async disableWarmup(emails: string[]): Promise<BackgroundJob> {
    return this.request<BackgroundJob>('/accounts/warmup/disable', {
      method: 'POST',
      body: JSON.stringify({ emails }),
    });
  }

  async getWarmupAnalytics(emails: string[]): Promise<WarmupAnalytics> {
    return this.request<WarmupAnalytics>('/accounts/warmup-analytics', {
      method: 'POST',
      body: JSON.stringify({ emails }),
    });
  }

  // ==================== Email Verification ====================

  async verifyEmails(emails: string[]): Promise<VerificationResult[]> {
    const response = await this.request<{ results?: VerificationResult[] }>('/leads/verify', {
      method: 'POST',
      body: JSON.stringify({ emails }),
    });
    return response.results || [];
  }

  async verifyEmail(email: string): Promise<VerificationResult | null> {
    const results = await this.verifyEmails([email]);
    return results[0] || null;
  }

  // ==================== Campaign Management ====================

  async createCampaign(params: CampaignParams): Promise<Campaign> {
    return this.request<Campaign>('/campaigns', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }

  async listCampaigns(limit: number = 100): Promise<Campaign[]> {
    const response = await this.request<{ items?: Campaign[] }>(`/campaigns?limit=${limit}`);
    return response.items || [];
  }

  async getCampaign(campaignId: string): Promise<Campaign | null> {
    try {
      return await this.request<Campaign>(`/campaigns/${campaignId}`);
    } catch (err: any) {
      if (err.message?.includes('404')) {
        return null;
      }
      throw err;
    }
  }

  async addLeadsToCampaign(campaignId: string, leads: Lead[]): Promise<void> {
    await this.request<void>(`/campaigns/${campaignId}/leads`, {
      method: 'POST',
      body: JSON.stringify({ leads }),
    });
  }

  async getCampaignAnalytics(campaignId: string): Promise<CampaignAnalytics | null> {
    try {
      return await this.request<CampaignAnalytics>(`/campaigns/${campaignId}/analytics`);
    } catch (err: any) {
      if (err.message?.includes('404')) {
        return null;
      }
      throw err;
    }
  }

  // ==================== ChannelAdapter Interface ====================

  async send(prospect: Prospect, action: string, content?: string): Promise<TouchpointResult> {
    if (!this.validateProspect(prospect, ['email'])) {
      return { success: false, error: 'Email address required' };
    }

    if (!this.isValidEmail(prospect.email!)) {
      return { success: false, error: 'Invalid email format', outcome: 'bounced' };
    }

    // Note: For Instantly, we don't send directly - we add to campaign
    // The actual sending is handled by Instantly's infrastructure
    console.log(`[Instantly] Would add ${prospect.email} to campaign for ${action}`);
    
    return {
      success: true,
      outcome: 'queued',
      metadata: {
        timestamp: new Date().toISOString(),
        action,
        email: prospect.email,
        note: 'Use addLeadsToCampaign() to actually queue leads',
      },
    };
  }

  async checkStatus(prospect: Prospect): Promise<string> {
    return prospect.emailState || 'not_sent';
  }

  // ==================== Utilities ====================

  private isValidEmail(email: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  /**
   * Clear the account cache
   */
  clearCache(): void {
    this.accountCache.clear();
    console.log('[Instantly] Account cache cleared');
  }

  /**
   * Get all healthy sender emails from a list
   */
  async filterHealthyEmails(emails: string[]): Promise<string[]> {
    const healthStatus = await this.getHealthStatus(emails);
    return emails.filter(email => healthStatus[email]?.healthy);
  }

  /**
   * Get the best sender email (highest warmup score)
   */
  async getBestSender(emails: string[]): Promise<string | null> {
    const accounts = await this.listAccounts();
    const accountMap = new Map(accounts.map(a => [a.email, a]));

    let bestEmail: string | null = null;
    let bestScore = -1;

    for (const email of emails) {
      const account = accountMap.get(email);
      if (account && 
          account.status === 1 && 
          account.stat_warmup_score !== null &&
          account.stat_warmup_score > bestScore) {
        bestScore = account.stat_warmup_score;
        bestEmail = email;
      }
    }

    return bestEmail;
  }
}

// Singleton instance for reuse
let instantlyAdapterInstance: InstantlyAdapter | null = null;

export function getInstantlyAdapter(): InstantlyAdapter {
  if (!instantlyAdapterInstance) {
    instantlyAdapterInstance = new InstantlyAdapter();
  }
  return instantlyAdapterInstance;
}
