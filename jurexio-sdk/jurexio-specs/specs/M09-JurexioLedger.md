<!-- Source of truth: https://claude.ai/code/artifact/44b66db8-166f-40dd-8be1-7fc05d7f7de4 · exported 21 Oct 2026 · do not edit here; edit the Claude Doc and re-export -->

# Module Specification — M09 Jurexio Ledger

Oct 15, 2026 · @Suresh Singh

## Document control

| Field | Value |
| --- | --- |
| Module | M09 Jurexio Ledger (formerly IronLedger) |
| Spec version | v1.1, draft for Chairman approval (red-team fixes 15 Oct 2026; consolidated after the PDD Review Log, 18 Oct 2026) |
| Design order | 1 of 14 |
| Engineering owner | CTO (Vamsi) |
| Jurisdiction Pack inputs | Raja Sekhar T |
| Status | Not approved for engineering until Section 8 blockers are closed |

This specification implements 18 decisions the Chairman locked on 15 October 2026. They are referenced below by ID and are not reopened here.

| ID | Locked decision |
| --- | --- |
| R1 | PostgreSQL, append-only. Amazon QLDB rejected (AWS end of support). OQ-02 closed. |
| R2 | AWS KMS signing per jurisdiction, plus a licensed digital signature certificate on court-facing exports. OQ-03 closed. |
| R3 | Admissibility basis: BSA 2023 Section 63 (India), FRE 902(13)/(14) (US). Pre-July-2024 regime set by Jurisdiction Pack. |
| R4 | Scope framed as v1.0 vs trigger-based deferred scope. No phase labels. |
| D1 | Transactional outbox for every event; six critical event classes sealed before the action is released. |
| D2 | One hash chain per tenant per jurisdiction, with a per-matter index and completeness proof. |
| D3 | RFC 3161 timestamp anchoring per jurisdiction: hourly, and immediately on critical events. |
| D4 | Event names as DOMAIN.EVENT\_NAME, separate category field, registry rejects unregistered events. |
| D5 | AI events store hashes, pointers and metadata only. Re-hash check on access. Discarded drafts keep their hash. |
| D6 | No plain-text personal data. Per-subject keys; erasure by crypto-shredding with human approval and certificate. |
| D7 | Retention set by Jurisdiction Pack, 7-year floor, longest rule wins, holds suspend, human-approved expiry. |
| D8 | Cross-location view through federated aggregates only; small counts suppressed; in-region drill-down. |
| D9 | Role-based read access; clients get a curated trail, off by default, enabled by the partner. |
| D10 | Human-certified court evidence package; two signatories in India; disclosure review before sealing. |
| D11 | Every Jurexio Engine agent step logged as a sub-chain; hashes only; versions pinned; IP-restricted. |
| D12 | Legacy audit history imported as a separate, labelled, attested segment. |
| D13 | Native SOC 2 evidence view; tool-neutral evidence-only export; vendor chosen within 30 days. |
| D14 | India and US admissibility opinions commissioned. Interim wording: "engineered to support admissibility". |

### Consolidation v1.1 (PDD Review Log, 18 Oct 2026)

This is the issued v1.1 (I-01).

**Platform rules applied to this specification**

- **Gate outcomes (CB-ENG-06, CB-DES-05):** every gate records approved, rejected and withdrawn outcomes as Ledger events; rejection needs a reason; the gate engine generates the `_REJECTED` and `_WITHDRAWN` event names into Event registry v1. Every gate screen shows pending, approved, rejected and withdrawn.
- **Gate classes (I-05):** GUARDED = the requester can never approve; DUAL = two distinct people; SELF-ATTESTED = an act on one's own record, with reason, evidence and step-up where stated, logged and sampled by Compliance. The locked same-actor guard governs AI output approval; the earlier wording "applies to every gate" over-extended it.
- **Approvers (C-02, CB-ENG-04):** numbered RBAC levels are retired; every approver maps to named permissions; `rbac_level` becomes a role and permission reference. "Jurexio" marks platform roles; unprefixed roles are tenant roles.
- **Canonical events (C-07, C-15):** one act produces one canonical event, owned by the module that owns the record; migration and other context goes in attributes; `MIGRATE.*` events record project state only.
- **Design order (C-13):** the order specs were designed, not the engineering sequence, which the CTO publishes.

**Gate classes in this module**

| Class | Gates |
| --- | --- |
| GUARDED | G-09-01, G-09-02, G-09-04, G-09-05, G-09-08, G-09-09 |
| DUAL | G-09-03, G-09-06 (sequential), G-09-07 (tenant Compliance Officer and tenant IT Director), G-09-10 (Jurexio CTO and Jurexio Compliance) |
| Retired | G-09-11, replaced by CommandCentre G-11-11 (C-08) |

**Module changes**

- **CB-ENG-02:** the platform event bus is specified as an annex to Ledger Core: built on the outbox, per region, covering schema, delivery guarantees, regional topology and the event catalogue. Owner: CTO.
- **BQ-02 and CB-ENG-09 (P0):** the CTO delivers Event registry v1 before Sprint 1: every event as `DOMAIN.EVENT_NAME` with an alias period, the 18 DataMigrate events, and the generated rejected and withdrawn events.
- **D-03 and BQ-01 (decided):** Ledger code identifiers are renamed before Sprint 1, as for the Engine.
- **C-09:** recovery figures follow CloudVault D4 and are restricted claims until drill evidence exists.
- **C-10:** "one key per jurisdiction" is the evidence and PDF signing key; data encryption follows the CloudVault key hierarchy.
- **C-16:** v1.0 SOC 2 evidence leaves as a tool-neutral export file; a GRC connector waits for the Vanta or Drata choice (due about 14 Nov 2026).
- **BQ-04 (accepted):** nothing is client-visible in the curated trail unless on a counsel-approved allow-list.
- **BQ-05 (accepted):** identity resolution is held by the Compliance Officer and DPO only; every resolution logged as `LEDGER.IDENTITY_RESOLVED` with a reason.
- **BQ-03 and CB-ENG-07:** certifier roles are configured per pack once the India and US counsel opinions land; no client evidence package before then.
- **CB-CMP-02 (confirmed):** the "© Jurexio Inc." footer appears only on the technical attestation page of an evidence package, never on the firm-certified body.
- **D-02:** `nv_pii_vault` is renamed in the rename register.

