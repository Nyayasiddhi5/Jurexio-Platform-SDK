# Treatment graph over the SC corpus — costed assessment (NOT built)

**Date:** 2026-08-19 · **Status:** ASSESSMENT ONLY — no pipeline started, per instruction.
**Scope:** what it would cost to populate `nv_legal_graph_entities` / `nv_legal_graph_edges`
with a real citation-and-treatment graph over the 43,505 embedded Supreme Court judgments.

---

## 0. Why this is newly feasible, and the one thing that has not changed

Three facts moved:

| Fact | Value | Source |
|---|---|---|
| SC judgments in the hot metadata path | 43,505 (100% embedded) | NYS caselaw stats |
| SC rows carrying a populated `citation` | **43,505 / 43,505** | `scripts/_ec2-nys-citation-inventory.sh` |
| HC rows carrying `citation` | **0 / 20.4 M** | same |
| DC rows carrying `citation` | **0 / 5.7 M** | same |
| On-demand full text | works; Kesavananda 1,006 pp → 2,878,447 chars in **8,427 ms** | NYS-ARCHIVE-LARGE-PDF-001 |
| Extract cache | cold 2,693 ms → warm **13 ms** (~207×) in `archive_extracts` | same |
| SC PDF size distribution | p50 0.2 MB, p99 3.42 MB, p99.9 9.29 MB, max 68.79 MB across 176,997 objects | `scripts/_nv-sc-pdf-size-distribution.sh` |

The thing that has **not** changed: `nv_legal_graph_entities` and `nv_legal_graph_edges` hold
**0 rows**. Everything the platform currently calls "citator-like" is retrieval over passages
(`/caselaw/treatment`) or embedding similarity ("Related judgments"). Neither is a graph.

**The SC tier is the only tier a graph can be built on at all.** With `citation` empty for all
20.4 M HC and 5.7 M DC rows there is no join key to point an edge at, so an HC/DC graph is not a
bigger version of this project — it is a different project that starts with a citation-normalisation
backfill over 26 M rows. Scoping to SC is not a convenience, it is the only option.

---

## 1. Extraction cost — the number that decides the project

### 1.1 Time

The brief's "~2–8 s per judgment" is the right order but the wrong distribution, and the
difference matters. **Extraction time tracks PAGE COUNT, not bytes** (measured, NYS-ARCHIVE-LARGE-PDF-001):

| Judgment | Bytes | Pages | Extract time |
|---|---|---|---|
| Maneka Gandhi | 63,851,267 | 156 | 3,696 ms |
| Kesavananda Bharati | 37,514,544 | **1,006** | 17,579 ms (8,427 ms on the reworked reader) |
| Routine SC judgment | 488,366 | ~12 | ~2,700 ms cold |

At p50 (0.2 MB, ~12 pp) a cold extract is ~2.7 s, dominated by the S3 round-trip rather than
parsing. Taking **3 s median / 8 s p99**:

- **Serial:** 43,505 × 3 s ≈ **36 hours**. Unacceptable as a foreground job, fine as a background backfill.
- **Concurrency is capped at 2 by the host, not by choice.** The NYS worker
  (`i-000115b19219bb766`) has **2 vCPU**; pdf.js text extraction is CPU-bound, and
  `MAX_CONCURRENT_HEAVY_EXTRACTS=2` already gates >10 MB objects. A third concurrent volume
  pushes all three past the 60 s caller timeout while tripling peak RSS.
- **Realistic wall-clock at concurrency 2: ~18 hours**, plus contention with the 4 embed workers
  already resident beside the 271 MB API process.

**Recommendation:** run it off the request path entirely, as a rate-limited backfill writing into
`archive_extracts` first (which it already populates as a side effect) and deriving edges in a
second pass over the cached text. Splitting extraction from edge derivation means the expensive
half is done once ever and the cheap half is re-runnable when the extraction rules improve — which
they will, repeatedly.

### 1.2 Money

