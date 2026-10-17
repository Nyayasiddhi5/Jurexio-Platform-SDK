/**
 * NV-QUEEN-EARNED-001 — evidence-based admission to the multi-agent Queen path.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * A live forced-Queen probe on jrx-staging measured one request at **366 s wall,
 * 7 billed completions, 89,610 prompt tokens**. The cheapest Queen request is
 * the one that never runs, so gating *entry* is worth more than optimising the
 * swarm's internals (JRX-ORCHESTRATION-OPTIMIZATION-PLAN-2026-08 §10.2 rule 2,
 * §12.1, §12.2).
 *
 * Before this module, three predicates admitted a request to the swarm and none
 * of them looked at the request's structure:
 *
 *   1. `forceLegalBestOutcome` — true for **every** JRX-dependent platform and
 *      every authenticated SDK partner except JRX (`wantsNspNymBestOutcome`,
 *      default ON). Its only escape was a ≤ 6-word greeting with no legal
 *      keyword, so effectively all ecosystem legal traffic was Queen traffic.
 *      That is Queen *defaulted*, which is what §10.2 rule 2 forbids.
 *   2. `QUEEN_TASK_RE` / `QUEEN_TASK_TYPE_RE` keyword hits — a static word list.
 *      `advise`, `advisory`, `research` and `opinion` are ordinary words in a
 *      one-line question.
 *   3. `complexity === 'complex'`, where complexity came from
 *      `analyzePrompt`'s **word count** (`length < 100 || totalKeywords <= 5`
 *      → 'complex'). A 30-word single-issue question scores 'complex'.
 *
 * ── What replaces them ──────────────────────────────────────────────────────
 * A scored read of the *structure* of the request: how many instruments are in
 * play, whether authority is contested, whether more than one forum is
 * involved, whether the output is filing-grade, and — decisively — whether a
 * deterministic store could close it (Phase 1's tier, `tools before agents`).
 *
 * ── The asymmetry that governs the design ───────────────────────────────────
 * Cost is recoverable; a wrong legal answer is not. So the gate is deliberately
 * **not** symmetric: when the evidence is inconclusive it escalates. Any score
 * inside `QUEEN_AMBIGUITY_BAND` below the admission threshold is admitted with
 * `escalatedForAmbiguity: true`, unless a store can answer the request outright.
 * An over-provisioned cheap request costs money once; an under-provisioned
 * complex one ships bad advice.
 *
 * ── Threshold discipline (NV-GUARDRAIL-UNREACHABLE-THRESHOLD-001) ───────────
 * `score` is a plain sum of independent signed terms. It is never clamped, so
 * the `score >= threshold` comparison cannot become the clamp-then-compare
 * tautology that produced NV-RAG-CONF-001 and NV-MEM-DECAY-001. The unit tests
 * assert the same table both crosses and fails to cross the threshold.
 *
 * Pure — no I/O, no LLM, no network. Escape hatch: JRX_QUEEN_EARNED=0 restores
 * the pre-gate behaviour (every heuristic admission stands).
 */
import {
  asksApplicabilityBeyondText,
  asksBeyondSectionScope,
  hasStatuteOrCitationAnchor,
  isOldNewMappingQuestion,
  listCoreSectionRefs,
  listNonCoreInstruments,
  needsGenerationBeyondRetrieval,
} from '../services/jrx-statute-qa-grounding.js';

/** Weights are ordinal, not calibrated probabilities — see the ranking below. */
export const QUEEN_ADMIT_SCORE = 6;

/**
 * How far below the threshold still escalates. This is the asymmetry made
 * numeric: the effective bar for a legal request no store can answer is
 * `QUEEN_ADMIT_SCORE - QUEEN_AMBIGUITY_BAND`, and the reason string records
 * that the decision was an escalation rather than a clear admission.
 */
export const QUEEN_AMBIGUITY_BAND = 2;

