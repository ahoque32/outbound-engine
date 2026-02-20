-- Supabase Schema for Outbound Engine

-- Campaigns table
CREATE TABLE campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  client_id TEXT NOT NULL,
  icp_criteria JSONB,
  sequence_template JSONB,
  status TEXT DEFAULT 'active', -- active, paused, completed
  daily_limits JSONB DEFAULT '{"linkedin": 20, "x": 50, "email": 50, "voice": 50}',
  business_hours JSONB DEFAULT '{"start": "09:00", "end": "17:00", "timezone": "America/New_York"}',
  exclusion_list TEXT[],
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Prospects table
CREATE TABLE prospects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  company TEXT,
  title TEXT,
  email TEXT,
  phone TEXT,
  linkedin_url TEXT,
  x_handle TEXT,
  website TEXT,
  industry TEXT,
  company_size TEXT,
  location TEXT,
  
  -- State machine
  state TEXT DEFAULT 'discovered', -- discovered, researched, contacted, engaged, qualified, booked, converted, not_interested, unresponsive
  
  -- Channel-specific states
  linkedin_state TEXT DEFAULT 'not_connected', -- not_connected, requested, connected, messaged, replied
  x_state TEXT DEFAULT 'not_following', -- not_following, following, engaged, dm_sent, dm_replied
  email_state TEXT DEFAULT 'not_sent', -- not_sent, sent, opened, replied, bounced
  voice_state TEXT DEFAULT 'not_called', -- not_called, called, answered, voicemail, booked
  
  -- Scoring and notes
  score INTEGER DEFAULT 0,
  notes TEXT,
  source TEXT,
  
  -- Metadata
  last_touchpoint_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Touchpoints table (all interactions)
CREATE TABLE touchpoints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prospect_id UUID REFERENCES prospects(id) ON DELETE CASCADE,
  campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE,
  channel TEXT NOT NULL, -- linkedin, x, email, voice
  action TEXT NOT NULL, -- connection_request, message, follow, like, dm, email, call
  content TEXT,
  outcome TEXT, -- sent, delivered, opened, replied, bounced, answered, voicemail
  metadata JSONB,
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  opened_at TIMESTAMPTZ,
  replied_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Sequences table (active sequences per prospect)
CREATE TABLE sequences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prospect_id UUID REFERENCES prospects(id) ON DELETE CASCADE,
  campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE,
  template_id TEXT NOT NULL,
  current_step INTEGER DEFAULT 0,
  next_step_at TIMESTAMPTZ,
  status TEXT DEFAULT 'active', -- active, paused, completed, cancelled
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Rate limiting table
CREATE TABLE rate_limits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  date DATE NOT NULL,
  count INTEGER DEFAULT 0,
  max_limit INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(campaign_id, channel, date)
);

-- Indexes for performance
CREATE INDEX idx_prospects_campaign ON prospects(campaign_id);
CREATE INDEX idx_prospects_state ON prospects(state);
CREATE INDEX idx_prospects_email ON prospects(email);
CREATE INDEX idx_touchpoints_prospect ON touchpoints(prospect_id);
CREATE INDEX idx_touchpoints_campaign ON touchpoints(campaign_id);
CREATE INDEX idx_sequences_prospect ON sequences(prospect_id);
CREATE INDEX idx_sequences_next_step ON sequences(next_step_at) WHERE status = 'active';

-- Triggers for updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_campaigns_updated_at BEFORE UPDATE ON campaigns
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_prospects_updated_at BEFORE UPDATE ON prospects
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_sequences_updated_at BEFORE UPDATE ON sequences
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_rate_limits_updated_at BEFORE UPDATE ON rate_limits
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
