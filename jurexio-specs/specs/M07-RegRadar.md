<!-- Source of truth: https://claude.ai/code/artifact/4fe380bb-87ad-4635-a8c4-121aa78a711a · exported 21 Oct 2026 · do not edit here; edit the Claude Doc and re-export -->

# Module Specification — M07 RegRadar

Oct 16, 2026 · @Suresh Singh

## Document control

| Field | Value |
| --- | --- |
| Module | M07 RegRadar |
| Spec version | v1.1, consolidated after the PDD Review Log (18 Oct 2026); draft for Chairman approval |
| Design order | 4 of 14 |
| Engineering owner | CTO (Vamsi) |
| Jurisdiction Pack inputs | Raja Sekhar T (source lists, obligation rules, sanctions lists, tier windows) |
| Status | Sign-off deferred to the consolidated end review. No engineering start before sign-off. |

### Decision log

| ID | Locked decision |
| --- | --- |
| R1 | Two lanes plus intake screening. Lane A: firm professional compliance. Lane B: client regulatory intelligence. FCPA and AML transaction monitoring deferred until a signed enterprise client needs it. |
| D1 | The official publication is the authority of record. Licensed feeds only for detection and coverage, and only where AI analysis is licensed; their items show "Reported, not yet confirmed". Every change source-linked, timestamped, hashed and sealed. AI never creates a change record. Coverage declared per Jurisdiction Pack. |
| D2 | Deterministic detection, then an AI impact proposal, then confirmation by a jurisdiction-matched compliance lawyer. Only confirmed impacts create obligations, deadlines or matter-team notices. Fast lane for changes effective within 30 days; batched review otherwise. Rejections feed agent quality metrics. |
| D3 | No compliance scores or percentages. Rule-based status per obligation (Met, Due, At risk, Overdue, Not assessed) shown as counts that open to evidence. Ratings only with stated drivers, human-confirmed where AI proposes them. |
| D4 | Lane A runs six evidence-driven checks. System evidence first; attestations labelled "Attested by \[designation\]". CLE tracking and advertising monitoring deferred. |
| D5 | Sanctions and KYC screening at intake and on every list update, in the client's home region. Every potential match decided by a Compliance Officer; a confirmed match blocks or freezes the matter. |
| D6 | Every obligation and alert has a named owner and backup. Critical, High and Routine tiers with an escalation ladder. Alerts close only with a recorded outcome. |
| D7 | RegRadar owns obligations; DeadlineGuard owns every date; the compliance calendar is a filtered DeadlineGuard view. Client alerts only as partner-approved work through ClientBridge. Only confirmed changes feed LexGraph. |
| Inherited | India and the US (all states) live; UK, EU, Singapore, GCC built-inactive (M03 R7). Every AI output that touches a matter or client is human-reviewed (M03 R1). All events follow the Jurexio Ledger rules (M09). |

### Consolidation v1.1 (PDD Review Log, 18 Oct 2026)

**Platform rules applied to this specification**

- **Gate outcomes (CB-ENG-06, CB-DES-05):** every gate records approved, rejected and withdrawn outcomes as Ledger events; rejection needs a reason; the gate engine generates the `_REJECTED` and `_WITHDRAWN` event names into Event registry v1. Every gate screen shows pending, approved, rejected and withdrawn.
- **Gate classes (I-05):** GUARDED = the requester can never approve; DUAL = two distinct people; SELF-ATTESTED = an act on one's own record, with reason, evidence and step-up where stated, logged and sampled by Compliance. The locked same-actor guard governs AI draft approval.
- **Approvers (C-02, CB-ENG-04):** every approver role maps to named permissions in Permission catalogue v1. "Jurexio" marks platform roles; unprefixed roles are tenant roles.
- **Canonical events (C-07, C-15):** one act produces one canonical event, owned by the module that owns the record; other context goes in attributes.
- **Design order (C-13):** the order specs were designed, not the engineering sequence, which the CTO publishes.
- **Doctrine carried in (CB-DES-02, CB-DES-03, CB-DES-04):** the Met, Due, At risk, Overdue, Not assessed vocabulary defined here is the platform status palette, with the existing colour tokens; confidence bands 0.80 and above HIGH (Emerald), 0.60–0.79 MEDIUM (Gold), below 0.60 LOW (Indigo, human review mandatory); AI badge Deep Indigo with Gold text on every impact proposal and rating.

