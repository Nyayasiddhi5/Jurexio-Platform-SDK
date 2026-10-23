<!-- Source of truth: https://claude.ai/code/artifact/75d5c117-1769-47f7-b9a2-700a987f520f · exported 21 Oct 2026 · do not edit here; edit the Claude Doc and re-export -->

# Module Specification — M14 DataMigrate

Oct 15, 2026 · @Suresh Singh

## Document control

| Field | Value |
| --- | --- |
| Module | M14 DataMigrate |
| Spec version | v1.1, consolidated after the PDD Review Log (18 Oct 2026); draft for Chairman approval |
| Design order | 2 of 14 |
| Engineering owner | CTO (Vamsi) |
| Jurisdiction Pack inputs | Raja Sekhar T (retention, trust-account rules) |
| Status | Sign-off deferred to the consolidated end review. No engineering start before sign-off. |

This specification implements decisions the Chairman locked on 15 October 2026, plus the earlier FLAG-012 decisions. They are referenced below by ID and not reopened.

| ID | Locked decision |
| --- | --- |
| R1 | v1.0 sources: CSV/Excel, file-system documents, Clio, iManage. Other sources ship when a signed client needs them. |
| R2 | NexusConnect owns connector plumbing (registry, credentials, authentication, circuit breakers); DataMigrate owns migration logic. Connectors archived and credentials destroyed after cutover. |
| R3 | Sales message: "verified, reversible migration". Time ranges quoted only after the data audit. "48 hours" retired. |
| D1 | AI assistance approved by risk tier. AI can never lower privilege; unmarked documents import as privileged pending review. |
| D2 | A human approves every client merge. Mandatory conflict sweep; unresolved hits block cutover. |
| D3 | Destination jurisdiction decided before extraction; in-region staging; mixed instances split; unclassifiable records quarantined; repatriation logged. |
| D4 | Every record imported, remediated, or excluded with approval. Count must reconcile before cutover. |
| D5 | Parallel run: legacy authoritative, one-way sync, Jurexio read-only for matter data, freeze and final delta at cutover. |
| D6 | Full rollback before cutover; fixed post-cutover window with roll-forward export; Ledger never rolled back. |
| D7 | Client-granted, project-scoped, time-limited operator access; metadata by default; data processing agreement first. |
| D8 | Client money: opening balances, three-way reconciliation as hard blocker, finance owner and partner sign-off. |
| D9 | Source export under Jurisdiction Pack retention; decommissioning readiness certificate; client performs shutdown. |
| D10 | Six evidence-backed Board pre-conditions, API-enforced, no overrides. |
| D11 | Ten-state lifecycle plus two terminal outcomes as design baseline; CTO confirms. |
| FLAG-012 | Own design page; Board and CEO approvals as two separate confirmed actions; IT Director signs before the Board; failed dry run is a hard API block; desktop-only, mobile alerts via PulseComms. |
| Locked earlier | Import order: organisations, users, clients/entities, matters, documents, communications, financial data. Modes: SMB, mid-market, enterprise. SHA-256 chain of custody. |

### Consolidation v1.1 (PDD Review Log, 18 Oct 2026)

**Platform rules applied to this specification**

- **Gate outcomes (CB-ENG-06, CB-DES-05):** every gate records approved, rejected and withdrawn outcomes as Ledger events; rejection needs a reason; the gate engine generates the `_REJECTED` and `_WITHDRAWN` event names into Event registry v1. Every gate screen shows pending, approved, rejected and withdrawn.
- **Gate classes (I-05):** GUARDED = the requester can never approve; DUAL = two distinct people; SELF-ATTESTED = an act on one's own record, with reason, evidence and step-up where stated, logged and sampled by Compliance. The locked same-actor guard governs AI output approval, including AI mapping proposals.
- **Approvers (C-02, CB-ENG-04):** numbered RBAC levels are retired; every approver maps to named permissions; the Board, CEO and IT Director roles follow the approver templates per client type (BQ-12).
- **Canonical events (C-07, C-15):** one act produces one canonical event, owned by the module that owns the record, with `migration_project_id` and batch as attributes. `MIGRATE.*` events record project-state changes only.
- **Design order (C-13):** the order specs were designed, not the engineering sequence, which the CTO publishes.
- **Doctrine carried in (CB-DES-01 to CB-DES-04):** cutover and other state gates show disabled with unmet conditions listed for authorised users; status uses Met, Due, At risk, Overdue, Not assessed; the 0.60 mapping threshold matches the platform confidence bands; AI badge on every AI mapping proposal.

**Gate classes in this module**

| Class | Gates |
| --- | --- |
| GUARDED | G-14-02, G-14-03, G-14-04, G-14-05 (decided by the conflicts reviewer, never the requesting or responsible partner), G-14-07 |
| DUAL | G-14-01 (content requests via G-11-09), G-14-06, G-14-08 (sequential), G-14-09, G-14-10, G-14-11 |
| SELF-ATTESTED | None |

**Added gate (C-11)**

