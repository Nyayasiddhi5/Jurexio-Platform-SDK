# Dual-region Ledger stacks (Chairman C-07 — Sprint 1)

**Status:** Skeleton only — **do not apply** until operator GO and AWS credentials on workstation.

## Intent

| Region | Role |
| --- | --- |
| **ap-south-1** | India tenant Ledger PostgreSQL (authoritative chain per IN matter) |
| **us-east-1** | US tenant Ledger PostgreSQL (authoritative chain per US matter) |

Chairman ruling: **no real client data** in either region until **both** physical stacks exist. Dev/test may use gateway **synthetic ingest** (`POST /api/jrx/platform/ledger/ingest` with `synthetic: true` or `tenantId` prefix `syn-`).

## Layout

- `variables.tf` — region pair, instance class, `synthetic_only` guard default `true`
- `main.tf` — commented module stubs pointing at shared `modules/rds`; un-comment after VPC IDs per region

## Next steps (operator)

1. Complete Option B app RDS in `envs/prod` if not already live.
2. Clone RDS module invocation per region with **separate** state backends (`backend.tf` per region workspace).
3. Register connection URLs in SSM `/jurexio/prod/ledger/<region>/` (no secrets in git).
4. Flip gateway ingest guard from synthetic-only after both stacks pass smoke.

See `documents/working/JRX-AWS-INFRA-OPTIONS-AND-RUNBOOK.md` § Dual-region Ledger.
