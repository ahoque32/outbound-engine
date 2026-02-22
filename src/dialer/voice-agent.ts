// Voice Agent - ElevenLabs Conversational AI + Twilio Native Integration
// ElevenLabs handles everything: LLM (Gemini Flash 2.5), TTS, and Twilio media bridge

import * as dotenv from 'dotenv';

dotenv.config();

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || '';
const ELEVENLABS_AGENT_ID = process.env.ELEVENLABS_AGENT_ID || 'agent_2401kj14s2xveagtqe97g6w7pbh3';
const ELEVENLABS_PHONE_NUMBER_ID = process.env.ELEVENLABS_PHONE_NUMBER_ID || 'phnum_1901kj1b9emsek6tsjef1gewr3tm';
const DRY_RUN = process.env.DRY_RUN === 'true';

// Legacy export for compatibility
export interface ElevenLabsAgentConfig {
  agentId?: string;
  voiceId?: string;
  modelId?: string;
  systemPrompt?: string;
  firstMessage?: string;
  language?: string;
}

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

export interface ConversationResult {
  success: boolean;
  transcript: ConversationMessage[];
  outcome?: 'interested' | 'not_interested' | 'callback' | 'email_requested' | 'booked' | 'no_answer';
  callbackTime?: Date;
  emailCaptured?: string;
  notes?: string;
  error?: string;
}

export interface OutboundCallResult {
  success: boolean;
  conversationId?: string;
  callSid?: string;
  error?: string;
}

export class VoiceAgent {
  private apiKey: string;
  private agentId: string;
  private phoneNumberId: string;
  private baseUrl = 'https://api.elevenlabs.io/v1';

  constructor(config: { apiKey?: string; agentId?: string; phoneNumberId?: string } = {}) {
    this.apiKey = config.apiKey || ELEVENLABS_API_KEY;
    this.agentId = config.agentId || ELEVENLABS_AGENT_ID;
    this.phoneNumberId = config.phoneNumberId || ELEVENLABS_PHONE_NUMBER_ID;

    if (!DRY_RUN && !this.apiKey) {
      console.warn('[VoiceAgent] ElevenLabs API key not set');
    }

    console.log('[VoiceAgent] Initialized — ElevenLabs native Twilio integration');
    console.log('[VoiceAgent] Agent:', this.agentId);
    console.log('[VoiceAgent] Phone:', this.phoneNumberId);
    console.log('[VoiceAgent] DRY_RUN:', DRY_RUN);
  }

  /**
   * Make an outbound call via ElevenLabs native Twilio integration
   * ElevenLabs handles: Twilio media bridge, STT, LLM (Gemini Flash), TTS
   */
  async makeOutboundCall(
    toNumber: string,
    options?: {
      agentIdOverride?: string;
      prospectData?: Record<string, string>;
    }
  ): Promise<OutboundCallResult> {
    const agentId = options?.agentIdOverride || this.agentId;
    console.log(`[VoiceAgent.makeOutboundCall] Calling ${toNumber} via ElevenLabs (agent: ${agentId})`);

    if (DRY_RUN) {
      console.log('[VoiceAgent.makeOutboundCall] DRY RUN — simulating call');
      return {
        success: true,
        conversationId: `dry_run_conv_${Date.now()}`,
        callSid: `dry_run_CA_${Date.now()}`,
      };
    }

    try {
      const body: any = {
        agent_id: agentId,
        agent_phone_number_id: this.phoneNumberId,
        to_number: toNumber,
      };

      // Pass prospect data as dynamic variables
      if (options?.prospectData) {
        body.conversation_initiation_client_data = {
          dynamic_variables: options.prospectData,
        };
      }

      const response = await fetch(`${this.baseUrl}/convai/twilio/outbound-call`, {
        method: 'POST',
        headers: {
          'xi-api-key': this.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[VoiceAgent.makeOutboundCall] API error:', response.status, errorText);
        throw new Error(`ElevenLabs outbound call error: ${response.status} - ${errorText}`);
      }

      const data = await response.json() as {
        success: boolean;
        message: string;
        conversation_id: string;
        callSid: string;
      };

      console.log('[VoiceAgent.makeOutboundCall] Call initiated:', data.conversation_id);
      return {
        success: true,
        conversationId: data.conversation_id,
        callSid: data.callSid,
      };
    } catch (error) {
      console.error('[VoiceAgent.makeOutboundCall] Error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Get conversation details/transcript from ElevenLabs
   */
  async getConversation(conversationId: string): Promise<any> {
    console.log(`[VoiceAgent.getConversation] Fetching: ${conversationId}`);

    try {
      const response = await fetch(`${this.baseUrl}/convai/conversations/${conversationId}`, {
        headers: { 'xi-api-key': this.apiKey },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch conversation: ${response.status}`);
      }

      return response.json();
    } catch (error) {
      console.error('[VoiceAgent.getConversation] Error:', error);
      return null;
    }
  }

  /**
   * Legacy compatibility: createConversationUrl
   * Now just returns the agent info since ElevenLabs handles everything
   */
  async createConversationUrl(prospectData: {
    firstName: string;
    company: string;
    observation?: string;
  }): Promise<{ success: boolean; url?: string; error?: string }> {
    console.log('[VoiceAgent.createConversationUrl] DEPRECATED — use makeOutboundCall instead');
    return {
      success: true,
      url: `elevenlabs://agent/${this.agentId}`,
    };
  }

  /**
   * Simulate a conversation (for DRY_RUN mode)
   */
  async simulateConversation(prospectData: {
    firstName: string;
    company: string;
  }): Promise<ConversationResult> {
    console.log('[VoiceAgent.simulateConversation] Simulating for:', prospectData.firstName);

    const outcomes: ConversationResult['outcome'][] = [
      'interested', 'not_interested', 'callback', 'email_requested', 'booked',
    ];
    const outcome = outcomes[Math.floor(Math.random() * outcomes.length)];

    return {
      success: true,
      transcript: [
        { role: 'assistant', content: `Hey there! This is Ava from RenderWise AI...`, timestamp: new Date() },
        { role: 'user', content: 'Tell me more about what you do.', timestamp: new Date(Date.now() + 5000) },
        { role: 'assistant', content: `So we help businesses like ${prospectData.company} capture more leads...`, timestamp: new Date(Date.now() + 10000) },
      ],
      outcome,
      notes: `DRY RUN simulation — outcome: ${outcome}`,
    };
  }

  /**
   * Generate TTS audio (legacy compat for voicemail)
   */
  async generateVoicemailAudio(text: string): Promise<{ success: boolean; audioUrl?: string; error?: string }> {
    return { success: true, audioUrl: 'elevenlabs://tts/generated' };
  }
}

export const voiceAgent = new VoiceAgent();
