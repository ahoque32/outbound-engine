/*
SQL Migration for prospects table - add email verification columns:

-- Add email verification columns to prospects table
ALTER TABLE prospects 
  ADD COLUMN IF NOT EXISTS email_verification_status text,
  ADD COLUMN IF NOT EXISTS email_is_disposable boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS email_verified_at timestamptz;

-- Create index for efficient filtering of unverified emails
CREATE INDEX IF NOT EXISTS idx_prospects_email_verification_status 
  ON prospects(email_verification_status) 
  WHERE email_verification_status IS NULL;
*/

import { createClient } from '@supabase/supabase-js';
import { InstantlyAdapter } from '../src/channels/instantly-adapter';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY || '';

const BATCH_SIZE = 50;
const RATE_LIMIT_DELAY_MS = 1000; // 1 second between batches

interface Prospect {
  id: string;
  email: string;
}

interface VerificationSummary {
  total: number;
  processed: number;
  valid: number;
  invalid: number;
  catchAll: number;
  unknown: number;
  disposable: number;
}

async function main() {
  const args = process.argv.slice(2);
  const isDryRun = args.includes('--dry-run');

  console.log('========================================');
  console.log('Bulk Email Verification Script');
  console.log('========================================');
  console.log(`Mode: ${isDryRun ? 'DRY RUN (no API calls)' : 'LIVE'}`);
  console.log(`Batch size: ${BATCH_SIZE}`);
  console.log('');

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('Error: SUPABASE_URL and SUPABASE_SERVICE_KEY must be set');
    process.exit(1);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  const adapter = new InstantlyAdapter();

  // Count prospects needing verification
  const { count, error: countError } = await supabase
    .from('prospects')
    .select('*', { count: 'exact', head: true })
    .not('email', 'is', null)
    .is('email_verification_status', null);

  if (countError) {
    console.error('Error counting prospects:', countError.message);
    process.exit(1);
  }

  const totalProspects = count || 0;
  console.log(`Found ${totalProspects} prospects to verify`);

  if (totalProspects === 0) {
    console.log('No prospects need verification. Exiting.');
    process.exit(0);
  }

  if (isDryRun) {
    console.log('\nDry run complete. No changes made.');
    process.exit(0);
  }

  // Process in batches
  const summary: VerificationSummary = {
    total: totalProspects,
    processed: 0,
    valid: 0,
    invalid: 0,
    catchAll: 0,
    unknown: 0,
    disposable: 0,
  };

  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    // Fetch batch of prospects
    const { data: prospects, error: fetchError } = await supabase
      .from('prospects')
      .select('id, email')
      .not('email', 'is', null)
      .is('email_verification_status', null)
      .range(offset, offset + BATCH_SIZE - 1);

    if (fetchError) {
      console.error(`Error fetching prospects at offset ${offset}:`, fetchError.message);
      process.exit(1);
    }

    if (!prospects || prospects.length === 0) {
      hasMore = false;
      break;
    }

    const batch = prospects as Prospect[];
    const emails = batch.map(p => p.email);

    console.log(`\nProcessing batch ${Math.floor(offset / BATCH_SIZE) + 1}: ${batch.length} prospects`);

    try {
      // Call Instantly API to verify emails
      const results = await adapter.verifyEmails(emails);

      // Build update map
      const updates: Array<{
        id: string;
        email_verification_status: string;
        email_is_disposable: boolean;
        email_verified_at: string;
      }> = [];

      const batchSummary = {
        valid: 0,
        invalid: 0,
        catchAll: 0,
        unknown: 0,
        disposable: 0,
      };

      for (const result of results) {
        const prospect = batch.find(p => p.email.toLowerCase() === result.email.toLowerCase());
        if (!prospect) {
          console.warn(`  Warning: No matching prospect for email ${result.email}`);
          continue;
        }

        const status = result.status || 'unknown';
        const isDisposable = result.disposable || false;

        updates.push({
          id: prospect.id,
          email_verification_status: status,
          email_is_disposable: isDisposable,
          email_verified_at: new Date().toISOString(),
        });

        // Update counters
        if (status === 'valid') batchSummary.valid++;
        else if (status === 'invalid') batchSummary.invalid++;
        else if (status === 'catch-all') batchSummary.catchAll++;
        else batchSummary.unknown++;

        if (isDisposable) batchSummary.disposable++;
      }

      // Update prospects in Supabase (one by one for now, could be batched)
      for (const update of updates) {
        const { error: updateError } = await supabase
          .from('prospects')
          .update({
            email_verification_status: update.email_verification_status,
            email_is_disposable: update.email_is_disposable,
            email_verified_at: update.email_verified_at,
          })
          .eq('id', update.id);

        if (updateError) {
          console.error(`  Error updating prospect ${update.id}:`, updateError.message);
        }
      }

      // Update global summary
      summary.processed += updates.length;
      summary.valid += batchSummary.valid;
      summary.invalid += batchSummary.invalid;
      summary.catchAll += batchSummary.catchAll;
      summary.unknown += batchSummary.unknown;
      summary.disposable += batchSummary.disposable;

      console.log(`  Verified ${updates.length}/${batch.length} in batch`);
      console.log(`  Batch results: ${batchSummary.valid} valid, ${batchSummary.invalid} invalid, ${batchSummary.catchAll} catch-all, ${batchSummary.unknown} unknown`);
      console.log(`  Progress: ${summary.processed}/${summary.total} (${Math.round((summary.processed / summary.total) * 100)}%)`);

      // Handle any emails that weren't returned in results (API errors, etc.)
      const processedEmails = new Set(results.map(r => r.email.toLowerCase()));
      const unprocessed = batch.filter(p => !processedEmails.has(p.email.toLowerCase()));
      
      if (unprocessed.length > 0) {
        console.warn(`  Warning: ${unprocessed.length} emails not processed by API`);
        // Mark them as unknown so they don't get stuck
        for (const p of unprocessed) {
          await supabase
            .from('prospects')
            .update({
              email_verification_status: 'unknown',
              email_is_disposable: false,
              email_verified_at: new Date().toISOString(),
            })
            .eq('id', p.id);
          summary.unknown++;
        }
      }

    } catch (err: any) {
      console.error(`  Error verifying batch:`, err.message);
      
      // Check for rate limit
      if (err.message?.includes('rate limit') || err.message?.includes('429')) {
        console.log('  Rate limit hit. Waiting 30 seconds before retrying...');
        await sleep(30000);
        continue; // Retry this batch
      }
      
      // For other errors, mark these prospects as unknown and continue
      console.log('  Marking batch as unknown and continuing...');
      for (const p of batch) {
        await supabase
          .from('prospects')
          .update({
            email_verification_status: 'unknown',
            email_is_disposable: false,
            email_verified_at: new Date().toISOString(),
          })
          .eq('id', p.id);
      }
      summary.unknown += batch.length;
      summary.processed += batch.length;
    }

    offset += BATCH_SIZE;

    // Rate limiting - sleep between batches (except for the last one)
    if (hasMore && offset < totalProspects) {
      process.stdout.write(`  Sleeping ${RATE_LIMIT_DELAY_MS}ms for rate limiting...`);
      await sleep(RATE_LIMIT_DELAY_MS);
      console.log(' done');
    }
  }

  // Print final summary
  console.log('\n========================================');
  console.log('Verification Complete');
  console.log('========================================');
  console.log(`Total processed: ${summary.processed}/${summary.total}`);
  console.log(`Results:`);
  console.log(`  - Valid: ${summary.valid}`);
  console.log(`  - Invalid: ${summary.invalid}`);
  console.log(`  - Catch-all: ${summary.catchAll}`);
  console.log(`  - Unknown: ${summary.unknown}`);
  console.log(`  - Disposable: ${summary.disposable}`);
  console.log('');
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
