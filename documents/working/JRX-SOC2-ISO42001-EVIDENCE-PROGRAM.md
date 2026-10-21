# JRX SOC 2 & ISO 42001 evidence program (Phase E)

**Status:** Evidence mapping — **not** a certification claim.  
**Tenant:** Jurexio Enterprise (`/jurexio/prod/*`, EC2 `i-0fb470b236c14405b`).

## SOC 2 trust criteria (mapping)

| Criterion | Platform control | Evidence pointer |
|-----------|------------------|------------------|
| **CC6.1** Logical access | JWT + RBAC, SDK key auth, org RLS | `src/middleware/sdk-gateway.ts`, `rbac-service.ts`, RLS tests |
| **CC7.2** Change management | Project-Tracker, CHANGELOG, CI guardrails | `Project-Tracker.md`, `.github/workflows/jrx-ci.yml` |
| **CC8.1** Audit logging | Hash-chain audit, `/api/jrx/audit/*` | `jrx-seed-audit-greenfield.sh`, console governance hub |
| **CC9.2** Risk mitigation | Jurisdiction binding, outcome sanitization | `jrx-jurisdiction-binding-middleware.ts`, `jrx-client-outcome-sanitize.ts` |

## ISO/IEC 42001 (AI management)

| Clause theme | Implementation | Gap |
|--------------|----------------|-----|
| AI policy | Protocol registry, agent governance | Formal signed AI policy doc (customer) |
| Impact assessment | EU AI act compliance service | US/EU DPIA templates |
| Monitoring | Health deps, token metrics, GRPO export | Continuous monitoring SLO dashboard |
| Human oversight | HITL / maker-checker, e-filing review gate | Expand UI coverage |

## Operator actions for audit

1. Export last 90d `Project-Tracker.md` + deploy SSM command IDs.  
2. Provide access review for super_admin accounts.  
3. Engage SOC 2 auditor when production steady on `main`.