| Gate | Decision | Gate type | Approver role | Ledger events |
| --- | --- | --- | --- | --- |
| G-14-11 | Destroy migration staging | Dual distinct, certificate required; holds always win | IT Director and Compliance Officer | `MIGRATE.STAGING_DESTROYED`, with CloudVault `STORAGE.DISPOSAL_CERTIFIED` |

**Module changes**

- **C-06:** operator content access runs through CommandCentre G-11-09: metadata by default; each content request needs a second approver.
- **C-07:** conflict hits and party merges are decided by the conflicts reviewer under MatterCore rules, with canonical `MATTER.*` events.
- **C-10:** staging is encrypted under a per-project, per-purpose key beneath the tenant key, so it can be crypto-shredded at G-14-11.
- **C-15:** clearing privileged-pending documents writes `DOCUMENT.CLASSIFICATION_LOWERED`; `MIGRATE.PRIVILEGE_CLEARED` survives only as a registry alias.
- **CB-ENG-09 (P0):** the 18 provisional events are finalised in Event registry v1 before Sprint 1.
- **CB-ENG-13:** code identifier `jrx-datamigrate`.
- **BQ-12, BQ-13, BQ-14 (accepted):** approver templates per client type with minimums; finance owner defined per state pack; rollback windows 30 days enterprise, 14 mid-market, 7 SMB, extendable by the tenant, never shortened.

## Section 1 — Module identity

| Field | Value |
| --- | --- |
| Module | M14 DataMigrate |
| Tagline | Verified, reversible migration: every record accounted for, nothing live until you sign. |
| Job to be done | Move an institution's legal records from legacy systems into Jurexio with proven completeness, preserved privilege, correct residency and a full chain of custody. |
| Primary users | Client IT Director, Board and CEO approvers, responsible Partner, finance owner, Compliance Officer, Jurexio migration specialists (time-limited) |
| Secondary users | General Counsel (conflict sweep), lawyers reviewing privileged-pending documents after go-live |
| Modes | SMB (self-service, CSV and files), mid-market (connector and staging), enterprise (parallel run) |

### v1.0 scope — in

- Source connectors: CSV/Excel, file-system documents, Clio, iManage (R1), registered through NexusConnect (R2).
- Ten-state migration lifecycle with two terminal outcomes (D11).
- Per-jurisdiction extraction streams, in-region staging, quarantine of unclassifiable records (D3).
- Field mapping templates with AI-suggested mappings and tags, approved by risk tier (D1).
- Privilege mapping that can only raise protection (D1).
- Human-approved client de-duplication and mandatory conflict sweep (D2).
- Validation with record-count reconciliation and severity-based blockers (D4).
- Dry run with hard API block on failure (FLAG-012).
- Parallel run for enterprise mode (D5).
- Client-money opening balances with three-way reconciliation (D8).
- Board pre-condition screen and two-step Board and CEO approval (D10, FLAG-012).
- Cutover, post-cutover rollback window and roll-forward export (D6).
- Imported audit-history segment handed to Jurexio Ledger (M09 D12).
- Decommissioning readiness certificate (D9).
- Client-granted operator access (D7).
- Client-facing migration dashboard and audit report.

### v1.0 scope — out

Deferred items and their triggers are listed in Section 7.

## Section 2 — User stories

### US-14-01 Start a governed migration

As a **client IT Director**, I need to create a migration project with its mode, sources and plan so that the move is controlled from the first step.

- A project cannot leave DRAFT without a mode, a migration plan and a data processing agreement on file.
- Each source is registered as a MIGRATION connector in NexusConnect; credentials never sit in DataMigrate.
- Writes `MIGRATE.PROJECT_CREATED` and `MIGRATE.SOURCE_CONNECTED`.

### US-14-02 Map fields with AI help, safely

As a **client IT Director**, I need AI-suggested mappings I can approve as a template so that large migrations are fast without unreviewed AI decisions.

- AI suggestions show confidence bands; below 0.60 always needs individual review.
- A mapping template takes effect only after human approval (gate G-14-02).
- Document-type and contract tags are approved by sampled review per category, plus full review of low-confidence items.

### US-14-03 Never lose privilege

As a **responsible Partner**, I need privilege preserved or raised, never lowered, so that migration cannot cause a waiver.

- Source-privileged documents always import as privileged.
- Unmarked documents with an AI "not privileged" suggestion import as privileged pending review.
- Only a lawyer can clear a document from privileged pending review, one at a time (gate G-14-04), and each clearance is logged.

### US-14-04 Merge duplicates and clear conflicts

As a **General Counsel**, I need every client merge approved by a person and a conflict sweep of all imported data so that no conflict of interest goes live unseen.

- No merge happens automatically; exact-identifier matches are pre-ticked, fuzzy-name matches never are.
- Merges remain reversible until cutover.
- Any unresolved conflict hit blocks cutover (gate G-14-05).

### US-14-05 Account for every record

As a **client IT Director**, I need every source record traced to its outcome so that "zero data loss" is provable.

- Each record ends as imported, remediated and imported, or excluded with an approved reason (gate G-14-03).
- The reconciliation report shows source = imported + excluded; any mismatch blocks progress.
- Excluded records stay retrievable from the sealed source export.

