import type { VercelRequest, VercelResponse } from '@vercel/node';

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || '';
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_KEY || '';

function supabaseHeaders() {
  return {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation',
  };
}

async function supabaseInsert(table: string, data: any) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: supabaseHeaders(),
    body: JSON.stringify(data),
  });
  return res.json();
}

async function supabaseUpdate(table: string, match: Record<string, string>, data: any) {
  const params = Object.entries(match).map(([k, v]) => `${k}=eq.${encodeURIComponent(v)}`).join('&');
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${params}`, {
    method: 'PATCH',
    headers: supabaseHeaders(),
    body: JSON.stringify(data),
  });
  return res.json();
}

async function supabaseSelect(table: string, query: string) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
    },
  });
  return res.json();
}

async function fetchConversation(conversationId: string) {
  const res = await fetch(`https://api.elevenlabs.io/v1/convai/conversations/${conversationId}`, {
    headers: { 'xi-api-key': ELEVENLABS_API_KEY },
  });
  if (!res.ok) throw new Error(`ElevenLabs API error: ${res.status}`);
  return res.json();
}

function analyzeOutcome(transcript: Array<{ role: string; content: string }>): string {
  const text = transcript.map(t => t.content).join(' ').toLowerCase();

  const patterns: Array<[RegExp, string]> = [
    [/\b(booked|appointment|scheduled|set up a time|confirmed)\b/, 'booked'],
    [/\b(not interested|no thanks|no thank you|remove me|don't call|stop calling)\b/, 'not_interested'],
    [/\b(call back|call me later|try again|busy right now|bad time)\b/, 'callback'],
    [/\b(voicemail|leave a message|not available|after the (beep|tone))\b/, 'voicemail'],
    [/\b(interested|tell me more|sounds good|sounds great|send me info|learn more)\b/, 'interested'],
  ];

  for (const [regex, outcome] of patterns) {
    if (regex.test(text)) return outcome;
  }
  return 'unknown';
}

function buildSummary(transcript: Array<{ role: string; content: string }>, outcome: string): string {
  const turns = transcript.length;
  const prospectMessages = transcript.filter(t => t.role === 'user').length;
  return `Call with ${turns} turns (${prospectMessages} from prospect). Outcome: ${outcome}.`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { conversation_id } = req.body;
    if (!conversation_id) {
      return res.status(400).json({ error: 'Missing conversation_id' });
    }

    console.log(`[post-call-webhook] Processing conversation: ${conversation_id}`);

    // Fetch full conversation from ElevenLabs
    const convo = await fetchConversation(conversation_id);

    // Extract transcript
    const transcript = (convo.transcript || []).map((t: any) => ({
      role: t.role || 'unknown',
      content: t.message || t.content || '',
      timestamp: t.time_in_call_secs || null,
    }));

    // Determine duration
    const durationSeconds = convo.metadata?.call_duration_secs
      || convo.call_duration_secs
      || (transcript.length > 0 ? Math.ceil(transcript[transcript.length - 1].timestamp || 0) : null);

    // Analyze outcome
    const outcome = analyzeOutcome(transcript);
    const summary = buildSummary(transcript, outcome);
    const callbackRequested = outcome === 'callback';
    const bookingMade = outcome === 'booked';

    // Try to find prospect by phone
    const phone = convo.metadata?.caller_id || convo.metadata?.phone_number || convo.phone_number || null;
    let prospectId: string | null = null;
    let prospectName: string | null = null;

    if (phone) {
      const prospects = await supabaseSelect('prospects', `phone=eq.${encodeURIComponent(phone)}&limit=1`);
      if (Array.isArray(prospects) && prospects.length > 0) {
        prospectId = prospects[0].id;
        prospectName = [prospects[0].first_name, prospects[0].last_name].filter(Boolean).join(' ') || null;
      }
    }

    // Insert call log
    const callLog = {
      conversation_id,
      prospect_id: prospectId,
      prospect_phone: phone,
      prospect_name: prospectName,
      call_sid: convo.metadata?.call_sid || convo.call_sid || null,
      status: 'completed',
      outcome,
      duration_seconds: durationSeconds,
      transcript,
      summary,
      booking_made: bookingMade,
      callback_requested: callbackRequested,
      elevenlabs_data: convo,
    };

    const inserted = await supabaseInsert('call_logs', callLog);
    console.log(`[post-call-webhook] Inserted call log:`, JSON.stringify(inserted));

    // Update prospect status if matched
    if (prospectId) {
      const statusMap: Record<string, string> = {
        booked: 'booked',
        interested: 'interested',
        not_interested: 'not_interested',
        callback: 'callback',
        voicemail: 'voicemail',
      };
      const newStatus = statusMap[outcome];
      if (newStatus) {
        await supabaseUpdate('prospects', { id: prospectId }, { status: newStatus });
      }
    }

    res.json({ success: true, conversation_id, outcome });
  } catch (error: any) {
    console.error('[post-call-webhook] Error:', error);
    res.status(500).json({ error: error.message });
  }
}
