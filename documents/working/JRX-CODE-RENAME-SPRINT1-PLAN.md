# Code rename plan — Sprint 1 (Ledger, Engine, PII vault)

**Status:** Plan by 25 Oct 2026; code lands Sprint 1 week 1  
**Requirement:** Chairman O2 — remove IronLedger / nv_pii_vault branding before module engineering

## Scope

| Track | PR | Content |
| --- | --- | --- |
| **PR-1** | Event & API strings | Rename user-visible and log identifiers `IronLedger` → **Jurexio Ledger**; align event names with registry (`LEDGER.*`) |
| **PR-2** | Paths & packages | Rename `nv-ironledger` paths, `nv_pii_vault` module names → `jrx-ledger`, `jrx-pii-vault` (or consolidated vault service) |
| **PR-3** | DB / env | Migration aliases only — no breaking RDS change without maintenance window |

## Inventory (grep baseline 22 Oct 2026)

- `src/` — multiple `IronLedger`, `ironledger`, `nv_pii_vault` references (services, routes, comments).
- Docker / compose labels — align with JRX guardrail `guardrail:jrx-brands`.

## Rules

- No renames in `nyayavigya-platform-312` (Jurexio workspace only).
- Each PR: `npm run guardrail`, `npm run build`, tracker + changelog row.
- Do not rename production env keys on EC2 without explicit **GO**.

## Sequencing

1. After registry v1 adopted (this deliverable).  
2. PR-1 before M09 Ledger ingest work.  
3. PR-2 before external SDK docs reference paths.
