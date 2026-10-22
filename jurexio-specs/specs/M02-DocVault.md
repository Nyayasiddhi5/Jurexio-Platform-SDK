<!-- Source of truth: https://claude.ai/code/artifact/37f73c64-3800-422a-aca4-8c790851a91f · exported 21 Oct 2026 · do not edit here; edit the Claude Doc and re-export -->

# Module Specification — M02 DocVault

Oct 16, 2026 · @Suresh Singh

## Document control

| Field | Value |
| --- | --- |
| Module | M02 DocVault (Documents & Communications) |
| Spec version | v1.1, consolidated after the PDD Review Log (18 Oct 2026); draft for Chairman approval |
| Design order | 7 of 14 (last in the confirmed sequence) |
| Engineering owner | CTO (Vamsi) |
| Jurisdiction Pack inputs | Raja Sekhar T (privilege types, e-signature eligibility and levels, stamp-duty rules, filing format and redaction rules, approved signing providers) |
| Status | Sign-off deferred to the consolidated end review. No engineering start before sign-off. |

### Jurisdiction baseline

India and the United States (all states) are the only live jurisdictions in v1.0. The United Kingdom, European Union, Singapore and GCC packs are built as configuration but inactive until counsel-validated and activated by the Chairman (C-01, 18 Oct 2026; supersedes the earlier six-active baseline). No live regional infrastructure is required for the inactive four in v1.0.

### Decision log

| ID | Locked decision |
| --- | --- |
| R1 | Originals stored byte-for-byte, encrypted in the home region, hashed and sealed at upload. Personal data detected and labelled, never removed. Redaction only on derived copies for release, each a linked version with its own hash. |
| D1 | Four levels: Privileged (pack-defined type), Confidential, Internal, Public. Default Privileged pending review for firm documents; Confidential for documents received from opposing parties. AI may raise, never lower. Only a credential-verified lawyer lowers, with a reason. |
| D2 | Immutable hashed versions; Draft → Final → Executed or Filed. Executed, filed and received documents permanently locked; corrections are new linked documents. Re-hash on every open. Holds cover every version. |
| D3 | One release check for every route out (privilege, matter match, personal data, version). Lawyer approval for privileged documents, productions and filings. Production sets with numbering and a privilege log. Every release sealed. |
| D4 | Pack-driven e-signature eligibility and signature level; stamp-duty check where required; approved in-region providers only; release check before sending; completion certificate stored; document locked as Executed. |
| D5 | Filing package from Final versions; pack-driven pre-filing check (format, redaction, release, AI-use disclosure, citations); lawyer sign-off; a human files; the receipt locks documents as Filed and closes the linked deadline. |
| D6 | AI suggests the matter for captured email and bulk uploads; a person confirms; in-region intake queue until then; automatic filing only for unambiguous thread or reference links with no wall; hashing, OCR and sampled tag review; received productions kept separate. |
| Inherited | Access through the central access decision, including walls (M01 D5). AI drafts: no streaming; discarded drafts deleted after 24 hours with hash kept (FLAG-005, Ledger D5). Privileged pending review from DataMigrate (M14 D1). Reviewer stamps rendered from the Ledger (Engine R3). Retention and holds per Ledger D7. ClientBridge sharing off by default. |

### Consolidation v1.1 (PDD Review Log, 18 Oct 2026)

**Platform rules applied to this specification**

- **Gate outcomes (CB-ENG-06, CB-DES-05):** every gate records approved, rejected and withdrawn outcomes as Ledger events; rejection needs a reason; the gate engine generates the `_REJECTED` and `_WITHDRAWN` event names into Event registry v1. Every gate screen shows pending, approved, rejected and withdrawn.
- **Gate classes (I-05):** GUARDED = the requester can never approve; DUAL = two distinct people; SELF-ATTESTED = an act on one's own record, with reason, evidence and step-up where stated, logged and sampled by Compliance. The locked same-actor guard governs AI draft approval.
- **Approvers (C-02, CB-ENG-04):** every approver role maps to named permissions in Permission catalogue v1; numbered RBAC levels are retired. "Jurexio" marks platform roles; unprefixed roles are tenant roles.
- **Canonical events (C-07, C-15):** one act produces one canonical event, owned by the module that owns the record; other context goes in attributes.
- **Design order (C-13):** the order specs were designed, not the engineering sequence, which the CTO publishes.
- **Doctrine carried in (CB-DES-03, CB-DES-04):** confidence bands 0.80 and above HIGH (Emerald), 0.60–0.79 MEDIUM (Gold), below 0.60 LOW (Indigo, human review mandatory); AI badge Deep Indigo with Gold text on every AI-suggested item.

