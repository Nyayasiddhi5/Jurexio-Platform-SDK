/**
 * JRX-NS-025 (2026-05-05): Remove duplicate IN legal_agents rows.
 *
 * Background:
 *   Every jurisdiction has 149 canonical agents (XX::xx-* pattern).
 *   IN had 297 = 149 canonical (IN::in-*) + 148 dupes (IN::<x> without
 *   the `in-` inner prefix). The 148 dupes were seeded by an obsolete
 *   path; each has a canonical IN::in-<x> equivalent.
 *
 * What this does:
 *   DELETE FROM legal_agents WHERE agent_id LIKE 'IN::%' AND agent_id NOT LIKE 'IN::in-%';
 *   Validates the result equals 149 (matching all other jurisdictions).
 *
 * Idempotent: safe to re-run.
 */

import { makePgSql } from './_pg-pool.js';
import * as dotenv from 'dotenv';
dotenv.config();
const sql = makePgSql();

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  IN Agent Dedupe (297 → 149)');
  console.log('═══════════════════════════════════════════════════════════');

  const before = await sql`SELECT count(*)::int as n FROM legal_agents WHERE agent_id LIKE 'IN::%'`;
  console.log(`Before: ${before[0].n} IN agents`);

  const dupes = await sql`
    DELETE FROM legal_agents
    WHERE agent_id LIKE 'IN::%' AND agent_id NOT LIKE 'IN::in-%'
    RETURNING agent_id
  `;
  console.log(`Deleted: ${dupes.length} duplicate rows (IN::<x> without 'in-' prefix)`);

  const after = await sql`SELECT count(*)::int as n FROM legal_agents WHERE agent_id LIKE 'IN::%'`;
  console.log(`After:  ${after[0].n} IN agents`);

  console.log('\n=== Final per-jurisdiction counts ===');
  for (const [pfx, lower] of [['US','us'],['EU','eu'],['SG','sg'],['GC','gc'],['IN','in']] as Array<[string,string]>) {
    const innerLike = `${pfx}::${lower}-%`;
    const r = await sql`SELECT count(*)::int n FROM legal_agents WHERE agent_id LIKE ${innerLike}`;
    console.log(`  ${pfx}: ${r[0].n}`);
  }

  const total = await sql`SELECT count(*)::int as n FROM legal_agents WHERE agent_id LIKE '%::%'`;
  console.log(`  TOTAL (all jurisdictions): ${total[0].n}`);

  console.log('\n═══════════════════════════════════════════════════════════');
  if (after[0].n === 149) {
    console.log('  ✓ IN dedupe COMPLETE — 149 canonical agents (148 domain + 1 orchestrator).');
    await sql.end();
    process.exit(0);
  } else {
    console.log(`  ✗ FAIL: expected 149 IN agents, got ${after[0].n}`);
    console.log('═══════════════════════════════════════════════════════════');
    await sql.end();
    process.exit(1);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
