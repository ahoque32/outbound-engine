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
  state: ProspectState;
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
  limit: number;
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
