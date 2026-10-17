#!/usr/bin/env npx tsx
/**
 * Build legacy v5.0.0 agent ID → v5.1.0 ID alias map for backward compatibility.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const ARCHIVE = path.join(ROOT, 'config', 'agent-registries', 'archive', 'v5.0.0');
const DEFAULT_PATH = path.join(ROOT, 'config', 'agent-registries', 'Jurexio-Legal-registry-Default.json');
const OUT = path.join(ROOT, 'config', 'agent-registries', 'agent-id-aliases-v5.1.0.json');

const SLUG_MAP: Record<string, string> = {
  'chief-legal-officer': 'A-001',
  'general-counsel': 'A-001',
  'contract-specialist': 'A-001',
  'contract-drafting': 'A-001',
  'contract-drafter': 'A-001',
  'contract-review': 'A-025',
  'contract-reviewer': 'A-025',
  'contract-negotiation': 'A-025',
  'contract-risk': 'A-025',
  'litigation-specialist': 'A-004',
  'court-filing': 'A-070',
  'pleading-draft': 'A-004',
  'litigation-research': 'A-048',
  'litigation-risk': 'A-028',
  'legal-research': 'A-047',
  'mentor-agent': 'A-047',
  'compliance-lead': 'A-065',
  'tax-compliance': 'A-078',
  'data-privacy': 'A-063',
  'arbitration-specialist': 'A-019',
  'ns-queen': 'Q-001',
  queen: 'Q-001',
};

function normalizeSlug(id: string): string {
  return id
    .replace(/^(in|uk|us|eu|gc|sg|default|india|united-kingdom|united-states)-/, '')
    .toLowerCase();
}

function nameScore(a: string, b: string): number {
  const ta = new Set(a.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean));
  const tb = new Set(b.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean));
  let hit = 0;
  for (const w of ta) if (tb.has(w)) hit++;
  return hit;
}

function main(): void {
  const defaultReg = JSON.parse(fs.readFileSync(DEFAULT_PATH, 'utf-8')) as {
    agents: Array<{ id: string; name: string }>;
  };
  const newByName = defaultReg.agents;

  const aliases: Record<string, string> = {
    'ns-queen-orchestrator': 'Q-001',
    'queen-orchestration-engine': 'Q-001',
  };

  const archiveFiles = fs.existsSync(ARCHIVE)
    ? fs.readdirSync(ARCHIVE).filter(f => f.endsWith('.json'))
    : [];

  for (const file of archiveFiles) {
    const data = JSON.parse(fs.readFileSync(path.join(ARCHIVE, file), 'utf-8')) as {
      agents: Array<{ id: string; name: string }>;
    };
    for (const old of data.agents) {
      if (aliases[old.id]) continue;
      const slug = normalizeSlug(old.id);
      if (SLUG_MAP[slug]) {
        aliases[old.id] = SLUG_MAP[slug];
        continue;
      }
      let best = '';
      let bestScore = 0;
      for (const neu of newByName) {
        const s = nameScore(old.name.replace(/^India |^UK |^US |^EU |^GCC |^Singapore /i, ''), neu.name);
        if (s > bestScore) {
          bestScore = s;
          best = neu.id;
        }
      }
      if (bestScore >= 2 && best) aliases[old.id] = best;
    }
  }

  fs.writeFileSync(OUT, JSON.stringify({
    version: '5.1.0',
    generatedAt: new Date().toISOString(),
    description: 'Legacy v5.0.0 per-jurisdiction agent IDs → v5.1.0 canonical IDs',
    aliases,
    aliasCount: Object.keys(aliases).length,
  }, null, 2));

  console.log(`Wrote ${Object.keys(aliases).length} aliases → ${OUT}`);
}

main();