## Section 1 — Module identity

| Field | Value |
| --- | --- |
| Module | M09 Jurexio Ledger |
| Tagline | Every action, every decision, every AI output: tamper-evident and independently verifiable. |
| Job to be done | Give every institution using Jurexio provable, jurisdiction-resident evidence of who did what, when, and with which human approval, across all 14 modules. |
| Primary users | Compliance Officer, Data Protection Officer, Partner / senior counsel (exports and certification), IT Director, external auditor (time-limited), head-office General Counsel (federated view). |
| Secondary users | Every user indirectly (every action writes an event); clients (curated trail, if enabled). |
| Nature | Deterministic infrastructure. M09 itself makes no AI decisions. |

### v1.0 scope — in

- Event ingestion from all 14 modules through the transactional outbox, with critical-event sealing (D1).
- Hash chain per tenant per jurisdiction, matter index and per-matter completeness proof (D2).
- RFC 3161 anchoring, hourly and on critical events (D3).
- Central event registry with write-time rejection of unregistered events (D4).
- Hash-and-pointer payloads with DocVault re-hash verification (D5).
- Pseudonymisation, per-subject keys, crypto-shredding workflow (D6).
- Jurisdiction Pack-driven retention, holds and human-approved disposal (D7).
- Federated aggregate view across locations (D8).
- Role-based Ledger views, auditor access and curated client trail (D9).
- Court evidence package with human certification (D10).
- Jurexio Engine agent-step sub-chains (D11).
- Imported-history segments for DataMigrate (D12).
- Native SOC 2 evidence view and tool-neutral evidence export (D13).
- Continuous chain verification and tamper alerts.

### v1.0 scope — out

Deferred items and their release triggers are listed in Section 7.

## Section 2 — User stories

### US-09-01 Find any event fast

As a **Compliance Officer**, I need to find any event in my tenant and jurisdictions so that I can answer an auditor, regulator or partner immediately.

- Any event is reachable in 3 clicks or fewer from the Ledger home screen.
- Search and filter by matter reference, module, event category, event name, designation, date range and HTIL decision.
- Each result shows its chain position, seal status and anchor receipt status.
- Personal identities appear only as designation titles unless the officer holds identity-resolution rights; every resolution writes `LEDGER.IDENTITY_RESOLVED`.
- The search itself writes `LEDGER.AUDIT_TRAIL_VIEWED`.

### US-09-02 Prove an AI output was human-approved

As a **Partner**, I need to see the full provenance of an AI output so that I can show a client or court exactly how it was produced and who approved it.

- From any AI-generated document, one action opens its provenance: request, every agent step (if authorised under D11), versions, confidence, HTIL gate and approver designation.
- Opening the content re-hashes it in DocVault; a match shows "Content verified", a mismatch blocks display and raises `LEDGER.CONTENT_HASH_MISMATCH`.
- Discarded drafts show "Content destroyed per policy" with the surviving hash.

### US-09-03 Produce a court evidence package

As a **Partner**, I need to export a certified evidence package for one matter so that it can be filed in court without exposing other clients.

- The package contains the matter trail, completeness proof, anchor receipts, content hashes, retrieved documents, a pre-filled certificate in the Jurisdiction Pack's format, and offline verification instructions.
- Nothing is sealed until disclosure review and certification are complete (HTIL gates G-09-02 and G-09-03).
- In India, the two parts of the BSA Section 63 certificate are signed by two different, credential-verified users.
- Events from other matters are never included.

### US-09-04 Honour an erasure request lawfully

As a **Data Protection Officer**, I need to execute or lawfully defer an erasure request so that the firm meets DPDP, GDPR and US state privacy duties without breaking the audit chain.

- The request shows every place the subject's token appears and any hold or retention rule that blocks erasure.
- If blocked, the deferral and its legal reason are recorded and the requester can be told within statutory timelines.
- If permitted, erasure requires HTIL gate G-09-04 and destroys the subject's key; the chain still verifies afterwards.
- A signed certificate of destruction is issued.

### US-09-05 Give an auditor controlled access

As a **Compliance Officer**, I need to give an external auditor time-limited, read-only access so that the SOC 2 or ISO audit runs without standing privileged accounts.

- Access is scoped to stated controls, jurisdictions and dates, and expires automatically.
- Every auditor query is logged; access grant and expiry write `LEDGER.AUDITOR_ACCESS_GRANTED` and `LEDGER.AUDITOR_ACCESS_EXPIRED`.
- Auditors never see matter content, only evidence and event metadata.

### US-09-06 See audit health across all offices

As a **head-office General Counsel**, I need one view of audit health across every location so that I can govern the institution without moving data across borders.

- The view shows per-region aggregates: chain verified, anchoring health, open HTIL items, holds in force, events by category.
- Counts below 5 show as "<5".
- Drill-down into a region requires access granted in that region; every federated query writes `LEDGER.FEDERATED_QUERY_EXECUTED` in each region it touched.

