// MiniMax Client - LLM wrapper for the voice agent brain
import 'dotenv/config';

const MINIMAX_API_KEY = process.env.MINIMAX_API_KEY || '';
const MINIMAX_BASE_URL = 'https://api.minimax.io/v1';
const MINIMAX_MODEL = 'MiniMax-M2.5';

export interface MiniMaxMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface MiniMaxChoice {
  index: number;
  message: {
    role: string;
    content: string;
  };
  finish_reason: string;
}

export interface MiniMaxResponse {
  id: string;
  model: string;
  choices: MiniMaxChoice[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export class MiniMaxClient {
  private apiKey: string;
  private baseUrl: string;
  private model: string;

  constructor(apiKey?: string, model?: string) {
    this.apiKey = apiKey || MINIMAX_API_KEY;
    this.baseUrl = MINIMAX_BASE_URL;
    this.model = model || MINIMAX_MODEL;

    if (!this.apiKey) {
      throw new Error('MiniMax API key not configured. Set MINIMAX_API_KEY in .env');
    }
  }

  /**
   * Send a chat completion request to MiniMax
   */
  async chat(messages: MiniMaxMessage[]): Promise<MiniMaxResponse> {
    const url = `${this.baseUrl}/text/chatcompletion_v2`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        temperature: 0.7,
        max_tokens: 500,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`MiniMax API error: ${response.status} - ${errorText}`);
    }

    return response.json() as Promise<MiniMaxResponse>;
  }

  /**
   * Generate a conversational response
   */
  async generateResponse(
    systemPrompt: string,
    userMessage: string,
    conversationHistory: Array<{ role: string; content: string }> = []
  ): Promise<string> {
    const messages: MiniMaxMessage[] = [
      { role: 'system', content: systemPrompt },
      ...conversationHistory.map(h => ({ role: h.role as any, content: h.content })),
      { role: 'user', content: userMessage },
    ];

    const response = await this.chat(messages);
    return response.choices[0]?.message?.content || '';
  }

  /**
   * Generate a dynamic system prompt for a cold call
   */
  async generateCallSystemPrompt(prospectData: {
    firstName: string;
    company: string;
    industry?: string;
    observation?: string;
  }): Promise<string> {
    const systemPrompt = `You are Alex, a friendly and professional sales representative from RenderWiseAI, a company that helps small businesses modernize their websites and add AI-powered customer follow-up.

IMPORTANT: You are on a COLD CALL. The person did not ask to be called. Be warm, not pushy.

CONTEXT ABOUT PROSPECT:
- Name: ${prospectData.firstName}
- Company: ${prospectData.company}
- Industry: ${prospectData.industry || 'general business'}
- Observation: ${prospectData.observation || 'their website could use modernization'}

YOUR JOB:
1. Introduce yourself briefly (5 seconds)
2. Mention something specific you noticed about their business/website (personalization)
3. Quickly explain what you help with (websites + AI chatbots that follow up with leads)
4. Ask if they're currently looking to improve their website or lead handling
5. Handle objections naturally (max 1 per objection, then move on)
6. Always try to book a 15-minute discovery call with the founder

OBJECTION HANDLING:
- "Not interested" → "Completely understand. Quick question though - are you happy with how your website converts visitors right now?" (then gracefully exit)
- "How much?" → "Every business is different. I'd love to understand your situation first. Would a 15-min call help?"
- "Send email" → "Absolutely! What's the best email to send some info to?"
- "Already have a website" → "That's great! When was it last updated? Mobile optimization has changed a lot recently."
- "Call back later" → "Of course! What's a better time this week?"

RULES:
- Keep calls under 2 minutes if they're not interested
- Listen more than you talk
- Never be pushy - respect their time
- Always try to book the discovery call
- If they want to end, be polite and thank them
- Speak naturally, not robotically`;

    return systemPrompt;
  }

  /**
   * Generate a first message/opening for a call
   */
  async generateOpening(prospectData: {
    firstName: string;
    company: string;
    observation?: string;
  }): Promise<string> {
    const messages: MiniMaxMessage[] = [
      {
        role: 'system',
        content: 'Generate a brief, friendly cold call opening (2-3 sentences, under 30 words). Introduce yourself, mention something about their company, and ask a qualifying question. Do NOT pitch yet.',
      },
      {
        role: 'user',
        content: `Call ${prospectData.firstName} at ${prospectData.company}. Notice: ${prospectData.observation || 'their website'}`,
      },
    ];

    const response = await this.chat(messages);
    return response.choices[0]?.message?.content || `Hi ${prospectData.firstName}, this is Alex calling from RenderWiseAI. I noticed ${prospectData.company}'s website and thought it might be worth a quick chat. Are you currently looking to update your site?`;
  }

  /**
   * Generate a response to what the prospect said
   */
  async generateResponseTo(
    prospectMessage: string,
    systemPrompt: string,
    history: Array<{ role: string; content: string }> = []
  ): Promise<string> {
    return this.generateResponse(systemPrompt, prospectMessage, history);
  }
}

export const miniMaxClient = new MiniMaxClient();
