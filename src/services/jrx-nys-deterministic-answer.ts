/**
 * NV-JRX-LLMREQUIRED-001 — deterministic answer tier over the NYS knowledge plane.
 *
 * NYS `POST /retrieve` already classifies every query and returns
 * `llmRequired` + `intent` + `reason` + `steps[]` in 47 ms–2 s (measured live).
 * Until this file existed, **nothing in the codebase read `llmRequired`** except
 * a test fixture: Auto-RAG took `.chunks` and dropped the verdict, so a statute
 * lookup NYS had already answered deterministically was re-asked of a frontier
 * model for 33–41 s and 3,442–5,388 prompt tokens.
 *
 * This module turns the verdict into a real, citation-carrying answer rendered
 * from the retrieval steps NYS already returned — zero completions, zero tokens.
 *
 * ── Why `llmRequired: false` is necessary but NOT sufficient ────────────────
 * NYS flags generation only from its own verb list (`draft|write|summarise|
 * analyse|advise|explain why|argue`). A litigation-strategy prompt that names a
 * section but none of those verbs — "optimal approach for anticipatory bail
 * under BNSS 482 given PMLA attachment exposure and parallel SEBI proceedings"
 * — resolves the section, so NYS answers `intent: statute, llmRequired: false`.
 * Trusting that alone would re-create NV-STATUTE-FAQ-SCOPE-001: a 732-char
 * excerpt shipped in place of a multi-issue answer. Every verdict is therefore
 * re-tested locally (`isDeterministicallySufficient`) before it can stand in for
 * an answer, and the intent must be one whose answer is *closed-form*.
 *
 * Escape hatch: JRX_JRX_ECOSYSTEM_DETERMINISTIC_ANSWER=0.
 */
import { createLogger } from '../utils/logger.js';
import { isJrxFeatureOn } from '../config/jrx-feature-flags.js';
import { isNysKnowledgeConfigured, nysKnowledgeRequest } from './jrx-nys-knowledge-client.js';
import {
  buildStatuteGroundedAnswer,
  hasStatuteOrCitationAnchor,
  needsGenerationBeyondRetrieval,
  needsReasoningBeyondStoredText,
  parseStatuteReference,
  type StatuteAuthority,
} from './jrx-statute-qa-grounding.js';

const logger = createLogger('./jrx-nys-deterministic-answer');

/** NYS intents whose answer is fully determined by stored rows. */
export type DeterministicIntent =
  | 'statute'
  | 'citation'
  | 'ipc-bns-compare'
  | 'old-new-compare'
  | 'new-old-compare';

export type DeterministicResolverId =
  | 'nys-statute-section'
  | 'nys-citation-resolve'
  | 'nys-code-compare';

export interface DeterministicCitation {
  kind: 'statute' | 'case';
  /** Pin-cite as a practitioner would write it: "BNS §103", "(2024) 1 SCC 1". */
  ref: string;
  title?: string;
  court?: string;
  year?: number;
  url?: string;
}

export interface DeterministicAnswer {
  content: string;
  citations: DeterministicCitation[];
  /** Reported as the response `model` so a zero-token answer is auditable. */
  resolver: DeterministicResolverId;
  intent: DeterministicIntent;
  /** NYS's own justification, carried through for the audit trail. */
  nysReason?: string;
}

/** Minimal render-time view of the NYS RetrievalPlan. */
interface NysStatuteRow {
  code?: string;
  section?: string;
  heading?: string;
  title?: string;
  text?: string;
  actName?: string;
  mappedCode?: string | null;
  mappedSections?: string[];
  changeNotes?: string | null;
  jurisdiction?: string;
}

interface NysCaseRow {
  title?: string;
  citation?: string | null;
  court?: string | null;
  year?: number | null;
  cnr?: string | null;
  url?: string | null;
  description?: string | null;
  decisionDate?: string | null;
}

