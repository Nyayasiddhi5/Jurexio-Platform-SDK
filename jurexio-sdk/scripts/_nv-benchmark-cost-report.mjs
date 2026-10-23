/**
 * NV-BENCH-COST-001 (arithmetic) — turns raw per-run records into per-class and
 * blended figures. Kept separate from the SSM transport in
 * `jrx-benchmark-cost.mjs` so the numbers can be re-derived offline from a saved
 * raw.json without spending money on another live pass.
 *
 * Design rule for everything below: when a total does not reconcile, emit a
 * RESIDUAL rather than a rounded-off number. Every silent reconciliation is a
 * place where a wrong claim can hide.
 */
import { attributeRun, summariseAttribution } from './_nv-benchmark-attribution.mjs';

/** Catalog price lookup. Model ids in provider log lines are catalog ids. */
export function priceFor(prices, modelId) {
  if (!modelId) return null;
  const direct = prices?.[modelId];
  if (direct) return direct;
  // Bedrock/OpenRouter ids carry region or vendor prefixes ('us.', 'global.',
  // 'anthropic/'). Fall back to the longest catalog id that is a suffix/substring
  // match, so a priced model is not silently treated as free.
  let best = null;
  for (const [id, p] of Object.entries(prices || {})) {
    if (modelId.endsWith(id) || modelId.includes(id)) {
      if (!best || id.length > best.id.length) best = { id, ...p };
    }
  }
  return best;
}

export function usd(prices, modelId, tokensIn, tokensOut) {
  const p = priceFor(prices, modelId);
  if (!p) return null;
  return (Number(tokensIn || 0) * p.inPer1M + Number(tokensOut || 0) * p.outPer1M) / 1e6;
}

/**
 * Cost of one JRX request.
 *
 * Provider log lines do NOT carry uniform detail: `llm-orchestrator: success`
 * logs tokens+cost, `stream success` logs tokens, and `hedge success` logs
 * NEITHER (llm-orchestrator.ts:1293). So a hedge-won request has real billed
 * calls with no per-call tokens. Rather than pretend the per-call sum is the
 * total, we take the envelope's accumulator total (the NV-METER-ENVELOPE-001
 * fix made it truthful) and attribute the difference across the detail-less
 * calls pro rata, priced at each of those calls' own model. Whatever still
 * cannot be attributed is reported as a residual.
 */
