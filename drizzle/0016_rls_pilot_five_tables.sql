-- Phase B RLS pilot — enable FORCE RLS on 5 highest-risk unprotected org_id tables.
-- Tables: nv_clawdbot_conversations, nv_openbot_inbox, nv_openbot_channels,
--         nv_clawdbot_bots, nv_org_console_layout
-- Route audit: nv-openbot-routes (org scoping), nv-org-console-layout-routes (withTenant wired Phase B)
-- Idempotent; does NOT touch the other 5 unprotected tables.

DO $$
DECLARE
  rec RECORD;
BEGIN
  FOR rec IN
    SELECT * FROM (VALUES
      ('nv_schema', 'nv_clawdbot_conversations'),
      ('nv_schema', 'nv_openbot_inbox'),
      ('nv_schema', 'nv_openbot_channels'),
      ('nv_schema', 'nv_clawdbot_bots'),
      ('public',    'nv_org_console_layout')
    ) AS t(schema_name, table_name)
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables t
      JOIN information_schema.columns c
        ON c.table_schema = t.table_schema
       AND c.table_name = t.table_name
       AND c.column_name = 'org_id'
      WHERE t.table_schema = rec.schema_name AND t.table_name = rec.table_name
    ) THEN
      EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I.%I', rec.schema_name, rec.table_name);
      EXECUTE format($q$
        CREATE POLICY tenant_isolation ON %I.%I
          USING      (org_id::text = current_setting('app.current_org_id', true))
          WITH CHECK (org_id::text = current_setting('app.current_org_id', true))
      $q$, rec.schema_name, rec.table_name);
      EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', rec.schema_name, rec.table_name);
      EXECUTE format('ALTER TABLE %I.%I FORCE ROW LEVEL SECURITY', rec.schema_name, rec.table_name);
      RAISE NOTICE 'RLS PILOT ENFORCED on %.%', rec.schema_name, rec.table_name;
    ELSE
      RAISE NOTICE 'RLS PILOT SKIP (missing) %.%', rec.schema_name, rec.table_name;
    END IF;
  END LOOP;
END;
$$;
