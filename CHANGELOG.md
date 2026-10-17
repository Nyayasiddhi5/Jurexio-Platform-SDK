# Jurexio Platform SDK — Changelog

## [1.0.0] — Unreleased

### Added — JRX-PRE-DEPLOY-CLOSEOUT-001 (2026-10-17)

- `JrxConsoleSidebar` / `JrxPageShell` with deprecated `Nyv*` shims; `JRX_CONSOLE_*` route constants with `NV_CONSOLE_*` re-exports.
- JRX-native SSM Bedrock bootstrap (`JRX_SSM_COPY_FROM_NYV` default off); `env.production.jurexio.example` US defaults.
- `documents/working/JRX-LEGACY-NYV-COMPOSE.md`; NYV probe scripts under `scripts/legacy-nyv/`.
- Analytics dashboard components renamed (`JrxAnalyticsOverview`, `JrxAnalyticsProjectPanel`, `JrxAnalyticsMetricsPanel`).

### Changed — JRX-PRE-DEPLOY-CLOSEOUT-001 (2026-10-17)

- Console sidebar IA: single Chat entry, org vs platform compliance labels, Document AI hub-first.
- Runbook pre-deploy closeout gate before live AWS apply/deploy.

### Added — JRX-INFRA-OPTION-B-001 (2026-10-17)

- `scripts/jrx-infra-apply-option-b.sh` — dry-run (default) / `--apply` provision for Option B (S3, VPC/SG, RDS Postgres 15, ElastiCache Redis, EC2 AL2023); outputs `env.production.jurexio.generated`; optional `JRX_BOOTSTRAP_SSM=1` → `jrx-ssm-bootstrap-bedrock-smoke.sh`.
- Runbook section in `documents/working/JRX-AWS-INFRA-OPTIONS-AND-RUNBOOK.md`; gitignore for generated Jurexio env files.

### Added — JRX-PROGRAM-001 (2026-10-17)

- Re-export from Nyayavigya `aeab32ff` (5837 files); `UPSTREAM-NYV-SHA.txt`.
- Mechanical rename: `nv-*` → `jrx-*` (879 files), `/api/nv/` → `/api/jrx/` in product paths.
- `NYS-Agentic-AI/` → `jrx-search/` (JRX Search API).
- `@jurexio/client-sdk@1.0.0` with `JrxClient` export alias.
- `jrx-env-bootstrap.ts`, `guardrail:jrx-brands`, GitHub Actions `jrx-ci.yml`.
- Docs: `JRX-NAMING-AND-BOUNDARY-RFC.md`, `JRX-OPERATING-MODEL.md`, `JUREXIO-ENTERPRISE-SDK.md`, `JRX-SEARCH-US-CORPUS-PLAN.md`, residency/SOC2 boundary.
- NYV/NSP handoffs moved to `documents/working/archive/upstream-nyv/`.

### Tooling

- `scripts/jurexio-reapply-patches.sh`, `jrx-phase2-rename.py`, `jrx-phase2-brand-scrub.py`.

### Earlier scaffold

- JRX-ENV-LOCAL-001, JRX-PHASE2-001 alias patches (`patches/jurexio/`).