### US-09-07 Bring legacy history across honestly

As an **IT Director**, I need legacy audit history imported with clear provenance so that pre-migration evidence survives without weakening the native chain.

- Imported records sit in a separate segment, labelled "Imported — source: \[system\]" in every view and export.
- The source export files are kept with their hashes; any gaps in the source are declared.
- The segment is not usable until the IT Director and Compliance Officer sign off (HTIL gate G-09-06).

### US-09-08 Let a client verify their own matter

As a **Partner**, I need to optionally share a curated activity trail with my client so that they can confirm what reached them was human-approved.

- The client trail is off by default; the partner enables it per client.
- Only events flagged client-visible appear, with designation titles, never names.
- Enabling and disabling write `LEDGER.CLIENT_TRAIL_ENABLED` and `LEDGER.CLIENT_TRAIL_DISABLED`.

## Section 3 — Key user flows

### HTIL gate register

Every human gate in M09 is defined with its type, approver role and Ledger events, closing the recurring P0 defect seen in M01 and M05. All approvers must hold a verified professional credential where the role requires one (FLAG-004). Gate classes are listed under Consolidation v1.1 in Document control; the locked same-actor guard governs AI output approval.

| Gate | Decision | Gate type | Approver role | Ledger events |
| --- | --- | --- | --- | --- |
| G-09-01 | Apply or release a litigation / regulatory hold | Single approver | Responsible Partner or Compliance Officer | `LEDGER.HOLD_APPLIED`, `LEDGER.HOLD_RELEASED` |
| G-09-02 | Disclosure review of an evidence package | Single approver | Responsible Partner | `LEDGER.EXPORT_DISCLOSURE_APPROVED`, `LEDGER.EXPORT_DISCLOSURE_REJECTED` |
| G-09-03 | Certification of an evidence package | Two distinct signatories (India); one qualified certifier (US) | India: person in charge of the system + expert. US: qualified custodian, eligible roles defined per state Jurisdiction Pack (OQ-09-08) | `LEDGER.EXPORT_CERTIFIED` (per signatory), `LEDGER.EXPORT_SEALED` |
| G-09-04 | Execute erasure by crypto-shredding | Single approver | Data Protection Officer or Compliance Officer | `LEDGER.ERASURE_APPROVED`, `LEDGER.SUBJECT_KEY_SHREDDED` |
| G-09-05 | Dispose of payloads at retention expiry | Single approver | Compliance Officer | `LEDGER.RETENTION_DISPOSAL_APPROVED`, `LEDGER.PAYLOAD_DISPOSED` |
| G-09-06 | Accept an imported-history segment | Dual sequential | IT Director, then Compliance Officer | `LEDGER.IMPORT_SEGMENT_SIGNED_OFF` (per signatory) |
| G-09-07 | Disposition of a chain-break incident | Dual distinct | Tenant Compliance Officer and tenant IT Director (Jurexio only under client-granted support access, G-11-09) | `LEDGER.CHAIN_BREAK_ACKNOWLEDGED`, `LEDGER.INCIDENT_CLOSED` |
| G-09-08 | Enable or disable a client's audit trail | Single approver | Responsible Partner | `LEDGER.CLIENT_TRAIL_ENABLED`, `LEDGER.CLIENT_TRAIL_DISABLED` |
| G-09-09 | Grant external auditor access | Single approver | Compliance Officer | `LEDGER.AUDITOR_ACCESS_GRANTED` |
| G-09-10 | Add, change or deprecate an event type in the registry | Dual distinct | Jurexio CTO and Jurexio Compliance | `LEDGER.REGISTRY_CHANGE_APPROVED`, `LEDGER.EVENT_TYPE_REGISTERED`, `LEDGER.EVENT_TYPE_DEPRECATED` |
| G-09-11 (retired) | Retired (C-08): break-glass database access is approved through CommandCentre G-11-11 | Dual distinct | Two named Jurexio security officers, through G-11-11 | `LEDGER.BREAK_GLASS_REQUESTED`, `LEDGER.BREAK_GLASS_APPROVED`, `LEDGER.BREAK_GLASS_CLOSED` |

The litigation-hold-agent may **suggest** a hold. It can never apply one; only G-09-01 applies a hold.

### Flow F1 — Event write and seal (every module)

- **Entry:** any user or system action in any of the 14 modules.
- **Step 1:** the module writes its business change and the Ledger event to the outbox in one database transaction. If either fails, both roll back.
- **Step 2:** the registry validates the event name, category and schema version. Unregistered events are rejected and `LEDGER.REGISTRY_EVENT_REJECTED` is raised to the owning module's on-call.
- **Step 3:** personal identifiers are replaced by tokens from `nv_pii_vault`.
- **Step 4:** the relay appends the event to the tenant-and-jurisdiction chain in order, computing the chain hash and the matter-index link.
- **Step 5 (critical classes only):** the originating action stays held until the event is sealed and an immediate anchor receipt is requested; then the action is released.
- **Output:** a sealed, ordered, verifiable event.
- **Ledger events:** the originating module's event; `LEDGER.ANCHOR_RECEIPT_RECORDED` at each anchor.
- **HTIL gate:** none. This flow is mechanical.
- **Primary act:** none for users; the user experiences no delay except on critical actions, which show "Sealing…" until released.

The six critical event classes are: HTIL approvals and rejections; release of AI output to a user or client; deletion and crypto-shredding; litigation hold changes; admin, role and permission changes; court-facing exports.

