import { voiceAgent } from '../dialer/voice-agent';

async function main() {
  const c: any = await voiceAgent.getConversation('conv_0001kk2190f8f19v46dz32c4kfcf');
  const t = Array.isArray(c?.transcript) ? c.transcript : [];
  const lines = t
    .map((x: any, i: number) => {
      const role = x?.role === 'agent' ? 'Agent' : x?.role === 'user' ? 'Prospect' : 'Other';
      const raw = x?.message || x?.original_message || '';
      const msg = String(raw).replace(/\s+/g, ' ').trim();
      if (!msg) return '';
      return `${i + 1}. ${role}: ${msg}`;
    })
    .filter(Boolean);

  console.log(lines.join('\n\n'));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