- **S3 GET:** 43,505 objects. At p50 0.2 MB the corpus is roughly **25–30 GB** of PDF
  (176,997 objects average ~0.6 MB; the 43,505 with citations skew similar). Same-region GET is
  ~$0.0004/1,000 requests plus $0 intra-region transfer → **< $0.05 in request charges**.
- **Athena:** not required. Extraction is keyed on `s3_path`, which the SC metadata rows already
  carry, so the ~1.6 MB/query SC resolve hop is avoidable entirely for a bulk run. **~$0.**
- **Compute:** 18 h on an already-provisioned instance → marginal cost ~$0.
- **LLM:** $0 if extraction stays deterministic (see §3). This is the single biggest cost lever:
  one LLM pass over 43,505 full bodies at ~700k tokens each is a multi-million-token job per model
  pass and would dominate every other line item by three orders of magnitude.

**Total marginal cash cost: effectively nil. The cost is wall-clock, host contention, and
correctness risk — not dollars.** Any decision framed around spend will be framed around the wrong
variable.

### 1.3 Storage

- **`archive_extracts` text:** if all 43,505 are cached, at a mean of ~40k chars (routine judgment
  33,644 chars measured; landmarks are outliers) → **~1.7 GB of text**, before TOAST compression.
  Judgment text compresses well (~4–6×), so expect **300–500 MB on disk**. The tail is real
  though: Kesavananda alone is 2.9 MB and the 43 objects over 20 MB will each land in the
  1–3 MB range.
- **Edges:** Indian SC judgments cite on the order of 10–40 prior authorities. At **20 edges
  median** → **~870,000 rows**. The existing `nv_legal_graph_edges` row is ~9 text/float columns;
  budget ~250 B/row + 4 indexes → **~220 MB heap + ~250 MB index**. Trivial.
- **Entities:** one node per judgment (43,505) plus unresolved outbound citations. Expect
  **60–120k nodes** — the excess being cited authorities that are pre-1950, unreported, or
  outside the SC tier and therefore have no row to point at.

**Storage is a non-issue. Do not let it into the decision.**

---

## 2. Can treatment language be reliably extracted from a full body? — the real risk

This is where I would push back on the framing that a full body is straightforwardly *better*
than the current passage snippets. It is better in recall and **worse in precision**, and precision
is the property that matters here.

### 2.1 What gets better

The current `/caselaw/treatment` scans `[title, description, disposalNature, court]` — the
searchable metadata fields, not the judgment. Treatment language ("stands overruled by",
"per incuriam", "requires reconsideration") lives in the *body*, usually in the last 10–20% of it.
So today's extractor is looking almost entirely in the wrong place, and its `unknown` verdicts are
mostly an artefact of that. A full body would surface real findings for the first time.

### 2.2 What gets worse, and why it is the harder problem

**Attribution, not detection.** The regexes in `nv-citator-treatment.ts` are good at detecting
that *something* was overruled. They cannot say *what*. In a 1,006-page judgment discussing 60
authorities, `\bstands overruled\b` will match — and the authority it refers to is whichever case
was named in the preceding clause, which the current code does not resolve at all. The existing
`confidence: 0.82` comment says this explicitly: *"attributing it to THIS authority rather than
another one discussed nearby is the part we cannot verify from a passage alone."* Scaling the text
up scales that ambiguity up with it.

Concretely, on a full body the current extractor would produce a **false "overruled" for every
judgment that overrules anything**, because it reports one row per passage with no link between
the treatment verb and its object. A false `overruled` makes a lawyer discard valid law — the
mirror-image malpractice risk, and arguably the worse one commercially, because the lawyer never
finds out.

**Therefore: full-body extraction requires a resolution step the current code does not have,**
and shipping the graph without it would be strictly worse than the passage version. That step is:

1. Locate citation spans in the sentence and the 1–2 sentences preceding the treatment verb
   (`CITATION_RE` already handles the three common Indian shapes; it needs case-name spans too).
