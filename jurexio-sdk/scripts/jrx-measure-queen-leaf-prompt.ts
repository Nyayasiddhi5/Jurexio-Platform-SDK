/**
 * NV-TOKEN-BUDGET-001 (Queen leaf lane) — before/after prompt-token measurement
 * harness for Queen leaf dispatch.
 *
 * Run: `npx tsx scripts/jrx-measure-queen-leaf-prompt.ts`
 *      `npx tsx scripts/jrx-measure-queen-leaf-prompt.ts --json`
 *
 * ## What this measures, and what it does not
 *
 * It assembles the REAL leaf system prompt — real IN agent-registry prompts, the
 * real legal-intelligence overlay, the real layered L0/L1 builder — through the
 * exact code path `jrx-queen-orchestrator.callAgentInner()` now uses, and reports
 * the estimated token count of each. "Before" is not a projection: it is the
 * same assembler run with `JRX_PROMPT_BUDGET=0`, which is byte-for-byte the
 * pre-fix behaviour (full overlay tier, non-lean L1, L0 permitted).
 *
 * It does NOT measure provider-billed prompt tokens. Those include the RAG /
 * memory context blocks that the middleware ring injects at runtime and the
 * provider's own tokenizer, neither of which exist offline. Numbers here are
 * therefore SYSTEM-PROMPT tokens under the platform's single estimator
 * (`JrxTokenBudgetManager.estimateTokens`) — comparable to each other and to the
 * Phase-3 component table, not directly to a provider invoice line.
 *
 * Live measured reference (jrx-prod deploy `2026-08-16T0910Z-aws-ssm`, forced-Queen
 * probe): exploration leaves 19,938 / 19,938 / 19,936 / 13,570 and the synthesis
 * leg 11,696 prompt tokens — 89,610 across 7 completions.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  budgetForQueenNode,
  type QueenNodeRoleName,
} from '../src/config/jrx-prompt-budget.js';
import { buildQueenLeafSystemPrompt } from '../src/orchestration/jrx-queen-leaf-prompt.js';
import { __clearAgentPromptBundleCache } from '../src/services/jrx-agent-prompt-bundle.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REGISTRY = path.join(HERE, '..', 'config', 'agent-registries', 'Jurexio-Legal-registry-IN.json');

interface RegistryAgent {
  id: string;
  name?: string;
  practiceArea?: string;
  systemPrompt?: string;
}

/**
 * Scenarios chosen to span the classification surface: a short statute question
 * (the Phase-3 micro path shape), a genuine drafting instruction, and a research
 * request. Each is run as BOTH an exploration leaf and the synthesis leg, since
 * the whole point of the change is that those two must not be sized alike.
 */
const SCENARIOS: Array<{ label: string; prompt: string }> = [
  {
    label: 'statute question',
    prompt: 'Is anticipatory bail available under BNSS 482 for a BNS 318(4) cheating case in Karnataka?',
  },
  {
    label: 'drafting instruction',
    prompt: 'Draft an anticipatory bail application under BNSS 482 for a BNS 318(4) case before the Sessions Court at Bengaluru.',
  },
  {
    label: 'research request',
    prompt: 'Research the precedent position on anticipatory bail where the offence is economic in nature and the accused has joined investigation.',
  },
];

const ROLES: QueenNodeRoleName[] = ['exploration', 'synthesis'];

interface Row {
  scenario: string;
  role: QueenNodeRoleName;
  agentId: string;
  session: 'turn1' | 'single_shot';
  beforeTokens: number;
  afterTokens: number;
  beforeOverlayTokens: number;
  afterOverlayTokens: number;
  taskClassBefore: string;
  taskClassAfter: string;
  overlayDepthAfter: string;
  leanAfter: boolean;
  capAfter: number;
  overBudget: boolean;
  reductionPct: number;
}

