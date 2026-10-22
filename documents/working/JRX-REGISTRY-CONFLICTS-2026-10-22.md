# Registry conflict register — Chairman rulings applied

**Supersedes:** draft in Agent store questions doc (22 Oct send)  
**Status:** Rulings received 22 Oct 2026 — engineering apply same day

| ID | Resolution |
| --- | --- |
| **C-01** | **RESOLVED** — “Complete” = design/wireframes only; fix investor/demo decks (ops task). |
| **C-02** | **RESOLVED** — No phased 90-day rename; refactor identifiers/routes/env/user strings **before Sprint 1**; alias routes max **30 days** where required. |
| **C-03** | **RESOLVED** — `MIGRATE.PRIVILEGE_CLEARED` alias only; DocVault owns `DOCUMENT.CLASSIFICATION_LOWERED`. |
| **C-04** | **RESOLVED** — **759** events authoritative; repo at 759 with `MIGRATE.PRECONDITIONS_MET`. |
| **C-05** | **RESOLVED** — **G-07-02 → GUARDED** (Compliance Officer confirmation). |
| **C-06** | **RESOLVED** — G-09-08 remains GUARDED. |
| **C-07** | **RESOLVED** — Logical `chain_id` per jurisdiction for dev/test synthetic only; **IaC both ap-south-1 and us-east-1 Sprint 1**; no real client data until both stacks exist. |
| **C-08** | **RESOLVED** — One act → one canonical event **per record changed**, same transaction; G-09-07 two records = two events OK. |
| **C-09** | **RESOLVED** — P0 rename scope: event names, UI strings, routes, env, packages; DB tables before first production data. |
| **C-10** | **RESOLVED** — CommandCentre hosts evaluate; MatterCore feeds policy; **deny when no matter policy**. |
| **C-11** | **RESOLVED** — Event bus annex delivered. |
| **C-12** | **RESOLVED** — Same as C-10; access API stub + Sprint 1 week 1 hardening. |

## Questions

| ID | Ruling summary |
| --- | --- |
| **Q1** | FLAG-012 option (b) + `PRECONDITIONS_MET`; drop `IT_DIRECTOR_REJECTED` from eighteen; partial critical flags |
| **Q2** | **90 days** from Sprint 1 go-live |
| **Q3** | Publish LCO + Legal Department Reviewer; jurisdiction pack layered content pending Raja Sekhar T |
| **Q4** | Bedrock in-region only; OpenRouter not for client data; dual regional keys; Hindi eval bar; DPA in deliverables |
| **Q5** | PDD closed 21 Oct; Sprint 1 not blocked on further PDD |
| **Q6** | Sprint 1 = M09, M11, M01 foundation, M13; Sprint 1b = M05 + M12 before first production cutover |