### US-14-06 Prove client money is intact

As a **finance owner**, I need trust and client-money balances reconciled three ways so that the firm's books match the bank on day one.

- Legacy ledger, Jurexio opening balances and bank statement agree to the cent or rupee, per client and matter.
- Finance owner and responsible Partner sign off (gate G-14-06).
- AI may flag anomalies; it never changes a balance.

### US-14-07 Approve cutover on evidence

As a **Board member**, I need to see six verified pre-conditions with their evidence so that I approve cutover on proof, not trust.

- The approve button stays inactive until all six pre-conditions are Met (it shows disabled, with the unmet conditions listed), enforced at the API.
- Each pre-condition opens its evidence in one click.
- No pre-condition can be overridden on this screen.
- The CEO's separate confirmation shows the same evidence.

### US-14-08 Reverse safely if needed

As a **client IT Director**, I need a defined rollback path after go-live so that a serious defect does not trap the firm.

- Within the rollback window, rollback exports all post-cutover work with hashes before migrated data is retired.
- Post-cutover rollback needs IT Director then Board sign-off (gate G-14-09).
- After the window closes, the decommissioning readiness certificate is issued.

### US-14-09 Control vendor access to our data

As a **client IT Director**, I need to grant Jurexio specialists scoped, time-limited access so that the vendor never holds standing access to privileged data.

- Access is per project, per named specialist, per jurisdiction, with an expiry.
- Content beyond metadata and samples needs a per-request approval by a second approver (DPO or Compliance Officer) through CommandCentre G-11-09 (gate G-14-01, C-06).
- Access ends automatically at cutover or expiry, whichever is first.

## Section 3 — Lifecycle, gates and key user flows

### Migration lifecycle (D11)

Every transition writes a Ledger event. Each jurisdiction stream moves through the lifecycle separately; a project goes LIVE only when every stream is approved.

| # | State | Exit condition |
| --- | --- | --- |
| 1 | DRAFT | Mode, migration plan and data processing agreement on file |
| 2 | CONNECTED | Source registered in NexusConnect; operator access granted (if used) |
| 3 | STAGING | Data extracted per jurisdiction into in-region staging; source export sealed |
| 4 | MAPPING | Mapping template and AI tags approved |
| 5 | VALIDATING | Records reconciled, merges approved, conflict sweep clear, client money reconciled |
| 6 | DRY\_RUN | Dry run passed. A failure returns to MAPPING or VALIDATING (hard block) |
| 7 | PARALLEL\_RUN | Enterprise only: exit criteria met. Skipped in SMB and mid-market |
| 8 | AWAITING\_APPROVAL | IT Director, then Board, then CEO; six pre-conditions Met |
| 9 | LIVE | Cutover executed; rollback window open |
| 10 | CLOSED | Window expired; decommissioning certificate issued; connector archived, credentials destroyed |

> **Diagram:** Migration lifecycle · 10 states, 2 terminal outcomes — rendered in the source Claude Doc: https://claude.ai/code/artifact/75d5c117-1769-47f7-b9a2-700a987f520f

The only path to Live runs through the approval state; a failed dry run always sends the migration back.

**Terminal outcomes:** ROLLED\_BACK (from LIVE inside the window, or from any state before LIVE) and CANCELLED (from any state before LIVE; staging discarded, credentials destroyed, source export retained).

**Rules closing FLAG-012 corrections:** an IT Director rejection must name the state to return to (MAPPING, VALIDATING or DRY\_RUN) with a written reason of at least 50 characters. No role holding only system-administration permissions can move a migration past VALIDATING. A defect found in LIVE escalates through G-14-10; operators cannot patch it quietly.

### HTIL gate register

Gate classes are listed under Consolidation v1.1 in Document control. Approvers needing professional judgement must hold a verified credential (FLAG-004). Event names are provisional until the CTO finalises the registry.

| Gate | Decision | Gate type | Approver role | Ledger events |
| --- | --- | --- | --- | --- |
| G-14-01 | Grant operator access; approve each content request | Single approver | Client IT Director | `MIGRATE.OPERATOR_ACCESS_GRANTED`, `MIGRATE.CONTENT_ACCESS_APPROVED`, `MIGRATE.CONTENT_ACCESS_DENIED` |
| G-14-02 | Approve mapping template; approve tag samples | Single approver | Client IT Director (mappings); designated lawyer (document and contract tags) | `MIGRATE.MAPPING_APPROVED`, `MIGRATE.TAG_SAMPLE_APPROVED` |
| G-14-03 | Exclude a batch of records | Single approver | Responsible Partner or IT Director | `MIGRATE.EXCLUSION_APPROVED` |
| G-14-04 | Clear a document from privileged pending review | Single approver, per document | Credential-verified lawyer | `DOCUMENT.CLASSIFICATION_LOWERED (with migration_project_id)` |
| G-14-05 | Approve or reverse a client merge; resolve a conflict hit | Single approver | General Counsel or Compliance Officer (merges); responsible Partner or General Counsel (conflicts) | `MIGRATE.CLIENT_MERGE_APPROVED`, `MIGRATE.CLIENT_MERGE_REVERSED`, `MIGRATE.CONFLICT_RESOLVED` |
| G-14-06 | Sign off client-money reconciliation | Dual distinct | Finance owner and responsible Partner | `MIGRATE.MONEY_RECONCILIATION_SIGNED` |
| G-14-07 | Classify a quarantined record's jurisdiction | Single approver | Compliance Officer | `MIGRATE.QUARANTINE_RESOLVED` |
| G-14-08 | Approve cutover | Sequential: IT Director, Board, CEO | Named approvers per the migration plan | `MIGRATE.IT_DIRECTOR_APPROVED`, `MIGRATE.IT_DIRECTOR_REJECTED`, `MIGRATE.BOARD_APPROVED`, `MIGRATE.CEO_CONFIRMED` |
| G-14-09 | Roll back after cutover | Sequential: IT Director, Board | Named approvers | `MIGRATE.ROLLBACK_APPROVED`, `MIGRATE.ROLLBACK_EXECUTED` |
| G-14-10 | Decide fix-forward or rollback for a LIVE defect | Dual distinct | IT Director and Compliance Officer | `MIGRATE.DEFECT_ESCALATED`, `MIGRATE.DEFECT_DISPOSITION_RECORDED` |

