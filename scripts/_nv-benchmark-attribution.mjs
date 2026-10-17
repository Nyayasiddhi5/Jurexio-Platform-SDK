/**
 * NV-BENCH-COST-001 (attribution) — decide WHY a run cost what it cost.
 *
 * ── The defect this replaces ─────────────────────────────────────────────────
 * The previous detector inferred cause from the COMPLETION COUNT alone:
 * `expectFanoutMax > 0 && billedCompletions === 0` → "answered out of scope".
 * That single rule collapses four different events into one verdict:
 *
 *   1. a semantic-cache hit — a correct, previously-computed answer at zero
 *      marginal cost. The moat working as designed.
 *   2. the deterministic tier answering from stored statute text with no model
 *      call. Also a genuine win.
 *   3. the deterministic tier answering a question it should have escalated —
 *      a statute excerpt returned to a case-law research ask. A quality FAILURE
 *      wearing a 100 % saving as a disguise (NV-DETERMINISTIC-OVERFIRE-001).
 *   4. a cross-prompt fuzzy cache match — the cache serving the answer to a
 *      DIFFERENT question. Also a quality failure, and the one the v1 set
 *      manufactured for itself by making every cost-bearing prompt the same
 *      topic.
 *
 * Calling (1) or (2) a regression understates the platform exactly as much as
 * calling (3) or (4) a saving overstates it. So this module reads a stated
 * mechanism where one exists and REFUSES to guess where one does not — an
 * unattributable zero-completion run is reported as an instrument gap, never
 * silently credited or debited.
 *
 * ── Signal provenance is part of the output ──────────────────────────────────
 * `signal` says where the verdict came from, because the three sources are not
 * equally strong:
 *
 *   'envelope'   `cost.resolution` (NV-ZEROCOST-ATTRIBUTION-001). Stated by the
 *                seam that knows. Strongest.
 *   'log'        the request-scoped `zero-cost resolution` log line. Equivalent
 *                strength, available when the envelope predates the field.
 *   'model-name' `cost.model` matched a known resolver / fast-path id. Weaker:
 *                a cache hit reports the ORIGINAL model's name, so this source
 *                can identify a deterministic answer but can never identify a
 *                cache hit.
 *   'none'       nothing said. Verdict is `unattributable`.
 *
 * Deliberately NOT used as a signal: `truth.cacheHintLines`. Cache log lines are
 * counted across the whole log window, and before this change they carried no
 * requestId at all, so on a shared host they attribute another request's cache
 * hit to the request under test — the same window-scope defect that produced the
 * withdrawn v1 fan-out figures.
 */

/** Zero-LLM `cost.model` values, each an id emitted by a real code path. */
const DETERMINISTIC_MODEL_IDS = new Set([
  // src/routes/nv-orchestration-routes.ts — pre-Queen fast paths
  'nys-statute-map',
  'nys-statute-faq',
  // src/services/nv-nys-deterministic-answer.ts — DeterministicResolverId
  'nys-statute-section',
  'nys-citation-resolve',
  'nys-code-compare',
]);

const ABSTAIN_MODEL_IDS = new Set(['rag-abstain']);

/**
 * `cost.model` on a cache hit is `entry.metadata.model || 'cache'`
 * (nv-client.ts), so the literal 'cache' only appears when the stored entry had
 * no model recorded. It is therefore sufficient but nowhere near necessary.
 */
const CACHE_MODEL_IDS = new Set(['cache']);

export const RESOLUTIONS = Object.freeze([
  'llm',
  'semantic-cache',
  'deterministic-resolver',
  'statute-fast-path',
  'rag-abstain',
]);

const ZERO_LLM_RESOLUTIONS = new Set([
  'semantic-cache',
  'deterministic-resolver',
  'statute-fast-path',
  'rag-abstain',
]);

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const normalise = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

/**
 * Does this benchmark item's class require a model to be a correct answer?
 *
 * Three declarations, in decreasing explicitness. `mustEscalate` is the v2 field
 * that says so directly; `expectFanoutMin >= 1` is the v1 correctness-probe
 * shape; `expectFanoutMax > 0` is the weakest, because it only bounds fan-out
 * from above and a class may tolerate zero.
 */
export function classifyItemExpectation(item) {
  const i = item || {};
  if (i.mustEscalate === true) return { requiresModel: true, source: 'mustEscalate' };
  if (i.zeroLlmExpected === true) return { requiresModel: false, source: 'zeroLlmExpected' };
  if (num(i.expectFanoutMin) !== null && i.expectFanoutMin >= 1) {
    return { requiresModel: true, source: 'expectFanoutMin' };
  }
  if (num(i.expectFanoutMax) === 0) return { requiresModel: false, source: 'expectFanoutMax=0' };
  if (num(i.expectFanoutMax) !== null && i.expectFanoutMax > 0) {
    return { requiresModel: true, source: 'expectFanoutMax>0' };
  }
  return { requiresModel: null, source: 'undeclared' };
}