/**
 * Contested-authority language. A split of authority is the canonical case for
 * fan-out: independent leaves can each take one line of cases and the synthesis
 * leg reconciles them (§8.5).
 */
const CONFLICTING_AUTHORITY_RE =
  /\b(conflicting|divergent|contrary\s+view|contrary\s+authority|split\s+(?:of\s+)?(?:authority|opinion|verdict)|two\s+lines\s+of\s+authority|per\s+incuriam|overrul\w*|inconsistent\s+(?:rulings?|judgments?|judgements?|decisions?)|distinguish(?:ed|able)\s+in|disagree\w*\s+with)\b/i;

/** Explicit multi-forum / cross-border language. */
const MULTI_JURISDICTION_RE =
  /\b(multi[-\s_]?jurisdiction\w*|cross[-\s_]?border|inter[-\s_]?state|different\s+states?|several\s+states?|multiple\s+(?:states?|courts?|forums?|jurisdictions?|benches)|forum\s+shop\w*|which\s+(?:court|forum)\s+(?:should|has|would))\b/i;

/**
 * Named Indian forums. Two distinct forums in one prompt is real multi-forum
 * structure ("Delhi HC says X, Bombay HC says Y") rather than a keyword.
 */
const FORUM_TOKEN_RE =
  /\b(supreme\s+court|delhi\s+high\s+court|bombay\s+high\s+court|madras\s+high\s+court|calcutta\s+high\s+court|karnataka\s+high\s+court|kerala\s+high\s+court|allahabad\s+high\s+court|gujarat\s+high\s+court|telangana\s+high\s+court|punjab\s+(?:and|&)\s+haryana\s+high\s+court|nclat|nclt|ngt|sat\b|drat|cestat|itat|consumer\s+commission|arbitral\s+tribunal)\b/gi;

/** Filing-grade output nouns — the one place maker-checker earns its price. */
const FILING_GRADE_NOUN_RE =
  /\b(petition|plaint|written\s+statement|affidavit|counter[-\s]?affidavit|rejoinder|legal\s+notice|reply\s+notice|pleadings?|bail\s+application|anticipatory\s+bail\s+application|memorandum\s+of\s+(?:appeal|parties)|vakalatnama|deed|agreement|contract|mou|nda|lease|will|settlement|charge[-\s]?sheet|complaint\s+under|writ|slp|special\s+leave|revision\s+petition|caveat|injunction\s+application)\b/i;

/** Caller-declared filing-grade / drafting work. */
const FILING_GRADE_TASK_TYPE_RE =
  /^(document[_-]?draft(?:ing)?|legal[_-]?draft(?:ing)?|draft(?:ing)?|efiling|e-filing|filing|pleading|petition)$/i;

/** Caller-declared deep-analysis work (weaker than filing-grade). */
const DEEP_TASK_TYPE_RE =
  /^(research|opinion|litigation|strategy|playbook|twin|multi[_-]?agent|orchestration|matter[_-]?analysis|advisory)$/i;

/** Additional-issue connectives — each one is another thing to answer. */
const ISSUE_CONNECTIVE_RE =
  /\b(also|additionally|in\s+addition|furthermore|moreover|as\s+well\s+as|and\s+whether|secondly|thirdly|separately|at\s+the\s+same\s+time|simultaneously|parallel\s+(?:proceedings?|matter)|besides\s+that)\b/gi;

/** Definitional / content lookups — the cheapest possible shape. */
const DEFINITIONAL_RE =
  /^\s*(?:what\s+is|what\s+does|what\s+are\s+the\s+(?:ingredients|elements)|define|meaning\s+of|full\s+form\s+of|explain\s+section|tell\s+me\s+(?:what|about)\s+section|punishment\s+(?:for|under))\b/i;