interface NysPlanStep {
  tool?: string;
  statutes?: NysStatuteRow[];
  citations?: Array<{ raw?: string; normalized?: string; matches?: NysCaseRow[] }>;
  matches?: NysCaseRow[];
  comparison?: {
    ipcSection?: string;
    found?: boolean;
    ipc?: NysStatuteRow | null;
    bnsMatches?: NysStatuteRow[];
    changeNotes?: string | null;
  };
  oldNew?: {
    oldCode?: string;
    newCode?: string;
    oldSection?: string;
    found?: boolean;
    matches?: NysStatuteRow[];
  };
  newOld?: {
    newCode?: string;
    oldCode?: string;
    newSection?: string;
    found?: boolean;
    statute?: NysStatuteRow | null;
    oldSections?: string[];
    matches?: NysStatuteRow[];
  };
}

export interface NysDeterministicPlan {
  query?: string;
  intent?: string;
  llmRequired?: boolean;
  reason?: string;
  steps?: NysPlanStep[];
}

export function isNysDeterministicAnswerEnabled(): boolean {
  return String(process.env.JRX_JRX_ECOSYSTEM_DETERMINISTIC_ANSWER ?? '1').trim() !== '0';
}

/**
 * A bare lookup is short. Multi-issue prompts are not — the measured
 * NV-STATUTE-FAQ-SCOPE-001 regression was 208 chars, so this ceiling sits below
 * the length at which a single stored provision stops being a whole answer.
 * Kept tunable because corpora and query mixes differ per deployment.
 */
function maxDeterministicQueryChars(): number {
  const n = Number(process.env.JRX_JRX_ECOSYSTEM_DETERMINISTIC_MAX_CHARS ?? '240');
  return Number.isFinite(n) && n >= 40 ? Math.min(600, Math.floor(n)) : 240;
}

const DETERMINISTIC_INTENTS: readonly string[] = [
  'statute',
  'citation',
  'ipc-bns-compare',
  'old-new-compare',
  'new-old-compare',
];

export interface ScopeVerdict {
  sufficient: boolean;
  reason: string;
}

/**
 * NV-JRX-LLMREQUIRED-001 scope gate. Runs *in addition to* NYS's own
 * `llmRequired` verdict; both must agree before a stored-text answer ships.
 */
export function isDeterministicallySufficient(query: string, intent: string): ScopeVerdict {
  const q = String(query || '').trim();
  if (!q) return { sufficient: false, reason: 'empty_query' };

  if (!DETERMINISTIC_INTENTS.includes(intent)) {
    // `case-search` is deliberately excluded: NYS reports llmRequired:false for
    // any query whose corpus search returned rows, including substantive
    // questions where a ranked list of authorities is grounding, not an answer.
    return { sufficient: false, reason: `intent_not_closed_form:${intent || 'unknown'}` };
  }

  if (q.length > maxDeterministicQueryChars()) {
    return { sufficient: false, reason: 'query_longer_than_a_lookup' };
  }

  if (needsGenerationBeyondRetrieval(q)) {
    return { sufficient: false, reason: 'generation_requested' };
  }

  // NV-STATUTE-FAQ-SCOPE-001 — strategy / sequencing / exposure asks, and
  // instruments outside the six core codes, cannot be answered from one or two
  // stored provisions no matter what the section parser finds.
  if (needsReasoningBeyondStoredText(q)) {
    return { sufficient: false, reason: 'reasoning_beyond_stored_text' };
  }

  if (intent === 'statute' && !parseStatuteReference(q)) {
    // NYS also labels its *hybrid top-k* branch `intent: statute` — a query that
    // merely mentions a code, with no section, answered by five ranked rows.
    // That is retrieval, not an answer.
    return { sufficient: false, reason: 'statute_intent_without_exact_section' };
  }

  return { sufficient: true, reason: `closed_form:${intent}` };
}

function statuteRef(row: NysStatuteRow): string {
  const code = String(row.code || '').trim();
  const section = String(row.section || '').trim();
  if (code && section) return `${code} §${section}`;
  return code || section || 'Statute';
}

