/**
 * NV-BENCH-COST-001 (rendering) — the report is part of the instrument.
 *
 * Rules encoded here, not left to the reader:
 *   - the class weighting is printed with the blended figure, always;
 *   - a single run is labelled as a single run, never as an average;
 *   - metering disagreement is the HEADLINE, above the cost figure;
 *   - quality is printed beside cost, and is explicitly marked NOT a legal-quality
 *     score;
 *   - residual/unaccounted lines are printed wherever totals do not reconcile;
 *   - the set's own separation self-test is printed ABOVE the cost figure, because
 *     a set that cross-hits its own cached answers measures itself.
 */
import path from 'node:path';

const f = (v, d = 2) => (typeof v === 'number' && Number.isFinite(v) ? v.toFixed(d) : '—');
const f6 = (v) => (typeof v === 'number' && Number.isFinite(v) ? v.toFixed(6) : '—');
const i = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v).toLocaleString('en-US') : '—');
const pct = (v) => (typeof v === 'number' && Number.isFinite(v) ? `${v.toFixed(1)} %` : '—');

export function renderReport({ set, raw, agg }) {
  const L = [];
  const p = (s = '') => L.push(s);
  const b = agg.blended;
  const singleRun = (raw.runsPerPrompt ?? 1) === 1;

  p(`# JRX cost benchmark — ${raw.label || 'unlabelled'}`);
  p('');
  p(`- set: \`${raw.setId}\` v${raw.setVersion} (frozen ${raw.setFrozenAt})`);
  p(`- started: ${raw.startedAt || '—'}  finished: ${raw.finishedAt || '—'}`);
  p(`- build under test: image \`${raw.build?.imageSha?.slice(0, 19) || '?'}\`, container created ${raw.build?.containerCreated || '?'}`);
  p(`- baseline: **direct ${raw.baseline?.providerModelName}** (catalog \`${raw.baseline?.catalogModelId}\`, legalQuality ${raw.baseline?.catalogLegalQuality}), raw user prompt, no system instruction`);
  p(`- runs per prompt: **${raw.runsPerPrompt ?? 1}**${singleRun ? ' — SINGLE RUN. The per-class numbers below are single observations, not stable averages. No variance is claimable from this pass.' : ''}`);
  p(`- prices: read from the DEPLOYED \`model-catalog.ts\` (${raw.prices?.count ?? 0} priced models), not from a second hardcoded table`);
  if (raw.buildChangedMidRun) {
    p('');
    p(`> **INVALID PASS — the gateway image changed mid-run** (at item ${raw.buildChangedMidRun.atItem}). Rows before and after that point describe different builds. Re-run.`);
  }
  p('');

  // ── headline 1: metering integrity, ABOVE the cost figure ──────────────────
  p('## 1. Metering integrity (gate — read before the cost figure)');
  p('');
  const verdicts = agg.classRows.flatMap((r) => r.entries.map((e) => e.meterVerdict));
  const tally = verdicts.reduce((m, v) => ({ ...m, [v]: (m[v] || 0) + 1 }), {});
  p(`envelope \`cost.completions\` vs independent count from provider log lines, per run: ${Object.entries(tally).map(([k, v]) => `${v}× ${k}`).join(', ') || '—'}`);
  p('');
  if (agg.meteringMismatches.length) {
    p('**METERING REGRESSION — the envelope and the independent count disagree. No percentage from this pass is publishable.**');
    p('');
    p('| item | class | run | envelope | provider log | scope |');
    p('|---|---|---:|---:|---:|---|');
    for (const m of agg.meteringMismatches) p(`| ${m.itemId} | ${m.classId} | ${m.run} | ${m.envelope} | ${m.log} | ${m.scope} |`);
  } else {
    p('No `requestId`-scoped disagreement found. Runs marked `inconclusive-window-scope` are ones where the orchestrator log lines did not carry the envelope\'s `requestId`, so the independent count is scoped to a log **window** instead and can be inflated by concurrent traffic on this shared dev host. Those are reported as inconclusive rather than as a match — a window-scoped agreement is weaker evidence than a request-scoped one.');
  }
  p('');
  const inconclusive = agg.classRows.flatMap((r) => r.entries)
    .filter((e) => e.meterVerdict === 'inconclusive-window-scope');
  if (inconclusive.length) {
    p('Window-scoped runs, with the distinct `requestId`s seen on the provider log lines. If they are all equal the window caught one request and the count is trustworthy despite the scope; if they differ, another request\'s traffic is mixed in and the fan-out figure for that row is not this request\'s:');
    p('');
    p('| item | class | envelope | log | distinct log requestIds |');
    p('|---|---|---:|---:|---|');
    for (const e of inconclusive) {
      const ids = [...new Set((e.rec.truthCalls || []).map((c) => c.requestId).filter(Boolean))];
      p(`| ${e.rec.itemId} | ${e.rec.classId} | ${e.rec.nyv?.envelopeCompletions} | ${e.rec.truth?.billedCompletions} | ${ids.length === 0 ? 'not recorded by this build of the runner' : `${ids.length}: ${ids.map((x) => String(x).slice(0, 8)).join(', ')}`} |`);
    }
    p('');
  }

  // ── headline 2: the blended figure ─────────────────────────────────────────
  p('## 2. Blended cost reduction vs direct LLM calls');
  p('');
  /* Set separation is a gate on the blend, not a footnote: if the set's own
   * prompts cross-hit each other's cached answers, the zero-cost rows below are
   * the set measuring itself. Printed before any figure so it cannot be quoted
   * past. */
  if (agg.separation?.selfTestApplies) {
    if (agg.separation.verdict === 'SEPARATION_VOID') {
      p(`> **PASS VOID — set separation failed on this build.** ${agg.separation.violations.length} prompt(s) declared \`expect-miss\` were served from the semantic cache on a COLD run: `
        + `${agg.separation.violations.map((v) => `#${v.itemId} (${v.classId})`).join(', ')}. `
        + 'The cost-bearing prompts are not far enough apart for the live embedding gate, so every zero-cost row below may be another prompt\'s answer. No figure from this pass is quotable. Re-separate the set before re-running.');
      p('');
    } else {
      p('Set separation self-test: **passed** — no cold run of a prompt declared `expect-miss` was served from the semantic cache, so the zero-cost rows below are not this set cross-hitting itself. This is the check v1 never had.');
      p('');
    }
  } else {
    p('Set separation self-test: **not applicable** — this set declares no per-prompt `cacheExpectation`, so a cross-prompt cache hit cannot be detected and any zero-cost row below may be another prompt\'s answer (the v1 defect). Use the v2 set to close this.');
    p('');
  }
  p(`| | JRX orchestrated | direct ${raw.baseline?.providerModelName} |`);
  p('|---|---:|---:|');
  p(`| blended cost / request (USD) | **${f6(b.nyvCostUsd)}** | **${f6(b.directCostUsd)}** |`);
  p(`| blended prompt tokens | ${i(b.nyvPromptTokens)} | ${i(b.directPromptTokens)} |`);
  p(`| blended completion tokens | ${i(b.nyvCompletionTokens)} | ${i(b.directCompletionTokens)} |`);
  p(`| blended latency (s) | ${f(b.nyvLatencySec)} | ${f(b.directLatencySec)} |`);
  p('');
  p(`### Measured blended cost reduction: **${pct(b.costReductionPct)}**`);
  p('');
  if (b.withheldClasses?.length) {
    p(`### Adjusted for unearned savings: **${pct(b.costReductionPctQualityWithheld)}**  ← the defensible figure`);
    p('');
    p(`${b.withheldClasses.length} class(es) totalling weight ${f(b.withheldWeight, 2)} were cheap for the WRONG REASON — they answered something other than the question asked. Per §2.6 a cost win on a prompt whose quality drops is a **regression, not a saving**, so those classes are credited with zero saving in the adjusted figure rather than with a fictional 100 % one:`);
    p('');
    p('| class | weight | why the saving is not real |');
    p('|---|---:|---|');
    for (const w of b.withheldClasses) p(`| ${w.classId} | ${f(w.weight, 2)} | ${w.flags.join('; ')} |`);
    p('');
  }
  if (typeof b.costReductionPct === 'number') {
    const headline = b.withheldClasses?.length ? b.costReductionPctQualityWithheld : b.costReductionPct;
    p(headline >= 70
      ? '`>= 70 %`. It is only claimable with the set version, the weighting, the build, and the metering verdict above attached to it.'
      : `**BELOW the 70 % headline claim.** Measured ${pct(headline)}. See §3 for which classes drag it down. Do not re-frame this figure upward.`);
  } else {
    p('Not computable — no class produced a comparable JRX/direct cost pair.');
  }
  p('');
  p(`Discarded spend (hedge loser / deadline-abandoned) is **excluded** from the JRX figure above and totals ${f6(b.nyvWastedCostUsd)} USD/request blended. Against TRUE provider spend (billable + wasted) the reduction is ${pct(b.directCostUsd > 0 ? (1 - (b.nyvCostUsd + b.nyvWastedCostUsd) / b.directCostUsd) * 100 : null)}.`);
  p('');
  p('**Weighting used to blend** (a blended figure without this is meaningless):');
  p('');
  p('| class | weight | in blend |');
  p('|---|---:|---|');
  for (const r of agg.classRows.slice().sort((x, y) => y.weight - x.weight)) {
    const inBlend = r.weight > 0 && typeof r.nyv.costUsd === 'number' && typeof r.direct.costUsd === 'number';
    p(`| ${r.classId} | ${f(r.weight, 2)} | ${inBlend ? 'yes' : r.weight === 0 ? 'no — correctness probe (weight 0)' : 'NO — no comparable cost pair'} |`);
  }
  p('');
  p(`Declared weight ${f(b.weightDeclared, 2)}; weight actually covered ${f(b.weightCovered, 2)}.` +
    (b.weightRenormalised
      ? ` **Weights were renormalised over the covered classes**, so the blended figure describes only that ${pct(b.weightCovered * 100)} of the assumed mix. Missing: ${b.weightMissing.map((m) => `${m.classId} (${m.weight})`).join(', ') || 'none'}.`
      : ' No renormalisation was needed.'));
  p('');
  p(`Weighting provenance: ${set.weighting.provenance}`);
  p('');
  p(`> ${set.weighting.honestCaveat}`);
  p('');
  /* Trivial lookups are excluded from the headline by carrying weight 0, so
   * without their own line they would vanish from the report entirely — and the
   * size of the padding they contributed to v1's headline would be invisible. */
  const trivialRows = agg.classRows.filter((r) => {
    const cls = set.classes?.[r.classId];
    return cls?.reportSeparately === true;
  });
  if (trivialRows.length) {
    p('**Trivial lookups — reported separately, NOT in the headline above.**');
    p('');
    p(`In v1 these classes carried ${trivialRows.reduce((s, r) => s + (set.classes[r.classId].mixShare ?? 0), 0).toFixed(2)} of the blended weight at a free 100 % saving, which is that much headline handed over by the set's composition rather than earned by the platform. They are measured here and excluded from the blend.`);
    p('');
    p('| class | assumed mix share | cost USD JRX/direct | cut | fan-out JRX |');
    p('|---|---:|---|---:|---:|');
    for (const r of trivialRows) {
      const cut = (typeof r.nyv.costUsd === 'number' && typeof r.direct.costUsd === 'number' && r.direct.costUsd > 0)
        ? pct((1 - r.nyv.costUsd / r.direct.costUsd) * 100)
        : '—';
      p(`| ${r.classId} | ${f(set.classes[r.classId].mixShare, 2)} | ${f6(r.nyv.costUsd)} / ${f6(r.direct.costUsd)} | ${cut} | ${f(r.nyv.completions, 1)} |`);
    }
    p('');
  }

  // ── per-class cost table ───────────────────────────────────────────────────
  p('## 3. Per-class: JRX vs direct');
  p('');
  p('| class | w | n | prompt tok JRX/direct | compl tok JRX/direct | fan-out JRX/direct | cost USD JRX/direct | cut | latency s JRX/direct | cache hit |');
  p('|---|---:|---:|---|---|---|---|---:|---|---:|');
  for (const r of agg.classRows) {
    const cut = (typeof r.nyv.costUsd === 'number' && typeof r.direct.costUsd === 'number' && r.direct.costUsd > 0)
      ? pct((1 - r.nyv.costUsd / r.direct.costUsd) * 100)
      : (r.nyv.costUsd === 0 ? '100.0 %' : '—');
    p(`| ${r.classId}${r.unearnedSaving ? ' **⚠ unearned**' : ''} | ${f(r.weight, 2)} | ${r.okRuns}/${r.runs} | ${i(r.nyv.promptTokens)} / ${i(r.direct.promptTokens)} | ` +
      `${i(r.nyv.completionTokens)} / ${i(r.direct.completionTokens)} | ${f(r.nyv.completions, 1)} / ${f(r.direct.completions, 1)} | ` +
      `${f6(r.nyv.costUsd)} / ${f6(r.direct.costUsd)} | ${cut} | ${f(r.nyv.latencySec)} / ${f(r.direct.latencySec)} | ` +
      `${r.nyv.cacheHitRate == null ? '—' : pct(r.nyv.cacheHitRate * 100)} |`);
  }
  p('');
  p('⚠ **unearned** = cheaper than direct, but the answer did not answer the question (see §2 and §5). Its `cut` column is a fiction and is excluded from the adjusted blend.');
  p('`fan-out JRX` is the **independent** count from provider log lines, not the envelope\'s claim. Direct is 1 by construction (one call, no retry) — where a real naive integration would retry or hedge, the baseline is understated and this comparison is conservative against JRX.');
  p('');
  const drags = agg.classRows
    .filter((r) => r.weight > 0 && typeof r.nyv.costUsd === 'number' && typeof r.direct.costUsd === 'number' && r.direct.costUsd > 0)
    .map((r) => ({ classId: r.classId, cut: (1 - r.nyv.costUsd / r.direct.costUsd) * 100, weight: r.weight, drag: r.weight * (r.nyv.costUsd - r.direct.costUsd) }))
    .sort((x, y) => y.drag - x.drag);
  if (drags.length) {
    p('**Classes that drag the blend down** (weight × excess cost over direct, worst first):');
    p('');
    p('| class | weight | class-level cut | weighted excess cost USD |');
    p('|---|---:|---:|---:|');
    for (const d of drags) p(`| ${d.classId} | ${f(d.weight, 2)} | ${pct(d.cut)} | ${f6(d.drag)} |`);
    p('');
  }

  // ── residuals ──────────────────────────────────────────────────────────────
  p('## 4. Residual / unaccounted');
  p('');
  p('| class | residual prompt tok | residual compl tok | unpriced calls | notes |');
  p('|---|---:|---:|---:|---|');
  for (const r of agg.classRows) {
    const unpriced = r.entries.reduce((s, e) => s + (e.cost.unpricedCalls || 0), 0);
    p(`| ${r.classId} | ${i(r.nyv.residualPromptTokens)} | ${i(r.nyv.residualCompletionTokens)} | ${unpriced} | ${r.notes.join('; ') || '—'} |`);
  }
  p('');
  p('A residual is envelope-reported tokens that no provider log line accounted for. `hedge success` lines carry no token counts (llm-orchestrator.ts:1293), so on hedge-won requests the residual is attributed pro rata across those calls and priced at their own model; anything still unattributed is printed above and means the JRX cost figure is **understated** by that much.');
  p('');

  // ── quality ────────────────────────────────────────────────────────────────
  p('## 5. Quality signals captured alongside cost');
  p('');
  p('> **These are NOT a legal-quality score and must never be presented as one.** They are containment and shape checks that make a cost win from *silently answering less* visible. Legal correctness was **NOT verified** by this harness.');
  p('');
  p('| class | answer chars JRX/direct | struct. citations JRX | text citations JRX/direct | expected-citation coverage JRX/direct | keyword coverage JRX/direct | empty JRX | direct errors |');
  p('|---|---|---:|---|---|---|---:|---:|');
  for (const r of agg.classRows) {
    p(`| ${r.classId} | ${i(r.nyv.answerChars)} / ${i(r.direct.answerChars)} | ${f(r.nyv.structuredCitations, 1)} | ` +
      `${f(r.nyv.textCitations, 1)} / ${f(r.direct.textCitations, 1)} | ` +
      `${r.nyv.expectedCitationCoverage == null ? '—' : pct(r.nyv.expectedCitationCoverage * 100)} / ${r.direct.expectedCitationCoverage == null ? '—' : pct(r.direct.expectedCitationCoverage * 100)} | ` +
      `${r.nyv.keywordCoverage == null ? '—' : pct(r.nyv.keywordCoverage * 100)} / ${r.direct.keywordCoverage == null ? '—' : pct(r.direct.keywordCoverage * 100)} | ` +
      `${r.nyv.emptyAnswers} | ${r.direct.errors} |`);
  }
  p('');
  const flagged = agg.classRows.filter((r) => r.qualityFlags.length);
  if (flagged.length) {
    p('Quality shortfalls detected (per run, deduplicated per class):');
    p('');
    p('| class | cheaper than direct | shortfall |');
    p('|---|---|---|');
    for (const r of flagged) {
      p(`| ${r.classId} | ${r.unearnedSaving ? '**yes — saving withheld**' : 'no'} | ${r.qualityFlags.join('; ')} |`);
    }
    p('');
    p('Per §2.6 a cost win on a prompt whose quality drops is reported as a **regression, not a saving**. The rows marked "saving withheld" are excluded from the adjusted blend in §2. They still need SME scoring — the shortfall detector above is mechanical, not legal judgement.');
  } else {
    p('No quality shortfall detected against the direct baseline on any class. That is a weak signal, not a quality pass.');
  }
  p('');
  for (const note of set.qualitySignals.notCaptured) p(`- NOT captured: ${note}`);
  p('');
  p('Raw JRX and direct answers for every run are written to `answers/` in this artifact directory for human/SME scoring.');
  p('');

  // ── zero-cost attribution ──────────────────────────────────────────────────
  p('## 5a. Why each zero-cost answer was free (attribution)');
  p('');
  const at = agg.attributionSummary || {};
  p('A zero-completion answer is not self-explaining. A semantic-cache hit and a deterministic-tier answer are genuine savings; the same tier answering a question it should have escalated is a quality failure that *looks* like a 100 % saving. The verdicts below are read from the response envelope\'s `cost.resolution` (NV-ZEROCOST-ATTRIBUTION-001) or the request-scoped resolution log line — **not** inferred from the completion count.');
  p('');
  p('| verdict | runs | counts as a saving |');
  p('|---|---:|---|');
  const SAVING_LABEL = {
    'billed-llm': 'n/a — real spend, priced normally',
    'cache-win-fresh': 'YES — reported separately (hit on a fresh question)',
    'cache-win-repeat': 'YES — reported separately (hit on a declared repeat)',
    'deterministic-win': 'YES',
    'deterministic-over-fire': 'NO — quality failure',
    'cache-cross-hit': 'NO — quality failure (answered a different prompt)',
    'signal-conflict': 'NO — signals disagree',
    abstain: 'NO — free, but not an answer',
    unattributable: 'NO — instrument cannot see the mechanism',
  };
  for (const [v, n] of Object.entries(at.byVerdict || {})) {
    p(`| ${v} | ${n} | ${SAVING_LABEL[v] || '—'} |`);
  }
  p('');
  p(`Signal provenance: ${Object.entries(at.bySignal || {}).map(([k, v]) => `${v}× ${k}`).join(', ') || '—'}. \`envelope\`/\`log\` are stated by the code that knows; \`model-name\` is inferred from \`cost.model\` and can identify a deterministic answer but **never** a cache hit (a cache hit reports the original model's name); \`none\` means nothing said and the run is \`unattributable\`.`);
  p('');
  if (at.instrumentGapRuns > 0) {
    p(`> **${at.instrumentGapRuns} run(s) are UNATTRIBUTABLE.** Their cost is real but the mechanism behind it is not observable, so they are credited with no saving. That is an instrument gap, not a platform defect, and it is a different problem from the ${at.qualityFailureRuns} quality-failure run(s) above — do not report the two together.`);
    p('');
  }
  if (at.cacheWinRuns > 0) {
    p(`Cache wins are split: **${at.cacheWinFreshRuns}** on a fresh question, **${at.cacheWinRepeatRuns}** on a declared repeat. These do not generalise the same way — repeat-hit rate is a property of the traffic mix (unmeasured), whereas a fresh-question hit reflects what is already stored. Blending them lets a benchmark's own repetition set the hit rate.`);
    p('');
  }
  const partialAttr = agg.classRows.filter((r) => r.attributedRate != null && r.attributedRate < 1);
  if (partialAttr.length) {
    p('| class | share of runs with a STATED resolution | verdicts seen |');
    p('|---|---:|---|');
    for (const r of partialAttr) {
      p(`| ${r.classId} | ${pct(r.attributedRate * 100)} | ${r.attributionVerdicts.join(', ') || '—'} |`);
    }
    p('');
    p('A class below 100 % is one where the harness is partly blind. Its saving is not yet defensible.');
    p('');
  }

  // ── correctness probes ─────────────────────────────────────────────────────
  p('## 6. Correctness probes (weight 0 — a cost win here can be a failure)');
  p('');
  for (const r of agg.classRows.filter((x) => x.weight === 0)) {
    for (const e of r.entries) {
      const item = e.item || {};
      const billed = e.rec.truth?.billedCompletions;
      let verdict = 'recorded';
      if (item.correctnessOnly && typeof item.expectFanoutMin === 'number') {
        verdict = typeof billed === 'number' && billed >= item.expectFanoutMin
          ? `PASS — ${billed} completion(s), did not take a zero-LLM fast path`
          : `FAIL — ${billed} completion(s): a strategy question appears to have taken the FAQ fast path (NV-STATUTE-FAQ-SCOPE-001)`;
      } else if (typeof item.expectFanoutMax === 'number') {
        verdict = typeof billed === 'number' && billed <= item.expectFanoutMax
          ? `PASS — ${billed} completion(s) <= ${item.expectFanoutMax}`
          : `FAIL — ${billed} completion(s) > ${item.expectFanoutMax} expected`;
      }
      /* `failIfResolution` names the mechanisms that would make a zero-cost
       * result on this probe a failure. It fails the probe on a completion count
       * of zero AND a named mechanism, which is stricter than the count alone:
       * a fast path that answers a research question is a failure even though the
       * count looks identical to a legitimate cache hit. */
      if (Array.isArray(item.failIfResolution) && item.failIfResolution.includes(e.attribution?.resolution)) {
        verdict = `FAIL — resolved by \`${e.attribution.resolution}\` on a prompt that must escalate (${e.attribution.verdict})`;
      }
      if (Array.isArray(item.expectedResolution) && e.attribution?.resolution
          && !item.expectedResolution.includes(e.attribution.resolution)) {
        verdict += `; resolution \`${e.attribution.resolution}\` is outside this item's expected set (${item.expectedResolution.join(', ')})`;
      }
      p(`- **#${item.id} ${r.classId}** (${item.mustProve || ''}): ${verdict}. answer ${e.rec.nyv?.answerChars} chars, attribution: ${e.attribution?.verdict || '—'} (signal ${e.attribution?.signal || 'none'}${e.attribution?.resolutionDetail ? `, ${e.attribution.resolutionDetail}` : ''})`);
    }
  }
  p('');
  p('Deterministic-tier expectations on the weighted classes:');
  for (const r of agg.classRows) {
    for (const e of r.entries) {
      const item = e.item || {};
      if (item.expectFanoutMax !== 0 || item.weight === 0) continue;
      const billed = e.rec.truth?.billedCompletions;
      p(`- **#${item.id} ${r.classId}** must be 0 completions: measured **${billed}** — ${billed === 0 ? 'PASS' : 'FAIL (deterministic-tier miss, NV-DETERMINISTIC-FIRST-001)'}${billed === 0 ? ` via ${e.attribution?.verdict || 'unattributed'}` : ''}`);
    }
  }
  p('');

  // ── coverage / limits ──────────────────────────────────────────────────────
  p('## 7. Sample size, variance, and what this harness does NOT cover');
  p('');
  p(`- Sample: ${agg.classRows.reduce((s, r) => s + r.runs, 0)} run(s) total across ${agg.classRows.length} classes, ${raw.runsPerPrompt ?? 1} run(s) per prompt.`);
  const warmRows = agg.classRows.filter((r) => r.warm);
  if (warmRows.length) {
    p('- **Repeats of an identical prompt are NOT independent samples.** Measured here: run 1 is cold, runs 2..N hit the semantic cache and cost ~0. Averaging them would manufacture a saving out of the harness\'s own repetition, so the headline per-class figures above use **cold (run 1) only**. The warm repeats are reported as the cache benefit they are:');
    p('');
    p('| class | cold cost USD | warm cost USD | cold→warm latency s | warm answer identical to cold |');
    p('|---|---:|---:|---|---|');
    for (const r of warmRows) {
      p(`| ${r.classId} | ${f6(r.nyv.costUsd)} | ${f6(r.warm.costUsd)} | ${f(r.nyv.latencySec)} → ${f(r.warm.latencySec)} | ${r.warm.identicalToColdAnswer == null ? '—' : (r.warm.identicalToColdAnswer ? 'yes' : 'NO — cache returned different text')} |`);
    }
    p('');
  }
  /* Variance across distinct inputs is only claimable where the class actually
   * HAS distinct inputs, and that is independent of how many times each prompt
   * was repeated. v1 had one prompt per class, so cold-vs-warm was the only
   * spread available and it is a cache effect, not a sample spread. */
  const coldItemsPerClass = agg.classRows.map((r) => ({
    classId: r.classId,
    distinct: new Set(r.entries.filter((e) => e.rec.run === 1).map((e) => e.rec.itemId)).size,
    weight: r.weight,
  })).filter((x) => x.weight > 0);
  const multi = coldItemsPerClass.filter((x) => x.distinct >= 2);
  if (multi.length) {
    p(`- **Variance across independent inputs: measurable for ${multi.length} of ${coldItemsPerClass.length} weighted class(es)** — ${multi.map((x) => `${x.classId} n=${x.distinct}`).join(', ')}. `
      + 'Per-class cost standard deviation over the COLD runs of those distinct prompts is in `aggregate.json` (`nyv.costStdev`). These are small samples: quote the spread, not a confidence interval.');
    const thin = coldItemsPerClass.filter((x) => x.distinct < 2);
    if (thin.length) p(`- Classes with a single cold prompt, where no spread is claimable: ${thin.map((x) => x.classId).join(', ')}.`);
  } else {
    p('- **Variance across independent inputs: UNKNOWN.** Every weighted class has a single cold prompt, so the only spread available is cold-vs-warm, which is a cache effect and not a confidence interval. Measuring it needs distinct prompts per class.');
    if (singleRun) {
      p('- One run per prompt. The §1.0 repeat test showed micro-FAQ prompt tokens stable within 0.03 % but wall clock varying 27.0–30.9 s (±13 %), so latency figures here carry at least that much noise. Cost figures inherit token stability, not latency stability.');
    }
  }
  p('- The blend excludes discarded (`wasted`) spend from the JRX side; the true-spend variant is stated in §2.');
  /* Longest prompt in the pass, rather than a hardcoded item id: the claim being
   * qualified is "no genuinely large document was measured", and that stays true
   * across sets while the item carrying it does not. */
  const longest = agg.classRows.flatMap((r) => r.entries)
    .map((e) => ({ id: e.item?.id, words: String(e.item?.prompt || '').split(/\s+/).filter(Boolean).length }))
    .sort((a, b) => b.words - a.words)[0];
  p(`- NOT covered: the §2.6 #7 **40-page document** case. The longest prompt in this pass is item #${longest?.id ?? '?'} at ~${longest?.words ?? 0} words, so long-context behaviour under a genuinely large attachment is unmeasured.`);
  p('- NOT covered: **legal correctness**. No automatic legal-quality score is produced (§5).');
  p('- NOT covered: streaming (`/orchestrate/stream`). M3/M4 estimated-vs-provider usage is only observable on streamed calls; `usageSource` tallies per run are in `raw.json`.');
  p('- NOT covered: concurrency / load. Every run is serial and alone, so nothing here speaks to per-request cost under contention.');
  p('- NOT covered: cost of non-LLM infrastructure (RAG embeddings, DB, NYS round trips). §12.1 measured 236 s of a 366 s Queen request as non-LLM time — that time has a real cost this harness does not price.');
  p('- NOT covered: any provider other than the baseline model. "Equivalent-quality" is guaranteed here by using the SAME model JRX itself selects, not by a cross-vendor quality argument.');
  p('');
  p('## 8. Reproduce');
  p('');
  p('```bash');
  p('source scripts/jrx-source-dev-deploy-env.sh');
  p(`node scripts/jrx-benchmark-cost.mjs --label ${raw.label || 'run'} --runs ${raw.runsPerPrompt ?? 1}${raw.setPath ? ` --set ${path.basename(raw.setPath)}` : ''}`);
  p('```');
  p('');
  p(`Command ids for every invocation in this pass are in \`raw.json\` (\`dispatch[]\`), so each row is traceable to an SSM invocation on \`${raw.instanceId || 'the instance'}\`.`);
  return L.join('\n');
}
