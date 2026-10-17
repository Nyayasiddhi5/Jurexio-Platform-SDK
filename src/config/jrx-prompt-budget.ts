/**
 * NV-TOKEN-BUDGET-001 — task-class prompt budget policy (single source of truth).
 *
 * Why this exists (measured, 2026-08-16): a 19-token user question reached the
 * provider as 5,059–5,431 prompt tokens. The assembled prompt only ever grew —
 * every layer appended (registry L1 1,202 tok, universal legal overlay 2,300 tok,
 * a jurisdiction restatement 134 tok, an enhancement context block 63 tok) and
 * nothing declared or enforced a ceiling. Budget-first assembly needs one place
 * that answers: "for THIS task, how many prompt tokens may we spend, and how
 * much of the fixed preamble is justified?"
 *
 * Relationship to `src/utils/jrx-token-budget.ts` (NV-NO-DUPLICATE-001): that
 * module enforces *commercial* per-subscription-tier input ceilings (SOLO 8K …
 * INSTITUTIONAL 500K) and answers "is this customer allowed to send this much?".
 * This module answers a different question — "how much does this TASK deserve?"
 * — and is always the tighter of the two. They compose; neither replaces the
 * other. Token estimation is deliberately delegated to the existing helper so
 * there is exactly one estimator in the codebase.
 */

import { JrxTokenBudgetManager } from '../utils/jrx-token-budget.js';

/**
 * Prompt task classes, ordered by the amount of fixed scaffolding they justify.
 * Ceilings come from JRX-ORCHESTRATION-OPTIMIZATION-PLAN-2026-08 §7.
 */
export type PromptTaskClass =
  | 'micro_faq'
  | 'classify'
  | 'chat'
  | 'research'
  | 'drafting';

/** How much of the legal-intelligence overlay a task class justifies. */
export type OverlayDepth = 'compact' | 'full';

export interface PromptBudget {
  taskClass: PromptTaskClass;
  /** Hard ceiling on assembled prompt tokens (system + context + user). */
  maxPromptTokens: number;
  /** Share of the ceiling that retrieval/memory context blocks may occupy. */
  maxContextTokens: number;
  /** Overlay tier — `compact` drops untargeted boilerplate, never grounding. */
  overlayDepth: OverlayDepth;
  /**
   * Task-scaled output ceiling. Enforcement is opt-in (see
   * `isOutputBudgetEnforced`) because shortening answers is a *behavioural*
   * change that has to clear the 40-prompt legal eval gate (plan §11), unlike
   * the redundancy removals which are provably lossless.
   */
  maxOutputTokens: number;
}