Acceptance of the imported audit-history segment uses Jurexio Ledger gate G-09-06.

### Board pre-conditions (D10)

All six must be Met, enforced at the API, before the Board approve action activates. Each opens its evidence in one click. None can be overridden.

1. Dry run passed on the final mapping.
2. Integrity verified: 100% hash match from source to staging, and source = imported + excluded.
3. Conflict sweep clear.
4. Client money reconciled three ways and signed off, or "not applicable" recorded.
5. Residency verified: every record in its destination region; quarantine empty or resolved.
6. Governance complete: IT Director approval, imported audit history accepted (G-09-06), and parallel-run exit criteria met for enterprise mode.

### Flow F1 — Set up and connect

- **Entry:** client IT Director selects "Start migration".
- **Steps:** choose mode; attach migration plan and data processing agreement; register sources through NexusConnect; optionally grant operator access (G-14-01).
- **Output:** project in CONNECTED.
- **Ledger events:** `MIGRATE.PROJECT_CREATED`, `MIGRATE.SOURCE_CONNECTED`, `MIGRATE.OPERATOR_ACCESS_GRANTED`.
- **Primary act:** the IT Director reads the access scope (who, which project, which jurisdiction, until when) before granting.

### Flow F2 — Extract and stage by jurisdiction

- **Entry:** project in CONNECTED.
- **Steps:** assign each record's destination jurisdiction before extraction; split mixed instances into streams; extract into in-region staging; seal and hash the source export in CloudVault; quarantine unclassifiable records and resolve them (G-14-07).
- **Output:** streams in STAGING; repatriation logged per stream.
- **Ledger events:** `MIGRATE.STREAM_CREATED`, `MIGRATE.EXTRACTION_COMPLETED`, `MIGRATE.SOURCE_EXPORT_SEALED`, `MIGRATE.REPATRIATION_LOGGED`, `MIGRATE.QUARANTINE_RESOLVED`.
- **Primary act:** the Compliance Officer reads each quarantined record's available evidence and assigns its jurisdiction.

### Flow F3 — Map, tag and protect privilege

- **Steps:** Jurexio Engine suggests mappings and tags; IT Director approves the mapping template; designated lawyer approves tag samples (G-14-02); privilege mapped so it can only rise; unmarked documents flagged privileged pending review.
- **Output:** streams in MAPPING complete.
- **Primary act:** the IT Director reviews each source field against its suggested target and confidence band in a two-column mapping view, editing before approving.

### Flow F4 — Validate and reconcile

- **Steps:** classify every record (imported, remediated, excluded); approve exclusion batches (G-14-03); review and approve merges (G-14-05); run the conflict sweep and resolve hits (G-14-05); reconcile client money three ways (G-14-06).
- **Output:** streams in VALIDATING complete with a reconciled count.
- **Primary act:** the General Counsel reads each conflict hit with both parties' matter context before resolving it.

### Flow F5 — Dry run and parallel run

- **Steps:** run the full migration in a disposable target; a failure blocks progress at the API and returns to MAPPING or VALIDATING. Enterprise mode then runs one-way sync with the legacy system authoritative and Jurexio read-only, until exit criteria are met.
- **Ledger events:** `MIGRATE.DRY_RUN_PASSED`, `MIGRATE.DRY_RUN_FAILED`, `MIGRATE.SYNC_COMPLETED`, `MIGRATE.DISCREPANCY_RESOLVED`.
- **Primary act:** the IT Director reads unexplained discrepancies on the parallel-run dashboard and resolves each.

### Flow F6 — Approve and cut over

- **Steps:** IT Director approves or rejects with a named return state; Board reviews the six pre-conditions and approves; CEO confirms separately (G-14-08); legacy frozen; final delta synced and reconciled to zero; cutover executed and its exact instant recorded.
- **Output:** project LIVE; rollback window opens.
- **Ledger events:** approval events, `MIGRATE.LEGACY_FROZEN`, `MIGRATE.CUTOVER_EXECUTED` (critical class: sealed and anchored before release).
- **Primary act:** each Board member opens the evidence behind each pre-condition before approving.

