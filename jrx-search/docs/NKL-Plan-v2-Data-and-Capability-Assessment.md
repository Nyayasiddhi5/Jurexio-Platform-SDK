# NKL Plan v2 — Data & Capability Assessment (this workspace)

**Date:** July 8, 2026
**Basis:** NKL Product Note & Roadmap (attached July 8) + live audit of AWS account `789925699169` using the vault credentials + current state of this project (NYS Agentic AI / Nyayavigya).

---

## 1. What we verified we HAVE (live audit)

### Credentials & access (working)
| Item | Status |
|---|---|
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` (vault) | ✅ Verified — full list/read on all 16 buckets |
| `COURTLISTENER_API` (vault) | ✅ Present — raises US rate limits, unlocks RECAP/judges/oral-args depth |
| Anthropic (Replit AI integration) | ✅ Live — powers agent, judge, RAG synthesis |
| PostgreSQL (Replit) | ✅ Live — currently 25 MB used by caselaw corpus |

### Owned S3 buckets (relevant to NKL)
| Bucket | Region | Contents |
|---|---|---|
| `your-supreme-court-data-bucket` | us-east-1 | SC judgments **tar archives** `data/tar/year=1950..` (full PDFs) |
| `ns-highcourt-data-bucket` | us-east-1 | HC judgment **PDFs** `data/pdf/year=1950..` |
| `ns-indian-highcourt-judgements-2` | ap-south-1 | HC PDFs `data/pdf/year=2007..2026` (recent mirror) |
| `usa-caselaw` | ap-south-1 | Harvard CAP (`harvard/2024,2025`), CourtListener bulk staging (`cl_staging/opinions-2026-03-31.csv.bz2`, **54 GB**), Code of Federal Regulations |
| `usa-legaldataset` | ap-south-1 | empty (staging) |
| `nyv-sdk-distribution`, `nyayavigya-sdk-devapp` | ap-south-1 | NYV SDK artifacts (models/, ai-outputs/, orgs/) |
| `nsp-documents-*`, `nyayamitra-documents-*` | ap-south-1 | Per-org user documents (uploads plane) |

### Public AWS Open Data (no credentials needed)
| Source | Size | Notes |
|---|---|---|
| `indian-supreme-court-judgments` metadata parquet | 46 MB total, 1950–2025 | ✅ **Fully ingested: 43,333 judgments in Postgres with GIN FTS** |
| `indian-high-court-judgments` metadata parquet | ~0.2–0.6 GB **per year** × 75 years (≈15–20 GB), partitioned `year/court/bench`, 25 HCs | ⚠️ Too large to bulk-load entirely into Replit Postgres — needs scoped strategy (below) |

### Already built in THIS workspace (verified working today)
- Full SC India corpus (1950–2025) in Postgres + ranked FTS search
- Live US search via CourtListener v4 (+ token), explicit 502 error contract
- `/caselaw/search`, `/caselaw/documents/{id}`, `/caselaw/verify-citation`, `/caselaw/stats` (OpenAPI contract-first, Zod-validated, codegen'd hooks)
- Agent grounding: real authorities retrieved pre-draft, stored per run, shown in UI
- AI agent + AI judge (rubric evaluation) over 144 benchmark tasks / 24 practice areas
- Typed SDK `@workspace/nyv-sdk` (`caselaw` + `agenticWork` modules, X-API-Key ready)
- UI: Caselaw Search (IN/US), Citation Check, Task Library, Runs, Dashboard

### Gap vs the NKL note's "completed" claims
The NKL note describes a **separate, more advanced project** (HC parquet search, PDF text extraction, RAG answer endpoint, insights, fault injection). **This workspace** has the foundation but not yet: HC data, PDF text extraction, RAG answer endpoint, statutes, templates, embeddings, API keys/metering, streaming.

---

## 2. Recommended architecture (RAG + database, best performance)

### Storage tiers (polyglot-by-tier, single Postgres)
```
TIER 1  Postgres (hot, indexed)     — SC full metadata (done) + HC recent-years metadata
                                       + statutes sections + templates + embeddings (pgvector)
TIER 2  Own S3 (warm)               — full PDFs (SC tar / HC pdf) fetched on-demand,
                                       extracted text cached in Postgres (pdf_text_cache)
