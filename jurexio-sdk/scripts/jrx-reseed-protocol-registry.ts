/**
 * Jurexio Platform 3.1.2 — Protocol Registry reseed
 * JRX-SCRIPT-RESEED-PROTOCOL-001 (T-DLR-11)
 *
 * Idempotent reseed of governance `protocol_registry` (default `jrx_schema`) from the SSoT
 * `capabilityManifest`. Equivalent to the boot-time
 * `initializeProtocolRegistryFromManifest()` path, but runs standalone
 * against any Postgres URL (Neon / RDS / docker) without booting the
 * gateway. Uses ON CONFLICT (protocol_name) DO UPDATE so the row's
 * `config_json` always matches the current manifest.
 *
 * STATUS PRESERVATION (default): the operator-controlled `status` column
 * is *not* clobbered by reseed — only `config_json`, `depends_on`,
 * `activated_by`, `activated_at` are refreshed. New rows still ship with
 * status='active'. Set FORCE_STATUS=1 to also reset status from the
 * manifest (only do this for full ecosystem re-bootstraps).
 *
 * Run:    npx tsx scripts/jrx-reseed-protocol-registry.ts
 * Force:  FORCE_STATUS=1 npx tsx scripts/jrx-reseed-protocol-registry.ts
 * Dry:    DRY_RUN=1 npx tsx scripts/jrx-reseed-protocol-registry.ts
 */

import { makePgSql } from './_pg-pool.js';
import { capabilityManifest } from '../src/orchestration/capability-manifest.js';
import { qualifiedGovernanceTable } from '../src/db/governance-sql.js';
import { ensureGovernanceBootstrap } from '../src/db/jrx-governance-bootstrap.js';

const sql = makePgSql();
const DRY = process.env.DRY_RUN === '1';
const FORCE_STATUS = process.env.FORCE_STATUS === '1';

interface CapabilityShape {
  id: string;
  displayName?: string;
  category?: string;
  tiers?: unknown;
  supportedJurisdictions?: unknown;
  supportedPatterns?: unknown;
  costClass?: unknown;
  safetyClass?: unknown;
  source?: unknown;
  tags?: unknown;
}

async function reseed(): Promise<void> {
  const all = (capabilityManifest as { list: () => CapabilityShape[] }).list();
  const tableRef = qualifiedGovernanceTable('protocol_registry');
  console.log(`  Found ${all.length} capabilities in manifest (table ${tableRef})`);

  if (DRY) {
    console.log('  DRY_RUN=1 — printing first 3 statements only');
    for (const cap of all.slice(0, 3)) {
      console.log(
        `    INSERT INTO ${tableRef}(protocol_name, ...) VALUES ('CAP_${cap.id}', ...)`,
      );
    }
    return;
  }

  await ensureGovernanceBootstrap();

  let inserted = 0;
  let updated = 0;
  for (const cap of all) {
    const protocolName = `CAP_${cap.id}`;
    const config = {
      capabilityId: cap.id,
      displayName: cap.displayName,
      category: cap.category,
      tiers: cap.tiers,
      supportedJurisdictions: cap.supportedJurisdictions,
      supportedPatterns: cap.supportedPatterns,
      costClass: cap.costClass,
      safetyClass: cap.safetyClass,
      source: cap.source,
      tags: cap.tags,
    };
    const dependsOn = [`category:${cap.category ?? 'unknown'}`];
    const upsertSql = FORCE_STATUS
      ? `INSERT INTO ${tableRef} (
            protocol_name, protocol_version, status, config_json, depends_on, activated_by, activated_at
          ) VALUES ($1, '1.0', 'active', $2::jsonb, $3::jsonb, 'system:reseed', NOW())
          ON CONFLICT (protocol_name) DO UPDATE
            SET status = EXCLUDED.status,
                config_json = EXCLUDED.config_json,
                depends_on = EXCLUDED.depends_on,
                activated_by = EXCLUDED.activated_by,
                activated_at = NOW()
          RETURNING (xmax = 0) AS inserted`
      : `INSERT INTO ${tableRef} (
            protocol_name, protocol_version, status, config_json, depends_on, activated_by, activated_at
          ) VALUES ($1, '1.0', 'active', $2::jsonb, $3::jsonb, 'system:reseed', NOW())
          ON CONFLICT (protocol_name) DO UPDATE
            SET config_json = EXCLUDED.config_json,
                depends_on = EXCLUDED.depends_on,
                activated_by = EXCLUDED.activated_by,
                activated_at = NOW()
          RETURNING (xmax = 0) AS inserted`;
    const result = await sql.pool.query(upsertSql, [
      protocolName,
      JSON.stringify(config),
      JSON.stringify(dependsOn),
    ]);
    if (result.rows[0]?.inserted) inserted++; else updated++;
  }
  console.log(`  ✓ protocol_registry reseed complete — inserted=${inserted}, updated=${updated}, total=${all.length}`);
}

reseed().catch((err) => {
  console.error('  ✗ reseed failed:', err);
  process.exit(1);
}).finally(() => sql.end());