**Gate classes in this module**

| Class | Gates |
| --- | --- |
| GUARDED | G-02-01, G-02-03, G-02-04, G-02-05, G-02-08 (assembler cannot sign off), G-02-10, G-02-11 |
| DUAL | G-02-12 (Jurexio CTO and Jurexio Compliance) |
| SELF-ATTESTED | G-02-02, G-02-06, G-02-07, G-02-09 |

**Module changes**

- **C-01:** documents and signing providers are needed for India and the US only in v1.0.
- **I-04:** every ClientBridge share needs Responsible Partner approval (G-02-11), whatever the classification; the matter-team release rule applies to other routes only.
- **C-15:** `DOCUMENT.CLASSIFICATION_LOWERED` is the canonical event for clearing privileged-pending documents, including during migration (with `migration_project_id` as an attribute); `MIGRATE.PRIVILEGE_CLEARED` is retired or kept only as a registry alias.
- **BQ-17 and D-07:** e-signature providers are shortlisted per live jurisdiction with in-region processing in contract; Aadhaar-based eSign for India; the September Dropbox Sign choice is re-confirmed only for US matters, and only where it meets D4.
- **CB-CMP-02 (confirmed):** production sets, filing packages and other client work product carry no Jurexio footer, at most a neutral "Generated with Jurexio" marker in metadata.

## Section 1 — Module identity

| Field | Value |
| --- | --- |
| Module | M02 DocVault |
| Code | `jrx-docvault.ts` |
| Tagline | Every document kept as it was, protected by default, and released only on purpose. |
| Job to be done | Hold every document and communication of a matter as an unaltered, verifiable record; protect privilege and personal data by default; and make every release, signature and filing a deliberate, checked act. |
| Primary users | Lawyers and paralegals on matters, responsible Partners (releases, productions, filings), docketing staff (intake queue) |
| Secondary users | Clients through ClientBridge, Compliance Officer, Data Protection Officer, records roles |
| Jurisdictions | India and the US (all states) live; other packs built as configuration, inactive; documents live in the matter's home region |
| AI role | Suggests matters, document types, tags and higher classifications; drafts documents through the Jurexio Engine; never lowers privilege, never releases, signs or files |

### v1.0 scope — in

- Upload with intact originals, hashing, sealing and personal-data labelling (R1).
- Privilege classification with pack-defined types and lawyer-only lowering (D1).
- Immutable versions, document states, permanent locks, re-hash on open, version comparison (D2).
- One release check for every route out; production sets with numbering, redaction and privilege log (D3).
- Redacted derived copies (R1, D3).
- E-signature with pack eligibility, signature level, stamp-duty check, in-region providers and completion certificates (D4).
- Court-filing packages with pre-filing checks, lawyer sign-off and receipt capture (D5).
- Email capture and bulk intake with AI suggestions, human matter confirmation and an intake queue (D6).
- Template library per matter type and jurisdiction.
- AI drafting trigger to the Jurexio Engine with matter context.
- Legal holds and pack-driven retention on every version.

### v1.0 scope — out

Deferred items and triggers are in Section 7.

## Section 2 — User stories

### US-02-01 Keep the original exactly as received

As a **litigator**, I need every document stored exactly as it arrived so that I can prove what it said in court.

- The stored file is byte-identical to the upload, with its hash sealed in the Ledger.
- Personal data is labelled, not removed.
- Opening a document re-checks its hash; a mismatch blocks it and alerts.

### US-02-02 Protect privilege by default

As a **responsible Partner**, I need new documents treated as privileged until a lawyer decides otherwise so that nothing is released by accident.

- Firm-created and firm-uploaded documents default to Privileged pending review.
- AI may raise a classification but never lower it.
- Only a credential-verified lawyer lowers it, with a reason.

### US-02-03 Know which version is which

