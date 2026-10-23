/**
 * Jurexio Platform — Flat-registry builder
 * NV-AGENT-REGISTRY-MERGE-2026-05-11 (task-135)
 *
 * Merges the 7 canonical jurisdiction registries
 *   config/agent-registries/Jurexio-Legal-registry-{Default,IN,UK,US,GC,EU,SG}.json
 * into the single flat file
 *   src/data/jrx-agents-registry.json
 *
 * That flat file is the source of truth for `scripts/jrx-seed-agents.ts`,
 * which populates the `nv_agents` table at deploy time. The published
 * deployment was failing on boot with `ENOENT jrx-agents-registry.json`
 * because the older file was renamed to `*.legacy-v2-…json` in
 * Session-13a. This script rebuilds the canonical name from the per-
 * jurisdiction sources so the seed step (and any future deploy) finds it.
 *
 * Idempotent. Re-run any time the per-jurisdiction registries change.
 *
 * Usage:
 *   npx tsx scripts/jrx-build-flat-registry.ts
 */

import { readFileSync, writeFileSync, statSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const SRC_DIR = resolve(REPO_ROOT, 'config/agent-registries');
const OUT = process.env.NV_FLAT_REGISTRY_OUT
  ? resolve(process.env.NV_FLAT_REGISTRY_OUT)
  : resolve(REPO_ROOT, 'src/data/jrx-agents-registry.json');
const CODES = ['Default', 'IN', 'UK', 'US', 'GC', 'EU', 'SG'] as const;

function buildFlatRegistry(): void {
  const merged: any[] = [];
  const counts: Record<string, number> = {};

  for (const code of CODES) {
    const file = resolve(SRC_DIR, `Jurexio-Legal-registry-${code}.json`);
    const raw = JSON.parse(readFileSync(file, 'utf-8'));
    const agents: any[] = Array.isArray(raw.agents) ? raw.agents : [];
    counts[code] = agents.length;

    for (const a of agents) {
      if (!a.jurisdiction && !a.jurisdictions) {
        a.jurisdiction = [code === 'Default' ? 'ALL' : code];
      }
      merged.push(a);
    }
  }

  const out = {
    metadata: {
      name: 'Jurexio Legal Agents — Merged Flat Registry',
      marker: 'NV-AGENT-REGISTRY-MERGE-2026-05-11',
      description:
        'Auto-merged from config/agent-registries/Jurexio-Legal-registry-{Default,IN,UK,US,GC,EU,SG}.json by scripts/jrx-build-flat-registry.ts. Consumed by scripts/jrx-seed-agents.ts to populate nv_agents at deploy time. Runtime agent loading still goes through src/services/agent-registry-service.ts which reads the per-jurisdiction files directly.',
      generatedAt: new Date().toISOString().slice(0, 10),
      sourceCounts: counts,
      totalAgents: merged.length,
      sourceFormat: 'v5-governed-execution-network-nyayasiddhi-comprehensive',
    },
    agents: merged,
  };

  writeFileSync(OUT, JSON.stringify(out, null, 2));
  const sz = statSync(OUT).size;
  console.log(`  ✓ wrote ${OUT}`);
  console.log(`    counts: ${JSON.stringify(counts)} total=${merged.length} bytes=${sz}`);
}

buildFlatRegistry();