### Flow F7 — Rollback window and close

- **Steps:** during the window, a defect escalates through G-14-10; rollback, if chosen, needs G-14-09 and produces a roll-forward export with hashes before migrated data is crypto-shredded. When the window expires, the decommissioning readiness certificate is issued, the connector is archived and credentials are destroyed.
- **Ledger events:** `MIGRATE.ROLLBACK_EXECUTED`, `MIGRATE.ROLLFORWARD_EXPORTED`, `MIGRATE.DECOMMISSION_CERTIFIED`, `MIGRATE.CONNECTOR_ARCHIVED`, `MIGRATE.PROJECT_CLOSED`.
- **Primary act:** the IT Director reads the certificate's checklist before downloading it.

### Screen inventory for UX (FLAG-007)

| Screen | Flow / gate | Primary act |
| --- | --- | --- |
| SCR-14-01 Migration dashboard | All | Read project status per stream and open the next required action |
| SCR-14-02 New project and plan | F1 | Choose mode and attach plan and agreement |
| SCR-14-03 Sources and operator access | F1, G-14-01 | Register sources; grant and review operator access |
| SCR-14-04 Extraction and quarantine | F2, G-14-07 | Monitor streams; classify quarantined records |
| SCR-14-05 Field mapping | F3, G-14-02 | Review and edit AI-suggested mappings, then approve |
| SCR-14-06 Tag sample review | F3, G-14-02 | Review tag samples and low-confidence items |
| SCR-14-07 Privileged-pending queue | F3, G-14-04 | Read each document and clear or keep privilege |
| SCR-14-08 Client merge review | F4, G-14-05 | Compare candidate duplicates with evidence and decide |
| SCR-14-09 Conflict sweep | F4, G-14-05 | Read each hit in context and resolve |
| SCR-14-10 Validation and reconciliation | F4, G-14-03 | Read the record count and approve exclusion batches |
| SCR-14-11 Client-money reconciliation | F4, G-14-06 | Compare the three balances per client and sign |
| SCR-14-12 Dry run results | F5 | Read failures and send back to the right state |
| SCR-14-13 Parallel-run dashboard | F5 | Resolve unexplained discrepancies |
| SCR-14-14 IT Director approval | F6, G-14-08 | Approve, or reject with a named return state |
| SCR-14-15 Board pre-conditions and approval | F6, G-14-08 | Open each pre-condition's evidence, then approve |
| SCR-14-16 CEO confirmation | F6, G-14-08 | Confirm on the same evidence |
| SCR-14-17 Cutover monitor | F6 | Watch freeze, final delta and cutover complete |
| SCR-14-18 Rollback window | F7, G-14-09, G-14-10 | Escalate a defect or invoke rollback |
| SCR-14-19 Completion report and certificate | F7 | Read the audit report and download the certificate |
| SCR-14-20 Content access requests (client side) | G-14-01 | Approve or deny each specialist content request |

Existing Figma screen numbers referenced in FLAG-012 (SCR-05a, SCR-06, SCR-09b) map to SCR-14-15, SCR-14-14 and SCR-14-18; UX to confirm (OQ-14-06).

## Section 4 — Data architecture

### Inputs

| Source | What enters |
| --- | --- |
| Legacy sources via NexusConnect | Records and documents from CSV/Excel, file systems, Clio, iManage |
| CommandCentre (M11) | Org, roles, approver identities, credential status, operator access grants |
| Jurexio Engine (M03) | AI mapping and tag suggestions with confidence bands |
| Conflict-check engine (MatterCore, M01) | Conflict sweep results |
| Bank statements (uploaded by finance owner) | Trust and client-money closing balances for reconciliation |
| Jurisdiction Packs | Retention rules, trust-account record rules, routing rules |

### Outputs

| Destination | What exits |
| --- | --- |
| MatterCore, DocVault, BillGuard, DeadlineGuard | Migrated organisations, users, clients, matters, documents, communications, financial opening positions, deadlines — written in the locked import order |
| CloudVault (M13) | Sealed source export with hashes; roll-forward exports |
| Jurexio Ledger (M09) | Every lifecycle event; imported audit-history segment |
| PulseComms (M12) | Approval requests, blockers, mobile alerts |
| Client | Migration plan, validation report, reconciliation report, completion audit report, decommissioning certificate |

### Staging model

- One isolated staging area per jurisdiction stream, inside that jurisdiction's region.
- Staging is never visible to production users and is not a system of record.
- Every staged record carries its source identifier, source hash, destination jurisdiction and current outcome (imported, remediated, excluded, quarantined).
- Staging is destroyed with a certificate when the project reaches CLOSED or CANCELLED; the sealed source export remains under retention (D9).

### Ledger events

All events use the `MIGRATE.` domain, follow the M09 registry, and go through the transactional outbox. Event families:

