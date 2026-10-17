#!/usr/bin/env tsx
/**
 * scripts/jrx-convert-queens-to-xml.ts
 *
 * One-time migration: converts the 6 NS-Queen orchestrator agents
 * ({IN,UK,EU,US,GC,SG}-ns-queen) from the legacy plaintext
 * "[SECTION N: TITLE]" schema to the canonical XML "<section_N_title>"
 * schema used by the other 1036 agents.
 *
 * Adds <role_narrative> inside <section_1_identity> so the registry-lint
 * passes uniformly without an NS-Queen exception.
 *
 * Idempotent: re-running on already-converted prompts is a no-op.
 *
 * Run: npx tsx scripts/jrx-convert-queens-to-xml.ts [--dry-run|--apply]
 */
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REGISTRY_DIR = path.resolve(__dirname, '..', 'config', 'agent-registries');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const DRY_RUN = !APPLY;

const SECTION_TITLE_TO_TAG: Record<string, string> = {
  'ROLE AND IDENTITY': 'identity',
  'JURISDICTION SCOPE': 'jurisdiction_scope',
  'ORCHESTRATION RESPONSIBILITIES': 'orchestration_responsibilities',
  'AGENT HIERARCHY': 'agent_hierarchy',
  'CROSS-JURISDICTION KNOWLEDGE': 'cross_jurisdiction_knowledge',
  'GUARDRAILS': 'guardrails',
};

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function convertPlaintextSectionsToXml(prompt: string): string {
  // If already converted, skip.
  if (prompt.includes('<section_1_identity>')) return prompt;

  // Split prompt into prefix-of-XML and the plaintext bracket sections.
  // The bracket-section block is at the very top of the prompt; the XML
  // sections (<section_23_data_privacy_pii>, <section_10_citation>, ...)
  // live below them. We rewrite ONLY the bracket-section block.
  const firstXmlIdx = prompt.indexOf('<section_');
  const bracketBlock = firstXmlIdx >= 0 ? prompt.slice(0, firstXmlIdx) : prompt;
  const xmlBlock = firstXmlIdx >= 0 ? prompt.slice(firstXmlIdx) : '';

  // Parse "[SECTION N: TITLE]\n<body>\n\n[SECTION ...]" using a regex split.
  const sectionRe = /\[SECTION\s+(\d+):\s+([^\]]+)\]\s*\n([\s\S]*?)(?=\[SECTION\s+\d+:|$)/g;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = sectionRe.exec(bracketBlock)) !== null) {
    const num = m[1];
    const titleRaw = m[2].trim();
    const body = m[3].trim();
    const tag = SECTION_TITLE_TO_TAG[titleRaw.toUpperCase()];
    if (!tag) {
      // Unknown title — keep as-is for safety, log to stderr in dry-run
      console.error(`  [warn] unknown section title "${titleRaw}" — leaving as plaintext`);
      out.push(`[SECTION ${num}: ${titleRaw}]\n${body}\n`);
      continue;
    }
    const tagName = `section_${num}_${tag}`;
    out.push(`<${tagName}>\n${escapeXml(body)}\n</${tagName}>\n`);
  }

  return out.join('\n') + (xmlBlock ? '\n' + xmlBlock : '');
}

function injectRoleNarrative(prompt: string, agent: any): string {
  if (prompt.includes('<role_narrative>')) return prompt;

  const jurisdiction = agent.jurisdiction || 'IN';
  const name = agent.name || agent.id || 'Orchestrator';
  const tier = agent.tier || 'Tier 0';
  const narrative = `<role_narrative>
You are ${escapeXml(name)} — a ${escapeXml(tier)} ROMA-L5 supreme orchestrator for ${escapeXml(jurisdiction)} within Jurexio Platform 3.1.2. You operate at the apex of the agent hierarchy: you decompose multi-jurisdictional matters, fan out to specialist tier-1/2/3 agents, reconcile conflicting outputs against authority-of-source, and enforce the platform-wide guardrail charter (PII redaction, citation verification, HITL escalation, audit-chain integrity). You are accountable for end-to-end answer quality, jurisdictional accuracy, and downstream cost discipline; you do NOT execute primary domain reasoning yourself — you delegate it and synthesize.
</role_narrative>
`;

  // Inject inside <section_1_identity>...</section_1_identity>, after the
  // opening tag but before any existing inner content.
  const identityRe = /(<section_1_identity>)([\s\S]*?)(<\/section_1_identity>)/;
  const match = prompt.match(identityRe);
  if (!match) {
    // Safety: identity section not found — bail without modification.
    console.error('  [warn] <section_1_identity> not found — cannot inject <role_narrative>');
    return prompt;
  }
  const inner = match[2];
  return prompt.replace(identityRe, `$1\n${narrative}${inner}$3`);
}

function main(): void {
  const files = fs
    .readdirSync(REGISTRY_DIR)
    .filter(f => /^Jurexio-Legal-registry-(IN|UK|EU|US|GC|SG)\.json$/.test(f));

  console.log(`[convert-queens] mode=${APPLY ? 'APPLY' : 'DRY-RUN'}, scanning ${files.length} jurisdiction files`);

  let converted = 0;
  let alreadyDone = 0;

  for (const file of files) {
    const filePath = path.join(REGISTRY_DIR, file);
    const raw = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(raw);
    const agents: any[] = Array.isArray(data) ? data : (data.agents || []);

    let mutated = false;
    for (const agent of agents) {
      if (!/-ns-queen$/i.test(agent.id || '')) continue;

      const orig = agent.systemPrompt || '';
      let next = convertPlaintextSectionsToXml(orig);
      next = injectRoleNarrative(next, agent);

      if (next !== orig) {
        console.log(`  [${file}] ${agent.id}: convert ${orig.length}ch → ${next.length}ch`);
        agent.systemPrompt = next;
        mutated = true;
        converted++;
      } else {
        console.log(`  [${file}] ${agent.id}: already converted (skip)`);
        alreadyDone++;
      }
    }

    if (mutated && APPLY) {
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
      console.log(`  [${file}] WRITTEN`);
    } else if (mutated && DRY_RUN) {
      console.log(`  [${file}] would write (dry-run)`);
    }
  }

  console.log(`[convert-queens] done: ${converted} converted, ${alreadyDone} already-done`);
  if (DRY_RUN) {
    console.log(`[convert-queens] (dry-run — re-run with --apply to write)`);
  }
}

main();
