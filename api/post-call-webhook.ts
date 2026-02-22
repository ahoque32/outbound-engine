import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

// Inline variant lookup to avoid module issues in Vercel serverless context
import variants from '../variants.json';

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || '';
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY || '';
const GHL_API_KEY = process.env.GHL_API_KEY || '';
const GHL_LOCATION_ID = process.env.GHL_LOCATION_ID || '';
const GHL_CALENDAR_ID = process.env.GHL_CALENDAR_ID || '';
const GHL_USER_ID = process.env.GHL_USER_ID || '';

function getVariantByAgentId(agentId: string) {
  return variants.variants.find((v: any) => v.agentId === agentId);
}

function ghlHeaders() {
  return {
    'Authorization': `Bearer ${GHL_API_KEY}`,
    'Version': '2021-04-15',
    'Content-Type': 'application/json',
  };
}

// ─── Transcript Analysis ───────────────────────────────────────────

interface BookingDetails {
  booked: boolean;
  selectedTime: string | null;  // ISO string or natural language
  confirmedEmail: string | null;
  confirmedName: string | null;
  outcome: 'booked' | 'interested' | 'callback' | 'not_interested' | 'voicemail' | 'no_answer' | 'unknown';
}

function analyzeTranscript(
  transcript: Array<{ role: string; message: string }>,
  dynamicVars: Record<string, string>,
  analysis: any
): BookingDetails {
  const result: BookingDetails = {
    booked: false,
    selectedTime: null,
    confirmedEmail: dynamicVars.email || null,
    confirmedName: dynamicVars.first_name ? `${dynamicVars.first_name} ${dynamicVars.last_name || ''}`.trim() : null,
    outcome: 'unknown',
  };

  const fullText = transcript.map(t => `${t.role}: ${t.message}`).join('\n').toLowerCase();

  // Check for voicemail
  if (fullText.includes('leave a message') || fullText.includes('leave your message') || fullText.includes('after the beep') || fullText.includes('voicemail')) {
    result.outcome = 'voicemail';
    return result;
  }

  // Check for not interested
  if (/\b(not interested|no thanks|no thank you|don't call|stop calling|remove me)\b/.test(fullText)) {
    result.outcome = 'not_interested';
    return result;
  }

  // Check for callback
  if (/\b(call back|call me later|try again|busy right now|bad time)\b/.test(fullText)) {
    result.outcome = 'callback';
    return result;
  }

  // Check for booking — look for confirmation patterns
  const bookingPatterns = [
    /you'?re all set/i,
    /i'?ll send you a calendar invite/i,
    /calendar invite.*email/i,
    /booked|appointment.*confirmed|scheduled/i,
    /tuesday|wednesday|thursday|friday|monday|saturday|sunday.*(?:morning|afternoon|evening|at \d)/i,
  ];

  const agentMessages = transcript.filter(t => t.role === 'agent').map(t => t.message).join(' ');
  const userMessages = transcript.filter(t => t.role === 'user').map(t => t.message).join(' ');

  // Did the agent confirm a booking?
  const agentConfirmedBooking = bookingPatterns.some(p => p.test(agentMessages));
  // Did the user agree to a time?
  const userAgreedToTime = /\b(works|sounds good|perfect|yes|yeah|that works|let'?s do it|tuesday|wednesday|thursday|friday|monday|morning|afternoon|evening)\b/i.test(userMessages);

  if (agentConfirmedBooking && userAgreedToTime) {
    result.booked = true;
    result.outcome = 'booked';

    // Extract the time they agreed to
    result.selectedTime = extractBookedTime(transcript);

    // Check if email was confirmed/corrected in the call
    const emailMatch = fullText.match(/(?:email|e-mail).*?([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i);
    if (emailMatch) {
      result.confirmedEmail = emailMatch[1];
    }
  } else if (/\b(interested|tell me more|sounds good|sounds great|send me info|learn more)\b/.test(userMessages)) {
    result.outcome = 'interested';
  }

  // Use ElevenLabs analysis as fallback
  if (result.outcome === 'unknown' && analysis?.call_successful === 'success') {
    const summary = (analysis.transcript_summary || '').toLowerCase();
    if (summary.includes('book') || summary.includes('schedul') || summary.includes('appointment')) {
      result.booked = true;
      result.outcome = 'booked';
      result.selectedTime = extractBookedTime(transcript);
    }
  }

  return result;
}

function extractBookedTime(transcript: Array<{ role: string; message: string }>): string | null {
  // Look through the conversation for time references after the agent offered slots
  const fullText = transcript.map(t => `[${t.role}]: ${t.message}`).join('\n');

  // Common patterns: "Tuesday morning at 9", "Thursday at 5", "Friday afternoon"
  const dayMap: Record<string, number> = {};
  const now = new Date();
  for (let i = 1; i <= 7; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() + i);
    const dayName = d.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
    dayMap[dayName] = i;
  }

  // Find the time the user agreed to
  const timePatterns = [
    // "Tuesday morning at 9" or "Tuesday at 9"
    /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+(?:morning|afternoon|evening)?\s*(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?/gi,
    // "9 am on Tuesday"
    /(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?\s*(?:on\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/gi,
  ];

  for (const pattern of timePatterns) {
    const matches = [...fullText.matchAll(pattern)];
    if (matches.length > 0) {
      // Take the last match (most likely the confirmed one)
      const match = matches[matches.length - 1];
      const matchText = match[0].toLowerCase();

      // Find the day
      let dayOffset = 0;
      for (const [day, offset] of Object.entries(dayMap)) {
        if (matchText.includes(day)) {
          dayOffset = offset;
          break;
        }
      }

      // Find the hour
      const hourMatch = matchText.match(/(\d{1,2})(?::(\d{2}))?/);
      if (hourMatch && dayOffset > 0) {
        let hour = parseInt(hourMatch[1]);
        const minutes = hourMatch[2] ? parseInt(hourMatch[2]) : 0;

        // Determine AM/PM
        if (matchText.includes('pm') || matchText.includes('p.m.') || matchText.includes('afternoon') || matchText.includes('evening')) {
          if (hour < 12) hour += 12;
        } else if (matchText.includes('morning') && hour < 6) {
          hour += 12; // "morning at 9" = 9 AM, no change needed for most cases
        }
        // If no AM/PM specified, assume: <=7 = PM, 8-11 = AM
        if (!matchText.includes('am') && !matchText.includes('pm') && !matchText.includes('morning') && !matchText.includes('afternoon') && !matchText.includes('evening')) {
          if (hour <= 7) hour += 12;
        }

        const bookDate = new Date(now);
        bookDate.setDate(bookDate.getDate() + dayOffset);
        bookDate.setHours(hour, minutes, 0, 0);
        return bookDate.toISOString();
      }
    }
  }

  return null;
}

// ─── GHL Integration ───────────────────────────────────────────────

async function findOrCreateGHLContact(data: {
  firstName: string;
  lastName?: string;
  email?: string;
  phone: string;
  company?: string;
  website?: string;
  variant?: string;
}): Promise<string | null> {
  // Search by phone first
  const searchRes = await fetch(
    `https://services.leadconnectorhq.com/contacts/search/duplicate?locationId=${GHL_LOCATION_ID}&number=${encodeURIComponent(data.phone)}`,
    { headers: ghlHeaders() }
  );
  const searchData = await searchRes.json() as any;

  if (searchData.contact?.id) {
    // Update existing contact with tags
    await fetch(`https://services.leadconnectorhq.com/contacts/${searchData.contact.id}`, {
      method: 'PUT',
      headers: ghlHeaders(),
      body: JSON.stringify({
        tags: ['ai-outbound', data.variant || 'unknown-variant', 'booked'],
        source: `AI Voice Agent - ${data.variant || 'unknown'}`,
      }),
    });
    return searchData.contact.id;
  }

  // Search by email
  if (data.email) {
    const emailSearch = await fetch(
      `https://services.leadconnectorhq.com/contacts/search/duplicate?locationId=${GHL_LOCATION_ID}&email=${encodeURIComponent(data.email)}`,
      { headers: ghlHeaders() }
    );
    const emailData = await emailSearch.json() as any;
    if (emailData.contact?.id) {
      await fetch(`https://services.leadconnectorhq.com/contacts/${emailData.contact.id}`, {
        method: 'PUT',
        headers: ghlHeaders(),
        body: JSON.stringify({
          tags: ['ai-outbound', data.variant || 'unknown-variant', 'booked'],
          source: `AI Voice Agent - ${data.variant || 'unknown'}`,
        }),
      });
      return emailData.contact.id;
    }
  }

  // Create new contact
  const createRes = await fetch('https://services.leadconnectorhq.com/contacts/', {
    method: 'POST',
    headers: ghlHeaders(),
    body: JSON.stringify({
      locationId: GHL_LOCATION_ID,
      firstName: data.firstName,
      lastName: data.lastName || '',
      email: data.email || '',
      phone: data.phone,
      companyName: data.company || '',
      website: data.website || '',
      source: `AI Voice Agent - ${data.variant || 'unknown'}`,
      tags: ['ai-outbound', data.variant || 'unknown-variant', 'booked'],
    }),
  });
  const createData = await createRes.json() as any;
  return createData.contact?.id || null;
}

async function bookGHLAppointment(contactId: string, booking: BookingDetails, prospectData: Record<string, string>, variant: string): Promise<any> {
  if (!booking.selectedTime) {
    console.error('[post-call-webhook] No selected time for booking');
    return null;
  }

  const startTime = new Date(booking.selectedTime).toISOString();
  const endTime = new Date(new Date(booking.selectedTime).getTime() + 30 * 60000).toISOString();
  const name = booking.confirmedName || `${prospectData.first_name || ''} ${prospectData.last_name || ''}`.trim();
  const company = prospectData.company_name || '';

  const aptRes = await fetch('https://services.leadconnectorhq.com/calendars/events/appointments', {
    method: 'POST',
    headers: ghlHeaders(),
    body: JSON.stringify({
      calendarId: GHL_CALENDAR_ID,
      locationId: GHL_LOCATION_ID,
      contactId,
      startTime,
      endTime,
      title: `Discovery Call - ${name}${company ? ` (${company})` : ''}`,
      appointmentStatus: 'confirmed',
      assignedUserId: GHL_USER_ID,
      notes: `Booked via AI Voice Agent (${variant}). Email: ${booking.confirmedEmail || 'N/A'}. Phone: ${prospectData.phone || 'N/A'}.`,
    }),
  });

  return await aptRes.json();
}

// ─── Main Handler ──────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { conversation_id, agent_id } = req.body;

    if (!conversation_id) {
      return res.status(400).json({ error: 'Missing conversation_id' });
    }

    // Fetch conversation data from ElevenLabs
    const convRes = await fetch(
      `https://api.elevenlabs.io/v1/convai/conversations/${conversation_id}`,
      { headers: { 'xi-api-key': ELEVENLABS_API_KEY } }
    );

    if (!convRes.ok) {
      const errText = await convRes.text();
      console.error('[post-call-webhook] ElevenLabs fetch error:', convRes.status, errText);
      return res.status(502).json({ error: 'Failed to fetch conversation from ElevenLabs' });
    }

    const conversationData = await convRes.json() as any;
    const usedAgentId = agent_id || conversationData.agent_id;
    const variant = getVariantByAgentId(usedAgentId);
    const variantId = variant?.id || 'unknown';

    // Extract transcript and analysis
    const transcript = conversationData.transcript || [];
    const analysis = conversationData.analysis || {};
    const duration = conversationData.metadata?.call_duration_secs || null;

    // Get dynamic variables that were passed to the agent (prospect data)
    const dynamicVars = conversationData.metadata?.dynamic_variables || {};
    const phoneNumber = conversationData.metadata?.phone_call?.external_number || '';

    // Analyze transcript for booking intent + details
    const booking = analyzeTranscript(transcript, dynamicVars, analysis);
    console.log(`[post-call-webhook] Conversation ${conversation_id} — variant: ${variantId}, outcome: ${booking.outcome}, booked: ${booking.booked}`);

    // Log to Supabase
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

    const { data: existingLog } = await supabase
      .from('call_logs')
      .select('id')
      .eq('conversation_id', conversation_id)
      .single();

    const updateData: Record<string, any> = {
      conversation_id,
      agent_variant: variantId,
      agent_id_used: usedAgentId,
      status: 'completed',
      duration_seconds: duration,
      outcome: booking.outcome,
      transcript: JSON.stringify(transcript),
      analysis: JSON.stringify(analysis),
      completed_at: new Date().toISOString(),
    };

    if (existingLog) {
      await supabase.from('call_logs').update(updateData).eq('id', existingLog.id);
    } else {
      await supabase.from('call_logs').insert(updateData);
    }

    // ─── Auto-Book if prospect agreed ───────────────────────────
    let appointmentResult = null;

    if (booking.booked && GHL_API_KEY) {
      console.log(`[post-call-webhook] 🎯 BOOKING DETECTED — processing GHL booking...`);
      console.log(`[post-call-webhook] Time: ${booking.selectedTime}, Email: ${booking.confirmedEmail}, Name: ${booking.confirmedName}`);

      try {
        const contactId = await findOrCreateGHLContact({
          firstName: dynamicVars.first_name || booking.confirmedName?.split(' ')[0] || 'Unknown',
          lastName: dynamicVars.last_name || booking.confirmedName?.split(' ').slice(1).join(' ') || '',
          email: booking.confirmedEmail || dynamicVars.email || '',
          phone: phoneNumber,
          company: dynamicVars.company_name || '',
          website: dynamicVars.website || '',
          variant: variantId,
        });

        if (contactId && booking.selectedTime) {
          appointmentResult = await bookGHLAppointment(contactId, booking, { ...dynamicVars, phone: phoneNumber }, variantId);
          console.log(`[post-call-webhook] ✅ Appointment booked: ${appointmentResult?.id}`);

          // Update call log with booking info
          await supabase.from('call_logs').update({
            booking_made: true,
            ghl_contact_id: contactId,
            ghl_appointment_id: appointmentResult?.id || null,
            booked_time: booking.selectedTime,
          }).eq('conversation_id', conversation_id);
        } else if (contactId && !booking.selectedTime) {
          console.log('[post-call-webhook] ⚠️ Booking detected but no time extracted — contact created/updated, manual booking needed');
          await supabase.from('call_logs').update({
            ghl_contact_id: contactId,
            notes: 'Booking detected but time extraction failed — manual follow-up needed',
          }).eq('conversation_id', conversation_id);
        }
      } catch (ghlError: any) {
        console.error('[post-call-webhook] GHL booking error:', ghlError.message);
        // Don't fail the webhook — log the error and continue
        await supabase.from('call_logs').update({
          notes: `GHL booking failed: ${ghlError.message}`,
        }).eq('conversation_id', conversation_id);
      }
    }

    res.json({
      success: true,
      variant: variantId,
      conversation_id,
      outcome: booking.outcome,
      booked: booking.booked,
      appointment_id: appointmentResult?.id || null,
    });
  } catch (error: any) {
    console.error('[post-call-webhook] Error:', error);
    res.status(500).json({ error: error.message });
  }
}