| Family | Examples |
| --- | --- |
| Lifecycle | `MIGRATE.PROJECT_CREATED`, `MIGRATE.STATE_CHANGED`, `MIGRATE.PROJECT_CANCELLED`, `MIGRATE.PROJECT_CLOSED` |
| Extraction and residency | `MIGRATE.STREAM_CREATED`, `MIGRATE.EXTRACTION_COMPLETED`, `MIGRATE.SOURCE_EXPORT_SEALED`, `MIGRATE.REPATRIATION_LOGGED`, `MIGRATE.RESIDENCY_WRITE_BLOCKED` |
| Mapping and AI | `MIGRATE.MAPPING_APPROVED`, `MIGRATE.TAG_SAMPLE_APPROVED`, `MIGRATE.PRIVILEGE_CLEARED` (registry alias only) |
| Validation | `MIGRATE.EXCLUSION_APPROVED`, `MIGRATE.CLIENT_MERGE_APPROVED`, `MIGRATE.CONFLICT_RESOLVED`, `MIGRATE.MONEY_RECONCILIATION_SIGNED`, `MIGRATE.COUNT_RECONCILED` |
| Execution | `MIGRATE.DRY_RUN_PASSED`, `MIGRATE.DRY_RUN_FAILED`, `MIGRATE.SYNC_COMPLETED`, `MIGRATE.LEGACY_FROZEN`, `MIGRATE.CUTOVER_EXECUTED` |
| Approvals | Gate events listed in the gate register (Section 3) |
| Access | `MIGRATE.OPERATOR_ACCESS_GRANTED`, `MIGRATE.CONTENT_ACCESS_APPROVED`, `MIGRATE.OPERATOR_ACCESS_EXPIRED` |
| Close-out | `MIGRATE.ROLLBACK_EXECUTED`, `MIGRATE.ROLLFORWARD_EXPORTED`, `MIGRATE.DECOMMISSION_CERTIFIED`, `MIGRATE.CONNECTOR_ARCHIVED`, `MIGRATE.CREDENTIALS_DESTROYED` |

**Critical-class events** (sealed and anchored before the action is released, per M09): every approval at G-14-06, G-14-08 and G-14-09, `MIGRATE.CUTOVER_EXECUTED`, `MIGRATE.ROLLBACK_EXECUTED`, privilege clearances, and staging destruction.

The CTO finalises the registry, including the 18 event names owed under FLAG-012; this list is the design baseline.

### Data residency

| Rule | Behaviour |
| --- | --- |
| Routing | Matter data to the matter's home jurisdiction; HR data to the employee's work location; matter-less data to the owning office's jurisdiction |
| Staging | Only in the destination region; any other write is blocked with HTTP 451 |
| Unclassifiable records | Quarantined in the source, never extracted, until G-14-07 resolves them |
| Repatriation | Logged per stream with the source location, as evidence for records of processing |
| Operators | Each stream is worked only by specialists cleared for that jurisdiction |

### Availability and resilience

- **Resumable extraction:** extraction runs in checkpointed batches; a failure resumes from the last verified batch without duplicating records.
- **Idempotent import:** re-running any import step cannot create duplicates; each record is keyed by its source identifier.
- **Staging durability:** staging survives a single-zone failure within the region.
- **Cutover window:** the cutover sequence (freeze, final delta, cutover) is atomic per stream; if any step fails, the stream stays on the legacy system and the failure escalates through G-14-10.
- **Ledger dependency:** cutover and rollback are critical actions and wait for sealing; in Ledger degraded mode they hold with "Awaiting seal".

### Security

- Encryption in transit from source to staging and at rest in staging, with the jurisdiction's KMS key.
- Source credentials only in NexusConnect, destroyed after cutover or cancellation.
- No operator can export data out of staging; downloads are limited to reports without matter content.

## Section 5 — Compliance requirements

### Regulations and how M14 satisfies them

| Regulation / standard | Requirement | How M14 satisfies it |
| --- | --- | --- |
| DPDP Act 2023 and Rules 2025 (India) | Processor acts only on the fiduciary's instructions; security safeguards; controls on transfer outside India | Data processing agreement before any work; in-region staging; repatriation logged; encrypted transit and staging |
| GDPR (architecture-ready) | Processor contract (Article 28); transfer rules (Chapter V) | Same agreement and residency routing; no third-region transit |
| CCPA/CPRA and US state privacy laws | Service-provider contract terms; use limited to the business purpose | Agreement terms; operator access scoped and time-limited |
| ABA Model Rule 1.6(c) | Reasonable efforts to prevent unauthorised access to client information | Metadata-by-default operator access; per-request content approval; credential destruction |
| ABA Model Rules 1.7, 1.9, 1.10 | Conflicts of interest, including imputed conflicts | Human-approved merges and mandatory conflict sweep before cutover (D2) |
| ABA Model Rule 1.15 and state trust-account rules | Safekeeping of client property and complete trust records | Three-way reconciliation as hard blocker; hashed transaction archive; rules per state Jurisdiction Pack (D8) |
| ABA Model Rule 5.3 and Formal Opinion 512 | Supervision of non-lawyer assistance, including vendors and AI | Logged operator actions; AI suggestions only, approved by tier (D1, D7) |
| Bar Council of India rules on professional conduct | Confidentiality; proper accounting of client money | Same controls as above; client-money rules in the India Jurisdiction Packs |
| SOC 2 (CC6, CC8) | Logical access; controlled change | Time-limited, client-granted access; every state change and approval sealed in the Ledger |
| BSA 2023 s.63 and FRE 902(13)/(14) | Provable integrity of electronic records | Hash-verified chain of custody; sealed source export retained as evidence |

