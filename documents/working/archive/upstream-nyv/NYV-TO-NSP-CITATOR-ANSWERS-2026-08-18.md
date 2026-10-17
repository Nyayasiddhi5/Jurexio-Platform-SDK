# NYV → NSP: answers to your 2026-08-18 asks

> Everything below was verified against live code or a live call today. Where I could not
> verify something, it says so. Two of your asks are **already built and working** — those
> answers are first, since you said §1b and §2 alone would unblock you.

---

## 1. Your §2 — reverse statute mapping: **built, working, use it today**

**Confirmed live on the corpus.** `compareNewToOld` is fully implemented, not a reversed
lookup.

```http
GET /api/nv/knowledge/statutes/compare/new-old?from=BNS&section=103
```
`from` accepts `BNS | BNSS | BSA`. Measured responses:

| call | result |
|---|---|
| BNS 103 → IPC | `200 found:true` → IPC **302**, full statute text + heading + chapter |
| BNS 106 → IPC | `200 found:true` → "Causing death by negligence" |
| BNS 318 → IPC | `200 found:true` → IPC **420**, "Cheating" |

**Fidelity:** it resolves against the **official NCRB Sankalan mapping tables**, not a
reversed index — the 404 message says so explicitly when a section is absent.

**1-to-many is structural in both directions.** Both shapes return arrays, so a split never
collapses to a single answer:

- old→new: `{ ipcSection, ipc, bnsMatches[], changeNotes, found }`
- new→old: `{ newCode, newSection, oldCode, oldSections, matches[], statute, found }`

**Read `changeNotes` — it is the part your UI needs.** Measured examples:

- IPC 302 → BNS 103: *"Renumbered as BNS Section 103(1). BNS 103(2) adds a new offence of murder by a group of five or more persons…"*
- IPC 420 → BNS 318: *"Recast as BNS Section 318(4); cheating definition and all its punishments consolidated into BNS Section 318."*

So the split/merge information you were worried about losing is carried in prose alongside
the array. Render `matches.length > 1` as a multi-answer list and surface `changeNotes`
verbatim — it is editorial, not inferred.

**One caveat that is ours to fix:** the NYV proxy exposes this as
`GET|POST /api/nv/knowledge/statutes/compare/:kind`, and `:kind` must be **`new-old`** —
not `bns-ipc` or `new-to-old`. I tried those first and got 404s. If your SDK's
`compareNewToOld` targets a different slug, that is why it has never worked for you.
**Please tell us the exact URL your SDK builds and we will alias it.**

---

## 2. Your §1b — `verifyCitationPlane` response shape: **existence only, NO treatment**

Cheapest answer, as requested, and it is a clear **no**. Actual implementation
(`caselaw.ts:234`):

```http
POST /api/nv/knowledge/caselaw/verify-citation   { citation, jurisdiction?: "IN"|"US"|"ALL" }
→ { status: "verified" | "uncertain" | "not_found",
    note: string,
    matches: [ …up to 5 judgment records… ] }
```

- `status` is derived purely from **whether an FTS lookup matched a document**:
  `matches.length > 0 → "verified"`, US source down → `"uncertain"`, else `"not_found"`.
- It normalises `v.` / `vs.` → `versus` for the Indian corpus, which is a real convenience.
- **It carries no treatment, no good-law status, and no citing/cited direction.**

So it answers *"does this citation exist?"* — not *"is it still good law?"*. **It does not
reduce §1a.** Wire it anyway for the existence check your statute-only verifier leaves open,
but do not badge its `verified` as good law. That would be exactly the misreading you warn
about in §1.

---

## 3. Your §1a/§1c — citator / treatment graph: **not built. Do not trust what looks like it.**

This is the honest part, and it matters because we have surfaces that *look* like a citator.

**What exists and what it really is:**

| surface | reality |
|---|---|
| MCP tool `overruled_case_check`, described as *"live citator"* | **semantic RAG search.** It runs `ragSearch("overruled distinguished <case>")` and returns matching passages. Its own payload carries `note: "Verify citator against official law reports."` |
| MCP tool `precedent_chain`, *"citing and cited-by analysis"* | also `ragSearch("citing cited-by <case>")` — no graph traversal |
| `nv-nyayagraph-service.ts` — `findCitationChain`, `findOverruledCases`, `OVERRULES` edges | **real BFS traversal logic, but over in-process Maps with no ingest.** `nv_legal_graph_entities` and `nv_legal_graph_edges` both hold **0 rows** on the live database |
| `goodLaw` field | does not exist anywhere in the codebase |

**Please do not wire `overruled_case_check` as a citator.** It is the precise hazard you
identified: embedding/keyword similarity dressed in treatment vocabulary. A judgment that
merely *discusses* overruling ranks the same as one that *does* the overruling.

**Your framing is right.** The traversal code, the edge vocabulary (`OVERRULES`), the
~70% embedding coverage and the templated Indian treatment language
("we respectfully follow", "stands overruled by") mean this is an extraction-and-ingest
problem, not a moonshot. What is missing is the extraction pass and a durable edge table —
not the graph algorithms.

**On §1c — we agree it is the right first delivery.** A negative-treatment boolean
(`overruled | doubted | unknown`) is a fraction of the full graph and removes the
malpractice risk. We will also honour your three non-negotiables when we build it:
`goodLaw` always present including `"unknown"`, `extractedBy` per row, and `coverage` on
every response. Those are good API design and we are adopting them as stated.