TIER 3  Public S3 / live APIs (cold)— older HC years parquet on-demand; CourtListener live;
                                       Harvard CAP / 54GB CL bulk = batch enrichment source
```

### Retrieval pipeline (hybrid RAG)
1. **Query understanding** (Claude): expand query, detect jurisdiction/court/case-type/sections.
2. **Hybrid retrieval**: Postgres FTS (`websearch_to_tsquery` + `ts_rank`) ∪ pgvector cosine (embeddings) → Reciprocal Rank Fusion.
3. **On-demand deepening**: for top hits, fetch PDF from owned S3 → extract text → cache → re-rank passages.
4. **Synthesis** (Claude): cited answer; every assertion carries a verifiable citation ID; citations run through `/caselaw/verify-citation` before display (BigLaw-Bench source-reliability principle).

**Embeddings note:** the Anthropic proxy has **no embeddings endpoint**. pgvector needs an embedding provider (OpenAI via Replit AI integration is the natural choice). Until then, FTS-only hybrid (still strong for legal text).

### HC data strategy (decision needed)
| Option | Cost | Latency | Coverage |
|---|---|---|---|
| A. Ingest recent 10 years (2016–2025) metadata into Postgres | ~4–6 GB DB | fast (indexed) | covers ~most active litigation research |
| B. Ingest ALL 75 years | ~15–20+ GB DB | fast but DB-heavy | complete, higher Replit DB cost |
| C. Recent years in Postgres + older years parquet-scan on demand (cached) | ~4–6 GB + cache | fast recent / 5–20 s cold old years | complete, best cost/perf balance ✅ recommended |

---

## 3. Feature roadmap mapped to data we ALREADY own

| Feature (user-requested) | Data source | Build effort |
|---|---|---|
| HC + SC full-corpus search | public parquet + own PDF buckets | ingest + existing FTS pattern |
| Judgment full-text + PDF download | own S3 buckets | S3 presigned URLs + pdf text extraction |
| Citation extraction & verification (IN SCC/AIR/neutral + US Bluebook) | corpus + CourtListener | parser + existing verify endpoint |
| Precedent similarity ("paste facts → similar cases") | pgvector embeddings | needs embedding provider |
| Statutes corpus (BNS/BNSS/BSA, India Code, US Code) + section suggestion | India Code / US Code (public) | new ingest plane |
| IPC→BNS / CrPC→BNSS / Evidence→BSA diff comparator | statutes corpus | high-value, moderate |
| Practice-area taxonomy (all types/subtypes) mapped to real cases | derived from corpus `disposal_nature`, subject tags + Claude classification | classification pipeline |
| Templates library per case type + guided fill | own formats + corpus-derived | new plane (DB + endpoints + UI) |
| Upload-a-document → match & research (summary, statutes, citations, similar cases, drafting suggestions) | user doc + hybrid retrieval | composite `advise` endpoint |
| Filing checklists + missing-document analysis | templates + case-type rules | after templates |
| Judge/court/bench analytics & outcome patterns (descriptive, not verdict prediction) | corpus metadata + CourtListener judges API | analytics queries |
| Live web research + correlate/compare | web search integration | needs web-search provider decision |
| SDK: all of the above as typed `NyayavigyaClient` modules + API keys/metering | existing SDK base | incremental |

## 4. Sequenced delivery (updated Phases)

1. **P1 (now):** HC metadata ingest (Option C default) → HC search API/UI; SC/HC PDF text extraction from owned buckets + presigned download; wire full text into search detail.
2. **P2:** Citation extraction+verification hardening; upload-document → research composite endpoint (`advise`).
3. **P3:** Embeddings (needs OpenAI integration) → pgvector hybrid retrieval + similarity search.
4. **P4:** Statutes corpus (BNS/BNSS/BSA + India Code + US Code) + section suggestion + statute-diff.
5. **P5:** Templates library + guided fill + filing checklists; practice-area taxonomy mapping.
6. **P6:** Analytics (judge/court trends); live web research integration; streaming; API keys + metering for external SDK consumption.
7. **P7:** Eval harness (Harvey-LAB style) in CI; benchmark scorecard.

Known constraints (honest): Replit DB size drives HC scope choice; embeddings blocked until an embedding provider is added; 54 GB CL bulk file is an offline enrichment source, not something to load here.
