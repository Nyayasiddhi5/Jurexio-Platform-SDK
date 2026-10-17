-- Global citation graph rows (org_id IS NULL) must be visible to nv_app.
-- Ingest via DATABASE_URL_ADMIN stores org_id=NULL; strict tenant_isolation hid them.

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['nv_legal_graph_entities', 'nv_legal_graph_edges'] LOOP
    IF to_regclass(format('nv_schema.%I', t)) IS NULL THEN
      RAISE NOTICE 'skip % — table missing', t;
      CONTINUE;
    END IF;
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON nv_schema.%I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON nv_schema.%1$I '
      || 'USING (org_id IS NULL OR org_id = current_setting(''app.current_org_id'', true)) '
      || 'WITH CHECK (org_id IS NULL OR org_id = current_setting(''app.current_org_id'', true))',
      t
    );
  END LOOP;
END;
$$;