function statuteHeading(row: NysStatuteRow): string {
  return String(row.heading || row.title || '').trim();
}

function toStatuteAuthority(row: NysStatuteRow, jurisdiction: string): StatuteAuthority {
  return {
    act_short_title: String(row.code || 'Statute'),
    act_title: row.actName ? String(row.actName) : undefined,
    section_number: String(row.section || ''),
    section_title: statuteHeading(row),
    section_text: row.text ? String(row.text) : undefined,
    jurisdiction: String(row.jurisdiction || jurisdiction),
    matchType: 'nys-plan',
  };
}

function caseCitation(row: NysCaseRow): DeterministicCitation {
  const ref = String(row.citation || row.cnr || row.title || 'Judgment').trim();
  return {
    kind: 'case',
    ref,
    title: row.title ? String(row.title) : undefined,
    court: row.court ? String(row.court) : undefined,
    year: typeof row.year === 'number' ? row.year : undefined,
    url: row.url ? String(row.url) : undefined,
  };
}

const NO_LLM_FOOTER =
  '*Answered from the NyayaSearch primary corpus with no model call ' +
  '(NV-JRX-LLMREQUIRED-001). Verify against the official gazette / reporter text before filing.*';

function renderStatuteAnswer(
  steps: NysPlanStep[],
  jurisdiction: string,
): { content: string; citations: DeterministicCitation[] } | null {
  const rows = steps.flatMap((s) => (s.tool === 'statute-lookup' ? s.statutes ?? [] : []));
  const row = rows.find((r) => statuteHeading(r) && String(r.text || '').trim());
  if (!row) return null;
  return {
    // Same formatter as the shipped statute-FAQ fast path — one answer shape
    // regardless of which entry point resolved the section.
    content: buildStatuteGroundedAnswer(toStatuteAuthority(row, jurisdiction), jurisdiction),
    citations: [{ kind: 'statute', ref: statuteRef(row), title: statuteHeading(row) }],
  };
}

function renderCitationAnswer(
  steps: NysPlanStep[],
): { content: string; citations: DeterministicCitation[] } | null {
  const step = steps.find((s) => s.tool === 'citation-lookup');
  const extracted = step?.citations ?? [];
  if (extracted.length === 0) return null;

  const citations: DeterministicCitation[] = [];
  const lines: string[] = ['## Citation check', ''];
  let anyResolved = false;

  for (const c of extracted) {
    const raw = String(c.normalized || c.raw || '').trim();
    if (!raw) continue;
    const matches = c.matches ?? [];
    if (matches.length === 0) {
      // An unresolved citation is a real, useful answer — it is the signal a
      // practitioner needs before relying on it. Never silently upgrade to a
      // "verified" reading.
      lines.push(`- **${raw}** — **not found** in the NyayaSearch judgment corpus.`);
      continue;
    }
    anyResolved = true;
    const best = matches[0];
    const parts = [
      best.title ? String(best.title) : null,
      best.court ? String(best.court) : null,
      typeof best.year === 'number' ? String(best.year) : null,
    ].filter(Boolean);
    lines.push(`- **${raw}** — **verified**: ${parts.join(' · ') || 'match found'}`);
    if (best.cnr) lines.push(`  - CNR: \`${String(best.cnr)}\``);
    if (best.url) lines.push(`  - Source: ${String(best.url)}`);
    citations.push(caseCitation(best));
  }

  if (lines.length <= 2) return null;
  lines.push('', '---', NO_LLM_FOOTER);
  return {
    content: lines.join('\n'),
    // A "not found" verdict is still a grounded answer; only resolved matches
    // become citations so no caller can cite a citation we failed to verify.
    citations: anyResolved ? citations : [],
  };
}

