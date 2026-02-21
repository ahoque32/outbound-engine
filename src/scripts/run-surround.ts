// Surround Sound Runner
// Entry point for running surround sound coordination

import { SurroundSoundCoordinator, DailySummary } from '../coordinator/surround-sound';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Configuration from environment
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://xajpuwodptmwuqoaglfw.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY || '';
const DRY_RUN = process.env.DRY_RUN !== 'false'; // Default to true

interface RunOptions {
  campaignId?: string;
  prospectLimit?: number;
  dryRun?: boolean;
}

async function runSurround(options: RunOptions = {}): Promise<{
  success: boolean;
  summary: DailySummary;
  error?: string;
}> {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║       SURROUND SOUND - Multi-Channel Coordinator           ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log(`
Mode: ${options.dryRun !== false ? 'DRY_RUN (safe)' : 'LIVE (will send)'}
Campaign: ${options.campaignId || 'All active surround-sound campaigns'}
Limit: ${options.prospectLimit || 'Unlimited'}
  `);

  if (!SUPABASE_KEY) {
    console.error('❌ Error: SUPABASE_KEY not configured');
    return {
      success: false,
      summary: {} as DailySummary,
      error: 'SUPABASE_KEY not configured',
    };
  }

  const coordinator = new SurroundSoundCoordinator(SUPABASE_URL, SUPABASE_KEY, {
    dryRun: options.dryRun !== false,
    respectBusinessHours: true,
    maxTouchesPerDay: 1,
    escalationWindowHours: 48,
    unresponsiveThreshold: 3,
  });

  try {
    const summary = await coordinator.run({
      campaignId: options.campaignId,
      prospectLimit: options.prospectLimit,
    });

    // Output JSON summary
    console.log('\n📊 EXECUTION SUMMARY:');
    console.log(JSON.stringify(summary, null, 2));

    return {
      success: summary.errors.length === 0,
      summary,
    };
  } catch (err: any) {
    console.error('❌ Fatal error:', err.message);
    return {
      success: false,
      summary: {} as DailySummary,
      error: err.message,
    };
  }
}

// CLI entry point
if (require.main === module) {
  const args = process.argv.slice(2);
  const options: RunOptions = {
    dryRun: DRY_RUN,
  };

  // Parse arguments
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--campaign' || arg === '-c') {
      options.campaignId = args[++i];
    } else if (arg === '--limit' || arg === '-l') {
      options.prospectLimit = parseInt(args[++i], 10);
    } else if (arg === '--live') {
      options.dryRun = false;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
Usage: ts-node run-surround.ts [options]

Options:
  -c, --campaign <id>     Run for specific campaign
  -l, --limit <n>         Limit number of prospects
  --live                  Run in live mode (sends real messages)
  --dry-run               Run in dry-run mode (default)
  -h, --help              Show this help

Environment Variables:
  SUPABASE_URL            Supabase project URL
  SUPABASE_KEY            Supabase service role key
  DRY_RUN                 Default dry-run mode (true/false)
  AGENTMAIL_API_KEY       For email reply detection
      `);
      process.exit(0);
    }
  }

  runSurround(options).then((result) => {
    process.exit(result.success ? 0 : 1);
  });
}

export { runSurround };
