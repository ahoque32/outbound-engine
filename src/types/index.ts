// Core types for Outbound Engine

export type ProspectState = 
  | 'discovered' 
  | 'researched' 
  | 'contacted' 
  | 'engaged' 
  | 'qualified' 
  | 'booked' 
  | 'converted'
  | 'not_interested'
  | 'unresponsive';

export type LinkedInState = 
  | 'not_connected' 
  | 'requested' 
  | 'connected' 
  | 'messaged' 
  | 'replied';

export type XState = 
  | 'not_following' 
  | 'following' 
  | 'engaged' 
  | 'dm_sent' 
  | 'dm_replied';

export type EmailState = 
  | 'not_sent' 
  | 'sent' 
  | 'opened' 
  | 'replied' 
  | 'bounced';

export type VoiceState = 
  | 'not_called' 
  | 'called' 
  | 'answered' 
  | 'voicemail' 
  | 'booked';

export type Channel = 'linkedin' | 'x' | 'email' | 'voice';

// Call log row type (snake_case - matches Supabase schema)
export interface CallLogRow {
  id?: string;
  conversation_id: string;
  agent_variant?: string;
  agent_id_used?: string;
  status: string;
  duration_seconds?: number | null;
  outcome?: string;
  transcript?: string;
  analysis?: string;
  booking_made?: boolean;
  ghl_contact_id?: string;
  ghl_appointment_id?: string;
  booked_time?: string;
  notes?: string;
  completed_at?: string;
  created_at?: string;
}

// DB Row types (snake_case - matches Supabase schema)
export interface CampaignRow {
  id: string;
  name: string;
  client_id: string;
  icp_criteria: Record<string, any>;
  sequence_template: SequenceTemplate;
  status: 'active' | 'paused' | 'completed';
  daily_limits: DailyLimits;
  business_hours: BusinessHours;
  exclusion_list: string[];
  created_at: string;
  updated_at: string;
}

export interface ProspectRow {
  id: string;
  campaign_id: string;
  name: string;
  company?: string;
  title?: string;
  email?: string;
  phone?: string;
  linkedin_url?: string;
  x_handle?: string;
  website?: string;
  industry?: string;
  company_size?: string;
  location?: string;
  pipeline_state: ProspectState;
  state?: string; // geographic state (e.g. "Tennessee")
  linkedin_state: LinkedInState;
  x_state: XState;
  email_state: EmailState;
  voice_state: VoiceState;
  score: number;
  notes?: string;
  source?: string;
  last_touchpoint_at?: string;
  created_at: string;
  updated_at: string;
  // Email verification fields
  email_verification_status?: string;
  email_is_disposable?: boolean;
  email_verified_at?: string;
}

export interface TouchpointRow {
  id: string;
  prospect_id: string;
  campaign_id: string;
  channel: Channel;
  action: string;
  content?: string;
  outcome?: string;
  metadata?: Record<string, any>;
  sent_at: string;
  opened_at?: string;
  replied_at?: string;
  created_at: string;
}

export interface SequenceRow {
  id: string;
  prospect_id: string;
  campaign_id: string;
  template_id: string;
  current_step: number;
  next_step_at?: string;
  status: 'active' | 'paused' | 'completed' | 'cancelled';
  started_at: string;
  completed_at?: string;
  created_at: string;
  updated_at: string;
}

export interface RateLimitRow {
  id: string;
  campaign_id: string;
  channel: Channel;
  date: string;
  count: number;
  max_limit: number;
  created_at?: string;
  updated_at?: string;
}

