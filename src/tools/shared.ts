import { createClient, SupabaseClient } from '@supabase/supabase-js';

let supabaseClient: SupabaseClient | null = null;

/**
 * Returns a singleton Supabase service-role client for tool wrappers.
 */
export function getSupabaseClient(): SupabaseClient {
  if (supabaseClient) {
    return supabaseClient;
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  }

  supabaseClient = createClient(url, key);
  return supabaseClient;
}

/**
 * Converts unknown errors into a safe string message.
 */
export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/**
 * Returns today's UTC date range boundaries as ISO strings.
 */
export function getTodayUtcRange(): { start: string; end: string; date: string } {
  const now = new Date();
  const date = now.toISOString().split('T')[0];
  return {
    date,
    start: `${date}T00:00:00.000Z`,
    end: `${date}T23:59:59.999Z`,
  };
}