function envInt(name: string, fallback: number, min: number, max: number): number {
  const n = Number(process.env[name]);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

const BUDGETS: Record<PromptTaskClass, PromptBudget> = {
  micro_faq: {
    taskClass: 'micro_faq',
    maxPromptTokens: envInt('JRX_PROMPT_BUDGET_MICRO_FAQ', 600, 200, 8_000),
    maxContextTokens: envInt('JRX_PROMPT_CTX_MICRO_FAQ', 250, 0, 4_000),
    overlayDepth: 'compact',
    maxOutputTokens: envInt('JRX_OUTPUT_BUDGET_MICRO_FAQ', 700, 128, 8_192),
  },
  classify: {
    taskClass: 'classify',
    maxPromptTokens: envInt('JRX_PROMPT_BUDGET_CLASSIFY', 1_200, 300, 16_000),
    maxContextTokens: envInt('JRX_PROMPT_CTX_CLASSIFY', 500, 0, 8_000),
    overlayDepth: 'compact',
    maxOutputTokens: envInt('JRX_OUTPUT_BUDGET_CLASSIFY', 800, 128, 8_192),
  },
  chat: {
    taskClass: 'chat',
    maxPromptTokens: envInt('JRX_PROMPT_BUDGET_CHAT', 2_500, 600, 32_000),
    maxContextTokens: envInt('JRX_PROMPT_CTX_CHAT', 1_000, 0, 16_000),
    overlayDepth: 'compact',
    maxOutputTokens: envInt('JRX_OUTPUT_BUDGET_CHAT', 2_048, 256, 16_384),
  },
  research: {
    taskClass: 'research',
    maxPromptTokens: envInt('JRX_PROMPT_BUDGET_RESEARCH', 8_000, 2_000, 64_000),
    maxContextTokens: envInt('JRX_PROMPT_CTX_RESEARCH', 4_500, 0, 48_000),
    overlayDepth: 'full',
    maxOutputTokens: envInt('JRX_OUTPUT_BUDGET_RESEARCH', 4_096, 512, 32_768),
  },
  drafting: {
    taskClass: 'drafting',
    maxPromptTokens: envInt('JRX_PROMPT_BUDGET_DRAFTING', 24_000, 4_000, 200_000),
    maxContextTokens: envInt('JRX_PROMPT_CTX_DRAFTING', 14_000, 0, 150_000),
    overlayDepth: 'full',
    maxOutputTokens: envInt('JRX_OUTPUT_BUDGET_DRAFTING', 8_192, 1_024, 65_536),
  },
};

/** Router `taskKind` → prompt task class. Keys match `router-types.TaskKind`. */
const TASK_KIND_CLASS: Record<string, PromptTaskClass> = {
  legal_drafting: 'drafting',
  litigation_strategy: 'drafting',
  legal_research: 'research',
  contract_analysis: 'research',
  compliance_review: 'research',
  chain_of_thought: 'research',
  summarization: 'classify',
  classification: 'classify',
  extraction: 'classify',
  json_structured: 'classify',
  vision: 'chat',
  generic_chat: 'chat',
  // Legacy / non-router aliases seen on the live specialist path.
  general: 'chat',
  analysis: 'research',
  research: 'research',
  opinion: 'research',
  advisory: 'research',
  precedent: 'research',
  litigation: 'drafting',
  draft: 'drafting',
  'document-drafting': 'drafting',
  // Partner `/orchestrate` taskType strings (NV-PARTNER-TASKTYPE-BUDGET-001).
  'legal-draft-fast': 'drafting',
  'legal-draft': 'drafting',
  'legal_draft_fast': 'drafting',
  'doc-draft-fast': 'drafting',
  'document-draft': 'drafting',
  'legal-chat-fast': 'chat',
  'legal-chat': 'chat',
  analyzedocument: 'research',
  contract: 'research',
  classify: 'classify',
  extract: 'classify',
  summarize: 'classify',
  ocr: 'classify',
};

/**
 * A micro-FAQ is a short, single-issue question that a statute lookup answers.
 * Deliberately narrow: mis-classifying a research request as micro_faq would
 * starve it of context, so anything with drafting/research vocabulary, or any
 * prompt longer than the threshold, falls through to `chat` or better.
 */
const MICRO_FAQ_MAX_CHARS = envInt('JRX_PROMPT_MICRO_FAQ_MAX_CHARS', 240, 40, 2_000);
const NON_TRIVIAL_RE =
  /\b(draft|plead|petition|plaint|affidavit|notice|bail\s+application|opinion|memorand|strategy|research|precedent|compare|analys|review|clause|due\s+diligence|advise|advice|leading|landmark|authorities|anticipatory|template|checklist|format|procedure|amendment|notification)\b/i;

/** NV-FAST-CHAT-SLA-001 — explicit `-fast` aliases are latency contracts. */
const EXPLICIT_FAST_TASK_RE =
  /^(legal[_-]?chat|legal[_-]?draft|doc[_-]?draft|document[_-]?draft)[_-]fast$/i;

export interface ClassifyPromptTaskInput {
  taskKind?: string | null;
  prompt?: string | null;
  /** Partner "best legal outcome" — never downgrade below research. */
  forceBestOutcome?: boolean;
  /** Caller explicitly asked for chain-of-thought / deep reasoning. */
  requireReasoning?: boolean;
}

export function classifyPromptTask(input: ClassifyPromptTaskInput): PromptTaskClass {
  const declared = String(input.taskKind || '').trim().toLowerCase();
  const mapped = declared ? TASK_KIND_CLASS[declared] : undefined;

  // NV-FAST-CHAT-SLA-001 — `-fast` is a partner latency contract; best-outcome
  // must not inflate chat-fast to research (full overlay + non-lean L1).
  if (EXPLICIT_FAST_TASK_RE.test(declared)) {
    return mapped ?? 'chat';
  }

  // A declared drafting/research intent is authoritative — never shrink it.
  if (mapped === 'drafting' || mapped === 'research') return mapped;
  // An explicit deep-work request must never be downgraded to a lean tier just
  // because the prompt is short ("compare these two clauses" is 6 words).
  if (input.forceBestOutcome || input.requireReasoning) return 'research';
  if (mapped === 'classify') return 'classify';

  const prompt = String(input.prompt || '');
  if (NON_TRIVIAL_RE.test(prompt)) return 'research';
  if (prompt.length > 0 && prompt.length <= MICRO_FAQ_MAX_CHARS) return 'micro_faq';
  return mapped ?? 'chat';
}

export function getPromptBudget(taskClass: PromptTaskClass): PromptBudget {
  return BUDGETS[taskClass];
}

/* ── Queen node roles (NV-TOKEN-BUDGET-001 × NV-QUEEN-LEAF-TIER-001) ────────
 *
 * Measured on jrx-staging (deploy `2026-08-16T0910Z-aws-ssm`, forced-Queen probe):
 * the micro/FAQ path had come down to 1,048 prompt tokens, but Queen leaves
 * were still assembling 13,570–19,938 — 89,610 prompt tokens across 7
 * completions. Cause: `callAgentInner()` built the legal overlay and the
 * layered agent prompt without declaring a task class, so the overlay defaulted
 * to `full` and L1 to non-lean. Nothing was wrong with the budget module; the
 * Queen simply never asked it.
 *
 * The role split mirrors NV-QUEEN-LEAF-TIER-001 (plan §8.5), which already
 * splits leaf vs synthesis for MODEL and output tokens. Reusing that seam rather
 * than inventing a second classifier is deliberate (NV-NO-DUPLICATE-001): one
 * `classifyQueenNodeRole()` decision drives model, output ceiling AND prompt
 * budget, so the three can never disagree about what a node is.
 */

/**
 * Structurally identical to `QueenNodeRole` in
 * `src/orchestration/jrx-queen-node-role.ts`, restated here so `src/config/`
 * never imports from `src/orchestration/` (layering inversion). The two unions
 * are assignment-compatible; the orchestration module remains the definer.
 */
export type QueenNodeRoleName = 'exploration' | 'synthesis';

/** Leanest → widest. Used to clamp, never to inflate. */
const CLASS_RANK: Record<PromptTaskClass, number> = {
  micro_faq: 0,
  classify: 1,
  chat: 2,
  research: 3,
  drafting: 4,
};

const CLASS_BY_RANK: PromptTaskClass[] = ['micro_faq', 'classify', 'chat', 'research', 'drafting'];

/**
 * Widest class an *exploration* leaf may use.
 *
 * `chat` (2,500 tok / compact overlay / lean L1) is the default. Ops may widen
 * to `research` via `JRX_QUEEN_EXPLORATION_PROMPT_CLASS`; values leaner than
 * `chat` are refused, because an exploration leaf reasons over retrieved
 * authorities and starving it below the chat tier is not supported by any
 * measurement we have.
 */
function resolveExplorationCeiling(
  raw: string | undefined = process.env.JRX_QUEEN_EXPLORATION_PROMPT_CLASS,
): PromptTaskClass {
  const want = String(raw || '').trim().toLowerCase();
  if (!want || !(want in CLASS_RANK)) return 'chat';
  const candidate = want as PromptTaskClass;
  // Never allow a misconfiguration to starve a leaf below the chat tier.
  return CLASS_RANK[candidate] < CLASS_RANK.chat ? 'chat' : candidate;
}

/**
 * Floor for an exploration leaf.
 *
 * Found by the NV-TOKEN-BUDGET-001 suite while writing it: a Queen subtask
 * prompt is usually SHORT (a decomposed instruction like "identify the
 * governing BNSS provision"), so `classifyPromptTask()` naturally returns
 * `micro_faq` — a 600-token ceiling with a 250-token context share. Clamping to
 * the ceiling alone would therefore have starved leaves rather than made them
 * lean, which is the opposite of the correctness floor ("ambiguity resolves
 * toward MORE context"). A leaf reasons over retrieved authorities even when its
 * instruction is one line, so `chat` is the floor.
 */
const EXPLORATION_FLOOR: PromptTaskClass = 'chat';

export interface QueenNodeBudgetInput extends ClassifyPromptTaskInput {
  role: QueenNodeRoleName;
}

export interface QueenNodePromptPolicy {
  role: QueenNodeRoleName;
  /** The declared task class. NV-TOKEN-BUDGET-001: never absent. */
  taskClass: PromptTaskClass;
  budget: PromptBudget;
  /** Legal-intelligence overlay tier to request. */
  overlayDepth: OverlayDepth;
  /** Whether to ask `buildActiveAgentLayer()` for the lean L1. */
  leanActiveLayer: boolean;
  /**
   * Whether this node may load the FULL L0 registry constitution (~6,572 tok)
   * on session turn 1. Exploration leaves may not when
   * `JRX_QUEEN_LEAF_L0_DOWNGRADE` is on — see `isQueenLeafL0DowngradeEnabled`.
   */
  allowFullConstitution: boolean;
  /** `false` ⇒ pre-Phase-3 append-everything behaviour (A/B escape hatch). */
  enforced: boolean;
  /** Human-readable justification for logs and the measurement harness. */
  reason: string;
}

/**
 * Resolve the prompt task class for a Queen node.
 *
 * Synthesis keeps the naturally-classified class *and a `research` floor*: it
 * authors the user-visible answer over merged multi-agent evidence, which is
 * the one place a generous context is justified (plan §8.5). Exploration is
 * clamped to the lean ceiling because its notes are consumed by that synthesis
 * leg and never shown to the user.
 *
 * Note the asymmetry is intentional: an *unclassified* node resolves to
 * `synthesis` upstream in `classifyQueenNodeRole()`, so this function can only
 * ever shrink nodes we positively recognise as intermediate.
 */
export function resolveQueenNodePromptClass(input: QueenNodeBudgetInput): PromptTaskClass {
  const natural = classifyPromptTask(input);
  if (input.role === 'synthesis') {
    // Floor at `research`: the synthesis leg merges N agents' evidence, so even
    // a short user question produces a wide assembled prompt legitimately.
    return CLASS_RANK[natural] < CLASS_RANK.research ? 'research' : natural;
  }
  // Exploration: clamp into [chat, ceiling] — capped so a research/drafting leaf
  // goes lean, floored so a one-line subtask instruction is not starved.
  const ceiling = resolveExplorationCeiling();
  const rank = Math.min(
    CLASS_RANK[ceiling],
    Math.max(CLASS_RANK[EXPLORATION_FLOOR], CLASS_RANK[natural]),
  );
  return CLASS_BY_RANK[rank]!;
}

/**
 * L0→L1 downgrade for exploration leaves is opt-in.
 *
 * Dropping the full L0 constitution on session turn 1 is the single largest
 * remaining term (~6,572 tok/leaf), and it is a *behavioural* change to what
 * the swarm reasons over — so it must clear the 40-prompt legal eval gate
 * (plan §11) before it can default on, unlike the overlay/L1 tiering which
 * Phase 3 already shipped on by default. Enable with
 * `JRX_QUEEN_LEAF_L0_DOWNGRADE=1`.
 */
export function isQueenLeafL0DowngradeEnabled(): boolean {
  return ['1', 'true', 'on', 'yes'].includes(
    String(process.env.JRX_QUEEN_LEAF_L0_DOWNGRADE ?? '').trim().toLowerCase(),
  );
}

/**
 * The single entry point Queen leaf dispatch must use. Always returns a
 * declared `taskClass` — that is what NV-TOKEN-BUDGET-001 asserts in CI.
 */
export function budgetForQueenNode(input: QueenNodeBudgetInput): QueenNodePromptPolicy {
  const enforced = isPromptBudgetEnforced();
  const taskClass = resolveQueenNodePromptClass(input);
  const budget = BUDGETS[taskClass];
  const isExploration = input.role === 'exploration';

  if (!enforced) {
    return {
      role: input.role,
      taskClass,
      budget,
      overlayDepth: 'full',
      leanActiveLayer: false,
      allowFullConstitution: true,
      enforced: false,
      reason: 'JRX_PROMPT_BUDGET=0 — pre-Phase-3 append-everything behaviour',
    };
  }

  return {
    role: input.role,
    taskClass,
    budget,
    overlayDepth: budget.overlayDepth,
    leanActiveLayer:
      taskClass === 'micro_faq' || taskClass === 'classify' || taskClass === 'chat',
    allowFullConstitution: !(isExploration && isQueenLeafL0DowngradeEnabled()),
    enforced: true,
    reason: isExploration
      ? `exploration leaf clamped to '${taskClass}' (ceiling ${resolveExplorationCeiling()}); notes are consumed by the synthesis leg`
      : `synthesis leg keeps '${taskClass}' — authors the user-visible answer`,
  };
}

export function budgetForRequest(input: ClassifyPromptTaskInput): PromptBudget {
  return BUDGETS[classifyPromptTask(input)];
}

/** Delegated so the platform has exactly one token estimator. */
export function estimatePromptTokens(text: string): number {
  return JrxTokenBudgetManager.estimateTokens(text);
}

/**
 * Redundancy removal (duplicate blocks, jurisdiction restatement, overlay
 * tiering) is on by default: every cut is a provable duplicate or explicitly
 * untargeted boilerplate. `JRX_PROMPT_BUDGET=0` restores the pre-Phase-3
 * append-everything behaviour for A/B comparison against a legal eval run.
 */
export function isPromptBudgetEnforced(): boolean {
  return !['0', 'false', 'off', 'no'].includes(
    String(process.env.JRX_PROMPT_BUDGET ?? '').trim().toLowerCase(),
  );
}

/**
 * Output clamping is opt-in. It shortens answers, which the plan's §11 quality
 * gate requires an eval run to approve — so it must not switch on silently with
 * the lossless prompt fixes.
 */
export function isOutputBudgetEnforced(): boolean {
  return ['1', 'true', 'on', 'yes'].includes(
    String(process.env.JRX_PROMPT_BUDGET_OUTPUT ?? '').trim().toLowerCase(),
  );
}

/** Ops/health snapshot — no secrets. */
export function getPromptBudgetSnapshot(): Record<string, unknown> {
  return {
    enforced: isPromptBudgetEnforced(),
    outputEnforced: isOutputBudgetEnforced(),
    microFaqMaxChars: MICRO_FAQ_MAX_CHARS,
    budgets: BUDGETS,
    // NV-TOKEN-BUDGET-001 (Queen leaf lane) — so ops can see, without reading
    // code, which tier the highest-fan-out path is actually running on.
    queenLeaf: {
      explorationFloor: EXPLORATION_FLOOR,
      explorationCeiling: resolveExplorationCeiling(),
      l0DowngradeEnabled: isQueenLeafL0DowngradeEnabled(),
    },
  };
}
