# JRX E1 — official corpus ingest (IN, US, UK, EU)

**Phase:** E1 of `JRX-GLOBAL-LEGAL-INTELLIGENCE-ROADMAP.md`  
**Script:** `scripts/jrx-e1-official-corpus-ingest.ts`  
**Service:** `src/services/jrx-official-corpus-e1-service.ts`

## Sources (scaffold → bulk)

| JX | Source | Scaffold behaviour | Bulk next step |
|----|--------|------------------|----------------|
| **UK** | [legislation.gov.uk](https://www.legislation.gov.uk/) XML | Equality Act 2010 sample sections | Bulk XML/API per act |
| **US** | [eCFR](https://www.ecfr.gov/) API | Title 1 structure nodes | GovInfo USC + eCFR full title jobs |
| **EU** | [EUR-Lex](https://eur-lex.europa.eu/) | Log + skip (operator job) | CELLAR bulk / SPARQL |
| **IN** | [Open India Law](https://huggingface.co/datasets/vaquill/open-india-law) | JSONL via `OPEN_INDIA_LAW_EXPORT` | HF export → S3 → batch upsert |

## Commands

```bash
# Dry-run fetch counts (no DB writes)
DRY_RUN=1 JURISDICTION=UK,US npx tsx scripts/jrx-e1-official-corpus-ingest.ts

# Local RDS upsert + optional RAG
DATABASE_URL=... JURISDICTION=UK LIMIT=10 RAG_BACKFILL=1 npm run e1:corpus:ingest

# EC2
JRX_EC2_INSTANCE_ID=i-0fb470b236c14405b npm run e1:corpus:ingest:ec2
```

## Environment

| Variable | Purpose |
|----------|---------|
| `JURISDICTION` / `JURISDICTIONS` | `IN`, `US`, `UK`, `EU` (comma-separated) |
| `LIMIT` | Max sections per jurisdiction (default 20) |
| `DRY_RUN=1` | Fetch only, no upsert |
| `RAG_BACKFILL=1` | Backfill new rows to RAG |
| `OPEN_INDIA_LAW_EXPORT` | Path to JSONL export for IN rows |

## Licensing

Respect each source’s terms. Open India Law is **CC BY 4.0**. UK/US open government data — attribute in `source_uri` metadata when extended.
