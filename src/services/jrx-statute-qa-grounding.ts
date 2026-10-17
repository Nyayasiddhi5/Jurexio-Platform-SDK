/**
 * NV-STATUTE-QA-GROUND-001 — Statute Q&A grounding gate.
 *
 * Detects section FAQs (BNS/BNSS/BSA/IPC/…), retrieves the authority row,
 * and corrects LLM answers that conflict with the statute title/text
 * (e.g. BNS §103 answered as "theft" when the title is murder).
 *
 * Default ON; set JRX_STATUTE_QA_GROUNDING=0 to disable.
 */
import { createLogger } from '../utils/logger.js';

const logger = createLogger('./jrx-statute-qa-grounding');

export interface StatuteRef {
  act: string;
  section: string;
}

export interface StatuteAuthority {
  act_short_title: string;
  act_title?: string;
  section_number: string;
  section_title: string;
  section_preview?: string;
  section_text?: string;
  jurisdiction?: string;
  matchType?: string;
}

export interface StatuteQaGroundingResult {
  content: string;
  applied: boolean;
  corrected: boolean;
  statute?: StatuteAuthority;
  reason?: string;
}

const ACT_ALIASES: Array<{ re: RegExp; act: string }> = [
  { re: /\bBharatiya\s+Nyaya\s+Sanhita\b|\bBNS\b/i, act: 'BNS' },
  { re: /\bBharatiya\s+Nagarik\s+Suraksha\s+Sanhita\b|\bBNSS\b/i, act: 'BNSS' },
  { re: /\bBharatiya\s+Sakshya\s+Adhiniyam\b|\bBSA\b/i, act: 'BSA' },
  { re: /\bIndian\s+Penal\s+Code\b|\bIPC\b/i, act: 'IPC' },
  { re: /\bCode\s+of\s+Criminal\s+Procedure\b|\bCr\.?\s*P\.?\s*C\.?\b|\bCrPC\b|\bIRPC\b|\bCRPC\b/i, act: 'CrPC' },
  { re: /\bIndian\s+Evidence\s+Act\b|\bIEA\b/i, act: 'IEA' },
  { re: /\bCode\s+of\s+Civil\s+Procedure\b|\bCPC\b/i, act: 'CPC' },
];