As an **associate**, I need every version kept and executed documents locked so that "which version did they sign" always has an answer.

- Each save is a new version; nothing is overwritten.
- Executed, filed and received documents can never change; corrections become new linked documents.
- Any two versions can be compared.

### US-02-04 Send the right document to the right person

As a **lawyer**, I need every outgoing document checked before it leaves so that I never send privileged material or the wrong client's file.

- The release check confirms classification, matter, personal data and version for every route out.
- Privileged documents need a lawyer's confirmation before release.

### US-02-05 Run a production safely

As a **litigation Partner**, I need productions built as reviewed, numbered sets with a privilege log so that disclosure is complete and defensible.

- Documents are selected, privilege-reviewed, redacted where needed and numbered.
- Withheld documents feed the privilege log.
- The production is sealed with what was produced and withheld.

### US-02-06 Get an enforceable signature

As a **transactional lawyer**, I need the system to stop e-signatures on documents that cannot be e-signed, and to check stamp duty, so that the signed document holds up.

- Excluded document types are blocked with the reason.
- Stampable Indian instruments need an e-stamp certificate attached or stamping responsibility recorded.
- On completion, the certificate of completion is stored and the document locked as Executed.

### US-02-07 File without avoidable errors

As a **litigator**, I need the filing package checked against the forum's rules so that it is not rejected or sanctioned.

- Checks cover format, required redactions, release, AI-use disclosure and citations.
- I sign off; a person files; the receipt locks the documents and closes the deadline.

### US-02-08 File email to the right matter

As a **paralegal**, I need incoming email suggested to a matter and confirmed by a person so that nothing lands on the wrong client's file.

- Unconfirmed items sit in an intake queue visible only to the sender or owner.
- Thread replies on an already-filed thread file automatically only when the sender is on the team and no wall applies.

## Section 3 — Document controls and key user flows

### Document states (D2)

| State | Editable | How it is reached |
| --- | --- | --- |
| Draft | Yes, as new versions | Created or uploaded by the firm |
| Final | No; reopening to Draft needs a lawyer and a reason | Marked Final by a lawyer (G-02-02) |
| Executed | Never | Signature completed (D4) |
| Filed | Never | Filing receipt captured (D5) |
| Received | Never | Arrived from outside the firm (court orders, opposing counsel, productions) |

### Classification levels (D1)

| Level | Default for | Who may lower it |
| --- | --- | --- |
| Privileged (type set by the pack, e.g. legal advice or attorney-client, litigation or work product) | Firm-created and firm-uploaded documents, as "pending review" | Credential-verified lawyer only (G-02-01) |
| Confidential | Documents received from opposing parties | Credential-verified lawyer only |
| Internal | — | Credential-verified lawyer only |
| Public | — | — |

The pack warns where privilege may not apply, for example in-house communications in some EU proceedings.

### Release check (D3)

Every route out of the firm (ClientBridge, email through PulseComms, productions, filings, signature requests, downloads) runs the same four checks:

| Check | Rule | On failure |
| --- | --- | --- |
| Classification | Privileged documents need a lawyer's confirmation that privilege is preserved or intentionally waived | Blocked until G-02-03 |
| Matter match | The document belongs to the matter the recipient is connected to | Blocked |
| Personal data | Labelled personal data flagged | Offer a redacted copy (G-02-05) |
| Version | The intended version, normally Final or Executed; drafts flagged | Warning; lawyer confirms |

Public and Internal documents to the matter's own client may be released by the matter team once the checks pass, except through ClientBridge, where every share needs Responsible Partner approval (G-02-11). Privileged documents, productions and filings always need a lawyer's approval.

> **Diagram:** Release check · one rule for every route out — rendered in the source Claude Doc: https://claude.ai/code/artifact/37f73c64-3800-422a-aca4-8c790851a91f

### HTIL gate register

Gate classes (GUARDED, DUAL, SELF-ATTESTED) are listed under Consolidation v1.1 in Document control.

