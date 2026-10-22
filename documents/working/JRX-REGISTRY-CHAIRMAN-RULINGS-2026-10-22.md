# Chairman rulings — Event registry v1 & Permission catalogue v1

**Recorded:** 2026-10-22 (IST)  
**Source:** Chairman mail to Vamsi (post questions paper)  
**Machine metadata:** `jurexio-specs/registry/events.json` → `_meta.chairman`  
**Apply script:** `python3 jurexio-specs/registry/apply_chairman_rulings_2026-10-22.py`

## Applied in repository

| Ruling | Implementation |
| --- | --- |
| **Q1** FLAG-012 eighteen events | `MIGRATE.PRECONDITIONS_MET` added; `IT_DIRECTOR_REJECTED` removed from FLAG-012; rejections via `MIGRATE.G_14_08_REJECTED` |
| **Q1** Critical subset | Eight FLAG-012 events critical (approvals, cutover, rollback, staging destroy, decommission); `STREAM_CREATED` / `SYNC_COMPLETED` not critical |
| **Q2** Aliases 90 days | `_meta.alias_policy.legacy_alias_window_days: 90`, anchor `sprint_1_go_live` |
| **Q3** Role templates | `role-templates.json` — LCO + Legal Department Reviewer; jurisdiction pack fields `pending-R1` |
| **Q4** Model providers | [JRX-MODEL-PROVIDER-TERMS-AP-SOUTH-US.md](./JRX-MODEL-PROVIDER-TERMS-AP-SOUTH-US.md) + DPA table |
| **Q5** PDD | Sprint 1 M09/M11 blocked only on P0 engineering (registries, renames, bus annex, access API) |
| **Q6** Sprint sequence | Documented in [JRX-SPRINT-SEQUENCE-CHAIRMAN-2026-10-22.md](./JRX-SPRINT-SEQUENCE-CHAIRMAN-2026-10-22.md) |
| **C-04** 759 + Q1 | **1c7c pack imported** (759) + **`MIGRATE.PRECONDITIONS_MET`** + **`REGRADAR.OBLIGATION_MAPPED_TO_LOCATION`** → **760** adopted events |
| **C-05** G-07-02 | **GUARDED** in `gates.json`; [CTO-GATE-CLASS-CONFIRMATION.md](../../jurexio-specs/registry/CTO-GATE-CLASS-CONFIRMATION.md) |
| **C-08** One act / record | Documented in event bus annex + `_meta.canonical_event_rule` |
| **C-10** Access | `POST /api/jrx/platform/access/evaluate` — deny without matter policy when `resourceId` present |
| **CH-4** Central access | `scripts/jrx-check-central-access-only.sh` in guardrail |
| **CH-3** Permission catalogue | **Auto-approved** — `apply_ch3_permission_catalogue.py` (144 renames); proposals closed |

## Conflict register status

Full text with **RESOLVED** markers: [JRX-REGISTRY-CONFLICTS-2026-10-22.md](./JRX-REGISTRY-CONFLICTS-2026-10-22.md)

## Still external / Sprint 1 code

- **C-02** IronLedger / `nv_pii_vault` identifier renames in `src/` (pre-production refactor — in progress via [JRX-CODE-RENAME-SPRINT1-PLAN.md](./JRX-CODE-RENAME-SPRINT1-PLAN.md))
- **C-07** Dual regional Ledger stacks (IaC Sprint 1; synthetic-only until both regions live)
- **Q4** DPA **legal execution** with AWS (engineering sign-off complete — see model terms doc)
- **Git push** from Mac (~21 commits) before remote CI / Sprint 1 module PRs

Final point-by-point status: [JRX-CHAIRMAN-FINAL-CLOSURE-STATUS-2026-10-22.md](./JRX-CHAIRMAN-FINAL-CLOSURE-STATUS-2026-10-22.md)
