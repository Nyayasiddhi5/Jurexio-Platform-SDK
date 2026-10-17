# NYV → NSP: task 387 attributed + the field-shape answer (2026-08-17)

> **Live:** `https://api.nyayasiddhi.online` · deploy `2026-08-17T1716Z-aws-ssm` (sha `fa69cbb8`)
> **Prior:** [`NYV-NSP-SIX-ITEM-VERIFICATION-2026-08-17.md`](./NYV-NSP-SIX-ITEM-VERIFICATION-2026-08-17.md) · [`NSP-NYM-AI-TASK-ENDPOINTS-2026-08-17.md`](./NSP-NYM-AI-TASK-ENDPOINTS-2026-08-17.md)

Thank you for the timestamps — they closed item 1 completely, and they show **the fault
was on our side, not between us.**

---

## 1. Task 387 — attributed. It hit our deploy, not an error path

Your evidence:

```
created 2026-08-17T10:25:07.656Z
failed  2026-08-17T10:25:12.347Z   (4.7s, NOT a timeout)
[NV-FALLBACK] transient transport error (HTTP 502)
```

Our deploy ledger for the same minute:

| event | time |
|---|---|
| `nyv-gateway` container **started** (deploy `2026-08-17T1015Z-aws-ssm`) | **10:25:07.532Z** |
| your task 387 created | **10:25:07.656Z** — *124 ms later* |
| deploy health gate reported green | 10:26:08Z |

**Task 387 arrived 124 ms into a container recreate.** The gateway process was booting;
it had not yet bound and passed health. A connection refused/reset at that moment is
surfaced by the upstream proxy as **502**, which is exactly what your fallback layer
recorded — and it is why our logs contain no matching 503, no provider failure and no
cascade exhaustion for it. **The request never reached a running handler.**

So both of us were reading our own evidence correctly: NYV's orchestrate genuinely
cannot emit 502, and you genuinely received one. Neither was a guess and neither was
wrong.

**This is ours to fix, and it is a deploy-window problem, not an orchestrate defect.**
Our recreate currently has no connection drain or readiness gate ahead of cutover, so any
request landing in that window fails this way. Tracked as such rather than closed as
"flake".

**What this means for you:** a 502 with a sub-5s failure and no NYV `requestId` is very
likely a deploy window. Your `nvErrorDiagnostics()` addition is exactly right — with the
`correlationId` persisted we can join to our request row immediately. Please keep the
retry you already have; a retry a few seconds later would have succeeded here.

---

## 2. Fields — you were on the right endpoint. The shape was the problem

**Answer to your direct question: there is no new operation to call.** The structured
payload comes from `analyzeDocument`, on **all three** of these, verified live just now:

| operation | result |
|---|---|
| `POST /api/nv/sdk/docs-pipeline/documents/analyze` | `fieldSource=nyv`, `fieldCount=11` |
| `POST /api/nv/sdk/docs-pipeline/documents/intelligence` | `fieldSource=nyv`, `fieldCount=11` |
| `POST /api/nv/gateway/documents/analyze` | `fieldSource=nyv`, `fieldCount=11` |

The 17 vs 11 difference is just the document: 17 came from an anticipatory-bail petition
with a full cause title, 11 from your cheque matter. It is not two different code paths.

### Why your arrays looked empty — a shape mismatch, and it was our contract's fault

Reading your mapping against what we actually emit:

| you read | reality |
|---|---|
| `data.entities` as an **array** | it is a **container object**: `entities.entities`, `.obligations`, `.risks`, `.deadlines` — so `.length` is `undefined` |
| `data.statutes` | **never existed** at any level of our contract |
| `data.deadlines` / `data.obligations` | only nested inside `entities`, never at top level |

So the extraction was not empty — you were reading a shape we do not publish, and we
never documented one that matched. Rather than ask you to restructure a working client,
**we added the flat aliases** (deployed):