**Gate classes in this module**

| Class | Gates |
| --- | --- |
| GUARDED | G-07-01, G-07-05, G-07-07, G-07-08, G-07-10 |
| DUAL | G-07-06, G-07-09 |
| SELF-ATTESTED | G-07-02, G-07-03 (closure with outcome and evidence), G-07-04 (labelled "Attested", sampled by Compliance) |

**Module changes**

- **C-12:** intake screening runs when a prospective client or matter is recorded at Intake, and must clear before `MATTER.OPENED` (Flow F2 corrected).
- **BQ-26 (accepted, P0):** the initial hold threshold errs towards holding; the CTO and Compliance Officer set it, and every threshold change is a security-relevant configuration change needing dual approval.
- **BQ-24 and BQ-25 (open):** India and US source lists, and designated compliance lawyers per jurisdiction and practice area, remain owed.

## Section 1 — Module identity

| Field | Value |
| --- | --- |
| Module | M07 RegRadar |
| Code | `jrx-regradar.ts` |
| Tagline | The institution's compliance posture and its clients' regulatory horizon, each backed by evidence. |
| Job to be done | Show a legal institution where it stands against its own professional obligations, tell its lawyers which regulatory changes affect which matters, and screen every client before work begins, with every status traceable to evidence. |
| Primary users | Compliance Officer, Data Protection Officer, compliance lawyers (impact confirmation), responsible Partners, General Counsel (institution view) |
| Secondary users | Matter teams (obligation owners), finance owner (client-money status), CommandCentre admins (credential records) |
| Live jurisdictions | India and the United States, every state and union territory |
| AI role | Proposes impacts and drafts client alerts; never creates change records, obligations or statuses on its own |

### v1.0 scope — in

**Lane A — firm professional compliance**

- Six evidence-driven checks: AI supervision, conflict controls, client money, practising status, the firm's own data protection, records retention (D4).
- Attestation workflow for items with no system evidence, labelled "Attested".

**Lane B — client regulatory intelligence**

- Source monitoring of declared official sources and licensed feeds per pack (D1).
- Change records with official confirmation, source link, timestamp and hash (D1).
- AI impact proposals on active matters and contracts, confirmed by a jurisdiction-matched lawyer (D2).
- Obligations with owners, statuses and evidence (D3, D6); dated obligations as linked DeadlineGuard deadlines (D7).
- Partner-approved client alerts through ClientBridge (D7).

**Intake screening**

- Sanctions and KYC screening of clients and related parties at intake and on each list update (D5).

**Across both lanes**

- Alert tiers, ownership and escalation (D6).
- Institution view across offices through federated aggregates (M09 D8).
- Coverage view showing exactly which sources each pack monitors (D1).

### v1.0 scope — out

Deferred items and triggers are in Section 7.

## Section 2 — User stories

### US-07-01 See the firm's own compliance posture

As a **Compliance Officer**, I need one view of the firm's professional-compliance status so that I can show the managing partner, an auditor or a bar regulator where we stand.

- Each of the six Lane A checks shows counts by status (Met, Due, At risk, Overdue, Not assessed), never a percentage.
- Every count opens to the underlying items and their evidence.
- Attested items are visibly distinct from system-evidenced ones.

### US-07-02 Trust that a regulatory change is real

As a **compliance lawyer**, I need every change linked to its official publication so that I never act on a rumour or an AI invention.

- Confirmed changes show the official source link, retrieval time and hash.
- Feed-only items show "Reported, not yet confirmed" and cannot create obligations.

### US-07-03 Confirm which matters a change affects

As a **compliance lawyer**, I need the AI's proposed impacts with its reasoning so that I can confirm, edit or reject each one quickly.

