// Book Appointment Webhook for ElevenLabs Agent (Ava)
// Called mid-conversation when a prospect agrees to a discovery call
// Creates/updates contact in GHL + books appointment on Discovery Call calendar

import express from 'express';
import * as dotenv from 'dotenv';

dotenv.config();

const GHL_API_KEY = process.env.GHL_API_KEY || 'pit-a3ac5e4b-188d-4947-863d-c3eb29759eb3';
const GHL_LOCATION_ID = process.env.GHL_LOCATION_ID || 'W0lmkn61yetcMGFNm1aD';
const GHL_CALENDAR_ID = process.env.GHL_CALENDAR_ID || 'OhUudQZ4VD63YlWItIht';
const GHL_BASE_URL = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-04-15';
const WEBHOOK_PORT = parseInt(process.env.WEBHOOK_PORT || '3848', 10);

const app = express();
app.use(express.json());

// GHL API headers
function ghlHeaders() {
  return {
    'Authorization': `Bearer ${GHL_API_KEY}`,
    'Version': GHL_VERSION,
    'Content-Type': 'application/json',
  };
}

/**
 * Find or create a contact in GHL
 */
async function findOrCreateContact(data: {
  firstName: string;
  lastName?: string;
  email?: string;
  phone: string;
  company?: string;
}): Promise<string> {
  // Search by phone first
  const searchRes = await fetch(
    `${GHL_BASE_URL}/contacts/search/duplicate?locationId=${GHL_LOCATION_ID}&number=${encodeURIComponent(data.phone)}`,
    { headers: ghlHeaders() }
  );
  const searchData = await searchRes.json() as any;

  if (searchData.contact?.id) {
    console.log('[GHL] Found existing contact:', searchData.contact.id);
    return searchData.contact.id;
  }

  // Create new contact
  const createRes = await fetch(`${GHL_BASE_URL}/contacts/`, {
    method: 'POST',
    headers: ghlHeaders(),
    body: JSON.stringify({
      locationId: GHL_LOCATION_ID,
      firstName: data.firstName,
      lastName: data.lastName || '',
      email: data.email || '',
      phone: data.phone,
      companyName: data.company || '',
      source: 'AI Cold Call - Ava',
      tags: ['ai-outbound', 'ava-booked'],
    }),
  });

  const createData = await createRes.json() as any;
  console.log('[GHL] Created contact:', createData.contact?.id);
  return createData.contact?.id;
}

/**
 * Get available slots for a given date range
 */
async function getAvailableSlots(startDate: string, endDate: string): Promise<Record<string, string[]>> {
  const start = new Date(startDate).getTime();
  const end = new Date(endDate).getTime();

  const res = await fetch(
    `${GHL_BASE_URL}/calendars/${GHL_CALENDAR_ID}/free-slots?startDate=${start}&endDate=${end}`,
    { headers: ghlHeaders() }
  );

  const data = await res.json() as any;
  const slots: Record<string, string[]> = {};

  for (const [date, info] of Object.entries(data)) {
    if (date === 'traceId') continue;
    slots[date] = (info as any).slots || [];
  }

  return slots;
}

/**
 * Book an appointment in GHL
 */
async function bookAppointment(data: {
  contactId: string;
  slotTime: string;
  title?: string;
  notes?: string;
}): Promise<any> {
  const startTime = new Date(data.slotTime).toISOString();
  const endTime = new Date(new Date(data.slotTime).getTime() + 30 * 60 * 1000).toISOString();

  const res = await fetch(`${GHL_BASE_URL}/calendars/events/appointments`, {
    method: 'POST',
    headers: ghlHeaders(),
    body: JSON.stringify({
      calendarId: GHL_CALENDAR_ID,
      locationId: GHL_LOCATION_ID,
      contactId: data.contactId,
      startTime,
      endTime,
      title: data.title || 'Discovery Call - Booked by Ava',
      appointmentStatus: 'confirmed',
      assignedUserId: 't5hJwYPGQweJTktiLQZW', // Primary team member
      notes: data.notes || 'Booked during AI cold call with Ava',
    }),
  });

  const result = await res.json();
  console.log('[GHL] Appointment booked:', JSON.stringify(result));
  return result;
}

