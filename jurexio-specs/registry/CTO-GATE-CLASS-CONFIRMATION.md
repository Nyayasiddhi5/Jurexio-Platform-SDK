# CTO gate-class confirmation — Permission catalogue v1 (P2)

**Date:** 2026-10-22 (IST)  
**Authority:** Vamsi, CTO — Chairman mail 21 Oct 2026  
**Registry:** `jurexio-specs/registry/gates.json` @ `1.0.0-adopted`

Chairman requested confirmation of six gates whose class was inferred from description text only in the seed pack. **CTO confirms the seed assignments** unless Chairman instructs otherwise before Sprint 1.

| Gate ID | Module | Decision (short) | Class | Rationale |
| --- | --- | --- | --- | --- |
| G-09-06 | M09 Ledger | Export certification | **DUAL** | Distinct certifier vs requester; two-person control on sealed export |
| G-09-08 | M09 Ledger | Break-glass access | **GUARDED** | Requester cannot self-approve emergency access |
| G-09-09 | M09 Ledger | Registry change | **GUARDED** | Platform registry edits require independent approver |
| G-14-06 | M14 DataMigrate | Board / CEO cutover | **DUAL** | Board approval and CEO confirmation are distinct actors |
| G-14-07 | M14 DataMigrate | IT director sign-off | **GUARDED** | Migration director cannot approve own cutover request |
| G-07-02 | M07 RegRadar | Regulatory attestation | **SELF_ATTESTED** | Professional attestation on own record with evidence + audit sampling |

**Gate-outcome naming (E1):** Adopted — `DOMAIN.G_NN_NN_REJECTED` / `DOMAIN.G_NN_NN_WITHDRAWN` with mandatory rejection reason in Ledger payload.

**Evidence:** `npm run registry:validate` after adoption; spot-check `outcome_events` on the six gates above.
