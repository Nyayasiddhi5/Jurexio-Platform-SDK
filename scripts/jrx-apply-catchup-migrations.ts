/**
 * Apply idempotent SQL catch-up migrations (public + legal-doc domain).
 *
 * Usage:
 *   cd Jurexio-Platform-SDK && npx tsx scripts/jrx-apply-catchup-migrations.ts
 *
 * R-SCHEMA-B: nv_schema parity is still deferred unless JRX_DRIFT_STRICT_NV_SCHEMA=1.
 * This script provisions public-schema tables referenced by the gateway boot path
 * (ns_parsed_documents, legal_chat_*, etc.) without requiring drizzle-kit push.
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import { normalizePgConnectionString } from '../src/utils/jrx-pg-url.js';

const CATCHUP_FILES = [
  'migrations/2026-05-28-legal-doc-domain-catchup.sql',
  'migrations/2026-05-13-sdk-workflows-schema-catchup.sql',
] as const;

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL || process.env.JRX_DATABASE_URL;
  if (!url) {
    console.error('[catchup] DATABASE_URL or JRX_DATABASE_URL required');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: normalizePgConnectionString(url) });
  try {
    for (const rel of CATCHUP_FILES) {
      const path = join(process.cwd(), rel);
      const sql = readFileSync(path, 'utf8');
      console.log(`[catchup] applying ${rel} …`);
      await pool.query(sql);
      console.log(`[catchup] ✓ ${rel}`);
    }

    const check = await pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name = ANY($1::text[])`,
      [['ns_parsed_documents', 'ns_doc_processing_jobs', 'legal_chat_sessions']],
    );
    const present = new Set(check.rows.map(r => r.table_name));
    for (const t of ['ns_parsed_documents', 'ns_doc_processing_jobs', 'legal_chat_sessions']) {
      console.log(`[catchup] ${present.has(t) ? '✓' : '✗'} public.${t}`);
    }

    if (process.env.JRX_DRIFT_STRICT_NV_SCHEMA === '1') {
      console.log('[catchup] JRX_DRIFT_STRICT_NV_SCHEMA=1 — run npm run guardrail:schema-drift after nv_schema DDL lands');
    } else {
      console.log('[catchup] R-SCHEMA-B: nv_schema strict parity deferred (set JRX_DRIFT_STRICT_NV_SCHEMA=1 when ready)');
    }
  } finally {
    await pool.end();
  }
}

main().catch(err => {
  console.error('[catchup] failed:', err?.message || err);
  process.exit(1);
});
