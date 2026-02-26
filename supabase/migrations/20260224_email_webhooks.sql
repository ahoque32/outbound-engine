-- Create email_events table
CREATE TABLE IF NOT EXISTS email_events (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  event_type text NOT NULL,
  prospect_email text NOT NULL,
  prospect_id uuid REFERENCES prospects(id),
  campaign_id text,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_events_prospect ON email_events(prospect_email);
CREATE INDEX IF NOT EXISTS idx_email_events_type ON email_events(event_type);
CREATE INDEX IF NOT EXISTS idx_email_events_created_at ON email_events(created_at);

-- Add verification columns to prospects
ALTER TABLE prospects
  ADD COLUMN IF NOT EXISTS email_verification_status text,
  ADD COLUMN IF NOT EXISTS email_is_disposable boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS email_verified_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_prospects_email_verification_status 
  ON prospects(email_verification_status) 
  WHERE email_verification_status IS NULL;
