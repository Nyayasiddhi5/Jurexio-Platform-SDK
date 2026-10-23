/**
 * NV-GOOD-LAW-PANEL-001 — client projection of
 * `GET /api/jrx/knowledge/caselaw/treatment`.
 *
 * Source of truth for the wire shape: `src/routes/jrx-knowledge-plane-routes.ts`
 * (`/caselaw/treatment`) over `src/services/jrx-citator-treatment.ts`.
 *
 * Pure on purpose — the four honesty rules below are decisions about meaning,
 * not about pixels, so they are unit-testable and mutation-testable without a
 * DOM:
 *
 *  1. `good` is UNREACHABLE by construction upstream. `detectNegativeTreatment`
 *     can only ever emit `overruled | doubted | unknown`, because absence of
 *     adverse language in ~20 retrieved passages is evidence that we did not
 *     find anything, not evidence that an authority is safe. This module
 *     therefore has no affirmative verdict to render, and if a future payload
 *     ever carries `good` it is treated as UNVERIFIABLE rather than as a tick —
 *     inventing a green badge here is the one mistake that would cause a lawyer
 *     to file on overruled law.
 *  2. `unknown` is rendered as its own state with its own colour. A silent
 *     omission, or a neutral grey tick, reads as "safe" to a scanning eye.
 *  3. `coverage` is always visible. At ~70% corpus coverage the difference
 *     between "no adverse treatment found" and "we did not look at enough of
 *     the corpus" IS the answer.
 *  4. `authority.resolution.matched: false` invalidates the whole reading. The
 *     endpoint already withholds `treatments` and forces `unknown` in that
 *     case; the panel must say why, because a partner hit exactly this — the
 *     endpoint fuzzy-matched "Kesavananda Bharati v. State of Kerala" to a 2018
 *     Kerala HC matter named "KESAVAN", and a caller trusting `authority.title`
 *     would have put the wrong case on a lawyer's screen.
 */

/** Wire verdicts. `good` is included only so an unexpected value is typed. */
export type NvGoodLawStatus = 'good' | 'doubted' | 'overruled' | 'unknown';

export type NvTreatmentExtractedBy = 'deterministic' | 'llm' | 'editorial';

export interface NvTreatmentRow {
  citation?: string | null;
  treatment?: string;
  confidence?: number;
  paragraph?: string | null;
  extractedBy?: NvTreatmentExtractedBy | string;
}

export interface NvTreatmentCoverage {
  passagesScanned?: number;
  corpusCoveragePct?: number | null;
  retrievalLimited?: boolean;
}

export interface NvAuthorityResolution {
  matched?: boolean;
  confidence?: number;
  method?: 'exact-citation' | 'all-tokens-in-title' | 'unresolved' | string;
  exactModeRequested?: boolean;
}

export interface NvTreatmentAuthority {
  citation?: string;
  title?: string | null;
  court?: string | null;
  year?: string | number | null;
  matchedCitation?: string | null;
  resolution?: NvAuthorityResolution | null;
}

export interface NvTreatmentPayload {
  authority?: NvTreatmentAuthority | null;
  direction?: string;
  goodLaw?: NvGoodLawStatus | string;
  treatments?: NvTreatmentRow[];
  coverage?: NvTreatmentCoverage | null;
  unknownReason?: string;
  limitations?: string;
}

/**
 * Rendering states. Deliberately NOT a 1:1 map of `goodLaw`:
 *
 *  - `unverifiable` exists for the impossible `good` and for any value this
 *    build does not recognise. Falling back to a tick for an unrecognised
 *    verdict is how a future enum addition would silently become a safety
 *    assurance.
 *  - `unresolved_authority` outranks the verdict entirely: when the requested
 *    authority was never identified, the scanned passages may concern a
 *    different case and there is nothing to report about the authority asked
 *    for.
 */
export type NvGoodLawState =
  | 'overruled'
  | 'doubted'
  | 'unknown'
  | 'unresolved_authority'
  | 'unverifiable'
  | 'not_checked';

