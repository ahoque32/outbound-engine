// Schema setup script - creates tables in Supabase via direct pg connection
import 'dotenv/config';

const SQL = `
-- Prospects table
CREATE TABLE IF NOT EXISTS prospects (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  email text UNIQUE NOT NULL,
  first_name text,
  last_name text,
  company text,
  phone text,
  linkedin_url text,
  x_handle text,
  website text,
  city text,
  state text,
  industry text,
  source text,
  status text DEFAULT 'new',
  created_at timestamptz DEFAULT now()
);

-- Campaigns table
CREATE TABLE IF NOT EXISTS campaigns (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  status text DEFAULT 'active',
  sequence_template jsonb,
  created_at timestamptz DEFAULT now()
);

-- Sequences table
CREATE TABLE IF NOT EXISTS sequences (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  campaign_id uuid REFERENCES campaigns(id),
  prospect_id uuid REFERENCES prospects(id),
  current_step int DEFAULT 0,
  status text DEFAULT 'active',
  started_at timestamptz DEFAULT now(),
  paused_at timestamptz,
  completed_at timestamptz
);

-- Touchpoints table
CREATE TABLE IF NOT EXISTS touchpoints (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  sequence_id uuid REFERENCES sequences(id),
  prospect_id uuid REFERENCES prospects(id),
  channel text NOT NULL,
  action text,
  content text,
  outcome text,
  sent_at timestamptz DEFAULT now(),
  opened_at timestamptz,
  replied_at timestamptz
);

-- Rate limits table
CREATE TABLE IF NOT EXISTS rate_limits (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  channel text NOT NULL,
  inbox_email text,
  daily_count int DEFAULT 0,
  hourly_count int DEFAULT 0,
  last_reset timestamptz DEFAULT now(),
  date date DEFAULT current_date
);

-- Add unique constraint for rate limiting
CREATE UNIQUE INDEX IF NOT EXISTS rate_limits_channel_inbox_date ON rate_limits(channel, inbox_email, date);
`;

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL!;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  
  // Use Supabase's pg-meta or direct connection
  // Since we have service role key, let's create an RPC function first, then use it
  // Actually, let's try using the supabase-js client to call a raw query
  
  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(supabaseUrl, supabaseKey, {
    db: { schema: 'public' }
  });

  // Split SQL into individual statements and execute via rpc
  const statements = SQL.split(';').map(s => s.trim()).filter(s => s.length > 0);
  
  for (const stmt of statements) {
    console.log(`Executing: ${stmt.substring(0, 60)}...`);
    // Use the Supabase REST API to call pg functions
    const { data, error } = await supabase.rpc('exec_sql', { sql_text: stmt + ';' });
    if (error) {
      console.error(`  Error: ${error.message}`);
      // Try alternative approach
    } else {
      console.log('  ✓ Done');
    }
  }
}

main().catch(console.error);