/**
 * A live matter rather than a research question: there is an opposing side, a
 * pending forum event, or a served instrument. This is the shape that arrives
 * *without* clean structure — narrative, unanchored, several threads at once —
 * and it is exactly where a shallow answer does real damage. It is deliberately
 * weighted enough to reach the ambiguity band on its own.
 */
const LIVE_MATTER_RE =
  /\b(my\s+client|our\s+client|opposing\s+(?:party|counsel)|other\s+side|counterparty|next\s+hearing|upcoming\s+hearing|date\s+of\s+hearing|pending\s+(?:before|proceedings?|matter|case)|parallel\s+proceedings?|show[-\s]?cause|received\s+a?\s*notice|served\s+(?:with|on|upon)|dispute\s+with|adjourn\w*|interim\s+order|status\s+quo|ex[-\s]?parte)\b/i;

export interface QueenAdmissionInput {
  prompt: string;
  taskType?: string;
  complexity: 'simple' | 'moderate' | 'complex' | 'very_complex';
  risk: 'low' | 'medium' | 'high' | 'critical';
  /** `forceLegalBestOutcome` — a caller preference for depth, never sufficient alone. */
  bestOutcome?: boolean;
  /** `analyzePrompt().requiresMultipleAgents`, when the caller computed it. */
  requiresMultipleAgents?: boolean;
}

/** Raw, loggable observations. Every field is derived from the prompt alone. */
export interface QueenAdmissionEvidence {
  wordCount: number;
  coreSectionRefs: string[];
  nonCoreInstruments: string[];
  namedForums: string[];
  multiJurisdiction: boolean;
  conflictingAuthority: boolean;
  strategyAsk: boolean;
  applicabilityAsk: boolean;
  generationAsk: boolean;
  filingGrade: boolean;
  issueConnectives: number;
  extraQuestions: number;
  definitional: boolean;
  mappingQuestion: boolean;
  /** Opposing side / pending forum event / served instrument — a real matter. */
  liveMatterContext: boolean;
  /** The Phase 1 deterministic tier could plausibly close this with 0 tokens. */
  deterministicCandidate: boolean;
}

export interface QueenAdmissionVerdict {
  admit: boolean;
  score: number;
  threshold: number;
  /** Machine-parseable outcome for log aggregation. */
  reason: string;
  /** Ambiguity resolved upward rather than down — audit this, do not hide it. */
  escalatedForAmbiguity: boolean;
  /** Signed contributions, e.g. `multi_instrument+4`. Ordered strongest first. */
  signals: string[];
  evidence: QueenAdmissionEvidence;
}

export function isQueenEarnedGateEnabled(): boolean {
  return String(process.env.JRX_QUEEN_EARNED ?? '1').trim() !== '0';
}

/**
 * Length ceiling below which an anchored, non-reasoning question is treated as a
 * lookup. Matches the deterministic tier's own default so the two tiers agree on
 * what "a lookup" means (JRX_JRX_ECOSYSTEM_DETERMINISTIC_MAX_CHARS).
 */
function lookupCharCeiling(): number {
  const n = Number(process.env.JRX_JRX_ECOSYSTEM_DETERMINISTIC_MAX_CHARS ?? '240');
  return Number.isFinite(n) && n >= 40 ? Math.min(600, Math.floor(n)) : 240;
}

function countMatches(text: string, re: RegExp): number {
  return (text.match(re) || []).length;
}

