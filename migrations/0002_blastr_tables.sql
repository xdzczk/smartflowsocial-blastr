-- Blastr SFS Broadcast Relay schema (Phase 1)
-- Entitlements: denormalized cache per pubkey (synced from subscription service)
CREATE TABLE IF NOT EXISTS blastr_entitlements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pubkey TEXT NOT NULL UNIQUE,
  plan_tier TEXT NOT NULL DEFAULT 'default',
  status TEXT NOT NULL CHECK (status IN ('active', 'grace', 'expired', 'suspended')),
  rate_limit_profile TEXT,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_blastr_entitlements_pubkey ON blastr_entitlements(pubkey);
CREATE INDEX IF NOT EXISTS idx_blastr_entitlements_status ON blastr_entitlements(status);

-- User relay policy per pubkey (blacklist or whitelist mode)
CREATE TABLE IF NOT EXISTS blastr_user_policies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pubkey TEXT NOT NULL UNIQUE,
  mode TEXT NOT NULL CHECK (mode IN ('blacklist', 'whitelist')),
  enabled INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_blastr_user_policies_pubkey ON blastr_user_policies(pubkey);

-- Per-pubkey allow/block relay list (used with mode)
CREATE TABLE IF NOT EXISTS blastr_policy_relays (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pubkey TEXT NOT NULL,
  relay_url TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('allow', 'block')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(pubkey, relay_url)
);

CREATE INDEX IF NOT EXISTS idx_blastr_policy_relays_pubkey ON blastr_policy_relays(pubkey);

-- System relay universe (curated list Blastr may use)
CREATE TABLE IF NOT EXISTS blastr_system_relays (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  relay_url TEXT NOT NULL UNIQUE,
  enabled INTEGER NOT NULL DEFAULT 1,
  health_status TEXT DEFAULT 'unknown',
  score INTEGER NOT NULL DEFAULT 0,
  category TEXT,
  last_checked_at INTEGER,
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_blastr_system_relays_enabled ON blastr_system_relays(enabled);

-- Publish jobs (one per accepted event; resolved_relays is snapshot at enqueue time)
CREATE TABLE IF NOT EXISTS blastr_publish_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL,
  pubkey TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('sfs-app', 'external-client', 'api')),
  received_at INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'processing', 'partial', 'success', 'failed')),
  relay_count_target INTEGER NOT NULL DEFAULT 0,
  relay_count_success INTEGER NOT NULL DEFAULT 0,
  relay_count_failed INTEGER NOT NULL DEFAULT 0,
  resolved_relays TEXT NOT NULL DEFAULT '[]'
);

CREATE INDEX IF NOT EXISTS idx_blastr_publish_jobs_event_id ON blastr_publish_jobs(event_id);
CREATE INDEX IF NOT EXISTS idx_blastr_publish_jobs_status ON blastr_publish_jobs(status);

-- Per-relay attempt outcome for each job
CREATE TABLE IF NOT EXISTS blastr_publish_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL,
  relay_url TEXT NOT NULL,
  attempt_number INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL,
  error_code TEXT,
  latency_ms INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (job_id) REFERENCES blastr_publish_jobs(id)
);

CREATE INDEX IF NOT EXISTS idx_blastr_publish_attempts_job_id ON blastr_publish_attempts(job_id);
