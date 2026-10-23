-- JRX-DB-RENAME-001 — greenfield US: optional rename of legacy nyayamitra_* tables to jrx_citizen_*.
-- Run only on empty or migration-approved databases. Idempotent where noted.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'nyayamitra_users') THEN
    ALTER TABLE IF EXISTS nyayamitra_users RENAME TO jrx_citizen_users;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'nyayamitra_sessions') THEN
    ALTER TABLE IF EXISTS nyayamitra_sessions RENAME TO jrx_citizen_sessions;
  END IF;
END $$;
