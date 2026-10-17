# NYV → NSP / NYM: what changed in the last two days (2026-08-16 → 18)

> **Live:** `https://api.nyayasiddhi.online` · current build `2026-08-17T1921Z-aws-ssm`
> **Spec:** `GET /api/nv/openapi.json`
> **Prior notes:** [`NYV-NSP-TASK387-AND-FIELDS-2026-08-17.md`](./NYV-NSP-TASK387-AND-FIELDS-2026-08-17.md) · [`NSP-NYM-SESSION-IDENTITY-CONTRACT-2026-08-17.md`](./NSP-NYM-SESSION-IDENTITY-CONTRACT-2026-08-17.md) · [`NSP-NYM-AI-TASK-ENDPOINTS-2026-08-17.md`](./NSP-NYM-AI-TASK-ENDPOINTS-2026-08-17.md)

**Nothing here is a breaking change.** No endpoint was renamed or removed — the frozen API
contract check reports **1,609 operations, 0 removed**. Everything below is additive or an
internal fix. There are **two things you must do** (§5) and **two we got wrong and
corrected** (§6).

---

## 1. Action required from you (2 items)

### 1.1 Send `X-Customer-User-Id` on every AI call

```http
X-Customer-User-Id: nsp:o:3:u:315
```

**Keep your namespaced format** — do not switch to the bare numeric id. It is globally
unique across orgs, whereas `315` is unique only inside org 3 and arrives on a request
where org is a separate header we would have to trust to disambiguate. `:` was already
legal in our identity charset.

**Why it matters more than tracking:** without it, our identity fell back to the
*application* for every one of your end users, so an auto-minted session hash collapsed to
**one session per platform per day**, shared by every advocate, with session memory written
under it. We have hardened our side (an app-level identity now gets a per-request session),
and your header restores real per-advocate continuity. Confirmed live: users `…u:315` and
`…u:902` now get distinct sessions, and a leak test across them returns `UNKNOWN`.

### 1.2 Persist and echo `sessionId`

Every orchestrate response now returns `sessionId`. Send it back on the next turn of the
same matter thread. If you send `X-Customer-Session-Id` we honour that instead —
precedence is **body `sessionId` → `X-Customer-Session-Id` → NYV-minted**.

Verified: turn 2 replaying the returned `sessionId` recalled an invoice number and client
name **without them being restated**, in 5.2 s.

---

## 2. New response fields (all additive)

| field | on | meaning |
|---|---|---|
| `requestPhase` | **every** orchestrate response | `accepted → grounding → generating → enriching → ready \| degraded \| failed_infra` |
| `optionalDegraded` | when an optional stage was dropped | answer is **complete**; an enrichment was skipped to progress |
| `orchestrationId` | Queen path | stable across retries — **quote this to us when reporting a failure** |
| `sessionId` | every response | the thread this turn belongs to |

**`ready` and `degraded` are BOTH success.** Please do not surface `degraded` as an error.

A correction we owe you: you said NSP was already forward-compatible on this enum. You
could not have been — the field was produced internally and **dropped at the response
seam**, so it was `undefined` on every answer. It is now emitted on all paths, with a
regression test preventing its removal, and the enum is published in OpenAPI as
`components.schemas.RequestPhase`.

---

## 3. `analyzeDocument` — structured fields, on all three paths

Your `heuristicFallback: true` was correct and our earlier "fixed" was not: there are **two
analyze handlers**, and we had only fixed one. All three now behave identically:

| operation | result |
|---|---|
| `POST /api/nv/sdk/docs-pipeline/documents/analyze` | `fieldSource: "nyv"` |
| `POST /api/nv/sdk/docs-pipeline/documents/intelligence` | `fieldSource: "nyv"` |
| `POST /api/nv/gateway/documents/analyze` | `fieldSource: "nyv"` |

**There is no new operation to call.**

### Your empty arrays were our contract's fault

`entities` is a **container object** (`entities.entities|obligations|risks|deadlines`), so
`data.entities.length` was `undefined`; and `statutes` never existed at any level. Rather
than ask you to rewrite a working client, we added flat aliases **alongside** the nested
object:

```json
{
  "fields": [ … ], "fieldCount": 14, "fieldSource": "nyv",
  "detectedDocumentType": "anticipatory_bail_petition",
  "isIndianCourtDocument": true,
  "statutes": ["Section 138 of the Negotiable Instruments Act, 1881"],
  "entitiesFlat": [ … ], "deadlinesFlat": [ … ],
  "obligationsFlat": [ … ], "risksFlat": [ … ],
  "entities": { "entities": [...], "obligations": [...], "risks": [...], "deadlines": [...] }
}
```

**Recommendation: map `fields[]` as your primary source** — each entry carries `key`,
`label`, `value`, `confidence` and `source`, so you can badge provenance per field. The
`*Flat` aliases exist so your current mapping works unchanged.

