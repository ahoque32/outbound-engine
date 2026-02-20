#!/usr/bin/env ts-node
// Dialer Report - Daily summary of dialer activity
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

interface DailyStats {
  date: string;
  totalCalls: number;
  initiated: number;
  ringing: number;
  answered: number;
  voicemail: number;
  noAnswer: number;
  busy: number;
  failed: number;
  interested: number;
  notInterested: number;
  callback: number;
  emailRequested: number;
  booked: number;
  totalDuration: number;
  avgDuration: number;
}

interface ProspectOutcome {
  prospectId: string;
  firstName: string;
  company: string;
  phone: string;
  outcome: string;
  duration: number;
  notes?: string;
}

async function generateDailyReport(date?: string): Promise<void> {
  const reportDate = date || new Date().toISOString().split('T')[0];
  
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║              Daily Dialer Report                           ║');
  console.log(`║              ${reportDate}                              ║`);
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log();

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Error: Supabase credentials not configured');
    console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env');
    process.exit(1);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Fetch call logs for the date
  const startOfDay = `${reportDate}T00:00:00Z`;
  const endOfDay = `${reportDate}T23:59:59Z`;

  console.log('Fetching call data...');
  console.log();

  const { data: callLogs, error } = await supabase
    .from('call_logs')
    .select(`
      id,
      prospect_id,
      campaign_id,
      twilio_call_sid,
      status,
      outcome,
      duration_seconds,
      transcript,
      notes,
      started_at,
      ended_at,
      created_at,
      prospects:prospect_id (
        name,
        company,
        phone
      )
    `)
    .gte('created_at', startOfDay)
    .lte('created_at', endOfDay)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Error fetching call logs:', error);
    process.exit(1);
  }

  if (!callLogs || callLogs.length === 0) {
    console.log('No calls recorded for this date.');
    return;
  }

  // Calculate statistics
  const stats: DailyStats = {
    date: reportDate,
    totalCalls: callLogs.length,
    initiated: callLogs.filter(c => c.status === 'initiated').length,
    ringing: callLogs.filter(c => c.status === 'ringing').length,
    answered: callLogs.filter(c => c.status === 'answered').length,
    voicemail: callLogs.filter(c => c.status === 'voicemail').length,
    noAnswer: callLogs.filter(c => c.status === 'no_answer').length,
    busy: callLogs.filter(c => c.status === 'busy').length,
    failed: callLogs.filter(c => c.status === 'failed').length,
    interested: callLogs.filter(c => c.outcome === 'interested').length,
    notInterested: callLogs.filter(c => c.outcome === 'not_interested').length,
    callback: callLogs.filter(c => c.outcome === 'callback').length,
    emailRequested: callLogs.filter(c => c.outcome === 'email_requested').length,
    booked: callLogs.filter(c => c.outcome === 'booked').length,
    totalDuration: callLogs.reduce((sum, c) => sum + (c.duration_seconds || 0), 0),
    avgDuration: 0,
  };

  stats.avgDuration = stats.totalDuration / (stats.totalCalls || 1);

  // Print summary
  console.log('📊 CALL VOLUME');
  console.log('────────────────────────────────────────────────────────────');
  console.log(`  Total calls made:     ${stats.totalCalls}`);
  console.log(`  Answered:             ${stats.answered}`);
  console.log(`  Voicemail:            ${stats.voicemail}`);
  console.log(`  No answer:            ${stats.noAnswer}`);
  console.log(`  Failed:               ${stats.failed}`);
  console.log();

  console.log('📈 OUTCOMES');
  console.log('────────────────────────────────────────────────────────────');
  console.log(`  ✅ Interested:        ${stats.interested}`);
  console.log(`  ❌ Not interested:    ${stats.notInterested}`);
  console.log(`  📅 Callback:          ${stats.callback}`);
  console.log(`  📧 Email requested:   ${stats.emailRequested}`);
  console.log(`  🎯 Meeting booked:    ${stats.booked}`);
  console.log();

  console.log('⏱️  DURATION');
  console.log('────────────────────────────────────────────────────────────');
  console.log(`  Total talk time:      ${formatDuration(stats.totalDuration)}`);
  console.log(`  Average call length:  ${formatDuration(stats.avgDuration)}`);
  console.log();

  // Conversion rates
  const connectedCalls = stats.answered + stats.voicemail;
  const positiveOutcomes = stats.interested + stats.booked;
  
  console.log('🎯 CONVERSION METRICS');
  console.log('────────────────────────────────────────────────────────────');
  console.log(`  Connection rate:      ${((connectedCalls / stats.totalCalls) * 100).toFixed(1)}%`);
  console.log(`  Positive outcomes:    ${positiveOutcomes}`);
  console.log(`  Conversion rate:      ${((positiveOutcomes / (stats.answered || 1)) * 100).toFixed(1)}%`);
  console.log();

  // Hot leads
  const hotLeads = callLogs.filter(c => 
    c.outcome === 'interested' || c.outcome === 'booked'
  );

  if (hotLeads.length > 0) {
    console.log('🔥 HOT LEADS (Immediate Follow-up Required)');
    console.log('────────────────────────────────────────────────────────────');
    hotLeads.forEach((call, index) => {
      const prospect = call.prospects as any;
      console.log(`  ${index + 1}. ${prospect?.name || 'Unknown'} @ ${prospect?.company || 'Unknown'}`);
      console.log(`     Phone: ${prospect?.phone || 'N/A'}`);
      console.log(`     Outcome: ${call.outcome}`);
      console.log(`     Duration: ${formatDuration(call.duration_seconds || 0)}`);
      if (call.notes) console.log(`     Notes: ${call.notes}`);
      console.log();
    });
  }

  // Callbacks scheduled
  const callbacks = callLogs.filter(c => c.outcome === 'callback');
  
  if (callbacks.length > 0) {
    console.log('📅 CALLBACKS SCHEDULED');
    console.log('────────────────────────────────────────────────────────────');
    callbacks.forEach((call, index) => {
      const prospect = call.prospects as any;
      console.log(`  ${index + 1}. ${prospect?.name || 'Unknown'} @ ${prospect?.company || 'Unknown'}`);
      console.log(`     Phone: ${prospect?.phone || 'N/A'}`);
      console.log(`     Scheduled: ${(call as any).callback_at || 'Not specified'}`);
      console.log();
    });
  }

  // Email requests
  const emailRequests = callLogs.filter(c => c.outcome === 'email_requested');
  
  if (emailRequests.length > 0) {
    console.log('📧 EMAIL REQUESTS');
    console.log('────────────────────────────────────────────────────────────');
    emailRequests.forEach((call, index) => {
      const prospect = call.prospects as any;
      console.log(`  ${index + 1}. ${prospect?.name || 'Unknown'} @ ${prospect?.company || 'Unknown'}`);
      console.log(`     Email: ${prospect?.email || 'Need to capture'}`);
      console.log();
    });
  }

  // Failed calls
  if (stats.failed > 0) {
    console.log('⚠️  FAILED CALLS');
    console.log('────────────────────────────────────────────────────────────');
    callLogs
      .filter(c => c.status === 'failed')
      .forEach((call, index) => {
        const prospect = call.prospects as any;
        console.log(`  ${index + 1}. ${prospect?.name || 'Unknown'} @ ${prospect?.company || 'Unknown'}`);
        console.log(`     Error: ${call.notes || 'Unknown error'}`);
        console.log();
      });
  }

  // Hourly breakdown
  console.log('📅 HOURLY BREAKDOWN');
  console.log('────────────────────────────────────────────────────────────');
  const hourlyStats = new Map<number, number>();
  
  callLogs.forEach(call => {
    const hour = new Date(call.created_at).getHours();
    hourlyStats.set(hour, (hourlyStats.get(hour) || 0) + 1);
  });

  const sortedHours = Array.from(hourlyStats.entries()).sort((a, b) => a[0] - b[0]);
  sortedHours.forEach(([hour, count]) => {
    const timeLabel = `${hour.toString().padStart(2, '0')}:00`;
    const bar = '█'.repeat(count);
    console.log(`  ${timeLabel}  ${bar}  ${count}`);
  });
  console.log();

  console.log('════════════════════════════════════════════════════════════');
  console.log('Report generated at:', new Date().toLocaleString());
  console.log('════════════════════════════════════════════════════════════');
}

function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${Math.round(seconds)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  return `${minutes}m ${remainingSeconds}s`;
}

// Parse command line arguments
function parseArgs(): { date?: string } {
  const args = process.argv.slice(2);
  
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Dialer Report - Daily summary of dialer activity

Usage: ts-node dialer-report.ts [options] [date]

Arguments:
  date              Date to report on (YYYY-MM-DD format, default: today)

Options:
  -h, --help        Show this help message

Examples:
  # Report for today
  ts-node dialer-report.ts

  # Report for specific date
  ts-node dialer-report.ts 2024-01-15
`);
    process.exit(0);
  }

  // First non-flag argument is the date
  const date = args.find(arg => !arg.startsWith('-'));
  
  return { date };
}

// Main
async function main() {
  const { date } = parseArgs();
  await generateDailyReport(date);
}

main().catch(error => {
  console.error('Error generating report:', error);
  process.exit(1);
});