export interface NvGoodLawVerdict {
  state: NvGoodLawState;
  /** Short badge text. Never affirmative — there is no "good law" verdict. */
  headline: string;
  /** One sentence a lawyer can act on. */
  detail: string;
  severity: 'adverse' | 'caution' | 'unknown';
  /**
   * True only when the panel is asserting something adverse about the
   * authority. Nothing in this module ever asserts something reassuring.
   */
  adverse: boolean;
}

const UNKNOWN_REASON_TEXT: Record<string, string> = {
  authority_not_identified:
    'The authority itself could not be identified in the corpus, so no passage can be attributed to it.',
  no_passages_retrieved:
    'Retrieval returned no passages for this authority, so nothing was scanned.',
  no_treatment_language_found:
    'The scanned passages contained no language that overrules, doubts, or follows this authority.',
};

/**
 * Collapse the wire into a rendering state.
 *
 * `matched: false` is checked FIRST. The endpoint already forces
 * `goodLaw: 'unknown'` in that case, so this is belt-and-braces — but it is the
 * cheap half of the mislabelling defence and it also covers a payload where an
 * upstream change forgot to force it.
 */
export function readGoodLaw(payload: NvTreatmentPayload | null | undefined): NvGoodLawVerdict {
  if (!payload) {
    return {
      state: 'not_checked',
      headline: 'Treatment not checked',
      detail:
        'No treatment check has been run for this authority. This is not a statement that it is good law.',
      severity: 'unknown',
      adverse: false,
    };
  }

  const resolution = payload.authority?.resolution ?? null;
  const matched = resolution?.matched;
  if (matched === false) {
    return {
      state: 'unresolved_authority',
      headline: 'Authority not identified',
      detail:
        'We could not identify this authority in the corpus, so no treatment can be reported for it. '
        + 'Any passages retrieved may concern a different case, and are withheld rather than shown against this citation.',
      severity: 'unknown',
      adverse: false,
    };
  }

  const raw = typeof payload.goodLaw === 'string' ? payload.goodLaw : '';
  const reason = typeof payload.unknownReason === 'string' ? payload.unknownReason : '';

  switch (raw) {
    case 'overruled':
      return {
        state: 'overruled',
        headline: 'Adverse treatment found — overruled / per incuriam',
        detail:
          'At least one retrieved passage states this authority is overruled or per incuriam. '
          + 'Read the passage below and verify against the official law report before citing it.',
        severity: 'adverse',
        adverse: true,
      };
    case 'doubted':
      return {
        state: 'doubted',
        headline: 'Adverse treatment found — doubted',
        detail:
          'At least one retrieved passage doubts the correctness of this authority or refers it to a larger bench. '
          + 'Read the passage below and verify against the official law report before citing it.',
        severity: 'adverse',
        adverse: true,
      };
    case 'unknown':
      return {
        state: 'unknown',
        headline: 'Treatment unknown — not cleared',
        detail:
          (UNKNOWN_REASON_TEXT[reason]
            ?? 'Nothing in the scanned passages established treatment of this authority.')
          + ' This is NOT a finding that the authority is good law — we have no affirmative good-law verdict to give.',
        severity: 'unknown',
        adverse: false,
      };
    default:
      /*
       * Includes `good`. The server cannot emit it (see module header), so a
       * `good` on this wire means either an editorial source we do not yet
       * render or a contract drift — neither of which may be shown to a lawyer
       * as a clearance.
       */
      return {
        state: 'unverifiable',
        headline: raw
          ? `Unrecognised verdict "${raw}" — not cleared`
          : 'No verdict returned — not cleared',
        detail:
          'This build cannot verify the verdict on the wire, so it is shown as unresolved rather than as a clearance. '
          + 'No affirmative good-law verdict is produced by this platform.',
        severity: 'unknown',
        adverse: false,
      };
  }
}

export interface NvCoverageReadout {
  /** Always renderable — never null, so a host cannot conditionally hide it. */
  headline: string;
  detail: string;
  passagesScanned: number | null;
  corpusCoveragePct: number | null;
  retrievalLimited: boolean;
  /** True when coverage is thin enough that a null result means very little. */
  weak: boolean;
}

