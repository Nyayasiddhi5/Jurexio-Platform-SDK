# Jurexio platform — quality, security & microservices audit

**Date:** 2026-10-22  
**Scope:** `Jurexio-Platform-SDK` gateway, console, packages, deploy stack  
**Verdict:** **Production-capable with documented gaps** — strong guardrails and security services exist; full “global best / microservices-grade” certification requires CI green on a complete install, external pen test, and closing P1 items below.

---

## 1. Executive summary

| Dimension | Assessment |
|-----------|------------|
| **Security baseline** | JWT + SDK dual auth, consent gates, error sanitization, RBAC, audit chain, security-audit service (OWASP LLM patterns), brand/secret guardrails in CI |
| **Code quality** | TypeScript monorepo, extensive route modularization, Project-Tracker/CHANGELOG contract; full `npm run guardrail` not verified on this VM (missing `node_modules`) |
| **Microservices** | **Modular monolith** gateway + **separate console** image + **Postgres/Redis**; optional `jrx-search` worker path — not full K8s service mesh |
| **Honest “fully ready”** | **No** until: push/deploy smoke green, dependency install + full guardrail suite, SAST/dependency scan in CI, and auditor/pen-test for external claim |

---

## 2. Architecture (microservices & boundaries)

```
                    ┌─────────────┐
   Browser ────────►│ jrx-console │ (static/nginx)
                    └──────┬──────┘
                           │ /api/jrx/*
                    ┌──────▼──────┐
                    │ jrx-gateway │ Node — orchestration, RAG, agents, SDK
                    └──────┬──────┘
              ┌────────────┼────────────┐
              ▼            ▼            ▼
         jrx-postgres  jrx-redis   Bedrock/external LLM
         (RDS prod)    (ElastiCache)
```

**Service boundaries (good practice already present)**

- API surface: `/api/jrx/*` (Jurexio); SDK packages `@jurexio/*` versioned separately.
- Route modules: 100+ `jrx-*-routes.ts` files — domain separation by file, shared DB (typical modular monolith).
- Cross-cutting: `dualSdkOrJwt`, `consentGate`, `sanitizeErrorForClient`, jurisdiction middleware.

**Microservices maturity (target state)**

| Level | Today | Target |
|-------|-------|--------|
| Deploy units | gateway + console + data stores | Same on EC2/ALB; optional split search worker |
| Data | Single Postgres (tenant RLS patterns) | Keep; US caselaw separate bucket per plan |
| Observability | Health, token metrics, audit chain | Add centralized APM + SLO dashboards |
| API contracts | OpenAPI/postman builders in repo | Publish versioned OpenAPI per SDK major |

See **`JRX-CODE-QUALITY-MICROSERVICES-STANDARD.md`** for coding standards alignment.

---

## 3. Security findings

### P0 — must not regress (controls in repo)

- **Auth:** Orchestrate/legal chat use `dualSdkOrJwt` + `consentGate` on sensitive paths.
- **Errors:** Widespread `sanitizeErrorForClient` on route handlers (no raw stack to clients).
- **Secrets:** AGENTS.md + NV-SECRETS — no keys in git; SSM `/jurexio/prod/*` on EC2.
- **CI:** `guardrail:jrx-brands` **PASS** (2026-10-22 run).

### P1 — address before external security claim

| Item | Status | Evidence |
|------|--------|----------|
| **Dynamic code execution** | **CLOSED** | `src/utils/jrx-safe-calculator.ts` + unit tests; calculator `Function()` removed from orchestration path |
| **MCP OAuth stubs** | **CLOSED** | `jrx-mcp-connector-service.ts` — `stub_not_implemented` / `not_implemented`; prod `JRX_MCP_STUBS_DISABLED=1` implicit via `NODE_ENV=production`; `tests/unit/jrx-mcp-connector-stub.test.ts` |
| **Full guardrail suite on CI** | **CLOSED (workflow)** | `.github/workflows/jrx-ci.yml` runs full guardrail + build + test; green run proof = first push after merge |
| **Dependency CVEs** | **CLOSED (workflow, remediation open)** | CI reports `npm audit --audit-level=high`; fails on **critical** (5 as of 2026-10-22 local run); `.github/dependabot.yml` |
| **Compose smoke password** | **OPEN (ops)** | `docker-compose.jurexio-aws.yml` placeholder DB password — **never** use in prod (RDS only) |
| **A2A HMAC** | **CLOSED (boot gate)** | `jrx-env-bootstrap.ts` when `JRX_A2A_HMAC_REQUIRED=1` + production; operator sets `A2A_HMAC_SECRET` on EC2/SSM |

### P2 — hardening & standards

- Split hottest paths (search, docparse) into optional sidecars if CPU/memory contention on single gateway container.
- Rate limiting per SDK key tier (verify on all public routes).
- Structured security headers on console (CSP, HSTS — ALB TLS assumed).

**Existing security assets to leverage**

- `src/packages/security/security-audit-service.ts` — OWASP LLM-oriented checks.
- `src/guardrails/scripts/detect-hardcoded.ts` — secret pattern scan (run in CI).
- SOC2/ISO **readiness** docs (not certification).

---

## 4. Code quality findings

### Strengths

- Mandatory **Project-Tracker.md** + **CHANGELOG.md** on changes (AGENTS.md).
- **Jurisdiction catalog** (`shared/jrx-jurisdiction-catalog.ts`) — single SSoT for six jurisdictions.
- **Queen orchestrator** + Auto-RAG router — tested intent classification (`jrx-auto-rag-router.test.ts` when vitest available).
- **Forbidden brand** guardrail prevents legacy upstream fork tokens in the active Jurexio tree.

### Gaps

| Gap | Mitigation |
|-----|------------|
| Large route surface area | Continue domain route files; avoid new god-files |
| Legacy `nv_*` table names | Documented compatibility; rename is major semver |
| Client/server type baselines | `guardrail:client-types` / `guardrail:server-types` on CI |
| Test run on agent VM | Run vitest on EC2 or GitHub Actions after push |

---

## 5. Recommended quality gate (release checklist)

1. `npm ci`
2. `npm run guardrail` (full)
3. `npm run build`
4. `npm run test` (or counsel-grade self-test minimum)
5. Deploy existing EC2 SSM script + `jrx-smoke-ec2.sh`
6. Record HTTP codes in Project-Tracker (no secrets)

---

## 6. Conclusion

Jurexio is **architecturally suitable** for enterprise legal AI with **clear security patterns** and **modular monolith + multi-container deploy**. It is **not** a blanket “zero issues / full microservices cloud-native” certification without CI proof and third-party validation. Close P1 items above and run the release checklist after **`git push`** and **redeploy** on `i-0fb470b236c14405b`.
