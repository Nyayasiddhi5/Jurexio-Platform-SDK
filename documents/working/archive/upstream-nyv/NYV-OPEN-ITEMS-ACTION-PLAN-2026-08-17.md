# Action plan — four open items (2026-08-17)

> **Status:** plan only, nothing implemented. Each item below was investigated against
> live code and the live database first; the evidence is quoted so the plan can be
> challenged on facts rather than opinion.
> **Two items turned out to be smaller than assumed and one is not a defect at all** —
> see the summary table.

| # | Item | Verdict after investigation | Effort | Needs GO |
|---|---|---|---|---|
| 1 | Hung `memory.tiered.recall` | **Root cause found and quantified.** Missing functional index + N+1 UPDATEs | ~half day | Yes — DB migration |
| 2 | `step0_first_useful` unseen | **Not a defect.** Expected absence; needs a counter to prove it | ~1 hour | No |
| 3 | PERSON/JUDGE NER | **JUDGE already works.** Only PERSON is open; InLegalBERT is the expensive option | ~2 hours (option B) | Only for option A |
| 4 | v2 benchmark before cost claim | **Set exists and already ran.** Blocker is a *probe* bug, not the platform | ~2 hours | No |

---

## 1. Hung `memory.tiered.recall` — root cause found

### Evidence

`nvMemoryService.retrieve()` (`src/services/nv-orchestration-services.ts:1124`) has two
defects on the hot path.

**Defect A — per-row `to_tsvector` with no functional index.** When a query is present
(which the middleware always supplies), the FTS branch computes
`ts_rank_cd(to_tsvector('simple', COALESCE(value::text,'')), …)` for **every row of that
user's memory**, at query time. `EXPLAIN (ANALYZE)` on the live DB:

```
Sort  (actual time=690.592..690.594 rows=20)
  Sort Key: (ts_rank_cd(to_tsvector('simple', COALESCE((memory_entries.value)::text, ''))…
  ->  Index Scan using idx_memory_user  (actual time=1.336..689.935 rows=1430)
Execution Time: 690.635 ms
```

`idx_memory_user` narrows by `user_id`, then **688 ms is spent ranking 1,430 rows**.
That is **~0.48 ms per row**, and it is linear in rows-per-user. Projection:

| rows for one user | expected recall time |
|---:|---:|
| 1,430 (today) | 0.69 s |
| 10,000 | ~4.8 s |
| 30,000 | ~14 s |
| **~62,000** | **~30 s — the breaker wall** |

So the 30 s hang is not a mystery and not a network stall: it is this ranking cost
reaching the 30 s capability breaker once a single user's memory grows past ~60k rows.
The live table holds only 1,589 rows total today, which is exactly why the hang is not
currently reproducing.

**Defect B — N+1 sequential writes.** After the SELECT, every returned row triggers its
own awaited UPDATE:

```ts
for (const row of (result.rows || []) as any[]) {
  await db.execute(sql`UPDATE nv_schema.memory_entries SET access_count = access_count + 1, … WHERE id = ${row.id}`)
}
```

With the default `limit: 20`, that is **20 extra sequential round trips per recall**,
each awaited. Harmless at 1 ms RTT, material under load or cross-AZ latency, and it is
pure bookkeeping sitting on the critical path of every leaf.

### Plan

**Step 1 — index the ranking expression (the actual fix).** Add a generated
`tsvector` column plus a GIN index, so ranking reads a precomputed vector:

```sql
ALTER TABLE nv_schema.memory_entries
  ADD COLUMN value_tsv tsvector
  GENERATED ALWAYS AS (to_tsvector('simple', COALESCE(value::text, ''))) STORED;
CREATE INDEX CONCURRENTLY idx_memory_value_tsv ON nv_schema.memory_entries USING GIN (value_tsv);
CREATE INDEX CONCURRENTLY idx_memory_user_session ON nv_schema.memory_entries (user_id, session_id);
```

Then change the query to rank on `value_tsv` and filter with `value_tsv @@ plainto_tsquery(…)`.
A generated column is preferred over a trigger because it cannot drift from `value`.

*Why `CONCURRENTLY`:* the table is live; a plain `CREATE INDEX` takes an
`ACCESS EXCLUSIVE` lock and would stall every recall for its duration.

**Step 2 — make the filter a filter.** Today every row is ranked and the top 20 kept.
With the GIN index, add `value_tsv @@ plainto_tsquery(…)` so Postgres only ranks
*matching* rows. Keep the current fall-back ordering (`importance`, `last_accessed_at`)
for the no-match case, so a recall that matches nothing still returns recent memory
rather than an empty set — that behaviour is relied on and must not change.

**Step 3 — collapse the N+1 into one statement.**

```sql
UPDATE nv_schema.memory_entries
   SET access_count = access_count + 1, last_accessed_at = NOW()
 WHERE id = ANY($1::uuid[])
```

and stop awaiting it on the response path — it is bookkeeping, so fire-and-forget with
an error log is correct. This alone removes 20 round trips per recall.