export function collectQueenAdmissionEvidence(input: QueenAdmissionInput): QueenAdmissionEvidence {
  const prompt = String(input.prompt || '');
  const trimmed = prompt.trim();
  const words = trimmed.split(/\s+/).filter(Boolean);
  const taskType = String(input.taskType || '').trim();

  const coreSectionRefs = listCoreSectionRefs(prompt);
  const nonCoreInstruments = listNonCoreInstruments(prompt);
  const namedForums = [
    ...new Set((prompt.match(FORUM_TOKEN_RE) || []).map((f) => f.toLowerCase().replace(/\s+/g, ' '))),
  ];

  const strategyAsk = asksBeyondSectionScope(prompt);
  const applicabilityAsk = asksApplicabilityBeyondText(prompt);
  const generationAsk = needsGenerationBeyondRetrieval(prompt);
  const mappingQuestion = isOldNewMappingQuestion(prompt);

  const filingGrade =
    FILING_GRADE_TASK_TYPE_RE.test(taskType)
    || (generationAsk && FILING_GRADE_NOUN_RE.test(prompt));

  // A store can only close it when nothing in the request asks for reasoning,
  // generation or applicability — the same three tests the deterministic tier
  // applies (`couldBeDeterministic`), evaluated here without the NYS round trip.
  const deterministicCandidate =
    hasStatuteOrCitationAnchor(prompt)
    && trimmed.length <= lookupCharCeiling()
    && !generationAsk
    && !strategyAsk
    && !applicabilityAsk
    && nonCoreInstruments.length === 0;

  return {
    wordCount: words.length,
    coreSectionRefs,
    nonCoreInstruments,
    namedForums,
    multiJurisdiction: MULTI_JURISDICTION_RE.test(prompt) || namedForums.length > 1,
    conflictingAuthority: CONFLICTING_AUTHORITY_RE.test(prompt),
    strategyAsk,
    applicabilityAsk,
    generationAsk,
    filingGrade,
    // Cap the weak signal at 3 so a chatty prompt cannot out-vote real structure.
    issueConnectives: Math.min(3, countMatches(prompt, ISSUE_CONNECTIVE_RE)),
    extraQuestions: Math.max(0, countMatches(prompt, /\?/g) - 1),
    definitional: DEFINITIONAL_RE.test(trimmed),
    mappingQuestion,
    liveMatterContext: LIVE_MATTER_RE.test(prompt),
    deterministicCandidate,
  };
}

/**
 * Score the evidence and decide.
 *
 * Ranking principle, strongest first:
 *   0. critical risk                     (+8, i.e. threshold+2 — a critical-risk
 *      request is admitted on that term alone; only a store that can answer it
 *      verbatim can outvote it, because verbatim statute text with citations is
 *      not a shallow answer)
 *   1. caller-declared filing-grade output    (+4) — §8.5 puts the premium
 *      synthesis leg and maker-checker exactly here
 *   2. more than one legal instrument in play (+4) — genuine fan-out structure
 *   3. contested authority                    (+4) — leaves reconcile lines of cases
 *   4. more than one forum                    (+4)
 *   5. declared complexity / high risk        (+2…+4)
 *   6. reasoning-kind asks, live matter, caller depth pref (+2)
 *   7. extra issues asked in passing          (+1 each, ≤ 3)
 *  and, against admission:
 *   -6 a store can answer it   ·  -4 bare lookup  ·  -3 definitional  ·  -2 simple
 */