- Each proposal names the provision, the affected matter or contract, the reasoning and a confidence band.
- Only I (or another jurisdiction-matched lawyer) can confirm; confirmation creates the obligation and its DeadlineGuard deadline.
- Changes effective within 30 days reach me in a fast lane; others arrive in batches.

### US-07-04 Own an obligation

As a **matter owner**, I need to know exactly which obligations are mine and when they fall due so that nothing is left to "someone".

- Every obligation has me or another named owner and a backup.
- Critical items need my acknowledgement; if I do not acknowledge, they escalate.
- I close an item only by recording its outcome.

### US-07-05 Screen a new client

As a **Compliance Officer**, I need every new client and related party screened against official sanctions lists so that the firm never acts for a sanctioned party unknowingly.

- Screening runs at intake in the client's home region.
- Every potential match comes to me with its evidence; the system never auto-rejects or auto-clears.
- A confirmed match blocks the matter from opening.

### US-07-06 Catch a designation after intake

As a **Compliance Officer**, I need existing clients re-screened when a sanctions list changes so that a later designation does not go unnoticed.

- Each list update triggers re-screening of active clients and related parties.
- A confirmed match freezes the matter pending a decision by the responsible Partner and me.

### US-07-07 Tell a client about a change

As a **responsible Partner**, I need to send a client a reviewed regulatory update so that the client hears it from us, accurately.

- The Engine can draft the update; it reaches the client only after my approval through ClientBridge.
- RegRadar never messages a client directly.

### US-07-08 Know what is and is not monitored

As a **General Counsel**, I need to see exactly which sources are monitored for each jurisdiction so that I understand the limits of the coverage.

- Each pack's source list is visible, with last successful retrieval per source.
- A source that fails to retrieve shows as a coverage gap, not as "no changes".

## Section 3 — Pipeline, statuses, gates and key user flows

### Change-to-obligation pipeline (D2)

| Step | Who | What happens | Output |
| --- | --- | --- | --- |
| 1 Detect | System (no AI) | Declared sources polled; new or amended texts captured with link, time and hash | Change record, "Reported" or "Confirmed" |
| 2 Confirm | System, or compliance lawyer where a source is not machine-readable | Change matched to its official publication (G-07-10) | Confirmed change; sent to LexGraph |
| 3 Propose | Jurexio Engine | Affected matters, contracts and clients proposed with provision, reasoning and confidence | Impact proposals (LEGAL\_WORKFLOW) |
| 4 Decide | Jurisdiction-matched compliance lawyer | Confirm, edit or reject each proposal (G-07-01); assign owner and backup (G-07-02) | Obligations; linked DeadlineGuard deadlines |
| 5 Track | Owner | Act, record evidence, close with an outcome (G-07-03) | Status and Ledger trail |

This pipeline is Flow F1. Feed-only changes stop at step 1 until confirmed. Changes effective within 30 days go to a fast review lane; others are batched (OQ-07-02).

### Obligation statuses (D3)

| Status | Rule |
| --- | --- |
| Met | Required action recorded with evidence |
| Due | Has a future due date and an owner |
| At risk | Due within the pack's warning window with no owner action recorded |
| Overdue | Due date passed without a Met record |
| Not assessed | In scope but not yet evaluated, or its source is failing to retrieve |
| Attested | Lane A item confirmed by a named person, with no system evidence available |

### Alert tiers (D6)

| Tier | Trigger | Delivery | Escalation |
| --- | --- | --- | --- |
| Critical | Effective within 7 days, penalty-bearing, or a confirmed sanctions match | Immediate through PulseComms; acknowledgement required | Backup, then responsible Partner, then Compliance Officer view |
| High | Effective within 30 days | Same day | Backup, then responsible Partner |
| Routine | Everything else | Weekly digest per owner | Shown as At risk when the warning window opens |

Windows are defaults; a Jurisdiction Pack may tighten them for specific regulators. Duplicate alerts from one change are merged.

### Lane A checks (D4)

