// Dialer Adapter - Main adapter for voice channel (replaces voice-adapter stub)
import { BaseChannelAdapter } from './base-adapter';
import { Prospect, TouchpointResult } from '../types';
import { callEngine, CallEngineConfig } from '../dialer/call-engine';
import { ProspectForCall } from '../dialer/call-engine';
import * as dotenv from 'dotenv';

dotenv.config();

const DRY_RUN = process.env.DRY_RUN === 'true';

export interface DialerAdapterConfig extends CallEngineConfig {
  templateId?: string;
}

export class DialerAdapter extends BaseChannelAdapter {
  name = 'voice' as const;
  private config: DialerAdapterConfig;

  constructor(config: DialerAdapterConfig = {}) {
    super();
    this.config = {
      templateId: 'web-design',
      ...config,
    };
    console.log('[DialerAdapter] Initialized');
    console.log('[DialerAdapter] DRY_RUN mode:', DRY_RUN);
  }

  /**
   * Validate that the prospect has required fields for voice calls
   */
  validateProspect(prospect: Prospect, requiredFields: string[] = ['phone']): boolean {
    console.log('[DialerAdapter.validateProspect] Validating prospect:', prospect.id);
    
    for (const field of requiredFields) {
      if (field === 'phone' && !prospect.phone) {
        console.log('[DialerAdapter.validateProspect] Missing phone number');
        return false;
      }
    }
    
    console.log('[DialerAdapter.validateProspect] Prospect valid');
    return true;
  }

  /**
   * Send a voice call to a prospect
   */
  async send(prospect: Prospect, action: string, content?: string): Promise<TouchpointResult> {
    console.log('[DialerAdapter.send] Sending voice call to:', prospect.name);
    console.log('[DialerAdapter.send] Action:', action);

    if (!this.validateProspect(prospect)) {
      return {
        success: false,
        error: 'Phone number required',
      };
    }

    try {
      // Convert Prospect to ProspectForCall format
      const prospectForCall: ProspectForCall = {
        id: prospect.id,
        campaignId: prospect.campaignId,
        firstName: prospect.name.split(' ')[0] || prospect.name,
        lastName: prospect.name.split(' ').slice(1).join(' ') || '',
        company: prospect.company || 'Unknown Company',
        phone: prospect.phone!,
        website: prospect.website,
        industry: prospect.industry,
        location: prospect.location,
      };

      // Make the call
      const result = await callEngine.callProspect(prospectForCall, this.config.templateId);

      console.log('[DialerAdapter.send] Call result:', {
        success: result.success,
        status: result.status,
        outcome: result.outcome,
      });

      return {
        success: result.success,
        outcome: result.outcome,
        error: result.error,
        metadata: {
          callSid: result.callSid,
          status: result.status,
          duration: result.duration,
          amdResult: result.amdResult,
          transcript: result.transcript,
          recordingUrl: result.recordingUrl,
          callbackAt: result.callbackAt?.toISOString(),
          notes: result.notes,
          timestamp: new Date().toISOString(),
          dryRun: DRY_RUN,
        },
      };
    } catch (error) {
      console.error('[DialerAdapter.send] Error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Check the status of a prospect's voice state
   */
  async checkStatus(prospect: Prospect): Promise<string> {
    console.log('[DialerAdapter.checkStatus] Checking voice status for:', prospect.id);
    return prospect.voiceState;
  }

  /**
   * Make a direct call to a prospect
   */
  async makeCall(prospect: Prospect, script?: string): Promise<TouchpointResult> {
    console.log('[DialerAdapter.makeCall] Making call to:', prospect.name);
    return this.send(prospect, 'ai_call', script);
  }

  /**
   * Run a batch of calls
   */
  async runBatch(limit: number = 10): Promise<{
    total: number;
    successful: number;
    failed: number;
    results: TouchpointResult[];
  }> {
    console.log('[DialerAdapter.runBatch] Running batch of', limit, 'calls');

    const batchResult = await callEngine.runBatch(limit, this.config.templateId);

    // Convert CallResult[] to TouchpointResult[]
    const touchpointResults: TouchpointResult[] = batchResult.results.map(result => ({
      success: result.success,
      outcome: result.outcome,
      error: result.error,
      metadata: {
        callSid: result.callSid,
        status: result.status,
        duration: result.duration,
        amdResult: result.amdResult,
        transcript: result.transcript,
        callbackAt: result.callbackAt?.toISOString(),
        notes: result.notes,
        timestamp: new Date().toISOString(),
      },
    }));

    return {
      total: batchResult.total,
      successful: batchResult.successful,
      failed: batchResult.failed,
      results: touchpointResults,
    };
  }

  /**
   * Estimate the cost of a call
   */
  estimateCost(durationMinutes: number): number {
    // ElevenLabs: ~$0.07/min for Conversational AI
    // Twilio: ~$0.014/min for outbound calls
    // Total: ~$0.084/min
    const costPerMinute = 0.084;
    return durationMinutes * costPerMinute;
  }

  /**
   * Get daily call statistics
   */
  async getDailyStats(): Promise<{
    totalCalls: number;
    answered: number;
    voicemail: number;
    noAnswer: number;
    interested: number;
    booked: number;
  }> {
    console.log('[DialerAdapter.getDailyStats] Fetching daily stats');

    // This would query the call_logs table
    // For now, return placeholder stats
    return {
      totalCalls: 0,
      answered: 0,
      voicemail: 0,
      noAnswer: 0,
      interested: 0,
      booked: 0,
    };
  }
}

// Export singleton instance
export const dialerAdapter = new DialerAdapter();
