#!/bin/bash
# NYV gateway RDS corpus audit — counts only, never prints DSN/secrets.
set -euo pipefail
GW=$(docker ps --format '{{.Names}}' | grep -E 'gateway|nyv-gateway' | head -1)
echo "GW=$GW"
cat >/tmp/jrx-corpus-audit-nyv.js <<'NODE'
const { Pool } = require('pg');
(async () => {
  const p = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  });
  const q = async (sql) => {
    try {
      const r = await p.query(sql);
      return r.rows;
    } catch (e) {
      return [{ error: String(e.message).slice(0, 160) }];
    }
  };
  const out = {};
  out.db = await q('select current_database() as db, inet_server_addr()::text as host');
  out.schemas = await q(
    "select nspname from pg_namespace where nspname not like 'pg_%' and nspname<>'information_schema' order by 1",
  );
  out.key_tables = await q(`
    select table_schema, table_name
    from information_schema.tables
    where table_name ~* '(rag|document|template|statute|checklist|legal_task|caselaw|hitl|compliance)'
      and table_schema not like 'pg_%'
    order by 1,2
    limit 120`);
  const tryCount = async (label, sql) => { out[label] = await q(sql); };
  await tryCount('rag_documents_public', 'select count(*)::bigint as n from rag_documents');
  await tryCount('rag_documents_nv', 'select count(*)::bigint as n from nv_schema.rag_documents');
  await tryCount('documents_public', 'select count(*)::bigint as n from documents');
  await tryCount('hitl_reviews', 'select count(*)::bigint as n from nv_schema.hitl_reviews');
  await tryCount('ai_activity', 'select count(*)::bigint as n from nv_schema.ai_activity');
  await tryCount('organisations', 'select count(*)::bigint as n from organisations');
  await tryCount('organizations', 'select count(*)::bigint as n from organizations');
  await tryCount('customer_orgs', 'select count(*)::bigint as n from customer_orgs');
  await tryCount('templates_public', 'select count(*)::bigint as n from templates');
  await tryCount('statutes_public', 'select count(*)::bigint as n from statutes');
  console.log(JSON.stringify(out, null, 2));
  await p.end();
})().catch((e) => {
  console.error(String(e.message));
  process.exit(1);
});
NODE
docker cp /tmp/jrx-corpus-audit-nyv.js "$GW":/tmp/jrx-corpus-audit-nyv.js
docker exec "$GW" node /tmp/jrx-corpus-audit-nyv.js
