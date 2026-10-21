# JRX global legal intelligence roadmap

**Status:** Active — code + ops plan (not a certification or “100% global filing” claim).  
**Jurisdictions:** `IN`, `UK`, `US`, `EU`, `SG`, `GC` (alias `GCC` → `GC`).  
**SDK:** `@jurexio/client-sdk@5.0.0` · Gateway prefix `/api/jrx`.

---

## 1. Target stack (recommended)

| Layer | Responsibility | JRX implementation |
|-------|----------------|----------------------|
| **Canonical RDS** | Acts, sections, courts, citations | `nv_statutes`, `nv_courts`; `seedStatutesForJurisdictions`, `npm run global:corpus:ingest` |
| **Vector RAG** | Grounded retrieval with jurisdiction tags | `jrx-statute-rag-backfill-service.ts`, `jrx-auto-rag-router.ts`, `RAG_BACKFILL=1` |
| **Request binding** | Currency, courts, prohibited terms | `jrx-jurisdiction-binding-service.ts`, middleware |
| **Auto-RAG** | Tier-aware multi-store fusion | `autoRagRetrieve`; **`crossJurisdiction`** + comparative intent → per-jx top-k merge |
| **LLM routing** | Grounded Q&A, extract, draft | Bedrock primary; Gemini/multilingual for IN/GC — see `JRX-LLM-ROUTING-GLOBAL.md` |
| **Docparse → autofill → template → stream** | Structured legal workflows | `packages/docparse*`, `shared/jurisdiction-templates/` |
| **PII & governance** | Redaction, audit, HITL | Outcome sanitize, audit chain, e-filing review gate |
| **Compliance evidence** | SOC 2 / ISO 42001 readiness | `JRX-SOC2-ISO42001-EVIDENCE-PROGRAM.md`, `JRX-SOC2-ISO42001-AUDITOR-PACK.md` |

**Rules**

- Never mix jurisdictions in retrieval without **explicit tags** on every chunk.
- Answers must **cite retrieved sections**; model memory is not authority.
- Cross-jurisdiction queries require **`crossJurisdiction: true`** on `/orchestrate` or multi-jx legal chat sessions.

---

## 2. Acceptance criteria (per jurisdiction)

| JX | “Ready” means | Still open for “global best” |
|----|---------------|------------------------------|
| **IN** | CNR patterns, binding, templates, strongest RAG bias | Bulk **Open India Law** / IndiaCode ingest |
| **US** | Seeder + ingest script + PACER adapter stub | **Run** `us:corpus:ingest:ec2`; licensed caselaw (`JRX-SEARCH-US-CORPUS-PLAN.md`) |
| **UK** | Binding + template | legislation.gov.uk + Find Case Law bulk |
| **EU** | Binding + GDPR/EU AI Act seeds | EUR-Lex + CURIA pipeline |
| **SG** | Binding + template | SOLID / Pair Search ingest |
| **GC** | Binding + GCC statute seeds | Per-country OSS (Saudi BOE, UAE APIs) + license review |

---

## 3. Open-source / free corpus (ingest priority)

| Region | Sources | License / notes |
|--------|---------|-----------------|
| **Multi** | [LeXFiles](https://huggingface.co/datasets/lexlms/lex_files), [awesome-legal-data](https://github.com/openlegaldata/awesome-legal-data) | HF card; eval + selective RAG |
| **US** | GovInfo, CourtListener, Caselaw Access Project | Open/API |
| **IN** | [Open India Law](https://huggingface.co/datasets/vaquill/open-india-law) | CC BY 4.0 |
| **UK** | legislation.gov.uk, Find Case Law, BAILII | Open (check terms) |
| **EU** | EUR-Lex, CURIA, JRC-Acquis, MultiEURLEX | Open |
| **SG** | SOLID, Pair Search | Research / official |
| **GC** | Saudi BOE HF corpus | **CC BY-NC-ND** — commercial review required; Dubai Pulse API needs approval |

Finetune only where license permits; prefer **RAG ingest** for production grounding.

---

## 4. Phasing

| Phase | Scope |
|-------|--------|
| **E0** | Push `main`, `global:corpus:ingest:ec2`, smoke, auditor pack |
| **E1** | Official API ingest IN/US/UK/EU (section-level RDS + RAG backfill) |
| **E2** | SG + GC country corpora |
| **E3** | Docparse domain packs + template library expansion |
| **E4** | `jrx-search` US licensed bucket; PACER/eCourts credentials + adapters |
| **E5** | GRPO rubrics per jx; MCP OAuth production connectors |

---

## 5. Operator commands

```bash
# All six jurisdictions — local RDS
npm run global:corpus:ingest

# Production EC2 (SSM)
JRX_EC2_INSTANCE_ID=i-0fb470b236c14405b JRX_AWS_REGION=ap-south-1 npm run global:corpus:ingest:ec2

# US-only (courts + statutes)
npm run us:corpus:ingest:ec2

# Orchestration — cross-jurisdiction RAG
# POST /api/jrx/orchestrate  { "prompt": "...", "jurisdiction": "IN", "crossJurisdiction": true }
```

---

## 6. Governance & compliance (legal domain)

- **GDPR / UK GDPR / DPDPA / PDPA:** jurisdiction flags in binding service; residency in `JRX-DATA-RESIDENCY.md`.
- **SOC 2 / ISO 42001:** evidence program + auditor pack (readiness, not cert).
- **PII:** redact on upload and on public index fields; log counts only.
- **Disclaimer:** all AI outputs are assistive — not a substitute for qualified counsel.

**Related:** `JRX-JURISDICTION-TEMPLATE-PACKS.md`, `JRX-FRONTEND-INTEGRATION.md`, `JRX-SEARCH-US-CORPUS-PLAN.md`.
