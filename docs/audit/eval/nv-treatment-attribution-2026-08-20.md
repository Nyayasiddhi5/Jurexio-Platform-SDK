# Treatment attribution — design, gold set, and measured precision

**NV-CITATOR-ATTRIBUTION-001** · 2026-08-20 · Status: **BUILT AND MEASURED. NO BACKFILL RUN.**
`nv_legal_graph_entities` / `nv_legal_graph_edges` remain **0 rows**, deliberately.

Prerequisite for `documents/working/NYV-TREATMENT-GRAPH-ASSESSMENT-2026-08-19.md` Phase 1.

---

## 0. The one-paragraph answer

The prior objection was correct and is now measured, not argued. Over real full judgment bodies
the existing detector scores **25.0% precision** — 18 false `overruled`/`doubted` findings out of
24 adverse findings on a 32-item corpus gold set. With the attribution step it scores **100.0%
precision (0 false positives) at 66.7% recall**. The ≥95% precision bar is **met**, so the
attribution prerequisite is discharged. Two caveats below (§6) mean the backfill authorisation
should still be **conditional**, not unqualified.

---

## 1. Why a false `overruled` sets the whole design

A false `overruled` makes a lawyer discard valid law, and — unlike a missed overruling — **they
never find out they were wrong**. A miss leaves the verdict at `unknown`, which `GoodLawPanel`
already renders as "not cleared": an honest non-answer with a safety property. The two errors are
therefore not symmetric and must never be averaged into one score.

Every rule in `src/services/nv-citator-attribution.ts` is biased towards emitting **nothing**.
An unattributed treatment is not an edge, it is a miss, and a miss is the cheap error.

---

## 2. What the corpus actually contains (measured, not assumed)

All of the following are verbatim from Supreme Court bodies extracted from the live NYS corpus on
2026-08-20. Each is an `overruled` edge under proximity matching and correctly **nothing** under
attribution:

| Judgment | Text | Why proximity fails |
|---|---|---|
| Sibbia (1980) | "the provisions of Section 438 … **stand overruled** or repealed by virtue of Rule 184" | Object is a **statute**. No case was overruled at all. |
| Vodafone (2012) | "**it was contended on behalf of the Revenue** that … Azadi Bachao … **needs to be overruled**" | Counsel's prayer. Vodafone *approved* Azadi Bachao. |
| Sushila Aggarwal (2018) | "**To quote:-** … the decisions in Salauddin … **are per incuriam**" | Quoting Mhetre. The 2018 order performs nothing; it refers to a larger Bench. |
| Aligarh Muslim University (2024) | "demands due deference **rather than the view being overruled**" | Dissent **declining** to overrule, with the verb fully present. |
| Gayatri Project (2025) | "it **cannot be termed to be per incuriam**" | Explicit negation. |
| Eminent Colonizers (2026) | "the 2015 Amendment Act has **legislatively overruled** the dictum of Patel Engg." | Statutory supersession, not a judicial edge. |
| Interstate Construction (2025) | "S.L. Arora … has since been **overruled by** … **Hyder Consulting** (UK) Ltd." | Hyder Consulting is the **overruling court**. Naive binding inverts the edge. |
| Sushila Aggarwal (2020) | "Sibbia … [1980] 3 SCR 383 – **relied on**. Salauddin … – **overruled**." | Sibbia is **relied on** 40 characters from an adverse marker. |

The last row is the decisive one: Sushila Aggarwal is the judgment that overrules nine
authorities *and expressly relies on Sibbia*, in the same reporter block.

### 2.1 An incidental measured finding

`GET /caselaw/search` FTS indexes **metadata only, not judgment bodies**. `q=stands overruled`
over 43,505 SC judgments returns **0 rows**; `q=anticipatory bail` returns 12 and none of those
bodies contain adverse vocabulary in metadata. So today's `/caselaw/treatment`, which scans
`[title, description, disposalNature, court]`, is looking in a place where treatment language
structurally cannot be. Its `unknown` verdicts are largely an artefact of that, which is the
recall case *for* full bodies — and the reason the precision problem had to be solved first.

---

## 3. The attribution design

`attributeTreatment({ text, phraseIndex, phraseLength, targetAuthority })` →
`{ attributed, method, confidence, veto?, scope }`. Refusal is the default and the common outcome.

### 3.1 Order of operations

