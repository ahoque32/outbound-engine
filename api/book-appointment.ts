import type { VercelRequest, VercelResponse } from '@vercel/node';

const GHL_API_KEY = process.env.GHL_API_KEY || '';
const GHL_LOCATION_ID = process.env.GHL_LOCATION_ID || '';
const GHL_CALENDAR_ID = process.env.GHL_CALENDAR_ID || '';
const GHL_USER_ID = process.env.GHL_USER_ID || '';
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_KEY || '';

function ghlHeaders() {
  return {
    'Authorization': `Bearer ${GHL_API_KEY}`,
    'Version': '2021-04-15',
    'Content-Type': 'application/json',
  };
}

async function findOrCreateContact(data: { firstName: string; lastName?: string; email?: string; phone: string; company?: string; }): Promise<string | null> {
  const searchRes = await fetch(
    `https://services.leadconnectorhq.com/contacts/search/duplicate?locationId=${GHL_LOCATION_ID}&number=${encodeURIComponent(data.phone)}`,
    { headers: ghlHeaders() }
  );
  const searchData = await searchRes.json() as any;
  if (searchData.contact?.id) return searchData.contact.id;

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
      source: 'AI Cold Call - Ava',
      tags: ['ai-outbound', 'ava-booked'],
    }),
  });
  const createData = await createRes.json() as any;
  return createData.contact?.id || null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { first_name, last_name, email, phone, company, preferred_time, conversation_id } = req.body;

    if (!first_name || !phone || !preferred_time) {
      return res.status(400).json({ error: 'Missing required: first_name, phone, preferred_time' });
    }

    const contactId = await findOrCreateContact({ firstName: first_name, lastName: last_name, email, phone, company });
    if (!contactId) return res.status(500).json({ error: 'Failed to create contact' });

    const startTime = new Date(preferred_time).toISOString();
    const endTime = new Date(new Date(preferred_time).getTime() + 30 * 60000).toISOString();

    const aptRes = await fetch('https://services.leadconnectorhq.com/calendars/events/appointments', {
      method: 'POST',
      headers: ghlHeaders(),
      body: JSON.stringify({
        calendarId: GHL_CALENDAR_ID,
        locationId: GHL_LOCATION_ID,
        contactId,
        startTime,
        endTime,
        title: `Discovery Call - ${first_name} ${last_name || ''} (${company || 'N/A'})`,
        appointmentStatus: 'confirmed',
        assignedUserId: GHL_USER_ID,
        notes: `Booked by Ava (AI) during cold call. Phone: ${phone}`,
      }),
    });

    const aptData = await aptRes.json() as any;
    const dateStr = new Date(preferred_time).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    const timeStr = new Date(preferred_time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

    // Update call_logs if conversation_id provided
    if (conversation_id && SUPABASE_URL && SUPABASE_KEY) {
      try {
        await fetch(`${SUPABASE_URL}/rest/v1/call_logs?conversation_id=eq.${encodeURIComponent(conversation_id)}`, {
          method: 'PATCH',
          headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ booking_made: true, outcome: 'booked' }),
        });
      } catch (e) {
        console.error('[book-appointment] Failed to update call_logs:', e);
      }
    }

    res.json({
      success: true,
      message: `Discovery call booked for ${first_name} on ${dateStr} at ${timeStr}. They will receive a calendar invite with a Google Meet link.`,
      appointment_id: aptData?.id,
      contact_id: contactId,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
}
