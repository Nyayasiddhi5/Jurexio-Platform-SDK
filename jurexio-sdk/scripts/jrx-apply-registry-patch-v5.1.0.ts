#!/usr/bin/env npx tsx
/**
 * Apply jurexio_registry_patch_v5.1.0.json → runtime registry artifacts.
 *
 * Outputs:
 *   config/agent-registries/Jurexio-Legal-registry-Default.json
 *   config/jcn-nodes-v5.1.0.json
 *   config/bar-council-seed-v5.1.0.json
 *   config/agent-registries/archive/v5.0.0/  (moves prior 7 files)
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const PATCH_PATH = path.resolve(ROOT, '..', 'product Documents', 'jurexio_registry_patch_v5.1.0.json');
const REG_DIR = path.join(ROOT, 'config', 'agent-registries');
const ARCHIVE_DIR = path.join(REG_DIR, 'archive', 'v5.0.0');

const LEGACY_FILES = [
  'Jurexio-Legal-registry-Default.json',
  'Jurexio-Legal-registry-IN.json',
  'Jurexio-Legal-registry-UK.json',
  'Jurexio-Legal-registry-US.json',
  'Jurexio-Legal-registry-EU.json',
  'Jurexio-Legal-registry-GC.json',
  'Jurexio-Legal-registry-SG.json',
];

function main(): void {
  if (!fs.existsSync(PATCH_PATH)) {
    console.error(`Patch not found: ${PATCH_PATH}`);
    process.exit(1);
  }

  const patch = JSON.parse(fs.readFileSync(PATCH_PATH, 'utf-8')) as {
    _patchMeta: Record<string, unknown>;
    registry: {
      version: string;
      sdkVersion: string;
      agents: unknown[];
    };
    jcnNodes: Record<string, unknown>;
    barCouncilConfig: Record<string, unknown>;
    guardrails: Record<string, unknown>;
  };

  const agents = patch.registry.agents;
  const romaCounts: Record<string, number> = {};
  for (const a of agents as Array<{ romaLevel?: string }>) {
    const lvl = a.romaLevel || 'L5';
    romaCounts[lvl] = (romaCounts[lvl] || 0) + 1;
  }

  const defaultRegistry = {
    registryFormat: 'v5.1.0-governed-execution-network-format-b',
    registryVersion: '5.1.0',
    generatedAt: new Date().toISOString(),
    platformVersion: '5.0.1',
    jurisdictionCode: 'DEFAULT',
    jurisdictionName: 'Cross-Jurisdiction Default',
    jurisdictionFullName: 'Jurexio Default — All Six Jurisdictions',
    legalSystem: 'Multi-jurisdiction common + civil law hybrid',
    totalAgents: agents.length,
    primaryJurisdiction: 'DEFAULT',
    sdkVersion: patch.registry.sdkVersion || 'JRX-SDK-v5.0.0',
    backedBy: patch.registry.backedBy || 'Jurexio™',
    basePromptId: patch.registry.basePromptId || 'legal-base-v1',
    romaDistribution: romaCounts,
    patchMeta: patch._patchMeta,
    agents,
  };

  fs.mkdirSync(REG_DIR, { recursive: true });
  fs.mkdirSync(ARCHIVE_DIR, { recursive: true });

  for (const file of LEGACY_FILES) {
    const src = path.join(REG_DIR, file);
    if (fs.existsSync(src)) {
      const dest = path.join(ARCHIVE_DIR, file);
      fs.renameSync(src, dest);
      console.log(`Archived ${file} → archive/v5.0.0/`);
    }
  }

  const defaultPath = path.join(REG_DIR, 'Jurexio-Legal-registry-Default.json');
  fs.writeFileSync(defaultPath, JSON.stringify(defaultRegistry, null, 2));
  console.log(`Wrote Default registry: ${agents.length} agents → ${defaultPath}`);

  const jcnPath = path.join(ROOT, 'config', 'jcn-nodes-v5.1.0.json');
  fs.writeFileSync(jcnPath, JSON.stringify({
    version: '5.1.0',
    generatedAt: new Date().toISOString(),
    jcnNodes: patch.jcnNodes,
    guardrails: patch.guardrails,
  }, null, 2));
  console.log(`Wrote JCN nodes → ${jcnPath}`);

  const bcPath = path.join(ROOT, 'config', 'bar-council-seed-v5.1.0.json');
  fs.writeFileSync(bcPath, JSON.stringify(patch.barCouncilConfig, null, 2));
  console.log(`Wrote bar council seed → ${bcPath}`);

  console.log('✅ Patch apply complete. Run: npm run registry:generate-jurisdictions');
}

main();