| Check | Evidence source |
| --- | --- |
| AI supervision | Jurexio Engine and Ledger: review coverage, reviewer eligibility, "AI prohibited" adherence, citation-gate outcomes |
| Conflict controls | MatterCore and retrieval logs: cleared conflicts, waivers and expiry, ethical walls |
| Client money | BillGuard: reconciliations on the cadence each state or BCI rule requires; open exceptions |
| Practising status | CommandCentre credentials: bar admissions, renewals, Indian practising-certificate status |
| Firm data protection | Ledger and CloudVault: breach-notification clocks, data-subject request deadlines, processor agreements |
| Records retention | Ledger: disposals and holds under pack rules |

### HTIL gate register

Gate classes are listed under Consolidation v1.1 in Document control.

| Gate | Decision | Gate type | Approver role | Ledger events |
| --- | --- | --- | --- | --- |
| G-07-01 | Confirm, edit or reject an impact proposal | Single approver | Jurisdiction-matched compliance lawyer | `REGRADAR.IMPACT_CONFIRMED`, `REGRADAR.IMPACT_EDITED`, `REGRADAR.IMPACT_REJECTED` |
| G-07-02 | Assign or reassign an obligation owner and backup | Single approver | Confirming lawyer; Compliance Officer for reassignment | `REGRADAR.OWNER_ASSIGNED` |
| G-07-03 | Close an obligation or alert with its outcome | Single approver | Owner | `REGRADAR.OBLIGATION_CLOSED` |
| G-07-04 | Attest a Lane A item | Single approver | Named attester (designation recorded) | `REGRADAR.ITEM_ATTESTED` |
| G-07-05 | Decide a screening match | Single approver | Compliance Officer | `REGRADAR.MATCH_CONFIRMED`, `REGRADAR.MATCH_CLEARED`, `REGRADAR.MATCH_INFO_REQUESTED` |
| G-07-06 | Release a blocked or frozen matter, or decline the engagement | Dual distinct | Responsible Partner and Compliance Officer | `REGRADAR.FREEZE_RELEASED`, `REGRADAR.ENGAGEMENT_DECLINED` |
| G-07-07 | Approve a client alert | Single approver (Jurexio Engine G-03-01) | Responsible Partner | `REGRADAR.CLIENT_ALERT_APPROVED` |
| G-07-08 | Confirm an AI-proposed risk rating | Single approver | Compliance lawyer | `REGRADAR.RATING_CONFIRMED` |
| G-07-09 | Add or remove a monitored source or sanctions list | Dual distinct | Jurisdiction Pack owner and Compliance Officer | `REGRADAR.SOURCE_ADDED`, `REGRADAR.SOURCE_REMOVED` |
| G-07-10 | Confirm a change against its official publication where this cannot be done automatically | Single approver | Compliance lawyer | `REGRADAR.CHANGE_CONFIRMED` |

### Flow F2 — Intake screening

- **Entry:** a prospective client or matter is recorded at Intake in MatterCore; screening must clear before the matter opens.
- **Steps:** client and related parties screened in-region against the pack's lists; no potential match = cleared and logged; any potential match = held for the Compliance Officer (G-07-05); a confirmed match blocks matter opening until G-07-06.
- **Primary act:** the Compliance Officer compares the record with the list entry (identifiers, dates of birth, addresses, match score) before deciding.

### Flow F3 — Re-screening on list update

- **Entry:** an official list changes; the new version is captured and sealed.
- **Steps:** active clients and related parties re-checked against the changes only; potential matches to G-07-05; a confirmed match freezes the matter pending G-07-06.
- **Primary act:** as F2.

### Flow F4 — Lane A evidence refresh

- **Steps:** each check recomputes from its evidence source on a schedule; items without system evidence request attestation (G-07-04); status changes raise alerts by tier.
- **Primary act:** the Compliance Officer reads the counts and opens any At risk or Overdue item.

### Flow F5 — Client alert

- **Steps:** from a confirmed change, the Partner asks the Engine for a draft; the draft is reviewed and approved (G-07-07); ClientBridge delivers it.
- **Primary act:** the Partner reads the full draft and its source links before approving.

### Flow F6 — Escalation

- **Steps:** an unacknowledged Critical alert moves to the backup, then the Partner, then the Compliance Officer view, each step logged; closure needs a recorded outcome (G-07-03).
- **Primary act:** the owner reads the alert and its evidence, then acknowledges, acts or transfers.

