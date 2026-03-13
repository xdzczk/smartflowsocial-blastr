-- Enforce one job per event_id for idempotency under concurrency.
-- If blastr_publish_jobs already has duplicate event_id rows, deduplicate
-- (e.g. keep one row per event_id, delete the rest) before applying this migration.
-- Then: replace non-unique event_id index with a unique index.

DROP INDEX IF EXISTS idx_blastr_publish_jobs_event_id;
CREATE UNIQUE INDEX IF NOT EXISTS idx_blastr_publish_jobs_event_id_unique ON blastr_publish_jobs(event_id);