export function assessQueenAdmission(input: QueenAdmissionInput): QueenAdmissionVerdict {
  const evidence = collectQueenAdmissionEvidence(input);
  const signals: string[] = [];
  let score = 0;
  const add = (name: string, points: number) => {
    if (points === 0) return;
    score += points;
    signals.push(`${name}${points > 0 ? '+' : ''}${points}`);
  };

  // Critical risk carries threshold+2, so it admits on its own term. It is a
  // scored term rather than an early return for two reasons: the reported score
  // stays the real one, and a bare `BNS 103` lookup tagged critical by
  // `classifyRiskLevel` (which reads the *agent key*, e.g. any `bail` agent, not
  // the request) can still be closed by the store's verbatim text — which is not
  // a shallow answer. Anything asking for reasoning keeps the swarm.
  if (input.risk === 'critical') add('risk_critical', QUEEN_ADMIT_SCORE + 2);
  else if (input.risk === 'high') add('risk_high', 2);

  const multiInstrument =
    evidence.coreSectionRefs.length > 1
    || evidence.nonCoreInstruments.length > 1
    || (evidence.coreSectionRefs.length > 0 && evidence.nonCoreInstruments.length > 0);

  if (evidence.filingGrade) add('filing_grade', 4);
  if (multiInstrument) add('multi_instrument', 4);
  if (evidence.conflictingAuthority) add('conflicting_authority', 4);
  if (evidence.multiJurisdiction) add('multi_jurisdiction', 4);

  if (input.complexity === 'very_complex') add('complexity_very_complex', 4);
  else if (input.complexity === 'complex') add('complexity_complex', 2);
  else if (input.complexity === 'simple') add('complexity_simple', -2);

  if (evidence.strategyAsk) add('strategy_ask', 2);
  if (evidence.applicabilityAsk && !evidence.strategyAsk) add('applicability_ask', 1);
  if (!evidence.filingGrade && DEEP_TASK_TYPE_RE.test(String(input.taskType || '').trim())) {
    add('deep_task_type', 2);
  }
  if (input.requiresMultipleAgents) add('analyze_multi_agent', 2);
  if (input.bestOutcome) add('caller_best_outcome', 2);
  if (evidence.wordCount >= 80) add('long_form', 2);
  /* A live matter with an opposing side or a pending forum event is where the
   * asymmetry bites hardest: these arrive as narrative with no clean structure,
   * so none of the structural terms above fire, yet a shallow answer is the most
   * damaging. Weighted to reach the ambiguity band with one more weak signal. */
  if (evidence.liveMatterContext) add('live_matter', 2);

  add('issue_connectives', evidence.issueConnectives);
  add('extra_questions', Math.min(2, evidence.extraQuestions));

  // ── Counter-evidence ────────────────────────────────────────────────────
  // A mapping question has a measured 0-token fast path (Phase 0, 69–131 ms).
  if (evidence.mappingQuestion) add('mapping_fast_path', -6);
  if (evidence.deterministicCandidate) add('deterministic_candidate', -6);
  if (evidence.definitional && !multiInstrument) add('definitional', -3);
  if (
    !evidence.deterministicCandidate
    && hasStatuteOrCitationAnchor(input.prompt)
    && !multiInstrument
    && !evidence.generationAsk
    && !evidence.conflictingAuthority
    && evidence.wordCount <= 25
  ) {
    add('single_section_lookup', -4);
  }

  const storeCanAnswer = evidence.deterministicCandidate || evidence.mappingQuestion;

  if (score >= QUEEN_ADMIT_SCORE) {
    return {
      admit: true,
      score,
      threshold: QUEEN_ADMIT_SCORE,
      reason: 'admit:evidence_score',
      escalatedForAmbiguity: false,
      signals,
      evidence,
    };
  }

  // Ambiguity resolves toward more capability — but never over a store that has
  // the answer, because that is not ambiguity, it is a known cheap win.
  if (!storeCanAnswer && score >= QUEEN_ADMIT_SCORE - QUEEN_AMBIGUITY_BAND) {
    return {
      admit: true,
      score,
      threshold: QUEEN_ADMIT_SCORE,
      reason: 'admit:ambiguity_escalation',
      escalatedForAmbiguity: true,
      signals,
      evidence,
    };
  }

  return {
    admit: false,
    score,
    threshold: QUEEN_ADMIT_SCORE,
    reason: storeCanAnswer ? 'deny:store_can_answer' : 'deny:insufficient_evidence',
    escalatedForAmbiguity: false,
    signals,
    evidence,
  };
}

/** Compact one-line form for the router decision `reason` and the route log. */
export function formatQueenAdmission(v: QueenAdmissionVerdict): string {
  return (
    `${v.reason} score=${v.score}/${v.threshold}`
    + `${v.escalatedForAmbiguity ? ' escalated' : ''}`
    + `${v.signals.length ? ` [${v.signals.join(' ')}]` : ''}`
  );
}
