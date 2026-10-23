#!/usr/bin/env bash
set -uo pipefail
cd /opt/nyv/api
set -a && source .env && set +a
node apply-sc-body-fts-ddl.mjs 2>/dev/null | tail -1
node - <<'NODE'
const pg = require('pg');
(async () => {
  const p = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  const sc = await p.query("SELECT COUNT(*)::int n FROM judgments WHERE court_type='sc'");
  const idx = await p.query("SELECT COUNT(*)::int n FROM judgments WHERE court_type='sc' AND body_search_tsv IS NOT NULL");
  let citationEdges = null;
  try {
    const e = await p.query('SELECT COUNT(*)::int n FROM citation_edges');
    citationEdges = e.rows[0].n;
  } catch (err) {
    citationEdges = 'table_missing_or_error';
  }
  console.log(JSON.stringify({
    sc_total: sc.rows[0].n,
    sc_body_indexed: idx.rows[0].n,
    pct_complete: +(100 * idx.rows[0].n / sc.rows[0].n).toFixed(2),
    citation_edges: citationEdges,
  }));
  await p.end();
})().catch((e) => { console.error('db_err', e.message); process.exit(1); });
NODE