/**
 * Coverage readout.
 *
 * Returns a renderable readout for EVERY input, including a missing `coverage`
 * block — "coverage not reported" is itself the answer a lawyer needs, and a
 * `coverage && <Coverage/>` guard in a host would hide precisely the case where
 * we know least.
 *
 * `weak` is true when the corpus percentage is below 100, when retrieval was
 * capped, or when coverage is simply absent. It is deliberately generous: at
 * ~70% India-wide embedding coverage almost every real call is weak, and saying
 * so is the honest posture.
 */
export function readCoverage(coverage: NvTreatmentCoverage | null | undefined): NvCoverageReadout {
  const scanned = typeof coverage?.passagesScanned === 'number' && Number.isFinite(coverage.passagesScanned)
    ? Math.max(0, Math.trunc(coverage.passagesScanned))
    : null;
  const pct = typeof coverage?.corpusCoveragePct === 'number' && Number.isFinite(coverage.corpusCoveragePct)
    ? coverage.corpusCoveragePct
    : null;
  const retrievalLimited = coverage?.retrievalLimited === true;

  if (!coverage) {
    return {
      headline: 'Coverage not reported',
      detail:
        'The response carried no coverage block, so how much of the corpus was consulted is unknown. '
        + 'Treat a null result as uninformative.',
      passagesScanned: null,
      corpusCoveragePct: null,
      retrievalLimited: false,
      weak: true,
    };
  }

  const scannedText = scanned === null
    ? 'passages scanned not reported'
    : `${scanned} passage${scanned === 1 ? '' : 's'} scanned`;
  const pctText = pct === null
    ? 'corpus coverage not reported'
    : `${pct}% of the India corpus embedded`;

  return {
    headline: `${scannedText} · ${pctText}${retrievalLimited ? ' · retrieval capped' : ''}`,
    detail: retrievalLimited
      ? 'Retrieval hit its cap, so "nothing found" means "nothing in the passages we read", not "nothing in the corpus".'
      : pct !== null && pct < 100
        ? 'Part of the corpus is not yet searchable by vector, so adverse treatment could exist in the unindexed remainder.'
        : 'Coverage as reported by the knowledge plane at the time of this call.',
    passagesScanned: scanned,
    corpusCoveragePct: pct,
    retrievalLimited,
    weak: pct === null || pct < 100 || retrievalLimited,
  };
}

export interface NvResolutionReadout {
  matched: boolean;
  /** `null` when the wire carried no resolution block at all. */
  reported: boolean;
  headline: string;
  detail: string;
  method: string;
  confidence: number | null;
  exactModeRequested: boolean;
  /** True when offering `exact=true` would materially help the reader. */
  offerExactMode: boolean;
}

const METHOD_TEXT: Record<string, string> = {
  'exact-citation': 'Matched on an exact citation string.',
  'all-tokens-in-title':
    'Matched because every distinctive party-name token appears in the title — weaker than a citation match, and the mode that once matched "Kesavananda Bharati" to a case named "KESAVAN".',
  unresolved: 'No candidate satisfied the match rule.',
};

/**
 * Resolution readout.
 *
 * A missing resolution block is reported as unmatched, not as matched. The only
 * safe default for "did we identify the right case?" is "we cannot say we did".
 */
export function readResolution(
  authority: NvTreatmentAuthority | null | undefined,
): NvResolutionReadout {
  const r = authority?.resolution ?? null;
  const reported = !!r && typeof r === 'object';
  const matched = r?.matched === true;
  const method = typeof r?.method === 'string' && r.method ? r.method : 'unresolved';
  const confidence = typeof r?.confidence === 'number' && Number.isFinite(r.confidence)
    ? r.confidence
    : null;
  const exactModeRequested = r?.exactModeRequested === true;

  if (!matched) {
    return {
      matched: false,
      reported,
      headline: reported ? 'Authority NOT identified' : 'Authority identification not reported',
      detail: reported
        ? (METHOD_TEXT[method] ?? `Identification method: ${method}.`)
          + ' Title, court and year are withheld rather than guessed.'
        : 'No resolution block was returned, so we cannot confirm the right case was found.',
      method,
      confidence,
      exactModeRequested,
      /* Exact mode cannot help when it was already the mode in force. */
      offerExactMode: !exactModeRequested,
    };
  }

  return {
    matched: true,
    reported,
    headline:
      method === 'exact-citation'
        ? 'Authority identified by citation'
        : 'Authority identified by party-name tokens',
    detail: METHOD_TEXT[method] ?? `Identification method: ${method}.`,
    method,
    confidence,
    exactModeRequested,
    /*
     * A token match is where the wrong-case hazard lives, so offer the stricter
     * mode there even though we did "match". No answer beats a plausible wrong
     * one.
     */
    offerExactMode: method !== 'exact-citation' && !exactModeRequested,
  };
}

