// Discord webhook notifier for Hunter/dialer progress
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const DISCORD_WEBHOOK_VOICE = process.env.DISCORD_WEBHOOK_VOICE;
const DISCORD_WEBHOOK_DIALER = process.env.DISCORD_WEBHOOK_DIALER;

interface CallStats {
  total: number;
  interested: number;
  voicemail: number;
  notInterested: number;
  callback: number;
  failed: number;
  totalDuration: number;
}

export async function getTodayCallStats(): Promise<CallStats> {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  
  const today = new Date().toISOString().split('T')[0];
  
  const { data: calls } = await supabase
    .from('call_logs')
    .select('outcome, status, duration_seconds')
    .gte('created_at', `${today}T00:00:00Z`);
  
  const stats: CallStats = {
    total: calls?.length || 0,
    interested: 0,
    voicemail: 0,
    notInterested: 0,
    callback: 0,
    failed: 0,
    totalDuration: 0
  };
  
  for (const call of calls || []) {
    if (call.outcome === 'interested' || call.outcome === 'booked') stats.interested++;
    else if (call.outcome === 'voicemail') stats.voicemail++;
    else if (call.outcome === 'not_interested') stats.notInterested++;
    else if (call.outcome === 'callback') stats.callback++;
    else if (call.outcome === 'failed' || call.status === 'failed') stats.failed++;
    
    stats.totalDuration += call.duration_seconds || 0;
  }
  
  return stats;
}

export async function postToDiscord(webhookUrl: string, content: any): Promise<void> {
  if (!webhookUrl) return;
  
  const body = typeof content === 'string' 
    ? { content } 
    : { embeds: [content] };
  
  const req = new Request(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  
  await fetch(req);
}

export async function postDialerUpdate(): Promise<void> {
  const stats = await getTodayCallStats();
  
  const embed = {
    title: '📞 Dialer Update',
    color: 0x00FF00,
    fields: [
      { name: 'Total Calls', value: stats.total.toString(), inline: true },
      { name: 'Interested', value: stats.interested.toString(), inline: true },
      { name: 'Voicemail', value: stats.voicemail.toString(), inline: true },
      { name: 'Callbacks', value: stats.callback.toString(), inline: true },
      { name: 'Duration', value: `${Math.round(stats.totalDuration / 60)}m`, inline: true }
    ],
    timestamp: new Date().toISOString()
  };
  
  if (DISCORD_WEBHOOK_DIALER) {
    await postToDiscord(DISCORD_WEBHOOK_DIALER, embed);
  }
  
  console.log('[DiscordNotifier] Posted dialer update:', stats);
}