### Screen inventory for UX (FLAG-007)

| Screen | Flow / gate | Primary act |
| --- | --- | --- |
| SCR-07-01 Firm compliance (Lane A) | F4, G-07-04 | Read counts per check; open At risk and Overdue items |
| SCR-07-02 Change feed | F1, G-07-10 | Read changes with source links; filter by jurisdiction and status |
| SCR-07-03 Impact review queue | F1, G-07-01, G-07-02 | Confirm, edit or reject each proposal and assign owners |
| SCR-07-04 Obligations | F1, F6, G-07-03 | Work owned obligations; record outcomes |
| SCR-07-05 Screening queue | F2, F3, G-07-05, G-07-06 | Compare potential matches and decide |
| SCR-07-06 Client alert review | F5, G-07-07 | Read the draft and its sources, then approve |
| SCR-07-07 Coverage | US-07-08, G-07-09 | Read monitored sources and gaps per pack; manage sources |
| SCR-07-08 Institution view (federated) | US-07-01 | Read regional aggregates; request in-region drill-down |

The compliance calendar is a filtered DeadlineGuard view, not a RegRadar screen (D7).

## Section 4 — Data architecture

### Inputs

| Source | What enters |
| --- | --- |
| Declared official sources per pack (via NexusConnect) | Gazettes, registers, regulator and court publications |
| Licensed feeds (via NexusConnect) | Early detection items, only under contracts permitting AI analysis |
| Official sanctions lists per pack | Versioned list snapshots (e.g. OFAC lists for the US; UN Security Council consolidated list and Ministry of Home Affairs designations for India) |
| MatterCore (M01) | Matters, clients, related parties, practice areas, conflict records |
| BillGuard (M06) | Trust and client-money reconciliation status |
| CommandCentre (M11) | Credentials and practising status, roles, compliance-lawyer jurisdiction scope |
| Jurexio Engine (M03) and Jurexio Ledger (M09) | AI-supervision evidence; erasure, retention and hold records |
| Jurisdiction Packs | Source lists, obligation rules, warning windows, tier windows, sanctions lists |

### Outputs

| Destination | What exits |
| --- | --- |
| DeadlineGuard (M05) | Linked deadlines for confirmed, dated obligations |
| LexGraph (M04) | Officially confirmed regulatory texts as authorities |
| ClientBridge (M08) | Partner-approved client alerts |
| PulseComms (M12) | Alerts by tier, escalations, digests |
| MatterCore (M01) | Screening holds and freezes on matters |
| Jurexio Ledger (M09) | Every change, decision, status change and screening outcome |

### Core records

| Record | Key fields |
| --- | --- |
| Change | Source, official link, retrieval time, text hash, jurisdiction and forum code, status (Reported or Confirmed), effective date |
| Impact proposal | Change, provision, affected matter or contract, reasoning, confidence, decision, decider |
| Obligation | Requirement, matter, owner, backup, status, due date (DeadlineGuard link), evidence, outcome |
| Lane A item | Check, subject (lawyer, account, matter), status, evidence link or attestation |
| Screening result | Subject token, list version, match score, decision, decider |
| Coverage entry | Pack, source, last successful retrieval, failure state |

The CTO Mapping tables (`jrx.compliance_items`, `jrx.regulatory_changes`, `jrx.risk_assessments`, `jrx.sanctions_screenings`, `jrx.employment_regulations`) map onto these records; `jrx.aml_records` is limited to intake KYC until transaction monitoring is released.

### Ledger events

All events use the `REGRADAR.` domain and the M09 outbox.