export function costOfRun(rec, prices) {
  const truth = rec.truth || {};
  const calls = rec.truthCalls || [];
  const envIn = num(rec.nyv?.envelopePromptTokens);
  const envOut = num(rec.nyv?.envelopeCompletionTokens);

  const detailed = calls.filter((c) => c.tokensIn != null || c.tokensOut != null);
  const bare = calls.filter((c) => c.tokensIn == null && c.tokensOut == null);

  let costUsd = 0;
  let pricedCalls = 0;
  let unpricedCalls = 0;
  const notes = [];

  for (const c of detailed) {
    if (c.costUsd != null) {
      costUsd += c.costUsd;
      pricedCalls += 1;
      continue;
    }
    const v = usd(prices, c.model, c.tokensIn, c.tokensOut);
    if (v == null) {
      unpricedCalls += 1;
      notes.push(`no catalog price for model ${c.model}`);
    } else {
      costUsd += v;
      pricedCalls += 1;
    }
  }

  // Residual tokens = envelope total minus what per-call lines accounted for.
  const knownIn = detailed.reduce((s, c) => s + num(c.tokensIn), 0);
  const knownOut = detailed.reduce((s, c) => s + num(c.tokensOut), 0);
  const residIn = envIn != null ? Math.max(0, envIn - knownIn) : 0;
  const residOut = envOut != null ? Math.max(0, envOut - knownOut) : 0;

  let attributedIn = 0;
  let attributedOut = 0;
  if (bare.length > 0 && (residIn > 0 || residOut > 0)) {
    // Distribute exactly, giving the rounding remainder to the last call, so the
    // reported residual cannot go negative. A -1 "unaccounted" token is noise that
    // makes a real reconciliation gap harder to spot.
    let leftIn = residIn;
    let leftOut = residOut;
    bare.forEach((c, idx) => {
      const last = idx === bare.length - 1;
      const shareIn = last ? leftIn : Math.floor(residIn / bare.length);
      const shareOut = last ? leftOut : Math.floor(residOut / bare.length);
      leftIn -= shareIn;
      leftOut -= shareOut;
      const v = usd(prices, c.model, shareIn, shareOut);
      if (v == null) {
        unpricedCalls += 1;
        notes.push(`no catalog price for model ${c.model} (token-detail-less call)`);
      } else {
        costUsd += v;
        pricedCalls += 1;
        attributedIn += shareIn;
        attributedOut += shareOut;
      }
    });
    notes.push(
      `${bare.length} call(s) had no token detail in the log line (hedge-winner path); ` +
      `${residIn}/${residOut} residual prompt/completion tokens from the envelope were split pro rata across them`,
    );
  }

  const unattributedIn = residIn - attributedIn;
  const unattributedOut = residOut - attributedOut;
  if (bare.length === 0 && (residIn > 0 || residOut > 0)) {
    notes.push(
      `envelope reports ${residIn}/${residOut} more prompt/completion tokens than the sum of ` +
      `per-call log lines, and there is no detail-less call to attribute them to — cost is UNDERSTATED by that much`,
    );
  }

  return {
    costUsd,
    pricedCalls,
    unpricedCalls,
    // These are the honest "does not sum" lines.
    residualPromptTokens: unattributedIn,
    residualCompletionTokens: unattributedOut,
    wastedCostUsd: num(rec.nyv?.wastedCostUsd) || num(truth.wastedCostUsd),
    notes,
  };
}

