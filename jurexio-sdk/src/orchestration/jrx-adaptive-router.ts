/**
 * NV-ADAPTIVE-ROUTER-001 — complexity × risk × taskType → execution path.
 *
 * Paths:
 *   queen        — multi-agent Queen (CoT + maker-checker when depth ON)
 *   specialist   — single-agent safety ring (callJurexio)
 *   doc-pipeline — OCR/parse/embed/classify/summarize via capability leaves + ring
 *
 * Partner lean (`partnerSyncLean`) ALWAYS wins → specialist. Never rewrite lean semantics.
 *
 * NV-QUEEN-EARNED-001 (2026-08-16): every *heuristic* admission to `queen` is now
 * confirmed by `assessQueenAdmission` (`jrx-queen-admission.ts`) — an evidence
 * score over the prompt's structure, not a keyword or a static caller flag. An
 * explicit caller force (`engageQueenForced` / `forceQueenMode`) and
 * `partnerSyncLean` are untouched: both are contracts, not heuristics. The
 * verdict travels on the decision as `queenAdmission` so a downgrade is
 * auditable rather than mysterious.
 */

import {
  assessQueenAdmission,
  formatQueenAdmission,
  isQueenEarnedGateEnabled,
  type QueenAdmissionVerdict,
} from './jrx-queen-admission.js';
import { AGENTIC_DRAFT_INTENT, isAgenticDraftTaskType } from './jrx-legal-draft-agentic.js';
import { getDeclaredCapabilitiesForIntent } from './capability-manifest.js';

export type AdaptivePath = 'queen' | 'specialist' | 'doc-pipeline';

export type AdaptiveComplexity = 'simple' | 'moderate' | 'complex' | 'very_complex';

export type AdaptiveRisk = 'low' | 'medium' | 'high' | 'critical';

export interface AdaptiveRouterInput {
  prompt: string;
  taskType?: string;
  complexity?: AdaptiveComplexity | string;
  risk?: AdaptiveRisk | string;
  partnerLean?: boolean;
  nyvDependent?: boolean;
  explicitAgentKey?: string;
  /** Caller forced multi-agent mode */
  forceQueenMode?: boolean;
  /** Explicit orchestrationMode already engages Queen */
  engageQueenForced?: boolean;
  hasDocumentPayload?: boolean;
  enableCoT?: boolean;
  /**
   * NV-NSP-NYM-BEST-OUTCOME-001 — NSP/NYM: prefer Queen + full depth for
   * non-document legal work (trivial greetings stay specialist).
   */
  forceLegalBestOutcome?: boolean;
  /**
   * NV-QUEEN-EARNED-001 — `assessPromptComplexity().requiresMultipleAgents`.
   * A supporting signal for the admission score, never sufficient alone.
   */
  requiresMultipleAgents?: boolean;
}

export interface AdaptiveRouterDecision {
  path: AdaptivePath;
  reason: string;
  complexity: AdaptiveComplexity;
  risk: AdaptiveRisk;
  primaryCapabilityIds: string[];
  detectedLanguage?: string;
  docTask?: string;
  requireQueenDepth: boolean;
  requireCoT: boolean;
  requireMakerChecker: boolean;
  requireHitlScaled: boolean;
  /**
   * NV-QUEEN-EARNED-001 — the admission verdict for every decision that reached
   * a Queen rule, admitted or denied. Absent when no Queen rule was evaluated
   * (partner lean, caller force, doc-pipeline, plain specialist default).
   */
  queenAdmission?: QueenAdmissionVerdict;
}

const DOC_TASK_RE =
  /\b(ocr|optical\s*character|parse|parsing|embed(?:ding)?|classif(?:y|ication)|extract(?:ion)?|chunk(?:ing)?|watermark|redact|compare|comparison|diff|summar(?:y|ise|ize)|doc(?:ument)?[-\s_]?analy[sz]e|multimodal|voice|speech|transcri)\b/i;

const DOC_TASK_TYPE_RE =
  /^(ocr|parse|embed|embedding|classify|classification|extract|summar(?:y|ize|ise)|compare|comparison|doc[_-]?analy[sz]e|document|watermark|redact|multimodal|voice|tts|stt)$/i;

const QUEEN_TASK_RE =
  /\b(research|opinion|litigat|strateg|e[-\s_]?fil(?:e|ing)|playbook|digital[-\s_]?twin|multi[-\s_]?doc|matter\s+analysis|precedent\s+map|draft(?:ing)?|pleadings?|affidavit|plaint|writ\s+petition|legal\s+notice|argue|cross[-\s_]?examin|advise|advisory|memorandum|legal\s+opinion)\b/i;