1. **Quotation state** (not proximity). `To quote:- "…"` opens a block that runs for paragraphs;
   the nearest opener before the phrase is found and the veto holds until the quotation closes.
   A fixed-width lookback cannot express this — and when one was tried at 900 characters it let a
   counsel submission veto a genuine holding three sentences later, buying a miss for no safety
   gain. Measured both ways; the state machine is strictly better.
2. **Frame vetoes** over the sentence plus one preceding sentence: declining-to-overrule,
   negation, legislative supersession, counsel submission, hypothetical/conditional.
3. **Inversion guard**: `overruled by … <target>` means the target is the *overruling court*.
4. **Reporter verdict list** (`A; B; C – overruled.`). Highest-precision signal in the corpus,
   because the reporter has already done the attribution. A marker governs back to the previous
   marker, so a preceding `relied on` / `distinguished` / `referred to` terminates the group.
5. **Prose binding**, same sentence only. Statutory-object check; then the nearest named
   authority wins — if a non-target is nearer the verb, refuse.

### 3.2 Two non-obvious pieces of machinery

**Abbreviation-aware sentence splitting.** `v. `, `K.L. `, `Ltd. ` all end in period-space. A
naive split puts "Siddharam Satlingappa Mhetre v." in one sentence and "State of Maharashtra …
are hereby overruled" in the next, severing every full-name overruling. Fixing this alone moved
recall 33% → 50%. `ABBREV_BEFORE_SPLIT` is shared with the reporter-list sentence check so a
second ad-hoc list cannot drift.

**Common-name-particle rejection.** `singh` from "Gurbaksh Singh Sibbia" matched inside
"Satpal Singh v. State of Punjab" in a reporter table and produced a false `overruled` for
**Sibbia** — the Kesavananda stem collision in a new costume, on the most consequential possible
authority. Token hits are now clustered (adjacent within 60 chars) and a lone token must be ≥6
chars and not a common particle.

### 3.3 Reuse, not duplication (NV-NO-DUPLICATE-001)

`src/services/nv-authority-identity.ts` is the canonical home for `normaliseAuthorityText`,
`authorityTokens`, `AUTHORITY_STOP`, `AUTHORITY_PLACE_ONLY` — lifted byte-for-byte from
`src/routes/nv-knowledge-plane-routes.ts`, which retains its private copy because that route is
owned by another workstream this session.

**The one-line change that retires the duplicate** (for whoever owns that route next): delete
lines 482–526 of `src/routes/nv-knowledge-plane-routes.ts` and add
`import { authorityTokens, normaliseAuthorityText } from '../services/nv-authority-identity.js';`
at the top. `resolveAuthority` needs no other edit.

Until then `tests/unit/nv-authority-identity.test.ts` asserts the two copies agree on both token
sets, the three normalisation transforms, and the `>= 4` length floor. It fails the moment either
side is edited alone — which is how the `kesavan` ⊂ `kesavananda` collision would otherwise
return.

### 3.4 `extractedBy` stays honest

Every attributed row carries `extractedBy: 'deterministic'` and a new `attributionMethod`
(`citation-span` | `case-name-span` | `reporter-list-verdict`), never `unattributed`. The panel
renders `deterministic` as "Verified phrase" and `llm` as "AI-suggested"; no LLM path was added,
so nothing can be mislabelled. Legacy passage callers that pass no `targetAuthority` behave
exactly as before and emit no `attributionMethod` — verified by test.

---

## 4. The gold set

`docs/audit/eval/nv-treatment-attribution-set.v1.json` — **32 items** over **12 real SC
judgments**, built by `scripts/nv-build-attribution-goldset.mjs` from
`nv-treatment-attribution-annotations.v1.json`.

| | |
|---|---|
| Positives | 6 (5 `overruled`, 1 `doubted`) |
| Negative controls | **26** |
| Control classes | relied-on 3, quotation 6, submission 4, different-case 4, third-party-report 4, statutory-object 2, declined 1, negated 1, legislative 1 |
| Label basis | **32 / 32 text-derived**, 0 needing counsel *for scoring* |

### 4.1 What the labels claim, and what they do not

`expected` answers **"does this passage state that the named authority was overruled or
doubted?"** — a text-reading question checkable against the stored `evidence` slice by anyone
literate. It does **not** answer "is this authority good law today".

