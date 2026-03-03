/**
 * Instantly.ai API v2 Adapter — Clean rewrite (Mar 2026)
 * 
 * Verified endpoints:
 * - GET  /accounts?limit=100
 * - POST /campaigns (requires campaign_schedule)
 * - PATCH /campaigns/:id (email_list for senders, sequences for steps)
 * - POST /campaigns/:id/activate (needs body: {})
 * - POST /campaigns/:id/deactivate
 * - GET/DELETE /campaigns/:id
 * - POST /leads
 * - GET /leads?campaign_id=x&limit=100
 * 
 * Quirks:
 * - Timezone: use "America/Detroit" not "America/New_York"
 * - All list endpoints max limit=100
 * - activate/deactivate need body: {} (not empty)
 * - email_list on PATCH = sender account emails
 * - sequences on PATCH = email sequence steps
 */

import 'dotenv/config';

const BASE_URL = 'https://api.instantly.ai/api/v2';
const API_KEY = process.env.INSTANTLY_API_KEY || '';
const MAX_LIMIT = 100;
const TIMEOUT_MS = 15000;
const RATE_LIMIT_MS = 500;

let lastRequestTime = 0;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface InstantlyAccount {
  email: string;
  status: number;
  warmup_score?: number;
  [key: string]: any;
}

export interface Campaign {
  id: string;
  name: string;
  status: number; // 0=draft, 1=active, 2=paused
  campaign_schedule?: any;
  [key: string]: any;
}

export interface Lead {
  id: string;
  email: string;
  first_name?: string;
  last_name?: string;
  company_name?: string;
  status: number;
  [key: string]: any;
}

export interface EmailVariant {
  subject: string;
  body: string;
}

export interface SequenceStep {
  type: 'email';
  delay: number;
  variants: EmailVariant[];
}

export interface Sequence {
  steps: SequenceStep[];
}

// ── Request helper ────────────────────────────────────────────────────────────

async function req<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const now = Date.now();
  const wait = RATE_LIMIT_MS - (now - lastRequestTime);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastRequestTime = Date.now();

  const url = `${BASE_URL}${endpoint}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    console.log(`[Instantly] ${options.method || 'GET'} ${endpoint}`);
    const resp = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
        ...(options.headers as Record<string, string> || {}),
      },
      signal: controller.signal,
    });

    clearTimeout(timer);
    const text = await resp.text();
    if (!resp.ok) throw new Error(`Instantly ${resp.status}: ${text.slice(0, 300)}`);
    if (!text.trim()) return {} as T;
    return JSON.parse(text) as T;
  } finally {
    clearTimeout(timer);
  }
}

// ── Accounts ──────────────────────────────────────────────────────────────────

export async function listAccounts(): Promise<InstantlyAccount[]> {
  const d = await req<{ items?: InstantlyAccount[] }>(`/accounts?limit=${MAX_LIMIT}`);
  return d.items || [];
}

export async function getHealthySenders(minScore = 80): Promise<string[]> {
  const accounts = await listAccounts();
  return accounts
    .filter(a => a.status === 1 && (a.warmup_score === undefined || a.warmup_score >= minScore))
    .map(a => a.email)
    .filter(e => e !== 'contact@renderwise.net'); // exclude main domain
}

// ── Campaigns ─────────────────────────────────────────────────────────────────

export async function listCampaigns(): Promise<Campaign[]> {
  const d = await req<{ items?: Campaign[] }>(`/campaigns?limit=${MAX_LIMIT}`);
  return d.items || [];
}

export async function getCampaign(id: string): Promise<Campaign> {
  return req<Campaign>(`/campaigns/${id}`);
}

export async function createCampaign(
  name: string,
  senders: string[],
  sequences: Sequence[],
  options?: { timezone?: string; from?: string; to?: string; days?: Record<string, boolean> }
): Promise<Campaign> {
  const tz = options?.timezone || 'America/Detroit';
  const from = options?.from || '09:00';
  const to = options?.to || '17:00';
  const days = options?.days || { '1': true, '2': true, '3': true, '4': true, '5': true };

  // Create with schedule
  const campaign = await req<Campaign>('/campaigns', {
    method: 'POST',
    body: JSON.stringify({
      name,
      campaign_schedule: {
        schedules: [{ name: 'Schedule', timing: { from, to }, days, timezone: tz }],
      },
    }),
  });

  // Map senders + set sequences
  await req(`/campaigns/${campaign.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ email_list: senders, sequences }),
  });

  console.log(`[Instantly] Created campaign "${name}" (${campaign.id}) with ${senders.length} senders`);
  return campaign;
}

export async function activateCampaign(id: string): Promise<void> {
  await req(`/campaigns/${id}/activate`, { method: 'POST', body: '{}' });
}

export async function deactivateCampaign(id: string): Promise<void> {
  await req(`/campaigns/${id}/deactivate`, { method: 'POST', body: '{}' });
}

export async function deleteCampaign(id: string): Promise<void> {
  await req(`/campaigns/${id}`, { method: 'DELETE' });
}

// ── Leads ─────────────────────────────────────────────────────────────────────

export async function addLead(
  campaignId: string,
  email: string,
  data?: { firstName?: string; lastName?: string; companyName?: string; website?: string; phone?: string; custom?: Record<string, string> }
): Promise<Lead> {
  const body: any = { campaign_id: campaignId, email };
  if (data?.firstName) body.first_name = data.firstName;
  if (data?.lastName) body.last_name = data.lastName;
  if (data?.companyName) body.company_name = data.companyName;
  if (data?.website) body.website = data.website;
  if (data?.phone) body.phone = data.phone;
  if (data?.custom) body.custom_variables = data.custom;
  return req<Lead>('/leads', { method: 'POST', body: JSON.stringify(body) });
}

export async function listLeads(campaignId: string): Promise<Lead[]> {
  const d = await req<{ items?: Lead[] }>(`/leads/list`, { method: 'POST', body: JSON.stringify({ campaign_id: campaignId, limit: MAX_LIMIT }) });
  return d.items || [];
}

// ── Convenience: full send flow ───────────────────────────────────────────────

export async function sendCampaign(
  name: string,
  senders: string[],
  sequences: Sequence[],
  leads: Array<{ email: string; firstName?: string; lastName?: string; companyName?: string; website?: string }>
): Promise<string> {
  const campaign = await createCampaign(name, senders, sequences);
  for (const lead of leads) {
    await addLead(campaign.id, lead.email, lead);
  }
  await activateCampaign(campaign.id);
  console.log(`[Instantly] Campaign "${name}" activated with ${leads.length} leads`);
  return campaign.id;
}

// ── Class wrapper for backward compat ─────────────────────────────────────────

export class InstantlyAdapter {
  listAccounts = listAccounts;
  getHealthySenders = getHealthySenders;
  listCampaigns = listCampaigns;
  getCampaign = getCampaign;
  createCampaign = createCampaign;
  activateCampaign = activateCampaign;
  deactivateCampaign = deactivateCampaign;
  deleteCampaign = deleteCampaign;
  addLead = addLead;
  listLeads = listLeads;
  sendCampaign = sendCampaign;
}

export default InstantlyAdapter;