const QUEEN_TASK_TYPE_RE =
  /^(research|opinion|litigation|strategy|filing|efiling|e-filing|playbook|twin|orchestration|multi[_-]?agent|document[_-]?draft(?:ing)?|draft(?:ing)?|legal[_-]?draft(?:ing)?|legal[_-]?chat([_-]?fast)?|legal[_-]?work|advisory|advice)$/i;

/** Pure document ops — never elevate to Queen solely because the payload mentions "petition". */
const PURE_DOC_TASKS = new Set([
  'ocr', 'parse', 'embed', 'classify', 'summarize', 'compare', 'watermark', 'redact', 'multimodal', 'extract',
]);

const HIGH_RISK_RE =
  /\b(criminal|bail|injunct|constitutional|supreme\s+court|death\s+penalty|securities\s+fraud|insider\s+trading|money\s+launder)\b/i;

/** Detect primary script / language hint without external deps. */
export function detectLanguageHint(text: string): string {
  if (!text) return 'en';
  if (/[\u0900-\u097F]/.test(text)) return 'hi'; // Devanagari
  if (/[\u0B80-\u0BFF]/.test(text)) return 'ta';
  if (/[\u0C00-\u0C7F]/.test(text)) return 'te';
  if (/[\u0C80-\u0CFF]/.test(text)) return 'kn';
  if (/[\u0D00-\u0D7F]/.test(text)) return 'ml';
  if (/[\u0A80-\u0AFF]/.test(text)) return 'gu';
  if (/[\u0B00-\u0B7F]/.test(text)) return 'or';
  if (/[\u0980-\u09FF]/.test(text)) return 'bn';
  if (/[\u0A00-\u0A7F]/.test(text)) return 'pa';
  if (/[\u0600-\u06FF]/.test(text)) return 'ur';
  return 'en';
}

function normalizeComplexity(c?: string): AdaptiveComplexity {
  const v = String(c || 'moderate').toLowerCase();
  if (v === 'simple' || v === 'moderate' || v === 'complex' || v === 'very_complex') return v;
  return 'moderate';
}

function normalizeRisk(r?: string): AdaptiveRisk {
  const v = String(r || 'medium').toLowerCase();
  if (v === 'low' || v === 'medium' || v === 'high' || v === 'critical') return v;
  return 'medium';
}

function inferDocTask(prompt: string, taskType?: string): { docTask: string; capabilityIds: string[] } | null {
  const tt = String(taskType || '').trim();
  const p = prompt || '';
  const blob = `${tt} ${p}`.toLowerCase();

  if (/\bocr\b|optical\s*character/.test(blob) || /^ocr$/i.test(tt)) {
    return { docTask: 'ocr', capabilityIds: ['docs.ocr', 'enterprise.ocr-pipeline'] };
  }
  if (/\bparse\b|parsing/.test(blob) || /^parse$/i.test(tt)) {
    return { docTask: 'parse', capabilityIds: ['docs.parse', 'docs.parse-legal', 'docs.process'] };
  }
  if (/\bembed/.test(blob) || /^embed/i.test(tt)) {
    return { docTask: 'embed', capabilityIds: ['docs.embed', 'rag.embedding'] };
  }
  if (/\bclassif/.test(blob) || /^classif/i.test(tt)) {
    return { docTask: 'classify', capabilityIds: ['intelligence.doc-analyze', 'workflow.email-classify'] };
  }
  // Doc A/B compare → sdk pipeline; statute IPC/BNS compare stays jrx-legal-tools
  if (/\b(ipc|bns|statute)\b.*\bcompar|\bcompar.*\b(ipc|bns|statute)\b/.test(blob)) {
    return { docTask: 'statute_compare', capabilityIds: ['jrx-legal-tools.compare'] };
  }
  if (/\bcompare|comparison|\bdiff\b/.test(blob) || /^compar/i.test(tt)) {
    return { docTask: 'compare', capabilityIds: ['sdk.document-pipeline', 'jrx-legal-tools.compare'] };
  }
  if (/\bsummar/.test(blob) || /^summar/i.test(tt)) {
    return { docTask: 'summarize', capabilityIds: ['intelligence.summarize'] };
  }
  if (/\bdoc[_-\s]?analy|document\s+analy|analy[sz]e\s+(the\s+)?doc/.test(blob) || /doc[_-]?analy/i.test(tt)) {
    return { docTask: 'doc_analyze', capabilityIds: ['intelligence.doc-analyze'] };
  }
  if (/\bmultimodal|\bvoice\b|\btts\b|\bstt\b|\btranscri/.test(blob) || /multimodal|voice|tts|stt/i.test(tt)) {
    return { docTask: 'multimodal', capabilityIds: ['sdk.multimodal-voice'] };
  }
  if (/\blanguage\b|\btranslat|\bmultiling/.test(blob) || /language|translat/i.test(tt)) {
    return { docTask: 'language', capabilityIds: ['intelligence.summarize', 'sdk.multimodal-voice'] };
  }
  if (/\bextract\b|extraction|parties|clause/.test(blob) || /^extract$/i.test(tt)) {
    return { docTask: 'extract', capabilityIds: ['intelligence.ner', 'intelligence.doc-analyze'] };
  }
  if (DOC_TASK_TYPE_RE.test(tt) || DOC_TASK_RE.test(p) || false) {
    return { docTask: 'document', capabilityIds: ['intelligence.doc-analyze', 'docs.parse'] };
  }
  return null;
}

