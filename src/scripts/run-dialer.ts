#!/usr/bin/env ts-node
// Run Dialer - Entry point for running the dialer batch
import { CallEngine } from '../dialer/call-engine';
import * as dotenv from 'dotenv';

dotenv.config();

const DRY_RUN = process.env.DRY_RUN === 'true';

interface RunOptions {
  limit: number;
  templateId: string;
  dryRun: boolean;
}

function parseArgs(): RunOptions {
  const args = process.argv.slice(2);
  
  const options: RunOptions = {
    limit: 5, // Default to 5 calls per run
    templateId: 'web-design',
    dryRun: DRY_RUN,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === '--limit' || arg === '-l') {
      options.limit = parseInt(args[++i], 10) || 5;
    } else if (arg === '--template' || arg === '-t') {
      options.templateId = args[++i] || 'web-design';
    } else if (arg === '--dry-run' || arg === '-d') {
      options.dryRun = true;
    } else if (arg === '--live') {
      options.dryRun = false;
    } else if (arg === '--help' || arg === '-h') {
      showHelp();
      process.exit(0);
    }
  }

  return options;
}

function showHelp() {
  console.log(`
Run Dialer - AI Cold Call Engine

Usage: ts-node run-dialer.ts [options]

Options:
  -l, --limit <n>       Number of calls to make (default: 5)
  -t, --template <id>   Script template to use (default: web-design)
  -d, --dry-run         Run in dry-run mode (simulated calls)
  --live                Run in live mode (real calls - USE WITH CAUTION)
  -h, --help            Show this help message

Environment Variables:
  DRY_RUN=true          Enable dry-run mode
  TWILIO_ACCOUNT_SID    Twilio account SID
  TWILIO_AUTH_TOKEN     Twilio auth token
  ELEVENLABS_API_KEY    ElevenLabs API key
  SUPABASE_URL          Supabase URL
  SUPABASE_SERVICE_ROLE_KEY  Supabase service role key

Examples:
  # Run 3 calls in dry-run mode
  ts-node run-dialer.ts --limit 3 --dry-run

  # Run 10 calls with AI chatbot template
  ts-node run-dialer.ts -l 10 -t ai-chatbot

  # Run live calls (requires explicit --live flag)
  ts-node run-dialer.ts --limit 1 --live
`);
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║           RenderWiseAI - AI Cold Call Engine               ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log();

  const options = parseArgs();

  console.log('Configuration:');
  console.log('  Limit:', options.limit);
  console.log('  Template:', options.templateId);
  console.log('  Dry Run:', options.dryRun);
  console.log();

  if (!options.dryRun) {
    console.log('⚠️  WARNING: Running in LIVE mode - real calls will be made!');
    console.log('   Press Ctrl+C within 5 seconds to cancel...');
    console.log();
    
    await new Promise(resolve => setTimeout(resolve, 5000));
  }

  // Initialize the call engine
  const engine = new CallEngine({
    dryRun: options.dryRun,
    respectBusinessHours: false, // Allow testing outside business hours
  });

  console.log('Starting dialer batch...');
  console.log('────────────────────────────────────────────────────────────');
  console.log();

  const startTime = Date.now();

  try {
    const result = await engine.runBatch(options.limit, options.templateId);

    const duration = (Date.now() - startTime) / 1000;

    console.log();
    console.log('════════════════════════════════════════════════════════════');
    console.log('                    BATCH COMPLETE                          ');
    console.log('════════════════════════════════════════════════════════════');
    console.log();
    console.log('Summary:');
    console.log('  Total calls:', result.total);
    console.log('  Successful:', result.successful);
    console.log('  Failed:', result.failed);
    console.log('  Duration:', duration.toFixed(1), 'seconds');
    console.log();
    console.log('Outcomes:');
    console.log('  📞 Interested:', result.summary.interested);
    console.log('  ❌ Not interested:', result.summary.notInterested);
    console.log('  📅 Callback scheduled:', result.summary.callback);
    console.log('  📧 Email requested:', result.summary.emailRequested);
    console.log('  ✅ Meeting booked:', result.summary.booked);
    console.log('  📼 Voicemail:', result.summary.voicemail);
    console.log('  📵 No answer:', result.summary.noAnswer);
    console.log('  💥 Failed:', result.summary.failed);
    console.log();

    if (result.failed > 0) {
      console.log('Failed calls:');
      result.results
        .filter(r => !r.success)
        .forEach(r => {
          console.log(`  - ${r.prospectId}: ${r.error}`);
        });
      console.log();
    }

    // Show interested leads
    const interested = result.results.filter(r => 
      r.outcome === 'interested' || r.outcome === 'booked'
    );
    
    if (interested.length > 0) {
      console.log('🔥 HOT LEADS:');
      interested.forEach(r => {
        console.log(`  - Prospect ${r.prospectId}: ${r.outcome}`);
        if (r.notes) console.log(`    Notes: ${r.notes}`);
      });
      console.log();
    }

    console.log('════════════════════════════════════════════════════════════');
    
    // Exit with appropriate code
    process.exit(result.failed > 0 ? 1 : 0);
    
  } catch (error) {
    console.error('Fatal error running dialer:', error);
    process.exit(1);
  }
}

// Run main
main();
