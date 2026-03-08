import { EmailAdapter } from '../channels/email-adapter';
import * as instantly from '../channels/instantly-adapter';
import { getSupabaseClient, toErrorMessage } from './shared';
import { EmailResult, EmailStatus } from './types';
import { getProspect } from './prospects';

const BLOCKED_SENDER_DOMAINS = ['renderwise.net', 'renderwiseai.com'];

function isBlockedDomain(email: string): boolean {
  const domain = email.split('@')[1]?.toLowerCase() || '';
  return BLOCKED_SENDER_DOMAINS.includes(domain);
}

function mapInstantlyLeadStatus(code: number | undefined): string | undefined {
  if (code === undefined) return undefined;

  const map: Record<number, string> = {
    0: 'queued',
    1: 'sent',
    2: 'opened',
    3: 'replied',
    4: 'bounced',
  };

  return map[code] || `status_${code}`;
}

/**
 * Queues a custom cold email in today's Instantly campaign for a prospect.
 */
export async function queueEmail(prospectId: string, subject: string, body: string): Promise<EmailResult> {
  try {
    const prospect = await getProspect(prospectId);

    if (!prospect.email) {
      return {
        success: false,
        prospectId,
        error: { code: 'MISSING_EMAIL', message: 'Prospect has no email address' },
      };
    }

    const adapter = new EmailAdapter();
    const result = await adapter.sendColdEmail(prospect, subject, body);

    if (!result.success) {
      return {
        success: false,
        prospectId,
        email: prospect.email,
        outcome: result.outcome,
        error: { code: 'QUEUE_FAILED', message: result.error || 'Failed to queue email' },
      };
    }

    const campaignId = typeof result.metadata?.campaignId === 'string' ? result.metadata.campaignId : undefined;

    // Keep local state in sync for reporting/watchdog logic.
    try {
      const supabase = getSupabaseClient();
      await supabase.from('prospects').update({ email_state: 'sent' }).eq('id', prospectId);
      await supabase.from('touchpoints').insert({
        prospect_id: prospectId,
        campaign_id: campaignId || null,
        channel: 'email',
        action: 'cold_email',
        content: `${subject}\n\n${body}`,
        outcome: 'sent',
        sent_at: new Date().toISOString(),
      });
    } catch (syncError) {
      // Non-fatal: queueing succeeded; keep tool result successful.
      console.error('[EmailTool] Post-queue sync warning:', toErrorMessage(syncError));
    }

    return {
      success: true,
      prospectId,
      email: prospect.email,
      campaignId,
      outcome: result.outcome || 'queued',
    };
  } catch (error) {
    return {
      success: false,
      prospectId,
      error: {
        code: 'EMAIL_TOOL_ERROR',
        message: toErrorMessage(error),
      },
    };
  }
}

/**
 * Looks up Instantly + Supabase webhook events for delivery/open/reply status.
 */
export async function getEmailStatus(prospectEmail: string): Promise<EmailStatus> {
  try {
    const emailLc = prospectEmail.toLowerCase();
    const campaigns = await instantly.listCampaigns();

    let instantlyStatusCode: number | undefined;
    let campaignId: string | undefined;
    let campaignName: string | undefined;
    let existsInInstantly = false;

    for (const campaign of campaigns) {
      const leads = await instantly.listLeads(campaign.id);
      const lead = leads.find((item) => item.email?.toLowerCase() === emailLc);
      if (!lead) continue;

      existsInInstantly = true;
      instantlyStatusCode = lead.status;
      campaignId = campaign.id;
      campaignName = campaign.name;
      break;
    }

    const supabase = getSupabaseClient();
    const { data: events, error: eventErr } = await supabase
      .from('email_events')
      .select('event_type,created_at')
      .eq('prospect_email', prospectEmail)
      .order('created_at', { ascending: false })
      .limit(50);

    if (eventErr) {
      return {
        success: false,
        prospectEmail,
        existsInInstantly,
        campaignId,
        campaignName,
        instantlyStatusCode,
        instantlyStatusLabel: mapInstantlyLeadStatus(instantlyStatusCode),
        delivered: false,
        opened: false,
        replied: false,
        bounced: false,
        error: { code: 'EMAIL_EVENTS_READ_FAILED', message: eventErr.message },
      };
    }

    const delivered = Boolean(events?.some((event) => event.event_type === 'email_sent')) || instantlyStatusCode === 1;
    const opened = Boolean(events?.some((event) => event.event_type === 'email_opened')) || instantlyStatusCode === 2;
    const replied = Boolean(events?.some((event) => event.event_type === 'reply_received')) || instantlyStatusCode === 3;
    const bounced =
      Boolean(events?.some((event) => event.event_type === 'lead_unsubscribed')) || instantlyStatusCode === 4;
    const latestEvent = events?.[0];

    return {
      success: true,
      prospectEmail,
      existsInInstantly,
      campaignId,
      campaignName,
      instantlyStatusCode,
      instantlyStatusLabel: mapInstantlyLeadStatus(instantlyStatusCode),
      delivered,
      opened,
      replied,
      bounced,
      lastEventType: latestEvent?.event_type,
      lastEventAt: latestEvent?.created_at,
    };
  } catch (error) {
    return {
      success: false,
      prospectEmail,
      existsInInstantly: false,
      delivered: false,
      opened: false,
      replied: false,
      bounced: false,
      error: {
        code: 'EMAIL_STATUS_ERROR',
        message: toErrorMessage(error),
      },
    };
  }
}

/**
 * Returns healthy Instantly sender accounts (warmup score >= 80) excluding blocked domains.
 */
export async function listHealthySenders(): Promise<string[]> {
  const senders = await instantly.getHealthySenders(80);
  return senders.filter((sender) => !isBlockedDomain(sender));
}