| Family | Events |
| --- | --- |
| Changes | `REGRADAR.CHANGE_DETECTED`, `REGRADAR.CHANGE_CONFIRMED`, `REGRADAR.SOURCE_RETRIEVAL_FAILED` |
| Impacts and obligations | `REGRADAR.IMPACT_PROPOSED`, `REGRADAR.IMPACT_CONFIRMED`, `REGRADAR.IMPACT_EDITED`, `REGRADAR.IMPACT_REJECTED`, `REGRADAR.OWNER_ASSIGNED`, `REGRADAR.STATUS_CHANGED`, `REGRADAR.OBLIGATION_CLOSED` |
| Lane A | `REGRADAR.CHECK_REFRESHED`, `REGRADAR.ITEM_ATTESTED`, `REGRADAR.RATING_CONFIRMED` |
| Screening | `REGRADAR.LIST_VERSION_SEALED`, `REGRADAR.SCREENING_RUN`, `REGRADAR.MATCH_CONFIRMED`, `REGRADAR.MATCH_CLEARED`, `REGRADAR.MATCH_INFO_REQUESTED`, `REGRADAR.MATTER_FROZEN`, `REGRADAR.FREEZE_RELEASED`, `REGRADAR.ENGAGEMENT_DECLINED` |
| Alerts | `REGRADAR.ALERT_RAISED`, `REGRADAR.ALERT_ACKNOWLEDGED`, `REGRADAR.ALERT_ESCALATED`, `REGRADAR.CLIENT_ALERT_APPROVED` |
| Coverage | `REGRADAR.SOURCE_ADDED`, `REGRADAR.SOURCE_REMOVED` |

**Critical-class events:** confirmed screening matches, matter freezes and releases, engagement declines, and client alert approvals.

### Data residency

- Change records and official texts are public data, but are stored per region so that matter-linked impacts never leave their home region.
- Sanctions lists are copied into each region; screening of client data runs only in the client's home region.
- Impact proposals, obligations and screening results stay in the matter's home region; the institution view uses federated aggregates (M09 D8).

### Availability

- A source that fails to retrieve marks its coverage entry "Failing" and turns the affected checks to Not assessed; it never reads as "no changes".
- If the Engine is unavailable, changes are still detected and confirmed; impact proposals queue until it returns.
- If list retrieval fails, the last sealed version stays in use and the Compliance Officer is alerted.

## Section 5 — Compliance requirements

### Regulations and how M07 satisfies them

| Regulation / standard | Requirement | How M07 satisfies it |
| --- | --- | --- |
| ABA Formal Opinion 512; Model Rules 5.1, 5.3 | Documented supervision of AI and non-lawyer assistance | Lane A AI-supervision check evidenced from Engine and Ledger records |
| ABA Model Rules 1.7, 1.9, 1.10 | Conflict checks and screening | Lane A conflict-controls check; screening holds at intake |
| ABA Model Rule 1.15 and state trust-account rules | Safekeeping of client property; reconciliations on the required cadence | Lane A client-money check from BillGuard, cadence per state pack |
| ABA Formal Opinion 491 | Duty to inquire where a client may be using legal services unlawfully | Intake screening and list-update re-screening, human-decided |
| US sanctions regulations (OFAC) | No dealings with designated persons | Screening against official OFAC lists; confirmed match blocks or freezes |
| India: UN Security Council and Ministry of Home Affairs designations | No dealings with designated persons and entities | India pack lists; same screening and freeze controls |
| Advocates Act 1961; BCI Certificate and Place of Practice (Verification) Rules 2015; BCI professional-conduct rules | Practising status; professional conduct; confidentiality | Lane A practising-status check from verified credentials |
| DPDP Act 2023 and Rules 2025 | Security safeguards; breach intimation; data-principal rights | Lane A data-protection check with breach and request clocks; in-region screening |
| US state breach-notification and privacy laws | State-specific notice duties and deadlines | Clocks per state pack |
| Licensing terms of commercial legal content | Use within licensed purposes | Licensed feeds used only where AI analysis is permitted (D1) |
| SOC 2 (CC2, CC3, CC7) and ISO/IEC 27001 | Risk identification, monitoring, communication of compliance status | Evidence-backed statuses, alert ownership, complete event trail |

### Mandatory HTIL steps (never automated)

- Confirming, editing or rejecting every impact proposal (G-07-01).
- Assigning and reassigning obligation owners (G-07-02) and closing items with outcomes (G-07-03).
- Every attestation (G-07-04).
- Every screening match decision (G-07-05) and every release or decline after a match (G-07-06).
- Approving every client alert (G-07-07).
- Confirming any AI-proposed risk rating (G-07-08).
- Changing monitored sources or sanctions lists (G-07-09).
- Confirming a change against its official publication where automation cannot (G-07-10).