### Mandatory HTIL steps (never automated)

- Granting operator access and approving content requests (G-14-01).
- Approving mapping templates and tag samples (G-14-02).
- Excluding any record (G-14-03).
- Clearing any document from privileged pending review (G-14-04).
- Every client merge, merge reversal and conflict resolution (G-14-05).
- Client-money reconciliation sign-off (G-14-06).
- Classifying a quarantined record's jurisdiction (G-14-07).
- Cutover approval by IT Director, Board and CEO (G-14-08).
- Post-cutover rollback (G-14-09) and LIVE defect disposition (G-14-10).

### Decisions that must remain human

- Whether a document is privileged, if the source does not say so.
- Whether two records are the same client.
- Whether a conflict of interest exists and how it is resolved.
- Whether a record may be left behind.
- Whether client money reconciles.
- Whether the institution goes live, rolls back, or fixes forward.

AI may suggest, flag and sample. It never merges, clears privilege, excludes records, adjusts balances or advances the lifecycle.

### Approved claims language

Sales and marketing say "verified, reversible migration" and "every record accounted for". Time ranges appear only in a client's migration plan after the data audit, stated as Jurexio processing time with client sign-off time additional. "Go live in 48 hours" and "zero data loss" without the "accounted for" definition are prohibited.

## Section 6 — Module dependencies

### Upstream (M14 depends on)

| Dependency | What M14 needs | Needed by state |
| --- | --- | --- |
| Jurexio Ledger Core (M09) | Outbox, registry, critical-event sealing | DRAFT onward |
| CommandCentre (M11) | Org, RBAC, approver identities, credential status, operator access grants | DRAFT |
| NexusConnect (M10) | MIGRATION connector category, credential vault, circuit breakers, archive and credential destruction | CONNECTED |
| CloudVault (M13) | In-region staging storage, sealed source export, certificates of destruction | STAGING |
| Jurexio Engine (M03) | Mapping and tag suggestions with confidence bands | MAPPING |
| MatterCore (M01) | Target schema for clients and matters; conflict-check engine for the sweep | VALIDATING |
| DocVault (M02) | Document targets with privilege levels, including privileged pending review | VALIDATING |
| BillGuard (M06) | Targets for opening balances, work in progress and trust positions | VALIDATING |
| DeadlineGuard (M05) | Target for open deadlines | VALIDATING |
| Jurisdiction Packs | Retention, trust-account and routing rules | STAGING onward |

### Downstream (depend on M14)

- **Every client onboarding** with legacy data.
- **Jurexio Ledger (M09):** receives imported audit-history segments.
- **Sales:** the "verified, reversible migration" proposition depends on the governance in this spec.

### External integrations for v1.0

| Integration | Purpose |
| --- | --- |
| Clio API | Extraction of contacts, matters, activities, documents, billing (via NexusConnect) |
| iManage API | Extraction of workspaces, documents, versions, metadata (via NexusConnect) |
| CSV/Excel and file-system import | Self-service and long-tail sources |

### Jurexio SDK and agent touchpoints

All AI calls go through the Jurexio Engine (M03).

| Agent / tool | Role | Boundary |
| --- | --- | --- |
| platform-migration-specialist | Suggests mappings for Clio and iManage | Suggests only; G-14-02 approves |
| data-migration-agent | Plans streams and checks lawful movement | Proposes only; routing rules are deterministic |
| data-residency-enforcement-agent | Blocks wrong-region writes | Enforcement only (HTTP 451) |
| data-integrity-verifier (tool) | SHA-256 verification before and after | Deterministic |
| chain-of-custody-recorder (tool) | Writes custody records to the Ledger | Deterministic |
| data-restoration-agent | Prepares rollback and roll-forward exports | Prepares only; G-14-09 approves |

## Section 7 — v1.0 scope vs deferred scope

The v1.0 feature list is in Section 1.

### v1.0 build increments

| Increment | Contents | Unlocks |
| --- | --- | --- |
| Migration Core | Lifecycle engine; CSV/Excel and file-system import; per-jurisdiction staging and quarantine; manual mapping templates; validation and count reconciliation; client merges and conflict sweep; client-money reconciliation; dry run; IT Director, Board and CEO approvals with the six pre-conditions; cutover; rollback window; source export sealing; decommissioning certificate; all Ledger events | SMB self-service migrations, end to end |
| Connectors and AI | Clio and iManage connectors via NexusConnect; AI-suggested mappings and tags with tiered approval; privileged-pending review queue; client-granted operator access | Mid-market migrations |
| Enterprise | Parallel run with one-way sync, discrepancy dashboard and exit criteria | Enterprise migrations |

