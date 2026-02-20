// Voice Agent - ElevenLabs Conversational AI Integration
import * as dotenv from 'dotenv';

dotenv.config();

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || '';
const DRY_RUN = process.env.DRY_RUN === 'true';

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

export class VoiceAgent {
  private apiKey: string;
  private baseUrl = 'https://api.elevenlabs.io/v1';
  private config: ElevenLabsAgentConfig;

  constructor(config: ElevenLabsAgentConfig = {}) {
    this.config = {
      voiceId: '21m00Tcm4TlvDq8ikWAM', // Default voice (Rachel)
      modelId: 'eleven_turbo_v2_5',
      language: 'en',
      ...config,
    };

    if (!DRY_RUN && !ELEVENLABS_API_KEY) {
      throw new Error('ElevenLabs API key not configured. Set ELEVENLABS_API_KEY in .env');
    }

    this.apiKey = ELEVENLABS_API_KEY;
    console.log('[VoiceAgent] Initialized with voice:', this.config.voiceId);
    console.log('[VoiceAgent] DRY_RUN mode:', DRY_RUN);
  }

  /**
   * Create a signed WebSocket URL for real-time conversation
   * This URL is used with Twilio's <Stream> to connect the call
   */
  async createConversationUrl(prospectData: {
    firstName: string;
    company: string;
    observation: string;
  }): Promise<{ success: boolean; url?: string; error?: string }> {
    console.log('[VoiceAgent.createConversationUrl] Creating conversation URL for:', prospectData.firstName);

    if (DRY_RUN) {
      console.log('[VoiceAgent.createConversationUrl] DRY RUN - Returning mock URL');
      return {
        success: true,
        url: `wss://api.elevenlabs.io/v1/convai/conversation?xi-api-key=DRY_RUN_${Date.now()}`,
      };
    }

    try {
      // Check if we have a pre-configured agent ID
      if (this.config.agentId) {
        console.log('[VoiceAgent.createConversationUrl] Using pre-configured agent:', this.config.agentId);
        
        // Get a signed URL for the agent
        const response = await fetch(`${this.baseUrl}/convai/agents/${this.config.agentId}/signed-url`, {
          method: 'POST',
          headers: {
            'xi-api-key': this.apiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            dynamic_variables: {
              first_name: prospectData.firstName,
              company: prospectData.company,
              observation: prospectData.observation,
            },
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error('[VoiceAgent.createConversationUrl] API error:', response.status, errorText);
          throw new Error(`ElevenLabs API error: ${response.status} - ${errorText}`);
        }

        const data = await response.json() as { signed_url: string };
        console.log('[VoiceAgent.createConversationUrl] Successfully created signed URL');
        
        return {
          success: true,
          url: data.signed_url,
        };
      }

      // Fallback: Create a temporary conversation session
      console.log('[VoiceAgent.createConversationUrl] Creating temporary conversation session');
      
      const response = await fetch(`${this.baseUrl}/convai/conversation`, {
        method: 'POST',
        headers: {
          'xi-api-key': this.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          agent: {
            prompt: this.buildSystemPrompt(prospectData),
            first_message: this.buildFirstMessage(prospectData),
            voice_id: this.config.voiceId,
            language: this.config.language,
          },
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[VoiceAgent.createConversationUrl] API error:', response.status, errorText);
        throw new Error(`ElevenLabs API error: ${response.status} - ${errorText}`);
      }

      const data = await response.json() as { conversation_url: string };
      console.log('[VoiceAgent.createConversationUrl] Successfully created conversation session');
      
      return {
        success: true,
        url: data.conversation_url,
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
   * Simulate a conversation (for DRY_RUN mode)
   */
  async simulateConversation(prospectData: {
    firstName: string;
    company: string;
  }): Promise<ConversationResult> {
    console.log('[VoiceAgent.simulateConversation] Simulating conversation with:', prospectData.firstName);

    const outcomes: Array<'interested' | 'not_interested' | 'callback' | 'email_requested' | 'booked'> = [
      'interested',
      'not_interested',
      'callback',
      'email_requested',
      'booked',
    ];
    
    const outcome = outcomes[Math.floor(Math.random() * outcomes.length)];
    
    const transcript: ConversationMessage[] = [
      {
        role: 'assistant',
        content: `Hi ${prospectData.firstName}, this is Alex calling from RenderWiseAI. I took a look at ${prospectData.company}'s website and noticed it could use some modernization. We help businesses like yours add AI-powered customer follow-up. Are you currently looking to update your website?`,
        timestamp: new Date(),
      },
      {
        role: 'user',
        content: 'Um, maybe. What exactly do you do?',
        timestamp: new Date(Date.now() + 5000),
      },
      {
        role: 'assistant',
        content: "We build modern websites with AI chatbots that follow up with every visitor. We've helped similar businesses increase lead conversion by 40%. Would you be open to a quick 15-minute call to see what this could look like?",
        timestamp: new Date(Date.now() + 15000),
      },
    ];

    // Add outcome-specific messages
    switch (outcome) {
      case 'interested':
        transcript.push(
          {
            role: 'user',
            content: "That sounds interesting actually. When could we chat?",
            timestamp: new Date(Date.now() + 25000),
          },
          {
            role: 'assistant',
            content: 'Great! I can have our founder reach out this week. What day works best for you?',
            timestamp: new Date(Date.now() + 30000),
          }
        );
        break;
      case 'not_interested':
        transcript.push(
          {
            role: 'user',
            content: "No thanks, we're all set.",
            timestamp: new Date(Date.now() + 25000),
          },
          {
            role: 'assistant',
            content: "Totally understand. Just out of curiosity, are you happy with how your website converts visitors right now? No pressure at all, I'll let you go. Have a great day!",
            timestamp: new Date(Date.now() + 30000),
          }
        );
        break;
      case 'callback':
        transcript.push(
          {
            role: 'user',
            content: "Can you call back later? I'm in a meeting.",
            timestamp: new Date(Date.now() + 25000),
          },
          {
            role: 'assistant',
            content: 'No problem! When would be a better time? I can call back this afternoon or tomorrow.',
            timestamp: new Date(Date.now() + 30000),
          }
        );
        break;
      case 'email_requested':
        transcript.push(
          {
            role: 'user',
            content: 'Can you send me an email with more info?',
            timestamp: new Date(Date.now() + 25000),
          },
          {
            role: 'assistant',
            content: 'Absolutely! What is the best email address to send that to?',
            timestamp: new Date(Date.now() + 30000),
          }
        );
        break;
      case 'booked':
        transcript.push(
          {
            role: 'user',
            content: "Sure, let's do Tuesday at 2pm.",
            timestamp: new Date(Date.now() + 25000),
          },
          {
            role: 'assistant',
            content: 'Perfect! Tuesday at 2pm works. I will send you a calendar invite shortly. Looking forward to chatting!',
            timestamp: new Date(Date.now() + 30000),
          }
        );
        break;
    }

    console.log('[VoiceAgent.simulateConversation] Simulated outcome:', outcome);
    console.log('[VoiceAgent.simulateConversation] Transcript length:', transcript.length, 'messages');

    return {
      success: true,
      transcript,
      outcome,
      callbackTime: outcome === 'callback' ? new Date(Date.now() + 24 * 60 * 60 * 1000) : undefined,
      emailCaptured: outcome === 'email_requested' ? 'prospect@example.com' : undefined,
      notes: `Simulated conversation - prospect showed ${outcome} interest`,
    };
  }

  /**
   * Build system prompt for the voice agent
   */
  private buildSystemPrompt(prospectData: { firstName: string; company: string; observation: string }): string {
    return `You are Alex, a friendly sales representative from RenderWiseAI, a company that helps small businesses modernize their websites and add AI-powered customer follow-up.

You are calling ${prospectData.firstName} from ${prospectData.company}. You noticed: ${prospectData.observation}

CONVERSATION FLOW:
1. INTRO (5s): "Hi ${prospectData.firstName}, this is Alex calling from RenderWiseAI."
2. HOOK (10s): Mention what you noticed about their website
3. QUALIFY (15s): Ask if they're looking to update their website or improve lead handling
4. PITCH (15s): Explain we help businesses increase lead conversion by 40%
5. BOOK (10s): Try to schedule a 15-minute call with our founder

OBJECTION HANDLING:
- "Not interested" → Ask if they're happy with current website conversion, then let them go politely
- "How much?" → Basic website starts around $500, AI assistant is monthly. Offer the 15-min call for specifics
- "Send email" → Capture their email address, confirm it back to them
- "Already have website" → Ask when it was last updated, mention mobile optimization
- "Call back later" → Ask when, confirm the time

RULES:
- Be friendly but concise - this is a cold call
- Listen more than you talk
- Don't be pushy - one objection response then move on
- Always try to book the 15-minute call
- If they want to end the call, be polite and professional`;
  }

  /**
   * Build first message for the voice agent
   */
  private buildFirstMessage(prospectData: { firstName: string; company: string; observation: string }): string {
    return `Hi ${prospectData.firstName}, this is Alex calling from RenderWiseAI. I took a look at ${prospectData.company}'s website and noticed ${prospectData.observation}. We help businesses like yours modernize their web presence and add AI-powered customer follow-up. Are you currently looking to update your website or improve how you handle incoming leads?`;
  }

  /**
   * Generate TTS audio for voicemail (fallback when Conversational AI is unavailable)
   */
  async generateVoicemailAudio(text: string): Promise<{ success: boolean; audioUrl?: string; error?: string }> {
    console.log('[VoiceAgent.generateVoicemailAudio] Generating TTS for voicemail');

    if (DRY_RUN) {
      console.log('[VoiceAgent.generateVoicemailAudio] DRY RUN - Returning mock URL');
      return {
        success: true,
        audioUrl: `https://api.elevenlabs.io/v1/text-to-speech/mock_${Date.now()}.mp3`,
      };
    }

    try {
      const response = await fetch(`${this.baseUrl}/text-to-speech/${this.config.voiceId}`, {
        method: 'POST',
        headers: {
          'xi-api-key': this.apiKey,
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
        console.error('[VoiceAgent.generateVoicemailAudio] API error:', response.status, errorText);
        throw new Error(`ElevenLabs TTS error: ${response.status}`);
      }

      // In a real implementation, you'd upload this to S3 or similar
      // For now, return success
      console.log('[VoiceAgent.generateVoicemailAudio] Successfully generated audio');
      
      return {
        success: true,
        audioUrl: 'generated://audio', // Placeholder - real implementation would return actual URL
      };
    } catch (error) {
      console.error('[VoiceAgent.generateVoicemailAudio] Error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}

export const voiceAgent = new VoiceAgent();
