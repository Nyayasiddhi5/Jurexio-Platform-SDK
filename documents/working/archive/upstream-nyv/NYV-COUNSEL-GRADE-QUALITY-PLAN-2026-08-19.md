# NYV counsel-grade quality — action plan (2026-08-19)

**Every finding below was produced by running the live platform, not by reading code.** Where a
probe of mine was wrong, that is recorded too, because two of them were.

---

## 1. What is already counsel-grade (measured, not asserted)

A bail application through `legal-draft-fast` returned **10,978 characters** and passed **8 of 8**
structural checks:

| Check | Result |
|---|---|
| Cause title (`IN THE COURT OF THE PRINCIPAL SESSIONS JUDGE AT HYDERABAD`) | PASS |
| "Most Respectfully Showeth" | PASS |
| PRAYER | PASS |
| VERIFICATION | PASS |
| BNS cited, not IPC | PASS |
| Numbered paragraphs | PASS |
| Advocate signature block | PASS |
| `[[PLACEHOLDER: …]]` instead of fabricated facts | PASS |

The prompt layer behind this is genuinely strong and is **not** where the gap is:
`INDIA_CORE` in `nv-legal-drafting-prompt.ts` carries post-1 Jul 2024 BNS/BNSS/BSA currency, the
Indian pleading register ("Most Respectfully Showeth", "This Hon'ble Court"), forum precision
down to seat and State, an anti-fabrication rule, and the SME **bail-surety rule** (never draft
sureties at application stage). 12 of 13 draft families have a per-family skeleton via
`indiaStructureFor()`.

Knowledge surfaces verified live: `ipc-bns` **and** `new-old` both return `changeNotes`; caselaw
FTS returns results; citation extraction found 2 of 2; treatment resolves Maneka Gandhi → 1978.

**A correction to my own earlier reading.** My probe flagged `SURETY LEAK: 5` and I nearly
reported an SME-rule breach. Read in context it is not one: the body says only "ready and willing
to furnish reliable local sureties" — a permitted undertaking — and the remaining mentions sit in
counsel-notes explicitly marked "post-order" / "post-grant". My regex was too blunt. Likewise
`analysis` first appeared to fail; it returns http=200 with 23 KB of correctly structured output,
and the failure was my probe's 170 s timeout.

---

## 2. The one real quality defect: retrieved authorities never reach the answer

This is the finding that matters, and it is the same gap as "good-law" seen from the inside.

Asked for **"leading Supreme Court authorities on anticipatory bail for economic offences"**, the
platform returned 6,925 characters of well-structured prose containing:

- **0** SCC/AIR citations
- **0** case names
- `citations: { verified: 0, unverified: 1, details: [{ text: "Article 21 of the Constitution" }] }`
- `trust: { grounded: true, citationsPresent: true, qualityOk: true }` ← **reports healthy**

The corpus is not the problem. The governing authorities are present:

| Query | Corpus result |
|---|---|
| Sushila Aggarwal | `SUSHILA AGGARWAL & ORS. versus STATE (NCT OF DELHI)` — 2018 |
| Gurbaksh Singh Sibbia | `GURBAKSH SINGH SIBBIA ETC. versus STATE OF PUNJAB` — 1980 |

### Root cause — two independent faults, both proven

**(a) The extras deadline discarded completed retrieval.** One captured trace:

```
auto-rag extras deadline — using unified-base only   extrasDeadlineMs: 2500  jobs: 3
NYS knowledge network failure — retrying  path:/retrieve  "operation was aborted due to timeout"
auto-rag complete   layersUsed:["unified-base"]   latencyMs: 3060
NYS knowledge recovered after retry  path:/retrieve      ← 1.2 s AFTER the answer was composed
```

The caselaw layer *succeeded* — just too late to be used. Measured from inside the gateway,
`/retrieve` takes **285–464 ms** against a 2,500 ms budget, i.e. 6× headroom, so this is
contention under a live orchestrate rather than a slow endpoint. Meanwhile the whole request took
**65 s**, so the 2.5 s cap was starving retrieval to protect time that does not matter. The
deadline only stops *waiting* — the work completes and is thrown away.

I raised `NYV_AUTO_RAG_EXTRAS_DEADLINE_MS` to 8000 on the dev host. `nys_global` now appears in
`layersUsed`, but **`cases=0` still**, which proved the deadline was only a contributing factor.

