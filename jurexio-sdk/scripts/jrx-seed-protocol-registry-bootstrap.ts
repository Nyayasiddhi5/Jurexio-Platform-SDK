/**
 * JRX-SEED-PROTOCOL-REGISTRY-001 — empty RDS governance + manifest rows (idempotent).
 *
 * Run before or after first gateway boot on greenfield Option B RDS:
 *   npx tsx scripts/jrx-seed-protocol-registry-bootstrap.ts
 *
 * Steps: ensure jrx_schema (+ legacy nv_schema) DDL, then upsert CAP_* rows
 * from capabilityManifest (same as boot-time initializeFromManifest).
 */

import { ensureGovernanceBootstrap } from '../src/db/jrx-governance-bootstrap.js';
import { initializeProtocolRegistryFromManifest } from '../src/services/jrx-protocol-registry-manifest.js';
import { NvProtocolRegistryService } from '../src/services/jrx-orchestration-services.js';

async function main(): Promise<void> {
  console.log('== JRX protocol_registry bootstrap ==');
  await ensureGovernanceBootstrap();
  const svc = new NvProtocolRegistryService();
  const stats = await initializeProtocolRegistryFromManifest((p) => svc.registerProtocol(p));
  console.log(`  ✓ manifest rows: registered=${stats.registered} skipped=${stats.skipped} total=${stats.total}`);
}

main().catch((err) => {
  console.error('  ✗ bootstrap failed:', err);
  process.exit(1);
});