/**
 * Decide execution path. Pure function — no I/O.
 */
export function decideAdaptivePath(input: AdaptiveRouterInput): AdaptiveRouterDecision {
  const prompt = String(input.prompt || '');
  const complexity = normalizeComplexity(input.complexity);
  const riskBase = normalizeRisk(input.risk);
  const risk: AdaptiveRisk = HIGH_RISK_RE.test(prompt)
    ? (riskBase === 'critical' ? 'critical' : 'high')
    : riskBase;
  const detectedLanguage = detectLanguageHint(prompt);
  const tt = String(input.taskType || '');

  // 1) Partner lean — immutable
  if (input.partnerLean) {
    return {
      path: 'specialist',
      reason: 'partnerSyncLean opt-in — single-agent only (Queen skipped; quality gates still ON)',
      complexity,
      risk,
      primaryCapabilityIds: [],
      detectedLanguage,
      requireQueenDepth: false,
      requireCoT: !!input.enableCoT,
      requireMakerChecker: false,
      requireHitlScaled: risk === 'high' || risk === 'critical',
    };
  }

  // NV-LEGAL-DRAFT-AGENTIC-001 — comprehensive agentic draft → Queen + draft_agentic mesh.
  if (isAgenticDraftTaskType(tt)) {
    const caps = getDeclaredCapabilitiesForIntent(AGENTIC_DRAFT_INTENT);
    return {
      path: 'queen',
      reason: `agentic_draft: taskType=${tt} intent=${AGENTIC_DRAFT_INTENT}`,
      complexity: complexity === 'simple' ? 'complex' : complexity,
      risk,
      primaryCapabilityIds: caps ? [...caps] : [],
      detectedLanguage,
      requireQueenDepth: true,
      requireCoT: true,
      requireMakerChecker: true,
      requireHitlScaled: risk === 'high' || risk === 'critical',
    };
  }

  // 2) Explicit Queen force
  if (input.engageQueenForced || input.forceQueenMode) {
    return {
      path: 'queen',
      reason: 'caller forced multi-agent / Queen mode',
      complexity,
      risk,
      primaryCapabilityIds: [],
      detectedLanguage,
      requireQueenDepth: true,
      requireCoT: true,
      requireMakerChecker: risk !== 'low',
      requireHitlScaled: risk === 'high' || risk === 'critical',
    };
  }

  const wantsQueenTask = QUEEN_TASK_TYPE_RE.test(tt) || QUEEN_TASK_RE.test(prompt);
  const docInfer = inferDocTask(prompt, tt);
  const isDocish =
    !!docInfer
    || !!input.hasDocumentPayload
    || DOC_TASK_TYPE_RE.test(tt)
    || DOC_TASK_RE.test(prompt);

  const riskElevated = risk === 'high' || risk === 'critical';

  /**
   * NV-QUEEN-EARNED-001 — computed once, consulted by every heuristic Queen
   * rule below. Lazy so the pure-doc and fast-sync short circuits above pay
   * nothing for it.
   */
  let admissionMemo: QueenAdmissionVerdict | null = null;
  const admission = (): QueenAdmissionVerdict => {
    admissionMemo ??= assessQueenAdmission({
      prompt,
      taskType: tt,
      complexity,
      risk,
      bestOutcome: !!input.forceLegalBestOutcome,
      requiresMultipleAgents: input.requiresMultipleAgents,
    });
    return admissionMemo;
  };
  /**
   * True when the swarm is earned. With the gate disabled every heuristic
   * admission stands, exactly as before — the escape hatch changes the verdict,
   * never the evidence, so the log still shows what the gate would have decided.
   */
  const queenEarned = (): boolean => (isQueenEarnedGateEnabled() ? admission().admit : true);

  /**
   * Downgrade target for a heuristic Queen rule the evidence did not support.
   *
   * Depth is *preserved*, not discarded with the swarm. Denying fan-out is a cost
   * decision; it must not quietly become a quality decision. So a downgraded
   * best-outcome request keeps CoT **and** maker-checker even when `complexity`
   * says 'simple' — that label comes from `analyzePrompt`'s word count, which is
   * the same unreliable signal the gate exists to stop trusting, and one review
   * completion on the specialist path is a rounding error against a 7-completion
   * swarm. (Rule 6 below is stricter only because nothing there proposed Queen.)
   */
  const specialistInsteadOfQueen = (rule: string): AdaptiveRouterDecision => ({
    path: 'specialist',
    reason: `queen_not_earned(${rule}): ${formatQueenAdmission(admission())}`,
    complexity,
    risk,
    primaryCapabilityIds: [],
    detectedLanguage,
    requireQueenDepth: false,
    requireCoT: !!input.enableCoT || !!input.forceLegalBestOutcome || complexity !== 'simple',
    requireMakerChecker: !!input.forceLegalBestOutcome || riskElevated,
    requireHitlScaled: riskElevated,
    queenAdmission: admission(),
  });

  // NV-WEB-SEARCH-SLA-001 / NV-LPM-SLA-001: market-intel web search + workflow
  // suggest must complete under partner sync budgets — specialist path, no Queen MC.
  const fastSyncTask =
    /^(web[_-]?search|trending|market[_-]?intel(?:ligence)?|workflow|task[_-]?assist|project[_-]?manag(?:er|ement)?|legal[_-]?chat[_-]?fast|legal[_-]?draft[_-]?fast|doc[_-]?draft(?:[_-]?fast)?)$/i.test(tt)
    || /\b(web[_-\s]?search|trending[_-\s]?legal|ai[_-\s]?suggest)\b/i.test(tt + ' ' + prompt.slice(0, 80));
  if (fastSyncTask && !input.engageQueenForced && !input.forceQueenMode) {
    const legalFastSync = /legal[_-]?(chat|draft)[_-]?fast/i.test(tt);
    const nspBestDepth = !!input.forceLegalBestOutcome && legalFastSync;
    const queenAdmissionVerdict = nspBestDepth ? admission() : undefined;
    return {
      path: 'specialist',
      reason: nspBestDepth
        ? `fast_sync_specialist(nsp_best_depth): taskType=${tt || 'inferred'}; ${formatQueenAdmission(queenAdmissionVerdict!)}`
        : `fast_sync_specialist: taskType=${tt || 'inferred'}`,
      complexity,
      risk,
      primaryCapabilityIds: /web|trend|market/i.test(tt) ? ['enterprise.web-search'] : [],
      detectedLanguage,
      requireQueenDepth: false,
      requireCoT: nspBestDepth || !!input.enableCoT,
      requireMakerChecker: nspBestDepth,
      requireHitlScaled: riskElevated,
      ...(queenAdmissionVerdict ? { queenAdmission: queenAdmissionVerdict } : {}),
    };
  }

  // 2b) Pure OCR/parse/embed/classify/summarize — doc-pipeline before Queen keyword elevation
  // (payload text may mention "petition"/"contract" without being a drafting task).
  if (docInfer && PURE_DOC_TASKS.has(docInfer.docTask) && !input.engageQueenForced && !input.forceQueenMode) {
    return {
      path: 'doc-pipeline',
      reason: `doc-pipeline: task=${docInfer.docTask}`,
      complexity,
      risk,
      primaryCapabilityIds: docInfer.capabilityIds,
      detectedLanguage,
      docTask: docInfer.docTask,
      requireQueenDepth: false,
      requireCoT: !!input.enableCoT || /analy|research|compar/i.test(tt + prompt),
      requireMakerChecker: false,
      requireHitlScaled: riskElevated,
    };
  }

  // 3) High risk / complex legal reasoning → Queen, when earned
  if (
    riskElevated
    || complexity === 'very_complex'
    || (complexity === 'complex' && (wantsQueenTask || !isDocish))
    || (wantsQueenTask && complexity !== 'simple')
  ) {
    if (!queenEarned()) {
      // The heuristic that fired here is a word list or a word count; the
      // downgrade is recorded with its evidence so it can be audited.
      return specialistInsteadOfQueen(`risk=${risk} complexity=${complexity} queenTask=${wantsQueenTask}`);
    }
    return {
      path: 'queen',
      reason: `Queen: risk=${risk} complexity=${complexity} queenTask=${wantsQueenTask} | ${formatQueenAdmission(admission())}`,
      complexity,
      risk,
      primaryCapabilityIds: [],
      detectedLanguage,
      requireQueenDepth: !!input.nyvDependent || complexity !== 'simple',
      requireCoT: true,
      requireMakerChecker: risk !== 'low' || !!input.nyvDependent,
      requireHitlScaled: riskElevated,
      queenAdmission: admission(),
    };
  }

  // 4) Document pipeline for remaining docish work
  // (very_complex already returned above)
  if (isDocish && !wantsQueenTask) {
    return {
      path: 'doc-pipeline',
      reason: `doc-pipeline: task=${docInfer?.docTask || tt || 'document'}`,
      complexity,
      risk,
      primaryCapabilityIds: docInfer?.capabilityIds ?? ['intelligence.doc-analyze'],
      detectedLanguage,
      docTask: docInfer?.docTask,
      requireQueenDepth: false,
      requireCoT: !!input.enableCoT || /analy|research|compar/i.test(tt + prompt),
      requireMakerChecker: false,
      requireHitlScaled: riskElevated,
    };
  }

  // 5) JRX-dependent moderate research-ish without doc → Queen, when earned
  if (input.nyvDependent && complexity === 'moderate' && wantsQueenTask) {
    if (!queenEarned()) return specialistInsteadOfQueen('nyvDependent_moderate_queen_task');
    return {
      path: 'queen',
      reason: `JRX-dependent moderate Queen task | ${formatQueenAdmission(admission())}`,
      complexity,
      risk,
      primaryCapabilityIds: [],
      detectedLanguage,
      requireQueenDepth: true,
      requireCoT: true,
      requireMakerChecker: true,
      requireHitlScaled: false,
      queenAdmission: admission(),
    };
  }

  // 5b) NSP/NYM best-outcome — non-document legal work → full Queen, when earned
  // Short statute FAQs are overridden to grounded specialist in orchestrate routes.
  // Web-search / workflow sync tasks already returned above (fast_sync_specialist).
  //
  // NV-QUEEN-EARNED-001: `forceLegalBestOutcome` is true for every JRX-dependent
  // platform and every authenticated SDK partner except JRX, so before the gate
  // this branch made Queen the *default* for all ecosystem legal traffic — the
  // single largest source of unearned swarm entry. It is now a +2 preference
  // term in the score rather than an admission on its own.
  if (input.forceLegalBestOutcome && !isDocish && !fastSyncTask) {
    const words = prompt.trim().split(/\s+/).filter(Boolean);
    const trivialGreeting =
      complexity === 'simple'
      && words.length <= 6
      && !/\b(act|section|§|bns|bnss|bsa|ipc|crpc|iea|court|bail|petition|contract|case|statute|law|legal|rights?|amend|ordinance|gazette|judgment|precedent)\b/i.test(prompt);
    if (!trivialGreeting) {
      if (!queenEarned()) return specialistInsteadOfQueen('best_outcome_non_document');
      return {
        path: 'queen',
        reason: `NSP/NYM best-outcome: full Queen legal intelligence + document/agent mesh | ${formatQueenAdmission(admission())}`,
        complexity,
        risk,
        primaryCapabilityIds: [],
        detectedLanguage,
        requireQueenDepth: true,
        requireCoT: true,
        requireMakerChecker: true,
        requireHitlScaled: riskElevated,
        queenAdmission: admission(),
      };
    }
  }

  // 6) Default specialist (incl. simple greetings / trivial chat)
  // The admission verdict is attached even here so the EMA layer can see that a
  // store could answer this request, and so the decision log carries the same
  // evidence shape on every non-doc path.
  return {
    path: 'specialist',
    reason: `specialist: complexity=${complexity} risk=${risk}`,
    complexity,
    risk,
    primaryCapabilityIds: [],
    detectedLanguage,
    requireQueenDepth: false,
    requireCoT: !!input.enableCoT || complexity === 'moderate' || !!input.forceLegalBestOutcome,
    requireMakerChecker: !!input.forceLegalBestOutcome && complexity !== 'simple',
    requireHitlScaled: riskElevated,
    queenAdmission: admission(),
  };
}
