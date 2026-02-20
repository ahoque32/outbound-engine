#!/usr/bin/env ts-node
// Run one batch of due email steps
import 'dotenv/config';
import { SequenceRunner } from '../engine/sequence-runner';

async function main() {
  console.log('=== Outbound Engine — Batch Run ===');
  console.log(`Time: ${new Date().toISOString()}`);

  const runner = new SequenceRunner();
  const stats = await runner.runBatch();

  console.log('\n=== Results ===');
  console.log(`Sent: ${stats.sent}`);
  console.log(`Skipped: ${stats.skipped}`);
  console.log(`Errors: ${stats.errors}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
