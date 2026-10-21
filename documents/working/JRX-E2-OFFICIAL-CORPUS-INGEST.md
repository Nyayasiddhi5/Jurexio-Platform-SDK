# JRX E2 — Singapore (SOLID) + GC (Saudi BOE)

**Phase:** E2 of `JRX-GLOBAL-LEGAL-INTELLIGENCE-ROADMAP.md`  
**Scripts:** `scripts/jrx-e2-official-corpus-ingest.ts` · **Service:** `src/services/jrx-official-corpus-e2-service.ts`

## Sources

| JX | Source | Scaffold |
|----|--------|----------|
| **SG** | [SOLID](https://cdl.smu.edu.sg/projects/singapore-open-legal-informatics-database-solid) | `SG_SOLID_EXPORT` JSONL **or** `SOLID_API_BASE` + `SOLID_API_KEY` |
| **GC** | [Saudi BOE HF corpus](https://huggingface.co/datasets/SaudiArabicLaws/saudi-arabic-laws-and-regulations-corpus) | Live sample via HF datasets server (**CC BY-NC-ND 4.0** — commercial review required) |

Pair Search / SSO bulk ingest remains a follow-on job once export paths are approved.

## Commands

```bash
# Dry-run (GC fetches from HF without DATABASE_URL)
DRY_RUN=1 JURISDICTION=GC LIMIT=5 npx tsx scripts/jrx-e2-official-corpus-ingest.ts

# Local RDS
DATABASE_URL=... JURISDICTION=GC,SG RAG_BACKFILL=1 npm run e2:corpus:ingest

# EC2 (after deploy includes these scripts)
JRX_EC2_INSTANCE_ID=i-0fb470b236c14405b npm run e2:corpus:ingest:ec2
```

## JSONL export shape (SG)

One JSON object per line:

```json
{"act_title":"Personal Data Protection Act 2012","act_short":"SG-PDPA","section_number":"4","section_title":"…","section_text":"…"}
```

## Deploy order

1. `git push origin main`
2. `bash scripts/jrx-deploy-aws-ssm.sh` (operator creds)
3. `npm run global:corpus:ingest:ec2` then optional `e1` / `e2` / `us` ingests
