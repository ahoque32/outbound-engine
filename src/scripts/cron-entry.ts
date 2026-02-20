#!/usr/bin/env ts-node
// Cron Entry Point — clean runner for daily-sequence
// Outputs JSON summary, exits cleanly
import 'dotenv/config';

async function main() {
  const start = Date.now();
  
  // Import and run daily sequence
  const { executeDailySequences } = await import('./daily-sequence');
  const result = await executeDailySequences();
  
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  
  const summary = {
    timestamp: new Date().toISOString(),
    elapsedSeconds: parseFloat(elapsed),
    ...(result || { executed: 0, skipped: 0, errors: 0 }),
  };
  
  console.log('\n📊 CRON SUMMARY:');
  console.log(JSON.stringify(summary, null, 2));
  
  process.exit(0);
}

main().catch((err) => {
  console.error('❌ Cron entry failed:', err);
  process.exit(1);
});