**Which labels need a practising advocate.** None of the 32 *scored* labels do, by construction:
the harness scores only text-derived labels and refuses to score legal-status claims. But the
**legal-status** reading of these same pairs does need counsel, and three in particular:

- **Mhetre / Salauddin as of today** — Sushila Aggarwal overruled them *to the extent of* the
  restrictive-conditions holding. Partial. The text says "to that extent"; whether an advocate
  may still cite Mhetre for anything else is a legal question I am not qualified to answer.
- **Azeez Basha** — overruled by AMU (2024), but that judgment carries multiple concurring and
  dissenting opinions with materially different reasoning; the ratio's scope needs counsel.
- **MSP Infrastructure** — "partly overruled". Not boolean, and the text says so.

I am not a lawyer. No label here was written from memory: every `evidence` string is a verbatim
corpus slice and the builder **exits non-zero and writes nothing** if a slice is absent. That
guard was validated by execution — substituting a fabricated quotation produced
`✗ evidence verification failed`, exit 1, no output file.

### 4.2 Landmarks that could NOT be sourced

The undeployed 96 MB extraction cap raise means the live cap is 20 MB, so:

- **Kesavananda Bharati (1973)** — PDF 35.8 MB → HTTP 413
- **Maneka Gandhi (1978)** — PDF 60.9 MB → HTTP 413

Both are recorded in the set's `provenance.unsourceable`, and a test asserts that list is
non-empty so the omission can never read as coverage. `Sushila Aggarwal` (2018 *and* 2020),
`Gurbaksh Singh Sibbia` (1980) and `Vodafone` (2012) all extracted fine (947–3,507 ms) and are in
the set. Kesavananda's own text is the highest-value negative control available — a 1,006-page
judgment discussing ~60 authorities — and it remains **untested**. That is the main reason the
authorisation below is conditional.

---

## 5. Measured results

Confusion matrix over the 32 scored items. "Adverse finding" = the scan concluded `overruled` or
`doubted` for the named authority.