function renderCompareAnswer(
  steps: NysPlanStep[],
  intent: DeterministicIntent,
): { content: string; citations: DeterministicCitation[] } | null {
  const citations: DeterministicCitation[] = [];
  const lines: string[] = [];

  const pushProvision = (row: NysStatuteRow, label: string) => {
    const heading = statuteHeading(row);
    const text = String(row.text || '').trim();
    citations.push({ kind: 'statute', ref: statuteRef(row), title: heading || undefined });
    lines.push('', `### ${label} — ${statuteRef(row)}${heading ? ` · ${heading}` : ''}`);
    if (text) lines.push('', text.slice(0, 1400));
  };

  if (intent === 'ipc-bns-compare') {
    const cmp = steps.find((s) => s.tool === 'ipc-bns-compare')?.comparison;
    if (!cmp?.found) return null;
    const bns = (cmp.bnsMatches ?? [])[0];
    if (!bns) return null;
    lines.push(
      `## IPC §${cmp.ipcSection} → ${statuteRef(bns)}`,
      '',
      `**IPC ${cmp.ipcSection}** (repealed) is now **${statuteRef(bns)}**${statuteHeading(bns) ? ` — ${statuteHeading(bns)}` : ''}.`,
    );
    if (cmp.changeNotes) lines.push('', `**What changed:** ${String(cmp.changeNotes)}`);
    pushProvision(bns, 'In force');
    if (cmp.ipc) pushProvision(cmp.ipc, 'Repealed');
  } else if (intent === 'old-new-compare') {
    const cmp = steps.find((s) => s.tool === 'old-new-compare')?.oldNew;
    if (!cmp?.found) return null;
    const matches = cmp.matches ?? [];
    if (matches.length === 0) return null;
    const refs = matches.map((m) => statuteRef(m)).join(', ');
    lines.push(
      `## ${cmp.oldCode} §${cmp.oldSection} → ${cmp.newCode}`,
      '',
      `**${cmp.oldCode} ${cmp.oldSection}** (repealed) is replaced by **${refs}**.`,
    );
    for (const m of matches.slice(0, 3)) pushProvision(m, 'In force');
  } else {
    const cmp = steps.find((s) => s.tool === 'new-old-compare')?.newOld;
    if (!cmp?.found) return null;
    const oldRefs = (cmp.oldSections ?? []).filter(Boolean);
    if (oldRefs.length === 0) return null;
    // Direction matters: here the *answer* side is the repealed provision, so
    // the wording must not read as though the new code was replaced.
    lines.push(
      `## ${cmp.newCode} §${cmp.newSection} ← ${cmp.oldCode}`,
      '',
      `**${cmp.newCode} ${cmp.newSection}** re-enacts **${cmp.oldCode} ${oldRefs.join(', ')}** ` +
        `of the repealed ${cmp.oldCode === 'IPC' ? 'Indian Penal Code' : cmp.oldCode === 'IEA' ? 'Indian Evidence Act' : 'Code of Criminal Procedure'}.`,
    );
    if (cmp.statute) pushProvision(cmp.statute, 'In force');
    for (const m of (cmp.matches ?? []).slice(0, 2)) {
      if (cmp.statute && statuteRef(m) === statuteRef(cmp.statute)) continue;
      pushProvision(m, 'In force');
    }
  }

  if (lines.length === 0 || citations.length === 0) return null;
  lines.push('', '---', NO_LLM_FOOTER);
  return { content: lines.join('\n'), citations };
}

/**
 * Render a grounded answer from a NYS RetrievalPlan. Pure — no I/O — so the
 * scope gate and the answer shape are unit-testable without a live NYS.
 *
 * Returns null whenever the plan is not deterministically sufficient; the caller
 * then continues to its normal model path with the plan still usable as RAG
 * grounding.
 */
