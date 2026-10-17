/**
 * NV-MODEL-ID-VALIDATE-001 — startup validation that every cascade id resolves.
 *
 * Measured defect (plan §9): `defaultSequenceFor` builds a ladder by mapping ids
 * through `getModel(id)` and silently DROPPING anything that returns undefined:
 *
 *   for (const id of ids) { const m = getModel(id); if (m) seq.push(m); }
 *
 * A typo, a renamed provider id, or a model retired upstream therefore shortens
 * the cascade with no signal at all — the rung simply ceases to exist. That is
 * the worst failure mode for a never-fail SLA: the safety margin evaporates
 * quietly and only surfaces as "we terminate at AgentZero more often this week".
 *
 * A second, related hazard: catalog entries whose own `notes` say "blocked" /
 * "no longer available" / "404" remain fully scorable, so the router can rank a
 * rung we already know is dead above a working one.
 *
 * What this checks:
 *  1. Curated Bedrock lead ids (`bedrockLeadIdsForTier`) — RAW, before the drop —
 *     for every tier × task class. These are hand-maintained in routing policy
 *     and are by far the most drift-prone ids in the system.
 *  2. Every tier × agentClass × taskKind ladder (plus vision/reasoning variants
 *     and the ultimate fallback) resolves to a non-empty sequence that still
 *     terminates in AgentZero — the invariant that makes the cascade unfailable.
 *  3. Catalog entries self-described as blocked yet still scorable.
 *
 * Deliberately NOT checked: whether a curated lead ends up present in a given
 * ladder. `default-sequences.ts` applies `withBedrockLead` to exactly one ladder;
 * the rest are merged by `applyRoutingPolicy` at request time and are legitimately
 * filtered by `maxCostUsd` (NV-POLICY-BUDGET-001) or a missing provider key. A
 * check there would be pure false-positive noise.
 *
 * It is advisory by default — refusing to boot because one of ~200 catalog ids
 * drifted would be a worse outage than a shortened cascade — but
 * `NYV_VALIDATE_CASCADE_STRICT=1` makes it fatal so CI catches the drift.
 */

import { createLogger } from '../../utils/logger.js';
import { getModel, MODEL_CATALOG } from './model-catalog.js';
import { defaultSequenceFor, ultimateFallbackSequence } from './default-sequences.js';
import { bedrockLeadIdsForTier } from '../../config/jrx-llm-routing-policy.js';
import type { AgentClass, ModelEntry, TaskKind, TierLevel } from './router-types.js';

const logger = createLogger('./jrx-cascade-validator');

const TIERS: TierLevel[] = ['free', 'solo', 'plus', 'pro', 'enterprise', 'superadmin'];
const AGENT_CLASSES: AgentClass[] = [
  'executive',
  'senior',
  'specialist',
  'standard',
  'support',
  'utility',
];
const TASK_KINDS: TaskKind[] = [
  'legal_drafting',
  'legal_research',
  'litigation_strategy',
  'contract_analysis',
  'compliance_review',
  'chain_of_thought',
  'summarization',
  'classification',
  'extraction',
  'json_structured',
  'vision',
  'generic_chat',
];
const JURISDICTIONS = ['IN', 'GC'];

export type CascadeIssueKind =
  | 'unresolvable_id'
  | 'blocked_note'
  | 'empty_sequence'
  | 'no_terminal_fallback';

export interface CascadeValidationIssue {
  kind: CascadeIssueKind;
  detail: string;
  /** Where the issue was observed, e.g. `pro/senior/legal_research/IN`. */
  context?: string;
}

export interface CascadeValidationReport {
  ok: boolean;
  laddersChecked: number;
  idsChecked: number;
  issues: CascadeValidationIssue[];
}

/** Catalog entries whose own notes admit the model is unusable on this account. */
const BLOCKED_NOTE_RE =
  /\bblocked\b|not available|no longer available|\b404\b|dead on this account|requires (?:allow-?list|approval)/i;

/** AgentZero is free and sovereign; it is the rung that makes the cascade unfailable. */
function hasTerminalFallback(seq: ModelEntry[]): boolean {
  return seq.some((m) => m.provider === 'agentzero' || m.id === 'agentzero');
}

