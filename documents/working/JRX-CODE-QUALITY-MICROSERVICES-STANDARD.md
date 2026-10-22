# JRX code quality & microservices standard

**Applies to:** Jurexio-Platform-SDK (gateway, console, packages)  
**Goal:** Global engineering practice — secure, testable, observable, jurisdiction-aware.

---

## 1. Microservices & deployment

| Rule | Standard |
|------|----------|
| **Deploy units** | `jrx-gateway`, `jrx-console`, Postgres, Redis on existing EC2/ALB — no new infra without GO |
| **API boundary** | All product APIs under `/api/jrx/`; SDK clients use `@jurexio/client-sdk` |
| **Domain modules** | One concern per `jrx-*-routes.ts` / service file; shared DB via Drizzle + RLS where enabled |
| **Optional workers** | Heavy search/corpus jobs via SSM scripts or future `jrx-search` — async, idempotent |
| **Config** | Secrets only in SSM/env on host — never committed |

---

## 2. Security (required on every change)

- Never log or return secret values (keys, passwords, full connection strings).
- Use `sanitizeErrorForClient` on user-facing route errors.
- Protect mutations with `authenticateToken` or `dualSdkOrJwt`; AI processing with `consentGate` where applicable.
- No new `eval` / unguarded `Function()` — use typed parsers or allowlisted tool executors.
- SQL: Drizzle/parameterized queries only; no string-concat SQL from user input.

---

## 3. TypeScript & style

- Imports at top of file (no inline imports except documented circular deps).
- Exhaustive `switch` on discriminated unions (`never` in default).
- Match surrounding naming (JRX public names; legacy `nv_*` only for DB compatibility).
- SemVer + package CHANGELOG for any `@jurexio/*` SDK surface change.

---

## 4. Testing & CI

- **GitHub Actions** (`.github/workflows/jrx-ci.yml`): `npm ci` → full `npm run guardrail` → `npm run build` → `npm test run` → `npm audit --audit-level=high` on every PR and `main` push.
- **Dependabot** (`.github/dependabot.yml`): weekly npm + GitHub Actions update PRs.
- Full `npm run guardrail` + `npm run build` before production deploy (same as CI).
- Unit tests for retrieval, jurisdiction, auth, and MCP stub honesty when touching those areas.

### Release checklist (production)

1. `git push origin main` (CI green)
2. `npm ci && npm run guardrail && npm run build`
3. `bash scripts/jrx-deploy-aws-ssm.sh`
4. `bash scripts/jrx-smoke-ec2.sh`
5. Project-Tracker row with SSM command id + smoke HTTP codes (no secrets)

---

## 5. Observability

- Health: `/api/jrx/health`
- Audit: hash-chain routes for governance-sensitive actions
- Deploy evidence: Project-Tracker row + SSM command id

---

## 6. Legal / jurisdiction product code

- Use `shared/jrx-jurisdiction-catalog.ts` for display order and codes (**US, IN, UK, EU, SG, GC**).
- RAG: jurisdiction-tagged chunks; `crossJurisdiction` only when explicit.
- Outcome sanitization + binding middleware on all user-facing legal completions.

---

## 7. References

- `AGENTS.md` — change tracking, secrets, deploy
- `JRX-PLATFORM-QUALITY-SECURITY-AUDIT-2026-10-22.md` — latest audit
- `JRX-FRONTEND-INTEGRATION.md` — SDK auth & CORS