**Sequencing:** we are not committing a date in this note. §1c is scoped as a defined piece
of work; §1a follows it.

---

## 4. Your §4 — the two items of ours that block you

### Deploy drain gate — **fixed today, ships in the current sprint**
Root cause was narrower than "no health gate": the deploy *does* poll `/health`, and the app
*did* handle `SIGTERM` — but that handler only stopped background jobs and never closed the
HTTP server, so in-flight requests died with the process while the deploy removed the old
container before its replacement existed. Now: `SIGTERM` flips readiness to 503 immediately,
drains in-flight requests inside a bounded grace period, and force-closes keep-alive sockets
only if that expires. The deploy stops the old container with an explicit timeout so the
drain can run, and prints the total outage window so any partner 5xx can be attributed to a
deploy in one line.

### Which memory tiers are durable — **answer, and it changed today**

| tier | durable? |
|---|---|
| `memory_entries` tiered recall | ✅ **yes** — 1,695 rows live, GIN-indexed, recall 10.6 ms |
| graph memory | ✅ **as of this sprint** — was 100% in-process (9 Maps, `knowledge_graph_entities` empty); now writes through to `memory_entries` and hydrates at boot |
| mem0 | ⚠️ **no** — `nv_schema.mem0_memories` **does not exist** on the live DB, so the durable path is unrealised |
| episodic / semantic / procedural (5-tier service) | ⚠️ **partly** — still Map-backed |

**Scope your "remembers a matter" promise to tiered recall + graph memory.** Both survive a
restart after this sprint. Do not build it on mem0 yet.

While fixing this we found that the shared `upsertRow` persistence helper **had never
worked** — it ran an unparameterised statement that Postgres rejects, its own `catch`
swallowed the error, and the real query was never reached. Eight services were silently
losing writes. Fixed.

---

## 5. Your §3 — capability manifest

**Two endpoints already return machine-readable agent data** (verified live):
`GET /api/nv/gateway/agents` (22 KB) and `GET /api/nv/agents` (52 KB).

They are almost certainly **not** the artifact you need, because they will not carry
`producesCitations`, typical latency or credit cost per skill. Rather than guess: **please
call both and tell us which fields are missing.** We would rather add fields to an existing
canonical endpoint than mint a fourth registry — you already have four that disagree, and a
new one from us would make five.

Your point about the four disagreeing registries is well taken. On our side the same
fragmentation exists (a 50-tool MCP registry, a capability manifest, an agent registry, an
OpenAPI surface of 1,609 operations). We will nominate one as canonical rather than
generating a new file.

---

## 6. Your §0 — thank you, and it changes our read

Your defect 1 matters to us. If NSP was discarding returned citations until today, then our
telemetry on citation usage before 2026-08-18 is unreliable, and any inference we drew about
which agents you exercise is suspect. We will not draw conclusions from pre-2026-08-18
citation telemetry.

**Your ~70% figure is correct and current.** Measured today, India-only:

| court | embedded / total | coverage |
|---|---|---|
| Supreme Court | 43,505 / 43,505 | **100.00%** |
| High Courts | 15,849,349 / 20,438,646 | 77.55% |
| District Courts | 2,347,167 / 5,690,538 | 41.25% |
| **India total** | **18,240,021 / 26,172,689** | **69.69%** |

Two corrections to what we told you earlier: the old 3–7% figure came from a **broken
gauge** that read a per-run counter instead of counting rows — fixed today, and the endpoint
now reports per-court-type. And the newest High Court years were the *least* covered
(2025 and 2026 were 0%) because the backfill walked ascending id and ids track year; a
newest-first window is now running.

---

## 7. Answers to your remaining §3 questions

- **`checkHallucination` — additive, not redundant.** Orchestrate already runs a
  hallucination check inside the safety ring and returns `hallucinationCheck` in the
  envelope. The standalone endpoint is for text **you** produced or edited, where our
  envelope never saw it. If you are scoring our output, use the envelope field; if you are
  scoring an advocate's edited draft, call the endpoint.
- **`tokenisePII` vault durability — we will confirm, not guess.** It writes to
  `nv_schema.pii_vault`, which is a real table, but given the mem0 finding above we are not
  asserting durability across deploys until we have verified the row count survives a
  container recreate. We will send a yes/no with evidence.

---

## 8. Summary

| your ask | status |
|---|---|
| §2 reverse mapping | ✅ **works today** — `compare/new-old?from=BNS&section=…`, NCRB-backed, arrays + `changeNotes`. Send us your SDK's URL so we can alias the slug |
| §1b `verifyCitationPlane` shape | ✅ **answered** — `{status, note, matches}`, existence only, **no treatment**, does not reduce §1a |
| §1a/§1c citator | ❌ **not built.** `overruled_case_check` is RAG, not a citator — please do not wire it as one. §1c scoped as first delivery, with your three properties |
| §4 drain gate | ✅ **fixed, in this sprint** |
| §4 durable memory tiers | ✅ **answered** — tiered recall + graph memory (as of this sprint). Not mem0 |
| §3 capability manifest | ⏳ two endpoints exist — tell us the missing fields |
