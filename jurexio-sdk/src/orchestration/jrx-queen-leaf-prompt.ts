/**
 * NV-TOKEN-BUDGET-001 (Queen leaf lane) — budgeted assembly of a Queen leaf
 * system prompt.
 *
 * ## The defect this module fixes
 *
 * Measured live on jrx-staging (deploy `2026-08-16T0910Z-aws-ssm`, forced-Queen
 * probe): one request burned **89,610 prompt tokens across 7 completions**
 * (~12.8 k average) — exploration leaves at 19,938 / 19,938 / 19,936 / 13,570
 * and the synthesis leg at 11,696 — while the Phase-3 micro/FAQ path on the same
 * deploy sat at **1,048**. Phase 3's budget tiers were never broken; the Queen
 * simply never consulted them. In `jrx-queen-orchestrator.ts` `callAgentInner()`
 * the leaf prompt was assembled with:
 *
 *   - `buildUniversalLegalIntelligenceOverlay({ …, partnerBestOutcome: true })`
 *     and **no `depth`**, so the overlay defaulted to the `full` tier
 *     (`UNIVERSAL_LEGAL_CORE` ~799 tok + structure-fill + the advice builder)
 *     instead of `COMPACT_LEGAL_CORE` (~200 tok); and
 *   - `assembleLayeredAgentSystemPrompt({ … })` with **no `lean`**, so L1 came
 *     back at the full ~1,202 tok rather than the lean ~574 tok tier that had
 *     already existed since Phase 3; and
 *   - `mode: turn.mode`, which on session turn 1 emits the entire L0 registry
 *     constitution (~6,572 tok) to a throwaway exploration leaf.
 *
 * Every one of those is the *same* class of defect Phase 3 found on the
 * specialist path: the lean tier existed and was never selected by task.
 *
 * ## Why this is a separate module
 *
 * Two reasons. (1) The assembly is now unit-testable without booting the 5.4 k-line
 * orchestrator or the agent graph — which is what lets NV-TOKEN-BUDGET-001 assert
 * the correctness floor *per tier* rather than by inspection. (2) It keeps the
 * orchestrator edit to one contiguous block, since a concurrent lane is editing
 * that file for latency instrumentation.
 *
 * ## Correctness floor (asserted by `tests/unit/ai/jrx-queen-leaf-prompt.test.ts`)
 *
 * Cheaper-but-wrong is not a win, so these survive in EVERY tier:
 * jurisdiction grounding, citation discipline / no-fabrication, the counsel
 * boundary, and **query-matched statute packs** (e.g. the 171-tok BNSS
 * court-applications pack) which are grounding rather than boilerplate — they
 * supply the actual section under discussion.
 *
 * See `documents/working/JRX-ORCHESTRATION-OPTIMIZATION-PLAN-2026-08.md`
 * §8.5 (leaf vs synthesis) and §12.2 (this measurement).
 */

import {
  budgetForQueenNode,
  estimatePromptTokens,
  type PromptTaskClass,
  type QueenNodePromptPolicy,
  type QueenNodeRoleName,
} from '../config/jrx-prompt-budget.js';
import {
  assembleLayeredAgentSystemPrompt,
  parseAgentPromptBundle,
  resolveAgentPromptDepth,
  type PromptAssemblyMode,
} from '../services/jrx-agent-prompt-bundle.js';
import {
  buildUniversalLegalIntelligenceOverlay,
  mergeLegalIntelligencePrompt,
} from '../services/jrx-legal-intelligence-overlay.js';
import { createLogger } from '../utils/logger.js';

/** NV-QUEEN-LEAF-BUDGET-ENFORCE-001 — trim decisions must be observable, not silent. */
const leafBudgetLogger = createLogger('queen-leaf-budget');

/** A registry prompt carries the XML constitution; anything else is internal. */
const XML_CONSTITUTION_RE = /<section_1_identity>|<section_0_security/i;

const KNOWN_CLASSES: ReadonlySet<string> = new Set<PromptTaskClass>([
  'micro_faq',
  'classify',
  'chat',
  'research',
  'drafting',
]);

export interface QueenTurnDecision {
  mode: PromptAssemblyMode;
  turnNumber: number;
}

/**
 * Resolves the session constitution turn. Injected rather than imported so this
 * module stays pure (no session store, no DB) and so the L0-vs-L1 branch is
 * directly testable.
 */
export type QueenTurnResolver = (args: {
  sessionId: string;
  agentId: string;
  jurisdiction: string;
  promptHash: string;
}) => Promise<QueenTurnDecision>;

export interface QueenLeafPromptInput {
  agentId: string;
  /** The jurisdiction-resolved registry prompt (may or may not be XML). */
  registrySystemPrompt: string;
  /** The user/subtask text the leaf will reason over — drives overlay matching. */
  promptBlob: string;
  jurisdiction?: string;
  /** Declared budget policy. NV-TOKEN-BUDGET-001: required, never inferred here. */
  policy: QueenNodePromptPolicy;
  sessionId?: string;
  /** Honour `enableRAG:false` — a retrieval policy section is dead weight then. */
  includeRetrievalPolicy?: boolean;
  resolveTurn?: QueenTurnResolver;
}