export function validateCascadeModelIds(): CascadeValidationReport {
  const issues: CascadeValidationIssue[] = [];
  const checkedIds = new Set<string>();
  let laddersChecked = 0;

  // (1) Raw curated lead ids — checked BEFORE any resolution, which is the only
  // place we can see an id that would otherwise vanish silently.
  for (const tier of TIERS) {
    for (const taskKind of TASK_KINDS) {
      for (const id of bedrockLeadIdsForTier(tier, taskKind)) {
        checkedIds.add(id);
        if (!getModel(id)) {
          issues.push({
            kind: 'unresolvable_id',
            detail: id,
            context: `bedrockLeadIdsForTier(${tier}, ${taskKind})`,
          });
        }
      }
    }
  }

  // (2) Every ladder a live request can select.
  for (const tier of TIERS) {
    for (const agentClass of AGENT_CLASSES) {
      for (const taskKind of TASK_KINDS) {
        for (const jurisdiction of JURISDICTIONS) {
          const variants: Array<{
            label: string;
            opts: { jurisdiction?: string; requireVision?: boolean; requireReasoning?: boolean };
          }> = [
            { label: '', opts: { jurisdiction } },
            { label: '/vision', opts: { jurisdiction, requireVision: true } },
            { label: '/reasoning', opts: { jurisdiction, requireReasoning: true } },
          ];
          for (const variant of variants) {
            laddersChecked += 1;
            const context = `${tier}/${agentClass}/${taskKind}/${jurisdiction}${variant.label}`;
            const resolved = defaultSequenceFor(tier, agentClass, taskKind, variant.opts);
            for (const m of resolved) checkedIds.add(m.id);

            if (resolved.length === 0) {
              issues.push({ kind: 'empty_sequence', detail: 'ladder resolved to zero rungs', context });
              continue;
            }
            if (!hasTerminalFallback(resolved)) {
              issues.push({
                kind: 'no_terminal_fallback',
                detail: 'ladder has no AgentZero terminal rung',
                context,
              });
            }
          }
        }
      }
    }
  }

  laddersChecked += 1;
  const ultimate = ultimateFallbackSequence();
  for (const m of ultimate) checkedIds.add(m.id);
  if (ultimate.length === 0) {
    issues.push({
      kind: 'empty_sequence',
      detail: 'ultimateFallbackSequence resolved to zero rungs',
      context: 'ultimateFallbackSequence',
    });
  } else if (!hasTerminalFallback(ultimate)) {
    issues.push({
      kind: 'no_terminal_fallback',
      detail: 'ultimate fallback has no AgentZero terminal rung',
      context: 'ultimateFallbackSequence',
    });
  }

  // (3) Self-described dead catalog entries that are still scorable.
  for (const entry of MODEL_CATALOG) {
    const notes = String((entry as ModelEntry & { notes?: string }).notes ?? '');
    if (notes && BLOCKED_NOTE_RE.test(notes)) {
      issues.push({ kind: 'blocked_note', detail: `${entry.id}: ${notes.slice(0, 140)}` });
    }
  }

  // `blocked_note` is advisory — a self-described-dead entry is a scoring wart,
  // not a broken ladder — so only unresolvable ids and structural breakage gate
  // the boot check.
  const fatalKinds: CascadeIssueKind[] = ['unresolvable_id', 'empty_sequence', 'no_terminal_fallback'];
  return {
    ok: !issues.some((i) => fatalKinds.includes(i.kind)),
    laddersChecked,
    idsChecked: checkedIds.size,
    issues,
  };
}

function isStrict(): boolean {
  return ['1', 'true', 'on', 'yes'].includes(
    String(process.env.NYV_VALIDATE_CASCADE_STRICT ?? '').trim().toLowerCase(),
  );
}

function uniqueDetails(issues: CascadeValidationIssue[], kind: CascadeIssueKind): string[] {
  return [...new Set(issues.filter((i) => i.kind === kind).map((i) => i.detail))];
}

/**
 * Run once at startup. Logs a single summary line plus one line per distinct
 * issue. Throws only under `NYV_VALIDATE_CASCADE_STRICT=1`.
 */
export function assertCascadeModelIdsAtStartup(): CascadeValidationReport {
  const report = validateCascadeModelIds();

  const unresolvable = uniqueDetails(report.issues, 'unresolvable_id');
  const blocked = uniqueDetails(report.issues, 'blocked_note');
  const structural = report.issues.filter(
    (i) => i.kind === 'empty_sequence' || i.kind === 'no_terminal_fallback',
  );

  logger.info('cascade model-id validation complete', {
    laddersChecked: report.laddersChecked,
    idsChecked: report.idsChecked,
    unresolvable: unresolvable.length,
    blockedNotes: blocked.length,
    structural: structural.length,
    strict: isStrict(),
  });

  for (const id of unresolvable) {
    logger.error('cascade id does not resolve — rung is silently dropped from the ladder', { id });
  }
  for (const issue of structural) {
    logger.error(`cascade structural defect: ${issue.kind}`, {
      context: issue.context,
      detail: issue.detail,
    });
  }
  for (const detail of blocked) {
    logger.warn('catalog entry is self-described as blocked yet remains scorable', { detail });
  }

  if (!report.ok && isStrict()) {
    throw new Error(
      `NV-MODEL-ID-VALIDATE-001: ${unresolvable.length} unresolvable cascade id(s), ` +
        `${structural.length} structural issue(s). First offenders: ` +
        [...unresolvable, ...structural.map((s) => `${s.kind}@${s.context}`)].slice(0, 10).join(', '),
    );
  }
  return report;
}
