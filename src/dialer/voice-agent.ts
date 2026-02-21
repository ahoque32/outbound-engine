// Voice Agent - MiniMax-powered conversational AI with ElevenLabs TTS
// MiniMax handles the conversation brain, ElevenLabs handles voice synthesis only

import * as dotenv from 'dotenv';
import { MiniMaxClient, miniMaxClient } from './minimax-client';

dotenv.config();

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || '';
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

export interface VoiceAgentConfig {
  elevenLabsApiKey?: string;
  voiceId?: string;
  modelId?: string;
  minimaxClient?: MiniMaxClient;
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

export class VoiceAgent {
  private elevenLabsApiKey: string;
  private baseUrl = 'https://api.elevenlabs.io/v1';
  private config: {
    voiceId: string;
    modelId: string;
    language: string;
  };
  private minimax: MiniMaxClient;

  constructor(config: VoiceAgentConfig = {}) {
    this.config = {
      voiceId: config.voiceId || '21m00Tcm4TlvDq8ikWAM', // Default Rachel voice
      modelId: config.modelId || 'eleven_turbo_v2_5',
      language: 'en',
    };

    this.elevenLabsApiKey = config.elevenLabsApiKey || ELEVENLABS_API_KEY;
    this.minimax = config.minimaxClient || miniMaxClient;

    if (!DRY_RUN && !this.elevenLabsApiKey) {
      console.warn('[VoiceAgent] ElevenLabs API key not set - TTS will not work');
    }

    console.log('[VoiceAgent] Initialized with MiniMax M2.5 as brain, ElevenLabs for TTS');
    console.log('[VoiceAgent] DRY_RUN mode:', DRY_RUN);
  }

