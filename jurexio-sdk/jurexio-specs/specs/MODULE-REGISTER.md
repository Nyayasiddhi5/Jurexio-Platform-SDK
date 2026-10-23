<!-- Source of truth: https://claude.ai/code/artifact/aca7a443-ecf5-4322-b10a-09f374a2e19a -->

# Jurexio Platform — Module Register

Oct 15, 2026 · @Suresh Singh

## Purpose and status

Jurexio is a 14-module Institutional Legal Operating System. Jurexio Ledger (M09) is the audit spine, and the Jurexio Engine (M03) is the AI layer.

The Jurexio SDK, the platform UI/UX and the wireframes are complete. This register is the single authoritative list of module numbers, names and design order (not the engineering sequence, which the CTO publishes). It supersedes all earlier names, including IronLedger and Nyayavigya Engine.

## Module register

Every module writes to Jurexio Ledger, and every AI output in any module passes a Human-in-the-Loop (HTIL) gate.

| # | Module | Function | Why it matters | Design priority |
| --- | --- | --- | --- | --- |
| M01 | MatterCore | Matter and case management | System of record; every Ledger event and AI action keys to a matter ID | 6 |
| M02 | DocVault | Documents and communications | Privilege and confidentiality live here; AI drafts are versioned apart from human-approved text | 7 |
| M03 | Jurexio Engine | AI assist and drafting on the Jurexio SDK (148 agents + Queen orchestrator) | The core differentiator and the largest liability; defensible only through HTIL and full logging | 3 |
| M04 | LexGraph | Knowledge management and institutional knowledge graph | Grounds AI in verified law per jurisdiction; the main defence against fabricated citations | To be sequenced |
| M05 | DeadlineGuard | Tasks, hearings and deadlines | Missed deadlines are the most preventable malpractice cause; owns the Tasks stage of the system model | 5 |
| M06 | BillGuard | Billing and time discipline | Fee and trust-account rules differ by jurisdiction; protects revenue and professional conduct | To be sequenced |
| M07 | RegRadar | Compliance and risk monitoring | Enforces each jurisdiction's bar, data protection and local-law rules as live checks | 4 |
| M08 | ClientBridge | Client portal | Client-facing access-to-justice surface with high confidentiality exposure | To be sequenced |
| M09 | Jurexio Ledger | Audit and traceability core | The audit spine; proof of every human approval and every data movement | 1 |
| M10 | NexusConnect | Integration and API layer | Connects courts, e-filing, government portals, ERP and CRM under residency rules | To be sequenced |
| M11 | CommandCentre | Org settings and admin | Tenant, role, location and jurisdiction configuration; every change is a Ledger event | To be sequenced |
| M12 | PulseComms | Communication and engagement | Email, SMS and WhatsApp under local consent and messaging law (e.g. TCPA, DPDP, TRAI DLT) | To be sequenced |
| M13 | CloudVault | External storage integration | Physically enforces data residency; storage stays in the jurisdiction's region | To be sequenced |
| M14 | DataMigrate | Legacy data migration | Gate to every client onboarding; migrated records carry chain-of-custody in the Ledger | 2 |

## Platform constants

These apply to all 14 modules without exception.

- **Jurexio Ledger logging:** every module interaction emits a Ledger event carrying actor, matter ID, module, action, jurisdiction, location, agent ID where AI is involved, HTIL decision and an integrity hash.
- **HTIL on all AI output:** no Jurexio Engine output reaches a client, court or record without a named human's approval, and that approval is itself a Ledger event.
- **Federated intelligence:** AI queries data locally in its home jurisdiction. Zero cross-border data movement.
- **System model:** Matter → Documents → Tasks → AI → Audit. A workflow that does not fit this chain is redesigned.
- **Compliance built in:** SOC 2, ISO 27001, ISO 42001, GDPR, DPDP and applicable bar council rules are design inputs, not retrofits.

## Multi-jurisdiction and multi-location model

Each jurisdiction is a pluggable **Jurisdiction Pack**, so new countries are added by activating a pack, not by changing module code.

A Jurisdiction Pack contains:

- Bar council and professional-conduct rules
- Data protection law and consent rules
- Procedural law, court rules and court calendars
- Supported languages
- Data residency region and retention rules

**Coverage:** complete United States (all 50 states, the District of Columbia and the federal courts) and complete India (all 28 states and 8 union territories, all 25 High Courts and subordinate courts). Packs are built at state level, not only country level, because bar rules, court rules and limitation periods differ by state.

**Multi-location rules:**

- Every matter has one home jurisdiction; its data stays in that region.
- Offices in other locations reach it by federated query, never by replication.
- A matter spanning several jurisdictions applies the strictest applicable standard.
- Every Ledger event carries both a jurisdiction tag and an office-location tag.

## Design priority sequence

DataMigrate moves to priority 2: no client can onboard without it, and it needs Jurexio Ledger in place first to record chain of custody.

1. Jurexio Ledger (M09) — audit spine every other module depends on
2. DataMigrate (M14) — onboarding gate; provenance logged from the first migrated record
3. Jurexio Engine (M03) — AI assist with HTIL on the Jurexio SDK
4. RegRadar (M07) — Jurisdiction Pack compliance checks
5. DeadlineGuard (M05) — tasks, hearings and deadlines
6. MatterCore (M01) — matter and case management
7. DocVault (M02) — documents and communications

The remaining seven modules (M04, M06, M08, M10, M11, M12, M13) will be sequenced after client feedback. One module is fully specified and approved before the next begins.

## Naming and governance

| Former name | Current name |
| --- | --- |
| IronLedger | Jurexio Ledger |
| Nyayavigya Engine | Jurexio Engine |
| Nyayavigya Engine SDK | Jurexio SDK |
| 13 core modules | 14 modules (DataMigrate added as M14) |

- The platform architecture diagram still shows the former names, "13 Core Modules", no DataMigrate tile, and a typo in the Data Layer ("Inistory"). It must be corrected before external use.
- Existing specs and the completed UI/UX files carry the former names and need a versioned rename, not silent edits.
- "Jurexio Ledger" and "Jurexio Engine" are descriptive, so trademark protection rests on the "Jurexio" mark itself.

## Decisions recorded

All four items were agreed by the Chairman on 15 October 2026.

- **DataMigrate priority:** confirmed at priority 2, after Jurexio Ledger and ahead of Jurexio Engine.
- **Jurexio Engine rename:** applies everywhere, including internal code, agent names and the Queen orchestration layer. No "Nyayavigya" identifiers remain.
- **Jurisdiction Packs:** Raja Sekhar T is in charge of building and maintaining the US and Indian state-level packs.
- **Architecture diagram:** must be corrected (names, 14 modules, DataMigrate tile, Data Layer typo) and approved before any investor or client use.
