#!/usr/bin/env ts-node
import 'dotenv/config';

import { getChannelGaps, getProspectHistory, queueEmail, updateProspect } from '../tools';
import { listCampaigns, listLeads } from '../channels/instantly-adapter';

const MAX_PER_RUN = 5;

function sanitizeEmail(input: string): string {
  return String(input)
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF\u00A0]/g, '')
    .replace(/\s+/g, '')
    .trim()
    .toLowerCase();
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function alreadyEmailed(history: any[]): boolean {
  return history.some((t) =>
    t?.channel === 'email' &&
    (t?.action === 'cold_email' || t?.outcome === 'sent' || t?.outcome === 'queued')
  );
}

function composeEmail(p: any): { subject: string; body: string } {
  const company = p.company || 'your business';
  const firstName = (p.name || '').split(' ')[0] || 'there';
  const industry = p.industry || 'service business';
  const location = p.location ? ` in ${p.location}` : '';

  const subject = `Quick idea for ${company}`;
  const body = `Hi ${firstName} — I took a look at ${company}${location} and wanted to share one quick idea. For ${industry} businesses, we usually see the biggest lift by tightening the mobile booking path and making the first CTA impossible to miss. At RenderWiseAI, we help teams convert more website traffic into real leads with conversion-focused redesigns plus 24/7 AI lead capture. If helpful, I can send a short teardown with the top fixes first. https://renderwiseai.com/calendar\n\nJake\nRenderWiseAI`;

  return { subject, body };
}

async function buildInstantlySeenEmailSet(): Promise<Set<string>> {
  const seen = new Set<string>();
  const campaigns = await listCampaigns();

  for (const c of campaigns) {
    const name = (c.name || '').toLowerCase();
    if (!name.includes('hunter outbound') && !name.includes('renderwise outbound')) continue;

    const leads = await listLeads(c.id);
    for (const lead of leads) {
      if (lead?.email) seen.add(String(lead.email).toLowerCase().trim());
    }
  }

  return seen;
}

async function main() {
  const gaps = await getChannelGaps();
  const emailCandidates = (gaps.prospects || []).filter((g: any) => g.missingChannel === 'email');
  const instantlySeenEmails = await buildInstantlySeenEmailSet();

  const results: Array<{ prospectId: string; email?: string; queued: boolean; reason?: string }> = [];

  for (const row of emailCandidates) {
    if (results.filter((r) => r.queued).length >= MAX_PER_RUN) break;

    const p = row.prospect;
    if (!p?.id || !p?.email) {
      results.push({ prospectId: p?.id || 'unknown', queued: false, reason: 'missing prospect id/email' });
      continue;
    }

    const originalEmail = String(p.email);
    const emailLower = sanitizeEmail(originalEmail);

    if (emailLower !== originalEmail) {
      await updateProspect(p.id, { email: emailLower });
      p.email = emailLower;
    }

    if (!isValidEmail(emailLower)) {
      results.push({ prospectId: p.id, email: originalEmail, queued: false, reason: 'invalid email format after sanitize' });
      continue;
    }

    const history = await getProspectHistory(p.id);
    if (alreadyEmailed(history)) {
      await updateProspect(p.id, { emailState: 'sent' });
      results.push({ prospectId: p.id, email: p.email, queued: false, reason: 'already emailed (history) — synced emailState=sent' });
      continue;
    }

    if (instantlySeenEmails.has(emailLower)) {
      await updateProspect(p.id, { emailState: 'sent' });
      results.push({ prospectId: p.id, email: p.email, queued: false, reason: 'already present in Instantly lead history — synced emailState=sent' });
      continue;
    }

    const { subject, body } = composeEmail(p);
    try {
      const queuedResult = await queueEmail(p.id, subject, body);
      if (queuedResult?.success) {
        await updateProspect(p.id, { emailState: 'sent' });
        results.push({ prospectId: p.id, email: p.email, queued: true });
      } else {
        results.push({ prospectId: p.id, email: p.email, queued: false, reason: queuedResult?.error?.message || 'queue failed' });
      }
    } catch (err: any) {
      results.push({ prospectId: p.id, email: p.email, queued: false, reason: err?.message || String(err) });
    }
  }

  const queued = results.filter((r) => r.queued).length;
  console.log(JSON.stringify({
    ok: true,
    ranAt: new Date().toISOString(),
    queued,
    checked: results.length,
    maxPerRun: MAX_PER_RUN,
    results,
  }, null, 2));
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: err?.message || String(err) }, null, 2));
  process.exit(1);
});