> **Diagram:** Flow F1 · event write and seal — rendered in the source Claude Doc: https://claude.ai/code/artifact/44b66db8-166f-40dd-8be1-7fc05d7f7de4

No action exists without its event; the six critical classes wait for sealing and an immediate anchor before release.

### Flow F2 — Continuous verification and tamper response

- **Entry:** scheduled verification, on-read verification, or an anchor mismatch.
- **Step 1:** the verifier recomputes the chain from the last verified checkpoint and compares chain heads with timestamp receipts.
- **Step 2:** on success it writes `LEDGER.CHAIN_VERIFIED`.
- **Step 3:** on mismatch it writes `LEDGER.CHAIN_BREAK_DETECTED`, freezes exports for that chain, and alerts the tenant Compliance Officer and IT Director (and Jurexio platform operations, metadata only) through PulseComms.
- **Step 4:** the tenant Compliance Officer and IT Director investigate and record the disposition through gate G-09-07.
- **Output:** a verified chain, or a documented incident.
- **Primary act:** the Compliance Officer reads the break report (first bad position, last good anchor, affected matters) and acknowledges it.

### Flow F3 — Court evidence export

- **Entry:** a Partner selects "Prepare evidence package" on a matter.
- **Step 1:** M09 assembles the matter trail, completeness proof, anchor receipts, content hashes and DocVault content, and pre-fills the certificate in the Jurisdiction Pack's format. Writes `LEDGER.EXPORT_REQUESTED`.
- **Step 2:** the Partner reviews every item for disclosure, confirming no unrelated privileged material is included (gate G-09-02).
- **Step 3:** the required signatories review and sign (gate G-09-03).
- **Step 4:** M09 seals the package with the jurisdiction's KMS key and the licensed digital signature certificate as a long-term-validation (PAdES-LTA) signature, then anchors it immediately.
- **Output:** a sealed package with offline verification instructions.
- **Primary act:** the Partner reads the package inline, item by item, in a three-panel view (contents list, item viewer, disclosure checklist) before approving. A rejection needs a written reason of at least 50 characters.

### Flow F4 — Erasure request

- **Entry:** a data-subject request logged by the Data Protection Officer.
- **Step 1:** M09 resolves the subject's token footprint and checks holds and retention rules. Writes `LEDGER.ERASURE_REQUESTED`.
- **Step 2a (blocked):** writes `LEDGER.ERASURE_DEFERRED` with the lawful reason and the date it can be re-assessed.
- **Step 2b (permitted):** the approver authorises through gate G-09-04; the subject's key is destroyed.
- **Step 3:** a signed certificate of destruction is issued, stating the date the last key backup expires; `LEDGER.ERASURE_COMPLETED` is written on that date. The chain is re-verified.
- **Output:** erasure or a documented lawful deferral.
- **Primary act:** the approver reads the footprint and hold check summary before confirming an irreversible action, with a typed confirmation of the subject reference.

### Flow F5 — Retention expiry

- **Entry:** the retention scheduler finds events whose Jurisdiction Pack period has lapsed.
- **Step 1:** it excludes anything under hold and writes `LEDGER.RETENTION_EXPIRY_PROPOSED`.
- **Step 2:** the Compliance Officer reviews the batch and approves through gate G-09-05.
- **Step 3:** event payloads are crypto-shredded; chain entries remain with the status "disposed per retention". A certificate of destruction is issued.
- **Output:** lawful disposal with a verifiable chain.
- **Primary act:** the Compliance Officer reads the batch grouped by matter and record type before approving.

### Flow F6 — Legacy history import (with DataMigrate)

- **Entry:** a DataMigrate run reaches the audit-history step.
- **Step 1:** source export files are hashed and stored in CloudVault; records are loaded into a new imported-history segment, labelled with source system, export date and batch. Writes `LEDGER.IMPORT_SEGMENT_CREATED`.
- **Step 2:** gaps in the source are listed in the segment's import record.
- **Step 3:** the IT Director, then the Compliance Officer, sign off (gate G-09-06). One native event links the native chain to the segment's hash.
- **Output:** an attested, clearly labelled legacy segment.
- **Primary act:** the signatories read the import record, including declared gaps, before signing.

### Screen inventory for UX (FLAG-007)

Each screen names the primary act the user performs on it, not just the data it displays.

| Screen | Flow / gate | Primary act |
| --- | --- | --- |
| SCR-09-01 Ledger home and event search | US-09-01, F2 | Find an event in 3 clicks or fewer and read its seal and anchor status |
| SCR-09-02 Event detail and AI provenance | US-09-02 | Read the provenance chain and open verified content |
| SCR-09-03 Chain health | F2 | Read verification and anchoring health per chain |
| SCR-09-04 Chain-break incident review | F2, G-09-07 | Read the break report and record disposition |
| SCR-09-05 Evidence package builder (three panels) | F3, G-09-02 | Read each item inline and approve or reject disclosure |
| SCR-09-06 Certification and signing | F3, G-09-03 | Read the pre-filled certificate and sign |
| SCR-09-07 Erasure workspace | F4, G-09-04 | Read the footprint and hold check, then shred or defer |
| SCR-09-08 Retention and holds console | F5, G-09-01, G-09-05 | Review disposal batches and apply or release holds |
| SCR-09-09 Imported-history review | F6, G-09-06 | Read the import record and declared gaps, then sign off |
| SCR-09-10 Institution view (federated) | US-09-06 | Read regional aggregates and request in-region drill-down |
| SCR-09-11 Auditor access and SOC 2 evidence | US-09-05, G-09-09 | Grant scoped access and review control evidence |
| SCR-09-12 Event registry | G-09-10 | Review and approve registry changes |
| SCR-09-13 Break-glass access | G-11-11 (was G-09-11) | Request, approve and review emergency database access |
| SCR-09-14 Client trail settings | US-09-08, G-09-08 | Enable or disable a client's curated trail |