```json
{
  "fields": [ … 11 items … ],
  "fieldCount": 11,
  "fieldSource": "nyv",
  "detectedDocumentType": "cheque_dishonour_complaint",
  "isIndianCourtDocument": true,

  "statutes": ["Section 138 of the Negotiable Instruments Act, 1881"],
  "entitiesFlat":     [ … 6 … ],
  "deadlinesFlat":    [ … 4 … ],
  "obligationsFlat":  [ … 4 … ],
  "risksFlat":        [ … 5 … ],

  "entities": { "entities": [...], "obligations": [...], "risks": [...], "deadlines": [...] }
}
```

`entities` is unchanged for anything already consuming it. **Recommendation: map
`fields[]` as your primary source** — it is the structured, provenance-tagged extraction
(`key`, `label`, `value`, `confidence`, `source`) and it is what `fieldSource: "nyv"`
attests to. The `*Flat` arrays exist so your current mapping works without a rewrite.

### Your values, from `fields[]` on the cheque matter

| key | value | source |
|---|---|---|
| `fir_number` | `FIR No. 221 of 2025` | regex-rules |
| `police_station` | `Banjara Hills Police Station` | regex-rules |
| `next_hearing_date` | `20 September 2025` | regex-rules |
| `complainant` | `Meridian Textiles Pvt Ltd, rep. by its Managing Director` | cause-title |
| `accused` | `Ram Kumar S/o Late Shri Mohan Lal` | cause-title |
| `statutes_invoked` | `Section 138 of the Negotiable Instruments Act, 1881` | legal-ner |
| `amount_in_dispute` | `Rs 8,40,000` | legal-ner |
| `dates_mentioned` | `10 January 2025; 20 January 2025; 05 February 2025; 20 September 2025` | legal-ner |
| `organisations` | `Meridian Textiles Pvt Ltd; State Bank` | legal-ner |
| `prayer` | the prayer clause | regex-rules |
| `document_type` | `cheque_dishonour_complaint` | regex-rules |

---

## 3. Two content bugs you surfaced — one fixed, one not reproducible

**Fixed: `detectedDocumentType` said `fir` for your cheque complaint.** Real bug, and a
good catch. Our hint list is first-match-wins and a bare `/\bFIR\b/` sat above the
specific patterns — your pleading references "FIR No. 221 of 2025" as background, so the
reference beat the actual cause of action. Now ordered most-specific-first, `fir` requires
a leading reference or the literal "First Information Report", and
**`cheque_dishonour_complaint` is its own type** because NI-138 carries a limitation clock
(30-day notice from the return memo, complaint within one month of the 15-day cure
period) that no other complaint shares — you should be able to autofill that.
Verified live: `detectedType=cheque_dishonour_complaint`.

**Not reproducible: "BNS Section 138 — Abduction".** We probed the same cheque matter on
both analyze paths on the current build. Result: `statutes_invoked` =
`Section 138 of the Negotiable Instruments Act, 1881`, and the strings `Abduction` and
`BNS 138` are **absent from the entire payload**. The analysis prose opens correctly with
*"Section 138 of the Negotiable Instruments Act, 1881 (NI Act)"*.

Your observation predates deploy `2026-08-17T1541Z`, which included an NER fix where
`AMOUNT` matching was over-firing. I am **not** claiming that fix explains it — I cannot
show the link. **If it recurs, send the `requestId`** and we will pin it rather than
theorise. Statute-to-instrument confusion on a 138 matter is serious enough that I do not
want to mark it closed on a non-reproduction.

---

## 4. Summary

| Item | Status |
|---|---|
| Task 387 | **Attributed — our deploy window.** 124 ms into a container recreate; drain/readiness gap is ours to fix |
| Which operation returns the fields | **`analyzeDocument`, all three paths.** No new operation |
| Empty `entities` / `statutes` | **Our contract's shape mismatch.** Flat aliases + real `statutes` array now deployed |
| `fir` mis-classification | **Fixed and verified live** |
| BNS 138 / Abduction | **Not reproducible on the current build** — need a `requestId` |

Nothing is blocking you. If your extractor maps `fields[]` you get provenance and
confidence per value; if you keep your current mapping the `*Flat` aliases now satisfy it.
