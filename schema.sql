-- Outbound Engine Schema
-- Run this in the Supabase SQL Editor (Dashboard > SQL > New query)

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

-- Call logs table (post-call webhook data from ElevenLabs)
CREATE TABLE IF NOT EXISTS call_logs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id text UNIQUE NOT NULL,
  prospect_id uuid REFERENCES prospects(id),
  prospect_phone text,
  prospect_name text,
  call_sid text,
  status text DEFAULT 'completed',
  outcome text,
  duration_seconds int,
  transcript jsonb,
  summary text,
  booking_made boolean DEFAULT false,
  callback_requested boolean DEFAULT false,
  callback_time timestamptz,
  elevenlabs_data jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS call_logs_prospect_id ON call_logs(prospect_id);
CREATE INDEX IF NOT EXISTS call_logs_outcome ON call_logs(outcome);
CREATE INDEX IF NOT EXISTS call_logs_created_at ON call_logs(created_at);

-- Unique index for rate limit lookups
CREATE UNIQUE INDEX IF NOT EXISTS rate_limits_channel_inbox_date 
  ON rate_limits(channel, inbox_email, date);

-- Helper function for running SQL via RPC (enables programmatic DDL)
CREATE OR REPLACE FUNCTION exec_sql(query text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  EXECUTE query;
END;
$$;