/**
 * Read the stated resolution off one run record, cheapest-and-strongest first.
 *
 * `rec.nyv.envelopeResolution` is the harness's capture of `cost.resolution`;
 * `rec.truth.resolutionLines` is the capture of the request-scoped log line.
 */
export function readResolutionSignal(rec) {
  const nyv = rec?.nyv || {};
  const truth = rec?.truth || {};

  const fromEnvelope = String(nyv.envelopeResolution || '');
  if (RESOLUTIONS.includes(fromEnvelope)) {
    return {
      resolution: fromEnvelope,
      signal: 'envelope',
      detail: nyv.envelopeResolutionDetail || null,
      semanticMatch: nyv.envelopeCacheSemanticMatch === true,
    };
  }

  const logLines = Array.isArray(truth.resolutionLines) ? truth.resolutionLines : [];
  const fromLog = logLines.find((l) => RESOLUTIONS.includes(String(l?.resolution || '')));
  if (fromLog) {
    return {
      resolution: String(fromLog.resolution),
      signal: 'log',
      detail: fromLog.detail || null,
      semanticMatch: fromLog.semanticMatch === true,
    };
  }

  const model = String(nyv.envelopeModel || '');
  if (DETERMINISTIC_MODEL_IDS.has(model)) {
    return { resolution: 'deterministic-resolver', signal: 'model-name', detail: model, semanticMatch: false };
  }
  if (ABSTAIN_MODEL_IDS.has(model)) {
    return { resolution: 'rag-abstain', signal: 'model-name', detail: model, semanticMatch: false };
  }
  if (CACHE_MODEL_IDS.has(model)) {
    return { resolution: 'semantic-cache', signal: 'model-name', detail: model, semanticMatch: false };
  }

  return { resolution: null, signal: 'none', detail: null, semanticMatch: false };
}

/**
 * Attribute one run.
 *
 * `peerAnswers` maps `itemId` → cold answer text for the OTHER items in this
 * pass. A zero-cost answer that is byte-identical (modulo whitespace) to another
 * item's answer is the measured v1 failure: the cache served the previous
 * question's answer to a different question. That is mechanically detectable and
 * is treated as a quality failure rather than a saving.
 */
export function attributeRun({ item, rec, nyvAnswer = '', peerAnswers = {} }) {
  const truth = rec?.truth || {};
  const nyv = rec?.nyv || {};
  const billed = num(truth.billedCompletions);
  const scopeMode = truth.scopeMode || null;
  const signal = readResolutionSignal(rec);
  const expectation = classifyItemExpectation(item);
  const flags = [];

  // Billed work needs no attribution: the cost is real and the money was spent.
  // `resolution: 'llm'` with a positive count is the ordinary case; a positive
  // count with a zero-LLM resolution is a contradiction worth surfacing.
  if (billed !== null && billed > 0) {
    if (signal.resolution && ZERO_LLM_RESOLUTIONS.has(signal.resolution)) {
      flags.push(
        `envelope claims resolution '${signal.resolution}' but ${billed} completion(s) were billed — `
        + 'the two signals disagree and neither can be trusted for this run',
      );
      return verdict('signal-conflict', { signal, expectation, billed, scopeMode, flags, countsAsSaving: false, instrumentGap: true });
    }
    return verdict('billed-llm', { signal, expectation, billed, scopeMode, flags, countsAsSaving: null });
  }

  // From here on the run billed nothing (or the count is unknown).
  if (billed === null) {
    flags.push('no independent billed-completion count for this run — cost cannot be verified either way');
    return verdict('unattributable', { signal, expectation, billed, scopeMode, flags, countsAsSaving: false, instrumentGap: true });
  }

  if (!signal.resolution) {
    flags.push(
      'zero billed completions with NO stated resolution — cannot tell a cache hit from a '
      + 'deterministic answer from an out-of-scope fast path. Needs `cost.resolution` '
      + '(NV-ZEROCOST-ATTRIBUTION-001) on this path.',
    );
    return verdict('unattributable', { signal, expectation, billed, scopeMode, flags, countsAsSaving: false, instrumentGap: true });
  }

  if (signal.resolution === 'rag-abstain') {
    flags.push('the platform declined to answer (RAG abstain) — free, but not an answer');
    return verdict('abstain', { signal, expectation, billed, scopeMode, flags, countsAsSaving: false });
  }

  if (signal.resolution === 'semantic-cache') {
    const crossHit = findCrossHit(nyvAnswer, peerAnswers, rec?.itemId);
    if (crossHit) {
      flags.push(
        `cache served an answer byte-identical to item #${crossHit} (a DIFFERENT prompt) — `
        + 'a cross-prompt fuzzy match, not an answer to this question',
      );
      return verdict('cache-cross-hit', { signal, expectation, billed, scopeMode, flags, countsAsSaving: false, crossHitItemId: crossHit });
    }
    const repeat = isDeclaredRepeat(item, rec);
    // A hit on a repeat and a hit on a fresh question are both real savings, but
    // they generalise differently: repeat-rate is a property of the traffic mix,
    // whereas a fresh-question hit is a property of the corpus already stored.
    // Blending them would let a benchmark's own repetition set the hit rate.
    return verdict(repeat ? 'cache-win-repeat' : 'cache-win-fresh', {
      signal, expectation, billed, scopeMode, flags,
      countsAsSaving: true,
      reportSeparately: true,
      cacheProvenance: repeat ? 'declared-repeat' : 'fresh-question',
    });
  }

  // deterministic-resolver | statute-fast-path
  if (expectation.requiresModel === true) {
    flags.push(
      `${signal.resolution} answered a class declared to require a model `
      + `(${expectation.source}) — a statutory excerpt is not an answer to this prompt `
      + '(NV-DETERMINISTIC-OVERFIRE-001 / NV-STATUTE-FAQ-SCOPE-001)',
    );
    return verdict('deterministic-over-fire', { signal, expectation, billed, scopeMode, flags, countsAsSaving: false });
  }
  if (expectation.requiresModel === null) {
    flags.push(
      `${signal.resolution} produced a zero-cost answer, but this item declares neither `
      + '`mustEscalate` nor `expectFanoutMax` — the set cannot say whether that is correct',
    );
    return verdict('unattributable', { signal, expectation, billed, scopeMode, flags, countsAsSaving: false, instrumentGap: true });
  }
  return verdict('deterministic-win', { signal, expectation, billed, scopeMode, flags, countsAsSaving: true });
}

