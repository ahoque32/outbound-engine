// Instantly.ai Types
// Type definitions for Instantly API responses

export interface InstantlyAccount {
  email: string;
  status: number;          // 1=Active, 2=Paused, -1=ConnError, -2=SoftBounce, -3=SendError
  warmup_status: number;   // 0=Paused, 1=Active, -1=Banned, -2=SpamUnknown, -3=PermSuspend
  stat_warmup_score: number | null;
  daily_limit: number | null;
  sending_gap: number;
  provider_code: number;   // 1=Custom, 2=Google, 3=Microsoft, 4=AWS, 8=AirMail
  first_name: string;
  last_name: string;
  warmup: {
    limit: number;
    reply_rate: number;
    increment: string;
    warmup_custom_ftag: string;
    advanced: object;
  };
}

export interface WarmupAnalytics {
  email_date_data: Record<string, Record<string, {
    sent: number;
    landed_inbox: number;
    landed_spam: number;
    received: number;
  }>>;
  aggregate_data: Record<string, {
    sent: number;
    landed_inbox: number;
    landed_spam: number;
    received: number;
    health_score_label: string;
    health_score: number;
  }>;
}

export interface VerificationResult {
  email: string;
  status: 'valid' | 'invalid' | 'catch-all' | 'unknown';
  disposable: boolean;
}

export interface BackgroundJob {
  id: string;
  type: string;
  status: 'pending' | 'in-progress' | 'success' | 'failed';
  progress: number;
}

export interface CampaignParams {
  name: string;
  description?: string;
  daily_limit?: number;
  sending_gap?: number;
  track_opens?: boolean;
  track_clicks?: boolean;
}

export interface Campaign {
  id: string;
  name: string;
  description?: string;
  status: 'active' | 'paused' | 'completed';
  daily_limit: number;
  sending_gap: number;
  track_opens: boolean;
  track_clicks: boolean;
  created_at: string;
  updated_at: string;
}

export interface Lead {
  email: string;
  first_name?: string;
  last_name?: string;
  company?: string;
  title?: string;
  phone?: string;
  website?: string;
  custom_fields?: Record<string, string>;
}

export interface CampaignAnalytics {
  campaign_id: string;
  total_leads: number;
  sent: number;
  opened: number;
  clicked: number;
  replied: number;
  bounced: number;
  unsubscribed: number;
  open_rate: number;
  click_rate: number;
  reply_rate: number;
  bounce_rate: number;
}

export interface InstantlyApiResponse<T> {
  items?: T[];
  data?: T;
  success?: boolean;
  error?: string;
}

// Provider code mapping
export const PROVIDER_CODES: Record<number, string> = {
  1: 'Custom',
  2: 'Google',
  3: 'Microsoft',
  4: 'AWS',
  8: 'AirMail',
};

// Account status mapping
export const ACCOUNT_STATUS: Record<number, string> = {
  1: 'Active',
  2: 'Paused',
  [-1]: 'ConnError',
  [-2]: 'SoftBounce',
  [-3]: 'SendError',
};

// Warmup status mapping
export const WARMUP_STATUS: Record<number, string> = {
  0: 'Paused',
  1: 'Active',
  [-1]: 'Banned',
  [-2]: 'SpamUnknown',
  [-3]: 'PermSuspend',
};
