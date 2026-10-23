# Sprint 1 kickoff — M09 / M11 / C-07 (23 Oct 2026)

**Branch:** `feat/jrx-sprint1-foundation` (local; includes 22 unpushed commits on `main` lineage)  
**Blocked on GitHub:** cloud agent cannot push — **Mac `git push`** required for remote CI

## Landed in this slice

| Workstream | Deliverable |
| --- | --- |
| **M11** | `evaluateJrxAccessDecision()` — catalogue lookup, GUARDED/DUAL, protected step-up, SoD permission pairs, `context.heldPermissions` until DB assignments |
| **M11** | `POST /api/jrx/platform/access/evaluate` wired to policy service (default deny without assignments) |
| **M09** | `ingestJrxLedgerEvent()` — registry validation + **synthetic-only** guard (C-07) |
| **M09** | `POST /api/jrx/platform/ledger/ingest` |
| **C-07** | `infra/terraform/envs/ledger-dual-region/` skeleton + runbook § Dual-region Ledger |
| **Tests** | `tests/unit/jrx-access-policy.test.ts`, `jrx-ledger-ingest.test.ts` |

## Not in this slice (next PRs)

- Persistent Ledger chain / Postgres append store
- M01 matter policy feed into access evaluate
- Tenant role assignment persistence (CommandCentre DB)
- Terraform apply + regional SSM URLs
- C-02 residual IronLedger / `nv_pii_vault` renames
- M01 foundation + M13 storage modules

## Verify locally

```bash
npm run registry:validate
npm run build
npx vitest run tests/unit/jrx-access-policy.test.ts tests/unit/jrx-ledger-ingest.test.ts
```

## References

- [JRX-SPRINT-SEQUENCE-CHAIRMAN-2026-10-22.md](./JRX-SPRINT-SEQUENCE-CHAIRMAN-2026-10-22.md)
- [JRX-LEDGER-EVENT-BUS-ANNEX.md](./JRX-LEDGER-EVENT-BUS-ANNEX.md)
- [JRX-ACCESS-DECISION-INTERFACE.md](./JRX-ACCESS-DECISION-INTERFACE.md)
