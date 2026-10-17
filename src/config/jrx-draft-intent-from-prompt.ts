/**
 * NV-DRAFT-INTENT-PROMPT-001 — prompt → drafting intent resolver (JRX SSoT).
 *
 * The single heuristic map that decodes a raw partner prompt / documentText into
 * a coarse {@link DraftDocumentType} PLUS, where a statutory trigger is
 * unambiguous, the fine-grained FB-468 `nvTemplateKey` — so JRX can apply the
 * right Indian structure checklist and filing-enclosure manifest even when NSP
 * omits `documentType` / `filingContext` / `filingBookRowId` and sends only a
 * prompt (NV-DOCUMENT-TYPE-INFERENCE-001 fail-open, deepened for FB-468).
 *
 * NV-NO-DUPLICATE-001: this is the ONE prompt-heuristic table. The coarse
 * document-type resolver (`resolveDraftDocumentTypeWithMeta` in
 * `jrx-draft-length-registry.ts`) delegates its prompt-inference branch here
 * rather than carrying a second rule list. Keyword sources are aligned with the
 * filing-book crosswalk (`jrx-filing-book-crosswalk.ts`) and the manifest keys.
 *
 * Fail-open contract: never throw, never return an empty/broken type. When no
 * rule matches, resolve to `general_legal_document` with `source: 'default'` so
 * the caller still emits the DEFAULT Indian counsel structure envelope.
 */
import type { DraftDocumentType } from './jrx-draft-length-registry.js';
import { type NvTemplateKey } from './jrx-filing-book-crosswalk.js';

export type DraftIntentSource = 'prompt_heuristic' | 'default';

export interface DraftIntentResolution {
  docType: DraftDocumentType;
  /** Fine-grained FB-468 manifest key when a statutory trigger is unambiguous. */
  nvTemplateKey?: NvTemplateKey;
  /** 0..1 — specificity of the match (statutory > doctype-name > generic > default). */
  confidence: number;
  /** Human-readable reasons the match was chosen (for draftProfile + audit). */
  rationale: string[];
  source: DraftIntentSource;
  /** The keyword/phrase family that fired (diagnostics only). */
  matchedSignal?: string;
}

/**
 * Below this, callers SHOULD treat the coarse type as a soft default and prefer
 * an explicit parameter when one later arrives. The `default` fail-open always
 * sits below it; generic doctype-name matches sit above it.
 */
export const DRAFT_INTENT_LOW_CONFIDENCE = 0.5;

interface IntentRule {
  re: RegExp;
  docType: DraftDocumentType;
  nvTemplateKey?: NvTemplateKey;
  confidence: number;
  /** Short label of the signal for rationale/matchedSignal. */
  signal: string;
}

/**
 * Ordered most-specific → least-specific. First match wins, so a statutory
 * trigger (S.138, s.148-A, Order XLI Rule 22) is preferred over a bare
 * doctype-name, which is preferred over a generic "petition"/"agreement".
 *
 * `confidence` bands:
 *   0.9  — statutory/section/order-rule trigger (also yields an `nvTemplateKey`)
 *   0.8  — explicit instrument name ("writ petition", "written statement")
 *   0.55 — generic instrument word ("petition", "application", "agreement")
 */
