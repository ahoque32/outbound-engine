import { Prospect, Touchpoint } from '../types';

export interface ToolError {
  message: string;
  code?: string;
  details?: Record<string, unknown>;
}

export interface CallResult {
  success: boolean;
  prospectId?: string;
  conversationId?: string;
  callSid?: string;
  status: 'initiated' | 'failed';
  agentVariant?: string;
  error?: ToolError;
}

export interface TranscriptResult {
  success: boolean;
  conversationId: string;
  transcript?: unknown;
  error?: ToolError;
}

export interface VoiceAgentVariant {
  id: string;
  agentId: string;
  name: string;
  voice?: string;
  personality?: string;
  llm?: string;
  style?: string;
  weight: number;
  enabled: boolean;
}

export interface EmailResult {
  success: boolean;
  prospectId: string;
  email?: string;
  campaignId?: string;
  outcome?: string;
  error?: ToolError;
}

export interface EmailStatus {
  success: boolean;
  prospectEmail: string;
  existsInInstantly: boolean;
  campaignId?: string;
  campaignName?: string;
  instantlyStatusCode?: number;
  instantlyStatusLabel?: string;
  delivered: boolean;
  opened: boolean;
  replied: boolean;
  bounced: boolean;
  lastEventType?: string;
  lastEventAt?: string;
  error?: ToolError;
}

export interface GHLContact {
  id: string;
  email?: string;
  phone?: string;
  firstName?: string;
  lastName?: string;
  name?: string;
  tags?: string[];
  [key: string]: unknown;
}

export interface GHLResult {
  success: boolean;
  prospectId: string;
  contactId?: string;
  pipelineStage?: string;
  warning?: string;
  error?: ToolError;
}

export interface DailyStats {
  date: string;
  callsMadeToday: number;
  emailsSentToday: number;
  outcomesBreakdown: Record<string, number>;
}

export interface GapEntry {
  prospect: Prospect;
  missingChannel: 'email' | 'voice';
  reason: string;
}

export interface GapReport {
  generatedAt: string;
  totalFound: number;
  limitedToDailyCapacity: number;
  remainingCapacity: {
    email: number;
    voice: number;
  };
  prospects: GapEntry[];
}

export interface DailySummary {
  date: string;
  callsMadeToday: number;
  emailsSentToday: number;
  touchpointsToday: number;
  outcomesBreakdown: Record<string, number>;
  channelGaps: GapReport;
}

export interface ToolParameterDefinition {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description: string;
  required?: boolean;
  enum?: string[];
  properties?: Record<string, ToolParameterDefinition>;
}

export interface ToolManifestEntry {
  functionName: string;
  description: string;
  parameters: Record<string, ToolParameterDefinition>;
  returnType: string;
}

export type ProspectHistory = Touchpoint[];
