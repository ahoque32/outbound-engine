#!/usr/bin/env ts-node
// Import leads from CSV or the lead-research-findings.md into Supabase
// Usage:
//   npx ts-node src/scripts/import-leads.ts --file path/to/leads.csv --campaign "Campaign Name"
//   npx ts-node src/scripts/import-leads.ts --file path/to/leads.csv --campaign-id <uuid>

import 'dotenv/config';
import { parse } from 'csv-parse/sync';
import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

const args = process.argv.slice(2);
function getArg(flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx >= 0 ? args[idx + 1] : undefined;
}

async function main() {
  const filePath = getArg('--file') || getArg('-f');
  const campaignName = getArg('--campaign') || getArg('-c');
  const campaignId = getArg('--campaign-id');

  if (!filePath) {
    console.error('Usage: import-leads --file <csv-path> [--campaign <name>] [--campaign-id <uuid>]');
    process.exit(1);
  }

  const supabaseUrl = process.env.SUPABASE_URL!;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!supabaseUrl || !supabaseKey) {
    console.error('Error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  // Read CSV
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    console.error(`File not found: ${resolved}`);
    process.exit(1);
  }

  const content = fs.readFileSync(resolved, 'utf-8');
  const records = parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  });

  console.log(`[Import] Found ${records.length} records in ${path.basename(resolved)}`);

  // Resolve or create campaign
  let activeCampaignId = campaignId;
  if (!activeCampaignId && campaignName) {
    // Check if campaign exists
    const { data: existing } = await supabase
      .from('campaigns')
      .select('id')
      .eq('name', campaignName)
      .single();

    if (existing) {
      activeCampaignId = existing.id;
      console.log(`[Import] Using existing campaign: ${campaignName} (${activeCampaignId})`);
    } else {
      // Create campaign with default sequence template
      const { data: created, error } = await supabase
        .from('campaigns')
        .insert({
          name: campaignName,
          status: 'active',
          sequence_template: {
            steps: [
              { day: 0, channel: 'email', action: 'cold_email', subject: 'Quick question about {business_name}\'s website', body: 'Hi {first_name},\n\nI was looking at {business_name}\'s website and noticed a few things that might be costing you customers — specifically around mobile speed and how easy it is for visitors to take action.\n\nI put together a quick 2-minute video audit showing exactly what I found. Want me to send it over?\n\nNo pitch, no strings — just figured it might be useful.\n\n— Jake' },
              { day: 3, channel: 'email', action: 'follow_up_1', subject: 'Re: Quick question about {business_name}\'s website', body: 'Hey {first_name},\n\nFollowing up — I went ahead and ran a quick analysis on {business_name}\'s site.\n\nMost businesses lose 40-60% of their website visitors because of fixable issues. I help small businesses modernize their websites and add AI-powered chat/SMS that automatically follows up with leads.\n\nWorth a 15-minute call?\n\n📅 Book here: https://renderwiseai.com/calendar\n\n— Jake\nGrowth Site AI' },
              { day: 7, channel: 'email', action: 'follow_up_2', subject: 'Should I close your file?', body: 'Hey {first_name},\n\nI\'ve reached out a couple times about improving {business_name}\'s website — totally understand if the timing isn\'t right.\n\nWe recently helped a {industry} business in {city} increase their leads by 73% just by modernizing their site and adding an AI assistant.\n\nIf you ever want to explore something similar, my calendar\'s always open: https://renderwiseai.com/calendar\n\nEither way, wishing you and {business_name} the best.\n\n— Jake' },
            ]
          },
        })
        .select('id')
        .single();

      if (error || !created) {
        console.error(`[Import] Failed to create campaign: ${error?.message}`);
        process.exit(1);
      }
      activeCampaignId = created.id;
      console.log(`[Import] Created campaign: ${campaignName} (${activeCampaignId})`);
    }
  }

  // Map CSV columns to prospect fields
  let imported = 0;
  let skipped = 0;
  let sequencesCreated = 0;

  for (const row of records) {
    // Flexible column mapping
    const email = row.email || row.Email || row.EMAIL || '';
    const firstName = row.first_name || row.contact_name?.split(' ')[0] || row.business_name || '';
    const lastName = row.last_name || (row.contact_name?.split(' ').slice(1).join(' ')) || '';
    const company = row.company || row.business_name || row.Company || '';
    const phone = row.phone || row.Phone || '';
    const linkedinUrl = row.linkedin_url || row.linkedin || '';
    const xHandle = row.x_handle || row.twitter || '';
    const website = row.website || row.Website || '';
    const city = row.city || row.City || '';
    const state = row.state || row.State || '';
    const industry = row.industry || row.Industry || '';
    const source = row.source || 'csv_import';

    // Must have email for email outbound — generate placeholder if missing
    if (!email) {
      console.log(`[Import] Skipping row (no email): ${company || firstName || 'unknown'}`);
      skipped++;
      continue;
    }

    // Dedup check
    const { data: existing } = await supabase
      .from('prospects')
      .select('id')
      .eq('email', email)
      .single();

    if (existing) {
      console.log(`[Import] Dedup: ${email} already exists`);
      // Still create sequence if campaign specified and no active sequence
      if (activeCampaignId) {
        const { data: existingSeq } = await supabase
          .from('sequences')
          .select('id')
          .eq('campaign_id', activeCampaignId)
          .eq('prospect_id', existing.id)
          .single();

        if (!existingSeq) {
          await supabase.from('sequences').insert({
            campaign_id: activeCampaignId,
            prospect_id: existing.id,
            current_step: 0,
            status: 'active',
          });
          sequencesCreated++;
        }
      }
      skipped++;
      continue;
    }

    // Insert prospect
    const { data: inserted, error } = await supabase
      .from('prospects')
      .insert({
        email,
        first_name: firstName || null,
        last_name: lastName || null,
        company: company || null,
        phone: phone || null,
        linkedin_url: linkedinUrl || null,
        x_handle: xHandle || null,
        website: website || null,
        city: city || null,
        state: state || null,
        industry: industry || null,
        source,
        status: 'new',
      })
      .select('id')
      .single();

    if (error) {
      console.error(`[Import] Error inserting ${email}: ${error.message}`);
      skipped++;
      continue;
    }

    imported++;
    console.log(`[Import] ✓ ${email} (${company})`);

    // Create sequence entry if campaign specified
    if (activeCampaignId && inserted) {
      const { error: seqError } = await supabase.from('sequences').insert({
        campaign_id: activeCampaignId,
        prospect_id: inserted.id,
        current_step: 0,
        status: 'active',
      });
      if (!seqError) sequencesCreated++;
    }
  }

  console.log(`\n[Import] === Results ===`);
  console.log(`  Imported: ${imported}`);
  console.log(`  Skipped/Deduped: ${skipped}`);
  console.log(`  Sequences created: ${sequencesCreated}`);
  if (activeCampaignId) console.log(`  Campaign ID: ${activeCampaignId}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
