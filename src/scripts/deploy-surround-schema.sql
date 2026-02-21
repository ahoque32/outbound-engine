-- Surround Sound Schema Additions
-- Deploy this to Supabase for multi-channel coordination

-- Cross-channel coordination tracking
CREATE TABLE IF NOT EXISTS channel_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prospect_id UUID REFERENCES prospects(id) ON DELETE CASCADE,
  campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  event_type TEXT NOT NULL, -- 'reply', 'open', 'click', 'accept', 'follow_back'
  detected_at TIMESTAMPTZ DEFAULT NOW(),
  metadata JSONB,
  processed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_channel_events_prospect ON channel_events(prospect_id);
CREATE INDEX IF NOT EXISTS idx_channel_events_type ON channel_events(event_type);
CREATE INDEX IF NOT EXISTS idx_channel_events_campaign ON channel_events(campaign_id);
CREATE INDEX IF NOT EXISTS idx_channel_events_detected ON channel_events(detected_at);

-- Add coordination fields to sequences table
ALTER TABLE sequences 
  ADD COLUMN IF NOT EXISTS coordination_mode TEXT DEFAULT 'independent',
  ADD COLUMN IF NOT EXISTS paused_reason TEXT,
  ADD COLUMN IF NOT EXISTS paused_by_event UUID REFERENCES channel_events(id);

-- Add processed flags to touchpoints for reply detection
ALTER TABLE touchpoints
  ADD COLUMN IF NOT EXISTS reply_processed BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS open_processed BOOLEAN DEFAULT FALSE;

-- Create index for efficient reply detection queries
CREATE INDEX IF NOT EXISTS idx_touchpoints_reply_detection 
  ON touchpoints(prospect_id, channel, replied_at, reply_processed) 
  WHERE replied_at IS NOT NULL AND reply_processed IS NULL;

CREATE INDEX IF NOT EXISTS idx_touchpoints_open_detection 
  ON touchpoints(prospect_id, channel, opened_at, open_processed) 
  WHERE opened_at IS NOT NULL AND open_processed IS NULL;

-- Add coordination_mode to campaigns
ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS coordination_mode TEXT DEFAULT 'independent';

-- Create index for surround-sound campaign queries
CREATE INDEX IF NOT EXISTS idx_campaigns_coordination 
  ON campaigns(coordination_mode) 
  WHERE coordination_mode = 'surround';

-- Function to increment rate limit (for atomic updates)
CREATE OR REPLACE FUNCTION increment_rate_limit(
  p_campaign_id UUID,
  p_channel TEXT,
  p_date TEXT,
  p_max_limit INTEGER
) RETURNS VOID AS $$
BEGIN
  INSERT INTO rate_limits (campaign_id, channel, date, count, max_limit)
  VALUES (p_campaign_id, p_channel, p_date, 1, p_max_limit)
  ON CONFLICT (campaign_id, channel, date)
  DO UPDATE SET count = rate_limits.count + 1;
END;
$$ LANGUAGE plpgsql;

-- Add comment documentation
COMMENT ON TABLE channel_events IS 'Tracks cross-channel events like replies, opens, and accepts for surround-sound coordination';
COMMENT ON COLUMN sequences.coordination_mode IS 'independent | surround - determines if this sequence is part of multi-channel coordination';
COMMENT ON COLUMN sequences.paused_reason IS 'Human-readable reason why sequence was paused';
COMMENT ON COLUMN sequences.paused_by_event IS 'Reference to the channel_event that triggered the pause';
COMMENT ON COLUMN campaigns.coordination_mode IS 'independent | surround - default coordination mode for sequences in this campaign';