function loadAgents(limit: number): RegistryAgent[] {
  const raw = JSON.parse(fs.readFileSync(REGISTRY, 'utf8')) as { agents?: RegistryAgent[] };
  const all = (raw.agents ?? []).filter((a) => typeof a.systemPrompt === 'string' && a.systemPrompt.length > 0);
  if (all.length === 0) {
    throw new Error(`No agents with a systemPrompt found in ${REGISTRY}`);
  }
  // Deterministic spread across the registry rather than the first N (which are
  // all one practice area and would understate variance).
  const step = Math.max(1, Math.floor(all.length / limit));
  const picked: RegistryAgent[] = [];
  for (let i = 0; i < all.length && picked.length < limit; i += step) picked.push(all[i]!);
  return picked;
}

/**
 * Two session shapes, because they assemble very differently:
 *  - `turn1`       — a session-bearing request on its first turn. The layered
 *                    builder emits the FULL L0 registry constitution (~6.5 k tok),
 *                    which dominates every other term and is what the live 19,938
 *                    measurement is mostly made of.
 *  - `single_shot` — no session id. Already takes the L1 path today, so this is
 *                    where the overlay-tier and lean-L1 levers are fully visible.
 */
type SessionShape = 'turn1' | 'single_shot';

/** `enforced=false` reproduces the pre-fix assembly exactly. */
async function assemble(
  agent: RegistryAgent,
  prompt: string,
  role: QueenNodeRoleName,
  enforced: boolean,
  sessionId: string,
  shape: SessionShape,
) {
  const prior = process.env.JRX_PROMPT_BUDGET;
  if (!enforced) process.env.JRX_PROMPT_BUDGET = '0';
  else delete process.env.JRX_PROMPT_BUDGET;
  try {
    __clearAgentPromptBundleCache();
    const policy = budgetForQueenNode({ role, prompt });
    return await buildQueenLeafSystemPrompt({
      agentId: agent.id,
      registrySystemPrompt: String(agent.systemPrompt || ''),
      promptBlob: prompt,
      jurisdiction: 'IN',
      policy,
      sessionId: shape === 'turn1' ? sessionId : '',
      resolveTurn: async () => ({ mode: 'turn1_full', turnNumber: 1 }),
    });
  } finally {
    if (prior === undefined) delete process.env.JRX_PROMPT_BUDGET;
    else process.env.JRX_PROMPT_BUDGET = prior;
  }
}

function pct(before: number, after: number): number {
  if (before <= 0) return 0;
  return Math.round(((before - after) / before) * 1000) / 10;
}

function pad(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length);
}
function padL(s: string, n: number): string {
  return s.length >= n ? s : ' '.repeat(n - s.length) + s;
}

function mean(xs: number[]): number {
  return xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0;
}

