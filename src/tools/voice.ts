import variants from '../../variants.json';
import { VariantConfig as ABVariantConfig, getVariantById } from '../core/ab-router';
import { voiceAgent } from '../dialer/voice-agent';
import { ProspectRow } from '../types';
import { getSupabaseClient, toErrorMessage } from './shared';
import { CallResult, TranscriptResult, VoiceAgentVariant } from './types';

interface VariantsFile {
  variants: Array<VoiceAgentVariant>;
}

/**
 * Triggers an outbound voice call for a prospect via ElevenLabs + Twilio.
 */
export async function makeCall(prospectId: string, agentVariant?: string): Promise<CallResult> {
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('prospects')
      .select('id,name,company,phone,email,website')
      .eq('id', prospectId)
      .single<Pick<ProspectRow, 'id' | 'name' | 'company' | 'phone' | 'email' | 'website'>>();

    if (error || !data) {
      return {
        success: false,
        prospectId,
        status: 'failed',
        error: { code: 'PROSPECT_NOT_FOUND', message: error?.message || `Prospect ${prospectId} not found` },
      };
    }

    if (!data.phone) {
      return {
        success: false,
        prospectId,
        status: 'failed',
        error: { code: 'MISSING_PHONE', message: 'Prospect has no phone number' },
      };
    }

    const variant = agentVariant ? getVariantById(agentVariant) : undefined;
    const outboundResult = await voiceAgent.makeOutboundCall(data.phone, {
      agentIdOverride: variant?.agentId,
      prospectData: {
        firstName: (data.name || '').split(' ')[0] || data.name || 'there',
        company: data.company || 'your company',
        website: data.website || '',
        email: data.email || '',
      },
    });

    if (!outboundResult.success) {
      return {
        success: false,
        prospectId,
        status: 'failed',
        agentVariant: variant?.id,
        error: {
          code: 'CALL_FAILED',
          message: outboundResult.error || 'Call initiation failed',
        },
      };
    }

    return {
      success: true,
      prospectId,
      status: 'initiated',
      agentVariant: variant?.id,
      conversationId: outboundResult.conversationId,
      callSid: outboundResult.callSid,
    };
  } catch (error) {
    return {
      success: false,
      prospectId,
      status: 'failed',
      error: {
        code: 'VOICE_TOOL_ERROR',
        message: toErrorMessage(error),
      },
    };
  }
}

/**
 * Fetches the raw ElevenLabs transcript payload for a conversation.
 */
export async function getTranscript(conversationId: string): Promise<TranscriptResult> {
  try {
    const transcript = await voiceAgent.getConversation(conversationId);
    if (!transcript) {
      return {
        success: false,
        conversationId,
        error: { code: 'TRANSCRIPT_NOT_FOUND', message: 'Conversation not found or unavailable' },
      };
    }

    return {
      success: true,
      conversationId,
      transcript,
    };
  } catch (error) {
    return {
      success: false,
      conversationId,
      error: {
        code: 'TRANSCRIPT_FETCH_FAILED',
        message: toErrorMessage(error),
      },
    };
  }
}

/**
 * Lists available voice agent variants from variants.json.
 */
export async function listVoiceAgents(): Promise<VoiceAgentVariant[]> {
  const file = variants as VariantsFile;
  return file.variants.map((variant) => ({ ...variant }));
}

export type { ABVariantConfig };
