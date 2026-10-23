#!/usr/bin/env npx tsx
/**
 * NV-GRPO-EXPORT-001 — nightly export of GRPO preference pairs for offline policy learning.
 *
 * Reads durable rows from `nv_grpo_preference_pairs` (+ optional Redis stream peek)
 * and writes JSONL under docs/audit/grpo-exports/ (or JRX_GRPO_EXPORT_DIR).
 *
 * Usage:
 *   npx tsx scripts/jrx-grpo-nightly-export.ts
 *   JRX_GRPO_EXPORT_LOOKBACK_HOURS=48 npx tsx scripts/jrx-grpo-nightly-export.ts
 *
 * Cron / platform job: started by jrx-start-platform-jobs when JRX_GRPO_NIGHTLY_EXPORT=1
 * (default ON in production).
 *
 * Does NOT train model weights — exports pairs for a future trainer consumer.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { makePgSql } from './_pg-pool.js';

const LOOKBACK_H = Math.max(1, Number(process.env.JRX_GRPO_EXPORT_LOOKBACK_HOURS) || 24);
const OUT_DIR =
  process.env.JRX_GRPO_EXPORT_DIR ||
  path.join(process.cwd(), 'docs', 'audit', 'grpo-exports');

async function main(): Promise<void> {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + 'Z';
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const outFile = path.join(OUT_DIR, `grpo-pairs-${stamp}.jsonl`);

  const sql = makePgSql();
  let rows: any[] = [];
  try {
    // makePgSql returns a tagged-template fn; use .pool.query for parameterized SQL
    const res = await sql.pool.query(
      `SELECT id, orchestration_id, sme_user_id, jurisdiction, task_kind, model,
              ratings, avg_score, enqueued_redis, created_at
         FROM nv_grpo_preference_pairs
        WHERE created_at >= NOW() - ($1::text || ' hours')::interval
        ORDER BY created_at ASC
        LIMIT 50000`,
      [String(LOOKBACK_H)],
    );
    rows = res.rows || [];
  } catch (e: any) {
    // Table may live under nv_schema
    try {
      const res = await sql.pool.query(
        `SELECT id, orchestration_id, sme_user_id, jurisdiction, task_kind, model,
                ratings, avg_score, enqueued_redis, created_at
           FROM nv_schema.nv_grpo_preference_pairs
          WHERE created_at >= NOW() - ($1::text || ' hours')::interval
          ORDER BY created_at ASC
          LIMIT 50000`,
        [String(LOOKBACK_H)],
      );
      rows = res.rows || [];
    } catch (e2: any) {
      const msg = String(e2?.message || e?.message || '');
      // Empty / missing table is OK — write zero-pair export, do not crash the job.
      if (/does not exist|relation .* does not exist/i.test(msg)) {
        console.warn('[grpo-export] preference table missing — writing empty export:', msg.slice(0, 160));
        rows = [];
      } else {
        console.error('[grpo-export] query failed:', msg);
        await sql.end().catch(() => undefined);
        process.exit(1);
      }
    }
  }

  const fd = fs.openSync(outFile, 'w');
  for (const r of rows) {
    fs.writeSync(fd, JSON.stringify(r) + '\n');
  }
  fs.closeSync(fd);

  const meta = {
    exportedAt: new Date().toISOString(),
    lookbackHours: LOOKBACK_H,
    pairCount: rows.length,
    outFile,
    note: 'Pairs for offline GRPO/DPO trainer — gateway does not train weights in-process.',
  };
  fs.writeFileSync(outFile.replace(/\.jsonl$/, '.meta.json'), JSON.stringify(meta, null, 2));
  console.log(JSON.stringify(meta));
  await sql.end().catch(() => undefined);
}

main().catch((e) => {
  console.error('[grpo-export] fatal', e);
  process.exit(1);
});