**(b) `citationRef` is never rendered into the prompt on the orchestrate path.** `caseToChunk()`
does populate `title` and `citationRef` for every retrieved judgment, so the data reaches the
router intact. But `citationRef` is only rendered into an LLM-visible context block in
`nv-sdk-gateway-routes.ts` — **not** on the auto-RAG / orchestrate path that NSP and the console
actually use. The model receives snippet prose with no quotable citation, so it correctly declines
to invent one. Our own anti-fabrication rule then guarantees a citation-free answer.

That combination is why `trust.citationsPresent` can be `true` while an advocate sees zero
authorities: the gate checks that a citation *step ran*, not that any authority was *delivered*.

---

## 3. Plan of action

### P0 — citation grounding (this is the whole quality gap)

1. **Render `citationRef` into the orchestrate RAG context block**, in the numbered form already
   proven in `nv-sdk-gateway-routes.ts:1147`
   (`1. <title> — <citationRef>`). One code path, reusing a format that already works.
2. **Instruct the model to cite what it was given.** The overlay currently forbids inventing
   citations but never *requires* using supplied ones. Add: every proposition resting on a
   supplied authority must carry its citation inline; if the context has no authority, say so.
3. **Make `trust.citationsPresent` mean what it says** — assert at least one authority in the
   body, not merely that the citation step executed. A gate that passes on zero authorities is
   the same defect class as NSP's FB-189 and FB-195.
4. **Keep `NYV_AUTO_RAG_EXTRAS_DEADLINE_MS=8000`.** On a 55–65 s request, spending 8 s to consult
   the caselaw corpus is obviously correct; 2.5 s was optimising the wrong axis.

### P1 — good-law, which is the competitive gap

5. **Route + panel over the §1c interim.** The data and `resolution.confidence` now exist; a
   lawyer still cannot ask "is this still good law?". Keep rendering `unknown` as unknown and
   always show `coverage`.
6. **Expand `nv_legal_graph_entities` / `_edges`** — **15,548 edges live** (Aug 2026 ingest); continue
   SC-first expansion from corpus where treatment language is densest — full treatment graph is incremental, not blocked.

### P2 — instrument breadth (the "standard length / accepted formats" ask)

7. **Extend beyond ~16 instrument types.** Missing what a litigation practice files weekly:
   rejoinder, counter-affidavit, review petition, execution petition, caveat, written statement,
   SLP, interim application. Each needs an `indiaStructureFor()` skeleton — the pattern already
   works, it just needs coverage.
8. **Add the 13th family skeleton** (`custom` currently falls through to generic prose).

### P3 — competitor parity, in the order it is commercially useful

9. Firm clause library into drafting prompts — table exists, seeded, org-scoped, but no draft
   service reads it. Cheapest route to the "firm voice" claim.
10. Reasoning-trail UI over the 16-stage envelope already persisted per task.
11. Clause-level diff — **ownership resolved 2026-08-19: NSP's to build; NYV must add nothing.**
    See §5. The earlier parenthetical here ("needs a clause table before diffing is possible")
    was written from the NYV side and is misleading: the missing table is `ns_document_clauses`,
    which is **NSP's**, and NYV already returns per-clause structure over an SDK-key endpoint.

### Measurement — this must not be assertion again

12. **Run the v2 cost benchmark.** The ladder reorder and prompt caching are still *unmeasured*;
    we are asserting a saving we have never observed.
13. **Add a citation-density regression probe**: N research prompts, assert ≥1 verified authority
    each. That converts "counsel-grade" from a claim into a number that can fail in CI.

---

## 4. Honest position vs lexlegis.ai

Ahead on **statute transition** (both directions, 1-to-many preserved, verified-vs-AI separated),
on **drafting structure** (measured 8/8 above), and on being a system of record rather than a tool.

Behind on **good-law** — and that is the one a competitor demos. Our interim is honest but has no
UI. The other three gaps (firm voice, Word add-in, obligations) are commercially useful, not
correctness risks.

**The uncomfortable part**: for a research question our output currently *reads* authoritative
while citing nothing. That is worse than a visible gap, because it looks finished. P0 fixes it,
and it is a small change — the retrieval already works; we discard its best part before the model
can use it.

---

## 5. Ownership verdict — clause-level diff is **NSP's**, and NYV needs to add nothing

NSP's gap assessment says: *"clause-extract is mobile-only; classify-clauses has zero callers.
No `ns_document_clauses` table, so clauses are never persisted — that structurally blocks
clause-level diff."* Every one of those statements is about **NSP's own tree**. `ns_` is NSP's
prefix. This is the same shape as the firm clause library, where an agent nearly built
`ns_clause_library` inside NYV before noticing it was the partner's table — so the ownership
question was answered before anything was built.

**Verdict: (b) NSP's to build. NYV already exposes everything required. No new NYV schema,
service or route is needed to unblock it.**

