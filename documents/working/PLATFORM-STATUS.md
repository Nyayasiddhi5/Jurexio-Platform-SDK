# Jurexio Enterprise Platform — status

> **Product:** Global legal AI platform (JRX). Separate audit boundary from the India consumer stack (upstream lineage in `UPSTREAM-JRX-SHA.txt` only).  
> **API:** `/api/jrx/` · **Local gateway:** `http://127.0.0.1:5010`  
> **Search:** JRX Search API (`jrx-search/`) — US/global corpus (separate from JRX India caselaw).

| Area | Status |
|------|--------|
| Gateway + SDK | Phase 2 rename applied; `@jurexio/client-sdk@1.0.0` |
| DB | Local `jurexio` @5433; production RDS via `jrx-provision-rds-database.sh` |
| Console | Rebrand in progress — Jurexio Enterprise Console |
| CI | `jrx-guardrail-forbidden-brands.sh` |
| Upstream | `UPSTREAM-JRX-SHA.txt` |

See `JRX-NAMING-AND-BOUNDARY-RFC.md`, `JUREXIO-ENTERPRISE-SDK.md`.