2. Bind the treatment verb to the nearest preceding citation/case-name span within a bounded window.
3. Emit **no edge** when no span binds. An unattributed treatment is not an edge, it is a miss.

Step 3 is the load-bearing one and it is where a well-meaning implementation will cheat.

### 2.3 Deterministic vs LLM

Keep the deterministic pass as the **only** thing that writes `extractedBy: 'deterministic'`, and
keep it as the only source that may set an adverse `goodLaw`. An LLM pass is defensible as a
*second* writer on the same schema (`extractedBy: 'llm'`, never promoted to a verdict, always
rendered as AI-suggested by the panel this ledger entry ships) — but only after the deterministic
graph exists, because you cannot evaluate the LLM without a baseline. Doing both at once means
neither can be attributed.

---

## 3. Edge schema — what the existing table needs

`nv_legal_graph_edges` (shared/nv-governance-schema.ts:915) already has
`sourceId / targetId / edgeType / weight / docId / confidence`. It is close, and it is missing
exactly the fields that make a treatment edge auditable:

| Need | Why the current schema cannot carry it |
|---|---|
| `treatmentKind` | `edgeType` is a generic graph label. Overloading it with `overruled`/`followed` conflates graph topology with legal semantics, and any other graph writer would collide. |
| `paragraph` / `spanStart`,`spanEnd` | A treatment edge that cannot show the sentence that establishes it is unverifiable, and the panel has nothing to render. This is the single most important addition. |
| `extractedBy` | Already the contract on the API row. Without it on the edge, deterministic and LLM edges are indistinguishable at rest — the exact failure the API layer refuses to make. |
| `attributionMethod` | `citation-span` vs `case-name-span` vs `unattributed`. Mirrors `authority.resolution.method`, and lets a reader discount weak bindings without discarding them. |
| `targetResolved` (bool) + `targetCitationRaw` | ~40–60% of cited authorities will have no SC row (pre-1950, unreported, HC/DC with no `citation`). Storing the raw string with `targetResolved: false` keeps them countable; silently dropping them makes coverage unmeasurable. |
| `sourceParagraphIndex`, `pagesRead`, `truncated` | An edge derived from a **truncated** extraction must be marked, for exactly the reason the full-text route now surfaces `truncated`: a judgment read to page 2,000 of 3,000 has an unknown remainder, and its absence-of-treatment says nothing. |

**Unique constraint:** `(sourceId, targetId, treatmentKind, extractedBy)` — without it, a re-run
doubles every edge and any count over the graph becomes meaningless.

`nv_legal_graph_entities` needs `citation`, `court`, `year`, `judgmentId` and a
`resolved: boolean`, so unresolved cited authorities can exist as nodes without pretending to be
judgments we hold.

---

## 4. How to validate correctness — and the honest answer about the ceiling

### 4.1 Known-overruled gold set (the primary instrument)

Build a hand-labelled set of **80–120 SC pairs** where the treatment is not in dispute. Candidates
whose overruling is a matter of public record and easy to verify against the law reports:

- ADM Jabalpur v. Shivkant Shukla — overruled by K.S. Puttaswamy (2017)
- A.K. Gopalan — effectively overruled by Maneka Gandhi (1978)
- Suresh Kumar Koushal — overruled by Navtej Singh Johar (2018)
- Mafatlal / Synthetics & Chemicals lines — partially overruled, which are the *interesting* cases
- Plus ~40 **negative controls**: pairs where one judgment merely *discusses* another's overruling.

The negative controls are the point. The MCP tool `overruled_case_check` fails precisely here — a
judgment that mentions overruling ranks identically to one that performs it — and a gold set
without controls would score that failure as a pass. **Report precision and recall separately,
and gate on precision.** A graph at 95% precision / 40% recall is shippable behind honest
coverage; 70% precision at any recall is not, because one in three adverse findings would tell a
lawyer to abandon good law.

### 4.2 Cross-instrument checks

- **Self-consistency:** if A overrules B, B must not also overrule A. Cycle detection over
  adverse edges is a cheap, assumption-free correctness signal.
