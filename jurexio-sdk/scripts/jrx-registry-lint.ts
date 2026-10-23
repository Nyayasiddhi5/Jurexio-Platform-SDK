#!/usr/bin/env tsx
/**
 * scripts/jrx-registry-lint.ts
 *
 * Registry consistency regression check (Task #27/#28 close-out).
 *
 * Validates every agent in every config/agent-registries/Jurexio-Legal-registry-*.json
 * file against the post-T1-T12 contract:
 *
 *   1. preferredModels and fallbackModels MUST contain only models in PROVIDER_MODEL_CATALOG
 *      (i.e. anthropic / openai / google / openrouter / sarvam — the 5-provider lockdown).
 *   2. systemPrompt MUST NOT contain any STALE_MODEL_REPLACEMENTS pattern inside any
 *      <section_*>...</section_*> XML block (free-text/audit prose is exempt).
 *   3. supportedLanguages.length MUST equal getJurisdictionLanguages(jur).length.
 *   4. Every agent MUST contain a <jurisdictional_case_authorities ...> sub-block
 *      INSIDE <section_10_citation> (verified by extracting the section body first).
 *   5. Every agent MUST contain a <role_narrative> block INSIDE <section_1_identity>.
 *      Applies to all 1042 agents — the 6 *-ns-queen orchestrators were converted
 *      to the unified XML schema in JRX-QUEEN-XML-CLEANUP-001 and have NO exemption.
 *
 * Exits 0 on PASS, 1 on any violation. Designed for CI / pre-commit / pre-deploy.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { isAllowedModel } from '../src/config/jrx-allowed-providers.js';
import { STALE_MODEL_REPLACEMENTS } from './lib/agent-model-tiers';
import { getJurisdictionLanguages } from './lib/agent-languages';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REGISTRY_DIR = path.resolve(__dirname, '..', 'config', 'agent-registries');

const REGISTRY_FILE_RE = /^Jurexio-Legal-registry-(IN|UK|EU|US|GC|SG|Default)\.json$/;

interface Violation {
  file: string;
  agentId: string;
  rule: string;
  detail: string;
}

const violations: Violation[] = [];

function lintAgent(file: string, jurisdiction: string, agent: any): void {
  const id = agent.id || agent.agentId || '<unknown>';
  const isQueen = typeof id === 'string' && /-ns-queen$/i.test(id);

  // Rule 1: preferredModels + fallbackModels must be allow-listed
  for (const field of ['preferredModels', 'fallbackModels'] as const) {
    const arr: unknown = agent[field];
    if (!Array.isArray(arr)) continue;
    for (const m of arr) {
      if (typeof m !== 'string') continue;
      if (!isAllowedModel(m)) {
        violations.push({
          file,
          agentId: id,
          rule: 'lockdown',
          detail: `${field} contains disallowed model "${m}"`,
        });
      }
    }
  }

  // Rule 2: systemPrompt must not contain stale model patterns inside <section_*> blocks
  const sp: string = typeof agent.systemPrompt === 'string' ? agent.systemPrompt : '';
  if (sp) {
    const sectionRe = /<(section_[^>\s]+)>([\s\S]*?)<\/\1>/g;
    let secMatch: RegExpExecArray | null;
    while ((secMatch = sectionRe.exec(sp)) !== null) {
      const body = secMatch[2];
      for (const [pattern] of STALE_MODEL_REPLACEMENTS) {
        if (pattern.test(body)) {
          violations.push({
            file,
            agentId: id,
            rule: 'stale-model',
            detail: `${secMatch[1]} contains stale model pattern ${pattern.source}`,
          });
          // Reset regex lastIndex (test() w/ global flag mutates state)
          pattern.lastIndex = 0;
        }
      }
    }
  }

  // Rule 3: supportedLanguages.length matches jurisdiction expectation
  const expectedLangCount = getJurisdictionLanguages(jurisdiction).length;
  const actualLangs = Array.isArray(agent.supportedLanguages) ? agent.supportedLanguages : [];
  if (actualLangs.length !== expectedLangCount) {
    violations.push({
      file,
      agentId: id,
      rule: 'lang-count',
      detail: `supportedLanguages.length=${actualLangs.length} but expected ${expectedLangCount} for jurisdiction=${jurisdiction}`,
    });
  }

  // Rule 4: <jurisdictional_case_authorities ...> present INSIDE the citation section.
  // v5.0.0 moved citation from §10 to §6 (and put PII Protocol at §10). We accept either
  // location during the v3→v5 migration window — if neither is present, violation.
  if (sp) {
    const cit6Match = sp.match(/<(section_6_citation[^>\s]*)>([\s\S]*?)<\/\1>/);
    const cit10Match = sp.match(/<(section_10_citation[^>\s]*)>([\s\S]*?)<\/\1>/);
    const citMatch = cit6Match || cit10Match;
    if (!citMatch) {
      violations.push({
        file,
        agentId: id,
        rule: 'missing-citation-section',
        detail: 'systemPrompt missing <section_6_citation> (v5) or <section_10_citation> (v3) block',
      });
    } else if (!/<jurisdictional_case_authorities[\s>]/.test(citMatch[2])) {
      violations.push({
        file,
        agentId: id,
        rule: 'missing-case-authorities',
        detail: 'citation section missing <jurisdictional_case_authorities ...> sub-block',
      });
    }
  }

  // Rule 5: <role_narrative> present INSIDE <section_1_identity>.
  // NS-Queen exemption removed in JRX-QUEEN-XML-CLEANUP-001 — all 1042 agents,
  // including the 6 *-ns-queen orchestrators, now use the unified XML schema.
  // (Marker `isQueen` retained for diagnostic context but no longer skips.)
  void isQueen;
  if (sp) {
    const ident1Match = sp.match(/<(section_1_identity[^>\s]*)>([\s\S]*?)<\/\1>/);
    if (!ident1Match) {
      violations.push({
        file,
        agentId: id,
        rule: 'missing-section-1-identity',
        detail: 'systemPrompt missing <section_1_identity> block',
      });
    } else if (!/<role_narrative[\s>]/.test(ident1Match[2])) {
      violations.push({
        file,
        agentId: id,
        rule: 'missing-role-narrative',
        detail: '<section_1_identity> missing <role_narrative> block',
      });
    }
  }
}

function lintRegistryFile(filePath: string): { jurisdiction: string; agentCount: number } {
  const file = path.basename(filePath);
  const m = file.match(REGISTRY_FILE_RE);
  if (!m) {
    throw new Error(`File ${file} does not match REGISTRY_FILE_RE`);
  }
  const jurisdiction = m[1];

  const raw = fs.readFileSync(filePath, 'utf8');
  const json = JSON.parse(raw);
  const agents: any[] = Array.isArray(json) ? json : (json.agents || []);

  for (const agent of agents) {
    lintAgent(file, jurisdiction, agent);
  }
  return { jurisdiction, agentCount: agents.length };
}

function main(): void {
  if (!fs.existsSync(REGISTRY_DIR)) {
    console.error(`[lint] registry dir not found: ${REGISTRY_DIR}`);
    process.exit(1);
  }
  const files = fs
    .readdirSync(REGISTRY_DIR)
    .filter(f => REGISTRY_FILE_RE.test(f))
    .sort();

  if (files.length !== 7) {
    console.error(`[lint] expected 7 registry files, found ${files.length}: ${files.join(', ')}`);
    process.exit(1);
  }

  console.log(`[lint] scanning ${files.length} registry files in ${REGISTRY_DIR}`);

  let total = 0;
  for (const f of files) {
    const { jurisdiction, agentCount } = lintRegistryFile(path.join(REGISTRY_DIR, f));
    total += agentCount;
    console.log(`  ${jurisdiction.padEnd(8)} ${agentCount} agents`);
  }
  console.log(`[lint] total: ${total} agents across ${files.length} jurisdictions`);

  if (violations.length === 0) {
    console.log(`[lint] PASS — no violations`);
    process.exit(0);
  }

  // Group by rule
  const byRule = new Map<string, Violation[]>();
  for (const v of violations) {
    const arr = byRule.get(v.rule) || [];
    arr.push(v);
    byRule.set(v.rule, arr);
  }
  console.error(`\n[lint] FAIL — ${violations.length} violations across ${byRule.size} rule(s):`);
  for (const [rule, vs] of byRule) {
    console.error(`\n  Rule "${rule}": ${vs.length} violation(s)`);
    for (const v of vs.slice(0, 10)) {
      console.error(`    - [${v.file}] agent=${v.agentId} :: ${v.detail}`);
    }
    if (vs.length > 10) {
      console.error(`    ... and ${vs.length - 10} more`);
    }
  }
  process.exit(1);
}

main();