### Release testing

No increment is released until these pass:

- **Reconciliation proof:** seeded test sets with known defects end with source = imported + excluded, and every defect is caught.
- **Privilege tests:** no path, including AI error, can lower a document's privilege.
- **Residency tests:** writes to the wrong region are blocked; mixed-jurisdiction sources split correctly; unclassifiable records never leave the source.
- **Dry-run block:** a failed dry run cannot be bypassed through the UI or the API.
- **Pre-condition enforcement:** the Board approve action cannot be called through the API while any pre-condition is red.
- **Resume and idempotency:** interrupted extraction and import resume without duplicates.
- **Rollback drills:** rollback before cutover leaves the source untouched; rollback after cutover produces a complete, hash-verified roll-forward export.
- **Credential destruction:** archived connectors hold no usable credentials.
- **Client-money tests:** a deliberate one-unit difference blocks cutover.

### Deferred scope

| Feature | Release trigger | Reason for deferral |
| --- | --- | --- |
| NetDocuments, Aderant, Elite 3E, LEAP, email, SharePoint / Google Drive connectors | Signed client needing that source (R1) | Build only what a paying client needs; CSV and file export covers the gap meanwhile |
| HR system migration (e.g. Workday) | NexusConnect HRIS connectors released and a signed client | Depends on HRIS connector work in M10 |
| Migration between Jurexio tenants or regions (mergers, region moves) | First client request with a signed agreement | Raises residency and conflict questions that need their own design |
| Clause extraction and contract analytics during migration | Clause model approved with its own HTIL design in M03 / LexGraph | Keeps migration focused on moving records, not analysing them |
| Mobile screens | None planned (FLAG-012: desktop-only) | Approvals and evidence review need a desktop; alerts reach mobile through PulseComms |

### Rejected (not deferred)

| Option | Reason |
| --- | --- |
| Two-way sync during parallel run | Two authoritative systems for legal records (D5) |
| Automatic client merges | Risk of confidentiality breach and corrupted conflict checks (D2) |
| Writing back to legacy systems | Jurexio never modifies a system it does not govern (D5) |
| "Go live in 48 hours" | Promises time Jurexio does not control (R3) |

## Section 8 — Open questions and blockers

### Sequencing risk (read first)

DataMigrate is design priority 2, but it writes into modules designed later: MatterCore (priority 6, including the conflict-check engine), DocVault (7), DeadlineGuard (5) and BillGuard (not yet sequenced). The specification can be complete now, but **Migration Core cannot run a real cutover until those target schemas are frozen.** The CTO already holds an open item on the `jrx.clients` data model. Recommendation: freeze the target data models for clients, matters, documents (with privilege levels), deadlines and financial opening positions as a single "migration target contract" before M14 engineering starts, even where those modules' full specs come later.

### Decisions requiring Chairman or CTO input

| # | Question | Owner | Recommendation |
| --- | --- | --- | --- |
| OQ-14-01 | Default post-cutover rollback window per mode | Chairman | Enterprise 30 days; mid-market 14 days; SMB 7 days |
| OQ-14-02 | Who acts as "Board" and "CEO" for clients without them (law-firm partnerships, PSUs, government bodies) | Chairman | Map per client type in CommandCentre: e.g. management committee and managing partner; for PSUs, the board and CMD |
| OQ-14-03 | Sampling standard for tag review | Chairman with counsel | A documented, statistically defensible sample per category, set once for all clients |
| OQ-14-04 | Who qualifies as "finance owner" per jurisdiction | Raja Sekhar T with counsel | Define per state pack, aligned with trust-account rules |
| OQ-14-05 | Parallel-run sync frequency and default exit criteria | CTO | Daily sync; three consecutive syncs with zero unexplained discrepancies |
| OQ-14-06 | Mapping of existing Figma screens (SCR-05a, SCR-06, SCR-09b) to SCR-14 numbers | UX Manager | Confirm the mapping proposed in Section 3 |
| OQ-14-07 | Vetting standard for Jurexio migration specialists per jurisdiction | Chairman | Background checks and signed confidentiality undertakings before any operator access |

### Compliance validations pending

- [ ] Data processing agreement template for migration services, India and US (counsel).
- [ ] Trust-account and client-money record rules in every US and Indian state pack (Raja Sekhar T).
- [ ] Counsel confirmation that "privileged pending review" import satisfies privilege-preservation duties in both jurisdictions.

### Items blocking engineering start

- [ ] Chairman sign-off (consolidated end review).
- [ ] CTO confirmation of the lifecycle and final event names, including the 18 owed under FLAG-012.
- [ ] Jurexio Ledger Core (M09) built.
- [ ] Migration target contract frozen (see sequencing risk), including the `jrx.clients` data model.
- [ ] NexusConnect MIGRATION connector category, credential vault and the shared authentication question resolved.
- [ ] Clio and iManage API access agreements in place (procurement).
- [ ] Conflict-check engine available for the sweep (MatterCore).

### Housekeeping

- [ ] Retire "go live in 48 hours" from all sales assets.
- [ ] Update the Migration Tool Info document's phase-wise connector list to match R1.