| Gate | Decision | Gate type | Approver role | Ledger events |
| --- | --- | --- | --- | --- |
| G-02-01 | Lower a classification, including clearing privileged pending review | Single approver, reason required | Credential-verified lawyer | `DOCUMENT.CLASSIFICATION_LOWERED` |
| G-02-02 | Mark Final, or reopen Final to Draft | Single approver, reason required to reopen | Lawyer on the matter | `DOCUMENT.MARKED_FINAL`, `DOCUMENT.REOPENED_TO_DRAFT` |
| G-02-03 | Release a privileged document | Single approver | Lawyer on the matter | `DOCUMENT.PRIVILEGED_RELEASE_APPROVED` |
| G-02-04 | Approve a production set | Single approver | Responsible Partner | `DOCUMENT.PRODUCTION_APPROVED` |
| G-02-05 | Approve a redacted copy | Single approver | Lawyer on the matter | `DOCUMENT.REDACTION_APPROVED` |
| G-02-06 | Send a document for e-signature | Single approver, eligibility check passed | Lawyer on the matter | `DOCUMENT.SIGNATURE_SENT` |
| G-02-07 | Record stamp-duty handling | Single approver | Lawyer on the matter | `DOCUMENT.STAMP_DUTY_RECORDED` |
| G-02-08 | Sign off a filing package | Single approver | Lawyer of record | `DOCUMENT.FILING_PACKAGE_APPROVED` |
| G-02-09 | Confirm the matter for an intake item | Single approver | Sender, owner or docketing staff on the matter team | `DOCUMENT.MATTER_CONFIRMED` |
| G-02-10 | Approve a sampled tag batch | Single approver | Designated lawyer | `DOCUMENT.TAG_SAMPLE_APPROVED` |
| G-02-11 | Share a document with the client through ClientBridge | Single approver | Responsible Partner | `DOCUMENT.CLIENT_SHARED` |
| G-02-12 | Approve a signing provider for a jurisdiction | Dual distinct | Jurexio CTO and Jurexio Compliance | `DOCUMENT.SIGNING_PROVIDER_APPROVED` |

### Flow F1 — Upload

- **Steps:** file stored byte-for-byte in the home region; hashed and sealed; scanned for personal data and labelled; OCR if scanned; duplicates detected by hash; classified by default rule; AI may suggest a higher classification and a document type.
- **Primary act:** the uploader confirms matter and document type.

### Flow F2 — Release

- **Steps:** user chooses a route and recipients; the four checks run; a redacted copy is offered where personal data is flagged; lawyer approval where required (G-02-03); release sealed with document, version, hash, recipient, route and approver.
- **Primary act:** the lawyer reads the release summary (what, which version, to whom, classification) before approving.

### Flow F3 — Production

- **Steps:** documents selected; privilege reviewed; redacted copies made (G-02-05); numbered; withheld documents recorded in the privilege log; Partner approves the set (G-02-04); production sealed.
- **Primary act:** the Partner reads the produced-and-withheld summary and the privilege log before approving.

### Flow F4 — E-signature

- **Steps:** pack eligibility and signature level checked; stamp-duty handled where required (G-02-07); release check; sent through the jurisdiction's approved provider (G-02-06); completion certificate stored; document locked as Executed.
- **Primary act:** the lawyer reads the eligibility and stamp-duty result before sending.

### Flow F5 — Court filing

- **Steps:** package assembled from Final versions; pre-filing check (format, redaction, release, AI-use disclosure, citations); lawyer of record signs off (G-02-08); a person files through the court portal or a registered e-filing API; receipt captured; documents locked as Filed; linked deadline closed as filed with evidence.
- **Primary act:** the lawyer reads each pre-filing check result before signing off.

### Flow F6 — Email and bulk intake

- **Steps:** items arrive from users, matter mailboxes or bulk upload; the Engine suggests a matter and type; items wait in the in-region intake queue; a person confirms the matter (G-02-09); unambiguous thread or reference links file automatically when the sender is on the team and no wall applies; bulk tag samples reviewed (G-02-10).
- **Primary act:** the reviewer reads the suggested matter and its reasons before confirming.

### Screen inventory for UX (FLAG-007)

