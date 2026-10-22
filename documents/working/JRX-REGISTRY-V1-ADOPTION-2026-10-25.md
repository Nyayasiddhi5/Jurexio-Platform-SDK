# Registry v1 adoption sign-off — closed 22 Oct 2026 (IST)

**Repository:** Jurexio-Platform-SDK  
**Validate:** `npm run registry:validate` → **OK**  
**Unit tests:** `tests/unit/jrx-module-registry-compliance.test.ts`

Chairman email / conflict rulings are **out of band**; engineering checklist below is **complete**.

## Event registry v1 (E1–E5)

| ID | Requirement | Status |
| --- | --- | --- |
| E1 | Gate-outcome naming `DOMAIN.G_NN_NN_REJECTED` / `_WITHDRAWN` | **Done** — validated in `validate.py` |
| E2 | `critical` on all 758 events | **Done** — boolean on every row |
| E3 | FLAG-012 eighteen events | **Done** — all `critical: true` |
| E4 | Alias period 12 months | **Done** — until **2027-10-26** |
| E5 | Canonical-event rule | **Done** — `_meta` + registry API validate |

## Permission catalogue v1 (P1–P5)

| ID | Requirement | Status |
| --- | --- | --- |
| P1 | Rename gate placeholders | **Done** — 0 `.g_` ids |
| P2 | Six gate classes | **Done** — CTO memo in repo |
| P3 | L1–L9 retirement map | **Done** |
| P4 | Role templates + SoD | **Done** |
| P5 | protected / step_up | **Done** — every permission row has both flags; gate sync verified |

## Other P0 (O1–O4)

| ID | Item | Status |
| --- | --- | --- |
| O1 | Model provider terms | **Done** (doc) — commercial sign-off external |
| O2 | Code rename plan | **Done** (plan) — code PRs Sprint 1 |
| O3 | Event bus annex | **Done** |
| O4 | Access-decision API | **Done** — stub + registry read API |

## Platform hooks (engineering)

| Capability | Location |
| --- | --- |
| Registry validate (CI) | `jurexio-specs/registry/validate.py` |
| Access evaluate (deny default) | `POST /api/jrx/platform/access/evaluate` |
| Event name validate | `POST /api/jrx/platform/registry/events/validate` |
| Docs | [JRX-PLATFORM-REGISTRY-API.md](./JRX-PLATFORM-REGISTRY-API.md) |

## Sprint 1 (post-closeout)

Module **implementation** (M09 ingest, M11 policy engine, IronLedger renames) starts after **git push** from Mac; not part of this registry closeout.
