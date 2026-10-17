#!/usr/bin/env npx tsx
/**
 * Jurexio v5.0.1 — Registry refresh + enrichment (T1–T12 unified pass).
 *
 * For every agent in every jurisdiction registry:
 *   1. Rewrites preferredModels + fallbackModels from the canonical tier-map (T2/T3)
 *   2. Rewrites stale model IDs in systemPrompt body (T8 — body consistency)
 *   3. Restores supportedLanguages parity with v2 (T8/T11)
 *   4. Injects <jurisdictional_case_authorities> + <role_narrative> (T12 Option A)
 *
 * Idempotent. Always backs up before --apply.
 *
 * USAGE:
 *   npx tsx scripts/jrx-registry-refresh-models.ts --dry-run
 *   npx tsx scripts/jrx-registry-refresh-models.ts --apply
 *   npx tsx scripts/jrx-registry-refresh-models.ts --apply --jurisdiction=IN
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { getTierModels, STALE_MODEL_REPLACEMENTS } from './lib/agent-model-tiers';
import { getJurisdictionLanguages, EXPECTED_LANG_COUNTS } from './lib/agent-languages';
import {
  buildCaseAuthoritiesBlock,
  buildRoleNarrativeBlock,
} from './lib/prompt-enrichment-templates';

const JUR_CODES = ['IN', 'UK', 'EU', 'US', 'GC', 'SG', 'Default'] as const;
type JurCode = typeof JUR_CODES[number];

function findRegistryDir(): string {
  const candidates = [
    path.join(process.cwd(), 'Jurexio-Platform-SDK', 'config', 'agent-registries'),
    path.join(process.cwd(), 'config', 'agent-registries'),
    path.join(process.cwd(), 'Jurexio-Platform-SDK', 'src', 'data', 'jurisdiction-registries'),
    path.join(process.cwd(), 'src', 'data', 'jurisdiction-registries'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c) && fs.readdirSync(c).some(f => f.startsWith('Jurexio-Legal-registry-'))) {
      return c;
    }
  }
  throw new Error('No registry directory found. Tried: ' + candidates.join(', '));
}

interface PassStats {
  agents: number;
  modelsUpdated: number;
  promptBodyUpdated: number;
  langsUpdated: number;
  enrichmentInjected: number;
  caseBlockSkipped: number;
  narrativeSkipped: number;
}

function refreshAgent(agent: any, jur: JurCode, stats: PassStats): boolean {
  let mutated = false;
  stats.agents++;

  // 1. Top-level model fields
  const tier = agent.tier || 'specialist';
  const practiceArea = agent.practiceArea || agent.category || 'General';
  const hasVoice = Array.isArray(agent.tools) && agent.tools.some((t: string) =>
    /voice|tts|whisper|audio|transcrib|speech/i.test(t));
  const target = getTierModels({ tier, jurisdiction: jur, practiceArea, hasVoice });

  const curPref = JSON.stringify(agent.preferredModels || []);
  const curFall = JSON.stringify(agent.fallbackModels || []);
  const newPref = JSON.stringify(target.preferredModels);
  const newFall = JSON.stringify(target.fallbackModels);
  if (curPref !== newPref || curFall !== newFall) {
    agent.preferredModels = target.preferredModels;
    agent.fallbackModels = target.fallbackModels;
    if (target.voiceModels) agent.voiceModels = target.voiceModels;
    stats.modelsUpdated++;
    mutated = true;
  }

  // 2. Prompt-body stale model rewrite — SCOPED to <section_*>...</section_*> blocks only.
  // Per spec: rewrite only inside <section_*> blocks, leave free-text/audit/example prose alone.
  if (typeof agent.systemPrompt === 'string') {
    const original = agent.systemPrompt;
    const sectionRe = /<section_([a-z0-9_]+)>([\s\S]*?)<\/section_\1>/gi;
    let bodyChanged = false;
    const rewritten = original.replace(sectionRe, (_full, name, inner) => {
      let body = inner;
      let touched = false;
      for (const [pattern, replacement] of STALE_MODEL_REPLACEMENTS) {
        if (pattern.test(body)) {
          body = body.replace(pattern, replacement);
          touched = true;
        }
      }
      if (touched) bodyChanged = true;
      return `<section_${name}>${body}</section_${name}>`;
    });
    if (bodyChanged && rewritten !== original) {
      agent.systemPrompt = rewritten;
      stats.promptBodyUpdated++;
      mutated = true;
    }
  }

  // 3. supportedLanguages parity
  const expectedLangs = getJurisdictionLanguages(jur);
  const curLangs = JSON.stringify(agent.supportedLanguages || []);
  const newLangs = JSON.stringify(expectedLangs);
  if (curLangs !== newLangs) {
    agent.supportedLanguages = expectedLangs;
    stats.langsUpdated++;
    mutated = true;
  }

  // 4. Enrichment — case authorities + role narrative (idempotent inserts)
  if (typeof agent.systemPrompt === 'string') {
    let sp = agent.systemPrompt;
    let enriched = false;

    // Case-authorities block — inject inside <section_10_citation> if absent
    if (!sp.includes('<jurisdictional_case_authorities')) {
      const caseBlock = buildCaseAuthoritiesBlock(jur, practiceArea);
      if (caseBlock) {
        if (sp.includes('</section_10_citation>')) {
          sp = sp.replace('</section_10_citation>', `${caseBlock}\n</section_10_citation>`);
          enriched = true;
        } else if (sp.includes('<section_10_citation>')) {
          sp = sp.replace('<section_10_citation>', `<section_10_citation>\n${caseBlock}`);
          enriched = true;
        } else {
          // Append a new wrapper at end of prompt
          sp = sp.trimEnd() + `\n\n<section_10_citation>\n${caseBlock}\n</section_10_citation>\n`;
          enriched = true;
        }
      } else {
        stats.caseBlockSkipped++;
      }
    } else {
      stats.caseBlockSkipped++;
    }

    // Role-narrative block — inject inside <section_1_identity> if absent
    if (!sp.includes('<role_narrative>')) {
      const narrative = buildRoleNarrativeBlock({
        agentName: agent.name || agent.id,
        agentId: agent.id,
        tier: agent.tier || 'specialist',
        practiceArea,
        jurisdiction: jur,
        description: agent.description,
      });
      if (sp.includes('</section_1_identity>')) {
        sp = sp.replace('</section_1_identity>', `${narrative}\n</section_1_identity>`);
        enriched = true;
      } else if (sp.includes('<section_1_identity>')) {
        sp = sp.replace('<section_1_identity>', `<section_1_identity>\n${narrative}`);
        enriched = true;
      }
    } else {
      stats.narrativeSkipped++;
    }

    if (enriched) {
      agent.systemPrompt = sp;
      stats.enrichmentInjected++;
      mutated = true;
    }
  }

  return mutated;
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const jurFilter = args.find(a => a.startsWith('--jurisdiction='))?.split('=')[1];
  const codes = jurFilter ? [jurFilter as JurCode] : [...JUR_CODES];

  const REGISTRY_DIR = findRegistryDir();
  console.log(`[refresh] registry dir: ${REGISTRY_DIR}`);
  console.log(`[refresh] mode: ${apply ? 'APPLY' : 'DRY-RUN'}`);
  console.log(`[refresh] jurisdictions: ${codes.join(', ')}`);
  console.log();

  if (apply) {
    const ts = Date.now();
    const backupDir = path.join(process.cwd(), '.local', `registry-backup-${ts}`);
    fs.mkdirSync(backupDir, { recursive: true });
    for (const code of codes) {
      const src = path.join(REGISTRY_DIR, `Jurexio-Legal-registry-${code}.json`);
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, path.join(backupDir, `Jurexio-Legal-registry-${code}.json`));
      }
    }
    console.log(`[refresh] backup: ${backupDir}`);
  }

  const totalStats: PassStats = {
    agents: 0, modelsUpdated: 0, promptBodyUpdated: 0,
    langsUpdated: 0, enrichmentInjected: 0,
    caseBlockSkipped: 0, narrativeSkipped: 0,
  };

  for (const code of codes) {
    const file = path.join(REGISTRY_DIR, `Jurexio-Legal-registry-${code}.json`);
    if (!fs.existsSync(file)) {
      console.log(`[${code}] SKIP — file not found`);
      continue;
    }
    const reg = JSON.parse(fs.readFileSync(file, 'utf8'));
    const fileStats: PassStats = {
      agents: 0, modelsUpdated: 0, promptBodyUpdated: 0,
      langsUpdated: 0, enrichmentInjected: 0,
      caseBlockSkipped: 0, narrativeSkipped: 0,
    };
    let anyMutated = false;
    for (const agent of reg.agents || []) {
      const m = refreshAgent(agent, code, fileStats);
      if (m) anyMutated = true;
    }
    totalStats.agents += fileStats.agents;
    totalStats.modelsUpdated += fileStats.modelsUpdated;
    totalStats.promptBodyUpdated += fileStats.promptBodyUpdated;
    totalStats.langsUpdated += fileStats.langsUpdated;
    totalStats.enrichmentInjected += fileStats.enrichmentInjected;

    const expectedLangs = EXPECTED_LANG_COUNTS[code as keyof typeof EXPECTED_LANG_COUNTS];
    console.log(
      `[${code.padEnd(7)}] agents=${fileStats.agents.toString().padStart(4)} ` +
      `models=${fileStats.modelsUpdated.toString().padStart(4)} ` +
      `body=${fileStats.promptBodyUpdated.toString().padStart(4)} ` +
      `langs=${fileStats.langsUpdated.toString().padStart(4)}/${expectedLangs} ` +
      `enriched=${fileStats.enrichmentInjected.toString().padStart(4)} ` +
      `${anyMutated ? '(would-mutate)' : '(no-op)'}`
    );

    if (apply && anyMutated) {
      reg.metadata = reg.metadata || {};
      reg.metadata.registryVersion = '5.0.1';
      reg.metadata.lastRefreshAt = new Date().toISOString();
      reg.metadata.lastRefreshBy = './jrx-registry-refresh-models.ts';
      fs.writeFileSync(file, JSON.stringify(reg, null, 2));
    }
  }

  console.log();
  console.log('=== TOTALS ===');
  console.log(`agents:           ${totalStats.agents}`);
  console.log(`models updated:   ${totalStats.modelsUpdated}`);
  console.log(`bodies updated:   ${totalStats.promptBodyUpdated}`);
  console.log(`langs updated:    ${totalStats.langsUpdated}`);
  console.log(`enrichments:      ${totalStats.enrichmentInjected}`);
  if (!apply) console.log('\nDRY-RUN — re-run with --apply to write changes.');
  else console.log('\nAPPLIED — files rewritten.');
}

main().catch(err => { console.error(err); process.exit(1); });