### 5.1 What was checked — and why this is not a false "does not exist"

`FEATURES-REGISTRY.md` first (mandatory), then a repo-wide identifier sweep rather than a
single grep, because the failure mode here is concluding absence from one pattern.

| Check | Command / method | Result |
|---|---|---|
| Registry | `FEATURES-REGISTRY.md` for `clause` / `compare` / `diff` / `redline` | one row, about model routing. No clause-persistence or clause-diff feature is claimed |
| Every clause-ish table identifier in the tree | regex over all files for `(nv\|ns\|ni\|nm\|sdk)_*clause*` — not one literal | exactly 5 real names: `sdk_clause_library`, `nv_template_clauses`, `ni_knowledge_clauses`, `ns_clause_library`, `nv_firm_clause_rls_test` |
| Drizzle + SQL migrations | `drizzle/*.sql`, `migrations/*.sql` | only `nv_template_clauses` (0001) and `sdk_clause_library` (0000) are created |
| Drizzle TS schema | `shared/*.ts` | `sdkClauseLibrary`, `nvTemplateClauses` only |
| Wiring audit | `docs/audit/nv-wiring-audit.json` (orphans **0**) | every service named below is `wired`, so none of this is dead code I mistook for live |

Of those five identifiers, none is a per-document clause store:

- `sdk_clause_library` — 15-row **platform-curated** catalogue. No `org_id`, has `is_system`. Template wording, not extracted document clauses.
- `nv_template_clauses` — FK to `nv_legal_templates`. Clauses *of a template*, not of an uploaded document. No `org_id`.
- `ni_knowledge_clauses` — appears only under `archive/2026-05-10-product-ecosystem-split/`, in `ni_schema` (NSI, a different product). Not live NYV.
- `ns_clause_library` — **NSP's**, referenced in NYV only as prose in `nv-firm-clause-library.ts` explaining that it is *not* here.
- `nv_firm_clause_rls_test` — a test fixture name.

**So: NYV does not persist document clauses, and that is a deliberate boundary, not an oversight.**
The nearest thing is `nv_schema.nv_doc_analysis_stats`, which stores `clauses_found` — a **count**,
not the clauses. Confirmed at `legal-doc-analyze-service.ts:532`: the insert writes
`${clausesResult.length}`, and the clause array itself is returned to the caller and discarded.

The one place clause *content* is persisted is decisive for ownership:
`nv-ecosystem-document-job-service.ts:399` writes the full analysis (clauses included) into
**`ns_documents.analysis_result`** — an NSP table that NYV neither defines nor migrates (no
`shared/**`, `drizzle/**` or `migrations/**` reference; only `UPDATE` statements, wrapped in a
try/catch commented *"NSP table may be absent on some envs"*). NYV is already handing extracted
clauses to NSP's own store. Persistence sits on NSP's side of the line by existing design.

### 5.2 `clause-extract` and `classify-clauses` on the NYV side

"Mobile-only" and "zero callers" are true of NSP's callers. On the NYV side both are live,
server-side, and partner-reachable:

| Surface | NYV path | Auth | What it is |
|---|---|---|---|
| `classify-clauses` | `POST /api/nv/gateway/documents/classify-clauses` (`nyv.gateway.classifyClauses`) | **SDK key** | LLM classification: `{clauses[], overallRiskScore}` per clause with `clauseType`, `riskLevel`, `explanation`, `recommendations`, `confidence`. Has a deterministic heuristic fallback so an unparseable LLM reply never returns `clauses: []` |
| `clause_extractor` | MCP curated tool + registry (`clause-extraction` capability, aliased from `contract-review` / `review` / `summarization`) | MCP / Queen | agent-routed extraction, not a REST contract |
| Structured clause analysis | `POST /api/nv/intelligence/contract-analysis` (`nyv.intelligence.analyzeContract`) | **SDK key** (`dualSdkOrJwt`) | **deterministic, zero LLM** |
| Clause list inside analysis | EDJ `GET /jobs/:id/result`, `POST /api/nv/documents/highlight` | SDK key / JWT | `clauses[]` with `type`, `content`, `pageRef`, `importance` |

They are **NYV capabilities that NSP happens to call from one surface** — not NSP features, and
not absent.

### 5.3 What NYV already gives NSP for clause diff (executed, not read)

`POST /api/nv/intelligence/contract-analysis` returns per-clause records:
`{ clauseNumber, title, text, category, riskScore, riskReason }`. Run against two versions of a
4-clause MSA, a clause-level diff was derivable client-side from that output alone with no NYV
change:

