// Twilio Client - Handles outbound calls and AMD (Answering Machine Detection)
import twilio from 'twilio';
import * as dotenv from 'dotenv';

dotenv.config();

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || '';
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || '';
const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER || '+17704077842';
const DRY_RUN = process.env.DRY_RUN === 'true';

export interface TwilioCallOptions {
  to: string;
  from?: string;
  twiml?: string;
  url?: string;
  machineDetection?: 'Enable' | 'DetectMessageEnd';
  machineDetectionTimeout?: number;
  record?: boolean;
  statusCallback?: string;
  statusCallbackEvent?: string[];
}

export interface TwilioCallResult {
  success: boolean;
  callSid?: string;
  status?: string;
  error?: string;
  answeredBy?: 'human' | 'machine' | 'unknown';
}

export class TwilioClient {
  private client: twilio.Twilio;
  private fromNumber: string;

  constructor() {
    if (!DRY_RUN && (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN)) {
      throw new Error('Twilio credentials not configured. Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN in .env');
    }
    
    this.client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
    this.fromNumber = TWILIO_PHONE_NUMBER;
    console.log('[TwilioClient] Initialized with phone number:', this.fromNumber);
    console.log('[TwilioClient] DRY_RUN mode:', DRY_RUN);
  }

  /**
   * Make an outbound call with AMD (Answering Machine Detection)
   */
  async makeCall(options: TwilioCallOptions): Promise<TwilioCallResult> {
    const { to, twiml, url, machineDetection = 'Enable', record = true } = options;

    console.log('[TwilioClient.makeCall] Initiating call to:', to);
    console.log('[TwilioClient.makeCall] AMD enabled:', machineDetection);
    console.log('[TwilioClient.makeCall] Recording enabled:', record);

    if (DRY_RUN) {
      console.log('[TwilioClient.makeCall] DRY RUN - Simulating call');
      console.log('[TwilioClient.makeCall] Would call:', to);
      console.log('[TwilioClient.makeCall] Would use AMD:', machineDetection);
      
      // Simulate realistic AMD outcomes
      const outcomes: Array<'human' | 'machine' | 'unknown'> = ['human', 'machine', 'unknown'];
      const answeredBy = outcomes[Math.floor(Math.random() * outcomes.length)];
      
      console.log('[TwilioClient.makeCall] Simulated AMD result:', answeredBy);
      
      return {
        success: true,
        callSid: `DRY_RUN_${Date.now()}`,
        status: 'in-progress',
        answeredBy,
      };
    }

    try {
      const callParams: any = {
        to,
        from: options.from || this.fromNumber,
        machineDetection,
        machineDetectionTimeout: options.machineDetectionTimeout || 30,
        record,
      };

      // Use either TwiML directly or a URL that returns TwiML
      if (twiml) {
        callParams.twiml = twiml;
      } else if (url) {
        callParams.url = url;
      } else {
        throw new Error('Either twiml or url must be provided');
      }

      if (options.statusCallback) {
        callParams.statusCallback = options.statusCallback;
        callParams.statusCallbackEvent = options.statusCallbackEvent || ['initiated', 'ringing', 'answered', 'completed'];
      }

      console.log('[TwilioClient.makeCall] Calling Twilio API...');
      const call = await this.client.calls.create(callParams);
      
      console.log('[TwilioClient.makeCall] Call created successfully:', call.sid);
      console.log('[TwilioClient.makeCall] Initial status:', call.status);
      
      return {
        success: true,
        callSid: call.sid,
        status: call.status,
      };
    } catch (error) {
      console.error('[TwilioClient.makeCall] Error creating call:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Fetch call details including AMD result
   */
  async getCallDetails(callSid: string): Promise<{
    success: boolean;
    status?: string;
    answeredBy?: string;
    duration?: number;
    recordingUrl?: string;
    error?: string;
  }> {
    console.log('[TwilioClient.getCallDetails] Fetching details for call:', callSid);

    if (DRY_RUN && callSid.startsWith('DRY_RUN_')) {
      console.log('[TwilioClient.getCallDetails] DRY RUN - Returning simulated details');
      return {
        success: true,
        status: 'completed',
        answeredBy: Math.random() > 0.5 ? 'human' : 'machine',
        duration: Math.floor(Math.random() * 120) + 30,
      };
    }

    try {
      const call = await this.client.calls(callSid).fetch();
      console.log('[TwilioClient.getCallDetails] Call status:', call.status);
      console.log('[TwilioClient.getCallDetails] Answered by:', call.answeredBy);
      
      return {
        success: true,
        status: call.status,
        answeredBy: call.answeredBy,
        duration: call.duration ? parseInt(call.duration, 10) : undefined,
      };
    } catch (error) {
      console.error('[TwilioClient.getCallDetails] Error fetching call:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Hang up an active call
   */
  async hangUp(callSid: string): Promise<{ success: boolean; error?: string }> {
    console.log('[TwilioClient.hangUp] Hanging up call:', callSid);

    if (DRY_RUN && callSid.startsWith('DRY_RUN_')) {
      console.log('[TwilioClient.hangUp] DRY RUN - Simulating hangup');
      return { success: true };
    }

    try {
      await this.client.calls(callSid).update({ status: 'completed' });
      console.log('[TwilioClient.hangUp] Call hung up successfully');
      return { success: true };
    } catch (error) {
      console.error('[TwilioClient.hangUp] Error hanging up call:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Generate TwiML for connecting to ElevenLabs voice agent
   */
  generateElevenLabsTwiML(elevenLabsWsUrl: string): string {
    console.log('[TwilioClient.generateElevenLabsTwiML] Generating TwiML for ElevenLabs');
    
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${elevenLabsWsUrl}">
      <Parameter name="agentName" value="RenderWiseAI" />
    </Stream>
  </Connect>
</Response>`;

    console.log('[TwilioClient.generateElevenLabsTwiML] Generated TwiML length:', twiml.length);
    return twiml;
  }

  /**
   * Generate TwiML for playing a voicemail message
   */
  generateVoicemailTwiML(message: string): string {
    console.log('[TwilioClient.generateVoicemailTwiML] Generating TwiML for voicemail');
    
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Pause length="1"/>
  <Say voice="Polly.Joanna">${this.escapeXml(message)}</Say>
  <Hangup/>
</Response>`;

    console.log('[TwilioClient.generateVoicemailTwiML] Generated TwiML length:', twiml.length);
    return twiml;
  }

  /**
   * Generate TwiML for basic TTS + Gather (fallback flow)
   */
  generateGatherTwiML(message: string, actionUrl: string): string {
    console.log('[TwilioClient.generateGatherTwiML] Generating TwiML for gather');
    
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">${this.escapeXml(message)}</Say>
  <Gather input="speech" action="${actionUrl}" speechTimeout="3" speechModel="phone_call">
    <Say voice="Polly.Joanna">Please speak after the tone.</Say>
  </Gather>
  <Say voice="Polly.Joanna">I didn't hear anything. Goodbye!</Say>
  <Hangup/>
</Response>`;

    console.log('[TwilioClient.generateGatherTwiML] Generated TwiML length:', twiml.length);
    return twiml;
  }

  private escapeXml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }
}

export const twilioClient = new TwilioClient();