The client-facing trail itself is a ClientBridge (M08) screen fed by M09.

## Section 4 — Data architecture

### Inputs

| Source | What enters |
| --- | --- |
| All 14 modules (outbox) | Business events in the registered schema |
| Jurexio SDK base chain (`nv-ironledger.ts`, renamed before Sprint 1 per D-03; final name set by the CTO) | SDK-level audit events, extended with Jurexio enterprise fields |
| Jurexio Engine (M03) | Request, agent-step and HTIL events (D11) |
| `nv_pii_vault` | Tokens replacing personal identifiers |
| CommandCentre (M11) | `genesis_chain_id`, role and permission references, credential status, auditor and role grants |
| Jurisdiction Packs | Retention tables, certificate templates, evidence-regime rules |
| DocVault (M02) | Content hashes for re-hash verification |
| DataMigrate (M14) | Legacy audit records and source export hashes |
| Timestamp authorities | RFC 3161 receipts |

### Outputs

| Destination | What exits |
| --- | --- |
| Compliance views (M09 screens) | Event search, provenance, verification status |
| Courts and regulators | Sealed evidence packages (never live access) |
| ClientBridge (M08) | Curated client trail, if enabled |
| RegRadar (M07) | Compliance signals: HTIL coverage, hold status, verification health |
| PulseComms (M12) | Alerts: chain break, anchor failure, pending gates |
| NexusConnect (M10) | Evidence-only SOC 2 feed (no events, tokens or personal data) |
| Timestamp authorities | Chain-head hashes only |

### Event schema (every event)

| Field | Purpose |
| --- | --- |
| `event_id` | Unique, time-ordered identifier |
| `schema_version` | Registry schema version |
| `chain_id`, `seq_no` | Position in the tenant-and-jurisdiction chain |
| `prev_hash`, `event_hash` | SHA-256 chain linkage |
| `matter_id`, `matter_seq`, `matter_prev_hash` | Per-matter index and completeness proof (null for matter-less events) |
| `tenant_id`, `jurisdiction_code`, `location_code` | Ownership and residency |
| `event_name`, `category`, `module` | `DOMAIN.EVENT_NAME`, one of 12 categories, source module |
| `actor_token`, `actor_designation`, `role_permission_ref` | Pseudonymised actor; designation in plain text |
| `request_id`, `agent_id`, `agent_version`, `model_version` | AI provenance (Jurexio Engine events) |
| `payload_hashes`, `content_pointer` | Hashes and DocVault pointers only |
| `htil_gate_id`, `htil_decision` | Gate and outcome, where applicable |
| `critical`, `sealed_at`, `anchor_receipt_id` | Critical-class handling and anchoring |
| `retention_class`, `hold_ids` | Retention and hold control |
| `kms_key_id` | Jurisdiction key, key version and hash algorithm used (crypto-agility) |
| `billing_code`, `conflict_check_status`, `matter_budget_status` | Enterprise fields carried over from the SDK extension |
| `occurred_at` | Time the action happened (synchronised clock) |

### M09's own events

| Area | Events |
| --- | --- |
| Chain integrity | `LEDGER.CHAIN_GENESIS_CREATED`, `LEDGER.CHAIN_VERIFIED`, `LEDGER.CHAIN_BREAK_DETECTED`, `LEDGER.CHAIN_BREAK_ACKNOWLEDGED`, `LEDGER.INCIDENT_CLOSED`, `LEDGER.CHAIN_REANCHORED` |
| Anchoring | `LEDGER.ANCHOR_RECEIPT_RECORDED`, `LEDGER.ANCHOR_FAILED` |
| Registry | `LEDGER.REGISTRY_CHANGE_APPROVED`, `LEDGER.EVENT_TYPE_REGISTERED`, `LEDGER.EVENT_TYPE_DEPRECATED`, `LEDGER.REGISTRY_EVENT_REJECTED` |
| Access | `LEDGER.AUDIT_TRAIL_VIEWED`, `LEDGER.IDENTITY_RESOLVED`, `LEDGER.AUDITOR_ACCESS_GRANTED`, `LEDGER.AUDITOR_ACCESS_EXPIRED`, `LEDGER.FEDERATED_QUERY_EXECUTED`, `LEDGER.FEDERATED_QUERY_REFUSED`, `LEDGER.CLIENT_TRAIL_ENABLED`, `LEDGER.CLIENT_TRAIL_DISABLED` |
| Privileged access | `LEDGER.BREAK_GLASS_REQUESTED`, `LEDGER.BREAK_GLASS_APPROVED`, `LEDGER.BREAK_GLASS_CLOSED` |
| Content integrity | `LEDGER.CONTENT_VERIFIED`, `LEDGER.CONTENT_HASH_MISMATCH` |
| Exports | `LEDGER.EXPORT_REQUESTED`, `LEDGER.EXPORT_DISCLOSURE_APPROVED`, `LEDGER.EXPORT_DISCLOSURE_REJECTED`, `LEDGER.EXPORT_CERTIFIED`, `LEDGER.EXPORT_SEALED`, `LEDGER.EXPORT_RETIMESTAMPED`, `LEDGER.EVIDENCE_FEED_EMITTED` |
| Erasure | `LEDGER.ERASURE_REQUESTED`, `LEDGER.ERASURE_DEFERRED`, `LEDGER.ERASURE_APPROVED`, `LEDGER.SUBJECT_KEY_SHREDDED`, `LEDGER.ERASURE_COMPLETED` |
| Retention and holds | `LEDGER.RETENTION_EXPIRY_PROPOSED`, `LEDGER.RETENTION_DISPOSAL_APPROVED`, `LEDGER.PAYLOAD_DISPOSED`, `LEDGER.HOLD_APPLIED`, `LEDGER.HOLD_RELEASED` |
| Legacy import | `LEDGER.IMPORT_SEGMENT_CREATED`, `LEDGER.IMPORT_SEGMENT_SIGNED_OFF` |

