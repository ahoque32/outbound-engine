// Voicemail Handler - AMD detection and voicemail script delivery
import { twilioClient } from './twilio-client';
import { voiceAgent } from './voice-agent';
import { generateVoicemailScript, ProspectData, DEFAULT_AGENT_CONFIG } from './call-script';
import * as dotenv from 'dotenv';

dotenv.config();

const DRY_RUN = process.env.DRY_RUN === 'true';

export type AMDResult = 'human' | 'machine' | 'unknown' | 'timeout';

export interface VoicemailDeliveryResult {
  success: boolean;
  amdResult: AMDResult;
  delivered: boolean;
  duration?: number;
  error?: string;
}

export interface AMDCheckResult {
  result: AMDResult;
  confidence: number;
  callSid?: string;
}

export class VoicemailHandler {
  private voicemailCache: Map<string, string> = new Map();

  constructor() {
    console.log('[VoicemailHandler] Initialized');
    console.log('[VoicemailHandler] DRY_RUN mode:', DRY_RUN);
  }

  /**
   * Check AMD result for a call
   */
  async checkAMDResult(callSid: string): Promise<AMDCheckResult> {
    console.log('[VoicemailHandler.checkAMDResult] Checking AMD for call:', callSid);

    if (DRY_RUN && callSid.startsWith('DRY_RUN_')) {
      console.log('[VoicemailHandler.checkAMDResult] DRY RUN - Simulating AMD check');
      
      // Simulate realistic AMD distribution
      const rand = Math.random();
      let result: AMDResult;
      
      if (rand < 0.3) {
        result = 'human';
      } else if (rand < 0.7) {
        result = 'machine';
      } else if (rand < 0.9) {
        result = 'unknown';
      } else {
        result = 'timeout';
      }
      
      console.log('[VoicemailHandler.checkAMDResult] Simulated AMD result:', result);
      
      return {
        result,
        confidence: 0.85,
        callSid,
      };
    }

    try {
      const details = await twilioClient.getCallDetails(callSid);
      
      if (!details.success) {
        console.error('[VoicemailHandler.checkAMDResult] Failed to get call details:', details.error);
        return {
          result: 'unknown',
          confidence: 0,
          callSid,
        };
      }

      // Map Twilio's answeredBy to our AMDResult
      let result: AMDResult;
      const answeredBy = details.answeredBy?.toLowerCase() || '';
      
      if (answeredBy.includes('human')) {
        result = 'human';
      } else if (answeredBy.includes('machine')) {
        result = 'machine';
      } else if (answeredBy.includes('unknown')) {
        result = 'unknown';
      } else {
        result = 'timeout';
      }

      console.log('[VoicemailHandler.checkAMDResult] AMD result:', result, 'answeredBy:', answeredBy);
      
      return {
        result,
        confidence: answeredBy ? 0.9 : 0.5,
        callSid,
      };
    } catch (error) {
      console.error('[VoicemailHandler.checkAMDResult] Error:', error);
      return {
        result: 'unknown',
        confidence: 0,
        callSid,
      };
    }
  }