### Decisions that must remain human

- Whether a regulatory change affects a matter, and what it requires.
- Whether a screening match is the same person, and whether the firm may act.
- Whether an obligation has been met.
- What the firm tells a client about a change.

### Approved claims language

- "Monitors \[number\] declared official sources across India and the US", with the number taken from the coverage view.
- "Every regulatory alert linked to its official publication."
- "Firm compliance status evidenced from system records."
- Prohibited: any "% compliant" figure; "real-time compliance score"; "monitors all regulations"; "BCI AI guidelines" until the instrument is confirmed (OQ-07-06).

## Section 6 — Module dependencies

### Upstream (M07 depends on)

| Dependency | What M07 needs |
| --- | --- |
| Jurexio Ledger Core (M09) | Outbox, registry, critical-event sealing; evidence for Lane A AI-supervision, retention and erasure checks |
| Jurexio Engine (M03) | Impact proposals and client-alert drafts under its gates and review rules |
| CommandCentre (M11) | Roles, compliance-lawyer jurisdiction scope, credentials and practising status |
| MatterCore (M01) | Matters, clients, related parties, conflict records; ability to hold and freeze matters |
| BillGuard (M06) | Client-money reconciliation status |
| NexusConnect (M10) | Connections to official sources, licensed feeds and sanctions lists |
| Jurisdiction Packs | Source lists, obligation rules, warning and tier windows, sanctions lists (Raja Sekhar T) |

### Downstream (depend on M07)

- **DeadlineGuard (M05):** receives linked deadlines for confirmed obligations; hosts the compliance-calendar view.
- **LexGraph (M04):** receives confirmed regulatory texts, which keep citation verification current.
- **ClientBridge (M08):** delivers approved client alerts.
- **MatterCore (M01):** matter opening waits on intake screening.

### External integrations

| Integration | Purpose | Condition |
| --- | --- | --- |
| Official publication sources (India and US) | Authority of record for changes | Listed in the pack's declared sources |
| Licensed legal content feeds | Early detection and coverage | Contract permits AI analysis inside Jurexio |
| Official sanctions list sources | Screening | Retrieved from the issuing authority and versioned |

### Agent touchpoints

Through the Jurexio Engine only: regulatory-monitor and compliance-lead (impact proposals), data-protection-agent (data-protection obligations), ai-governance-agent (AI-supervision evidence summaries). aml-specialist is limited to intake KYC support; fcpa-agent is not used until transaction monitoring is released. Agent identifiers must match the uploaded registry.

## Section 7 — v1.0 scope vs deferred scope

The v1.0 feature list is in Section 1.

### v1.0 build increments

| Increment | Contents | Unlocks |
| --- | --- | --- |
| Screening and Lane A | Intake screening and list-update re-screening; the six Lane A checks with attestation; obligation statuses; alert tiers and escalation | Matter opening with screening; the firm's own compliance view |
| Lane B | Source monitoring and coverage view; change confirmation; impact proposals and review queue; obligations linked to DeadlineGuard; client alerts; LexGraph feed | Client regulatory intelligence |

Screening comes first because MatterCore matter opening depends on it. The CTO Mapping places M07 in Sprint 2 with the Jurexio Engine; Lane B's impact proposals need the Engine live.

### Release testing

- **No invented changes:** AI cannot create a change record through any route.
- **No unconfirmed obligations:** a feed-only change cannot create an obligation or deadline.
- **Confirmation required:** no impact becomes an obligation without a jurisdiction-matched lawyer's decision.
- **Screening:** seeded true matches are all held; common-name false positives are held, never auto-rejected; no match is ever auto-cleared.
- **Re-screening:** a list update containing an existing client freezes that matter.
- **Coverage honesty:** a failing source shows as a gap and turns affected checks to Not assessed.
- **One date record:** an obligation's date changed in DeadlineGuard is the same record seen in RegRadar.
- **Escalation:** an unacknowledged Critical alert climbs the ladder on time; no alert closes without an outcome.
- **Residency:** screening of client data runs only in the home region.

