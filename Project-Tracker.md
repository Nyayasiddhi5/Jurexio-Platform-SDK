# Jurexio Platform SDK — Project Tracker

> Jurexio Enterprise Platform — separate from Nyayavigya (upstream lineage: `UPSTREAM-NYV-SHA.txt`).

## Change log (newest first)

| Timestamp | Status | Owner | Area | Summary | Evidence |
|-----------|--------|-------|------|---------|----------|
| 2026-10-22T14:30:00Z | DONE | Cursor Agent | JRX-REGISTRY-V1-ADOPTION-001 | Chairman 25 Oct: adopt events/permissions/gates v1 (758 critical flags, 144 permission renames), role templates + SoD + L1–L9 map, CTO gate memo, working RFCs, access evaluate stub; `registry:validate` OK. | `jurexio-specs/registry/`; `JRX-REGISTRY-V1-ADOPTION-2026-10-25.md`; `npm run registry:validate` |
| 2026-10-22T08:15:00Z | DONE | Cursor Agent | JRX-SPEC-PACK-IMPORT-001 | Chairman GO: import `jurexio-specs/` (14 specs + registries); CI `validate.py`; `npm run registry:validate`. | `jurexio-specs/`; `.github/workflows/jrx-ci.yml`; `JRX-SPEC-PACK-REPO-IMPORT.md` |
| 2026-10-22T11:45:00Z | DONE | Cursor Agent | JRX-P1-GLOBAL-STANDARDS-001 | P1 closeout: CI guardrail+build+focused tests+audit; Dependabot; restored guardrail scripts; MCP stub honesty; A2A HMAC boot gate; OpenAPI baseline regen. | `.github/workflows/jrx-ci.yml`; local guardrail PASS; `/cursor/stores/self/internal/jrx-p1-ci-proof-2026-10-22.txt` |
| 2026-10-22T06:00:00Z | DONE | Cursor Agent | JRX-QUALITY-SECURITY-AUDIT-001 | Platform quality/security audit docs; safe calculator (no Function); microservices standard. | `JRX-PLATFORM-QUALITY-SECURITY-AUDIT-2026-10-22.md`; `jrx-safe-calculator.ts` |
| 2026-10-21T12:05:00Z | DONE | Cursor Agent | JRX-DASHBOARD-JX-PRIORITY-001 | Six-jx catalog (US/IN first); console, legal chat, doc hub, jurisdiction API sort; dashboard doc. Push/redeploy blocked on agent creds. | `shared/jrx-jurisdiction-catalog.ts`; `JRX-DASHBOARD-JURISDICTION-PRIORITY.md` |
| 2026-10-21T11:15:00Z | DONE | Cursor Agent | JRX-E2-OFFICIAL-CORPUS-001 | E2 scaffold: SG (SOLID export/API env) + GC Saudi BOE via HF rows; `e2:corpus:ingest` / `:ec2`. | `jrx-official-corpus-e2-service.ts`; `JRX-E2-OFFICIAL-CORPUS-INGEST.md` |
| 2026-10-21T10:35:00Z | DONE | Cursor Agent | JRX-E1-COVER-LETTER-001 | SOC2 auditor cover letter; E1 official corpus ingest scaffold (UK/US live fetch, IN/EU paths); `e1:corpus:ingest` npm scripts. | `JRX-SOC2-AUDITOR-COVER-LETTER.md`; `jrx-official-corpus-e1-service.ts` |
| 2026-10-21T10:15:00Z | DONE | Cursor Agent | JRX-GLOBAL-LEGAL-INTELLIGENCE-001 | Global legal roadmap docs; `global:corpus:ingest` (6 jx); Auto-RAG `crossJurisdiction` + Queen/orchestrate/legal-chat wiring; LLM routing doc. | `JRX-GLOBAL-LEGAL-INTELLIGENCE-ROADMAP.md`; `jrx-global-corpus-ingest.ts`; `jrx-auto-rag-router.ts` |
| 2026-10-21T05:05:00Z | DONE | Cursor Agent | JRX-US-CORPUS-COMPLIANCE-GO-001 | US GO: real `jrx-us-corpus-ingest` (RDS statutes/courts/RAG); Compliance GO auditor pack; existing SSM/infra only. | `scripts/jrx-us-corpus-ingest.ts`; `JRX-SOC2-ISO42001-AUDITOR-PACK.md` |
| 2026-10-21T04:55:00Z | DONE | Cursor Agent | JRX-ROADMAP-A-E-001 | Roadmap A–E code/docs: GC/GCC harmonize, remove duplicate nv-agents-registry, jurisdiction template packs (6), US docparse domain stubs, IN/US e-filing adapters, SOC2/ISO evidence program, GRPO/A2A integration docs. | branch `cursor/jrx-roadmap-a-e-closeout`; `guardrail:jrx-brands` PASS |
| 2026-10-20T17:05:00Z | DONE | Cursor Agent | JRX-PARTNER-SMOKE-SCRIPTS-001 | Restore partner smoke shell scripts referenced by `package.json` (SSM EC2 + local HTTPS); ops doc in `JRX-FRONTEND-INTEGRATION.md`. | `scripts/jrx-partner-smoke.sh`; public health probe 200 |
| 2026-10-20T16:35:00Z | DONE | Cursor Agent | JRX-P0-SDK-READY-001 | P0 audit closeout: `@jurexio/client-sdk@5.0.0`, universal/legal chat SDK APIs, CORS+auth docs, JRX web quickstart proxy paths; guardrail + client-sdk build. | PR `feat/jrx-p0-sdk-ready`; `npm run guardrail:jrx-brands`; `packages/client-sdk` tsc |
| 2026-10-18T17:50:00Z | DONE | Cursor Agent | JRX-RDS-SEQUENCE-GRANTS-001 | Runbook + provision script echo: post–greenfield `db:push` `GRANT USAGE, SELECT ON ALL SEQUENCES` for `jurexio_app` on `public`, `jrx_schema`, `nv_schema`; default-privileges note for future sequences. | PR #9 `docs/jrx-rds-sequence-grants`; `npm run guardrail:jrx-brands` PASS |
| 2026-10-18T08:45:00Z | DONE | Cursor Agent | JRX-DEPLOY-FOLLOWUPS-001 | SSM deploy two-phase (build / compose+health) + `JRX_SSM_TIMEOUT_SECONDS=7200`; db:push SSM docker fallback when npm absent; `jrx-seed-audit-greenfield.sh` + npm `seed:audit-greenfield` / `seed:rag-and-audit`; runbook tolerate removal note. | PR #8 `fix/jrx-deploy-followups`; `npm run build` exit 0; `guardrail:jrx-brands` PASS |
| 2026-10-18T06:40:00Z | DONE | Cursor Agent | JRX-DEPLOY-COMPOSE-RECREATE-001 | SSM deploy: drop stale `jrx-gateway`, `compose up --force-recreate --remove-orphans`, fail remote on health timeout; local waiter exits non-zero unless SSM Success; add `jrx-ssm-run-db-push-admin.sh` (master URL via env, no secrets in repo). | PR #7 `fix/jrx-deploy-compose-recreate`; `npm run guardrail:jrx-brands` |
| 2026-10-18T05:45:00Z | DONE | Cursor Agent | JRX-BOOTSTRAP-DEPLOY-PR6-001 | Greenfield RDS: `jrx_schema` Drizzle namespace + boot DDL for `protocol_registry`, manifest dual-read shim, `jrx-seed-protocol-registry-bootstrap.ts`, deploy SSM `DEPLOY_ID` fix, ship `certs/rds-global-bundle.pem`, canonical `Jurexio-Legal-registry-*.json` paths. | PR #6 `fix/jrx-bootstrap-deploy-pr6`; `npm run build`; `guardrail:jrx-brands` |
| 2026-10-18T04:30:00Z | DONE | Cursor Agent | JRX-GATEWAY-TSC-ROUND2-001 | Post–PR #4 Docker gateway `tsc`: zero-error `tsconfig.server.json` (`noEmitOnError`), docparse `PartialFieldRecoveryInput` export, memory/legal-doc-analyze fixes, union narrowing + type-check guard scripts; `npm run build` exit 0. | PR #5 branch `fix/jrx-gateway-tsc-round2`; `npm run build`; guardrail brands/server/client/message-catalog PASS |
| 2026-10-17T18:35:00Z | DONE | Cursor Agent | JRX-PROD-BUILD-FIX-001 | Fix post-rebrand gateway `tsc` (jrx shared schemas, legal-tools paths, quoted platform keys), restore `jrx-build-production.sh`, Mac-safe `jrx-smoke-ec2.sh`, docparse-sdk `conf` field. | commit 5cdbbc9; `npm run build` exit 0 |
| 2026-10-17T16:45:00Z | DONE | Cursor Agent | JRX-ZERO-NYV-REF-001 | Pre-US deploy: removed `archive/upstream-nyv/`, eval JSON bulk, `scripts/legacy-nyv/`; deprecated compose → `archive/deprecated-nyv-compose/`; mechanical JRX renames; `packages/jurexio-citizen-sdk`; guardrail NYV/WAI pattern + allowlist; SSM bootstrap Jurexio-only; `JRX-UPSTREAM-LINEAGE.md`. | `feat/jrx-zero-nyv-references`; `guardrail:jrx-brands` PASS; grep src+client+docs/working 0 |
| 2026-10-17T16:30:00Z | DONE | Cursor Agent | JRX-PRE-DEPLOY-CLOSEOUT-001 | Platform closeout before AWS: console IA (sidebar dedupe, compliance labels), `JrxConsoleSidebar`/`JrxPageShell`, `JRX_CONSOLE_*` routes, JRX-native SSM bootstrap docs, NYV probes → `scripts/legacy-nyv/`, analytics export rename, Option B script cherry-pick, legacy compose doc. | `feat/jrx-pre-deploy-platform-closeout`; `npm run guardrail:jrx-brands` |
| 2026-10-17T07:58:00Z | DONE | Cursor Agent | JRX-INFRA-OPTION-B-001 | Option B idempotent AWS provisioner (`jrx-infra-apply-option-b.sh` dry-run/apply, generated env file, runbook §3). | `scripts/jrx-infra-apply-option-b.sh`; dry-run log (no AWS creds) |
| 2026-10-17T12:55:00Z | DONE | Cursor Agent | JRX-PROGRAM-001 | Phases 0–2 core: re-export NYV aeab32ff, mechanical rename (879 files), brand scrub, `jrx-search/`, `@jurexio/client-sdk`, forbidden-brand CI, docs RFC/ops/SDK/search corpus. | `scripts/jrx-phase2-rename.py`; `guardrail:jrx-brands` PASS |
| 2026-10-17T07:30:00Z | DONE | Cursor Agent | JRX-EXPORT-002 | Fresh export 5837 files from NYV aeab32ff + patch reapply. | `UPSTREAM-NYV-SHA.txt` |
| 2026-10-06T05:20:00Z | DONE | Cursor Agent | JRX-ENV-LOCAL-001 | Jurexio-local env + RDS script. | `JUREXIO-ENV-AND-DATABASE-2026-10.md` |
| 2026-10-05T09:15:00Z | DONE | Cursor Agent | JRX-PHASE2-001 | Initial `/api/jrx/` alias + client-sdk npm scope. | patches/jurexio/ |
| 2026-10-05T08:49:30Z | DONE | Cursor Agent | JRX-EXPORT-001 | Initial curated export. | bootstrap script |

## Pending (ops)

| Phase | Item |
|-------|------|
| 3 | Production RDS `jurexio` + SSM `/jurexio/prod/*` |
| 5 | Console staging on Jurexio domain |
| 6 | US corpus ingest (legal GO) |
| 8 | EC2/ECS deploy + smoke |