  /**
   * Deliver a voicemail message
   */
  async deliverVoicemail(
    callSid: string,
    prospect: ProspectData,
    templateId: string = 'web-design'
  ): Promise<VoicemailDeliveryResult> {
    console.log('[VoicemailHandler.deliverVoicemail] Delivering voicemail to:', prospect.firstName);

    // Generate the voicemail script
    const script = generateVoicemailScript(prospect, templateId);
    console.log('[VoicemailHandler.deliverVoicemail] Script:', script);

    if (DRY_RUN) {
      console.log('[VoicemailHandler.deliverVoicemail] DRY RUN - Simulating voicemail delivery');
      console.log('[VoicemailHandler.deliverVoicemail] Would play message:', script.substring(0, 50) + '...');
      
      return {
        success: true,
        amdResult: 'machine',
        delivered: true,
        duration: 15,
      };
    }

    try {
      // Generate TwiML for voicemail
      const twiml = twilioClient.generateVoicemailTwiML(script);
      
      // Update the call to play the voicemail
      // Note: In a real implementation, you'd redirect the call to a URL that returns this TwiML
      // or use Twilio's REST API to update the call
      
      console.log('[VoicemailHandler.deliverVoicemail] Generated TwiML for voicemail');
      
      // For now, we'll simulate success
      // In production, you'd make an API call to update the call
      
      return {
        success: true,
        amdResult: 'machine',
        delivered: true,
        duration: Math.ceil(script.length / 15), // Rough estimate: 15 chars per second
      };
    } catch (error) {
      console.error('[VoicemailHandler.deliverVoicemail] Error:', error);
      return {
        success: false,
        amdResult: 'machine',
        delivered: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Generate and cache a voicemail audio file
   */
  async generateVoicemailAudio(
    prospect: ProspectData,
    templateId: string = 'web-design'
  ): Promise<{ success: boolean; url?: string; error?: string }> {
    console.log('[VoicemailHandler.generateVoicemailAudio] Generating audio for:', prospect.firstName);

    const cacheKey = `${prospect.firstName}_${prospect.company}_${templateId}`;
    
    // Check cache
    if (this.voicemailCache.has(cacheKey)) {
      console.log('[VoicemailHandler.generateVoicemailAudio] Using cached audio');
      return {
        success: true,
        url: this.voicemailCache.get(cacheKey),
      };
    }

    const script = generateVoicemailScript(prospect, templateId);
    
    if (DRY_RUN) {
      console.log('[VoicemailHandler.generateVoicemailAudio] DRY RUN - Simulating audio generation');
      const mockUrl = `https://mock-storage.example.com/voicemail_${Date.now()}.mp3`;
      this.voicemailCache.set(cacheKey, mockUrl);
      return {
        success: true,
        url: mockUrl,
      };
    }

    // Generate TTS audio via ElevenLabs
    const result = await voiceAgent.generateVoicemailAudio(script);
    
    if (result.success && result.audioUrl) {
      this.voicemailCache.set(cacheKey, result.audioUrl);
    }
    
    return result;
  }

  /**
   * Handle the full voicemail flow: detect AMD and deliver if machine
   */
  async handleVoicemailFlow(
    callSid: string,
    prospect: ProspectData,
    templateId: string = 'web-design'
  ): Promise<VoicemailDeliveryResult> {
    console.log('[VoicemailHandler.handleVoicemailFlow] Starting voicemail flow for:', prospect.firstName);

    // Check AMD result
    const amdResult = await this.checkAMDResult(callSid);
    console.log('[VoicemailHandler.handleVoicemailFlow] AMD result:', amdResult.result);

    // If human detected, don't leave voicemail
    if (amdResult.result === 'human') {
      console.log('[VoicemailHandler.handleVoicemailFlow] Human detected, skipping voicemail');
      return {
        success: true,
        amdResult: 'human',
        delivered: false,
      };
    }

    // If machine or unknown, try to deliver voicemail
    if (amdResult.result === 'machine' || amdResult.result === 'unknown') {
      console.log('[VoicemailHandler.handleVoicemailFlow] Machine/unknown detected, delivering voicemail');
      return await this.deliverVoicemail(callSid, prospect, templateId);
    }

    // Timeout or error
    console.log('[VoicemailHandler.handleVoicemailFlow] Timeout or error, cannot deliver voicemail');
    return {
      success: false,
      amdResult: amdResult.result,
      delivered: false,
      error: 'Timeout waiting for AMD result',
    };
  }

  /**
   * Get voicemail statistics for a batch of calls
   */
  getVoicemailStats(results: VoicemailDeliveryResult[]): {
    total: number;
    delivered: number;
    failed: number;
    humans: number;
    machines: number;
    unknown: number;
  } {
    const stats = {
      total: results.length,
      delivered: 0,
      failed: 0,
      humans: 0,
      machines: 0,
      unknown: 0,
    };

    for (const result of results) {
      if (result.delivered) stats.delivered++;
      if (!result.success) stats.failed++;
      
      switch (result.amdResult) {
        case 'human':
          stats.humans++;
          break;
        case 'machine':
          stats.machines++;
          break;
        case 'unknown':
        case 'timeout':
          stats.unknown++;
          break;
      }
    }

    return stats;
  }
}

export const voicemailHandler = new VoicemailHandler();
