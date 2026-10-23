/**
 * NV-CITATOR-NEGATIVE-TREATMENT-001 (2026-08-18) — the §1c interim NSP asked for.
 *
 * WHAT THIS IS
 * A deterministic, phrase-driven check for **negative** treatment of an authority: has it
 * been overruled, doubted, or held per incuriam? That single signal removes the worst
 * malpractice risk (citing overruled law) and is a fraction of the full treatment graph.
 *
 * WHAT THIS IS NOT
 * Not a citator. It does not walk a citation graph, does not enumerate every citing
 * judgment, and cannot say "followed by 14, distinguished by 3". `goodLaw: "unknown"` is the
 * honest and expected answer for most authorities, and NSP has agreed to render it as
 * "treatment unknown" rather than implying safety.
 *
 * WHY PHRASES AND NOT AN LLM
 * Indian judgments state treatment in highly templated language — "stands overruled by",
 * "we respectfully follow", "is distinguishable on facts", "per incuriam", "no longer good
 * law". A regex over retrieved judgment text is cheap, reproducible, explains itself (we can
 * hand back the passage), and cannot hallucinate a treatment that is not written down. An
 * LLM pass belongs on top of this, labelled `extractedBy: "llm"`, not underneath it.
 *
 * THE HAZARD THIS REPLACES
 * The MCP tool `overruled_case_check` is described as a "live citator" but runs
 * `ragSearch("overruled distinguished <case>")` and returns whatever passages match. A
 * judgment that merely *discusses* overruling ranks identically to one that *performs* it.
 * NSP was warned off it. This module exists so there is something correct to point them at.
 *
 * NSP's three non-negotiables, honoured deliberately:
 *   1. `goodLaw` is ALWAYS present, including `"unknown"` — a silent omission becomes
 *      "good law" in any UI.
 *   2. `extractedBy` per row — so inferred treatment is never presented as editorial.
 *   3. `coverage` on every response — without it "no adverse treatment found" is
 *      indistinguishable from "we did not look at enough of the corpus".
 */
import { attributeTreatment, type AttributionMethod } from './jrx-citator-attribution.js';

/** Treatment verbs we can establish from text. Ordered most severe first. */
export type TreatmentKind =
  | 'overruled'
  | 'per_incuriam'
  | 'doubted'
  | 'distinguished'
  | 'followed'
  | 'affirmed'
  | 'reversed'
  | 'explained'
  | 'referred';

/** The only three good-law verdicts we are willing to assert. */
export type GoodLawStatus = 'good' | 'doubted' | 'overruled' | 'unknown';

export interface TreatmentRow {
  /** Citation of the judgment that performed the treatment, when we can identify it. */
  citation: string | null;
  treatment: TreatmentKind;
  /** 0..1 — confidence in the EXTRACTION, not in the law. */
  confidence: number;
  /** The passage that establishes it, so a lawyer can verify us. */
  paragraph: string | null;
  extractedBy: 'deterministic' | 'llm' | 'editorial';
  /**
   * NV-CITATOR-ATTRIBUTION-001 — HOW the phrase was bound to the requested authority.
   * Absent on legacy passage rows, where no attribution was attempted; present and never
   * `unattributed` on rows produced by a full-body scan, because an unattributed treatment is
   * not a finding. A UI can discount a `case-name-span` binding without discarding it.
   */
  attributionMethod?: AttributionMethod;
}

export interface NegativeTreatmentResult {
  /** Always present. `unknown` when nothing in the scanned text establishes treatment. */
  goodLaw: GoodLawStatus;
  /** Only rows we could establish from text. May be empty; never fabricated. */
  treatments: TreatmentRow[];
  coverage: {
    /** How many retrieved passages were actually scanned. */
    passagesScanned: number;
    /**
     * India-wide embedding coverage at the time of the call. Present so the caller can tell
     * a genuine "no adverse treatment" from "we looked at a fraction of the corpus".
     */
    corpusCoveragePct: number | null;
    /** True when the scan was limited by retrieval depth rather than by the corpus. */
    retrievalLimited: boolean;
  };
  /** Machine-readable reason when `goodLaw` is `unknown`. */
  unknownReason?:
    | 'no_passages_retrieved'
    | 'no_treatment_language_found'
    | 'authority_not_identified';
}

/*
 * Phrase patterns. Each is anchored on language a court uses to DO something to an
 * authority, not merely to mention it.
 *
 * `NEGATIVE_*` are the only ones that can move `goodLaw` away from `unknown`, because a
 * false "overruled" is the one error that would make a lawyer discard valid law — the
 * mirror-image malpractice risk of citing overruled law.
 */
const NEGATIVE_OVERRULED: readonly RegExp[] = [
  /\bstands?\s+overruled\b/i,
  /\bis\s+(?:hereby\s+)?overruled\b/i,
  /\bare\s+(?:hereby\s+)?overruled\b/i,
  /\bwe\s+overrule\b/i,
  /\boverruled\s+by\s+(?:this|the)\s+(?:court|bench)\b/i,
  /\bno\s+longer\s+(?:good\s+law|holds\s+the\s+field)\b/i,
  /\bcannot\s+be\s+treated\s+as\s+(?:good\s+law|binding)\b/i,
  /\bdoes\s+not\s+lay\s+down\s+(?:the\s+)?correct\s+law\b/i,
  /[–—-]\s*overruled\b/i,
  /\boverruled\s+Para\b/i,
];

