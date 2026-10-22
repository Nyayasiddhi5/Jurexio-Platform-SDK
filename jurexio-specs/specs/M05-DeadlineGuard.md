<!-- Source of truth: https://claude.ai/code/artifact/0c3b6c22-d02a-45a4-86e3-bced76ea6175 · exported 21 Oct 2026 · do not edit here; edit the Claude Doc and re-export -->

# Module Specification — M05 DeadlineGuard

Oct 16, 2026 · @Suresh Singh

## Document control

| Field | Value |
| --- | --- |
| Module | M05 DeadlineGuard |
| Spec version | v1.1, consolidated after the PDD Review Log (18 Oct 2026); draft for Chairman approval |
| Design order | 5 of 14 |
| Engineering owner | CTO (Vamsi) |
| Jurisdiction Pack inputs | Raja Sekhar T (forum rule sets, holiday and vacation calendars, relief options, checklist templates, alert windows) |
| Status | Sign-off deferred to the consolidated end review. No engineering start before sign-off. |

### Decision log

| ID | Locked decision |
| --- | --- |
| R1 | Court dates from lawful sources only: notices received by the firm, cause lists where terms permit, manual entry, registered court APIs. Every date labelled by source and freshness. "Real-time sync" retired. |
| D1 | AI extracts the trigger with a cited passage; a deterministic Jurisdiction Pack rules engine computes the date with visible working; a state-matched reviewer confirms. Rules versioned; a rule change flags open deadlines. No verified rule means manual entry. |
| D2 | Fail-safe: proposed deadlines alert immediately as "Unconfirmed". Confirmation time-boxed. Earliest date governs on conflict. |
| D3 | Named owner and backup; acknowledged alerts from T-7; closure only with outcome and evidence; automatic missed-deadline incident with relief checklist and insurer-notification decision. |
| D4 | Earlier moves by the owner alone; later moves and "not applicable" need owner and partner; extensions need attached evidence; no deletion. |
| D5 | Matter-linked legal tasks capped by their deadline; template checklists per forum; AI suggestions accepted by the owner; clash detection; no project management. |
| D6 | One-way, read-only calendar publishing with minimal content by default, to the firm's own tenant. |
| Inherited | DeadlineGuard owns every date on the platform (RegRadar D7). Linked deadlines from RegRadar, DataMigrate and the Jurexio Engine SLA cap (Engine D6). India and US (all states) live (Engine R7). Every event follows Jurexio Ledger rules (M09). |

### Consolidation v1.1 (PDD Review Log, 18 Oct 2026)

**Platform rules applied to this specification**

- **Gate outcomes (CB-ENG-06, CB-DES-05):** every gate records approved, rejected and withdrawn outcomes as Ledger events; rejection needs a reason; the gate engine generates the `_REJECTED` and `_WITHDRAWN` event names into Event registry v1. Every gate screen shows pending, approved, rejected and withdrawn.
- **Gate classes (I-05):** GUARDED = the requester can never approve; DUAL = two distinct people; SELF-ATTESTED = an act on one's own record, with reason, evidence and step-up where stated, logged and sampled by Compliance. The locked same-actor guard governs AI draft approval.
- **Approvers (C-02, CB-ENG-04):** every approver role maps to named permissions in Permission catalogue v1. "Jurexio" marks platform roles; unprefixed roles are tenant roles.
- **Canonical events (C-07, C-15):** one act produces one canonical event, owned by the module that owns the record; other context goes in attributes.
- **Design order (C-13):** the order specs were designed, not the engineering sequence, which the CTO publishes.
- **Doctrine carried in (CB-DES-02, CB-DES-04):** status vocabulary Met, Due, At risk, Overdue, Not assessed with the existing tokens, the OVERDUE chip as the one exception; AI badge Deep Indigo with Gold text on AI-suggested checklist items.

**Gate classes in this module**