Fields extracted from a real cause title: `filing_number` (`Criminal Petition No. 4471 of
2025`), `case_type`, `case_year`, `court`, `fir_number`, `police_station`, `judge`,
`next_hearing_date`, `prayer`, `petitioner`, `respondent`, `respondent_2`,
`statutes_invoked`, `amount_in_dispute`, `dates_mentioned`, `organisations`,
`document_type`. Absent values are **omitted, never blank**, so you can tell "not in the
document" from "extraction failed".

### Document-type classification fixed

A s.138 Negotiable Instruments cheque-dishonour complaint was classified `fir`, because our
hint list was first-match-wins and a background *reference* to "FIR No. 221 of 2025" beat
the actual cause of action. Now ordered most-specific-first, and
**`cheque_dishonour_complaint` is its own type** — NI-138 carries a limitation clock
(30-day notice from the return memo, complaint within one month of the 15-day cure period)
that no other complaint shares, so you can autofill it.

---

## 4. Task 387 — attributed, and it was ours

Your timestamps closed it:

| event | time |
|---|---|
| our `nyv-gateway` container started (deploy `1015Z`) | **10:25:07.532Z** |
| your task 387 created | **10:25:07.656Z** — *124 ms later* |
| our health gate went green | 10:26:08Z |

Task 387 hit a **booting gateway during our own container recreate**. A refused connection
at that moment is surfaced by the proxy as **502**, which is why our logs hold no matching
503: the request never reached a handler. Both sides read their own evidence correctly.

**Root cause is our deploy having no drain/readiness gate**, and it is on our list. Your
`nvErrorDiagnostics()` addition is exactly right — with the correlation id persisted we can
join to our request row immediately next time. Keep the retry you have; a retry a few
seconds later would have succeeded.

---

## 5. Performance and reliability you get for free

| change | effect |
|---|---|
| Completion-driven Queen stages | forced-Queen wall clock **366 s → 68 s** measured; optional work no longer holds a finished answer |
| Memory recall index | recall query **716 ms → 10.6 ms** (67×); removes a latent 30 s stall |
| Prompt caching (Anthropic) | repeated system prefixes bill at ~10 %; **no wording change, so answers do not move** |
| Fallback ladder | value models promoted above the deep tier for non-drafting; **first-choice model unchanged**, so quality on the happy path is identical |
| Two dead fallback rungs | removed — they were silently dropped exactly when earlier models had already failed |
| Planner tuning | `random_page_cost` corrected for SSD; a hot query moved from sequential scan to index scan (0.745 ms) |
| Statute fast path | a BNS statute question now answers in **72 ms with zero LLM calls** |

Current measured latency on your shapes: `legal-chat-fast` ~10 s, `legal-draft-fast` 0.65–45 s
depending on cache, `analyze` ~26 s.

---

## 6. Two things we told you that were wrong

Recording these because you should be able to trust the next status we send.

1. **"The 17-field payload is live"** — true, but on a path you do not call. Your
   `heuristicFallback` flag was accurate. Fixed on all three handlers (§3).
2. **"`requestPhase` is available"** — the field was produced internally and dropped
   before the response. It was never in a payload you could read. Fixed and regression-tested (§2).

**Still open on our side, honestly:** the "BNS Section 138 — Abduction" mis-grounding you
saw **does not reproduce** on the current build — the same cheque matter now returns
`Section 138 of the Negotiable Instruments Act, 1881`, with `Abduction` and `BNS 138`
absent from the whole payload. We are **not** closing it on a non-reproduction: if it
recurs, send the `requestId` and we will pin it. Statute-to-instrument confusion on a 138
matter is too serious to mark resolved without evidence.

---

## 7. Caselaw search — use `mode=hybrid`, it is fast

Correcting guidance before it reaches you: an internal note suggested you use `mode=fts` for
typeahead because hybrid looked slow. **That measurement was a cold-start artifact.** Warm, measured
three times through the gateway, `mode=hybrid` returns in **0.312–0.366 s** with `method: "hybrid_rrf"`
and no fallback. **Use `hybrid`** — you get reciprocal-rank-fused results at FTS-like latency.

One honest caveat: vector coverage of the judgment corpus is currently **5.56 %**, and Supreme Court
coverage is low, so the vector arm contributes less than it eventually will. Full-text carries the
query meanwhile, which is why results look complete. We are backfilling, Supreme Court first.

---

## 8. Nothing you need to change beyond §1

- No SDK upgrade (`@nyayavigya/client-sdk@5.0.10` still valid)
- No endpoint renames or removals — 1,609 operations, 0 removed
- Timeouts unchanged: interactive **90 s** with `*-fast`, counsel **600 s** on the worker with `202` + poll
- `X-NYV-Platform: nsp` still required; jurisdiction is forced to `IN` server-side (we closed the last two partner surfaces that were not enforcing it)