| Screen | Flow / gate | Primary act |
| --- | --- | --- |
| SCR-02-01 Matter documents | F1 | Browse and open documents by state, classification and type |
| SCR-02-02 Document viewer and versions | F1, G-02-02 | Read, compare versions, mark Final |
| SCR-02-03 Classification review | G-02-01 | Review privileged-pending items and lower with reasons |
| SCR-02-04 Release | F2, G-02-03, G-02-05, G-02-11 | Run the checks, choose redacted copies, approve release |
| SCR-02-05 Production builder | F3, G-02-04 | Select, review, redact, number; view the privilege log |
| SCR-02-06 E-signature | F4, G-02-06, G-02-07 | Check eligibility and stamp duty; send; track completion |
| SCR-02-07 Filing package | F5, G-02-08 | Assemble, read check results, sign off, attach receipt |
| SCR-02-08 Intake queue | F6, G-02-09, G-02-10 | Confirm matters for captured items; approve tag samples |
| SCR-02-09 Templates | — | Choose and maintain templates per matter type and jurisdiction |

## Section 4 — Data architecture

### Inputs

| Source | What enters |
| --- | --- |
| Users | Uploads, new documents, versions |
| Firm mailboxes and matter mailboxes via NexusConnect | Emails and attachments |
| Bulk upload and data rooms | Batches of files |
| Jurexio Engine (M03) | Approved AI drafts; suggested matters, types, tags and higher classifications |
| Signing providers via NexusConnect | Signed documents and certificates of completion |
| Courts (manual or registered APIs) | Filing receipts, stamped copies, orders |
| DataMigrate (M14) | Legacy documents, including privileged-pending items |
| MatterCore (M01) | Matter, team, home jurisdiction, central access decision |
| Jurisdiction Packs | Privilege types, e-signature eligibility and levels, stamp-duty rules, filing format and redaction rules |

### Outputs

| Destination | What exits |
| --- | --- |
| ClientBridge (M08) | Partner-shared documents, after the release check |
| PulseComms (M12) | Approved attachments, after the release check |
| Courts | Filing packages, filed by a person |
| Signing providers | Documents for signature, after eligibility and release checks |
| DeadlineGuard (M05) | Court-notice triggers; filing receipts that close deadlines |
| Jurexio Engine (M03) and LexGraph (M04) | Permission-checked content for retrieval; nothing promoted to LexGraph without approval (Engine D5) |
| CloudVault (M13) | Physical in-region storage and disposal certificates |
| Jurexio Ledger (M09) | Every upload, version, classification change, release, signature, filing and confirmation |

### Core records

| Record | Key fields |
| --- | --- |
| Document | Matter, type, classification and privilege type, state, origin (firm, received, migrated, AI-approved), current version |
| Version | Document, number, author, time, change note, file hash, storage pointer, personal-data labels |
| Derived copy | Source version, purpose (redaction, production), redactions applied, own hash, approver |
| Release | Document and version, route, recipients, checks result, approver, time |
| Production set | Matter, documents with numbers, withheld documents, privilege log, approver |
| Signature record | Document, provider, signature level, eligibility result, stamp-duty record, completion certificate pointer |
| Filing record | Package contents, check results, approver, filer, receipt pointer, linked deadline |
| Intake item | Source, suggested matter and reasons, confirmation status, confirmer |

### Ledger events

All events use the `DOCUMENT.` domain and the M09 outbox.

| Family | Events |
| --- | --- |
| Storage | `DOCUMENT.UPLOADED`, `DOCUMENT.VERSION_CREATED`, `DOCUMENT.INTEGRITY_VERIFIED`, `DOCUMENT.INTEGRITY_FAILED`, `DOCUMENT.DUPLICATE_DETECTED` |
| Classification | `DOCUMENT.CLASSIFIED`, `DOCUMENT.CLASSIFICATION_RAISED`, `DOCUMENT.CLASSIFICATION_LOWERED` |
| States | `DOCUMENT.MARKED_FINAL`, `DOCUMENT.REOPENED_TO_DRAFT`, `DOCUMENT.EXECUTED`, `DOCUMENT.FILED`, `DOCUMENT.RECEIVED_LOCKED` |
| Release | `DOCUMENT.RELEASE_CHECKED`, `DOCUMENT.PRIVILEGED_RELEASE_APPROVED`, `DOCUMENT.RELEASED`, `DOCUMENT.CLIENT_SHARED`, `DOCUMENT.REDACTION_APPROVED` |
| Productions | `DOCUMENT.PRODUCTION_APPROVED`, `DOCUMENT.PRODUCTION_SEALED` |
| Signature | `DOCUMENT.SIGNATURE_ELIGIBILITY_CHECKED`, `DOCUMENT.STAMP_DUTY_RECORDED`, `DOCUMENT.SIGNATURE_SENT`, `DOCUMENT.SIGNATURE_COMPLETED`, `DOCUMENT.SIGNING_PROVIDER_APPROVED` |
| Filing | `DOCUMENT.FILING_PACKAGE_APPROVED`, `DOCUMENT.FILING_RECEIPT_CAPTURED` |
| Intake | `DOCUMENT.INTAKE_RECEIVED`, `DOCUMENT.MATTER_CONFIRMED`, `DOCUMENT.AUTO_FILED`, `DOCUMENT.TAG_SAMPLE_APPROVED` |