**Step 4 — cap the blast radius.** Add a per-user row ceiling with eviction by
`importance ASC, last_accessed_at ASC`. `NV-MEM-DECAY-001` already exists for decay but
was found unsatisfiable earlier; this is the enforcement point. Without it, the table
grows unbounded and any index eventually loses.

### Verification (before claiming it works)

1. `EXPLAIN (ANALYZE)` the new query — must show a **Bitmap Index Scan on
   `idx_memory_value_tsv`**, not a per-row `ts_rank_cd` sort.
2. Seed a synthetic user to **70,000 rows** and assert recall stays **< 500 ms** — the
   projection above is the hypothesis, so it must be falsified at the scale that
   actually breaks, not at today's 1,430 rows.
3. Assert recall still returns rows when the query matches nothing (Step 2 regression).
4. Live probe: `recall budget exhausted` must stay 0 and `queen.mw.pre.memory` spans
   must stay under 500 ms.

### Risk

Schema change on a live table → **AGENTS.md §4**: log the migration in
`Project-Tracker.md`, capture row counts, and never hand-write `ALTER` outside the
tracked path. **Needs explicit GO.** The generated column rewrites the table on add, so
it should run in a low-traffic window; at 1,589 rows that is currently trivial, which is
an argument for doing it **now** rather than at 60k.

---

## 2. `step0_first_useful` unseen in real traffic — not a defect

### Evidence

The log line fires only when one grounding source produced useful output **and** the
sibling was still pending:

```ts
if (grounding.releasedEarly && !(ragTracked.state.done && memTracked.state.done))
```

Two independent reasons it legitimately never fired:

- **Memory is currently fast.** Recall is 0.69 s against 1,430 rows (item 1), so both
  sources settle well inside the grace window and there is nothing to release early
  *from*. The mechanism is correct; the condition is simply not being met.
- **Step-0 memory does not always run.** It is gated on `memSessionId && memUserId`
  (`nv-queen-orchestrator.ts:1750`). Before the session work landed, partner traffic
  frequently had no usable session, so the memory leg was skipped entirely and the pair
  had only one member.

So "unseen" is the expected observation for a healthy small store. Reporting it as a
gap would be wrong; reporting it as *verified working* would also be wrong, because
nothing has exercised it.

### Plan

**Do not change the mechanism.** Make its absence measurable instead:

1. Add two counters next to the existing span: `step0.released_early` and
   `step0.both_settled`. A ratio of 0/N proves "never needed"; the current 0/0 proves
   nothing.
2. Log at `debug` when the pair settles normally, including each leg's duration, so the
   distribution is visible without waiting for a pathological case.
3. **Force it once in a test** rather than waiting for production: a unit test already
   covers `proceedOnFirstUseful` directly (4 assertions). Add one integration-level test
   that stubs the memory source to hang and asserts Step-0 returns in ~grace time.
4. Re-check after item 1 ships — if the index makes recall uniformly fast, this path may
   *correctly* never fire in production, and that is the right outcome to record.

### Risk

None — observability only.

---

## 3. PERSON / JUDGE NER — JUDGE is already done

### Evidence

- **JUDGE works.** The live probe extracted `judge: "A. Rajashekar Reddy"` via
  `JUDGE_PATTERN`. This item is half closed already.
- **Parties work for court documents.** `petitioner`, `respondent`, `respondent_2` are
  extracted from the cause title (`NV-COURT-DOC-FIELDS-001`), so the names that matter
  most in a filing are already structured.
- **The real gap is PERSON in free text** — a name with no role marker and no
  "Justice" prefix, e.g. "Ram Kumar filed…". `regexExtract` has no PERSON pattern at
  all.
- **`INLEGAL_BERT_URL` is an external HTTP service we do not run.** It appears in
  exactly one place (`nv-legal-ner-v2-service.ts:98`), is absent from `.env.example`,
  and the code already degrades to regex when unset. So "needs INLEGAL_BERT_URL" means
  "needs us to host a model", not "needs a config line".

### Options

| Option | What it buys | Cost | Recommendation |
|---|---|---|---|
| **A. Host InLegalBERT** | Real PERSON/ORG/JUDGE NER trained on Indian judgments | A model server (CPU viable, GPU better), deploy + monitoring + version pinning | **Defer** until free-text PERSON is a stated product need |
| **B. Extend deterministic extraction** | PERSON in the *structured* positions that matter: `S/o`/`D/o`/`W/o` patterns, "aged N years", advocate/counsel lines, deponent in affidavits | ~2 hours, zero runtime cost | **Do this now** |
| **C. LLM-based NER on demand** | Best recall on messy text | An extra LLM call per document | Only behind an explicit caller flag |

### Plan (option B)

1. Add PERSON extraction anchored on Indian document conventions rather than
   capitalisation: `S/o|D/o|W/o` relations, `aged \d+ years`, `Deponent`,
   `Counsel for the (Petitioner|Respondent)`, `Advocate for …`.
   Anchoring on structure is what keeps precision high — a bare "capitalised words"
   heuristic would classify "High Court" and "Banjara Hills" as people.
