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

// DB Row types (snake_case)
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
  name: string | null;
  company: string | null | undefined;
  company_name: string | null | undefined;
  linkedin_url: string | null;
  x_handle: string | null;
  website: string | null;
  industry: string | null;
  city: string | null;
  state: string | null;
  
  location: string | null;
  product_service: string | null;
  specific_detail: string | null;
  desired_benefit: string | null;
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
    console.log('[DB] Fetching active campaigns...');
    const { data: campaigns, error: cErr } = await this.supabase
      .from('campaigns')
      .select('*')
      .eq('status', 'active');

    if (cErr) {
      console.error('[DB] Error fetching campaigns:', cErr);
      return stats;
    }

    if (!campaigns?.length) {
      console.log('[Runner] No active campaigns found');
      return stats;
    }

    console.log(`[Runner] Found ${campaigns.length} active campaigns`);

    for (const campaign of campaigns as CampaignRow[]) {
      console.log(`[Runner] Campaign: ${campaign.name} (${campaign.id})`);
      const template = campaign.sequence_template;
      if (!template?.steps?.length) {
        console.log('[Runner] No sequence template, skipping');
        continue;
      }

      // 2. Get active sequences for this campaign
      console.log(`[DB] Fetching active sequences for campaign ${campaign.id}...`);
      const { data: sequences, error: seqErr } = await this.supabase
        .from('sequences')
        .select('*')
        .eq('campaign_id', campaign.id)
        .eq('status', 'active');

      if (seqErr) {
        console.error('[DB] Error fetching sequences:', seqErr);
        continue;
      }

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
          console.log(`[DB] Marking sequence ${seq.id} as completed...`);
          const { error: updateErr } = await this.supabase
            .from('sequences')
            .update({ status: 'completed', completed_at: new Date().toISOString() })
            .eq('id', seq.id);
          
          if (updateErr) {
            console.error('[DB] Error updating sequence:', updateErr);
          }
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
        console.log(`[DB] Fetching prospect ${seq.prospect_id}...`);
        const { data: prospect, error: prospectErr } = await this.supabase
          .from('prospects')
          .select('*')
          .eq('id', seq.prospect_id)
          .single();

        if (prospectErr) {
          console.error('[DB] Error fetching prospect:', prospectErr);
          stats.errors++;
          continue;
        }

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
        const subject = this.personalize(step.subject || 'Quick question', prospect as ProspectRow);
        const body = this.personalize(step.body || '', prospect as ProspectRow);

        const prospectObj = {
          id: prospect.id,
          name: (prospect as ProspectRow).name || (prospect as ProspectRow).email,
          email: (prospect as ProspectRow).email,
          company: (prospect as ProspectRow).company || undefined,
          emailState: 'not_sent' as const,
          // Minimal fields needed
          campaignId: seq.campaign_id,
          title: '',
          linkedinUrl: (prospect as ProspectRow).linkedin_url || undefined,
          xHandle: (prospect as ProspectRow).x_handle || undefined,
          website: (prospect as ProspectRow).website || undefined,
          industry: (prospect as ProspectRow).industry || undefined,
          companySize: '',
          location: (prospect as ProspectRow).city || '',
          state: 'contacted' as any,
          linkedinState: 'not_connected' as any,
          xState: 'not_following' as any,
          voiceState: 'not_called' as any,
          score: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        console.log(`[EmailAdapter] Sending cold email to ${(prospect as ProspectRow).email}...`);
        const result = await this.emailAdapter.sendColdEmail(prospectObj, subject, body);

        if (result.success) {
          // 7. Record touchpoint
          console.log(`[DB] Recording touchpoint for ${(prospect as ProspectRow).email}...`);
          const { error: touchErr } = await this.supabase.from('touchpoints').insert({
            sequence_id: seq.id,
            prospect_id: prospect.id,
            channel: 'email',
            action: step.action || 'cold_email',
            content: `${subject}\n\n${body}`,
            outcome: 'sent',
            sent_at: new Date().toISOString(),
          });

          if (touchErr) {
            console.error('[DB] Error recording touchpoint:', touchErr);
          }

          // 8. Advance sequence
          console.log(`[DB] Advancing sequence ${seq.id} to step ${seq.current_step + 1}...`);
          const { error: advanceErr } = await this.supabase
            .from('sequences')
            .update({ current_step: seq.current_step + 1 })
            .eq('id', seq.id);

          if (advanceErr) {
            console.error('[DB] Error advancing sequence:', advanceErr);
          }

          // 9. Update rate limit
          console.log(`[DB] Incrementing rate limit for ${result.metadata?.from || 'unknown'}...`);
          await this.incrementRateLimit(result.metadata?.from || 'unknown');

          // 10. Update prospect status
          console.log(`[DB] Updating prospect ${prospect.id} status to contacted...`);
          const { error: statusErr } = await this.supabase
            .from('prospects')
            .update({ state: 'contacted' })
            .eq('id', prospect.id);

          if (statusErr) {
            console.error('[DB] Error updating prospect status:', statusErr);
          }

          stats.sent++;
          console.log(`[Runner] ✓ Sent step ${seq.current_step} to ${(prospect as ProspectRow).email}`);
        } else {
          stats.errors++;
          console.log(`[Runner] ✗ Failed for ${(prospect as ProspectRow).email}: ${result.error}`);
        }

        // Human-like delay between sends
        await new Promise(r => setTimeout(r, 2000 + Math.random() * 3000));
      }
    }

    console.log(`[Runner] Batch complete: ${stats.sent} sent, ${stats.skipped} skipped, ${stats.errors} errors`);
    return stats;
  }

  private personalize(template: string, prospect: ProspectRow): string {
    const companyName = prospect.company_name || prospect.company || 'your company';
    const firstName = ((prospect as any).name || '').split(' ')[0] || 'there';
    const lastName = ((prospect as any).name || '').split(' ').slice(1).join(' ') || '';
    const city = prospect.city || prospect.location || '';

    return template
      .replace(/\{\{first_name\}\}/g, firstName)
      .replace(/\{\{last_name\}\}/g, lastName)
      .replace(/\{\{company\}\}/g, companyName)
      .replace(/\{\{company_name\}\}/g, companyName)
      .replace(/\{\{business_name\}\}/g, companyName)
      .replace(/\{\{email\}\}/g, prospect.email || '')
      .replace(/\{\{city\}\}/g, city || 'your area')
      .replace(/\{\{state\}\}/g, prospect.state || '')
      .replace(/\{\{industry\}\}/g, prospect.industry || 'your industry')
      .replace(/\{\{region\}\}/g, city || 'your area')
      .replace(/\{\{website\}\}/g, prospect.website || 'your website')
      .replace(/\{\{product_service\}\}/g, prospect.product_service || 'your services')
      .replace(/\{\{specific_detail\}\}/g, prospect.specific_detail || '')
      .replace(/\{\{desired_benefit\}\}/g, prospect.desired_benefit || 'growth');
  }

  private async checkRateLimit(prospectEmail: string): Promise<{ allowed: boolean; reason?: string }> {
    const today = new Date().toISOString().split('T')[0];

    // Check all inboxes - find total daily sends
    console.log(`[DB] Checking rate limits for email channel on ${today}...`);
    const { data: limits, error } = await this.supabase
      .from('rate_limits')
      .select('*')
      .eq('channel', 'email')
      .eq('date', today);

    if (error) {
      console.error('[DB] Error checking rate limits:', error);
    }

    // Check per-inbox limits
    for (const limit of limits || []) {
      if (limit.count >= WARMUP_DAILY_LIMIT) {
        // This inbox is maxed, but others might be available
        continue;
      }
    }

    // Total across all inboxes
    const totalSent = (limits || []).reduce((sum: number, l: any) => sum + (l.count || 0), 0);
    const totalLimit = EmailAdapter.getSenderInboxes().length * WARMUP_DAILY_LIMIT;

    if (totalSent >= totalLimit) {
      return { allowed: false, reason: `Daily total limit reached (${totalSent}/${totalLimit})` };
    }

    return { allowed: true };
  }

  private async incrementRateLimit(inboxEmail: string): Promise<void> {
    const today = new Date().toISOString().split('T')[0];

    // Try to get existing record
    console.log(`[DB] Fetching existing rate limit for ${inboxEmail} on ${today}...`);
    const { data: existing, error: fetchErr } = await this.supabase
      .from('rate_limits')
      .select('*')
      .eq('channel', 'email')
      .eq('campaign_id', 'global') // Using global for now
      .eq('date', today)
      .single();

    if (fetchErr && fetchErr.code !== 'PGRST116') { // PGRST116 = no rows
      console.error('[DB] Error fetching rate limit:', fetchErr);
    }

    if (existing) {
      console.log(`[DB] Updating rate limit count to ${(existing.count || 0) + 1}...`);
      const { error: updateErr } = await this.supabase
        .from('rate_limits')
        .update({ count: (existing.count || 0) + 1 })
        .eq('id', existing.id);
      
      if (updateErr) {
        console.error('[DB] Error updating rate limit:', updateErr);
      }
    } else {
      console.log(`[DB] Inserting new rate limit for ${inboxEmail}...`);
      const { error: insertErr } = await this.supabase.from('rate_limits').insert({
        campaign_id: 'global',
        channel: 'email',
        date: today,
        count: 1,
        max_limit: WARMUP_DAILY_LIMIT,
      });

      if (insertErr) {
        console.error('[DB] Error inserting rate limit:', insertErr);
      }
    }
  }
}
