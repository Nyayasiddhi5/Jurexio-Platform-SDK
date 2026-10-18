# Jurexio Platform SDK — Changelog

## [1.0.0] — Unreleased

### Fixed — JRX-BOOTSTRAP-DEPLOY-PR6-001 (2026-10-18)

- Governance Postgres namespace defaults to `jrx_schema` (`JRX_PG_SCHEMA` override; legacy `nv_schema` dual-read on protocol registry).
- Boot-time `ensureGovernanceBootstrap()` creates `protocol_registry` on empty RDS before manifest init; `scripts/jrx-seed-protocol-registry-bootstrap.ts` + migrate DDL parity.
- `scripts/jrx-deploy-aws-ssm.sh`: export `DEPLOY_ID`/`SHA` into remote script (`set -u` fix).
- Ship `certs/rds-global-bundle.pem` and `scripts/jrx-download-rds-ca-bundle.sh`; runbook RDS TLS note.
- Rename agent registries to canonical `config/agent-registries/Jurexio-Legal-registry-*.json` (Linux case).

### Fixed — JRX-GATEWAY-TSC-ROUND2-001 (2026-10-18)

- Gateway Docker build: `tsconfig.server.json` `noEmitOnError: true`; `scripts/jrx-build-production.sh` uses authoritative `build:server` (removed fallback root `tsc`).
- Export `PartialFieldRecoveryInput` from `@jurexio/docparse-sdk`; fix partial-LLM provider typing.
- `jrx-memory-injection-budget`: correct `reduce` accumulator typing; `legal-doc-analyze-service` `taskType` on fast-path opts.
- Broad TS compile fixes (union narrowing, removed stale `@ts-expect-error`, shared `sql-result-rows` helper).
- Restored `scripts/jrx-server-type-check.sh` / `jrx-client-type-check.sh`; refreshed `.tsc-server-baseline.txt` (0 signatures).

### Fixed — JRX-PROD-BUILD-FIX-001 (2026-10-17)

- Gateway production build: `shared/jrx-*-schema` imports, `src/services/jrx-legal-tools/`, `src/services/jrx-sme/`, `jrx-legal-tools-routes.ts` (removed double `jrx` prefix).
- Root `package.json`: `@jurexio/docparse-sdk` workspace alias for post-rebrand imports.
- Quoted `'jurexio-citizen'` object keys and valid identifiers in `sdk-seed.ts` after zero-NYV rebrand.
- Restored `scripts/jrx-build-production.sh`; SSM smoke uses `jq` for parameters (Mac AWS CLI).
- Docparse-sdk onboarding mapper uses classification `conf` field.

### Removed — JRX-ZERO-NYV-REF-001 (2026-10-17)

- Deleted `archive/upstream-nyv/`, `scripts/legacy-nyv/`, and bulk `docs/audit/eval/*.json` (history remains in Git).
- Moved legacy compose files to `archive/deprecated-nyv-compose/`.

### Added — JRX-ZERO-NYV-REF-001 (2026-10-17)

- `documents/working/JRX-UPSTREAM-LINEAGE.md`; `scripts/jrx-db-rename-legacy-tables.sql`; `scripts/jrx-guardrail-nyv-allowlist.txt`.
- `src/config/jrx-read-master-config-json.ts` (legacy JSON filename fallback once).
- `packages/jurexio-citizen-sdk` (renamed from nyayamitra-sdk).

### Changed — JRX-ZERO-NYV-REF-001 (2026-10-17)

- Forbidden-brand guardrail: `\bNYV\b|Nyayavigya|nyayavigya|nysdev|\bWAI\b` on `src/`, `client/src`, `packages/`, `shared/`, `documents/working/`, `scripts/jrx-*`.
- SSM Bedrock bootstrap: Jurexio-only (no legacy prefix copy).
- Mechanical rename/scrub across active product paths (`jrx-master-config`, `jrx-*` services).

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
