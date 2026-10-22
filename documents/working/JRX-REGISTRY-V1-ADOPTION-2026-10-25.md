# Registry v1 adoption sign-off — 25 Oct 2026

**Repository:** Jurexio-Platform-SDK  
**Validate:** `npm run registry:validate` → **OK**

## Event registry v1 (E1–E5)

| ID | Requirement | Status |
| --- | --- | --- |
| E1 | Gate-outcome naming `DOMAIN.G_NN_NN_REJECTED` / `_WITHDRAWN` | Done — `events._meta.gate_outcome_naming` |
| E2 | `critical` on all 758 events | Done — 116 true / 642 false (`adoption-summary.json`) |
| E3 | FLAG-012 eighteen events | Done — `critical_events_v1.json` + `_meta.flag_012_core_events` (Chairman confirm list in questions doc) |
| E4 | Alias period 12 months | Done — `alias_policy` until **2027-10-26**; `alias_sunset` on legacy rows |
| E5 | Canonical-event rule | Documented in `_meta`; conflicts C-01–C-12 remain for Chairman |

## Permission catalogue v1 (P1–P5)

| ID | Requirement | Status |
| --- | --- | --- |
| P1 | Rename gate placeholders | Done — **144** renames (`adoption-summary.json`) |
| P2 | Six gate classes | Done — [CTO-GATE-CLASS-CONFIRMATION.md](../../jurexio-specs/registry/CTO-GATE-CLASS-CONFIRMATION.md) |
| P3 | L1–L9 retirement map | Done — `l1-l9-retirement-map.json` |
| P4 | Role templates + SoD | Done — `role-templates.json`, `separation-of-duties.json` (LCO + Legal Dept Reviewer) |
| P5 | protected / step_up | Adopted on catalogue; CTO spot-review ongoing for renamed `.decide` rows |

## Other P0 (O1–O4)

| ID | Item | Status |
| --- | --- | --- |
| O1 | Model provider terms | [JRX-MODEL-PROVIDER-TERMS-AP-SOUTH-US.md](./JRX-MODEL-PROVIDER-TERMS-AP-SOUTH-US.md) — Chairman sign-off pending |
| O2 | Code rename plan | [JRX-CODE-RENAME-SPRINT1-PLAN.md](./JRX-CODE-RENAME-SPRINT1-PLAN.md) |
| O3 | Event bus annex | [JRX-LEDGER-EVENT-BUS-ANNEX.md](./JRX-LEDGER-EVENT-BUS-ANNEX.md) |
| O4 | Access-decision API | [JRX-ACCESS-DECISION-INTERFACE.md](./JRX-ACCESS-DECISION-INTERFACE.md) + stub route |

## Sprint 1 module blockers cleared (CTO)

- **M09 Ledger** — registry + annex; code rename PR-1 next.  
- **M11 CommandCentre** — catalogue + templates + evaluate stub; full policy engine Sprint 1.  
- **M14 DataMigrate** — FLAG-012 list adopted; Chairman confirmation on exact eighteen names.

## Still open for Chairman

See [jurexio-chairman-25oct-cto-questions-conflicts.md](/cursor/stores/self/docs/jurexio-chairman-25oct-cto-questions-conflicts.md) — items **C-01–C-12**, **Q1–Q6**.

## Tooling

- `python3 jurexio-specs/registry/adopt_registry_v1.py` — idempotent adoption pass  
- CI: `.github/workflows/jrx-ci.yml` runs `validate.py`