### Deferred scope

| Feature | Release trigger | Reason |
| --- | --- | --- |
| FCPA and anti-bribery transaction monitoring | Signed enterprise or in-house client requiring it, with transaction data access | Needs transaction feeds Jurexio does not hold (R1) |
| Continuous AML transaction surveillance | Same trigger | Same reason (R1) |
| CLE hour tracking | Client request | Requirements vary across 45+ US states; needs its own data (D4) |
| Advertising and social-media rule monitoring | Client request | Requires monitoring content outside the platform (D4) |
| UK, EU, Singapore, GCC sources and employment feeds | Pack validated by local counsel and activated by the Chairman | Built-inactive per M03 R7 |

### Rejected (not deferred)

| Option | Reason |
| --- | --- |
| "% compliant" scores | Unexplainable and quotable out of context (D3) |
| Automatic obligations from AI impact proposals | Unverified obligations flood DeadlineGuard (D2) |
| Separate RegRadar compliance calendar | Two date records for one obligation (D7) |
| Automatic rejection or clearance of screening matches | Discriminates on names or misses real matches (D5) |

## Section 8 — Open questions and blockers

### Decisions requiring Chairman or CTO input

| # | Question | Owner | Recommendation |
| --- | --- | --- | --- |
| OQ-07-01 | Initial declared source list per India and US pack, and its size | Raja Sekhar T | Start with central sources plus every state gazette or register; publish the count |
| OQ-07-02 | Fast-lane review SLA and batch cadence for impact proposals (D2) | Chairman | Fast lane 24 hours; batches twice weekly |
| OQ-07-03 | Which licensed feeds to buy, and whether their terms allow AI analysis | Chairman with procurement | Buy only after legal review of AI-use terms |
| OQ-07-04 | Who are the designated compliance lawyers per jurisdiction and practice area | Each client firm, configured in CommandCentre | Mandatory during onboarding; no Lane B without them |
| OQ-07-05 | Default warning window for "At risk" | Chairman | 14 days, tightened per regulator in the pack |
| OQ-07-06 | Which BCI instrument, if any, sets AI-supervision duties for Indian advocates | Indian counsel | Until confirmed, cite BCI professional-conduct rules, the July 2026 digital-conduct circular and the DPDP Act; retire "BCI AI guidelines" wording |
| OQ-07-07 | Do Indian advocates have formal AML reporting duties | Indian counsel | Encode the answer in the India pack |
| OQ-07-08 | Match-score threshold for holding a potential sanctions match | CTO with Compliance Officer | Err towards holding; tune from false-positive data; every threshold change is a dual-approved security-relevant configuration change |

### Compliance validations pending

- [ ] Licensed-feed contracts reviewed for AI-use rights (D1).
- [ ] Indian AML position confirmed (OQ-07-07).
- [ ] BCI AI-supervision instrument identified (OQ-07-06).
- [ ] Trust-account reconciliation cadences per US state and BCI rule encoded in packs.
- [ ] Breach-notification clocks per US state and the DPDP Rules encoded in packs.

### Items blocking engineering start

- [ ] Chairman sign-off (consolidated end review).
- [ ] Jurexio Ledger Core (M09) live.
- [ ] Jurexio Engine (M03) live for Lane B impact proposals.
- [ ] CommandCentre (M11) roles and compliance-lawyer jurisdiction scope frozen.
- [ ] MatterCore hold-and-freeze capability defined for screening (M01).
- [ ] DeadlineGuard linked-deadline interface agreed (M05).
- [ ] India and US source lists and sanctions lists available in the packs.

### Housekeeping

- [ ] Remove "92% compliant" style figures from both demo platforms and all decks (D3).
- [ ] Retire the "6 jurisdictions" tagline; show live jurisdictions only (M03 R7).
- [ ] Rename Nyayavigya references in the Architecture Spec's M07 section to Jurexio Engine.
- [ ] Fix the route typo `/api/jrx/regrada/dashboard` to `/api/jrx/regradar/dashboard`.