const NEGATIVE_PER_INCURIAM: readonly RegExp[] = [
  /\bper\s+incuriam\b/i,
  /\brendered\s+in\s+ignorance\s+of\b/i,
];

const NEGATIVE_DOUBTED: readonly RegExp[] = [
  /\bwe\s+(?:respectfully\s+)?doubt\s+the\s+correctness\b/i,
  /\bcorrectness\s+of\s+(?:the\s+)?(?:decision|judgment|view)\s+is\s+doubted\b/i,
  /\bdoubt(?:ed|ing|s)\s+the\s+correctness\b/i,
  /\breferred\s+to\s+a\s+larger\s+bench\b/i,
  /\brequires\s+reconsideration\b/i,
];

/** Neutral/positive treatments: reported, but they never change `goodLaw`. */
const POSITIVE_OR_NEUTRAL: ReadonlyArray<{ kind: TreatmentKind; patterns: readonly RegExp[] }> = [
  { kind: 'followed', patterns: [/\bwe\s+(?:respectfully\s+)?follow\b/i, /\bfollowing\s+the\s+(?:decision|ratio)\b/i, /\bbound\s+by\s+the\s+(?:decision|ratio)\b/i] },
  { kind: 'affirmed', patterns: [/\bis\s+(?:hereby\s+)?affirmed\b/i, /\bwe\s+affirm\b/i] },
  { kind: 'reversed', patterns: [/\bis\s+(?:hereby\s+)?(?:set\s+aside|reversed)\b/i] },
  { kind: 'distinguished', patterns: [/\bis\s+distinguishable\b/i, /\bdistinguishable\s+on\s+(?:facts|the\s+facts)\b/i, /\bstands?\s+on\s+a\s+different\s+footing\b/i] },
  { kind: 'explained', patterns: [/\bwe\s+(?:may\s+)?explain\s+the\s+(?:ratio|decision)\b/i] },
  { kind: 'referred', patterns: [/\breferred\s+to\s+(?:with\s+approval|in)\b/i] },
];

/*
 * Indian citation shapes, for attributing a treatment to the judgment that made it.
 *
 * The SCC alternative must NOT be prefixed with `\b`: `(` is not a word character, so there
 * is no word boundary between a space and an opening paren and `\b\(` can never match. My
 * first version had it and silently failed on `(2012) 6 SCC 613` — the single most common
 * Indian citation form — while still matching AIR and SCC OnLine, so it looked half-working.
 */
const CITATION_RE =
  /(?:\(\d{4}\)\s*\d+\s*SCC\s*\d+|\bAIR\s*\d{4}\s*[A-Z]{2,4}\s*\d+\b|\b\d{4}\s*SCC\s*OnLine\s*[A-Za-z]+\s*\d+\b)/;

/** Trim a matched sentence to something a UI can render without a scrollbar. */
function extractSentence(text: string, matchIndex: number): string {
  const start = Math.max(0, text.lastIndexOf('.', matchIndex) + 1);
  const dot = text.indexOf('.', matchIndex);
  const end = dot === -1 ? Math.min(text.length, matchIndex + 320) : Math.min(dot + 1, matchIndex + 320);
  return text.slice(start, end).replace(/\s+/g, ' ').trim();
}

function firstMatch(text: string, patterns: readonly RegExp[]): { index: number; length: number } | null {
  for (const re of patterns) {
    const m = re.exec(text);
    if (m) return { index: m.index, length: m[0].length };
  }
  return null;
}

/**
 * Scan retrieved passages for treatment of an authority.
 *
 * Pure and synchronous on purpose: retrieval belongs to the caller, so this stays trivially
 * testable and cannot make a network call on a hot path.
 *
 * `targetAuthority` switches on NV-CITATOR-ATTRIBUTION-001. Without it the function behaves
 * exactly as before — detection only, which is sound over passages retrieved FOR an authority
 * but not over a full body. With it, an adverse phrase that cannot be bound to the named
 * authority emits no row and cannot move `goodLaw`. That is mandatory for full-body scanning:
 * a false `overruled` makes a lawyer discard valid law and they never find out, whereas a miss
 * leaves the verdict at `unknown`, which the panel already renders as "not cleared".
 */