| Class | Gates |
| --- | --- |
| GUARDED | G-05-01, G-05-02, G-05-06, G-05-08, G-05-10 |
| DUAL | G-05-03 and G-05-04 (the owner may be the requester; the Partner is the second person), G-05-07, G-05-11, G-05-12 |
| SELF-ATTESTED | G-05-05 (close as filed, with evidence), G-05-09 (accept a suggestion on one's own task) |

**Added gate (I-03, CB-ENG-11, BQ-22)**

| Gate | Decision | Gate type | Approver role | Ledger events |
| --- | --- | --- | --- | --- |
| G-05-12 | Decide whether to notify the client after a missed deadline, including a decision not to notify | Dual distinct, reason required | Responsible Partner and General Counsel or managing partner | `DEADLINE.CLIENT_NOTIFICATION_DECIDED` |

This closes OQ-05-06: the decision is always recorded by humans (ABA Model Rule 1.4 and Formal Opinion 481; India position per counsel) and forms part of the missed-deadline incident (Flow F4).

**Module changes**

- **BQ-21 (accepted):** verified rule sets first for the forums of the first three pilots, then the highest-volume courts.
- **BQ-23 (open):** each client firm names its designated risk owner at onboarding.

## Section 1 — Module identity

| Field | Value |
| --- | --- |
| Module | M05 DeadlineGuard |
| Code | `jrx-deadlineguard.ts` |
| Tagline | Every date owned, sourced, computed transparently and closed with evidence. |
| Job to be done | Make sure no court deadline, limitation period, regulatory obligation or contractual milestone is missed, by recording every date with its source, computing it with verifiable rules, assigning a named owner and escalating until it is closed with evidence. |
| Platform role | The single owner of every date in Jurexio; the Tasks stage of Matter → Documents → Tasks → AI → Audit |
| Primary users | Lawyers and matter owners, responsible Partners, docketing staff, reviewers confirming deadlines |
| Secondary users | Compliance Officer, General Counsel or managing partner (incidents), risk owner (insurer decisions) |
| Live jurisdictions | India and the United States, per forum as each rule set is verified (OQ-05-01) |
| AI role | Extracts trigger events from documents and suggests checklist items; never computes a date and never confirms one |

### v1.0 scope — in

- Deadline registry for court deadlines, hearings, limitation periods, regulatory obligations and contractual milestones.
- Date capture from court notices in the firm's mailbox, permitted cause lists, manual entry and registered court APIs, with source and freshness labels (R1).
- AI trigger extraction with cited passages (D1).
- Deterministic rules engine per forum: counting rules, holiday and vacation calendars, service extensions, with visible working (D1).
- Confirmation by a state-matched reviewer, with fail-safe "Unconfirmed" alerts and earliest-date rule (D1, D2).
- Owner and backup, acknowledged alert ladder, escalation (D3).
- Closure with outcome and evidence; missed-deadline incident workflow (D3).
- Risk-proportionate change control and extension evidence (D4).
- Matter-linked tasks and template hearing checklists with AI suggestions (D5).
- Workload clash detection (D5).
- Linked deadlines from RegRadar, DataMigrate and Jurexio Engine review SLAs.
- Compliance-calendar view of regulatory deadlines (RegRadar D7).
- One-way calendar publishing (D6).

### v1.0 scope — out

Deferred items and triggers are in Section 7.

## Section 2 — User stories

### US-05-01 Capture a deadline from a court notice

As a **lawyer**, I need deadlines in court notices captured automatically so that nothing depends on someone reading every email.

- Notices arriving in the firm's mailbox are read; the trigger event and date are extracted with the exact passage cited.
- The resulting deadline is live for alerts at once, labelled "Unconfirmed".

### US-05-02 See how a date was computed

As a **reviewer**, I need the calculation shown step by step so that I can confirm it in seconds.

- The working lists the trigger, the rule applied (with rule-set version), every adjustment for weekends, holidays, vacations and service, and the result.
- If no verified rule exists for the forum, the system says so and requires manual entry.

### US-05-03 Never miss a date while waiting for review

As a **responsible Partner**, I need unconfirmed deadlines to alert as if confirmed so that a slow review can never cause a miss.

- Alerts run on proposed dates immediately.
- If sources disagree, the earliest date governs until a person resolves it with a reason.

### US-05-04 Know it is mine

As a **matter owner**, I need every deadline assigned to me or a named colleague with a backup so that responsibility is never shared vaguely.

- No deadline exists without an owner and backup.
- From T-7 I must acknowledge each alert with a status; without acknowledgement by T-3 it escalates to my backup, then my Partner.

### US-05-05 Close a deadline properly

As a **matter owner**, I need to close a deadline with its evidence so that the record shows it was met.

- Closure options: filed (with filing receipt), extended (with order or agreement), no longer applicable (with reason and Partner approval), created in error (with Partner approval).
- Deadlines are never deleted.

### US-05-06 Move a date safely

As a **responsible Partner**, I need any later move to require my approval and a reason so that no deadline is quietly disarmed.

- Earlier moves need only the owner.
- Later moves, "not applicable" and extensions need the owner and me, as two different people; extensions need the court order or permitted agreement attached.

### US-05-07 Respond fast to a miss

As a **General Counsel**, I need an immediate, structured response when a deadline passes unfiled so that the firm acts in the first hours.

- At T-0 without a filed outcome, an incident opens and notifies the Partner, me and the Compliance Officer.
- The incident lists the forum's relief options for counsel to decide and prompts the insurer-notification decision.

### US-05-08 Prepare for a hearing

As an **associate**, I need a hearing checklist for this forum and matter type so that preparation is complete and consistent.

- The template checklist comes from the Jurisdiction Pack; AI may suggest extra items, which I accept or ignore.
- Every task's due date falls on or before its hearing or deadline.

### US-05-09 See deadlines in my calendar

As a **lawyer**, I need deadlines in my Outlook or Google calendar so that I do not re-key them.

- Events are read-only copies with matter reference, type, date and a link back.
- Client names appear only if the firm opts in for that matter.

## Section 3 — Deadline lifecycle, controls and key user flows

### Deadline states

| State | Meaning | Alerts |
| --- | --- | --- |
| Unconfirmed | Proposed from a notice, calculation, linked module or manual entry; awaiting confirmation | Full alert ladder on the proposed date |
| Confirmed | Reviewer confirmed trigger and computation | Full alert ladder |
| Conflict | Sources disagree | Ladder runs on the earliest date until resolved |
| Re-confirm required | The rule set that produced it has changed | Ladder runs on the existing date until re-confirmed |
| Closed — filed | Met, with filing evidence | Stops |
| Closed — extended | Replaced by a new deadline on evidence of extension | Moves to the new deadline |
| Closed — not applicable / created in error | Closed with reason and Partner approval | Stops |
| Missed | T-0 passed without a filed outcome; incident open | Incident notices |

Two flags can sit on any open deadline: **Stale** (its source has not been verified since a stated time) and **Clash** (its owner or team has other critical deadlines the same day).

### Alert ladder (D3)

| Point | Delivery | Required response |
| --- | --- | --- |
| T-30, T-14 | Owner and backup | None |
| T-7, T-3, T-1 | Owner and backup | Acknowledge with status: on track, filed, or at risk |
| No acknowledgement by T-3 | Backup, then responsible Partner | Acknowledge |
| T-0 | Owner, backup, Partner | Close as filed, or the incident opens |

Packs may set tighter ladders per forum. Regulatory and contractual deadlines use their source module's windows where tighter.

### Change control (D4)

| Change | Control |
| --- | --- |
| Move earlier; add reminders, owners or tasks | Owner alone |
| Move later; mark not applicable | Owner and responsible Partner, distinct people, written reason |
| Record an extension | Court order, consent order or permitted written agreement attached and hashed, then owner and Partner approval |
| Correct an error | Close as "Created in error" with owner and Partner approval; never delete |

### HTIL gate register

Gate classes are listed under Consolidation v1.1 in Document control.

| Gate | Decision | Gate type | Approver role | Ledger events |
| --- | --- | --- | --- | --- |
| G-05-01 | Confirm a proposed deadline (trigger and computation) | Single approver | State-matched reviewer (Engine D2) | `DEADLINE.CONFIRMED`, `DEADLINE.PROPOSAL_REJECTED` |
| G-05-02 | Resolve a source conflict | Single approver | State-matched reviewer | `DEADLINE.CONFLICT_RESOLVED` |
| G-05-03 | Move later, mark not applicable, or close as created in error | Dual distinct | Owner and responsible Partner | `DEADLINE.MOVED_LATER`, `DEADLINE.CLOSED_NOT_APPLICABLE`, `DEADLINE.CLOSED_IN_ERROR` |
| G-05-04 | Record an extension | Dual distinct, evidence required | Owner and responsible Partner | `DEADLINE.EXTENSION_RECORDED` |
| G-05-05 | Close as filed | Single approver, evidence required | Owner | `DEADLINE.CLOSED_FILED` |
| G-05-06 | Re-confirm after a rule change | Single approver | State-matched reviewer | `DEADLINE.RECONFIRMED` |
| G-05-07 | Resolve a missed-deadline incident | Dual distinct | Responsible Partner and General Counsel or managing partner | `DEADLINE.INCIDENT_RESOLVED` |
| G-05-08 | Decide whether to notify the professional-liability insurer | Single approver | Designated risk owner | `DEADLINE.INSURER_DECISION_RECORDED` |
| G-05-09 | Accept an AI-suggested checklist item | Single approver | Task owner | `DEADLINE.TASK_SUGGESTION_ACCEPTED` |
| G-05-10 | Enable client names in calendar events for a matter | Single approver | Responsible Partner | `DEADLINE.CALENDAR_DETAIL_ENABLED` |
| G-05-11 | Publish a new version of a forum rule set | Dual distinct | Jurisdiction Pack owner and counsel reviewer | `DEADLINE.RULESET_PUBLISHED` |

### Flow F1 — Notice to confirmed deadline

- **Entry:** a court notice arrives in the firm's mailbox, a cause list updates, or a lawyer enters a trigger.
- **Step 1:** the Engine extracts trigger event and date, citing the passage.
- **Step 2:** the rules engine computes the deadline from the forum's rule set and shows its working.
- **Step 3:** the deadline goes live as "Unconfirmed" with owner and backup; alerts start.
- **Step 4:** a state-matched reviewer confirms or rejects (G-05-01); proposals due within 7 days use the fast lane.
- **Primary act:** the reviewer reads the cited passage beside the computation working, then decides.

> **Diagram:** Flow F1 · notice to confirmed deadline — rendered in the source Claude Doc: https://claude.ai/code/artifact/0c3b6c22-d02a-45a4-86e3-bced76ea6175

Confirmation removes the "Unconfirmed" label; it never switches alerts on.

### Flow F2 — Alert to closure

- **Steps:** the ladder runs; from T-7 the owner acknowledges with a status; escalation if unacknowledged; owner closes as filed with the filing receipt (G-05-05), or through G-05-03 or G-05-04.
- **Primary act:** the owner attaches the filing evidence and closes.

### Flow F3 — Extension

- **Steps:** owner attaches the order or permitted agreement; owner and Partner approve (G-05-04); the old deadline closes as extended and a new confirmed deadline replaces it, linked to the original.
- **Primary act:** the Partner reads the attached order before approving.

### Flow F4 — Missed-deadline incident

- **Entry:** T-0 passes without a filed outcome.
- **Steps:** incident opens; Partner, General Counsel or managing partner, and Compliance Officer notified immediately; relief options for the forum listed for counsel; risk owner records the insurer decision (G-05-08); incident closes with a resolution (G-05-07).
- **Primary act:** counsel reads the relief options and records the chosen course.

### Flow F5 — Rule change

- **Steps:** a new rule-set version is published (G-05-11), often after RegRadar confirms a rule amendment; open deadlines computed under the old version are flagged; reviewers re-confirm (G-05-06).
- **Primary act:** the reviewer compares old and new computation side by side.

### Flow F6 — Hearing preparation

- **Steps:** a hearing is confirmed; the forum's template checklist creates tasks, each due no later than the hearing; the Engine suggests extra items; the owner accepts or ignores them (G-05-09).
- **Primary act:** the owner reviews the checklist and assigns tasks.

### Screen inventory for UX (FLAG-007)

| Screen | Flow / gate | Primary act |
| --- | --- | --- |
| SCR-05-01 My deadlines | F2 | Read and acknowledge upcoming deadlines by urgency |
| SCR-05-02 Deadline detail | F1–F3 | Read source, computation working, history and tasks; act |
| SCR-05-03 Confirmation queue | F1, G-05-01, G-05-02 | Compare cited passage and working, then confirm, reject or resolve conflict |
| SCR-05-04 Change request | G-05-03, G-05-04 | Give reason, attach evidence, submit for Partner approval |
| SCR-05-05 Partner approvals | G-05-03, G-05-04 | Read reason and evidence, then approve or decline |
| SCR-05-06 Missed-deadline incident | F4, G-05-07, G-05-08 | Read relief options, record decisions, resolve |
| SCR-05-07 Matter calendar and clash view | F2 | See all dates for a matter or team; rebalance clashes |
| SCR-05-08 Hearing preparation | F6, G-05-09 | Work the checklist; accept or ignore suggestions |
| SCR-05-09 Rule-set console | F5, G-05-11, G-05-06 | Review rule-set versions and pending re-confirmations |
| SCR-05-10 Compliance calendar (filtered view) | RegRadar D7 | Read regulatory deadlines with their obligations |
| SCR-05-11 Calendar publishing settings | D6, G-05-10 | Connect a tenant; set per-matter detail level |

## Section 4 — Data architecture

### Inputs

| Source | What enters |
| --- | --- |
| Firm mailbox via NexusConnect | Court notices (e.g. US Notices of Electronic Filing; Indian court notices and e-filing acknowledgements) |
| Permitted cause lists and case status, per forum | Hearing dates and listings, only where the court's terms allow automated retrieval |
| Registered court APIs (when available) | Case events and dates |
| Lawyers | Manual entries and triggers |
| Jurexio Engine (M03) | Extracted triggers with cited passages; checklist suggestions |
| RegRadar (M07) | Dated obligations from confirmed impacts |
| DataMigrate (M14) | Open deadlines from legacy systems (cutover blocker) |
| Jurexio Engine review SLAs | Deadline dependencies for review items |
| Jurisdiction Packs | Forum rule sets, holiday and vacation calendars, alert ladders, relief options, checklist templates |
| MatterCore (M01) | Matters, teams, responsible Partner |

### Outputs

| Destination | What exits |
| --- | --- |
| PulseComms (M12) | Alerts, acknowledgement requests, escalations, incident notices |
| Firm calendar tenant via NexusConnect | Read-only, minimal-content events |
| RegRadar (M07) | Status of obligation-linked deadlines |
| Jurexio Engine (M03) | Deadline caps for review SLAs |
| Jurexio Ledger (M09) | Every proposal, confirmation, change, alert, closure and incident |

### Core records

| Record | Key fields |
| --- | --- |
| Deadline | Matter, type, forum code, date, state, source (court notice, cause list, calculated, manual, linked module), last verified time, owner, backup, rule-set version, computation working, linked obligation or review |
| Trigger | Event, date, source document pointer, cited passage hash |
| Change | Before and after, reason, evidence pointer, approvers |
| Closure | Outcome, evidence pointer (filing receipt, order), closer |
| Incident | Deadline, notified parties, relief options shown, decisions, insurer decision, resolution |
| Task | Matter, parent deadline or hearing, owner, due date (never later than parent), outcome, origin (template or accepted suggestion) |
| Rule set | Forum code, version, effective date, rules, approvers |

### Ledger events

All events use the `DEADLINE.` domain and the M09 outbox.

| Family | Events |
| --- | --- |
| Capture | `DEADLINE.PROPOSED`, `DEADLINE.SOURCE_STALE`, `DEADLINE.CONFLICT_DETECTED`, `DEADLINE.CONFLICT_RESOLVED` |
| Confirmation | `DEADLINE.CONFIRMED`, `DEADLINE.PROPOSAL_REJECTED`, `DEADLINE.RECONFIRM_REQUIRED`, `DEADLINE.RECONFIRMED` |
| Alerts | `DEADLINE.ALERT_SENT`, `DEADLINE.ACKNOWLEDGED`, `DEADLINE.ESCALATED`, `DEADLINE.CLASH_DETECTED` |
| Changes | `DEADLINE.MOVED_EARLIER`, `DEADLINE.MOVED_LATER`, `DEADLINE.EXTENSION_RECORDED` |
| Closure | `DEADLINE.CLOSED_FILED`, `DEADLINE.CLOSED_NOT_APPLICABLE`, `DEADLINE.CLOSED_IN_ERROR` |
| Incidents | `DEADLINE.MISSED`, `DEADLINE.INSURER_DECISION_RECORDED`, `DEADLINE.INCIDENT_RESOLVED` |
| Tasks | `DEADLINE.TASK_CREATED`, `DEADLINE.TASK_SUGGESTION_ACCEPTED`, `DEADLINE.TASK_CLOSED` |
| Rules and calendars | `DEADLINE.RULESET_PUBLISHED`, `DEADLINE.CALENDAR_DETAIL_ENABLED` |

**Critical-class events:** moves later, extensions, closures as not applicable or in error, missed-deadline incidents and their resolution, insurer decisions, and rule-set publication.

The April events `DEADLINE.CREATED`, `DEADLINE.T3_ALERT`, `DEADLINE.MISSED` and `DEADLINE.EXTENDED` map to `DEADLINE.PROPOSED`, `DEADLINE.ALERT_SENT`, `DEADLINE.MISSED` and `DEADLINE.EXTENSION_RECORDED`.

### Data residency

- Deadlines, triggers and evidence stay in the matter's home region.
- Calendar events carry minimal content by default; when the firm's calendar tenant sits outside the matter's region, minimal content is mandatory.
- Mailbox ingestion runs in the matter's home region; notices that cannot be matched to a matter wait in an in-region intake queue.

### Availability and fail-safe behaviour

- The alert ladder runs on an independent, highly available scheduler in each region; alerts never depend on the Engine or on a court source being up.
- If PulseComms delivery fails, alerts retry on alternative channels and the failure escalates to the backup and Partner.
- If a court source stops responding, affected deadlines show "Stale" with the last verified time; they never silently stop updating.
- If the rules engine has no verified rule for a forum, the deadline requires manual entry and is flagged for the pack team.

## Section 5 — Compliance requirements

### Regulations and how M05 satisfies them

| Regulation / standard | Requirement | How M05 satisfies it |
| --- | --- | --- |
| ABA Model Rules 1.1 and 1.3 | Competence and diligence, including meeting deadlines | Owner and backup, acknowledged alert ladder, escalation, closure evidence (D3) |
| ABA Model Rule 1.4 and Formal Opinion 481 | Inform a client of material developments, including a material error by the lawyer | Missed-deadline incident prompts a client-notification decision for counsel (OQ-05-06) |
| ABA Model Rules 5.1 and 5.3; Formal Opinion 512 | Supervision of staff and AI tools | AI limited to trigger extraction; deterministic computation; state-matched confirmation |
| Federal Rule of Civil Procedure 6 and state equivalents | Rules for computing time periods | Encoded per forum in the rules engine with visible working (D1) |
| Limitation Act 1963 (India) and court rules | Computation of limitation, exclusions, court closures; condonation of delay | Encoded in India packs; condonation and other relief listed in the incident workflow |
| Advocates Act 1961 and BCI professional-conduct rules | Diligence and duty to the client | Same controls; Indian reviewers enrolled with a State Bar Council (Engine D2) |
| Court terms of use for online services | Lawful use of court portals | Only notices, permitted cause lists and registered APIs (R1) |
| Professional-liability insurance conditions | Prompt notice of circumstances that may lead to a claim | Insurer-notification decision recorded in every incident (G-05-08) |
| ABA Model Rule 1.6; BCI confidentiality; DPDP Act 2023 | Confidentiality of client information | Minimal-content calendar events; in-region processing (D6) |
| SOC 2 (CC7, CC8) | Monitoring and controlled change | Alert ladder, dual-control changes, complete event trail |

### Mandatory HTIL steps (never automated)

- Confirming every proposed deadline and resolving every conflict (G-05-01, G-05-02).
- Every later move, "not applicable" or "created in error" closure (G-05-03).
- Every extension, with evidence (G-05-04).
- Every filed closure, with evidence (G-05-05).
- Re-confirmation after a rule change (G-05-06).
- Missed-deadline resolution, insurer decision and client-notification decision (G-05-07, G-05-08).
- Accepting AI-suggested checklist items (G-05-09).
- Enabling client names in calendar events (G-05-10).
- Publishing a forum rule set (G-05-11).

### Decisions that must remain human

- Whether a trigger has really occurred, and on what date.
- Whether a computed deadline is correct for this forum and this matter.
- Whether a deadline may move later or no longer applies.
- What relief to seek after a miss, and whether to tell the insurer and the client.

The system acts automatically only to protect: starting alerts on proposals, applying the earliest date in a conflict, escalating, and opening incidents.

### Approved claims language

- "Every court date shown with its source and when it was last verified."
- "Deadlines computed by published court rules, with the working shown."
- "Alerts start the moment a deadline is detected."
- Prohibited: "real-time court sync", "AI calculates your deadlines", "never miss a deadline" as a guarantee, and any claim of coverage for a forum whose rule set is not yet verified.

## Section 6 — Module dependencies

### Upstream (M05 depends on)

| Dependency | What M05 needs |
| --- | --- |
| Jurexio Ledger Core (M09) | Outbox, registry, critical-event sealing |
| CommandCentre (M11) | Roles, reviewer jurisdiction scope, designated risk owner, Partner relationships |
| MatterCore (M01) | Matters, forum, teams, responsible Partner |
| Jurexio Engine (M03) | Trigger extraction and checklist suggestions under its gates |
| NexusConnect (M10) | Firm mailbox connector, permitted cause-list connectors, court API stubs, calendar tenant connectors |
| PulseComms (M12) | Multi-channel alert delivery with retries |
| DocVault (M02) | Storage of notices, filing receipts, orders and agreements as evidence |
| Jurisdiction Packs | Forum rule sets, holiday and vacation calendars, alert ladders, relief options, checklist templates (Raja Sekhar T) |

### Downstream (depend on M05)

- **RegRadar (M07):** dated obligations live as linked deadlines; the compliance calendar is a filtered view.
- **DataMigrate (M14):** open legacy deadlines must land here before cutover.
- **Jurexio Engine (M03):** review SLAs are capped by linked deadlines.
- **ClientBridge (M08):** may show clients confirmed hearing dates when the firm chooses.

### External integrations

| Integration | Purpose | Condition |
| --- | --- | --- |
| Firm mailbox (Microsoft 365 or Google Workspace) | Ingest court notices | Firm-authorised connector, in-region processing |
| Court cause lists and case status | Hearing dates | Only where terms permit automated retrieval (R1) |
| Court APIs (e.g. eCourts, PACER) | Case events | Only after registration; stubs until then |
| Firm calendar tenant | Publish read-only events | Minimal content rules (D6) |

### Agent touchpoints

Through the Jurexio Engine only: court-filing and cause-list-parser for trigger extraction; limitation-calculator is retired as a date calculator and becomes a trigger-identification aid only (D1). The UK and Singapore court agents stay inactive (Engine R7).

## Section 7 — v1.0 scope vs deferred scope

The v1.0 feature list is in Section 1.

### v1.0 build increments

| Increment | Contents | Unlocks |
| --- | --- | --- |
| Deadline Core | Registry, manual entry, owner and backup, alert ladder with acknowledgement and escalation, change control, closure with evidence, missed-deadline incident, linked deadlines from other modules, compliance-calendar view | Every module's dates; DataMigrate cutover |
| Computation | Rules engine, forum rule sets as each is verified, trigger extraction from notices, confirmation queue, conflict handling, re-confirmation on rule change | Automated capture and computation, forum by forum |
| Work and calendars | Matter tasks, template hearing checklists with AI suggestions, clash detection, one-way calendar publishing | Day-to-day preparation |

Deadline Core must be ready before DataMigrate's first cutover, because open legacy deadlines are a cutover blocker. Computation goes live per forum only when that forum's rule set is published (G-05-11).

### Release testing

- **Fail-safe:** a proposed deadline alerts before confirmation; delayed review never suppresses an alert.
- **Earliest date:** with conflicting sources, alerts run on the earliest date.
- **Computation:** a published test set per forum, including weekends, court holidays, vacations and service extensions, computes exactly; counsel signs off each forum's results.
- **No AI arithmetic:** no path lets the Engine set or change a date.
- **Change control:** later moves, extensions and closures cannot complete with one person; extensions cannot complete without evidence; nothing can be deleted.
- **Escalation:** unacknowledged alerts escalate on time; T-0 without a filed outcome opens an incident.
- **Delivery failure:** a failed channel retries and escalates.
- **Staleness:** a dead source shows "Stale", never "no change".
- **Calendar:** edits in Outlook or Google never change a deadline; client names never appear without opt-in, and never when the tenant region differs.

### Deferred scope

| Feature | Release trigger | Reason |
| --- | --- | --- |
| Automated retrieval from courts without permitted access | Court API registration or published terms permitting retrieval | Lawful sources only (R1) |
| Project-management features (boards, dependencies, resourcing) | None planned | Outside the module's purpose (D5) |
| Two-way calendar sync | None planned | Would bypass change control (D6) |
| UK, Singapore and other court calendars | Pack validated and activated by the Chairman | Built-inactive (Engine R7) |
| Mobile acknowledgement and closure | Mobile security review | Alerts reach mobile via PulseComms; closure needs evidence upload |

### Rejected (not deferred)

| Option | Reason |
| --- | --- |
| Scraping court portals | Terms-of-service and silent-failure risk (R1) |
| AI computing deadlines | Unreliable and unauditable arithmetic (D1) |
| Hiding unconfirmed deadlines | Creates the review-delay miss (D2) |
| Deleting deadlines | Destroys the record of what was owed (D4) |

## Section 8 — Open questions and blockers

### Gating item (read first)

Automated computation is only as good as the forum rule sets behind it. India and the US together have thousands of courts and tribunals, each with its own counting rules, holidays and vacations. DeadlineGuard can claim computation for a forum only once that forum's rule set is built, tested and signed off by counsel (G-05-11). Until then, deadlines in that forum are entered manually but still get the full alert, ownership and change-control protections. Forum coverage should be published and grow over time, never implied.

### Sequencing risk

DeadlineGuard is fifth in design order, but DataMigrate (second) cannot cut over until open legacy deadlines land here. Deadline Core must therefore be built before the first DataMigrate cutover, even though Computation can follow.

### Decisions requiring Chairman or CTO input

| # | Question | Owner | Recommendation |
| --- | --- | --- | --- |
| OQ-05-01 | Which forums get verified rule sets first | Chairman with Raja Sekhar T | The forums of the first three pilot clients, then the highest-volume courts in each launch state |
| OQ-05-02 | Confirmation SLA for proposed deadlines outside the 7-day fast lane | Chairman | 24 hours |
| OQ-05-03 | Who is the designated risk owner in each client firm | Client firm, configured in CommandCentre | Mandatory at onboarding |
| OQ-05-04 | What counts as valid extension evidence per forum | Raja Sekhar T with counsel | Court order everywhere; written agreement only where the forum's rules permit it |
| OQ-05-05 | Which court portals' terms permit automated retrieval | Counsel, per forum | Default to not permitted until reviewed |
| OQ-05-06 | Add a client-notification decision (ABA Formal Opinion 481; BCI duties) to the incident as gate G-05-12 | Chairman | Yes: a recorded human decision, never automatic |
| OQ-05-07 | Which mailboxes are read for court notices | Chairman | Designated docketing mailboxes only, not every lawyer's inbox |

### Compliance validations pending

- [ ] Counsel sign-off of each forum rule set and its test results.
- [ ] Review of court portal terms per forum (OQ-05-05).
- [ ] Relief options per forum written and reviewed for the incident workflow.
- [ ] Client-notification duty after a material error confirmed for India (OQ-05-06).

### Items blocking engineering start

- [ ] Chairman sign-off (consolidated end review).
- [ ] Jurexio Ledger Core (M09) live.
- [ ] CommandCentre (M11) roles, reviewer jurisdiction scope and risk-owner role frozen.
- [ ] MatterCore (M01) matter record carries forum code, team and responsible Partner.
- [ ] NexusConnect (M10) mailbox and calendar-tenant connectors available.
- [ ] PulseComms (M12) multi-channel delivery with retries.
- [ ] At least one forum rule set published, for Computation go-live.

### Housekeeping

- [ ] Retire "real-time sync with eCourts, HMCTS, PACER" from the Architecture Spec and both demos (R1).
- [ ] Replace "limitation period calculator" wording with "rules-based deadline computation" (D1).
- [ ] Remove the UK, Singapore and "6 jurisdictions" references from the M05 demo cards (Engine R7).
- [ ] Replace the demo's "Section 65B IEA ready" badge (M09 R3).