### Storage

- PostgreSQL, append-only: no update or delete privileges on event tables for any role, including administrators.
- Partitioned by year within each chain; row-level security by tenant.
- Each jurisdiction runs its own database in its own region; there is no global Ledger database.

### Data residency

| Jurisdiction | Region | Key | What may leave the region |
| --- | --- | --- | --- |
| India (all states and UTs) | AWS ap-south-1 | India KMS key | Chain-head hashes to the timestamp authority; aggregate counts to federated views |
| United States (all states) | AWS us-east-1 | US KMS key | Same as above |
| Further jurisdictions | Set by each Jurisdiction Pack | One signing key per jurisdiction (data encryption per CloudVault, C-10) | Same as above |

Event records, tokens, matter identifiers and personal data never leave their home region.

**Chain routing rule:** an event on a matter always goes to the chain of the matter's home jurisdiction, wherever the acting user sits. Events with no matter (logins, admin, security) go to the chain of the user's location.

### Availability, recovery and degraded mode

The Ledger blocks critical actions platform-wide when it is down, so it runs to a stricter standard than the tenant-level DR plan.

- **Dedicated tier:** the Ledger runs on its own high-availability database tier in each region, across multiple availability zones, separate from module databases.
- **Data loss:** zero loss of sealed events. Synchronous replication inside the region before a seal is confirmed.
- **Recovery time:** the Ledger is CloudVault Tier 0: no loss of sealed events, back within 1 hour, 4 hours on region loss (C-09, closes OQ-09-04). These are internal targets until proven by drills and are never quoted to clients before drill evidence exists.
- **Degraded mode:** if the chain cannot seal, routine actions continue and their events wait safely in each module's outbox. Critical actions are held with a visible "Awaiting seal" status and are released in order once sealing resumes. No critical action is ever released unsealed.
- **Capacity:** sealing latency, throughput per chain and outbox depth are monitored; thresholds are set by the CTO and alert through PulseComms.

### Cryptography and key management

- **Tokens:** random, never derived from the personal data they replace.
- **Keyed hashes:** short or guessable fields (phone numbers, IDs, names) use HMAC with a separate key per tenant, so a hash cannot be reversed by guessing. Document content uses SHA-256.
- **Subject keys and backups:** per-subject keys live in a dedicated key store, excluded from general database backups and point-in-time recovery. The key store keeps its own short backup window. A certificate of destruction states the date on which the last backup holding the key expires, and erasure is reported as complete only from that date.
- **Long-term signature validity:** evidence packages use long-term-validation signatures (PAdES-LTA), embedding timestamps and certificate-revocation data so a signature stays verifiable after the signing certificate expires. Packages are re-timestamped before their timestamp certificates expire, for as long as retention requires.
- **Crypto-agility:** every event records its hash algorithm and key version. If an algorithm weakens, chains are re-anchored with a stronger algorithm under a documented, CTO-approved procedure, without altering original events.
- **Key rotation:** KMS keys rotate on a schedule set by the CTO; older key versions remain available for verification only.

### Privileged access (break-glass)

- No standing human access to Ledger databases, including administrators.
- Emergency access needs dual approval through CommandCentre gate G-11-11 (two named Jurexio security officers without deploy rights; tenant notice), is time-limited, is session-recorded, and is logged in a separate system outside the Ledger database.
- Every break-glass session triggers a mandatory Compliance Officer review, and the next anchoring cycle verifies the chain.

### Federated query protections

- Counts below 5 are shown as "<5" (OQ-09-03).
- Query rate limits per user, and refusal of near-duplicate queries that differ only slightly, prevent working out a small number by comparing overlapping results.
- Unusual query patterns raise an alert to the Compliance Officer of each affected region.

## Section 5 — Compliance requirements

### Regulations and how M09 satisfies them

