# JRX Search API — US / global corpus plan

**Scope:** `jrx-search/` worker (fork of NYS ingest/search logic). **No** shared S3/RDS/Athena with Nyayavigya India caselaw.

## Infrastructure

| Asset | Jurexio name | Notes |
|-------|--------------|--------|
| S3 raw | `s3://jurexio-caselaw-us-raw/` | Separate account/bucket prefix |
| Glue/Athena | `jrx_caselaw_us` | US docket + opinion text |
| RDS (optional) | `jurexio_search` logical DB | Metadata + citations |
| Gateway federation | `JRX_SEARCH_BASE_URL`, `JRX_SEARCH_API_KEY` | `/api/jrx/v1/search/*` |

## Sources (legal GO required)

- Federal: PACER / CourtListener-style feeds (licensed).
- State: selected pilot states (CA, NY, TX) — phased ingest.
- **Excluded v1:** Indian CNR, eCourts, NyayaSearch India RDS mirrors.

## MVP

1. Seed **US fixture corpus** (non-PII) for staging smoke.
2. Port NYS search handlers → `jrx-search/artifacts/api-server` with `JRX_*` env.
3. Gateway proxy health + search smoke in CI.

## Refresh & compliance

- Retention: per customer DPA (document in `JRX-DATA-RESIDENCY.md`).
- PII: redact party names in public index where required.