```
A: 1|DEFINITIONS  2|PAYMENT TERMS  3|LIMITATION OF LIABILITY  4|TERMINATION
B: 1|DEFINITIONS  2|PAYMENT TERMS  3|LIMITATION OF LIABILITY  4|TERMINATION  5|GOVERNING LAW
diff → modified 1,2,3,4 · added 5
```

Today's document comparison is **not** clause-level. Three distinct paths, all coarser:

| Path | Granularity | Notes |
|---|---|---|
| `POST /api/nv/documents/redline` | **line** — LCS `diffLines` + `renderUnified` | deterministic; optional LLM material-change summary. **JWT only** — an `X-API-Key` gets 401 (probed: valid JWT → 200, `X-API-Key` → 401 `AUTH_TOKEN_MISSING`) |
| `POST /api/nv/documents/merge` | **paragraph** — split on `\n{2,}`, dedupe, conflict-detect against a 15-keyword clause list | JWT only |
| `POST /api/nv/gateway/documents/compare`, `POST /api/nv/sdk/docs-pipeline/documents/compare` | **LLM prose** — `{similarityScore, differences[{section, type, significance}]}` where `section` is whatever the model names | SDK key. Non-deterministic; unusable as a diff primitive |

So NSP's read is right that nothing clause-level exists — and the honest addition is that the
**deterministic** diff primitives (`/redline`, `/merge`) are JWT-only, i.e. not available to a
partner key at all.

### 5.4 Two measured caveats NSP must design around

Both found by running the code, and both are reasons NSP should own the clause segmentation:

1. **`text` bleeds into following clauses.** `extractClauses` takes `text.slice(index, index+500)` from each heading match, so clause 1's `text` contains clauses 2 and 3 verbatim. A naive `a.text !== b.text` diff therefore marks **every** clause modified when only the last one changed — exactly what the probe showed. NSP must bound each clause at the next clause's start offset (or diff `title` + a re-sliced body).
2. **`nv-legal-parser-service` cannot segment clauses at all.** `postProcessLegalContent` runs `replace(/\s{2,}/g, ' ')` before section detection, which collapses the blank line between clauses. Isolated: the same input yields **2** sections pre-clean and **1** post-clean, and a 4-clause MSA parsed to one section titled `""`, misclassified `case`. So `docs.parse-legal` is not a clause source today.

`clauseNumber` is also the field name (`AnalyzedClause.clauseNumber`) — my first probe read
`c.number` and printed `undefined`, which would have read as "no clause identifier". That was my
instrument, not the platform.

### 5.5 The line

| Piece | Owner | Why |
|---|---|---|
| Clause extraction / classification | **NYV — already shipped** | `contract-analysis` (deterministic), `classify-clauses` (LLM), EDJ `clauses[]` |
| `ns_document_clauses` + persistence | **NSP** | `ns_` is NSP's prefix; NYV already writes clause payloads into `ns_documents.analysis_result`. A NYV-side per-document clause store would duplicate the partner's system of record — the NV-NO-DUPLICATE-001 failure mode |
| Clause alignment + diff UI | **NSP** | needs version history that lives in NSP (`ns_documents`), and NSP already ships an LCS diff for document versions |
| Semantic "material change" narrative | **NYV — already shipped** | `/documents/redline` `semanticRedlineSummary`, and LLM compare on the gateway |

**Nothing is blocking NSP.** Recommended NSP path: call
`POST /api/nv/intelligence/contract-analysis` per version, re-slice each clause body to the next
clause's offset (§5.4 item 1), persist to `ns_document_clauses`, and align on `clauseNumber` +
normalised `title` with a text-similarity fallback for renumbered clauses.

### 5.6 Optional — only if NSP asks

Not proposed, and **not built**, because NSP is unblocked without it. If NSP would rather not own
the segmentation caveats, the smallest honest NYV addition is one endpoint, no new table:

```
POST /api/nv/gateway/documents/extract-clauses     scope: documents:read
{ "content": "<document text>", "jurisdiction": "IN" }
→ { "success": true, "data": { "clauses": [
      { "clauseNumber": "3", "title": "LIMITATION OF LIABILITY",
        "text": "<bounded at the next clause's start, not a 500-char slice>",
        "startOffset": 412, "endOffset": 690,
        "category": "risk", "riskScore": 4, "riskReason": "..." } ],
    "extractionMethod": "deterministic-heading-scan", "latencyMs": 12 } }
```

The only new thing is `startOffset` / `endOffset` and a correctly bounded `text` — i.e. fixing
§5.4 item 1 server-side and exposing it. It stays deterministic (no LLM, no cost), and it does
**not** persist: storage remains NSP's. **We should not build this speculatively.**