| Regulation / standard | Requirement | How M09 satisfies it |
| --- | --- | --- |
| SOC 2 Type II (CC6, CC7, CC8, CC9) | Evidence of access control, operations monitoring, change management and risk mitigation over time | Every access, admin, role, permission and configuration change is a sealed event; native evidence view; continuous verification (D1, D13) |
| ISO/IEC 27001:2022, Annex A 8.15–8.17 | Logging, monitoring, clock synchronisation | Append-only logging, tamper alerts, synchronised `occurred_at` |
| ISO/IEC 42001:2023 | Traceability and event logging of AI systems | Agent-step sub-chains with pinned versions (D11) |
| EU AI Act, Articles 12 and 14 (architecture-ready) | Automatic logging; effective human oversight of high-risk AI | D11 logging; every HTIL decision sealed and anchored |
| DPDP Act 2023 and DPDP Rules 2025 (India) | Security safeguards, retention of processing logs, erasure rights | Encrypted, region-resident logs; crypto-shredding with lawful deferral (D6, D7) |
| GDPR (EU, architecture-ready) | Storage limitation, data minimisation, right to erasure, security | Pseudonymisation, pack-driven retention, crypto-shredding |
| CCPA/CPRA and other US state privacy laws | Consumer deletion rights with legal-obligation exceptions | Same erasure flow; exceptions applied through holds and retention rules in each state pack |
| Bharatiya Sakshya Adhiniyam 2023, Section 63 | Certificate for electronic records, two signed parts | Evidence package with two distinct, credential-verified signatories (D10, G-09-03) |
| FRE 901, 902(13), 902(14) | Authentication of electronic records and hash-verified data | Certified package with hash proofs and anchor receipts |
| IT Act 2000 (India) | Legal recognition of digital signatures from licensed Certifying Authorities | Licensed digital signature certificate on court-facing exports (R2) |
| ABA Model Rules 1.1, 1.6(c), 5.1, 5.3 and Formal Opinion 512 | Competence, confidentiality, supervision of AI | Provenance view per AI output; hash-only AI events; HTIL records |
| Bar Council of India rules on professional conduct | Confidentiality and professional responsibility | No privileged content in the Ledger; designation-only views; matter-scoped exports |
| State bar record-keeping rules (US and India) | Record retention, including trust-account records | Retention tables per state Jurisdiction Pack, longest rule wins (D7) |

### Mandatory HTIL steps (never automated)

- Applying or releasing a litigation or regulatory hold (G-09-01).
- Approving disclosure and certifying any court evidence package (G-09-02, G-09-03).
- Executing any erasure or retention disposal (G-09-04, G-09-05).
- Accepting imported legacy history (G-09-06).
- Closing a chain-break incident (G-09-07).
- Granting client-trail or external-auditor access (G-09-08, G-09-09).
- Changing the event registry (G-09-10).
- Approving break-glass database access (G-11-11).

### Decisions that must remain human

- Whether a record is relevant to a legal claim, investigation or hold.
- Whether an erasure request is lawfully refused or deferred.
- What is disclosed to a court, regulator or opposing party.
- Signing any evidentiary certificate. M09 may prepare it; it can never certify itself.
- The cause and remedy of a chain break.

### Approved claims language

Until the India and US admissibility opinions are received (D14), all materials say "engineered to support admissibility under BSA s.63 and FRE 902(13)/(14)". The terms "court-admissible" and "legally certified" are prohibited.

## Section 6 — Module dependencies

### Upstream (M09 depends on)

| Dependency | What M09 needs |
| --- | --- |
| CommandCentre (M11) | `genesis_chain_id` per org and jurisdiction; permission catalogue and role assignments; credential verification status; role and access grants |
| Jurexio SDK base chain | Hash-chain foundation and enterprise-field extension |
| `nv_pii_vault` | Tokenisation and per-subject keys (flagged P0 gap in the CTO Mapping) |
| AWS KMS | One signing key per jurisdiction, provisioned in-region (data encryption follows the CloudVault key hierarchy, C-10) |
| Jurisdiction Packs | Retention tables, certificate templates, evidence-regime rules |
| DocVault (M02) | Content storage and re-hash endpoint |
| CloudVault (M13) | Storage of evidence packages and legacy source files; certificate of destruction |

### Downstream (depend on M09)

- **All 14 modules:** cannot commit a business action without its Ledger event (D1).
- **Jurexio Engine (M03):** HTIL decisions and AI releases are critical events and wait for sealing.
- **DataMigrate (M14):** imported-history segments and chain-of-custody events; its 18 events must be registered.
- **RegRadar (M07):** compliance signals and audit evidence.
- **ClientBridge (M08):** curated client trail.
- **PulseComms (M12):** integrity and gate alerts.
- **NexusConnect (M10):** evidence-only SOC 2 feed.

### External integrations for v1.0

| Integration | Purpose |
| --- | --- |
| PostgreSQL (per region) | Ledger storage |
| AWS KMS (per region) | Signing and encryption keys |
| RFC 3161 timestamp authority, India | Licensed Certifying Authority under the IT Act |
| RFC 3161 timestamp authority, US | Commercial timestamp provider |
| Licensed digital signature certificate providers (India and US) | Court-facing export signatures |

### Jurexio SDK and agent touchpoints

| Agent | Role in M09 | Boundary |
| --- | --- | --- |
| audit-agent | Assembles evidence packages and verification reports | Prepares only; cannot seal or certify |
| litigation-hold-agent | Suggests holds from matter signals | Suggests only; holds apply through G-09-01 |
| data-retention-compliance-agent | Proposes retention expiry batches | Proposes only; disposal through G-09-05 |

Any agent output inside M09 is itself logged and passes the relevant human gate. No agent decision is ever final.

## Section 7 — v1.0 scope vs deferred scope

The v1.0 feature list is in Section 1. Everything below is deliberately excluded from v1.0 and ships only when its trigger is met.

### v1.0 build increments

All of v1.0 is in scope. It is built in two increments so that the parts every other module depends on are not delayed by the services that come later.

| Increment | Contents | Needed by |
| --- | --- | --- |
| Ledger Core | Outbox and critical-event sealing; chains and matter index; event registry with G-09-10; tokenisation and keyed hashes; continuous verification and tamper alerts (F2, G-09-07); RFC 3161 anchoring; dedicated availability tier and degraded mode; break-glass control (G-11-11); SCR-09-01 to SCR-09-04, SCR-09-12, SCR-09-13 | Sprint 1, alongside CommandCentre. Every module depends on it. |
| Ledger Services | Evidence packages and certification (F3); erasure (F4); retention and holds (F5); legacy import (F6); federated view; auditor access and SOC 2 evidence view; client trail; remaining screens | Delivered before the first module that needs each service: legacy import before DataMigrate, client trail before ClientBridge, evidence packages before the first client go-live |