const DRAFT_INTENT_RULES: readonly IntentRule[] = [
  // ── Statutory / order-rule triggers (also resolve a fine-grained manifest key) ──
  {
    re: /\bcheque\s+bounce\b|\bdishonou?r(?:ed)?\s+cheque\b|\bsection\s*138\b|\bs\.?\s*138\b|\bn\.?i\.?\s*act\b|\bnegotiable\s+instruments?\s+act\b/i,
    docType: 'legal_notice',
    nvTemplateKey: 'ni_138_statutory_notice',
    confidence: 0.9,
    signal: 'NI Act s.138 statutory notice (cheque dishonour)',
  },
  {
    re: /\bcaveat\b|\bcaveator\b|\bsection\s*148[\s_-]?a\b|\bs\.?\s*148[\s_-]?a\b/i,
    docType: 'caveat',
    nvTemplateKey: 'civil_caveat',
    confidence: 0.9,
    signal: 'Caveat under s.148-A CPC',
  },
  {
    re: /\bcross[\s_-]?objection(s)?\b|\border[\s_-]+xli[\s_-]+rule[\s_-]+22\b/i,
    docType: 'cross_objection',
    nvTemplateKey: 'civil_cross_objection',
    confidence: 0.9,
    signal: 'Cross-objection under Order XLI Rule 22 CPC',
  },
  {
    re: /\b(?:civil\s+)?revision\s+petition\b|\bcivil\s+revision\b|\bsection\s*115\b|\bs\.?\s*115\s+cpc\b/i,
    docType: 'revision_petition',
    nvTemplateKey: 'civil_revision_petition',
    confidence: 0.9,
    signal: 'Civil revision under s.115 CPC',
  },
  {
    re: /\breview\s+petition\b|\bpetition\s+for\s+review\b|\border[\s_-]+xlvii\b/i,
    docType: 'review_petition',
    nvTemplateKey: 'civil_review_petition',
    confidence: 0.9,
    signal: 'Review petition under Order XLVII CPC',
  },
  {
    re: /\bsection\s*47\b|\bs\.?\s*47\s+cpc\b|\bobjection\s+to\s+execution\b/i,
    docType: 'execution_petition',
    nvTemplateKey: 'civil_section_47_application',
    confidence: 0.9,
    signal: 'Execution objection under s.47 CPC',
  },
  {
    re: /\bexecution\s+petition\b|\bpetition\s+for\s+execution\b|\bdarkhast\b|\border[\s_-]+xxi\b/i,
    docType: 'execution_petition',
    confidence: 0.85,
    signal: 'Execution petition (Order XXI CPC)',
  },
  {
    re: /\bset[\s_-]?aside\b[^.\n]{0,40}\bex[\s_-]?parte\b|\bex[\s_-]?parte\s+decree\b|\border[\s_-]+ix[\s_-]+rule[\s_-]+13\b/i,
    docType: 'petition_application',
    nvTemplateKey: 'civil_setaside_exparte_decree',
    confidence: 0.9,
    signal: 'Set-aside of ex parte decree (Order IX Rule 13 CPC)',
  },
  {
    re: /\brestor(?:e|ation)\s+(?:of\s+)?(?:the\s+)?suit\b|\border[\s_-]+ix[\s_-]+rule[\s_-]+9\b/i,
    docType: 'interlocutory_application',
    nvTemplateKey: 'civil_restore_suit',
    confidence: 0.9,
    signal: 'Restoration of suit (Order IX Rule 9 CPC)',
  },
  {
    re: /\bamend(?:ment)?\s+(?:of\s+)?(?:the\s+)?(?:plaint|pleadings?|written\s+statement)\b|\border[\s_-]+vi[\s_-]+rule[\s_-]+17\b/i,
    docType: 'interlocutory_application',
    nvTemplateKey: 'civil_amend_pleading',
    confidence: 0.9,
    signal: 'Amendment of pleading (Order VI Rule 17 CPC)',
  },
  {
    re: /\bappoint(?:ment)?\s+of\s+(?:a\s+)?receiver\b|\border[\s_-]+xl\b/i,
    docType: 'interlocutory_application',
    nvTemplateKey: 'civil_receiver_appointment',
    confidence: 0.9,
    signal: 'Appointment of receiver (Order XL CPC)',
  },
  {
    re: /\bvacate\b[^.\n]{0,30}\binjunction\b|\bvacate\s+stay\b|\border[\s_-]+xxxix[\s_-]+rule[\s_-]+4\b/i,
    docType: 'interlocutory_application',
    nvTemplateKey: 'civil_injunction_vacate',
    confidence: 0.9,
    signal: 'Vacate injunction (Order XXXIX Rule 4 CPC)',
  },
  {
    re: /\bindigent\b|\bpauper\b|\border[\s_-]+xxxiii\b/i,
    docType: 'civil_suit_plaint',
    nvTemplateKey: 'indigent_suit_petition',
    confidence: 0.9,
    signal: 'Indigent-person suit (Order XXXIII CPC)',
  },
  {
    re: /\bverification\s+affidavit\b|\baffidavit\s+(?:in\s+)?(?:support\s+of|verifying)\s+(?:the\s+)?plaint\b/i,
    docType: 'affidavit_case',
    nvTemplateKey: 'verification_affidavit_plaint',
    confidence: 0.9,
    signal: 'Verification affidavit of plaint (s.26(2) & Order VI Rule 15(4) CPC)',
  },
  {
    re: /\btermination\s+notice\b|\bnotice\s+of\s+termination\b|\bterminat(?:e|ing)\b[^.\n]{0,30}\bagreement\b/i,
    docType: 'legal_notice',
    nvTemplateKey: 'termination_notice',
    confidence: 0.85,
    signal: 'Termination notice',
  },
  {
    re: /\bconsumer\b[^.\n]{0,40}\bnotice\b|\bconsumer\s+protection\s+act\b/i,
    docType: 'legal_notice',
    nvTemplateKey: 'consumer_pre_litigation_notice',
    confidence: 0.85,
    signal: 'Consumer pre-litigation notice',
  },
  {
    re: /\bbreach\s+(?:of\s+contract\s+)?notice\b|\bnotice\b[^.\n]{0,30}\bbreach\s+of\s+contract\b/i,
    docType: 'legal_notice',
    nvTemplateKey: 'breach_notice',
    confidence: 0.85,
    signal: 'Contract-breach notice',
  },

  // ── Instrument-name matches (coarse doctype, no unambiguous manifest key) ──
  { re: /\bbail\s+application\b|\banticipatory\s+bail\b/i, docType: 'bail_application', confidence: 0.85, signal: 'Bail application' },
  { re: /\bwritten\s+statement\b/i, docType: 'written_statement', confidence: 0.85, signal: 'Written statement' },
  { re: /\bcounter[\s_-]?affidavit\b/i, docType: 'counter_affidavit', confidence: 0.85, signal: 'Counter-affidavit' },
  { re: /\brejoinder\b|\breplication\b/i, docType: 'rejoinder', confidence: 0.8, signal: 'Rejoinder / replication' },
  { re: /\bwrit\s+petition\b|\barticle\s*226\b|\bwp\s*\(/i, docType: 'writ_petition', confidence: 0.85, signal: 'Writ petition (Art. 226)' },
  { re: /\bspecial\s+leave\s+petition\b|\bslp\b|\barticle\s*136\b/i, docType: 'writ_petition', confidence: 0.8, signal: 'Special Leave Petition (Art. 136)' },
  { re: /\breply\s+to\s+(?:the\s+)?legal\s+notice\b/i, docType: 'reply_legal_notice', confidence: 0.85, signal: 'Reply to legal notice' },
  { re: /\blegal\s+notice\b|\bdemand\s+notice\b/i, docType: 'legal_notice', confidence: 0.8, signal: 'Legal / demand notice' },
  { re: /\binterlocutory\s+application\b|\binterim\s+application\b|\bi\.a\.\b/i, docType: 'interlocutory_application', confidence: 0.8, signal: 'Interlocutory application' },
  { re: /\bdivorce\s+petition\b|\bmatrimonial\b/i, docType: 'divorce_petition', confidence: 0.8, signal: 'Divorce / matrimonial petition' },
  { re: /\bcivil\s+suit\s+plaint\b|\bplaint\b/i, docType: 'civil_suit_plaint', confidence: 0.8, signal: 'Civil-suit plaint' },
  { re: /\bfinal\s+arguments\b/i, docType: 'final_arguments', confidence: 0.8, signal: 'Final arguments' },
  { re: /\bwritten\s+arguments\b|\bwritten\s+submissions\b/i, docType: 'written_arguments', confidence: 0.8, signal: 'Written arguments' },
  { re: /\blegal\s+opinion\b/i, docType: 'legal_opinion', confidence: 0.8, signal: 'Legal opinion' },
  { re: /\bcase\s+summary\b/i, docType: 'case_summary', confidence: 0.8, signal: 'Case summary' },
  { re: /\bcomplex\s+agreement\b|\bshare\s+purchase\b|\bspa\b/i, docType: 'complex_agreement', confidence: 0.8, signal: 'Complex agreement / SPA' },

  // ── Generic instrument words (soft default; below the low-confidence line) ──
  { re: /\bagreement\b|\bcontract\b|\bmsa\b|\bnda\b/i, docType: 'simple_agreement', confidence: 0.55, signal: 'Agreement / contract (generic)' },
  { re: /\baffidavit\b/i, docType: 'affidavit_case', confidence: 0.55, signal: 'Affidavit (generic)' },
  { re: /\bpetition\b|\bapplication\b/i, docType: 'petition_application', confidence: 0.55, signal: 'Petition / application (generic)' },
];

const DEFAULT_INTENT_DOC_TYPE: DraftDocumentType = 'general_legal_document';

/**
 * Decode a raw prompt / documentText blob into a drafting intent. Never throws;
 * fail-opens to `general_legal_document` (`source: 'default'`).
 */
export function inferDraftIntentFromPrompt(prompt: unknown): DraftIntentResolution {
  const text = String(prompt ?? '').trim();
  if (!text) {
    return {
      docType: DEFAULT_INTENT_DOC_TYPE,
      confidence: 0.2,
      rationale: ['No prompt text supplied — using default Indian counsel structure.'],
      source: 'default',
    };
  }

  for (const rule of DRAFT_INTENT_RULES) {
    if (rule.re.test(text)) {
      const rationale = [`Prompt matched: ${rule.signal}.`];
      if (rule.nvTemplateKey) {
        rationale.push(`Mapped to filing-book key \`${rule.nvTemplateKey}\` for enclosure checklist.`);
      }
      return {
        docType: rule.docType,
        ...(rule.nvTemplateKey ? { nvTemplateKey: rule.nvTemplateKey } : {}),
        confidence: rule.confidence,
        rationale,
        source: 'prompt_heuristic',
        matchedSignal: rule.signal,
      };
    }
  }

  return {
    docType: DEFAULT_INTENT_DOC_TYPE,
    confidence: 0.2,
    rationale: [
      'No specific Indian instrument detected in the prompt — resolved to '
      + '`general_legal_document` with the default counsel structure envelope.',
    ],
    source: 'default',
  };
}