async function main(): Promise<void> {
  const asJson = process.argv.includes('--json');
  const l0Downgrade = ['1', 'true', 'on', 'yes'].includes(
    String(process.env.JRX_QUEEN_LEAF_L0_DOWNGRADE ?? '').trim().toLowerCase(),
  );
  const agents = loadAgents(8);
  const rows: Row[] = [];
  const SHAPES: SessionShape[] = ['turn1', 'single_shot'];

  for (const shape of SHAPES) {
    for (const scenario of SCENARIOS) {
      for (const role of ROLES) {
        for (const agent of agents) {
          // Distinct session per (agent, role, scenario) so the constitution-turn
          // store cannot make a later row look artificially lean.
          const sid = `measure-${agent.id}-${role}-${scenario.label}`.replace(/\s+/g, '-');
          const before = await assemble(agent, scenario.prompt, role, false, sid, shape);
          const after = await assemble(agent, scenario.prompt, role, true, sid, shape);
          rows.push({
            scenario: scenario.label,
            role,
            agentId: agent.id,
            session: shape,
            beforeTokens: before.systemPromptTokens,
            afterTokens: after.systemPromptTokens,
            beforeOverlayTokens: before.overlayTokens,
            afterOverlayTokens: after.overlayTokens,
            taskClassBefore: before.taskClass,
            taskClassAfter: after.taskClass,
            overlayDepthAfter: after.overlayDepth,
            leanAfter: after.leanActiveLayer,
            capAfter: after.budgetTokens,
            overBudget: after.overBudget,
            reductionPct: pct(before.systemPromptTokens, after.systemPromptTokens),
          });
        }
      }
    }
  }

  if (asJson) {
    process.stdout.write(`${JSON.stringify({ l0Downgrade, agents: agents.length, rows }, null, 2)}\n`);
    return;
  }

  const out: string[] = [];
  out.push('');
  out.push('NV-TOKEN-BUDGET-001 — Queen leaf prompt tokens, before vs after');
  out.push(`registry: config/agent-registries/Jurexio-Legal-registry-IN.json (${agents.length} agents sampled)`);
  out.push(`JRX_QUEEN_LEAF_L0_DOWNGRADE=${l0Downgrade ? '1 (L0 withheld from exploration leaves)' : '0 (default — L0 retained)'}`);
  out.push('MEASURED (assembled system prompt, platform estimator). Not provider-billed tokens.');

  for (const shape of SHAPES) {
    out.push('');
    out.push(
      shape === 'turn1'
        ? '── session turn 1 (layered builder emits the FULL L0 constitution) ──'
        : '── single-shot / no session (L1 path — where the tier levers are visible) ──',
    );
    out.push(
      `${pad('scenario', 22)}${pad('role', 13)}${padL('before', 9)}${padL('after', 9)}${padL('cut', 8)}  ${pad('class', 11)}${pad('overlay', 9)}${pad('leanL1', 7)}${padL('cap', 7)}`,
    );
    out.push('-'.repeat(102));
    for (const scenario of SCENARIOS) {
      for (const role of ROLES) {
        const g = rows.filter(
          (r) => r.session === shape && r.scenario === scenario.label && r.role === role,
        );
        const b = mean(g.map((r) => r.beforeTokens));
        const a = mean(g.map((r) => r.afterTokens));
        const first = g[0]!;
        out.push(
          `${pad(scenario.label, 22)}${pad(role, 13)}${padL(String(b), 9)}${padL(String(a), 9)}${padL(`${pct(b, a)}%`, 8)}  ` +
            `${pad(first.taskClassAfter, 11)}${pad(first.overlayDepthAfter, 9)}${pad(first.leanAfter ? 'yes' : 'no', 7)}${padL(String(first.capAfter), 7)}`,
        );
      }
    }
  }

  out.push('');
  out.push('Overlay component (the L2 legal-intelligence tier), mean tokens:');
  out.push(`${pad('role', 13)}${padL('before', 9)}${padL('after', 9)}${padL('cut', 8)}`);
  out.push('-'.repeat(39));
  for (const role of ROLES) {
    const g = rows.filter((r) => r.role === role);
    const b = mean(g.map((r) => r.beforeOverlayTokens));
    const a = mean(g.map((r) => r.afterOverlayTokens));
    out.push(`${pad(role, 13)}${padL(String(b), 9)}${padL(String(a), 9)}${padL(`${pct(b, a)}%`, 8)}`);
  }

  out.push('');
  out.push('Per role × session shape (mean over all agents and scenarios):');
  for (const shape of SHAPES) {
    for (const role of ROLES) {
      const g = rows.filter((r) => r.session === shape && r.role === role);
      const b = mean(g.map((r) => r.beforeTokens));
      const a = mean(g.map((r) => r.afterTokens));
      out.push(`  ${pad(shape, 13)}${pad(role, 13)}before=${padL(String(b), 6)}  after=${padL(String(a), 6)}  cut=${padL(`${pct(b, a)}%`, 6)}`);
    }
  }

  const over = rows.filter((r) => r.overBudget);
  out.push('');
  out.push(
    over.length === 0
      ? '  every assembled prompt fits its declared budget.'
      : `  ${over.length}/${rows.length} rows still exceed their declared cap. Largest single term is the `
        + 'L0 constitution on session turn 1 — set JRX_QUEEN_LEAF_L0_DOWNGRADE=1 to withhold it '
        + 'from exploration leaves, after the §11 eval gate.',
  );
  out.push('');
  process.stdout.write(`${out.join('\n')}\n`);
}

main().catch((err: unknown) => {
  process.stderr.write(`jrx-measure-queen-leaf-prompt failed: ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