### Release testing

Neither increment is released until these pass:

- **Tamper-injection tests:** altered, deleted, reordered and inserted events are each detected and raise `LEDGER.CHAIN_BREAK_DETECTED`.
- **Anchoring-failure drills:** loss of the timestamp authority triggers `LEDGER.ANCHOR_FAILED`, alerts, and catches up correctly when restored.
- **Degraded-mode drills:** routine actions continue, critical actions hold, and nothing is released unsealed.
- **Crypto-shred restore tests (Services):** restoring a database backup after erasure cannot recover the shredded data.
- **Failover tests:** zero loss of sealed events; recovery within the CTO's target.
- **Evidence package verification (Services):** an independent party verifies a package offline with the published instructions.
- **SOC 2 evidence dry run:** the auditor shortlist reviews the evidence view before the observation window starts.

### Deferred scope

| Feature | Release trigger | Reason for deferral |
| --- | --- | --- |
| Direct connector to Vanta or Drata | SOC 2 vendor selected (D13, 30-day deadline) | Avoid building for an unchosen vendor; evidence export already covers the need |
| Direct filing of evidence packages to court systems | Court API registration completed (eCourts, PACER and others are stubs today) | No registered court APIs; packages are filed manually meanwhile |
| Inbound API for external audit and GRC tools | NexusConnect inbound API activated | No open partner API in v1.0 (M10 R1); v1.0 evidence leaves as a tool-neutral export file (C-16) |
| Ledger screens on mobile | Mobile security review approved and client demand confirmed | Evidence and certification work needs a desktop; alerts reach mobile through PulseComms |
| Activation of jurisdictions beyond India and the US | Jurisdiction Pack built, reviewed by local counsel and approved | Architecture supports it; legal content must be validated first |
| Translated evidence packages (e.g. Hindi for district courts) | Certified-translation workflow approved | Platform language is English; translations need certified human translators |
| AI-assisted anomaly detection on Ledger activity | ISO 42001 risk assessment and HTIL design for anomaly flags completed | Any AI inside the audit core must itself be governed before release |

### Rejected (not deferred)

| Option | Reason |
| --- | --- |
| Amazon QLDB | AWS end of support (R1) |
| Public blockchain anchoring | Court, bar council and government acceptance risk; crypto-asset regulatory questions (D3) |
| Automatic certification of evidence | Legally invalid; prohibited by the AI doctrine (D10) |
| Privileged content stored in Ledger events | Privilege and erasure risk (D5) |

## Section 8 — Open questions and blockers

### Decisions requiring Chairman or CTO input

| # | Question | Owner | Recommendation |
| --- | --- | --- | --- |
| OQ-09-01 | Does the Ledger rename extend to code identifiers (`jrx-ironledger`, `nv-ironledger.ts`)? | Chairman | Yes, consistent with the Jurexio Engine rename; rename before Sprint 1 code is written |
| OQ-09-02 | Which role holds identity-resolution rights (seeing who a token is)? | Chairman | Compliance Officer and DPO only, every resolution logged |
| OQ-09-03 | Confirm the small-count suppression threshold for federated views | Chairman | 5 |
| OQ-09-04 | Recovery-time target, sealing latency and per-chain throughput for the Ledger tier | CTO | Set from load and failover testing; recovery in hours, not days |
| OQ-09-05 | Approved clock source for `occurred_at` | CTO | Region-local time service, recorded in each event |
| OQ-09-06 | Who qualifies as the "expert" signatory for BSA s.63 Part B inside a client firm | Indian counsel (D14) | Await the opinion; template stays configurable per pack |
| OQ-09-07 | Which event types are client-visible in the curated trail | Legal counsel | Allow-list approved by counsel before ClientBridge build |
| OQ-09-08 | Which roles qualify as the US "qualified custodian" for FRE 902(13)/(14) certification, per state | US counsel (D14), Raja Sekhar T | Define per state pack after the US opinion |
| OQ-09-09 | Backup window for the subject key store, and KMS key-rotation schedule | CTO | Shortest window compatible with recovery; stated on every certificate of destruction |

### Compliance validations pending

- [ ] India admissibility opinion: BSA s.63 procedure, signatories, timestamp receipts, effect of crypto-shredding, BCI implications (Chairman to commission).
- [ ] US admissibility opinion: FRE 902(13)/(14) and a sample of state evidence rules (Chairman to commission).
- [ ] Confirmation that crypto-shredding satisfies erasure duties under DPDP and US state privacy laws (counsel).
- [ ] Retention tables and certificate templates for every US and Indian state pack (Raja Sekhar T).

### Items blocking engineering start

- [ ] Chairman approval of this specification.
- [ ] Event registry v1: all existing events renamed to `DOMAIN.EVENT_NAME` with alias period, plus the 18 DataMigrate events (Vamsi).
- [ ] CommandCentre (M11) frozen for `genesis_chain_id`, permissions and credential verification (built alongside M09 in Sprint 1).
- [ ] `nv_pii_vault` built with per-subject keys (P0 gap).
- [ ] AWS KMS keys provisioned in ap-south-1 and us-east-1.
- [ ] Timestamp authority and digital signature certificate providers contracted for India and the US (procurement).
- [ ] OQ-09-01 decided (affects repository and package names).

### Housekeeping

- [ ] Remove "Section 65B" and "court-admissible" from every demo and marketing asset.
- [ ] Mark OQ-02 and OQ-03 closed in the UX open-decisions register.
