---
status: live
canonical_doc: 8 of 8 (Data Architecture, Seeding, RAG & Memory Management)
audience: data engineers, RAG owners, platform engineers, lawyer panel
last_updated: 2026-05-02
sources_folded: MCP-Reconciliation-v5.0.0.md (archived), pending RAG/memory specs
to_fold_next: db schema sections from Technical Product Note §8, seeder specs
---

# Nyayavigya Platform — Data, Seeding, RAG & Memory Management

This is canonical doc **8 of 8** under the 2026-05-01 doc-consolidation
policy (see `Project-Tracker.md` §1 row "Doc policy"). It is the single
home for everything about:

- Database architecture (schemas, migrations, RLS, encryption)
- Data seeding (statutes, judgments, agents, model catalogue, MCP tools)
- RAG content corpus (sources, authenticity contract, pipeline, quality
  gates, lawyer review)
- Memory management (5-tier L1–L5, retention, encryption, eviction)

> Per consolidation policy: **edit this file in place** for any new RAG
> sources, seeder bumps, memory-tier policy changes, or DB schema work.
> Do not create a new doc.

---

## 1. RAG content-expansion action plan (active workstream — landed 2026-05-02)

### 1.1 Why this exists

Operator goal (2026-05-01): "create as many statutes, judgments,
sections and constitution details as possible in the RAG system. The
data must be authentic, validated and confirmed real accurate data so
that our platform credibility is improved."

Current live state (per `Project-Tracker.md` §1):
- `nv_statutes` table: **305 sections** seeded across 6 jurisdictions
  (header target 600+; we are at ~50% of the original target before
  this expansion plan starts)
- RAG infra: **fully built** — `src/services/rag/` includes
  `adaptive-rag-service`, `corrective-rag-service`, `self-rag-service`,
  `nyv-graphrag-legal-service`, `nyv-lightrag-pipeline`,
  `nyv-rag-pipeline-enhanced`, `nv-legal-embedding-service`,
  `nv-legal-reranker-service`, `nv-qdrant-adapter-service`. pgvector
  is wired and live.
- Knowledge module service: separate, `knowledge-module-service.ts`
- Statute verification: `nyayavigya-statute-verification-service.ts`
  already encodes a partial verification pattern we can build on.

So this is a **content-and-pipeline play, not infra**. Most of what
follows reuses code that already exists.

### 1.2 Authenticity contract — non-negotiable

Every chunk inserted into the live RAG (`nv_rag_chunks` with
`verified=true`) **must** carry:

| Column | Required | Meaning |
|---|---|---|
| `source_url` | yes | URL of the authoritative source the text was fetched from. Must match the allowlist in §1.3. |
| `source_sha256` | yes | SHA-256 of the canonical text body as fetched. Used for dedup and tampering detection. |
| `version_date` | yes | ISO date the version of the law/judgment became effective. |
| `amendment_history[]` | yes (`[]` if pristine) | Array of prior `{version_date, source_url, sha256}` rows superseded by this one. |
| `verified_by_count` | yes | Number of independent allowlisted sources that confirm the canonical text. **Landmarks (Constitution articles, top-100 SC judgments) require ≥ 2; routine sections require ≥ 1.** |
| `reviewed_by` | landmarks only | Lawyer panel member who signed off (FK to `nv_users.id`). Required for all Constitutional articles, all top-100 SC judgments, and any chunk where `verified_by_count = 1` AND `is_landmark = true`. |
| `reviewed_at` | landmarks only | ISO timestamp of signoff. |
| `is_landmark` | yes | Boolean. Triggers stricter verification + reviewer requirements. |
| `audit_hash_chain_id` | yes | FK into the strict-OK audit chain. Every insert appends an `RAG_CHUNK_ADMITTED` event. |

Anything that fails the contract goes to `nv_rag_quarantine` (new
table — see §1.4) and is **invisible to consumer queries**. The
RAG service's retrieval layer hard-filters on `verified=true` and
`is_active=true`.

**No scraping where Terms of Service forbid.** Only official APIs,
official bulk downloads, and licensed feeds. Where a source has no
API and ToS allows considerate fetching, we respect `robots.txt`,
honour rate limits, and identify our user-agent as `nyayavigya-rag/1.0`.

### 1.3 Allowlisted authoritative sources

Only these sources are permitted to populate `nv_rag_chunks`. Anything
else lives in `nv_rag_quarantine` until cross-verified by ≥ 1
allowlisted source.

