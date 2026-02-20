// Sequence Runner — executes due email steps from Supabase
import 'dotenv/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { EmailAdapter } from '../channels/email-adapter';

// Warmup rate limits per inbox per day
const WARMUP_DAILY_LIMIT = 30;

interface SequenceStep {
  day: number;
  channel: string;
  action: string;
  subject?: string;
  body?: string;
}

interface SequenceRow {
  id: string;
  campaign_id: string;
  prospect_id: string;
  current_step: number;
  status: string;
  started_at: string;
}

interface ProspectRow {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
}

interface CampaignRow {
  id: string;
  name: string;
  status: string;
  sequence_template: { steps: SequenceStep[] } | null;
}

export class SequenceRunner {
  private supabase: SupabaseClient;
  private emailAdapter: EmailAdapter;

  constructor() {
    const url = process.env.SUPABASE_URL!;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required');
    this.supabase = createClient(url, key);
    this.emailAdapter = new EmailAdapter();
  }

  async runBatch(): Promise<{ sent: number; skipped: number; errors: number }> {
    console.log('[Runner] Starting batch run...');
    const stats = { sent: 0, skipped: 0, errors: 0 };

    // 1. Get active campaigns with sequence templates
    const { data: campaigns, error: cErr } = await this.supabase
      .from('campaigns')
      .select('*')
      .eq('status', 'active');

    if (cErr || !campaigns?.length) {
      console.log('[Runner] No active campaigns found');
      return stats;
    }

    for (const campaign of campaigns as CampaignRow[]) {
      console.log(`[Runner] Campaign: ${campaign.name} (${campaign.id})`);
      const template = campaign.sequence_template;
      if (!template?.steps?.length) {
        console.log('[Runner] No sequence template, skipping');
        continue;
      }

      // 2. Get active sequences for this campaign
      const { data: sequences } = await this.supabase
        .from('sequences')
        .select('*')
        .eq('campaign_id', campaign.id)
        .eq('status', 'active');

      if (!sequences?.length) {
        console.log('[Runner] No active sequences');
        continue;
      }

      console.log(`[Runner] ${sequences.length} active sequences`);

      // 3. Process each sequence
      for (const seq of sequences as SequenceRow[]) {
        const step = template.steps[seq.current_step];
        if (!step) {
          // Sequence complete
          console.log(`[Runner] Sequence ${seq.id} complete — no more steps`);
          await this.supabase
            .from('sequences')
            .update({ status: 'completed', completed_at: new Date().toISOString() })
            .eq('id', seq.id);
          continue;
        }

        // Check if it's time for this step (days since start)
        const startedAt = new Date(seq.started_at);
        const daysSinceStart = Math.floor((Date.now() - startedAt.getTime()) / (1000 * 60 * 60 * 24));
        if (daysSinceStart < step.day) {
          console.log(`[Runner] Sequence ${seq.id} step ${seq.current_step}: not due yet (day ${daysSinceStart}/${step.day})`);
          stats.skipped++;
          continue;
        }

        if (step.channel !== 'email') {
          console.log(`[Runner] Skipping non-email step: ${step.channel}`);
          stats.skipped++;
          continue;
        }

        // 4. Get prospect
        const { data: prospect } = await this.supabase
          .from('prospects')
          .select('*')
          .eq('id', seq.prospect_id)
          .single();

        if (!prospect) {
          console.log(`[Runner] Prospect ${seq.prospect_id} not found`);
          stats.errors++;
          continue;
        }

        // 5. Check rate limit for sender inbox
        const canSend = await this.checkRateLimit(prospect.email);
        if (!canSend.allowed) {
          console.log(`[Runner] Rate limited: ${canSend.reason}`);
          stats.skipped++;
          continue;
        }

        // 6. Personalize and send
        const subject = this.personalize(step.subject || 'Quick question', prospect);
        const body = this.personalize(step.body || '', prospect);

        const prospectObj = {
          id: prospect.id,
          name: [prospect.first_name, prospect.last_name].filter(Boolean).join(' ') || prospect.email,
          email: prospect.email,
          company: prospect.company,
          emailState: 'not_sent' as const,
          // Minimal fields needed
          campaignId: seq.campaign_id,
          title: '',
          linkedinUrl: prospect.linkedin_url,
          xHandle: prospect.x_handle,
          website: prospect.website,
          industry: prospect.industry,
          companySize: '',
          location: prospect.city || '',
          state: 'contacted' as any,
          linkedinState: 'not_connected' as any,
          xState: 'not_following' as any,
          voiceState: 'not_called' as any,
          score: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        const result = await this.emailAdapter.sendColdEmail(prospectObj, subject, body);

        if (result.success) {
          // 7. Record touchpoint
          await this.supabase.from('touchpoints').insert({
            sequence_id: seq.id,
            prospect_id: prospect.id,
            channel: 'email',
            action: step.action || 'cold_email',
            content: `${subject}\n\n${body}`,
            outcome: 'sent',
            sent_at: new Date().toISOString(),
          });

          // 8. Advance sequence
          await this.supabase
            .from('sequences')
            .update({ current_step: seq.current_step + 1 })
            .eq('id', seq.id);

          // 9. Update rate limit
          await this.incrementRateLimit(result.metadata?.from || 'unknown');

          // 10. Update prospect status
          await this.supabase
            .from('prospects')
            .update({ status: 'contacted' })
            .eq('id', prospect.id)
            .eq('status', 'new');

          stats.sent++;
          console.log(`[Runner] ✓ Sent step ${seq.current_step} to ${prospect.email}`);
        } else {
          stats.errors++;
          console.log(`[Runner] ✗ Failed for ${prospect.email}: ${result.error}`);
        }

        // Human-like delay between sends
        await new Promise(r => setTimeout(r, 2000 + Math.random() * 3000));
      }
    }

    console.log(`[Runner] Batch complete: ${stats.sent} sent, ${stats.skipped} skipped, ${stats.errors} errors`);
    return stats;
  }

  private personalize(template: string, prospect: any): string {
    return template
      .replace(/\{first_name\}/g, prospect.first_name || 'there')
      .replace(/\{last_name\}/g, prospect.last_name || '')
      .replace(/\{company\}/g, prospect.company || 'your company')
      .replace(/\{business_name\}/g, prospect.company || 'your business')
      .replace(/\{email\}/g, prospect.email || '')
      .replace(/\{city\}/g, prospect.city || 'your area')
      .replace(/\{industry\}/g, prospect.industry || 'your industry')
      .replace(/\{region\}/g, prospect.city || 'your area');
  }

  private async checkRateLimit(prospectEmail: string): Promise<{ allowed: boolean; reason?: string }> {
    const today = new Date().toISOString().split('T')[0];

    // Check all inboxes - find total daily sends
    const { data: limits } = await this.supabase
      .from('rate_limits')
      .select('*')
      .eq('channel', 'email')
      .eq('date', today);

    // Check per-inbox limits
    for (const limit of limits || []) {
      if (limit.daily_count >= WARMUP_DAILY_LIMIT) {
        // This inbox is maxed, but others might be available
        continue;
      }
    }

    // Total across all inboxes
    const totalSent = (limits || []).reduce((sum: number, l: any) => sum + (l.daily_count || 0), 0);
    const totalLimit = EmailAdapter.getSenderInboxes().length * WARMUP_DAILY_LIMIT;

    if (totalSent >= totalLimit) {
      return { allowed: false, reason: `Daily total limit reached (${totalSent}/${totalLimit})` };
    }

    return { allowed: true };
  }

  private async incrementRateLimit(inboxEmail: string): Promise<void> {
    const today = new Date().toISOString().split('T')[0];

    // Try to upsert
    const { data: existing } = await this.supabase
      .from('rate_limits')
      .select('*')
      .eq('channel', 'email')
      .eq('inbox_email', inboxEmail)
      .eq('date', today)
      .single();

    if (existing) {
      await this.supabase
        .from('rate_limits')
        .update({ daily_count: (existing.daily_count || 0) + 1 })
        .eq('id', existing.id);
    } else {
      await this.supabase.from('rate_limits').insert({
        channel: 'email',
        inbox_email: inboxEmail,
        daily_count: 1,
        hourly_count: 1,
        date: today,
      });
    }
  }
}
