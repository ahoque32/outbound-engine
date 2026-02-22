-- A/B Testing Migration
-- Adds variant tracking to call_logs and prospect data fields

ALTER TABLE call_logs ADD COLUMN IF NOT EXISTS agent_variant text;
ALTER TABLE call_logs ADD COLUMN IF NOT EXISTS agent_id_used text;
CREATE INDEX IF NOT EXISTS call_logs_variant ON call_logs(agent_variant);

-- Add prospect data fields if not present
ALTER TABLE prospects ADD COLUMN IF NOT EXISTS company_name text;
ALTER TABLE prospects ADD COLUMN IF NOT EXISTS country text;
ALTER TABLE prospects ADD COLUMN IF NOT EXISTS product_service text;
ALTER TABLE prospects ADD COLUMN IF NOT EXISTS specific_detail text;
ALTER TABLE prospects ADD COLUMN IF NOT EXISTS desired_benefit text;
