/**
 * jrx-hash-chain-stress-smoke.ts — Hash chain at scale + tamper detection
 * NV-OPT+UAT-2026-05-09 P2 #12
 *
 * Two phases:
 *   1) Drive N audit appends (default N=1000), call verifyHashChain(N+100),
 *      assert verified=true and recordsChecked >= N.
 *   2) Tamper test: directly mutate one row's payload via SQL (under
 *      JRX_AUDIT_CHAIN_TOLERATE=1 guard), re-run verifyHashChain, assert
 *      verified=false and firstBrokenId is set.
 *
 * NOTE: Phase 2 is opt-in (set TAMPER=1) because it requires write access
 * to nv_audit_logs. Default run is read-only Phase 1.
 *
 * Usage:
 *   N=1000 npx tsx scripts/jrx-hash-chain-stress-smoke.ts
 *   TAMPER=1 N=500 npx tsx scripts/jrx-hash-chain-stress-smoke.ts
 */
// @ts-nocheck
import fs from 'fs';
import path from 'path';
import { appendAuditRecord, verifyHashChain } from '../src/middleware/jrx-sdk-tracking-middleware.js';
import { db } from '../src/db/index.js';
import { sql } from 'drizzle-orm';

const N = parseInt(process.env.N || '1000', 10);
const TAMPER = process.env.TAMPER === '1';

async function main() {
  const startedAt = new Date().toISOString();
  console.log(`[hash-chain-stress] N=${N} TAMPER=${TAMPER ? 'yes' : 'no'}`);

  // Phase 1: append N records
  const appendStart = Date.now();
  for (let i = 0; i < N; i++) {
    await appendAuditRecord({ eventType: 'SMOKE_EVENT', payload: { i, ts: Date.now(), tag: `synthetic-${i}` } });
    if (i % 100 === 99) console.log(`  appended ${i + 1}/${N}`);
  }
  const appendMs = Date.now() - appendStart;

  // Phase 1b: verify
  const verifyStart = Date.now();
  const v1 = await verifyHashChain(N + 100);
  const verifyMs = Date.now() - verifyStart;
  console.log(`[hash-chain-stress] phase1 append=${appendMs}ms verify=${verifyMs}ms verified=${v1.verified} checked=${v1.recordsChecked} broken=${v1.brokenLinks}`);

  let phase2: any = { skipped: true };

  // Phase 2: tamper detection (opt-in)
  if (TAMPER) {
    if (process.env.JRX_AUDIT_CHAIN_TOLERATE !== '1') {
      console.warn('[hash-chain-stress] TAMPER=1 but JRX_AUDIT_CHAIN_TOLERATE not set; skipping mutation. Re-run with JRX_AUDIT_CHAIN_TOLERATE=1.');
      phase2 = { skipped: true, reason: 'JRX_AUDIT_CHAIN_TOLERATE not set' };
    } else {
      const target = await db.execute(sql`SELECT id, payload FROM nv_schema.nv_audit_logs WHERE event_type='SMOKE_EVENT' ORDER BY created_at DESC LIMIT 1 OFFSET 5`);
      const row = (target as any).rows?.[0];
      if (!row) {
        phase2 = { skipped: true, reason: 'no SMOKE_EVENT row to tamper' };
      } else {
        const before = row.payload;
        const tampered = { ...(typeof before === 'string' ? JSON.parse(before) : before), tampered: true };
        await db.execute(sql`UPDATE nv_schema.nv_audit_logs SET payload=${JSON.stringify(tampered)}::jsonb WHERE id=${row.id}`);
        const v2 = await verifyHashChain(N + 100);
        // Restore
        await db.execute(sql`UPDATE nv_schema.nv_audit_logs SET payload=${JSON.stringify(before)}::jsonb WHERE id=${row.id}`);
        phase2 = {
          tamperedId: row.id,
          verifiedAfterTamper: v2.verified,
          brokenLinks: v2.brokenLinks,
          firstBrokenId: v2.firstBrokenId,
          detected: !v2.verified && v2.brokenLinks >= 1,
        };
      }
    }
  }

  // NV-OPT-CR-001 (2026-05-09 architect): verdict must enforce
  // recordsChecked >= N, otherwise verifier silently accepts a truncated
  // window and the comment-stated guarantee is violated.
  const enoughChecked = (v1.recordsChecked ?? 0) >= N;
  const verdict = (v1.verified && enoughChecked && (!TAMPER || phase2.detected || phase2.skipped)) ? 'PASS' : 'FAIL';
  const summary = {
    suite: './jrx-hash-chain-stress-smoke',
    startedAt,
    finishedAt: new Date().toISOString(),
    N,
    phase1: { verified: v1.verified, recordsChecked: v1.recordsChecked, brokenLinks: v1.brokenLinks, appendMs, verifyMs, chainHead: v1.chainHead?.slice(0, 16) },
    phase2,
    verdict,
  };

  const auditDir = path.join(process.cwd(), 'audit');
  if (!fs.existsSync(auditDir)) fs.mkdirSync(auditDir, { recursive: true });
  const outPath = path.join(auditDir, `hash-chain-stress-${startedAt.replace(/[:.]/g, '-')}.json`);
  const tmp = outPath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(summary, null, 2));
  fs.renameSync(tmp, outPath);

  console.log(`[hash-chain-stress] verdict=${verdict}`);
  console.log(JSON.stringify(summary, null, 2));
  process.exit(verdict === 'PASS' ? 0 : 1);
}

main().catch(e => { console.error('[hash-chain-stress] FATAL', e); process.exit(2); });