- **Temporal:** an edge must point backwards in time. `source.year >= target.year`. Violations are
  attribution bugs, not legal history.
- **Bench size:** an SC judgment cannot overrule a larger bench. Where bench strength is
  available this is a strong filter; where it is absent, say so rather than assuming.
- **Agreement with the existing passage extractor** on the subset it can see — disagreement is
  informative in both directions and should be inspected, not averaged away.

### 4.3 The ceiling to state up front

Even a correct graph over the SC tier answers "was this authority treated by a **Supreme Court**
judgment we hold". It cannot answer "is this good law", because:

- A High Court judgment cannot overrule an SC one, but an SC authority can be superseded by
  **statute**, and no citation graph sees that.
- Partial overruling ("overruled to the extent it held X") is the common real case and is not a
  boolean.
- 43,505 SC judgments is the *embedded* set, not every SC judgment ever delivered.

So **`goodLaw: 'good'` should remain unreachable even after the graph exists.** The graph raises
the recall of adverse findings — which is the commercially valuable half — and does not create an
entitlement to an affirmative clearance. If we ever want to assert `good`, it needs an editorial
pass with a named human behind it, not more inference.

---

## 5. Recommendation

**Build it, in this order, and do not compress the order.**

| Phase | Work | Cost | Gate before proceeding |
|---|---|---|---|
| 0 | Gold set: 80–120 labelled pairs + 40 negative controls | ~1 day human | Set reviewed by an SME |
| 1 | Attribution: bind treatment verb → citation/case-name span; emit nothing when unbound | ~2 days | **≥95% precision** on the gold set, measured on full bodies |
| 2 | Schema migration: the 7 columns in §3 + the unique constraint | ~0.5 day | `db:push` diff eyeballed; row counts logged |
| 3 | Extraction backfill: 43,505 SC bodies at concurrency 2, off the request path | ~18 h wall-clock, ~$0.05 | `archive_extracts` coverage ≥99%; `truncated` count reported, not hidden |
| 4 | Edge derivation over cached text (re-runnable) | ~1 h per pass | Cycle + temporal checks clean; precision re-measured |
| 5 | Wire the graph behind the existing `/caselaw/treatment` contract as a higher-confidence source | ~1 day | Panel renders graph edges with `extractedBy` and real coverage |

Phase 5 needs **no API or UI contract change**: the response shape
(`goodLaw` / `treatments[]` / `coverage` / `extractedBy`) was designed for this, and the panel
shipped in NV-GOOD-LAW-PANEL-001 already renders per-row provenance and always-visible coverage.
That is the payoff of having built the honest surface first.

**Do not start at Phase 3.** Extraction is the part that looks like progress and it is the part
that is already solved. Attribution is the part that decides whether the graph is an asset or a
liability, and it is unbuilt.

---

## 6. Numbers summary (for the decision)

| Question | Answer |
|---|---|
| Corpus | 43,505 SC judgments — the only tier with a usable join key |
| Extraction wall-clock | ~18 h at concurrency 2 (host has 2 vCPU); ~36 h serial |
| Extraction cash cost | **< $0.10** (S3 GETs; no Athena needed; $0 LLM if deterministic) |
| Text storage | ~1.7 GB raw → **300–500 MB** compressed in `archive_extracts` |
| Edge rows | **~870,000** (20 median citations/judgment) → ~470 MB with indexes |
| Entity rows | 60–120k (judgments + unresolved cited authorities) |
| Schema change | 7 new columns on `nv_legal_graph_edges` + unique constraint; 5 on entities |
| Validation | 80–120 gold pairs + 40 negative controls; gate on **precision ≥95%** |
| Biggest risk | **Attribution, not extraction.** Full bodies raise recall and lower precision; a false `overruled` makes a lawyer discard valid law |
| Does it unlock `goodLaw: 'good'`? | **No.** Statutory supersession and partial overruling are invisible to a citation graph |
