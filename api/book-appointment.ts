import type { VercelRequest, VercelResponse } from '@vercel/node';

const GHL_API_KEY = process.env.GHL_API_KEY || '';
const GHL_LOCATION_ID = process.env.GHL_LOCATION_ID || '';
const GHL_CALENDAR_ID = process.env.GHL_CALENDAR_ID || '';
const GHL_USER_ID = process.env.GHL_USER_ID || '';

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
    const { first_name, last_name, email, phone, company, company_name, preferred_time } = req.body;
    // Support company_name from dynamic variables, fall back to company
    const companyValue = company_name || company;

    if (!first_name || !phone || !preferred_time) {
      return res.status(400).json({ error: 'Missing required: first_name, phone, preferred_time' });
    }

    const contactId = await findOrCreateContact({ firstName: first_name, lastName: last_name, email, phone, company: companyValue });
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
        title: `Discovery Call - ${first_name} ${last_name || ''} (${companyValue || 'N/A'})`,
        appointmentStatus: 'confirmed',
        assignedUserId: GHL_USER_ID,
        notes: `Booked by Ava (AI) during cold call. Phone: ${phone}`,
      }),
    });

    const aptData = await aptRes.json() as any;
    const dateStr = new Date(preferred_time).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    const timeStr = new Date(preferred_time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

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