---

## 6. Roadmap to 9.5/10 (2026-09-17 update)

**Score history:** Registry/polish audit **7.2/10** (Sep 2026) measured mesh + eval blind spots, not missing draft SME rules. Post **`1719Z`** + **`0540Z`**, honest composite is **~8.0–8.2/10**. Draft structure ~**9.2**; research **`authority_density`** still ~**7.0–7.5** on live gates.

**Live 15-case result (2026-09-17T07:52Z, deploy `0540Z`/`fe966a94`):** **12 ok / 2 fail / 1 blocked**. Artifact: `.local/benchmarks/live-eval-0540Z-fe966a94-2026-09-17T07-52-01-149Z/`. Compared to 10-case baseline **8 ok / 2 fail**: anticipatory-bail research **fixed**; analysis-msa-risk **fixed**; writ/SLP/leading-SC **PASS**.

**P0 fix deploy (2026-09-17T09:15Z, `0858Z-aws-ssm`):** NV-COUNSEL-GRADE-P0-002 — `research-section-138-ni-act` **PASS** (`authority_density`, 86s); `draft-comprehensive-written-statement` **anti_fabrication PASS** (24 placeholders, 159s). Artifact: `.local/benchmarks/p0-fix-verify-2026-09-17T09-15-22-533Z/`.

**Full 15-case re-run (2026-09-17T09:47Z, deploy `0923Z`/`49c04744`, SSM `5bd36184`):** **15 ok / 0 fail / 0 blocked** — 67 assertions pass, 0 fail, 0 blocked. Queen async comprehensive **PASS** @276s (timeout raised to 300s). Artifact: `.local/benchmarks/full-eval-0923Z-49c047445-2026-09-17T09-47-14-287Z/`. **NYV counsel-grade operational gate for 9.5: MET.**

**NSP stream metadata (2026-09-17T09:58Z, deploy `0947Z`/`49c04744`, NV-NSP-STREAM-META-001):** stream `run_completed` now mirrors sync `draftQuality.inferredDocumentType` when NYV infers doc type; explicit `legal_notice` omits inference fields (sync-parity). `routing_hint` still absent on medium legal_notice stream (same as sync — only emitted for long-pleading routing).

**Operational definition of 9.5:** Live `npm run eval:counsel-grade` → **15 ok / 0 fail / 0 blocked** ✓; all assertion families green on claimed cases ✓; NSP comprehensive async worker live for long pleadings — **NYV Queen path green**; NSP app poll/worker still handshake-tracked.

### P0 — NYV (before claiming 9.5)

| # | Action | Gate | 2026-09-17 live status |
|---|--------|------|------------------------|
| 1 | Live 15-case run on deploy `49c04744`; archive to `.local/benchmarks/` | 15/0/0 quality | **DONE** — **15/0/0** on `0923Z` SSM `5bd36184` |
| 2 | Close `authority_density` on all 3 `legal_research` cases | minCaseAuthorities ≥ 1 + envelope_honesty | **3/3 PASS** (NI Act fixed P0-002) |
| 3 | Fix `analysis-msa-risk` timeout / token budget | structured_fields PASS | **PASS** (131s on `49c04744`) |
| 4 | Live PASS on WS, writ, SLP draft eval cases | draft_structure + length_floor | **ALL PASS** incl. WS anti_fabrication |
| 5 | Post-deploy `eval:counsel-grade:gate` in SSM smoke | 0 regressions | **PASS** via full live 15-case run |

### P0 — NSP/NYS (cannot reach 9.5 NYV-only)

| Owner | Action |
|---|---|
| **NSP** | Async comprehensive worker + poll (handshake §3.4); honour `routing_hint` |
| **NYS** | Caselaw embed depth + hybrid stability for research queries |
| **NSP + NYS** | Leading SC authority prompts return locatable SCC/AIR in body |

### P1 — NYV harden

Proposition verify on research output; `structureMarkers` telemetry for WS/WP/SLP; template catalog **20/20** keyed; analysis path SLA budget.

### Intentionally not blocking 9.5

| Item | Verdict |
|---|---|
| Bulk 164 registry JSON rewrite | **Not required** — overlays are SME SSoT (handshake §11) |
| GRPO GPU trainer | **P3 commercial** — online policy already wired |
| Maker-checker on `-fast` | **SLA tradeoff** — ON for Queen counsel; OFF on specialist by design |

**Do not announce 9.5/10** until P0 NYV live eval **and** P0 NSP async comprehensive are green on the same deploy generation.