export function detectNegativeTreatment(input: {
  /** Retrieved passages, ideally from judgments that cite the authority. */
  passages: Array<{ text: string; citation?: string | null }>;
  /** India-wide embedding coverage, so `coverage` is honest. Null when unavailable. */
  corpusCoveragePct?: number | null;
  /** True when retrieval was capped (topK), rather than the corpus being exhausted. */
  retrievalLimited?: boolean;
  /**
   * The authority the caller is asking about. Required for full-body scanning; when absent
   * the legacy detection-only behaviour is preserved for existing passage callers.
   */
  targetAuthority?: string | null;
}): NegativeTreatmentResult {
  const passages = Array.isArray(input.passages) ? input.passages : [];
  const coverage = {
    passagesScanned: passages.length,
    corpusCoveragePct:
      typeof input.corpusCoveragePct === 'number' ? input.corpusCoveragePct : null,
    retrievalLimited: input.retrievalLimited === true,
  };

  if (passages.length === 0) {
    return {
      goodLaw: 'unknown',
      treatments: [],
      coverage,
      unknownReason: 'no_passages_retrieved',
    };
  }

  const treatments: TreatmentRow[] = [];
  let sawOverruled = false;
  let sawDoubted = false;
  const target = typeof input.targetAuthority === 'string' ? input.targetAuthority.trim() : '';
  const attributing = target.length > 0;

  for (const p of passages) {
    const text = String(p?.text || '');
    if (!text) continue;
    const citation = p.citation ?? (CITATION_RE.exec(text)?.[0] ?? null);

    const push = (
      kind: TreatmentKind,
      at: number,
      confidence: number,
      attributionMethod?: AttributionMethod,
    ) => {
      treatments.push({
        citation,
        treatment: kind,
        confidence,
        paragraph: extractSentence(text, at),
        extractedBy: 'deterministic',
        ...(attributionMethod ? { attributionMethod } : {}),
      });
    };

    /*
     * Attribution mode scans EVERY adverse occurrence, not just the first. In a full body the
     * first `overruled` is routinely a counsel submission or a quotation, and stopping there
     * would turn a genuine later holding into a miss for no reason. In legacy passage mode the
     * first-match-wins behaviour is preserved so existing callers do not shift.
     */
    if (attributing) {
      const adverse: Array<{ kind: TreatmentKind; index: number; length: number; escalates: 'overruled' | 'doubted' }> = [];
      for (const [kind, pats, escalates] of [
        ['overruled', NEGATIVE_OVERRULED, 'overruled'],
        ['per_incuriam', NEGATIVE_PER_INCURIAM, 'overruled'],
        ['doubted', NEGATIVE_DOUBTED, 'doubted'],
      ] as const) {
        for (const re of pats) {
          const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
          for (let m = g.exec(text); m; m = g.exec(text)) {
            adverse.push({ kind, index: m.index, length: m[0].length, escalates });
          }
        }
      }
      adverse.sort((a, b) => a.index - b.index);
      let lastAccepted = -1;
      for (const a of adverse) {
        /* One finding per neighbourhood: "overruled … per incuriam" in one holding is one
         * treatment, and reporting it twice lets a UI count two adverse findings where
         * there is one. */
        if (a.index <= lastAccepted) continue;
        const outcome = attributeTreatment({
          text,
          phraseIndex: a.index,
          phraseLength: a.length,
          targetAuthority: target,
        });
        if (!outcome.attributed) continue;
        lastAccepted = a.index + 400;
        if (a.escalates === 'overruled') sawOverruled = true;
        else sawDoubted = true;
        push(a.kind, a.index, Math.min(outcome.confidence, a.kind === 'doubted' ? 0.7 : outcome.confidence), outcome.method);
      }
      /* Neutral/positive rows are informative but never a verdict, and attributing them costs
       * a full span scan per phrase for no safety benefit — so they stay unattributed here. */
      continue;
    }

    /*
     * Severity order matters: "overruled … per incuriam" in one passage is one finding, and
     * reporting it twice would let a UI count two adverse treatments where there is one.
     */
    const ov = firstMatch(text, NEGATIVE_OVERRULED);
    if (ov) {
      sawOverruled = true;
      /* 0.82 not 0.95: the phrase is unambiguous, but attributing it to THIS authority
       * rather than another one discussed nearby is the part we cannot verify from a
       * passage alone. Confidence describes the extraction, not the law. */
      push('overruled', ov.index, 0.82);
      continue;
    }
    const pi = firstMatch(text, NEGATIVE_PER_INCURIAM);
    if (pi) {
      sawOverruled = true;
      push('per_incuriam', pi.index, 0.75);
      continue;
    }
    const db = firstMatch(text, NEGATIVE_DOUBTED);
    if (db) {
      sawDoubted = true;
      push('doubted', db.index, 0.7);
      continue;
    }
    for (const { kind, patterns } of POSITIVE_OR_NEUTRAL) {
      const m = firstMatch(text, patterns);
      if (m) {
        push(kind, m.index, 0.65);
        break;
      }
    }
  }

  /*
   * `good` is deliberately UNREACHABLE from this function.
   *
   * Absence of adverse language in a handful of retrieved passages is not evidence that an
   * authority is good law — it is evidence that we did not find anything. Returning `good`
   * here would be the single most dangerous thing this module could do, because a UI would
   * render it as a safety assurance. Only an editorial or full-graph pass may assert `good`.
   */
  const goodLaw: GoodLawStatus = sawOverruled ? 'overruled' : sawDoubted ? 'doubted' : 'unknown';

  return {
    goodLaw,
    treatments,
    coverage,
    ...(goodLaw === 'unknown'
      ? { unknownReason: 'no_treatment_language_found' as const }
      : {}),
  };
}