2. Reuse the existing `extractWithPattern` + validation path in the NER service; do not
   add a parallel extractor.
3. Tests must include **negative** cases: place names, court names, statute names and
   company names must **not** become PERSON. Precision matters more than recall here,
   because a wrong party name in an autofilled matter is worse than a blank field.
4. State the residual honestly in the response: `model: "regex-v2"` already tells a
   caller this is rule-based, and the NER service already reports it — keep that.

### Risk

Low. Additive patterns behind existing tests; the over-match guard style is already
established (`INV 88421` must not be a section ref).

---

## 4. v2 benchmark before any cost claim — the set already exists

### Evidence

This item was assumed to be "build the v2 set". It is not:

- **`docs/audit/eval/nv-cost-benchmark-set.v2.json` exists**, frozen, 26 cases, weights
  summing to **1.0**, with exactly the fields the earlier critique demanded:
  `topicAnchors` (kills cache cross-hits), `reportSeparately` (trivial lookups out of
  the headline), `costBearing`, `cacheExpectation`, `zeroLlmExpected`,
  `expectedResolution`.
- **It has already been run:** `.local/benchmarks/v2-first-defensible-2026-08-16T17-33-27-123Z/`.
- The run **correctly refused to publish a number**, and its own set-separation self-test
  **passed** (no cold `expect-miss` prompt was served from cache — the check v1 lacked).

The blocker it reported is a metering gate:

```
envelope `cost.completions` vs independent count from provider log lines:
16× match, 7× MISMATCH, 3× not-comparable
METERING REGRESSION — no percentage from this pass is publishable.
```

**The mismatch is almost certainly a defect in the probe, not the platform.** Every
mismatch row shows envelope 3–5 vs provider log **1**, and the counter scopes with
**exact** equality:

```python
scoped = [c for c in calls if c.get('requestId') == request_id]
```

`NV-REQID-CORRELATION-001` deliberately made Queen leaf dispatches
`<parent-uuid>::leaf-*`, `::synthesis`, `::cot`. Those are **not equal** to the parent
`requestId`, so exact equality **excludes every leaf call** and counts only the parent —
producing exactly the "envelope 5, log 1" shape observed. The envelope is reading the
request-scoped accumulator, which does see the leaves.

This is the same class of error as the `psql sslmode` and word-split-header incidents:
**validate the instrument before believing it** (NV-VALIDATE-THE-PROBE-001).

### Plan

1. **Fix the counter's scope predicate** in `scripts/_nv-provider-usage-extract.py`:
   count a call when `rid == request_id` **or** `rid.startswith(request_id + '::')`.
   Report parent and descendant counts separately so a future divergence is visible
   rather than merged.
2. **Prove the fix on the archived run first.** The raw log capture is already on disk,
   so re-scoring it must turn 7 mismatches into matches **without re-running the
   benchmark**. If it does not, my diagnosis is wrong and the platform is genuinely
   mis-metering — that is the falsification step, and it costs nothing.
3. Only then re-run v2 live (`--set nv-cost-benchmark-set.v2.json`), with the metering
   gate passing.
4. Publish per-class, with trivial lookups reported separately, and **state `n=1`**
   until a multi-run pass exists. The prior report was right to refuse a headline.
5. Expect the number to be **bad**: the last measured blend was `-552.9 %`
   (0.160842 vs 0.024634 USD/request) with 57,837 blended prompt tokens against the
   baseline's 71. Do not re-frame that upward. The Queen prompt assembly is the drag,
   and §12.2 leaf-prompt tiering plus the `NYV_QUEEN_LEAF_L0_DOWNGRADE` flag are the
   levers to test against it.

### Risk

None to production — harness and probe only. The output is a *measurement*, and it may
say the platform is expensive. That is the point.

---

## Suggested sequence

1. **Item 4 step 2** first — free, no deploy, and it either clears the metering gate or
   uncovers a real billing defect. Highest information per token spent.
2. **Item 2** — one hour of observability, no risk, and it tells us whether item 1's fix
   is even observable in production.
3. **Item 1** — the only item with a real user-facing failure mode, but it is *latent*
   (~60k rows). Cheapest to do now while the table is 1,589 rows and the rewrite is
   instant. **Needs GO.**
4. **Item 3 option B** — additive, closes the NSP-visible half of the NER gap.
5. **Item 4 steps 3–5** — the live re-run, once metering is trustworthy.

Items 1 and 3 touch different subsystems and can run in parallel. Item 4 is independent
of all of them.

## What I would not do

- **Do not host InLegalBERT yet.** It is the only item requiring new infrastructure, and
  the structured positions that matter for NSP autofill are already covered.
- **Do not "fix" `step0_first_useful`.** There is nothing broken; changing the release
  condition to make a log line appear would be optimising for the instrument.
- **Do not publish a cost percentage** until the metering gate passes on its own terms.
