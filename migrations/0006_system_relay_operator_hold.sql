-- Catalog sync owns membership for operator_hold = 0.
-- operator_hold = 1 freezes enabled (operator pin or operator disable).
-- Existing seed rows stay hold 0 so the first non-empty sync can replace them.
ALTER TABLE blastr_system_relays
  ADD COLUMN operator_hold INTEGER NOT NULL DEFAULT 0;

-- Write-health lookups read the newest publish attempts for one relay.
CREATE INDEX IF NOT EXISTS idx_blastr_publish_attempts_relay_id
  ON blastr_publish_attempts(relay_url, id DESC);