| Jurisdiction | Statutes / Bare Acts | Judgments | Constitution / Subsidiary | Notes |
|---|---|---|---|---|
| **India (IN)** | India Code (`indiacode.nic.in`, official Min. of Law & Justice); `legislative.gov.in`; PRS India bill summaries (cross-ref only) | Supreme Court of India (`sci.gov.in`) — judgments JSON; eCourts (`ecourts.gov.in`) for HC; LIIofIndia (cross-verify only, never primary) | `legislative.gov.in/constitution-of-india` — full text + 12 schedules + 105 amendments | India Code has bulk download in PDF; SCI has structured JSON; eCourts requires CAPTCHA bypass via official partner programme — apply via NIC if scaling beyond 10k judgments/day |
| **United Kingdom (UK)** | `legislation.gov.uk` (official, has bulk XML API) | `bailii.org` (free, official partner of UK courts) | Constitutional statutes (Magna Carta, Bill of Rights 1689, HRA 1998, Acts of Union, Parliament Acts) — all from `legislation.gov.uk` | XML API is the gold standard — use it as the parser path |
| **European Union (EU)** | EUR-Lex (`eur-lex.europa.eu`, OData API + bulk downloads) | Court of Justice (`curia.europa.eu`) — official judgments JSON | TEU + TFEU + Charter of Fundamental Rights — from EUR-Lex | OData API is rate-limited; respect 5 req/s throttle |
| **United States (US)** | Cornell LII (`law.cornell.edu`, US Code XML), `congress.gov` (statutes-at-large), `uscode.house.gov` | CourtListener (Harvard/FreeLawProject corpus, official partner data, REST API), `supremecourt.gov`, `govinfo.gov` | US Constitution + 27 amendments — `archives.gov` (public domain) | CourtListener requires API key (free) — store as `RAG_COURTLISTENER_KEY` in Replit Secrets |
| **GCC** | UAE: `u.ae` official gazette; Saudi: `laws.boe.gov.sa` (Bureau of Experts); Qatar: `almeezan.qa`; DIFC: `difc.ae/laws` | DIFC Courts (`difccourts.ae`); ADGM Courts (`adgm.com/courts`) | UAE Constitution + member-state basic laws | DIFC/ADGM are English-language and have clean web exports |
| **Singapore (SG)** | Singapore Statutes Online (`sso.agc.gov.sg`, official AGC) | `supremecourt.gov.sg/judgments` (official); Singapore Law Watch | Singapore Constitution — from `sso.agc.gov.sg` | SSO has structured download; respect AGC ToS |

**Excluded (used only for cross-verification, never as primary):**
Wikipedia, Indian Kanoon (user-edited), random legal blogs, paid
databases without licence (Manupatra, SCC Online, Westlaw — unless
operator confirms a corporate licence, in which case we add them as
allowlisted with a `requires_licence: true` flag).

### 1.4 Pipeline architecture

Most stages reuse existing services. **New code: ~6 files** (marked
**NEW** below).

```
┌─────────────────────────┐    ┌──────────────────────┐    ┌──────────────────────┐
│ nv_rag_sources    [NEW] │ →  │ Fetcher worker [NEW] │ →  │ nv_rag_raw     [NEW] │
│ (allowlist + cadence    │    │ (per-source,         │    │ (immutable raw       │
│  + auth_ref + parser)   │    │  rate-limited,       │    │  + sha256 + headers) │
└─────────────────────────┘    │  honours robots.txt) │    └──────────┬───────────┘
                               └──────────────────────┘               ↓
                                                                      ↓
┌─────────────────────────┐    ┌──────────────────────┐    ┌──────────────────────┐
│ Parser (per-source) NEW │ ←─ │ Schema validator     │ ←─ │ Canonicaliser  [NEW] │
│ PDF/XML/HTML → JSON     │    │ (existing zod)       │    │ (whitespace,         │
└─────────────┬───────────┘    └──────────────────────┘    │  encoding, citation  │
              ↓                                             │  normalisation)      │
              ↓                                             └──────────────────────┘
┌─────────────────────────┐    ┌──────────────────────┐    ┌──────────────────────┐
│ Cross-source verifier   │ →  │ HITL queue if        │ →  │ Lawyer-panel review  │
│ [NEW]                   │    │ disputed/landmark    │    │ UI (existing HITL    │
│ (≥ 2 sources for        │    │ (existing            │    │  + Console)          │
│  landmarks; ≥ 1 routine)│    │  nv_hitl_queue)      │    └──────────┬───────────┘
└─────────────┬───────────┘    └──────────────────────┘               ↓
              ↓                                                       ↓
┌─────────────────────────┐    ┌──────────────────────┐    ┌──────────────────────┐
│ Citation enricher       │ →  │ Legal embedder       │ →  │ pgvector + Qdrant    │
│ (extracts section refs, │    │ (existing            │    │ (existing            │
│  judgment cites, builds │    │  nv-legal-embedding- │    │  nv-qdrant-adapter)  │
│  knowledge-graph edges) │    │  service)            │    │                      │
└─────────────────────────┘    └──────────────────────┘    └──────────┬───────────┘
                                          ↓                           ↓
                               ┌──────────────────────┐    ┌──────────────────────┐
                               │ Reranker training    │    │ Audit chain append   │
                               │ data (existing       │    │ (RAG_CHUNK_ADMITTED) │
                               │  nv-legal-reranker)  │    │                      │
                               └──────────────────────┘    └──────────────────────┘
```