export interface QueenLeafPromptResult {
  systemPrompt: string;
  role: QueenNodeRoleName;
  taskClass: PromptTaskClass;
  overlayDepth: 'compact' | 'full';
  /** `turn1_full` | `turn2_plus` | `single_shot` | `legal-intel-merge`. */
  assemblyMode: string;
  leanActiveLayer: boolean;
  /** Estimated tokens of the assembled SYSTEM prompt (not the user message). */
  systemPromptTokens: number;
  overlayTokens: number;
  budgetTokens: number;
  overBudget: boolean;
  /** True when the L0 constitution was withheld from an exploration leaf. */
  l0Downgraded: boolean;
}

/**
 * NV-TOKEN-BUDGET-001 assertion. A dispatch that reaches prompt assembly
 * without a declared task class is the exact defect measured in plan §12.2, so
 * it fails loudly instead of silently defaulting to the widest tier.
 */
export function assertDeclaredTaskClass(
  policy: QueenNodePromptPolicy | undefined,
  site: string,
): asserts policy is QueenNodePromptPolicy {
  if (!policy || !KNOWN_CLASSES.has(String(policy.taskClass))) {
    throw new Error(
      `NV-TOKEN-BUDGET-001: ${site} assembled a Queen prompt without a declared `
        + `task class (got ${policy ? JSON.stringify(policy.taskClass) : 'no policy'}). `
        + 'Call budgetForQueenNode({ role, taskKind, prompt }) first.',
    );
  }
}

/** Convenience wrapper: classify the node and build in one step. */
export async function buildBudgetedQueenLeafPrompt(
  input: Omit<QueenLeafPromptInput, 'policy'> & {
    role: QueenNodeRoleName;
    taskKind?: string | null;
    forceBestOutcome?: boolean;
    requireReasoning?: boolean;
  },
): Promise<QueenLeafPromptResult> {
  const policy = budgetForQueenNode({
    role: input.role,
    taskKind: input.taskKind,
    prompt: input.promptBlob,
    forceBestOutcome: input.forceBestOutcome,
    requireReasoning: input.requireReasoning,
  });
  return buildQueenLeafSystemPrompt({ ...input, policy });
}

