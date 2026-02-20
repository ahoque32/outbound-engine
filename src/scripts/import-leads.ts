// Lead Import Script
// Imports prospects from CSV to Supabase

import { parse } from 'csv-parse/sync';
import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import { Command } from 'commander';
import { Prospect } from '../types';

const program = new Command();

program
  .name('import-leads')
  .description('Import prospects from CSV to Supabase')
  .requiredOption('-f, --file <path>', 'CSV file path')
  .requiredOption('-c, --campaign <id>', 'Campaign ID')
  .option('--skip-validation', 'Skip email validation')
  .parse();

interface CSVRow {
  name: string;
  company?: string;
  title?: string;
  email?: string;
  phone?: string;
  linkedin_url?: string;
  x_handle?: string;
  website?: string;
  industry?: string;
  company_size?: string;
  location?: string;
  [key: string]: string | undefined;
}

async function importLeads() {
  const options = program.opts();
  
  // Initialize Supabase
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  
  if (!supabaseUrl || !supabaseKey) {
    console.error('Error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required');
    process.exit(1);
  }
  
  const supabase = createClient(supabaseUrl, supabaseKey);
  
  // Read CSV
  const filePath = path.resolve(options.file);
  if (!fs.existsSync(filePath)) {
    console.error(`Error: File not found: ${filePath}`);
    process.exit(1);
  }
  
  const fileContent = fs.readFileSync(filePath, 'utf-8');
  const records = parse(fileContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as CSVRow[];
  
  console.log(`Found ${records.length} records in CSV`);
  
  // Transform and validate
  const prospects: Partial<Prospect>[] = [];
  const errors: { row: number; error: string }[] = [];
  
  for (let i = 0; i < records.length; i++) {
    const row = records[i];
    
    // Validate required fields
    if (!row.name) {
      errors.push({ row: i + 2, error: 'Missing required field: name' });
      continue;
    }
    
    // Validate email if present
    if (row.email && !options.skipValidation) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(row.email)) {
        errors.push({ row: i + 2, error: `Invalid email: ${row.email}` });
        continue;
      }
    }
    
    prospects.push({
      campaignId: options.campaign,
      name: row.name,
      company: row.company,
      title: row.title,
      email: row.email,
      phone: row.phone,
      linkedinUrl: row.linkedin_url,
      xHandle: row.x_handle,
      website: row.website,
      industry: row.industry,
      companySize: row.company_size,
      location: row.location,
      state: 'discovered',
      linkedinState: 'not_connected',
      xState: 'not_following',
      emailState: 'not_sent',
      voiceState: 'not_called',
      score: 0,
    } as any);
  }
  
  if (errors.length > 0) {
    console.log('\nValidation errors:');
    errors.forEach(e => console.log(`  Row ${e.row}: ${e.error}`));
  }
  
  if (prospects.length === 0) {
    console.error('\nNo valid prospects to import');
    process.exit(1);
  }
  
  console.log(`\nImporting ${prospects.length} valid prospects...`);
  
  // Insert in batches
  const batchSize = 100;
  let imported = 0;
  
  for (let i = 0; i < prospects.length; i += batchSize) {
    const batch = prospects.slice(i, i + batchSize);
    
    const { data, error } = await supabase
      .from('prospects')
      .insert(batch)
      .select('id');
    
    if (error) {
      console.error(`Error inserting batch ${i / batchSize + 1}:`, error.message);
      continue;
    }
    
    imported += data?.length || 0;
    console.log(`  Batch ${i / batchSize + 1}: ${data?.length || 0} imported`);
  }
  
  console.log(`\n✓ Imported ${imported} prospects to campaign ${options.campaign}`);
  console.log(`  Skipped: ${records.length - imported}`);
}

importLeads().catch(console.error);