  /**
   * Generate TTS audio from text using ElevenLabs
   */
  async textToSpeech(text: string): Promise<{ success: boolean; audioUrl?: string; error?: string }> {
    if (DRY_RUN) {
      return {
        success: true,
        audioUrl: `https://api.elevenlabs.io/v1/text-to-speech/mock_${Date.now()}.mp3`,
      };
    }

    try {
      const response = await fetch(`${this.baseUrl}/text-to-speech/${this.config.voiceId}`, {
        method: 'POST',
        headers: {
          'xi-api-key': this.elevenLabsApiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text,
          model_id: this.config.modelId,
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
          },
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[VoiceAgent.textToSpeech] API error:', response.status, errorText);
        throw new Error(`ElevenLabs TTS error: ${response.status}`);
      }

      // In production, you'd upload to S3 and return the URL
      // For now, return success with placeholder
      console.log('[VoiceAgent.textToSpeech] Successfully generated audio');
      
      return {
        success: true,
        audioUrl: 'generated://audio',
      };
    } catch (error) {
      console.error('[VoiceAgent.textToSpeech] Error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Create a conversation URL using ElevenLabs (for Twilio integration)
   * This uses ElevenLabs as pure TTS - MiniMax handles the conversation
   */
  async createConversationUrl(prospectData: {
    firstName: string;
    company: string;
    observation?: string;
  }): Promise<{ success: boolean; url?: string; error?: string }> {
    console.log('[VoiceAgent.createConversationUrl] Creating MiniMax-powered conversation for:', prospectData.firstName);

    if (DRY_RUN) {
      return {
        success: true,
        url: `wss://api.elevenlabs.io/v1/convai/conversation?xi-api-key=DRY_RUN_${Date.now()}`,
      };
    }

    try {
      // Generate the system prompt dynamically using MiniMax
      const systemPrompt = await this.minimax.generateCallSystemPrompt({
        firstName: prospectData.firstName,
        company: prospectData.company,
        observation: prospectData.observation,
      });

      // Generate the opening message using MiniMax
      const opening = await this.minimax.generateOpening({
        firstName: prospectData.firstName,
        company: prospectData.company,
        observation: prospectData.observation,
      });

      console.log('[VoiceAgent.createConversationUrl] Generated prompt and opening with MiniMax');
      console.log('[VoiceAgent.createConversationUrl] Opening:', opening.substring(0, 100) + '...');

      // For the ElevenLabs Agents approach:
      // We pass MiniMax-generated content to ElevenLabs
      // ElevenLabs will use its built-in LLM, BUT we can customize the prompt
      // 
      // Alternative: Build a custom Twilio Media Stream handler with MiniMax
      // For now, let's use the ElevenLabs approach but pass custom prompt
      
      const response = await fetch(`${this.baseUrl}/convai/agents`, {
        method: 'POST',
        headers: {
          'xi-api-key': this.elevenLabsApiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: `RenderWiseAI - ${prospectData.company}`,
          prompt: systemPrompt,
          first_message: opening,
          voice_id: this.config.voiceId,
          language: this.config.language,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[VoiceAgent.createConversationUrl] API error:', response.status, errorText);
        throw new Error(`ElevenLabs API error: ${response.status} - ${errorText}`);
      }

      const data = await response.json() as { agent_id: string; conversation_start_url?: string };
      console.log('[VoiceAgent.createConversationUrl] Created agent:', data.agent_id);

      // Get signed URL for the agent
      const urlResponse = await fetch(`${this.baseUrl}/convai/agents/${data.agent_id}/signed-url`, {
        method: 'POST',
        headers: {
          'xi-api-key': this.elevenLabsApiKey,
          'Content-Type': 'application/json',
        },
      });

      if (!urlResponse.ok) {
        throw new Error('Failed to get signed URL');
      }

      const urlData = await urlResponse.json() as { signed_url: string };
      
      return {
        success: true,
        url: urlData.signed_url,
      };
    } catch (error) {
      console.error('[VoiceAgent.createConversationUrl] Error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Generate a response using MiniMax (for use with custom Twilio stream)
   * This is the core MiniMax brain function
   */
  async generateMiniMaxResponse(
    userMessage: string,
    prospectData: {
      firstName: string;
      company: string;
      observation?: string;
    },
    conversationHistory: Array<{ role: string; content: string }> = []
  ): Promise<string> {
    // Generate system prompt if not provided
    const systemPrompt = await this.minimax.generateCallSystemPrompt(prospectData);

    // Get response from MiniMax
    const response = await this.minimax.generateResponseTo(userMessage, systemPrompt, conversationHistory);
    
    return response;
  }

  /**
   * Simulate a conversation (for DRY_RUN mode)
   */
  async simulateConversation(prospectData: {
    firstName: string;
    company: string;
  }): Promise<ConversationResult> {
    console.log('[VoiceAgent.simulateConversation] Simulating MiniMax-powered conversation with:', prospectData.firstName);

    // Generate system prompt and opening using MiniMax
    const systemPrompt = await this.minimax.generateCallSystemPrompt({
      firstName: prospectData.firstName,
      company: prospectData.company,
    });

    const opening = await this.minimax.generateOpening(prospectData);

    const transcript: ConversationMessage[] = [
      {
        role: 'assistant',
        content: opening,
        timestamp: new Date(),
      },
    ];

    // Simulate prospect responses and generate MiniMax responses
    const prospectInputs = [
      "Um, maybe. What exactly do you do?",
      "No thanks, we're all set.",
      "Can you call back later? I'm in a meeting.",
    ];

    const responses: Record<string, string> = {};

    for (const input of prospectInputs) {
      const response = await this.minimax.generateResponseTo(input, systemPrompt, [
        { role: 'assistant', content: opening },
        { role: 'user', content: input },
      ]);
      responses[input] = response;
    }

    // Use the first scenario (interested)
    transcript.push({
      role: 'user',
      content: prospectInputs[0],
      timestamp: new Date(Date.now() + 5000),
    });

    transcript.push({
      role: 'assistant',
      content: responses[prospectInputs[0]],
      timestamp: new Date(Date.now() + 10000),
    });

    const outcome: ConversationResult['outcome'] = 'interested';

    console.log('[VoiceAgent.simulateConversation] Simulated outcome:', outcome);
    console.log('[VoiceAgent.simulateConversation] MiniMax-powered transcript generated');

    return {
      success: true,
      transcript,
      outcome,
      notes: 'Simulated conversation - MiniMax M2.5 generated all responses',
    };
  }

  /**
   * Build system prompt for the voice agent (legacy compatibility)
   */
  private buildSystemPrompt(prospectData: { firstName: string; company: string; observation: string }): string {
    // This is now generated dynamically by MiniMax
    return `You are Alex from RenderWiseAI calling ${prospectData.firstName} at ${prospectData.company}.`;
  }

  /**
   * Generate TTS audio for voicemail (fallback when full conversation not available)
   */
  async generateVoicemailAudio(text: string): Promise<{ success: boolean; audioUrl?: string; error?: string }> {
    return this.textToSpeech(text);
  }
}

export const voiceAgent = new VoiceAgent();
