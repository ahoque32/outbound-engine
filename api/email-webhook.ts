/*
SQL Migration for email_events table:

-- Create email_events table for webhook logging
CREATE TABLE IF NOT EXISTS email_events (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  event_type text NOT NULL,
  prospect_email text NOT NULL,
  prospect_id uuid REFERENCES prospects(id),
  campaign_id text,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

-- Create indexes for efficient lookups
CREATE INDEX IF NOT EXISTS idx_email_events_prospect ON email_events(prospect_email);
CREATE INDEX IF NOT EXISTS idx_email_events_type ON email_events(event_type);
CREATE INDEX IF NOT EXISTS idx_email_events_created_at ON email_events(created_at);
*/

import type { VercelRequest, VercelResponse } from '@vercel/node';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY || '';

// Instantly webhook event types
interface InstantlyWebhookPayload {
  event_type: 'reply_received' | 'email_sent' | 'email_opened' | 'lead_unsubscribed' | string;
  lead_email?: string;
  email?: string;
  campaign_id?: string;
  campaign_name?: string;
  timestamp?: string;
  [key: string]: any;
}

interface EmailEvent {
  event_type: string;
  prospect_email: string;
  prospect_id?: string;
  campaign_id?: string;
  metadata: Record<string, any>;
}

// Map Instantly event types to email_state values
const EMAIL_STATE_MAP: Record<string, string> = {
  'email_sent': 'sent',
  'email_opened': 'opened',
  'reply_received': 'replied',
  'lead_unsubscribed': 'bounced',
};

// Map Instantly event types to pipeline_state updates (only for some events)
const PIPELINE_STATE_MAP: Record<string, string | undefined> = {
  'reply_received': 'engaged',
  'lead_unsubscribed': 'not_interested',
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Only accept POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed', allowed: ['POST'] });
  }

  try {
    const payload = req.body as InstantlyWebhookPayload;
    
    // Validate payload
    if (!payload || typeof payload !== 'object') {
      console.error('[email-webhook] Invalid payload:', payload);
      return res.status(400).json({ error: 'Invalid payload' });
    }

    const eventType = payload.event_type;
    const email = payload.lead_email || payload.email;

    if (!eventType) {
      console.error('[email-webhook] Missing event_type:', payload);
      return res.status(400).json({ error: 'Missing event_type' });
    }

    if (!email) {
      console.error('[email-webhook] Missing email:', payload);
      return res.status(400).json({ error: 'Missing lead_email or email' });
    }

    console.log(`[email-webhook] Received ${eventType} for ${email}`);

    // Process webhook asynchronously - don't await to return 200 quickly
    processWebhook(payload, email, eventType).catch(err => {
      console.error('[email-webhook] Async processing error:', err);
    });

    // Return 200 immediately - don't block the webhook caller
    return res.status(200).json({ 
      success: true, 
      message: 'Webhook received',
      event_type: eventType,
      email: email
    });

  } catch (error: any) {
    console.error('[email-webhook] Error:', error);
    // Still return 200 to prevent webhook retries for unrecoverable errors
    return res.status(200).json({ 
      success: false, 
      error: error.message || 'Internal error'
    });
  }
}

async function processWebhook(
  payload: InstantlyWebhookPayload, 
  email: string, 
  eventType: string
): Promise<void> {
  const sbHeaders = {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation',
  };

  // Find prospect by email
  const prospectId = await findProspectByEmail(email, sbHeaders);

  // Log the event to email_events table
  const emailEvent: EmailEvent = {
    event_type: eventType,
    prospect_email: email,
    prospect_id: prospectId || undefined,
    campaign_id: payload.campaign_id || undefined,
    metadata: {
      campaign_name: payload.campaign_name,
      timestamp: payload.timestamp,
      ...payload, // Include full payload for debugging
    },
  };

  await logEmailEvent(emailEvent, sbHeaders);

  // Update prospect state if applicable
  const newEmailState = EMAIL_STATE_MAP[eventType];
  const newPipelineState = PIPELINE_STATE_MAP[eventType];

  if (newEmailState && prospectId) {
    await updateProspectState(prospectId, newEmailState, newPipelineState, sbHeaders);
    console.log(`[email-webhook] Updated prospect ${prospectId}: email_state=${newEmailState}${newPipelineState ? `, pipeline_state=${newPipelineState}` : ''}`);
  } else if (newEmailState && !prospectId) {
    console.log(`[email-webhook] No prospect found for ${email}, event logged but state not updated`);
  }
}

async function findProspectByEmail(email: string, headers: Record<string, string>): Promise<string | null> {
  try {
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/prospects?email=eq.${encodeURIComponent(email)}&limit=1`,
      { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
    );

    if (!response.ok) {
      console.error(`[email-webhook] Failed to find prospect: ${response.status}`);
      return null;
    }

    const prospects = await response.json() as Array<{ id: string }>;
    return prospects?.[0]?.id || null;
  } catch (err: any) {
    console.error('[email-webhook] Error finding prospect:', err.message);
    return null;
  }
}

async function logEmailEvent(event: EmailEvent, headers: Record<string, string>): Promise<void> {
  try {
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/email_events`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify(event),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[email-webhook] Failed to log event: ${response.status} ${errorText}`);
    } else {
      console.log(`[email-webhook] Logged ${event.event_type} event for ${event.prospect_email}`);
    }
  } catch (err: any) {
    console.error('[email-webhook] Error logging event:', err.message);
  }
}

async function updateProspectState(
  prospectId: string, 
  emailState: string, 
  pipelineState: string | undefined,
  headers: Record<string, string>
): Promise<void> {
  try {
    const updateData: Record<string, any> = {
      email_state: emailState,
      updated_at: new Date().toISOString(),
    };

    if (pipelineState) {
      updateData.pipeline_state = pipelineState;
    }

    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/prospects?id=eq.${encodeURIComponent(prospectId)}`,
      {
        method: 'PATCH',
        headers,
        body: JSON.stringify(updateData),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[email-webhook] Failed to update prospect: ${response.status} ${errorText}`);
    }
  } catch (err: any) {
    console.error('[email-webhook] Error updating prospect:', err.message);
  }
}
