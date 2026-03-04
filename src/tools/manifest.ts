import * as emailTools from './email';
import * as ghlTools from './ghl';
import * as prospectTools from './prospects';
import * as reportingTools from './reporting';
import * as voiceTools from './voice';
import { ToolManifestEntry } from './types';

/**
 * Runtime map of callable Hunter tool functions.
 */
export const hunterToolFunctions = {
  makeCall: voiceTools.makeCall,
  getTranscript: voiceTools.getTranscript,
  listVoiceAgents: voiceTools.listVoiceAgents,
  queueEmail: emailTools.queueEmail,
  getEmailStatus: emailTools.getEmailStatus,
  listHealthySenders: emailTools.listHealthySenders,
  getProspect: prospectTools.getProspect,
  listProspectsForOutreach: prospectTools.listProspectsForOutreach,
  updateProspect: prospectTools.updateProspect,
  getProspectHistory: prospectTools.getProspectHistory,
  getTodayStats: prospectTools.getTodayStats,
  pushToGHL: ghlTools.pushToGHL,
  getGHLContact: ghlTools.getGHLContact,
  generateDailySummary: reportingTools.generateDailySummary,
  getChannelGaps: reportingTools.getChannelGaps,
};

/**
 * Tool metadata used for generating OpenClaw skill definitions.
 */
export const hunterToolManifest: ToolManifestEntry[] = [
  {
    functionName: 'makeCall',
    description: 'Triggers an ElevenLabs + Twilio outbound call for a prospect by ID.',
    parameters: {
      prospectId: { type: 'string', description: 'Supabase prospect ID', required: true },
      agentVariant: { type: 'string', description: 'Optional voice variant ID from variants.json' },
    },
    returnType: 'Promise<CallResult>',
  },
  {
    functionName: 'getTranscript',
    description: 'Fetches raw conversation transcript payload from ElevenLabs.',
    parameters: {
      conversationId: { type: 'string', description: 'ElevenLabs conversation ID', required: true },
    },
    returnType: 'Promise<TranscriptResult>',
  },
  {
    functionName: 'listVoiceAgents',
    description: 'Lists available voice agent variants from variants.json.',
    parameters: {},
    returnType: 'Promise<VoiceAgentVariant[]>',
  },
  {
    functionName: 'queueEmail',
    description: "Queues a custom email to today's Instantly campaign for a prospect.",
    parameters: {
      prospectId: { type: 'string', description: 'Supabase prospect ID', required: true },
      subject: { type: 'string', description: 'Custom subject line written by the agent', required: true },
      body: { type: 'string', description: 'Custom body copy written by the agent', required: true },
    },
    returnType: 'Promise<EmailResult>',
  },
  {
    functionName: 'getEmailStatus',
    description: 'Reads Instantly lead status and webhook history for a recipient email.',
    parameters: {
      prospectEmail: { type: 'string', description: 'Prospect email address', required: true },
    },
    returnType: 'Promise<EmailStatus>',
  },
  {
    functionName: 'listHealthySenders',
    description: 'Lists healthy Instantly sender inboxes (warmup score >= 80).',
    parameters: {},
    returnType: 'Promise<string[]>',
  },
  {
    functionName: 'getProspect',
    description: 'Loads full prospect record from Supabase by ID.',
    parameters: {
      id: { type: 'string', description: 'Supabase prospect ID', required: true },
    },
    returnType: 'Promise<Prospect>',
  },
  {
    functionName: 'listProspectsForOutreach',
    description: 'Lists prospects due for outreach with optional missing-channel filter.',
    parameters: {
      options: {
        type: 'object',
        description: 'Outreach list options',
        properties: {
          limit: { type: 'number', description: 'Maximum number of prospects to return' },
          missingChannel: {
            type: 'string',
            description: 'Optional channel gap filter',
            enum: ['email', 'voice'],
          },
        },
      },
    },
    returnType: 'Promise<Prospect[]>',
  },
  {
    functionName: 'updateProspect',
    description: 'Updates prospect fields in Supabase.',
    parameters: {
      id: { type: 'string', description: 'Supabase prospect ID', required: true },
      updates: { type: 'object', description: 'Partial prospect updates', required: true },
    },
    returnType: 'Promise<void>',
  },
  {
    functionName: 'getProspectHistory',
    description: 'Returns all touchpoints for a prospect.',
    parameters: {
      id: { type: 'string', description: 'Supabase prospect ID', required: true },
    },
    returnType: 'Promise<Touchpoint[]>',
  },
  {
    functionName: 'getTodayStats',
    description: "Returns today's calls, emails, and outcomes summary.",
    parameters: {},
    returnType: 'Promise<DailyStats>',
  },
  {
    functionName: 'pushToGHL',
    description: 'Creates/updates GHL contact and tags pipeline stage.',
    parameters: {
      prospectId: { type: 'string', description: 'Supabase prospect ID', required: true },
      pipelineStage: { type: 'string', description: 'Optional pipeline stage label' },
    },
    returnType: 'Promise<GHLResult>',
  },
  {
    functionName: 'getGHLContact',
    description: 'Checks whether a GHL contact exists by email.',
    parameters: {
      email: { type: 'string', description: 'Email to search in GHL', required: true },
    },
    returnType: 'Promise<GHLContact | null>',
  },
  {
    functionName: 'generateDailySummary',
    description: "Aggregates today's activity and gap report from Supabase.",
    parameters: {},
    returnType: 'Promise<DailySummary>',
  },
  {
    functionName: 'getChannelGaps',
    description: 'Identifies prospects called-not-emailed or emailed-not-called.',
    parameters: {},
    returnType: 'Promise<GapReport>',
  },
];