export async function buildQueenLeafSystemPrompt(
  input: QueenLeafPromptInput,
): Promise<QueenLeafPromptResult> {
  assertDeclaredTaskClass(input.policy, 'buildQueenLeafSystemPrompt');
  const policy = input.policy;
  const jurisdiction = String(input.jurisdiction || 'IN');
  const registry = String(input.registrySystemPrompt || '');

  /* `partnerBestOutcome` is deliberately left at `true`, matching both the prior
   * Queen behaviour and `jrx-client.ts`. It only gates the drafting builder's
   * best-outcome framing — a QUALITY lever, not a token lever — and this lane is
   * prompt size. Changing it would be an unmeasured behavioural edit. */
  const overlay = buildUniversalLegalIntelligenceOverlay({
    prompt: input.promptBlob,
    jurisdiction,
    partnerBestOutcome: true,
    depth: policy.overlayDepth,
  });

  const isXmlRegistry = XML_CONSTITUTION_RE.test(registry);
  let systemPrompt: string;
  let assemblyMode: string;
  let l0Downgraded = false;

  if (isXmlRegistry) {
    const bundle = parseAgentPromptBundle(registry, input.agentId);
    let mode: PromptAssemblyMode = 'single_shot';
    let turnNumber = 1;

    /* An exploration leaf never *claims* a session constitution turn when the
     * L0 downgrade is on. Skipping the turn (rather than claiming it and then
     * sending L1) is what keeps the session store honest: if we recorded turn 1
     * while withholding L0, every later turn would assume a constitution that
     * was never sent. Leaves are throwaway, so not participating is correct. */
    const sessionId = String(input.sessionId || '').trim();
    if (sessionId && policy.allowFullConstitution && input.resolveTurn) {
      const turn = await input.resolveTurn({
        sessionId,
        agentId: input.agentId,
        jurisdiction,
        promptHash: bundle.hash,
      });
      mode = turn.mode;
      turnNumber = turn.turnNumber;
    } else if (sessionId && !policy.allowFullConstitution) {
      l0Downgraded = true;
    }

    const assembled = assembleLayeredAgentSystemPrompt({
      fullRegistryPrompt: registry,
      agentId: input.agentId,
      mode,
      turnNumber,
      taskOverlay: overlay || undefined,
      lean: policy.leanActiveLayer,
      includeRetrievalPolicy: input.includeRetrievalPolicy,
      // NV-AGENT-PROMPT-DEPTH-001 — Queen leaves do the substantive legal work,
      // so they are exactly where §4 reasoning / §5 evidence / §18 checklist earn
      // their tokens. Derived from the leaf's own declared budget.
      depth: resolveAgentPromptDepth({
        maxPromptTokens: policy.budget.maxPromptTokens,
        taskClass: String(policy.taskClass),
        lean: policy.leanActiveLayer,
      }),
    });
    systemPrompt = assembled.systemPrompt;
    assemblyMode = assembled.mode;
  } else {
    /* Platform-internal / non-XML agents. Cap the base at the task's share of
     * the budget instead of the fixed 12 k chars, which alone exceeded the whole
     * ceiling — the same correction `jrx-client.ts` applies. */
    systemPrompt = mergeLegalIntelligencePrompt(
      registry,
      overlay,
      policy.enforced ? Math.max(1_200, policy.budget.maxPromptTokens * 2) : undefined,
    );
    assemblyMode = 'legal-intel-merge';
  }

  let systemPromptTokens = estimatePromptTokens(systemPrompt);
  const overBudget = policy.enforced && systemPromptTokens > policy.budget.maxPromptTokens;

  /*
   * NV-QUEEN-LEAF-BUDGET-ENFORCE-001 (2026-08-18) — enforce the ceiling on EXPLORATION
   * leaves. It was previously computed, logged as `overBudget`, and then ignored.
   *
   * Measured on a live drafting request: **8 of 9 hops logged `overBudget: true`**, with
   * `jrx-client` reporting `cap=8000 assembled=11069` and a `chat`-class leaf capped at
   * 2,500 sending 2,990. The cost benchmark independently measured 82,565 prompt tokens for
   * a 5-call drafting request against a ~18,000 ceiling implied by the per-hop budgets —
   * 4.6x over. That gap is why JRX costs ~4x a direct call (drafting -224%,
   * single-issue-advice -318%) while the harness finds no quality advantage.
   *
   * Deliberately narrow: only exploration leaves. Their notes feed the synthesis leg, so a
   * shorter brief costs breadth of *scratch* reasoning, not the user-visible answer. The
   * synthesis leaf is left untouched and still only logs `overBudget`.
   *
   * WHY THIS IS NOT A NAIVE TRUNCATION — a lesson from the first attempt.
   * My first version sliced the tail on the assumption that the prompt is ordered
   * least-load-bearing-last. `jrx-queen-leaf-prompt.test.ts` immediately failed: a 9,573 →
   * 2,386 token cut removed the **jurisdiction grounding (BNS/BNSS/BSA)** that prevents
   * IPC-instead-of-BNS answers, i.e. it traded the platform's single most important legal
   * correctness guarantee for tokens. The correctness floor is asserted across every tier
   * by that suite and it was right to stop me.
   *
   * So enforcement now REFUSES to trim whenever the result would drop a correctness-critical
   * marker. If the assembled prompt cannot be shortened safely we keep it whole and log
   * `overBudget` — an honest overrun beats a cheap wrong answer. The real fix for those
   * prompts is upstream (a leaner assembled layer), not a blind cut here.
   */
  if (
    overBudget
    && policy.role === 'exploration'
    && !['0', 'false', 'off', 'no'].includes(
      String(process.env.JRX_QUEEN_LEAF_BUDGET_ENFORCE ?? '').trim().toLowerCase(),
    )
  ) {
    const capTokens = policy.budget.maxPromptTokens;
    /* ~4 chars/token is the estimator's own basis; 5% margin so the re-estimate lands
     * under the cap rather than exactly on it. */
    const capChars = Math.max(600, Math.floor(capTokens * 4 * 0.95));
    if (systemPrompt.length > capChars) {
      const candidate = `${systemPrompt.slice(0, capChars).trimEnd()}\n\n[exploration brief truncated to budget]`;
      /* The floor the existing suite enforces: jurisdiction grounding and the
       * anti-fabrication rule must survive every tier. A trim that loses either is not a
       * saving, it is a defect. */
      const keepsFloor = /BNS|BNSS|BSA|India/i.test(candidate)
        && /fabricat|invent|hallucinat|do not (?:make up|invent)/i.test(candidate);
      if (keepsFloor) {
        const before = systemPromptTokens;
        systemPrompt = candidate;
        systemPromptTokens = estimatePromptTokens(systemPrompt);
        leafBudgetLogger.info('queen exploration leaf trimmed to budget', {
          role: policy.role,
          taskClass: policy.taskClass,
          beforeTokens: before,
          afterTokens: systemPromptTokens,
          capTokens,
        });
      } else {
        leafBudgetLogger.info('queen exploration leaf left over budget — trim would drop the correctness floor', {
          role: policy.role,
          taskClass: policy.taskClass,
          tokens: systemPromptTokens,
          capTokens,
        });
      }
    }
  }

  return {
    systemPrompt,
    role: policy.role,
    taskClass: policy.taskClass,
    overlayDepth: policy.overlayDepth,
    assemblyMode,
    leanActiveLayer: policy.leanActiveLayer,
    systemPromptTokens,
    overlayTokens: estimatePromptTokens(overlay),
    budgetTokens: policy.budget.maxPromptTokens,
    overBudget: policy.enforced && systemPromptTokens > policy.budget.maxPromptTokens,
    l0Downgraded,
  };
}