// ========== ENDPOINTS ==========

/**
 * POST /get-available-slots
 * ElevenLabs tool: Ava asks "when are you free?" → fetches available times
 */
app.post('/get-available-slots', async (req, res) => {
  console.log('[Webhook] /get-available-slots called:', JSON.stringify(req.body));

  try {
    // Default to next 5 business days
    const now = new Date();
    const startDate = req.body.start_date || new Date(now.getTime() + 86400000).toISOString().split('T')[0];
    const endDate = req.body.end_date || new Date(now.getTime() + 5 * 86400000).toISOString().split('T')[0];

    const slots = await getAvailableSlots(startDate, endDate);

    // Format for Ava to read out
    const formatted: string[] = [];
    for (const [date, times] of Object.entries(slots)) {
      const dateStr = new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
      // Only show morning and evening slots (not all 30-min intervals)
      const morning = times.filter(t => {
        const h = parseInt(t.split('T')[1].split(':')[0]);
        return h >= 8 && h < 12;
      });
      const evening = times.filter(t => {
        const h = parseInt(t.split('T')[1].split(':')[0]);
        return h >= 17 && h < 22;
      });

      const availableTimes: string[] = [];
      if (morning.length > 0) availableTimes.push(`morning (${morning[0].split('T')[1].substring(0, 5)} to ${morning[morning.length - 1].split('T')[1].substring(0, 5)})`);
      if (evening.length > 0) availableTimes.push(`evening (${evening[0].split('T')[1].substring(0, 5)} to ${evening[evening.length - 1].split('T')[1].substring(0, 5)})`);

      if (availableTimes.length > 0) {
        formatted.push(`${dateStr}: ${availableTimes.join(' and ')}`);
      }
    }

    res.json({
      available_slots: formatted.join('. '),
      raw_slots: slots,
    });
  } catch (error) {
    console.error('[Webhook] Error:', error);
    res.status(500).json({ error: 'Failed to fetch slots' });
  }
});

/**
 * POST /book-appointment
 * ElevenLabs tool: Ava books the discovery call
 */
app.post('/book-appointment', async (req, res) => {
  console.log('[Webhook] /book-appointment called:', JSON.stringify(req.body));

  try {
    const { first_name, last_name, email, phone, company, preferred_time } = req.body;

    if (!first_name || !phone || !preferred_time) {
      return res.status(400).json({
        error: 'Missing required fields: first_name, phone, preferred_time',
      });
    }

    // Step 1: Find or create contact
    const contactId = await findOrCreateContact({
      firstName: first_name,
      lastName: last_name,
      email,
      phone,
      company,
    });

    if (!contactId) {
      return res.status(500).json({ error: 'Failed to create contact in CRM' });
    }

    // Step 2: Book the appointment
    const appointment = await bookAppointment({
      contactId,
      slotTime: preferred_time,
      title: `Discovery Call - ${first_name} ${last_name || ''} (${company || 'N/A'})`,
      notes: `Booked by Ava during AI cold call. Phone: ${phone}`,
    });

    res.json({
      success: true,
      message: `Discovery call booked for ${first_name} on ${new Date(preferred_time).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })} at ${new Date(preferred_time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}. They'll receive a calendar invite with a Google Meet link.`,
      appointment_id: appointment?.id,
      contact_id: contactId,
    });
  } catch (error) {
    console.error('[Webhook] Error:', error);
    res.status(500).json({ error: 'Failed to book appointment' });
  }
});

/**
 * Health check
 */
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'ava-booking-webhook' });
});

// Start server
app.listen(WEBHOOK_PORT, () => {
  console.log(`[Ava Booking Webhook] Running on port ${WEBHOOK_PORT}`);
  console.log(`[Ava Booking Webhook] Endpoints:`);
  console.log(`  POST /get-available-slots`);
  console.log(`  POST /book-appointment`);
  console.log(`  GET  /health`);
});

export { app, findOrCreateContact, getAvailableSlots, bookAppointment };