**Critical-class events:** classification lowered, privileged release, production sealed, signature completed, filing package approved, integrity failure, client share.

The April events `DOCUMENT.UPLOAD`, `DOCUMENT.VERSION_CREATED`, `DOCUMENT.PRIVILEGE_TAGGED` and `DOCUMENT.SIGNED` map to `DOCUMENT.UPLOADED`, `DOCUMENT.VERSION_CREATED`, `DOCUMENT.CLASSIFIED` and `DOCUMENT.SIGNATURE_COMPLETED`.

### Data residency

- Originals, versions, derived copies and intake items stay in the matter's home region; the intake queue is regional.
- Signing uses only providers approved for that jurisdiction with in-region processing; where none exists, e-signature is not offered.
- Releases send only what the release check approves; the stored originals never leave the region except as an approved release.

### Integrity and availability

- Every open re-hashes the file against the Ledger; a mismatch blocks access and raises a tamper alert.
- Storage uses CloudVault's in-region durable storage with backup; restored files must match their sealed hashes before use.
- If the release check service is unavailable, no external release proceeds.

## Section 5 — Compliance requirements

India and the US are the live jurisdictions in v1.0, so the obligations below apply through their packs. Rows for the UK, EU, Singapore and GCC apply when those packs are activated.

### Regulations and how M02 satisfies them

| Regulation / standard | Requirement | How M02 satisfies it |
| --- | --- | --- |
| Federal Rule of Evidence 502(b) (US) | Privilege survives inadvertent disclosure only if reasonable steps were taken | Privileged-by-default classification, lawyer-only lowering, one release check, sealed release records (D1, D3) |
| Federal Rule of Civil Procedure 26(b)(5) and state equivalents | Privilege log for withheld documents | Production sets generate the privilege log (D3) |
| Federal Rule of Civil Procedure 5.2 and state equivalents | Redaction of personal identifiers in filings | Pre-filing redaction check and redacted copies (D5, R1) |
| UK Civil Procedure Rules Part 31 and Practice Direction 57AD | Disclosure duties and privilege | UK pack production rules |
| Bharatiya Sakshya Adhiniyam 2023 (sections 63, 132–134) | Electronic-record evidence; professional communications | Intact originals with sealed hashes (R1, D2); privilege types in the India pack |
| Information Technology Act 2000 (India) | Recognition of electronic signatures; excluded documents | Pack eligibility list; approved methods such as Aadhaar-based eSign (D4) |
| Indian Stamp Act 1899 and state stamp laws | Unstamped instruments cannot be admitted until duty and penalty are paid | Stamp-duty check before signature completes (D4) |
| US ESIGN Act and UETA | Validity of electronic signatures, with exclusions | US pack eligibility list (D4) |
| EU eIDAS Regulation; UK electronic signature law | Simple, advanced and qualified signature levels | Required level enforced per document type (D4) |
| Singapore Electronic Transactions Act; GCC electronic-transactions laws | Validity and exclusions | Pack eligibility lists (D4) |
| ABA Model Rules 1.1 and 1.6(c); SRA, BCI and other confidentiality rules | Competent, confidential handling of client information | Release check, central access decision, intake queue (D3, D6) |
| GDPR, UK GDPR, DPDP Act, Singapore PDPA, GCC data-protection laws | Data minimisation on disclosure; security; residency | Personal-data labels, redacted copies on release, in-region storage and signing (R1, D4) |
| Court standing orders on AI use | Disclosure or certification of AI-assisted content | Pre-filing AI-use disclosure check (D5) |