export function costOfDirect(rec, prices, baselineCatalogId) {
  const d = rec.direct || {};
  if (d.promptTokens == null && d.completionTokens == null) return { costUsd: null, notes: ['no usage returned'] };
  // Gemini bills thinking tokens as output. Omitting them would understate the
  // baseline and flatter JRX, so they are added to output explicitly.
  const out = num(d.completionTokens) + num(d.thoughtsTokens);
  const v = usd(prices, baselineCatalogId, d.promptTokens, out);
  return {
    costUsd: v,
    completionTokensBilled: out,
    notes: v == null ? [`no catalog price for baseline model ${baselineCatalogId}`] : [],
  };
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
function stdev(xs) {
  if (xs.length < 2) return null;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
}

/**
 * Case-insensitive containment of expected citations / keywords. NOT a score.
 *
 * Statute short forms are aliased to their full Act names because the two sides
 * name provisions differently: the JRX statute layer writes "Section 482 of the
 * Bharatiya Nagarik Suraksha Sanhita, 2023" and never the string "BNSS", so a
 * literal check marked a correctly-cited answer as 0 % coverage. Aliasing makes
 * the containment check match how the citation is actually written; it does not
 * make the check into a judgement about whether the citation is *right*.
 */
const CITATION_ALIASES = {
  bns: ['bns', 'bharatiya nyaya sanhita'],
  bnss: ['bnss', 'bharatiya nagarik suraksha sanhita'],
  bsa: ['bsa', 'bharatiya sakshya adhiniyam'],
  ipc: ['ipc', 'indian penal code'],
  crpc: ['crpc', 'code of criminal procedure', 'cr.p.c'],
  pmla: ['pmla', 'prevention of money laundering'],
  sebi: ['sebi', 'securities and exchange board'],
};

export function coverage(text, expected) {
  if (!Array.isArray(expected) || expected.length === 0) return null;
  const hay = String(text || '').toLowerCase().replace(/\s+/g, ' ');
  let hit = 0;
  for (const e of expected) {
    // An entry may be an array of accepted alternatives (any-of). Needed because
    // a provision has both a colloquial name and a statutory title — BNSS 482 is
    // "anticipatory bail" in practice and "Direction for grant of bail to person
    // apprehending arrest" in the Act. Requiring one phrasing scored a correct
    // answer as a shortfall.
    const alternatives = Array.isArray(e) ? e : [e];
    const ok = alternatives.some((alt) => {
      const tokens = String(alt).toLowerCase().match(/[a-z.]{3,}|\d+/g) || [];
      if (!tokens.length) return false;
      return tokens.every((t) => {
        const alts = CITATION_ALIASES[t.replace(/\./g, '')] || [t];
        return alts.some((x) => hay.includes(x));
      });
    });
    if (ok) hit += 1;
  }
  return hit / expected.length;
}

/** Same regex on both sides so JRX and the direct baseline are compared symmetrically. */
export function textCitationMatches(text) {
  const re = /\b(BNS|BNSS|BSA|IPC|CrPC|PMLA|SEBI|Article|Section|s\.)\s*\d+/gi;
  return (String(text || '').match(re) || []).length;
}

/**
 * Aggregate runs into per-class rows, then blend by the frozen weights.
 *
 * Weight renormalisation is reported, not hidden: if a class failed or was
 * skipped, its weight is removed and the rest are rescaled, which changes what
 * the blended number means.
 */
export function aggregate({ set, runs, prices, answers = {} }) {
  const baselineId = set.baseline.catalogModelId;
  const byClass = new Map();
  const meteringMismatches = [];
  const failures = [];
  const attributions = [];

  /* Cold answers indexed by item, so a zero-cost run can be checked against the
   * OTHER prompts in the pass. This is how a cross-prompt cache hit is caught:
   * the v1 set's monotopicity made the cache serve one item's answer to another
   * and both scored a clean 100 % saving. */
  const coldAnswerByItem = {};
  for (const [key, a] of Object.entries(answers)) {
    const [itemId, run] = key.split(':');
    if (Number(run) === 1 && a?.nyvAnswer) coldAnswerByItem[itemId] = a.nyvAnswer;
  }

  for (const rec of runs) {
    const item = set.prompts.find((p) => p.id === rec.itemId);
    const classId = rec.classId || item?.classId || 'unknown';
    if (!byClass.has(classId)) byClass.set(classId, []);

    const truth = rec.truth || {};
    const envC = rec.nyv?.envelopeCompletions;
    const logC = truth.billedCompletions;
    const scope = truth.scopeMode;

    // (3) in the brief: cross-check the envelope's claim against an independent
    // count and fail loudly. A `window`-scoped count can be inflated by
    // concurrent traffic on a shared dev host, so it is recorded as
    // INCONCLUSIVE rather than as a metering regression — calling a scoping
    // artefact a regression would be its own fiction.
    let meterVerdict = 'not-comparable';
    if (typeof envC === 'number' && typeof logC === 'number') {
      if (envC === logC) meterVerdict = 'match';
      else if (scope === 'requestId') meterVerdict = 'MISMATCH';
      else meterVerdict = 'inconclusive-window-scope';
    }
    if (meterVerdict === 'MISMATCH') {
      meteringMismatches.push({ itemId: rec.itemId, classId, run: rec.run, envelope: envC, log: logC, scope });
    }

    const http = String(rec.nyv?.http || '');
    const ok = http === '200';
    if (!ok) failures.push({ itemId: rec.itemId, classId, run: rec.run, http });

    const cost = costOfRun(rec, prices);
    const dcost = costOfDirect(rec, prices, baselineId);
    const ans = answers[`${rec.itemId}:${rec.run}`] || {};
    const nyvAnswer = ans.nyvAnswer || '';
    const directAnswer = ans.directAnswer || '';

    /* Zero-cost attribution — NV-BENCH-COST-001 + NV-ZEROCOST-ATTRIBUTION-001.
     *
     * This used to be inferred from the completion count alone
     * (`expectFanoutMax > 0 && billed === 0` → "answered out of scope"), which
     * cannot distinguish a legitimate cache hit or deterministic answer from a
     * fast path answering the wrong question. `attributeRun` reads the mechanism
     * the response envelope now states, and reports `unattributable` rather than
     * guessing when nothing states it. See `_nv-benchmark-attribution.mjs`.
     */
    const attribution = attributeRun({
      item,
      rec,
      nyvAnswer,
      peerAnswers: coldAnswerByItem,
    });
    attributions.push({ itemId: rec.itemId, classId, run: rec.run, ...attribution });

    /* Two independent reasons to withhold a saving, kept apart on purpose:
     *   - `attribution.flags` — the MECHANISM was wrong (over-fire, cross-hit,
     *     or unattributable). Withholds regardless of what the text looks like.
     *   - `shortfallFlags`    — the CONTENT is thinner than direct. Withholds
     *     independently, because a correct mechanism can still return less. */
    const shortfallFlags = [];
    const kwN = coverage(nyvAnswer, item?.expectedAnswerKeywords);
    const kwD = coverage(directAnswer, item?.expectedAnswerKeywords);
    /* Whether the class must reason is read from the attribution's expectation
     * rather than from `expectFanoutMax` directly, because that field is only one
     * of three ways an item can declare it (v2 items say `mustEscalate`), and
     * gating on the field alone silently disables both checks below for them. */
    const requiresModel = attribution.requiresModel === true;
    /* Keyword coverage withholds a saving only where a shortfall means something
     * was omitted. A deterministic statute answer legitimately omits the
     * discursive vocabulary a chat model volunteers, so there `expectedCitations`
     * (did it cite the right provision?) is the binding check and a keyword gap is
     * reported in §5 without withholding. Where the class must reason, a keyword
     * gap does indicate a thinner answer. */
    if (kwN != null && kwD != null && kwN + 1e-9 < kwD && requiresModel) {
      shortfallFlags.push(`keyword coverage below direct (${(kwN * 100).toFixed(0)} % vs ${(kwD * 100).toFixed(0)} %)`);
    }
    const ccN = coverage(nyvAnswer, item?.expectedCitations);
    const ccD = coverage(directAnswer, item?.expectedCitations);
    if (ccN != null && ccD != null && ccN + 1e-9 < ccD) {
      shortfallFlags.push(`expected-citation coverage below direct (${(ccN * 100).toFixed(0)} % vs ${(ccD * 100).toFixed(0)} %)`);
    }
    /* Brevity is only a shortfall where a short answer cannot be a complete one.
     *
     * The statute-FAQ answer is 442 chars against direct's 2,036 and is *correct*
     * — a lookup should return the provision, not an essay. Treating that as a
     * withheld saving punished the platform for doing the right thing. So the
     * length check applies only to classes that must reason; for deterministic
     * classes a short answer is the point. */
    if (requiresModel
        && nyvAnswer && directAnswer && nyvAnswer.length * 4 < directAnswer.length) {
      shortfallFlags.push(`answer under a quarter the length of direct (${nyvAnswer.length} vs ${directAnswer.length} chars) on a class that requires reasoning`);
    }
    const cheaper = typeof cost.costUsd === 'number' && typeof dcost.costUsd === 'number' && cost.costUsd < dcost.costUsd;
    const flags = [...attribution.flags, ...shortfallFlags];

    byClass.get(classId).push({
      rec, item, ok, meterVerdict, cost, dcost,
      nyvAnswer, directAnswer,
      attribution,
      qualityFlags: flags,
      /* A saving is withheld when it is cheaper AND either the mechanism was
       * wrong / unknown, or the content fell short. `countsAsSaving === true`
       * (an attributed cache or deterministic win) can still be withheld by a
       * content shortfall — a cache hit that returns a thinner answer than
       * direct is not free, it is cheap and worse. */
      unearnedSaving: cheaper && (
        attribution.countsAsSaving === false || shortfallFlags.length > 0
      ),
    });
  }

  const classRows = [];
  for (const [classId, entries] of byClass) {
    const okEntries = entries.filter((e) => e.ok);
    /* COLD vs WARM.
     *
     * `--runs N` repeats the SAME prompt, so runs 2..N can be served from the
     * semantic cache. Measured on jrx-prod: single-issue-advice cost $0.0448 on run
     * 1 and $0.0000 on runs 2 and 3, all three byte-identical at 6,334 chars. The
     * naive mean of those, $0.0149, is not this class's cost — it is the cost of
     * asking the same question three times in a row, which no real traffic mix
     * does. Averaging it in would let the harness manufacture a 67 % saving out of
     * its own repetition.
     *
     * So the headline per-class figures use COLD runs only (run 1), and the warm
     * repeats are reported separately as the cache benefit they actually are.
     * Repeat-to-repeat spread is therefore NOT independent-sample variance and
     * must not be quoted as a confidence interval.
     */
    const cold = okEntries.filter((e) => e.rec.run === 1);
    const warm = okEntries.filter((e) => e.rec.run !== 1);
    const src = cold.length ? cold : (okEntries.length ? okEntries : entries);
    const pick = (fn) => src.map(fn).filter((v) => typeof v === 'number' && Number.isFinite(v));

    const nyvCost = pick((e) => e.cost.costUsd);
    const dirCost = pick((e) => e.dcost.costUsd);
    /* Cache-hit rate now comes from the ATTRIBUTED resolution, not from
     * `truth.cacheHintLines`. Those log lines were counted across a time window
     * with no requestId, so on a shared host they attributed another request's
     * cache hit to this one — the same window-scope defect that invalidated the
     * v1 fan-out numbers. */
    const cacheHits = src.filter((e) => e.attribution?.resolution === 'semantic-cache').length;
    const attributedSrc = src.filter(
      (e) => e.attribution?.signal === 'envelope' || e.attribution?.signal === 'log',
    ).length;

    classRows.push({
      classId,
      weight: set.classes?.[classId]?.weight ?? 0,
      runs: entries.length,
      okRuns: okEntries.length,
      coldRuns: cold.length,
      warmRuns: warm.length,
      httpFailures: entries.length - okEntries.length,
      // Cache benefit measured on repeats of an identical prompt. Real and worth
      // reporting; NOT folded into the headline cost, because the frozen weighting
      // does not claim that share of traffic is an exact repeat.
      warm: warm.length ? {
        costUsd: mean(warm.map((e) => e.cost.costUsd).filter((v) => typeof v === 'number')),
        completions: mean(warm.map((e) => e.rec.truth?.billedCompletions).filter((v) => typeof v === 'number')),
        latencySec: mean(warm.map((e) => e.rec.nyv?.wallSec).filter((v) => typeof v === 'number')),
        // Compared PER ITEM. A class can hold more than one prompt
        // (statute-mapping has IPC->BNS and CrPC->BNSS), so comparing every warm
        // answer against one cold answer reported "cache returned different text"
        // when the two prompts simply have different answers.
        identicalToColdAnswer: warm.every((e) => {
          const c = cold.find((x) => x.rec.itemId === e.rec.itemId);
          return c ? e.nyvAnswer === c.nyvAnswer : true;
        }),
      } : null,
      nyv: {
        promptTokens: mean(pick((e) => e.rec.nyv?.envelopePromptTokens)),
        completionTokens: mean(pick((e) => e.rec.nyv?.envelopeCompletionTokens)),
        completions: mean(pick((e) => e.rec.truth?.billedCompletions)),
        completionsEnvelope: mean(pick((e) => e.rec.nyv?.envelopeCompletions)),
        costUsd: mean(nyvCost),
        costStdev: stdev(nyvCost),
        wastedCostUsd: mean(pick((e) => e.cost.wastedCostUsd)),
        latencySec: mean(pick((e) => e.rec.nyv?.wallSec)),
        cacheHitRate: src.length ? cacheHits / src.length : null,
        answerChars: mean(pick((e) => e.rec.nyv?.answerChars)),
        structuredCitations: mean(pick((e) => e.rec.nyv?.structuredCitationCount)),
        textCitations: mean(src.map((e) => textCitationMatches(e.nyvAnswer))),
        expectedCitationCoverage: mean(
          src.map((e) => coverage(e.nyvAnswer, e.item?.expectedCitations)).filter((v) => v != null),
        ),
        keywordCoverage: mean(
          src.map((e) => coverage(e.nyvAnswer, e.item?.expectedAnswerKeywords)).filter((v) => v != null),
        ),
        emptyAnswers: src.filter((e) => num(e.rec.nyv?.answerChars) === 0).length,
        residualPromptTokens: mean(pick((e) => e.cost.residualPromptTokens)),
        residualCompletionTokens: mean(pick((e) => e.cost.residualCompletionTokens)),
      },
      direct: {
        promptTokens: mean(pick((e) => e.rec.direct?.promptTokens)),
        completionTokens: mean(pick((e) => e.dcost.completionTokensBilled)),
        completions: src.length ? 1 : null,
        costUsd: mean(dirCost),
        costStdev: stdev(dirCost),
        latencySec: mean(pick((e) => e.rec.direct?.wallSec)),
        answerChars: mean(pick((e) => e.rec.direct?.answerChars)),
        textCitations: mean(src.map((e) => textCitationMatches(e.directAnswer))),
        expectedCitationCoverage: mean(
          src.map((e) => coverage(e.directAnswer, e.item?.expectedCitations)).filter((v) => v != null),
        ),
        keywordCoverage: mean(
          src.map((e) => coverage(e.directAnswer, e.item?.expectedAnswerKeywords)).filter((v) => v != null),
        ),
        errors: src.filter((e) => e.rec.direct?.error || String(e.rec.direct?.http) !== '200').length,
      },
      notes: [...new Set(entries.flatMap((e) => e.cost.notes))],
      qualityFlags: [...new Set(entries.flatMap((e) => e.qualityFlags))],
      // Distinct verdicts seen in this class, so the report can say WHY a class
      // was free rather than only that it was.
      attributionVerdicts: [...new Set(entries.map((e) => e.attribution?.verdict).filter(Boolean))],
      attributionSignals: [...new Set(entries.map((e) => e.attribution?.signal).filter(Boolean))],
      /* Share of runs whose zero-cost mechanism was STATED rather than guessed.
       * Below 1 on a class with zero-cost runs means the instrument is partly
       * blind on that class and its saving is not yet defensible. */
      attributedRate: src.length ? attributedSrc / src.length : null,
      unearnedSaving: entries.some((e) => e.unearnedSaving),
      entries,
    });
  }

  // ── blend ──────────────────────────────────────────────────────────────────
  const blendable = classRows.filter(
    (r) => r.weight > 0 && typeof r.nyv.costUsd === 'number' && typeof r.direct.costUsd === 'number',
  );
  const declaredWeight = classRows.reduce((s, r) => s + r.weight, 0);
  const coveredWeight = blendable.reduce((s, r) => s + r.weight, 0);
  const norm = coveredWeight > 0 ? coveredWeight : 1;

  const blend = (sel) => blendable.reduce((s, r) => s + (r.weight / norm) * (sel(r) ?? 0), 0);
  const nyvBlended = blend((r) => r.nyv.costUsd);
  const dirBlended = blend((r) => r.direct.costUsd);

  /* Second blend with unearned savings withheld.
   *
   * §2.6: "A cost win on any prompt whose quality score drops is reported as a
   * regression, not a saving." A class flagged `unearnedSaving` got cheap by
   * answering something else (out-of-scope fast path, cache false positive), so
   * its JRX cost is replaced with the direct cost — i.e. that class is credited
   * with ZERO saving rather than with a fictional 100 % one. This is the figure
   * to quote; the unadjusted one above is kept only so the difference between
   * them is visible.
   */
  const withheld = blendable.filter((r) => r.unearnedSaving);
  const nyvBlendedAdj = blendable.reduce(
    (s, r) => s + (r.weight / norm) * (r.unearnedSaving ? r.direct.costUsd : r.nyv.costUsd), 0,
  );

  /* Set-separation self-test (v2 `cacheIsolation.runtimeSelfTest`).
   *
   * A prompt declared `expect-miss` that comes back served from the semantic
   * cache means the set's prompts were not far enough apart ON THIS BUILD, so
   * every zero-cost row in the pass is suspect. Offline screens cannot establish
   * this — only the live gate can — so it is checked here and reported as VOID
   * rather than left to be noticed in the per-run detail. v1 sets declare no
   * `cacheExpectation`, so this is inert for them instead of retroactively
   * failing them for a field they never had. */
  const separationViolations = attributions
    .filter((a) => {
      const item = set.prompts.find((p) => p.id === a.itemId);
      return item?.cacheExpectation === 'expect-miss'
        && a.run === 1
        && a.resolution === 'semantic-cache';
    })
    .map((a) => ({
      itemId: a.itemId,
      classId: a.classId,
      resolutionDetail: a.resolutionDetail,
      semanticMatch: a.semanticMatch,
    }));

  return {
    classRows,
    separation: {
      selfTestApplies: set.prompts.some((p) => p.cacheExpectation === 'expect-miss'),
      violations: separationViolations,
      verdict: separationViolations.length > 0 ? 'SEPARATION_VOID' : 'ok',
    },
    blended: {
      weightDeclared: declaredWeight,
      weightCovered: coveredWeight,
      weightRenormalised: coveredWeight !== declaredWeight,
      weightMissing: classRows
        .filter((r) => r.weight > 0 && !blendable.includes(r))
        .map((r) => ({ classId: r.classId, weight: r.weight, reason: 'no comparable cost pair' })),
      nyvCostUsd: nyvBlended,
      directCostUsd: dirBlended,
      costReductionPct: dirBlended > 0 ? (1 - nyvBlended / dirBlended) * 100 : null,
      // Quality-withheld variant — the defensible number.
      nyvCostUsdQualityWithheld: nyvBlendedAdj,
      costReductionPctQualityWithheld: dirBlended > 0 ? (1 - nyvBlendedAdj / dirBlended) * 100 : null,
      withheldClasses: withheld.map((r) => ({ classId: r.classId, weight: r.weight, flags: r.qualityFlags })),
      withheldWeight: withheld.reduce((s, r) => s + r.weight, 0),
      nyvWastedCostUsd: blend((r) => r.nyv.wastedCostUsd),
      nyvPromptTokens: blend((r) => r.nyv.promptTokens),
      directPromptTokens: blend((r) => r.direct.promptTokens),
      nyvCompletionTokens: blend((r) => r.nyv.completionTokens),
      directCompletionTokens: blend((r) => r.direct.completionTokens),
      nyvLatencySec: blend((r) => r.nyv.latencySec),
      directLatencySec: blend((r) => r.direct.latencySec),
      nyvCacheHitRate: blend((r) => r.nyv.cacheHitRate),
    },
    meteringMismatches,
    failures,
    attributions,
    attributionSummary: summariseAttribution(attributions),
    meteringVerdict: meteringMismatches.length > 0 ? 'METERING_REGRESSION' : 'ok',
  };
}