// App types (camelCase - for internal use)
export interface Campaign {
  id: string;
  name: string;
  clientId: string;
  icpCriteria: Record<string, any>;
  sequenceTemplate: SequenceTemplate;
  status: 'active' | 'paused' | 'completed';
  dailyLimits: DailyLimits;
  businessHours: BusinessHours;
  exclusionList: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface DailyLimits {
  linkedin: number;
  x: number;
  email: number;
  voice: number;
}

export interface BusinessHours {
  start: string;
  end: string;
  timezone: string;
}

export interface Prospect {
  id: string;
  campaignId: string;
  name: string;
  company?: string;
  title?: string;
  email?: string;
  phone?: string;
  linkedinUrl?: string;
  xHandle?: string;
  website?: string;
  industry?: string;
  companySize?: string;
  location?: string;
  pipeline_state: ProspectState;
  state?: string; // geographic state
  linkedinState: LinkedInState;
  xState: XState;
  emailState: EmailState;
  voiceState: VoiceState;
  score: number;
  notes?: string;
  source?: string;
  lastTouchpointAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface Touchpoint {
  id: string;
  prospectId: string;
  campaignId: string;
  channel: Channel;
  action: string;
  content?: string;
  outcome?: string;
  metadata?: Record<string, any>;
  sentAt: Date;
  openedAt?: Date;
  repliedAt?: Date;
  createdAt: Date;
}

export interface Sequence {
  id: string;
  prospectId: string;
  campaignId: string;
  templateId: string;
  currentStep: number;
  nextStepAt?: Date;
  status: 'active' | 'paused' | 'completed' | 'cancelled';
  startedAt: Date;
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface SequenceTemplate {
  id: string;
  name: string;
  steps: SequenceStep[];
}

export interface SequenceStep {
  day: number;
  channel: Channel;
  action: string;
  template?: string;
  conditions?: StepCondition[];
}

export interface StepCondition {
  field: string;
  operator: 'eq' | 'neq' | 'gt' | 'lt' | 'contains';
  value: any;
}

export interface RateLimit {
  id: string;
  campaignId: string;
  channel: Channel;
  date: string;
  count: number;
  maxLimit: number;
}

export interface ChannelAdapter {
  name: Channel;
  send(prospect: Prospect, action: string, content?: string): Promise<TouchpointResult>;
  checkStatus(prospect: Prospect): Promise<string>;
}

export interface TouchpointResult {
  success: boolean;
  outcome?: string;
  error?: string;
  metadata?: Record<string, any>;
}

export interface StateTransition {
  from: ProspectState;
  to: ProspectState;
  condition?: (prospect: Prospect, touchpoints: Touchpoint[]) => boolean;
}

// Helper functions to convert between DB and App types
export function campaignFromRow(row: CampaignRow): Campaign {
  return {
    id: row.id,
    name: row.name,
    clientId: row.client_id,
    icpCriteria: row.icp_criteria,
    sequenceTemplate: row.sequence_template,
    status: row.status,
    dailyLimits: row.daily_limits,
    businessHours: row.business_hours,
    exclusionList: row.exclusion_list,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

export function prospectFromRow(row: ProspectRow): Prospect {
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
    pipeline_state: row.pipeline_state,
    state: row.state,
    linkedinState: row.linkedin_state,
    xState: row.x_state,
    emailState: row.email_state,
    voiceState: row.voice_state,
    score: row.score,
    notes: row.notes,
    source: row.source,
    lastTouchpointAt: row.last_touchpoint_at ? new Date(row.last_touchpoint_at) : undefined,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

export function touchpointFromRow(row: TouchpointRow): Touchpoint {
  return {
    id: row.id,
    prospectId: row.prospect_id,
    campaignId: row.campaign_id,
    channel: row.channel,
    action: row.action,
    content: row.content,
    outcome: row.outcome,
    metadata: row.metadata,
    sentAt: new Date(row.sent_at),
    openedAt: row.opened_at ? new Date(row.opened_at) : undefined,
    repliedAt: row.replied_at ? new Date(row.replied_at) : undefined,
    createdAt: new Date(row.created_at),
  };
}

export function sequenceFromRow(row: SequenceRow): Sequence {
  return {
    id: row.id,
    prospectId: row.prospect_id,
    campaignId: row.campaign_id,
    templateId: row.template_id,
    currentStep: row.current_step,
    nextStepAt: row.next_step_at ? new Date(row.next_step_at) : undefined,
    status: row.status,
    startedAt: new Date(row.started_at),
    completedAt: row.completed_at ? new Date(row.completed_at) : undefined,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

export function rateLimitFromRow(row: RateLimitRow): RateLimit {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    channel: row.channel,
    date: row.date,
    count: row.count,
    maxLimit: row.max_limit,
  };
}