const MAPPING_CUE =
  /\b(replac\w+|equivalent|corresponding|maps?\s+to|now\s+under|under\s+(?:the\s+)?(?:bns|bnss|bsa)|what(?:'s| is) the (?:new |old )?(?:bns|bnss|bsa|ipc|crpc|iea)|old[\s-]?to[\s-]?new|new[\s-]?to[\s-]?old)\b/i;

const OLD_CODE_SECTION =
  /\b(IPC|CrPC|CRPC|IRPC|IEA|Indian Penal Code|Code of Criminal Procedure|Indian Evidence Act)\s*[§.\s#-]*(?:section\s*)?(\d+[A-Za-z]?)\b/i;

export type OldNewMappingRef = {
  fromCode: 'IPC' | 'CrPC' | 'IEA';
  section: string;
};

/** True when the user is asking which new code replaced an old IPC/CrPC/IEA section. */
export function isOldNewMappingQuestion(query: string): boolean {
  const q = String(query || '').trim();
  if (!q) return false;
  if (!MAPPING_CUE.test(q)) return false;
  return parseOldNewMappingReference(q) != null;
}

export function parseOldNewMappingReference(query: string): OldNewMappingRef | null {
  return parseOldNewMappingReferences(query)[0] ?? null;
}

/** Max distinct old-code sections one message may map, matching NYS's own cap. */
const MAX_MAPPING_REFS = 5;

/**
 * NV-STATUTE-MAP-MULTI-001 — every distinct old-code section in the query.
 *
 * The single-reference parser above matched only the first, so
 * "What replaced IPC 302 and IPC 420?" was answered — at zero tokens, so with
 * no model to notice — as though only IPC 302 had been asked about. A silently
 * half-answered question is worse than a slow one.
 */
export function parseOldNewMappingReferences(query: string): OldNewMappingRef[] {
  const q = String(query || '').trim();
  if (!q) return [];
  if (!MAPPING_CUE.test(q)) return [];

  const out: OldNewMappingRef[] = [];
  const seen = new Set<string>();
  for (const m of q.matchAll(new RegExp(OLD_CODE_SECTION.source, 'gi'))) {
    const raw = String(m[1] || '').toUpperCase().replace(/\./g, '').replace(/\s+/g, '');
    const section = String(m[2] || '').toUpperCase();
    if (!section) continue;
    let fromCode: OldNewMappingRef['fromCode'] | null = null;
    if (raw === 'IPC' || raw.includes('PENAL')) fromCode = 'IPC';
    else if (raw === 'IEA' || raw.includes('EVIDENCE')) fromCode = 'IEA';
    else if (raw === 'CRPC' || raw === 'IRPC' || raw.includes('CRIMINAL')) fromCode = 'CrPC';
    if (!fromCode) continue;
    const key = `${fromCode}:${section}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ fromCode, section });
    if (out.length >= MAX_MAPPING_REFS) break;
  }
  return out;
}

/** Mutually exclusive offence families used for conflict detection. */
const OFFENCE_FAMILIES: string[][] = [
  ['murder', 'homicide', 'culpable homicide', 'death', 'kill'],
  ['theft', 'stealing', 'stolen property', 'thief'],
  ['robbery', 'dacoity'],
  ['cheating', 'fraud', 'dishonest'],
  ['rape', 'sexual assault'],
  ['defamation', 'libel', 'slander'],
  ['hurt', 'grievous hurt', 'assault', 'battery'],
  ['kidnapping', 'abduction'],
  ['rioting', 'unlawful assembly'],
  ['criminal breach of trust', 'misappropriation'],
];

export function isStatuteQaGroundingEnabled(): boolean {
  return String(process.env.JRX_STATUTE_QA_GROUNDING ?? '1').trim() !== '0';
}

export function isStatuteQaStrictEnabled(): boolean {
  return String(process.env.JRX_STATUTE_QA_STRICT ?? '1').trim() !== '0';
}

/**
 * Statutes and regulators outside the six core codes. Their presence means the
 * question spans more than one instrument, so a single-section excerpt cannot
 * be a complete answer.
 */
const NON_CORE_INSTRUMENT_RE =
  /\b(PMLA|prevention\s+of\s+money\s+laundering|SEBI|FEMA|GST|companies\s+act|income\s+tax|NDPS|POCSO|UAPA|IBC|insolvency|arbitration\s+and\s+conciliation|RERA|competition\s+act|benami|FERA|customs\s+act|NIA|CGST|SARFAESI|negotiable\s+instruments)\b/i;

/**
 * The question asks for reasoning that a statute excerpt cannot supply —
 * strategy, sequencing, exposure, quantified risk, or cross-proceeding advice.
 */
const BEYOND_SECTION_SCOPE_RE =
  /\b(strateg(?:y|ies)|sequence|sequencing|remed(?:y|ies)|exposure|attachment|limitation|proceeding|parallel|litigat(?:e|ion)|defend|prosecut|quantif|weigh|trade[-\s]?off|option|recommend|approach|plan|risk[s]?\b|likelihood|probabilit|which\s+court|forum|appeal|revision|writ|petition|bail\s+application|multi[-\s]?jurisdiction)\b/i;

/**
 * Verbs that ask for *new text* rather than for a stored provision or authority.
 * Superset of the NYS retrieval router's own `GENERATIVE_HINTS`: NYS returns
 * `llmRequired: false` whenever none of *its* verbs appear, so anything it
 * misses (e.g. "recommend", "compare", "how should I") has to be caught here
 * before a deterministic excerpt is allowed to stand in for an answer.
 */
const GENERATION_REQUESTED_RE =
  /\b(draft|write|prepare|redline|revise|rewrite|summari[sz]e|memo(?:randum)?|opinion|analy[sz]e|analysis|review|advise|advice|argue|argument|recommend|suggest|compare|contrast|how\s+should|what\s+should|help\s+me|craft|compose)\b/i;

/**
 * NV-JRX-LLMREQUIRED-001 — true when the user asked for generated text, so no
 * store-backed excerpt can be a complete answer even if NYS reports
 * `llmRequired: false`.
 */
export function needsGenerationBeyondRetrieval(query: string): boolean {
  const q = String(query || '');
  if (!q) return false;
  return GENERATION_REQUESTED_RE.test(q);
}

/**
 * NV-JRX-LLMREQUIRED-001 — true when the query asks for reasoning or spans an
 * instrument the core-code corpus does not hold, so no stored provision can be
 * a complete answer. Split out of `needsMoreThanOneSection` so the deterministic
 * tier and the statute-FAQ gate share one definition of "out of excerpt scope".
 */
/**
 * NV-QUEEN-EARNED-001 — the question asks whether a provision *applies*, not
 * what it says.
 *
 * This is the NV-STATUTE-FAQ-SCOPE-001 defect in its second disguise, and it is
 * live today. "Is anticipatory bail available for a BNS 103 FIR?" parses one
 * section, is under the length ceiling, names no non-core instrument and uses no
 * generative verb — so `isShortStatuteFaq` and `isDeterministicallySufficient`
 * both accept it and ship the text of BNS 103 (punishment for murder) as the
 * answer to a question about bail entitlement. Zero tokens, wrong answer.
 *
 * Entitlement / eligibility / maintainability / procedure asks all require
 * reasoning *over* a provision, so no stored excerpt can close them. Kept
 * deliberately separate from the offence-content forms the measured fast paths
 * were built for — "what is BNS 103", "what does BNS 103 say", "what replaced
 * IPC 302" — none of which match here.
 */
const APPLICABILITY_ASK_RE =
  /\bavailab\w*|\bapplicab\w*|\bapplies\b|\bapply\b|\bentitle\w*|\beligib\w*|\bmaintainab\w*|\bbarred\b|\bpermissib\w*|\bliable\b|\bliabilit\w*|\bgrounds?\s+for\b|\bdefen[cs]e\b|\bcan\s+(?:i|we|my\s+client|he|she|they|the\s+accused|the\s+petitioner|the\s+applicant)\b|\bdo\s+(?:i|we)\s+(?:need|have)\b|\bwhat\s+are\s+(?:my|our|the)\s+(?:options|rights|remedies|chances|prospects)\b/i;

export function asksApplicabilityBeyondText(query: string): boolean {
  const q = String(query || '');
  if (!q) return false;
  return APPLICABILITY_ASK_RE.test(q);
}

/**
 * A "what changed" ask: how a provision altered the prior legal position. This
 * requires comparing two regimes (and usually the case law under the old one), so
 * a single stored excerpt of the *new* provision is never the answer — which is
 * precisely what the benchmark's `legal-research` prompt received.
 *
 * Kept narrow on purpose: it must not swallow the reverse-mapping fast path
 * ("what replaced IPC 302", "IPC 302 → BNS"), which is a genuine 0-token win.
 * The distinction is that mapping asks *which section*, while these ask *what is
 * different* — so a bare `chang\w*` is not enough and the position/law object is
 * required.
 */
const LEGAL_CHANGE_ASK_RE =
  /\b(?:chang\w*|alter\w*|modif\w*|amend\w*|shift\w*|differ\w*|impact\w*|effect\w*)\b[^.?!]{0,40}\b(?:position|law|legal\s+position|jurisprudence|regime|standard|threshold|test|practice|procedure|entitlement)\b|\b(?:position|law|regime)\b[^.?!]{0,30}\b(?:before\s+and\s+after|post|under\s+the\s+new)\b/i;

/**
 * NV-DETERMINISTIC-OVERFIRE-001 — the question asks for *authority* (judgments,
 * precedent, how the courts have read a provision), not for the provision's text.
 *
 * Measured on the frozen benchmark set (2026-08-16, `.local/benchmarks/`): the
 * prompt "Summarise the leading Supreme Court authorities on anticipatory bail in
 * economic offences and how BNSS 482 changed the position" was answered by the
 * deterministic tier with a **BNSS 482 statutory excerpt and no case law** — 0
 * completions, 732 chars against direct's 2,982. The harness scored that as a
 * 100 % cost saving on a class carrying 0.20 traffic weight, which is how a
 * quality defect came to look like the MOAT working.
 *
 * A stored provision can never close an authority ask: the corpus holds statutory
 * text, not holdings. Deliberately separate from `BEYOND_SECTION_SCOPE_RE`
 * (strategy/remedy shapes) because "leading judgments on X" asks for neither
 * strategy nor generated text — it asks for case law we must retrieve or reason
 * to, and it matched none of the existing predicates.
 */
const AUTHORITY_ASK_RE =
  /\b(case\s*law|precedent(?:s|ial)?|authorit(?:y|ies)|judgments?|judgements?|rulings?|decisions?\s+(?:of|by|on)|leading\s+cases?|landmark|settled\s+law|position\s+of\s+law|jurisprudence|ratio\s+decidendi|held\s+(?:that|in)|as\s+(?:held|interpreted)|judicial\s+(?:interpretation|trend)|supreme\s+court\s+(?:has|have|on)|high\s+court\s+(?:has|have|on))\b/i;

export function asksForAuthorityBeyondText(query: string): boolean {
  const q = String(query || '');
  if (!q) return false;
  return AUTHORITY_ASK_RE.test(q) || LEGAL_CHANGE_ASK_RE.test(q);
}

/**
 * NV-JRX-LLMREQUIRED-001 / NV-DETERMINISTIC-OVERFIRE-001.
 *
 * The single definition of "no stored excerpt can answer this", shared by the
 * deterministic tier and the statute-FAQ gate.
 *
 * `GENERATION_REQUESTED_RE` was **missing** from this disjunction, which is the
 * root cause of the over-fire above: `needsGenerationBeyondRetrieval` correctly
 * returned `true` for "Summarise …", but this gate never consulted it, so the
 * caller saw `false` and shipped a statute excerpt. Verified by probe — the three
 * research-shaped prompts that failed live all returned `false` here while
 * `needsGenerationBeyondRetrieval` returned `true`.
 */
export function needsReasoningBeyondStoredText(query: string): boolean {
  const q = String(query || '');
  if (!q) return false;
  return (
    NON_CORE_INSTRUMENT_RE.test(q)
    || BEYOND_SECTION_SCOPE_RE.test(q)
    || APPLICABILITY_ASK_RE.test(q)
    || AUTHORITY_ASK_RE.test(q)
    || LEGAL_CHANGE_ASK_RE.test(q)
    || GENERATION_REQUESTED_RE.test(q)
  );
}

/**
 * The two halves of `needsReasoningBeyondStoredText`, exposed separately.
 *
 * The combined predicate is the right question for "may a stored excerpt stand
 * in for an answer" but the wrong one for "does this request need a swarm":
 * NV-QUEEN-EARNED-001 has to weigh *how many* instruments are in play against
 * *what kind* of reasoning is asked for, and the boolean OR destroys that
 * distinction. One definition, three consumers — NV-NO-DUPLICATE-001.
 */
export function listNonCoreInstruments(query: string): string[] {
  const q = String(query || '');
  if (!q) return [];
  const out = new Set<string>();
  for (const m of q.matchAll(new RegExp(NON_CORE_INSTRUMENT_RE.source, 'gi'))) {
    const hit = String(m[0] || '').toLowerCase().replace(/\s+/g, ' ').trim();
    if (hit) out.add(hit);
  }
  return [...out];
}

/** Strategy / sequencing / exposure / forum asks — reasoning, not retrieval. */
export function asksBeyondSectionScope(query: string): boolean {
  const q = String(query || '');
  if (!q) return false;
  return BEYOND_SECTION_SCOPE_RE.test(q);
}

/** Every distinct core-code section reference ("BNSS 482", "BNS §318"). */
export function listCoreSectionRefs(query: string): string[] {
  const q = String(query || '');
  if (!q) return [];
  const refs = q.match(/\b(?:BNS|BNSS|BSA|IPC|CrPC|IEA|CPC)\s*[§.\s#-]*\d+[A-Za-z]?\b/gi) || [];
  return [...new Set(refs.map((s) => s.replace(/\s+/g, '').toUpperCase()))];
}

/**
 * Section references (BNS 103, s. 482 BNSS) and Indian reporter / neutral
 * citations ((2024) 1 SCC 1, AIR 2020 SC 15, CNRs) — the anchors on which every
 * closed-form NYS intent depends. Without one of them, NYS's `statute` /
 * `case-search` branches return ranked retrieval rather than an answer.
 *
 * Lives here rather than in `jrx-nys-deterministic-answer.ts` because both the
 * deterministic tier and the Queen admission gate need the same anchor test,
 * and the gate must stay free of the NYS HTTP client.
 */
const HAS_SECTION_OR_CITATION_RE =
  /\b(?:BNS|BNSS|BSA|IPC|CrPC|CRPC|IRPC|IEA|CPC)\s*[§.\s#-]*(?:section\s*)?\d+[A-Za-z]?\b|\bsection\s+\d+[A-Za-z]?\b|\(\s*\d{4}\s*\)\s*\d+\s*[A-Z]{2,}\s*\d+|\bAIR\s+\d{4}\b|\b\d{4}\s+SCC\s+(?:OnLine\s+)?\d+|\b[A-Z]{4}\d{6}\d{4}\d{5}\b/i;

export function hasStatuteOrCitationAnchor(query: string): boolean {
  const q = String(query || '').trim();
  if (!q) return false;
  return HAS_SECTION_OR_CITATION_RE.test(q);
}

/**
 * NV-STATUTE-FAQ-SCOPE-001 — true when the query needs more than one section's
 * text, so the strict statute-FAQ rewrite must NOT discard the model's answer.
 *
 * Measured defect this guards against: a 208-char litigation-strategy prompt
 * ("anticipatory bail under BNSS 482, PMLA attachment exposure, and parallel
 * SEBI proceedings") satisfied every old condition — under 280 chars, parsed a
 * section reference, matched none of the excluded keywords — so the Queen's
 * multi-agent answer was replaced by a 732-char BNSS 482 excerpt after we had
 * already paid for up to 5 completions.
 */
export function needsMoreThanOneSection(query: string): boolean {
  const q = String(query || '');
  if (!q) return false;
  if (needsReasoningBeyondStoredText(q)) return true;
  // Two or more distinct core-code sections ("BNSS 482 and BNS 318") likewise
  // cannot be answered by one excerpt.
  return listCoreSectionRefs(q).length > 1;
}

/**
 * Short section FAQ suitable for specialist-only path (skip multi-agent synthesis waffle).
 * Excludes comparative / advisory prompts that still need Queen depth.
 */
export function isShortStatuteFaq(query: string): boolean {
  const q = String(query || '').trim();
  if (!q || q.length > 280) return false;
  if (isOldNewMappingQuestion(q)) return true;
  if (!parseStatuteReference(q)) return false;
  if (/\b(case\s*law|precedent|amendment|history|hypothetical|draft|advise my client)\b/i.test(q)) {
    return false;
  }
  if (/\bcompare\b/i.test(q) && !isOldNewMappingQuestion(q)) {
    return false;
  }
  // NV-STATUTE-FAQ-SCOPE-001 — a section reference inside a multi-issue or
  // strategy question does not make the question a section FAQ.
  if (needsMoreThanOneSection(q)) return false;
  return true;
}

/**
 * Parse a natural-language statute FAQ into act + section.
 * Returns null when the query is not a section-looking FAQ.
 */
export function parseStatuteReference(query: string): StatuteRef | null {
  const q = String(query || '').trim();
  if (!q || q.length > 600) return null;

  const patterns: RegExp[] = [
    /\b(BNS|BNSS|BSA|IPC|CrPC|IEA|CPC)\s*[§.\s#-]*(\d+[A-Za-z]?)\b/i,
    /\b(BNS|BNSS|BSA|IPC|CrPC|IEA|CPC)\s+Section\s+(\d+[A-Za-z]?)\b/i,
    /\bSection\s+(\d+[A-Za-z]?)\s+of\s+(?:the\s+)?(Bharatiya\s+Nyaya\s+Sanhita|Bharatiya\s+Nagarik\s+Suraksha\s+Sanhita|Bharatiya\s+Sakshya\s+Adhiniyam|Indian\s+Penal\s+Code|BNS|BNSS|BSA|IPC|CrPC)\b/i,
    /\b(?:what|explain|define|describe|punish(?:ment|es)?|offence|offense).{0,80}?\bSection\s+(\d+[A-Za-z]?)\b.{0,60}?\b(Bharatiya\s+Nyaya\s+Sanhita|BNS|BNSS|BSA|IPC)\b/i,
    /\b(?:what|explain|define|describe).{0,40}?\b(BNS|BNSS|BSA|IPC)\s*(?:Section\s*)?(\d+[A-Za-z]?)\b/i,
  ];

  for (const re of patterns) {
    const m = q.match(re);
    if (!m) continue;
    let actRaw = '';
    let section = '';
    if (/^\d/.test(m[1] || '')) {
      section = m[1];
      actRaw = m[2] || '';
    } else if (/^\d/.test(m[2] || '')) {
      actRaw = m[1] || '';
      section = m[2];
    } else {
      continue;
    }
    const act = normalizeAct(actRaw);
    if (act && section) return { act, section: section.toUpperCase() };
  }

  // "Section 103 … Bharatiya Nyaya Sanhita" with distant act mention
  const secOnly = q.match(/\bSection\s+(\d+[A-Za-z]?)\b/i);
  if (secOnly) {
    for (const { re, act } of ACT_ALIASES) {
      if (re.test(q)) return { act, section: secOnly[1].toUpperCase() };
    }
  }
  return null;
}

function normalizeAct(raw: string): string {
  const s = String(raw || '').trim();
  if (!s) return '';
  for (const { re, act } of ACT_ALIASES) {
    if (re.test(s)) return act;
  }
  return s.toUpperCase().replace(/\./g, '').replace(/\s+/g, '');
}

function significantTokens(text: string): string[] {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 3 && !['section', 'punishment', 'punish', 'offence', 'offense', 'under', 'with', 'that', 'this', 'about'].includes(t));
}

function familyIndex(text: string): number {
  const lower = text.toLowerCase();
  for (let i = 0; i < OFFENCE_FAMILIES.length; i++) {
    if (OFFENCE_FAMILIES[i].some((kw) => lower.includes(kw))) return i;
  }
  return -1;
}

/**
 * True when the answer asserts a different offence family than the statute title,
 * or refuses to pick a single grounded offence despite clear authority.
 */
export function answerConflictsWithStatuteTitle(answer: string, sectionTitle: string): boolean {
  const a = String(answer || '');
  const titleFam = familyIndex(sectionTitle);
  const answerFam = familyIndex(a);
  if (titleFam >= 0 && answerFam >= 0 && titleFam !== answerFam) return true;

  // Synthesis waffle: agents disagree / cannot decide — force grounded rewrite.
  if (
    /\birreconcilable\b|\bconflicting (?:claims|evidence|agents)\b|\bcannot be synthesized\b|\bno single,?\s+authoritative answer\b|\bdifferent offences\b|\bcompletely different offences\b/i.test(
      a,
    )
  ) {
    return true;
  }

  const titleTokens = significantTokens(sectionTitle);
  if (titleTokens.length === 0) return false;
  const answerLower = a.toLowerCase();
  const head = answerLower.slice(0, 450);
  const hit = titleTokens.filter((t) => answerLower.includes(t)).length;

  // Title offence family must appear early in a statute FAQ answer.
  if (titleFam >= 0) {
    const headHasTitleFam = OFFENCE_FAMILIES[titleFam].some((kw) => head.includes(kw));
    if (!headHasTitleFam) return true;
  }

  // Title has distinctive tokens but answer shares none → weak grounding
  if (titleTokens.length >= 1 && hit === 0 && answerLower.length > 80) {
    return titleFam >= 0;
  }
  return false;
}

function buildMappingAnswer(opts: {
  fromCode: string;
  fromSection: string;
  fromHeading?: string;
  fromText?: string;
  toCode: string;
  toSection: string;
  toHeading?: string;
  toText?: string;
  changeNotes?: string | null;
}): string {
  const fromLabel = `${opts.fromCode} § ${opts.fromSection}`;
  const lines = [
    `## ${fromLabel} → ${opts.toCode} § ${opts.toSection}`,
    '',
    `**${opts.fromCode} ${opts.fromSection}** (${opts.fromHeading || 'repealed'}) is replaced by **${opts.toCode} ${opts.toSection}** (${opts.toHeading || 'in force'}).`,
  ];
  if (opts.changeNotes) {
    lines.push('', `**What changed:** ${opts.changeNotes}`);
  }
  if (opts.toText) {
    lines.push('', `### ${opts.toCode} ${opts.toSection} — ${opts.toHeading || ''}`.trim(), '', String(opts.toText).slice(0, 1400));
  }
  if (opts.fromText) {
    lines.push('', `### ${opts.fromCode} ${opts.fromSection} (repealed) — ${opts.fromHeading || ''}`.trim(), '', String(opts.fromText).slice(0, 800));
  }
  lines.push(
    '',
    '---',
    '*Grounded from the official NCRB Sankalan mapping via NyayaSearch (no LLM). Verify against the gazette text before filing.*',
  );
  return lines.join('\n');
}

type SingleMapping = { content: string; fromCode: string; toCode: string; toSection: string };

/**
 * Resolve one old→new mapping. Distinguishes the three outcomes the caller must
 * treat differently: a mapping, an authoritative "no such mapping", and a NYS
 * transport failure (where claiming "no mapping" would be a fabrication).
 */
async function resolveOneMapping(
  ref: OldNewMappingRef,
): Promise<
  | { kind: 'mapped'; mapping: SingleMapping }
  | { kind: 'unmapped' }
  | { kind: 'unavailable' }
> {
  const { nysCompareOldNew } = await import('./jrx-nys-knowledge-retriever.js');
  const raw = await nysCompareOldNew({ fromCode: ref.fromCode, section: ref.section });
  const data = (raw && typeof raw === 'object' ? raw : null) as Record<string, unknown> | null;
  if (!data) return { kind: 'unavailable' };
  if (data.found !== true) return { kind: 'unmapped' };

  if (ref.fromCode === 'IPC') {
    const ipc = (data.ipc || {}) as Record<string, unknown>;
    const bnsMatches = Array.isArray(data.bnsMatches) ? (data.bnsMatches as Record<string, unknown>[]) : [];
    const bns = bnsMatches[0];
    if (!bns) return { kind: 'unmapped' };
    const toSection = String(bns.section || (Array.isArray(ipc.mappedSections) ? ipc.mappedSections[0] : '') || '');
    if (!toSection) return { kind: 'unmapped' };
    return {
      kind: 'mapped',
      mapping: {
        content: buildMappingAnswer({
          fromCode: 'IPC',
          fromSection: String(ipc.section || ref.section),
          fromHeading: String(ipc.heading || ipc.sectionTitle || ''),
          fromText: String(ipc.text || ''),
          toCode: 'BNS',
          toSection,
          toHeading: String(bns.heading || ''),
          toText: String(bns.text || ''),
          changeNotes: data.changeNotes != null ? String(data.changeNotes) : null,
        }),
        fromCode: 'IPC',
        toCode: 'BNS',
        toSection,
      },
    };
  }

  const matches = Array.isArray(data.matches) ? (data.matches as Record<string, unknown>[]) : [];
  const row = matches[0];
  if (!row) return { kind: 'unmapped' };
  const toCode = String(data.newCode || row.code || (ref.fromCode === 'CrPC' ? 'BNSS' : 'BSA'));
  const toSection = String(row.section || '');
  if (!toSection) return { kind: 'unmapped' };
  return {
    kind: 'mapped',
    mapping: {
      content: buildMappingAnswer({
        fromCode: ref.fromCode,
        fromSection: ref.section,
        toCode,
        toSection,
        toHeading: String(row.heading || ''),
        toText: String(row.text || ''),
      }),
      fromCode: ref.fromCode,
      toCode,
      toSection,
    },
  };
}

/**
 * Deterministic IPC/CrPC/IEA → BNS/BNSS/BSA answer. Returns null when this is
 * not a mapping question or NYS has no row — never throws.
 *
 * NV-STATUTE-MAP-MULTI-001 — answers *every* old-code section in the query, not
 * just the first. `fromCode`/`toCode`/`toSection` continue to describe the first
 * resolved mapping so existing call sites are unaffected.
 */
export async function tryStatuteMappingFastPath(
  query: string,
): Promise<
  { content: string; fromCode: string; toCode: string; toSection: string; mappedCount?: number } | null
> {
  const refs = parseOldNewMappingReferences(query);
  if (refs.length === 0) return null;
  try {
    const results = await Promise.all(refs.map((ref) => resolveOneMapping(ref)));

    // A partial answer built on an outage would read as "no such mapping" — an
    // assertion we have no basis for. Defer to the model path instead.
    if (results.some((r) => r.kind === 'unavailable')) return null;

    const mapped: SingleMapping[] = [];
    const unmapped: OldNewMappingRef[] = [];
    results.forEach((r, i) => {
      if (r.kind === 'mapped') mapped.push(r.mapping);
      else unmapped.push(refs[i]);
    });
    if (mapped.length === 0) return null;

    if (refs.length === 1) {
      return { ...mapped[0], mappedCount: 1 };
    }

    const asked = refs.map((r) => `${r.fromCode} ${r.section}`).join(', ');
    const sections = [
      `# Old → new code mapping (${asked})`,
      '',
      ...mapped.map((m) => m.content),
    ];
    if (unmapped.length > 0) {
      sections.push(
        '',
        '---',
        `**No official mapping row found for:** ${unmapped.map((r) => `${r.fromCode} ${r.section}`).join(', ')}. ` +
          'Confirm the section number against the gazette — the Sankalan table has no entry for it.',
      );
    }
    return {
      content: sections.join('\n\n'),
      fromCode: mapped[0].fromCode,
      toCode: mapped[0].toCode,
      toSection: mapped[0].toSection,
      mappedCount: mapped.length,
    };
  } catch (e: any) {
    logger.warn('statute_mapping_fastpath_failed', { err: e?.message, refs });
    return null;
  }
}

/**
 * Single formatter for a one-section grounded answer. Exported so the
 * deterministic tier renders JRX-sourced statute rows in exactly this shape —
 * NV-NO-DUPLICATE-001: one statute answer format, not one per entry point.
 */
export function buildStatuteGroundedAnswer(auth: StatuteAuthority, jurisdiction: string): string {
  const act = auth.act_short_title || 'Statute';
  const sec = auth.section_number;
  const title = auth.section_title || '(title unavailable)';
  const preview = String(auth.section_text || auth.section_preview || '').trim().slice(0, 1200);
  const jur = (jurisdiction || auth.jurisdiction || 'IN').toUpperCase();
  const lines = [
    `## ${act} Section ${sec} — ${title}`,
    '',
    `**Jurisdiction:** ${jur}`,
    '',
    `Section **${sec}** of the **${auth.act_title || act}** addresses **${title}**.`,
  ];
  if (preview) {
    lines.push('', '### Statutory text (excerpt)', '', preview);
  }
  lines.push(
    '',
    '---',
    '*Grounded from primary statute corpus (NV-STATUTE-QA-GROUND-001). Verify against the official gazette text before filing or advising.*',
  );
  return lines.join('\n');
}

export async function resolveStatuteAuthority(
  query: string,
  jurisdiction = 'IN',
): Promise<StatuteAuthority | null> {
  const ref = parseStatuteReference(query);
  if (!ref) return null;

  try {
    const { searchStatutes, lookupStatuteSection } = await import('./jrx-statute-seeding-service.js');
    const hit = await lookupStatuteSection(ref.act, ref.section, jurisdiction.toUpperCase());
    if (hit) {
      return {
        act_short_title: hit.act_short_title || ref.act,
        act_title: hit.act_title,
        section_number: hit.section_number || ref.section,
        section_title: hit.section_title || '',
        section_preview: String(hit.section_text || '').slice(0, 500),
        section_text: hit.section_text,
        jurisdiction: hit.jurisdiction || jurisdiction,
        matchType: 'lookup',
      };
    }
    const rows = await searchStatutes(`${ref.act} ${ref.section}`, jurisdiction, undefined, 3);
    const best = rows?.[0];
    if (best) {
      return {
        act_short_title: best.act_short_title || ref.act,
        act_title: best.act_title,
        section_number: best.section_number || ref.section,
        section_title: best.section_title || '',
        section_preview: best.section_preview,
        section_text: best.section_text,
        jurisdiction: best.jurisdiction || jurisdiction,
        matchType: best.matchType || 'search',
      };
    }
  } catch (e: any) {
    logger.warn('local_statute_resolve_failed', { err: e?.message, ref });
  }

  // NYS plane fallback (India-first)
  try {
    const { nysKnowledgeRequest } = await import('./jrx-nys-knowledge-client.js');
    const statuteRes = await nysKnowledgeRequest<{ results?: any[] }>({
      method: 'GET',
      path: '/statutes/search',
      query: { q: `${ref.act} ${ref.section}`, jurisdiction: 'IN', limit: 5 },
    });
    if (statuteRes.ok && Array.isArray(statuteRes.data?.results) && statuteRes.data!.results!.length > 0) {
      // NYS /statutes/search returns heading/section/code (not sectionTitle/sectionNumber).
      const s = statuteRes.data!.results![0];
      return {
        act_short_title: s.actShortTitle || s.act_short_title || s.code || s.act || ref.act,
        act_title: s.actTitle || s.act_title || s.actName || s.act_name,
        section_number: String(s.sectionNumber || s.section_number || s.section || ref.section),
        section_title: s.sectionTitle || s.section_title || s.heading || s.title || '',
        section_preview: String(s.text || s.section_text || s.preview || s.excerpt || '').slice(0, 500),
        section_text: s.text || s.section_text || s.excerpt,
        jurisdiction: 'IN',
        matchType: 'nys',
      };
    }
  } catch (e: any) {
    logger.warn('nys_statute_resolve_failed', { err: e?.message, ref });
  }

  return null;
}

/** Context block to prepend into the LLM prompt for statute FAQs. */
export function formatStatuteContextBlock(auth: StatuteAuthority): string {
  const preview = String(auth.section_text || auth.section_preview || '').slice(0, 900);
  return [
    '[Grounded Statute Authority — answer MUST match this section title and text]',
    `Act: ${auth.act_short_title}${auth.act_title ? ` (${auth.act_title})` : ''}`,
    `Section: ${auth.section_number}`,
    `Title: ${auth.section_title}`,
    preview ? `Text excerpt:\n${preview}` : '',
    'If your prior knowledge conflicts with the title above, prefer the title and excerpt.',
  ].filter(Boolean).join('\n');
}

/**
 * NV-STATUTE-FAQ-PRELLM-001 — resolve a strict single-section FAQ *before* any
 * model call.
 *
 * Measured waste: "What does BNSS 482 say?" billed **two** provider completions
 * (1,350 output tokens), and the post-LLM strict gate then discarded 100% of
 * that output and shipped a 732-char deterministic excerpt instead. The excerpt
 * is the answer we want — but there is no reason to pay an LLM to produce text
 * we always throw away.
 *
 * Returns the grounded answer when the query is a strict statute FAQ and the
 * authority lookup succeeds, else null (normal LLM path).
 */
const STATUTE_SECTION_MENTION_RE =
  /\b(?:IPC|BNS|BNSS|BSA|Cr\.?\s*P\.?\s*C\.?|CPC|section|s\.|sec\.)\s*\d+[A-Za-z]?/i;

/** True when a chat query references a statute section (IPC/BNSS/BNS etc.). */
export function queryMentionsStatuteSection(query: string): boolean {
  const q = String(query || '');
  if (!q.trim()) return false;
  return !!parseStatuteReference(q) || STATUTE_SECTION_MENTION_RE.test(q);
}

/**
 * NV-CHAT-FAST-STATUTE-PREFETCH-001 — lightweight NYS/local statute prefetch
 * for doc-less legal-chat-fast when the query names a section. Bounded timeout
 * keeps SLA; returns a prompt context block, not a full answer replacement.
 */
export async function tryStatutePrefetchLightweight(
  query: string,
  jurisdiction = 'IN',
  timeoutMs = 1800,
): Promise<string | null> {
  if (!isStatuteQaGroundingEnabled()) return null;
  if (!queryMentionsStatuteSection(query)) return null;
  if (needsGenerationBeyondRetrieval(query)) return null;
  if (isOldNewMappingQuestion(query)) return null;

  const jur = jurisdiction.toUpperCase();
  try {
    const auth = await Promise.race([
      resolveStatuteAuthority(query, jur),
      new Promise<null>((resolve) => {
        setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
    if (!auth?.section_title) return null;
    return formatStatuteContextBlock(auth);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.warn('statute_prefetch_lightweight_failed', { err: msg });
    return null;
  }
}

export async function tryStatuteFaqFastPath(
  query: string,
  jurisdiction?: string,
): Promise<{ content: string; statute: StatuteAuthority } | null> {
  if (!isStatuteQaGroundingEnabled()) return null;
  if (!isStatuteQaStrictEnabled()) return null;
  if (!isShortStatuteFaq(query)) return null;
  // Mapping questions have their own fast path and answer shape.
  if (isOldNewMappingQuestion(query)) return null;
  if (!parseStatuteReference(query)) return null;

  const jur = (jurisdiction || 'IN').toUpperCase();
  try {
    const auth = await resolveStatuteAuthority(query, jur);
    if (!auth || !auth.section_title) return null;
    return { content: buildStatuteGroundedAnswer(auth, jur), statute: auth };
  } catch {
    return null;
  }
}

/**
 * Post-LLM gate: if the query is a statute FAQ and the answer conflicts with
 * the retrieved section title, replace with a grounded answer.
 */
export async function applyStatuteQaGroundingGate(opts: {
  query: string;
  answer: string;
  jurisdiction?: string;
  authority?: StatuteAuthority | null;
}): Promise<StatuteQaGroundingResult> {
  if (!isStatuteQaGroundingEnabled()) {
    return { content: opts.answer, applied: false, corrected: false, reason: 'disabled' };
  }

  // NV-DRAFT-STATUTE-GATE-001 — drafting / analysis / memo asks must never be
  // replaced by a statute excerpt. Measured on jrx-staging (2026-08-21): counsel-grade
  // draft-fast + legal-draft both returned identical ~1045-char grounded stubs
  // (zero pleading structure) after Opus env deploy — the post-LLM gate was
  // discarding full model output whenever a section mention triggered conflict
  // rewrite, and the pre-LLM fast paths share the same scope blind spot.
  if (needsGenerationBeyondRetrieval(opts.query || '')) {
    return {
      content: opts.answer,
      applied: false,
      corrected: false,
      reason: 'generation_requested',
    };
  }

  const mapped = await tryStatuteMappingFastPath(opts.query);
  if (mapped?.content) {
    return {
      content: mapped.content,
      applied: true,
      corrected: true,
      reason: 'old_new_mapping',
      statute: {
        act_short_title: mapped.toCode,
        section_number: mapped.toSection,
        section_title: mapped.toCode,
      },
    };
  }
  const ref = parseStatuteReference(opts.query);
  if (!ref) {
    return { content: opts.answer, applied: false, corrected: false, reason: 'not_statute_qa' };
  }

  const jur = (opts.jurisdiction || 'IN').toUpperCase();
  const auth = opts.authority ?? (await resolveStatuteAuthority(opts.query, jur));
  if (!auth || !auth.section_title) {
    return { content: opts.answer, applied: true, corrected: false, reason: 'authority_miss', statute: auth || undefined };
  }

  const conflicts = answerConflictsWithStatuteTitle(opts.answer, auth.section_title);
  const strictFaq = isStatuteQaStrictEnabled() && isShortStatuteFaq(opts.query || '');

  if (strictFaq || conflicts) {
    // NV-STATUTE-FAQ-SCOPE-001 — for multi-issue questions the excerpt is a
    // correction to one part of the answer, not a replacement for all of it.
    // Discarding a synthesised multi-agent answer here means we paid for the
    // reasoning and then shipped boilerplate.
    if (conflicts && !strictFaq && needsMoreThanOneSection(opts.query || '')) {
      logger.warn('statute_qa_conflict_annotated', {
        act: auth.act_short_title,
        section: auth.section_number,
        title: auth.section_title,
        reason: 'multi_issue_answer_preserved',
        answerChars: String(opts.answer).length,
      });
      return {
        content: `${buildStatuteGroundedAnswer(auth, jur).trim()}\n\n---\n\n${String(opts.answer).trim()}`,
        applied: true,
        corrected: false,
        statute: auth,
        reason: 'multi_issue_authority_prepended',
      };
    }
    logger.warn('statute_qa_conflict_corrected', {
      act: auth.act_short_title,
      section: auth.section_number,
      title: auth.section_title,
      reason: strictFaq && !conflicts ? 'strict_statute_faq' : 'conflict_rewritten',
      answerPreview: String(opts.answer).slice(0, 120),
    });
    return {
      content: buildStatuteGroundedAnswer(auth, jur),
      applied: true,
      corrected: true,
      statute: auth,
      reason: strictFaq && !conflicts ? 'strict_statute_faq' : 'conflict_rewritten',
    };
  }

  // Soft reinforce: ensure title appears once if missing
  const titleTok = significantTokens(auth.section_title)[0];
  if (titleTok && !String(opts.answer).toLowerCase().includes(titleTok) && String(opts.answer).length < 2000) {
    const reinforced = `${opts.answer.trim()}\n\n> **Authority:** ${auth.act_short_title} §${auth.section_number} — ${auth.section_title}.`;
    return { content: reinforced, applied: true, corrected: false, statute: auth, reason: 'title_footnote' };
  }
  return { content: opts.answer, applied: true, corrected: false, statute: auth, reason: 'aligned' };
}