function verdict(name, extra) {
  return {
    verdict: name,
    resolution: extra.signal?.resolution ?? null,
    signal: extra.signal?.signal ?? 'none',
    resolutionDetail: extra.signal?.detail ?? null,
    semanticMatch: extra.signal?.semanticMatch === true,
    expectationSource: extra.expectation?.source ?? 'undeclared',
    requiresModel: extra.expectation?.requiresModel ?? null,
    billedCompletions: extra.billed,
    scopeMode: extra.scopeMode ?? null,
    countsAsSaving: extra.countsAsSaving ?? null,
    reportSeparately: extra.reportSeparately === true,
    instrumentGap: extra.instrumentGap === true,
    cacheProvenance: extra.cacheProvenance ?? null,
    crossHitItemId: extra.crossHitItemId ?? null,
    flags: extra.flags ?? [],
  };
}

/**
 * A repeat is DECLARED, never guessed from text similarity.
 *
 * Two declarations count: the v1 `runAfter` shape (this prompt deliberately
 * follows another), and the v2 `cacheExpectation: 'expect-hit'`. A warm run
 * (`run > 1`) of the same prompt is a repeat by construction.
 */
export function isDeclaredRepeat(item, rec) {
  const i = item || {};
  if (i.cacheExpectation === 'expect-hit') return true;
  if (num(i.runAfter) !== null) return true;
  return num(rec?.run) !== null && rec.run > 1;
}

function findCrossHit(answer, peerAnswers, selfItemId) {
  const mine = normalise(answer);
  if (mine.length < 200) return null; // too short to be a distinctive match
  for (const [itemId, text] of Object.entries(peerAnswers || {})) {
    if (String(itemId) === String(selfItemId)) continue;
    if (normalise(text) === mine) return itemId;
  }
  return null;
}

/** Roll per-run verdicts up into the counters the report prints. */
export function summariseAttribution(attributions) {
  const byVerdict = {};
  const bySignal = {};
  for (const a of attributions) {
    byVerdict[a.verdict] = (byVerdict[a.verdict] || 0) + 1;
    bySignal[a.signal] = (bySignal[a.signal] || 0) + 1;
  }
  const qualityFailures = attributions.filter(
    (a) => a.verdict === 'deterministic-over-fire'
      || a.verdict === 'cache-cross-hit'
      || a.verdict === 'signal-conflict',
  );
  return {
    byVerdict,
    bySignal,
    // A saving withheld for a QUALITY reason and one withheld because the
    // instrument could not see the mechanism are different problems with
    // different owners. Keeping them apart is the whole point of this module.
    qualityFailureRuns: qualityFailures.length,
    instrumentGapRuns: attributions.filter((a) => a.instrumentGap).length,
    cacheWinRuns: attributions.filter((a) => a.verdict.startsWith('cache-win')).length,
    cacheWinFreshRuns: attributions.filter((a) => a.verdict === 'cache-win-fresh').length,
    cacheWinRepeatRuns: attributions.filter((a) => a.verdict === 'cache-win-repeat').length,
    deterministicWinRuns: attributions.filter((a) => a.verdict === 'deterministic-win').length,
    billedRuns: attributions.filter((a) => a.verdict === 'billed-llm').length,
    explicitlyAttributedRuns: attributions.filter((a) => a.signal === 'envelope' || a.signal === 'log').length,
  };
}
