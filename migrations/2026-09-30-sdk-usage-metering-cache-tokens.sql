-- NV-USAGE-CACHE-SPLIT-001 — separate prompt-cache reads/writes in sdk_usage_metering.
ALTER TABLE sdk_usage_metering
  ADD COLUMN IF NOT EXISTS tokens_cache_read INTEGER NOT NULL DEFAULT 0;

ALTER TABLE sdk_usage_metering
  ADD COLUMN IF NOT EXISTS tokens_cache_write INTEGER NOT NULL DEFAULT 0;
