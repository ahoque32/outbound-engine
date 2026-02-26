/**
 * Express server wrapper for Cloud Run deployment.
 * Wraps all existing Vercel-style handlers (VercelRequest/VercelResponse)
 * with zero changes to the handler files themselves — Express req/res
 * are compatible enough with Vercel's types.
 */
import express from 'express';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = parseInt(process.env.PORT || '8080', 10);

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// CORS (all endpoints need it)
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  next();
});

// ── Route imports ──────────────────────────────────────────────────────────────
// Each handler expects (req, res) with Vercel-like shape.
// Express req/res is a superset, so this works directly.

import healthHandler from './api/health';
import bookAppointmentHandler from './api/book-appointment';
import callStatsHandler from './api/call-stats';
import checkSpamStatusHandler from './api/check-spam-status';
import emailWebhookHandler from './api/email-webhook';
import getAvailableSlotsHandler from './api/get-available-slots';
import incomingSmsHandler from './api/incoming-sms';
import pipelineAnalyticsHandler from './api/pipeline-analytics';
import pollCompletedCallsHandler from './api/poll-completed-calls';
import postCallWebhookHandler from './api/post-call-webhook';
import sendSmsHandler from './api/send-sms';
import smsStatusHandler from './api/sms-status';
import verifyLeadsHandler from './api/verify-leads';

// ── Routes ─────────────────────────────────────────────────────────────────────

app.all('/api/health', healthHandler as any);
app.all('/api/book-appointment', bookAppointmentHandler as any);
app.all('/api/call-stats', callStatsHandler as any);
app.all('/api/check-spam-status', checkSpamStatusHandler as any);
app.all('/api/email-webhook', emailWebhookHandler as any);
app.all('/api/get-available-slots', getAvailableSlotsHandler as any);
app.all('/api/incoming-sms', incomingSmsHandler as any);
app.all('/api/pipeline-analytics', pipelineAnalyticsHandler as any);
app.all('/api/poll-completed-calls', pollCompletedCallsHandler as any);
app.all('/api/post-call-webhook', postCallWebhookHandler as any);
app.all('/api/send-sms', sendSmsHandler as any);
app.all('/api/sms-status', smsStatusHandler as any);
app.all('/api/verify-leads', verifyLeadsHandler as any);

// Root redirect to health
app.get('/', (req, res) => res.redirect('/api/health'));

// 404 catch-all
app.use((req, res) => {
  res.status(404).json({ error: 'Not found', path: req.path });
});

// ── Start ──────────────────────────────────────────────────────────────────────

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[outbound-engine] Server running on port ${PORT}`);
  console.log(`[outbound-engine] ${new Date().toISOString()}`);
});
