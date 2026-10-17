#!/usr/bin/env bash
# One-off: create nv_sme_setup_tokens on EC2 (missing — bootstrap:sme was
# never run there). Idempotent; mirrors scripts/jrx-sme-bootstrap.ts DDL.
# Runs inside the nyv-gateway container which holds the production
# DATABASE_URL + pg driver. NV-SME-RLS-001 / NV-SME-UX-001 unblock.
set -euo pipefail

docker exec -i nyv-gateway node - <<'NODE'
const { Client } = require('pg');
const databaseUrl = process.env.DATABASE_URL_ADMIN || process.env.DATABASE_URL;
if (!databaseUrl) { console.error('DATABASE_URL missing'); process.exit(1); }
const client = new Client({ connectionString: databaseUrl });
(async () => {
  await client.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS nv_sme_setup_tokens (
        id BIGSERIAL PRIMARY KEY,
        token_hash TEXT NOT NULL UNIQUE,
        sme_user_id BIGINT NOT NULL,
        issued_by_user_id BIGINT NOT NULL,
        scope JSONB NOT NULL DEFAULT '{}'::jsonb,
        expires_at TIMESTAMPTZ NOT NULL,
        consumed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS ix_sme_setup_tokens_user ON nv_sme_setup_tokens(sme_user_id)`);
    const r = await client.query(`SELECT to_regclass('public.nv_sme_setup_tokens') AS t`);
    console.log('nv_sme_setup_tokens =', r.rows[0].t);
  } finally {
    await client.end();
  }
})().catch((e) => { console.error(e?.message || String(e)); process.exit(1); });
NODE
echo "DDL_DONE"
