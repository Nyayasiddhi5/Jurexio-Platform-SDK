/**
 * Generate a JSON snapshot of the capability manifest.
 * JRX-ORCH-CAPMAN-SNAPSHOT-001 (Task #32)
 *
 * Output: src/orchestration/capability-manifest.snapshot.json
 *
 * The snapshot is the static, byId+byCategory view of the manifest used by:
 *   - SDK auto-init (per-tier capability listing)
 *   - Documentation site (auto-generated capability index)
 *   - Smoke tests (assert real coverage, no synthetic capabilities)
 *
 * Run: tsx scripts/generate-capability-manifest-snapshot.ts
 */

import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { capabilityManifest } from '../src/orchestration/capability-manifest.js';

function main(): void {
  const all = capabilityManifest.list();
  const byCategory: Record<string, string[]> = {};
  for (const cap of all) {
    (byCategory[cap.category] ??= []).push(cap.id);
  }
  const byTier: Record<string, string[]> = { lite: [], mitra: [], enterprise: [], sovereign: [], 'white-label': [] };
  for (const t of Object.keys(byTier)) {
    byTier[t] = capabilityManifest.capabilitiesForTier(t as any).map((c) => c.id);
  }

  const snapshot = {
    generatedAt: new Date().toISOString(),
    total: all.length,
    byCategory,
    byTier,
    capabilities: all.map((c) => ({
      id: c.id,
      displayName: c.displayName,
      category: c.category,
      tiers: c.tiers,
      supportedJurisdictions: c.supportedJurisdictions,
      costClass: c.costClass,
      safetyClass: c.safetyClass,
      supportedPatterns: c.supportedPatterns,
      tags: c.tags,
      source: c.source,
      inputs: c.inputs ?? null,
      output: c.output ?? null,
    })),
  };

  const outPath = resolve(process.cwd(), 'src/orchestration/capability-manifest.snapshot.json');
  writeFileSync(outPath, JSON.stringify(snapshot, null, 2) + '\n', 'utf8');
  console.log(`[snapshot] wrote ${outPath} (${all.length} capabilities, ${Object.keys(byCategory).length} categories)`);
}

main();