### Mandatory HTIL steps (never automated)

- Lowering any classification (G-02-01).
- Marking Final and reopening Final documents (G-02-02).
- Releasing privileged documents and sharing with clients (G-02-03, G-02-11).
- Approving productions and redacted copies (G-02-04, G-02-05).
- Sending for signature and recording stamp-duty handling (G-02-06, G-02-07).
- Signing off filing packages (G-02-08); a person files.
- Confirming the matter for intake items and approving tag samples (G-02-09, G-02-10).
- Approving signing providers (G-02-12).

### Decisions that must remain human

- Whether a document is privileged, and whether to waive privilege.
- Which matter a document belongs to.
- What is produced, withheld or redacted.
- Whether a document is ready to sign or file, and the act of filing itself.

### Approved claims language

- "Every document kept exactly as received, with its integrity checked on every open."
- "Privileged by default; only a lawyer can lower protection."
- "One release check on every route out of the firm."
- Prohibited: "automatic redaction on upload", "AI files for you", "auto-filing to court", and any claim that e-signature is valid for every document type.

## Section 6 — Module dependencies

### Upstream (M02 depends on)

| Dependency | What M02 needs |
| --- | --- |
| Jurexio Ledger Core (M09) | Outbox, registry, critical-event sealing; hashes for integrity checks |
| MatterCore (M01) | Matters, teams, home jurisdiction, central access decision including walls |
| CommandCentre (M11) | Roles, credential verification for lawyer-only actions, CTO and Compliance roles |
| CloudVault (M13) | In-region durable storage, backup, disposal certificates |
| Jurexio Engine (M03) | Drafting; suggested matters, types, tags and classifications; citation checks for filings |
| NexusConnect (M10) | Mailbox connectors, signing-provider connectors, court e-filing stubs |
| `nv_pii_vault` and personal-data detection | Labelling of personal data |
| Jurisdiction Packs | Privilege types, e-signature rules, stamp-duty rules, filing format and redaction rules |

### Downstream (depend on M02)

| Module | Dependency |
| --- | --- |
| DeadlineGuard (M05) | Court notices captured as documents; filing receipts close deadlines |
| Jurexio Engine (M03) | Permission-checked retrieval; storage of approved outputs |
| ClientBridge (M08) | Partner-shared documents |
| PulseComms (M12) | Approved attachments |
| DataMigrate (M14) | Target for migrated documents, with privilege levels |
| Jurexio Ledger (M09) | Evidence packages retrieve document content from DocVault |

### External integrations

| Integration | Purpose | Condition |
| --- | --- | --- |
| Firm mailbox (Microsoft 365, Google Workspace) | Email capture | Firm-authorised, in-region processing |
| E-signature providers per jurisdiction | Signatures | Approved for the jurisdiction with in-region processing (G-02-12) |
| OCR service | Text extraction from scans | In-region |
| Court e-filing systems | Filing | Only after registration; a person triggers each filing |

### Agent touchpoints

Through the Jurexio Engine only: document-intelligence-agent (type, tag and matter suggestions), contract-drafting, contract-review and pleading-draft (drafts for review). None can classify downward, release, sign or file.

## Section 7 — v1.0 scope vs deferred scope

The v1.0 feature list is in Section 1. India and the US are live in v1.0; the other four packs are built as configuration and inactive.

### v1.0 build increments

| Increment | Contents | Needed by |
| --- | --- | --- |
| Vault Core | Intact-original upload, hashing and sealing, personal-data labels, classification with lawyer-only lowering, immutable versions and states, re-hash on open, release check, client sharing | Every module that stores or sends documents; DataMigrate's document import |
| Intake | Email capture, matter mailboxes, intake queue, bulk upload with OCR and duplicate detection, AI suggestions with sampled tag review | High-volume matters and migrations |
| Release workflows | Redacted copies, production sets with privilege log, e-signature with eligibility and stamp-duty checks, filing packages with pre-filing checks and receipt capture | Litigation and transactional go-live |

### Release testing

