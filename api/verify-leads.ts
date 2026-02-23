import type { VercelRequest, VercelResponse } from '@vercel/node';
import { InstantlyAdapter } from '../src/channels/instantly-adapter';

/**
 * POST /api/verify-leads
 * Verify a batch of emails using Instantly.ai verification API
 * 
 * Request body: { emails: string[] }
 * Response: { results: VerificationResult[] }
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed', allowed: ['POST'] });
  }

  const { emails } = req.body || {};

  // Validate input
  if (!emails || !Array.isArray(emails)) {
    return res.status(400).json({ 
      error: 'Bad request',
      message: 'Request body must include an "emails" array'
    });
  }

  if (emails.length === 0) {
    return res.status(400).json({
      error: 'Bad request',
      message: 'Emails array cannot be empty'
    });
  }

  if (emails.length > 100) {
    return res.status(400).json({
      error: 'Bad request',
      message: 'Maximum 100 emails per request'
    });
  }

  // Validate email formats
  const invalidEmails: string[] = [];
  const validEmails: string[] = [];
  
  for (const email of emails) {
    if (typeof email !== 'string') {
      invalidEmails.push(String(email));
      continue;
    }
    
    const trimmed = email.trim().toLowerCase();
    if (!isValidEmail(trimmed)) {
      invalidEmails.push(email);
    } else {
      validEmails.push(trimmed);
    }
  }

  if (validEmails.length === 0) {
    return res.status(400).json({
      error: 'Bad request',
      message: 'No valid email addresses provided',
      invalidEmails
    });
  }

  try {
    const adapter = new InstantlyAdapter();
    const results = await adapter.verifyEmails(validEmails);

    // Add validation errors for invalid format emails
    const allResults = [
      ...results,
      ...invalidEmails.map(email => ({
        email,
        status: 'invalid' as const,
        disposable: false,
        error: 'Invalid email format'
      }))
    ];

    // Calculate summary statistics
    const summary = {
      total: allResults.length,
      valid: allResults.filter(r => r.status === 'valid').length,
      invalid: allResults.filter(r => r.status === 'invalid').length,
      catchAll: allResults.filter(r => r.status === 'catch-all').length,
      unknown: allResults.filter(r => r.status === 'unknown').length,
      disposable: allResults.filter(r => r.disposable).length
    };

    return res.status(200).json({
      success: true,
      summary,
      results: allResults
    });

  } catch (err: any) {
    console.error('[verify-leads] Error:', err);
    
    // Handle specific error types
    if (err.message?.includes('timeout')) {
      return res.status(504).json({
        error: 'Gateway timeout',
        message: 'Verification request timed out'
      });
    }
    
    if (err.message?.includes('rate limit')) {
      return res.status(429).json({
        error: 'Rate limited',
        message: 'Too many verification requests'
      });
    }

    return res.status(500).json({
      error: 'Internal server error',
      message: err.message || 'Failed to verify emails'
    });
  }
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