**New files to create (in order):**

1. `src/services/rag/nv-rag-source-registry.ts` — CRUD for `nv_rag_sources`; defines source kinds, parsers, cadences, auth refs.
2. `src/services/rag/nv-rag-fetcher-worker.ts` — single worker class that polls one source, fetches raw, writes to `nv_rag_raw`. Respects robots.txt + rate limits + ETags.
3. `src/services/rag/parsers/` — directory with one parser per source family: `india-code-pdf-parser.ts`, `legislation-uk-xml-parser.ts`, `eurlex-odata-parser.ts`, `cornell-lii-xml-parser.ts`, `sso-sg-html-parser.ts`, `sci-india-json-parser.ts`, etc. Each exports a single function `parse(raw): ParsedSection[]`.
4. `src/services/rag/nv-rag-canonicaliser.ts` — whitespace/encoding/citation normalisation.
5. `src/services/rag/nv-rag-cross-verifier.ts` — given a candidate chunk + source, finds ≥ 1 (or ≥ 2 for landmarks) corroborating sources, computes `verified_by_count`.
6. `src/services/rag/nv-rag-quarantine-service.ts` — writes failed candidates to `nv_rag_quarantine` with reason; provides reviewer interface.

**Code reused (no changes needed):**
- `nv-legal-embedding-service.ts` (embeds the canonical text)
- `nv-legal-reranker-service.ts` (consumes new corpus for training data)
- `nv-qdrant-adapter-service.ts` (vector index)
- `audit-chain-lock.ts` (audit write)
- `knowledge-module-service.ts` (existing surface for queries)
- `regulatory-monitor-service.ts` (already polls gazette feeds — extend its source list to feed new statutes into the pipeline)

### 1.5 Database changes (one new migration)

`src/database/migrations/0008_rag_authenticity_v2.sql` (forward-only,
idempotent, follows the existing migration policy in
`Project-Tracker.md` §1):

**New tables:**
- `nv_rag_sources` — source registry (url, jurisdiction, kind ∈ {statute, judgment, constitution}, parser_id, cadence_cron, auth_ref, is_active)
- `nv_rag_raw` — immutable raw fetches (source_id FK, fetched_at, sha256, body bytea, etag, http_headers jsonb)
- `nv_rag_quarantine` — failed validation rows with `reason text` + `quarantined_at` + `reviewer_action` enum
- `nv_rag_review_queue` — HITL queue rows for landmark / disputed (FK to `nv_hitl_queue` for shared infra)
- `nv_rag_provenance` — per-chunk provenance: which sources confirmed it, who reviewed it, when

**Columns added to `nv_rag_chunks`** (all nullable for backward compat in v3.1.x; required for new inserts via service-layer enforcement):
- `source_url text`
- `source_sha256 text`
- `version_date date`
- `verified_by_count int default 0`
- `reviewed_by uuid references nv_users(id)`
- `reviewed_at timestamptz`
- `is_landmark boolean default false`
- `provenance_id uuid references nv_rag_provenance(id)`

### 1.6 Phased volume targets

| Phase | Window | Indian statutes | Foreign statutes | Constitution | Judgments | Total RAG chunks (cumulative) | Lawyer review hours |
|---|---|---|---|---|---|---|---|
| **P1** | 2026-05-02 → 2026-05-08 | 305 → 2,000 sections (BNS, BNSS, BSA, IPC, CPC, CrPC, Evidence Act, Companies Act, IBC, IT Act, DPDPA, GST CGST/IGST/SGST, FEMA, Indian Contract Act, Transfer of Property, NI Act, Limitation Act, Arbitration Act, Consumer Protection — all in full) | +800 (UK 300, US 200, EU 200, GCC 100, SG 100 — top acts in full) | India Constitution full (449 articles + 12 schedules + 105 amendments — currently partial, complete it) | 0 (infra-only this phase) | ~30,000 | 12 (initial review of P1 landmarks) |
| **P2** | 2026-05-09 → 2026-05-22 | +500 (subsidiary acts, recent amendments) | +400 | All 6 jurisdictions' constitutional documents | 1,000 SC India landmarks (top-100 manually reviewed by lawyer panel) + 200 UK/EU/US landmarks | ~80,000 | 40 |
| **P3** | 2026-05-23 → 2026-06-30 | +500 (state acts: RERA state rules, GST state rules, state amendments) | +200 | Full annotation (each article cross-linked to interpreting judgments) | 10,000 HC India tagged by practice area; 2,000 foreign tribunals | ~250,000 | 80 (running) |
| **P4** | Ongoing post-2026-06-30 | Regulatory Monitor auto-ingests new gazette notifications daily | Same | Amendment auto-ingest | Daily judgment ingest from SCI + eCourts | grows ~500 chunks/day | 4–8 hrs/week sustaining |