| | With attribution | Detection only (today's extractor over full bodies) |
|---|---|---|
| True positive (adverse, correct kind) | **4** | 6 |
| Wrong severity (adverse, wrong kind) | 0 | 0 |
| **False positive** | **0** | **18** |
| False negative | 2 | 0 |
| True negative | 26 | 8 |
| Adverse findings made | 4 | 24 |
| **Precision** | **100.0%** | **25.0%** |
| Recall | 66.7% | 100.0% |

Per-control, with attribution: **26/26 negative controls correct**, 4/6 positives.

Reproduce: `npm run eval:treatment-attribution -- --baseline`. Result artefact:
`docs/audit/eval/nv-treatment-attribution-result-2026-08-20.json`.

### 5.1 The two remaining misses, and why they are acceptable

Both leave the verdict at `unknown`:

1. `sushila2020-salauddin-overruled` — "the decision in Salauddin … **and subsequent decisions
   (including K.L. Verma …; Sunita Devi …; Adri Dharan Das …; Nirmal Jeet Kaur …)** … are hereby
   overruled". Eight authorities are named between the target and the verb, so a nearer non-target
   wins. Closing this needs list-head parsing; doing it by widening the window would surrender the
   Sibbia control.
2. `glas2024-ashok-rajani-per-incuriam-prose` — "**The same infirmity is found in** Ashok G.
   Rajani (supra). … it would be per incuriam". Pronominal/anaphoric reference across sentences.

Both are the *safe* error. Neither is worth trading precision for.

---

## 6. Verdict on the backfill

**The ≥95% precision bar is met (100.0%, 0 false positives). The attribution prerequisite is
discharged.** I recommend authorising Phase 2–4 **conditionally**, on two grounds that the number
alone does not cover:

1. **32 items is a small denominator.** 0/4 false positives is consistent with a true precision
   below 95% at this sample size — the 95% lower bound on 4/4 is roughly 40%. The number
   demonstrates that attribution *works on every trap the corpus showed us*; it does not
   demonstrate 95% over 870,000 edges. The assessment's own target was 80–120 pairs.
2. **The hardest case is untested.** Kesavananda and Maneka Gandhi are unreachable until the
   96 MB cap raise deploys. A 1,006-page judgment discussing 60 authorities is the adversarial
   case for any attribution scheme, and it is precisely what a backfill will meet 43,505 times.

**Recommended sequence** — cheap, and it removes both objections:

- Deploy the NYS 96 MB cap raise (not mine to deploy), then extend the gold set with Kesavananda
  and Maneka Gandhi and re-measure.
- Grow the set to 80–120 items. The harvesting path is now scripted and cost ~1 s per judgment.
- Then run Phase 3 extraction (~18 h, <$0.10) — but write **only** `archive_extracts`.
- Derive edges in a **separate, re-runnable** pass (assessment §1.1), and re-measure precision on
  the derived edges before a single row enters `nv_legal_graph_edges`.
- Gate CI on `npm run eval:treatment-attribution:gate`.

If forced to a binary today: **yes, but stage it.** The catastrophic outcome — shipping the
detector over full bodies — is now measured at 25% precision and is off the table either way.

---

## 7. Should `goodLaw: 'good'` stay unreachable?

**Yes. I agree with the prior analysis, and this work strengthens two of its three arguments with
measurement rather than reasoning.**

- **Statutory supersession is invisible to a citation graph** — now observed, not hypothesised:
  Eminent Colonizers (2026) says the 2015 Amendment Act "**legislatively overruled** the dictum of
  Patel Engg." My module *correctly refuses* that as an edge, which means a graph built from it
  would show Patel Engg. with no adverse edge — i.e. a graph-derived `good` would be **actively
  wrong** on a case the corpus explicitly documents.
- **Partial overruling is not boolean** — observed verbatim: "partly overruled MSP
  Infrastructure", "Mhetre **to that extent** … are overruled", "stands effectively overruled in
  TMA Pai, **to that extent**". `good` cannot represent "overruled as to holding X".
- **43,505 is the embedded set, not every SC judgment.** Correct as stated. I would add a fourth,
  measured here: **recall is 66.7% and structurally incomplete.** Absence of an adverse edge will
  routinely mean "attribution refused", not "nothing adverse exists" — my own two misses are
  exactly that. Deriving `good` from absence would convert my deliberate, safe misses into
  affirmative safety assurances, inverting the entire design.

A fifth, from a different direction: `good` has **no honest confidence value**. Every other
verdict carries a confidence describing an extraction. `good` would be a claim about the whole
corpus and everything outside it, and there is no defensible number for that.

If `good` is ever wanted, it needs an editorial pass with a **named human accountable**, stored as
`extractedBy: 'editorial'` — which the row schema already supports. Not more inference.
`GoodLawPanel` already renders the unreachable `good` as *unverifiable* rather than as a
clearance, and there is a test pinning that. Keep it.

---

## 8. Files

| File | Role |
|---|---|
| `src/services/nv-citator-attribution.ts` | The attribution step (new) |
| `src/services/nv-authority-identity.ts` | Canonical authority tokeniser, shared not duplicated (new) |
| `src/services/nv-citator-treatment.ts` | `targetAuthority` opt-in gate; `attributionMethod` on rows (changed) |
| `scripts/nv-build-attribution-goldset.mjs` | Builds the set; refuses unverifiable evidence |
| `scripts/nv-eval-treatment-attribution.ts` | Precision/recall + confusion matrix; `--gate`, `--baseline` |
| `docs/audit/eval/nv-treatment-attribution-annotations.v1.json` | 32 labels + provenance |
| `docs/audit/eval/nv-treatment-attribution-set.v1.json` | Built gold set with verbatim passages |
| `docs/audit/eval/nv-treatment-attribution-result-2026-08-20.json` | Measured result |
| `tests/unit/nv-citator-attribution.test.ts` | 30 tests, incl. 8 written to kill mutation survivors |
| `tests/unit/nv-authority-identity.test.ts` | Duplicate-drift guard |
| `tests/unit/nv-treatment-attribution-goldset.test.ts` | Gold-set integrity + detector gate |

## 9. Gates

| Gate | Result |
|---|---|
| `npx vitest run tests/unit` | **1497 passed, 0 failed**, 3 skipped (104 files) |
| `guardrail:server-types` | baseline **25 errors / 19 signatures** — unchanged; 0 from my files |
| `guardrail:no-placeholder` | **75** — unchanged |
| `guardrail:no-new-orphans` | **0 / budget 0** (wired 519/526, up from 515/522 — all 4 new modules wired) |
| Mutations | **24 applied, 24 killed, 0 survivors** (2 rounds; 4 survivors found and closed) |
| `nv_legal_graph_*` | **0 rows. No backfill run.** |