export interface NvExtractedByReadout {
  key: NvTreatmentExtractedBy | 'unknown';
  label: string;
  /** True only for `deterministic` — the one provenance we can reproduce. */
  reproducible: boolean;
  detail: string;
}

/**
 * Provenance readout, per row.
 *
 * Deterministic phrase extraction and LLM inference must not look alike: one is
 * a quotation of what a court wrote, the other is a model's reading of it. An
 * unlabelled row defaults to `unknown`, never to `deterministic`.
 */
export function readExtractedBy(value: string | null | undefined): NvExtractedByReadout {
  switch (value) {
    case 'deterministic':
      return {
        key: 'deterministic',
        label: 'Verified phrase',
        reproducible: true,
        detail: 'Matched a fixed treatment phrase in the passage text. Reproducible, cannot be hallucinated.',
      };
    case 'llm':
      return {
        key: 'llm',
        label: 'AI-suggested',
        reproducible: false,
        detail: 'Inferred by a language model, not quoted from a fixed phrase. Verify the passage yourself.',
      };
    case 'editorial':
      return {
        key: 'editorial',
        label: 'Editorial',
        reproducible: false,
        detail: 'Asserted by a human editor rather than extracted from this passage.',
      };
    default:
      return {
        key: 'unknown',
        label: 'Provenance unknown',
        reproducible: false,
        detail:
          'This row carried no `extractedBy`, so we cannot say whether it was extracted or inferred. Treat it as unverified.',
      };
  }
}

/** Adverse treatments, which are the rows that change the verdict. */
const ADVERSE_TREATMENTS = new Set(['overruled', 'per_incuriam', 'doubted']);

export function isAdverseTreatment(treatment: string | null | undefined): boolean {
  return typeof treatment === 'string' && ADVERSE_TREATMENTS.has(treatment);
}

export function formatTreatmentKind(treatment: string | null | undefined): string {
  if (typeof treatment !== 'string' || !treatment) return 'Unlabelled';
  return treatment.replace(/[_-]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

/**
 * Standing limitation text.
 *
 * Rendered even when the payload omits `limitations`: the constraint is a
 * property of the platform, not of one response, and a UI that only echoes the
 * server's string would drop it on any payload that forgot to send one.
 */
export const NV_GOOD_LAW_LIMITATION =
  'This is not a citator. There is no citation graph — nv_legal_graph_edges holds no rows — so this is '
  + 'deterministic phrase extraction over passages retrieved for this authority. It cannot enumerate citing '
  + 'judgments, it never asserts that an authority is good law, and it is not a substitute for checking the '
  + 'official law report.';

/** Guard against "Related Judgments" (embedding similarity) being read as treatment. */
export const NV_GOOD_LAW_NOT_SIMILARITY =
  'Distinct from "Related judgments", which is embedding similarity and answers a different question: '
  + 'similar cases are not cases that treated this one.';

export function extractTreatmentPayload(raw: unknown): NvTreatmentPayload | null {
  if (!raw || typeof raw !== 'object') return null;
  const top = raw as Record<string, unknown>;
  const body = (top.data && typeof top.data === 'object' ? top.data : top) as Record<string, unknown>;
  if (typeof body.goodLaw !== 'string' && !body.authority && !body.coverage) return null;
  return body as NvTreatmentPayload;
}

export function treatmentRows(payload: NvTreatmentPayload | null | undefined): NvTreatmentRow[] {
  return Array.isArray(payload?.treatments) ? payload!.treatments!.filter((r) => !!r) : [];
}