export function renderDeterministicAnswerFromPlan(
  plan: NysDeterministicPlan | null | undefined,
  opts: { query?: string; jurisdiction?: string } = {},
): DeterministicAnswer | null {
  if (!isNysDeterministicAnswerEnabled()) return null;
  if (!plan || typeof plan !== 'object') return null;
  // NYS asking for a model is authoritative in the restrictive direction.
  if (plan.llmRequired !== false) return null;

  const query = String(opts.query ?? plan.query ?? '');
  const intent = String(plan.intent ?? '');
  const verdict = isDeterministicallySufficient(query, intent);
  if (!verdict.sufficient) {
    logger.info('nys deterministic answer declined', {
      intent: intent || 'unknown',
      reason: verdict.reason,
      queryChars: query.length,
    });
    return null;
  }

  const jurisdiction = String(opts.jurisdiction || 'IN').toUpperCase();
  const steps = Array.isArray(plan.steps) ? plan.steps : [];
  if (steps.length === 0) return null;

  const rendered =
    intent === 'statute'
      ? renderStatuteAnswer(steps, jurisdiction)
      : intent === 'citation'
        ? renderCitationAnswer(steps)
        : renderCompareAnswer(steps, intent as DeterministicIntent);

  if (!rendered || !rendered.content.trim()) return null;

  const resolver: DeterministicResolverId =
    intent === 'statute'
      ? 'nys-statute-section'
      : intent === 'citation'
        ? 'nys-citation-resolve'
        : 'nys-code-compare';

  logger.info('nys deterministic answer served (zero tokens)', {
    intent,
    resolver,
    citations: rendered.citations.length,
    contentChars: rendered.content.length,
  });

  return {
    content: rendered.content,
    citations: rendered.citations,
    resolver,
    intent: intent as DeterministicIntent,
    nysReason: plan.reason ? String(plan.reason) : undefined,
  };
}

/**
 * Zero-cost local pre-filter: could this query *possibly* be answered from
 * stored rows? Pure regex, no I/O.
 *
 * Exists so callers can decide whether the NYS probe is worth a round trip
 * before making one. Drafting, research and strategy prompts — the large
 * majority of traffic — are rejected here and pay nothing.
 */
export function couldBeDeterministic(query: string): boolean {
  const q = String(query || '').trim();
  if (!q) return false;
  if (q.length > maxDeterministicQueryChars()) return false;
  if (needsGenerationBeyondRetrieval(q)) return false;
  if (needsReasoningBeyondStoredText(q)) return false;
  // Every closed-form intent NYS can serve is anchored on an explicit section
  // reference or a recognisable reporter/CNR citation. Without one of those,
  // NYS's `statute`/`case-search` branches are ranked retrieval, not an answer.
  // Shared with the Queen admission gate — one definition of "anchored".
  return hasStatuteOrCitationAnchor(q);
}

/**
 * Fetch a NYS retrieval plan and, when NYS *and* the local scope gate agree an
 * LLM is unnecessary, return the grounded answer. Never throws.
 *
 * Callers that already hold a plan must use `renderDeterministicAnswerFromPlan`
 * instead — NV-NO-DUPLICATE-001: one renderer, and no second NYS round trip.
 */
export async function tryNysDeterministicAnswer(opts: {
  query: string;
  jurisdiction?: string;
  timeoutMs?: number;
}): Promise<DeterministicAnswer | null> {
  if (!isNysDeterministicAnswerEnabled()) return null;
  if (!isJrxFeatureOn('nysKnowledgePlane') || !isNysKnowledgeConfigured()) return null;

  const query = String(opts.query || '').trim();
  if (!query) return null;
  if (!couldBeDeterministic(query)) return null;
  const jurisdiction = String(opts.jurisdiction || 'IN').toUpperCase() === 'US' ? 'US' : 'IN';

  try {
    const res = await nysKnowledgeRequest<NysDeterministicPlan>({
      method: 'POST',
      path: '/retrieve',
      body: { query, jurisdiction },
      timeoutMs: opts.timeoutMs,
      // A deterministic fast path must not out-cost the model call it replaces.
      retries: 0,
    });
    if (res.ok === false) return null;
    return renderDeterministicAnswerFromPlan(res.data, { query, jurisdiction });
  } catch (e) {
    logger.warn('nys deterministic answer probe failed (non-fatal)', {
      error: (e as Error).message,
    });
    return null;
  }
}