- **Intact originals:** uploaded files are byte-identical to the stored files; no route redacts an original.
- **Integrity:** a tampered file is blocked on open and raises an alert.
- **Classification:** AI cannot lower any classification; non-lawyers cannot lower; privileged-pending defaults apply.
- **Locks:** executed, filed and received documents cannot be edited, reopened or replaced through any route.
- **One release check:** every route out (ClientBridge, email, productions, filings, signature, download) runs the same four checks; privileged documents never leave without a lawyer's approval.
- **Wrong-matter protection:** a document from one matter cannot be released to another matter's recipients.
- **Productions:** withheld documents always appear in the privilege log.
- **E-signature:** excluded document types are blocked; a stampable Indian instrument cannot complete without stamping recorded; no unapproved provider can be used.
- **Filing:** the system cannot file by itself; a filing receipt closes the linked deadline.
- **Intake:** unconfirmed items are never visible to the suggested matter's team; walls apply to the intake queue.

### Deferred scope

| Feature | Release trigger | Reason |
| --- | --- | --- |
| Direct court e-filing | Court e-filing API registration per court | Stubs today; a person files meanwhile |
| Capture of chat and messaging platforms (e.g. WhatsApp, Teams) as matter communications | Retention and consent rules confirmed per jurisdiction | Messaging capture raises consent and personal-data issues beyond email |
| Full e-discovery review platform (analytics, technology-assisted review) | Signed litigation client needing it | Production sets cover v1.0 disclosure needs |
| Real-time co-authoring | Version model extended to concurrent edits | Immutable versions come first |

### Rejected (not deferred)

| Option | Reason |
| --- | --- |
| Redacting personal data before storage | Destroys originals and evidential integrity (R1) |
| AI lowering classifications | Waiver is often irreversible (D1) |
| Overwriting documents | Breaks the hash trail (D2) |
| Per-module release rules | The weakest route sets the risk (D3) |
| Automatic filing by the system | Agents can never act (Engine D4) |

## Section 8 — Open questions and blockers

### Decisions requiring Chairman or CTO input

| # | Question | Owner | Recommendation |
| --- | --- | --- | --- |
| OQ-02-01 | Approved e-signature providers and methods per jurisdiction, with in-region processing | CTO with procurement | Shortlist per region; Aadhaar-based eSign for India; qualified trust services for the EU where required |
| OQ-02-02 | Default retention for unconfirmed intake items | Chairman | 30 days, then the item is returned to the sender's mailbox and removed |
| OQ-02-03 | Which matter mailboxes and addresses are monitored | Chairman | Designated matter and docketing mailboxes only, as for DeadlineGuard |
| OQ-02-04 | Production numbering conventions per jurisdiction (e.g. Bates numbering in the US) | Raja Sekhar T | Encode per pack |
| OQ-02-05 | Sample size for bulk tag review | Chairman with counsel | Same standard as DataMigrate (OQ-14-03) |
| OQ-02-06 | Download controls: watermarking and download of privileged documents | Chairman | Watermark every download; privileged downloads only after the release check |

### Compliance validations pending

- [ ] Privilege types per jurisdiction, including in-house privilege limits in EU proceedings (counsel).
- [ ] E-signature exclusion lists and signature levels per jurisdiction (counsel).
- [ ] Stamp-duty rules per Indian state, and any equivalents elsewhere (counsel).
- [ ] Filing format and redaction rules per forum (counsel, with Raja Sekhar T).
- [ ] Personal-data detection accuracy across the languages and scripts of the six jurisdictions.

### Items blocking engineering start

- [ ] Chairman sign-off (consolidated end review).
- [ ] Jurexio Ledger Core (M09), CommandCentre (M11) roles and MatterCore Foundation (M01) available.
- [ ] CloudVault (M13) in-region storage in the India and US regions.
- [ ] Personal-data detection service available in every region.
- [ ] NexusConnect (M10) mailbox and signing-provider connectors.

### Housekeeping

- [ ] Correct the Architecture Spec: "Every document upload goes through PII redaction before storage" becomes "Every upload is stored intact, hashed and labelled for personal data" (R1).
- [ ] Retire the demo flow step "Upload → PII Scan → Privilege Tag" wording that implies redaction.
- [ ] Update Nyayavigya and IronLedger references in the M02 section to Jurexio Engine and Jurexio Ledger.
