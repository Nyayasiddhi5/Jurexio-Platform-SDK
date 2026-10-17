-- NV-AUDIT-SDKLOG-001 (2026-06-25)
-- Restore ecosystem/SDK request-log capture that silently stopped on 2026-05-13.
-- Root cause: Task365 (drizzle/0013_customer_org_rls.sql) enabled FORCED RLS on
-- public.sdk_api_request_logs with a single PERMISSIVE "FOR ALL" policy whose
-- WITH CHECK requires application_id = nv.platform_id AND customer_org_id =
-- nv.customer_org_id. The gateway writer (nv-sdk-gateway.ts res.on('finish'))
-- inserts as nv_app on a non-tenant-bound connection (no GUCs) and most requests
-- are platform-level (customer_org_id NULL), so every INSERT failed WITH CHECK
-- and was swallowed by .catch().
--
-- Fix: an append-only audit log must never have its writes silently rejected.
-- Add a dedicated PERMISSIVE FOR INSERT policy with CHECK (true) so server-side
-- audit writes always land. Reads remain governed by customer_org_isolation
-- (USING), so per-tenant SELECT isolation is fully preserved. Inserts are only
-- ever issued by trusted server middleware (tenants have no direct SQL access),
-- so unconditional INSERT is safe.
DO $$
DECLARE
  t text;
  tables text[] := ARRAY['sdk_api_request_logs', 'sdk_usage_metering'];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = t AND c.relrowsecurity
    ) THEN
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_append', t);
      EXECUTE format('CREATE POLICY %I ON public.%I AS PERMISSIVE FOR INSERT TO public WITH CHECK (true)', t || '_append', t);
      RAISE NOTICE 'append-policy ensured on public.%', t;
    ELSE
      RAISE NOTICE 'skip public.% (no RLS or table missing)', t;
    END IF;
  END LOOP;
END $$;