### 1.7 Lawyer-panel requirement (credibility multiplier)

This is the part the operator owns — code can't substitute:

1. **Recruit minimum 3 panel members** before P2 starts (one each):
   criminal practice, civil-commercial, constitutional. Optional but
   recommended: tax, IP.
2. **Sign off the top-100 landmark SC judgments** (P2 deliverable).
3. **Sign off all 449 Constitutional articles' annotations** (P2).
4. **Recurring 4 hrs/week sustaining review** (P4).

Reviewer UI slots into existing Console (`src/services/console-*`)
and `nv_hitl_queue`. New view: a list of `nv_rag_review_queue` rows
with the canonical text, the source URLs, the cross-verifier diff,
and approve/reject/edit actions. Estimated build: 1 day on top of
existing HITL infra.

### 1.8 Cost + risk

| Item | Cost / risk | Mitigation |
|---|---|---|
| Embedding compute (P1: ~30k chunks) | ~$30–60 with OpenAI `text-embedding-3-large`; ~$0 with local `nv-legal-embedding-service` | Default to local embedder; OpenAI only for landmark re-embed if recall measurably worse |
| eCourts rate limits / ToS | HC judgment ingest throttled | Use bulk export where offered; respect robots.txt; partner with NIC if scaling > 10k/day |
| EUR-Lex / SCI JSON drift | Schema changes break parsers | Per-source parser is isolated; canary 1% of new pulls before full ingest; pinned `parser_version` per source |
| Storage (pgvector at P3) | ~3–5 GB | Already provisioned on RDS; promote to dedicated index tablespace at P3 |
| Hallucinated/wrong text in landmark judgment | **Catastrophic** for credibility | Two-source verify + lawyer signoff for landmarks; quarantine for any failure |
| Source goes offline mid-fetch | Half-ingested batch | Atomic per-source transactions; resume from last good fetch via ETag |

### 1.9 Open decisions for the operator

Before P1 kicks off in code:

1. **Sources allowlist**: confirm §1.3 above OR add licensed feeds (Manupatra, SCC Online).
2. **Lawyer panel**: 3+ identified, OR plan around 1 reviewer for P1?
3. **Embedding choice**: local (free, deployed) OR OpenAI text-embedding-3-large (better recall, ~$60 P1)?
4. **P1 scope confirm**: ~3,000 sections + complete Indian Constitution by 2026-05-08 — green-light?
5. **Daily ingest budget**: target ~500 chunks/day P4 sustaining — OK on RDS storage budget?

### 1.10 Execution checkpoints

When the operator answers §1.9, work proceeds in this order
(everything below feeds back into this same doc — no new files):

1. Migration `0008_rag_authenticity_v2.sql` — lands on dev → tested → deployed via `scripts/deploy-replit-ssm.sh` → `Project-Tracker.md §5` entry
2. New services (1)–(6) from §1.4 — branch + tests + smoke → deploy → §5 entry
3. P1 source registry seeded with the §1.3 allowlist
4. P1 fetcher run (cron-driven), results visible in `nv_rag_quarantine` first, then promoted to `nv_rag_chunks` after cross-verify
5. P1 lawyer review pass on landmarks
6. P2 kickoff once P1 is green

Every checkpoint updates this section §1.10 with an ISO timestamp and
a one-line evidence pointer. No new doc.

---

## 2. Database architecture (TO FOLD IN — next session)

> Source content lives in `docs/v5.0.0/NYV-PRODUCT-NOTE-TECHNICAL-v5.0.0.md` §8 today and will be moved here verbatim in the next session. For now, follow that pointer.

## 3. Seeders (TO FOLD IN — next session)

> 13 seeders, target counts vs live counts, idempotency contract — currently in Technical Product Note §8.6. Will be moved here.

## 4. Memory management (TO FOLD IN — next session)

> 5-tier L1–L5 memory (L1 in-process Map; L2–L5 Postgres + field-encryption), retention, eviction — currently in Technical Product Note §15. Will be moved here.

## 5. MCP tools registry (folded in 2026-05-02)

502 tools in code (`src/data/nv-mcp-tools-registry.ts`); dev-edge
`nv_schema.protocol_registry` shows only 102 rows per the 2026-04-27
live audit. Reseed via `scripts/nv-seed-mcp-tools.ts` before GA, OR
amend the documentation to the smaller live surface. Tracked in
`Project-Tracker.md` §1 row "MCP tools".
