<!-- Source of truth: https://claude.ai/code/artifact/1a44678d-e737-4def-8797-4c5945e97e04 · exported 21 Oct 2026 · do not edit here; edit the Claude Doc and re-export -->

# Module Specification — M01 MatterCore

Oct 16, 2026 · @Suresh Singh

## Document control

| Field | Value |
| --- | --- |
| Module | M01 MatterCore |
| Spec version | v1.1, consolidated after the PDD Review Log (18 Oct 2026); draft for Chairman approval |
| Design order | 6 of 14 |
| Engineering owner | CTO (Vamsi) |
| Jurisdiction Pack inputs | Raja Sekhar T (home-jurisdiction rules, conflict rules, identifier types, closing and archive rules) |
| Status | Sign-off deferred to the consolidated end review. No engineering start before sign-off. |

### Jurisdiction baseline

India and the United States (all states) are the only live jurisdictions in v1.0. The United Kingdom, European Union, Singapore and GCC packs are built as configuration but inactive until counsel-validated and activated by the Chairman (C-01, 18 Oct 2026; supersedes the earlier six-active baseline). No live regional infrastructure is required for the inactive four in v1.0.

### Decision log

| ID | Locked decision |
| --- | --- |
| D1 | Restricted Intake stage under prospective-client duties; six-condition opening gate (conflicts, screening, home jurisdiction, team and walls, engagement and AI terms, billing), API-enforced and partner-approved. Declined intakes remain in the conflict database. Only protective deadlines during Intake. |
| D2 | Broad conflict search: identifiers, then name variants and transliterations, then AI-suggested links shown as suggestions. Every hit decided by the conflicts reviewer. Waivers need documented informed consent and dual approval. Automatic re-checks on new parties, laterals and corporate-family changes. |
| D3 | Single party register with roles per matter; explicit corporate families; per-jurisdiction identifiers; tokenised individuals; no deletion; human-approved, reversible merges. |
| D4 | Home jurisdiction proposed by pack rules and confirmed by the partner; one home per matter; change only by controlled transfer with legal basis and partner, DPO and Compliance approval; blocked transfers split into linked matters. |
| D5 | Ethical walls as a platform-wide access rule through one central check; walled matters absent for screened people; conflicts reviewer creates, dual approval to lift; effectiveness report; required notices as reviewed work. |
| D6 | Protected-characteristic data only when legally relevant, with stated basis; separate encrypted store; named access; every read logged; never available to AI; pack retention and crypto-shredding. |
| D7 | Intake → Active → Closing → Closed → Archived; seven closing pre-conditions; access narrows at close; walls permanent; reopening re-runs conflicts and screening. |
| Inherited | Matter reference `JRX-[JCN]-[TYPE]-[YYYYMM]-[NNNNN]` with ISO 3166 and forum codes. HR and legal isolation at the API layer. Every event follows Jurexio Ledger rules (M09). Every AI output touching a matter is human-reviewed (Engine R1). |

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
| GUARDED | G-01-01, G-01-02, G-01-03, G-01-05, G-01-07, G-01-09, G-01-10 (recorded entry confirmed by the Responsible Partner), G-01-11, G-01-12, G-01-13, G-01-14, G-01-15 |
| DUAL | G-01-04 (requester excluded), G-01-06 (three distinct), G-01-08 |
| SELF-ATTESTED | None |

**Module changes**

- **C-01:** two live jurisdictions; home-jurisdiction proposals and controlled transfers apply between India and the US only in v1.0.
- **C-04:** the central access decision is hosted by CommandCentre (M11); MatterCore owns and publishes the policy data it evaluates (parties, conflicts, walls, team, matter state, home jurisdiction). No module evaluates access itself.
- **CB-DES-01:** the open and close actions are state gates; for authorised users they show disabled with the unmet conditions listed. Users without the permission never see them.
- **CB-DES-02:** "green" in gate rules means Met in the locked status vocabulary (Met, Due, At risk, Overdue, Not assessed).
- **D-02:** `nv_pii_vault` is renamed in the rename register (proposed `jrx_pii_vault`; final name set by the CTO).
- **BQ-15 (accepted):** conflicts reviewer is the General Counsel or a designated senior partner, never the requesting or responsible partner.
- **BQ-16 (accepted, P0):** home-jurisdiction rules as recommended in OQ-01-02, encoded per pack by Raja Sekhar T with counsel.

## Section 1 — Module identity

| Field | Value |
| --- | --- |
| Module | M01 MatterCore |
| Code | `jrx-mattercore.ts` |
| Tagline | The controlled spine of every engagement: opened on verified facts, closed on settled obligations. |
| Job to be done | Give every legal and HR engagement a single governed record, so that no work begins before conflicts, screening, jurisdiction and terms are settled, and no matter closes while money, deadlines or obligations remain open. |
| Platform role | Issues and governs every `matter_id`; owns the party register, conflict engine and ethical walls used by every module |
| Matter types | LITIGATION, ARBITRATION, ADVISORY, TRANSACTIONAL, REGULATORY, COMPLIANCE, HR\_EMPLOYMENT |
| Primary users | Responsible Partners, intake and new-business staff, conflicts reviewer (conflicts counsel or General Counsel), lawyers and HR roles on their matters |
| Secondary users | Compliance Officer, Data Protection Officer, records roles (closed and archived matters) |
| Jurisdictions | India and the US (all states) live; UK, EU, Singapore and GCC built as configuration, inactive |
| AI role | Suggests possible related-entity links for conflicts and drafts notices and closing letters for review; never decides a conflict, a wall, an opening or a closing |

### v1.0 scope — in

- Intake stage with prospective-client protections and protective deadlines (D1).
- Opening gate with six conditions, enforced at the API (D1).
- Party register with roles per matter, corporate families, per-jurisdiction identifiers and tokenised individuals (D3).
- Conflict engine with layered matching, human decisions, documented waivers and automatic re-checks (D2).
- Home-jurisdiction proposal and confirmation; controlled transfer; linked-matter split (D4).
- Ethical walls with one central access check, approvals and effectiveness reports (D5).
- HR\_EMPLOYMENT matters with HR and legal isolation; protected-characteristic data only under D6.
- Matter team roster, responsible Partner and per-matter permissions.
- Engagement record, including the client's AI terms and the "AI prohibited" flag (Engine D7).
- Matter timeline across all modules.
- Closing stage with seven pre-conditions; archive; controlled reopening (D7).
- Budget record feeding BillGuard.

### v1.0 scope — out

Deferred items and triggers are in Section 7.

## Section 2 — User stories

### US-01-01 Take in a prospective matter safely

As an **intake lawyer**, I need to record a prospective matter with restricted access so that the prospect's information is protected before we decide to act.

- Intake records hold only what is needed to decide: parties, a summary, the proposed jurisdiction.
- No AI drafting, billing or deadline work during intake, except protective deadlines that alert.
- A declined intake is closed with a reason; its parties stay in the conflict database.

### US-01-02 Open a matter only on verified facts

As a **responsible Partner**, I need the matter to open only when all six conditions are met so that every downstream control starts on solid ground.

- The open action stays inactive until conflicts, screening, home jurisdiction, team and walls, engagement and AI terms, and billing are all recorded.
- Each condition shows its evidence in one click.
- I approve the opening; the event is sealed in the Ledger.

### US-01-03 Decide every conflict hit

As a **conflicts reviewer**, I need every potential conflict shown with its evidence so that I make, and record, each judgement.

- Hits come from identifiers, name variants, transliterations and corporate families; AI-suggested links are labelled as suggestions with reasons.
- I classify each hit: no conflict (with reason), conflict waivable, or conflict not waivable.
- Nothing clears without my decision.

### US-01-04 Proceed with a waiver properly

As a **responsible Partner**, I need a waiver to carry each affected client's informed consent so that the firm can defend the decision later.

- The signed consent from each affected client is attached and hashed.
- The waiver needs my approval and the conflicts reviewer's, as two different people.

### US-01-05 Screen a lateral hire

As a **conflicts reviewer**, I need to wall a lateral hire away from matters that conflict with their previous work so that the firm can keep acting.

- Walled matters disappear for the screened lawyer across every module, search and AI answer.
- Every blocked access attempt is logged; the wall's effectiveness report shows start date, people screened, attempts and signed acknowledgements.
- Any required notice to the former client is drafted for my approval.

### US-01-06 Set the right home jurisdiction

As a **responsible Partner**, I need a proposed home jurisdiction based on clear rules so that data, AI, reviewers and deadline rules all follow the right law.

- The proposal states its rule (forum, governing law and lead office, or work location).
- Changing it later is a controlled transfer, never an edit.

### US-01-07 Handle protected-characteristic data lawfully

As an **employment lawyer**, I need to record protected characteristics only when the matter is about them so that the firm and client avoid unnecessary sensitive data.

- There is no default field; I choose the legal basis when I record.
- The data is visible only to named people on the matter and never to AI.

### US-01-08 Close a matter cleanly

As a **responsible Partner**, I need the system to confirm everything is settled before closing so that nothing is left owing to the client or the court.

- Closing waits for: deadlines and tasks closed, client money settled, final bill, obligations resolved, AI reviews cleared, client file disposition recorded, closing letter approved.
- At close, access narrows to read-only for records roles and me; walls stay.

### US-01-09 Reopen without skipping checks

As a **responsible Partner**, I need reopening to re-run conflicts and screening so that a returning client is checked against today's facts.

- Reopening needs my approval and a reason.
- The system suggests opening a linked new matter where that fits better.

## Section 3 — Lifecycle, controls and key user flows

### Matter lifecycle (D1, D7)

| State | What is allowed | Exit |
| --- | --- | --- |
| Intake | Restricted record; conflict and screening runs; protective deadlines only | Opening gate (G-01-01) or decline (G-01-02) |
| Active | All modules: documents, AI, deadlines, billing, client portal | Closing initiated by the responsible Partner |
| Closing | No new work; outstanding items resolved | Seven pre-conditions met and close approved (G-01-13) |
| Closed | Read-only for the responsible Partner and records roles; retention clock running; walls in force | Archive after the pack's period, or reopening (G-01-14) |
| Archived | Cold storage in the same region; retrieval by records roles, logged | Reopening (G-01-14) |

> **Diagram:** Matter lifecycle — rendered in the source Claude Doc: https://claude.ai/code/artifact/1a44678d-e737-4def-8797-4c5945e97e04

A declined intake ends as **Declined** and stays restricted, with its parties in the conflict database.

### Opening gate: six conditions (D1)

| # | Condition | Evidence |
| --- | --- | --- |
| 1 | Conflicts cleared, or waived with documented consent | Conflict report and decisions (G-01-03, G-01-04) |
| 2 | Sanctions and KYC screening cleared | RegRadar screening record (RegRadar D5) |
| 3 | Home jurisdiction and forum code set | Confirmed proposal (G-01-05) |
| 4 | Responsible Partner, team and any walls set | Team roster; wall records (G-01-07) |
| 5 | Engagement terms recorded, including client AI terms | Engagement record; "AI prohibited" flag set or cleared (Engine D7) |
| 6 | Billing arrangement and billing code set | BillGuard record |

The gate is enforced at the API; the open action cannot be called while any condition is unmet.

### Closing: seven pre-conditions (D7)

| # | Pre-condition | Source |
| --- | --- | --- |
| 1 | Every deadline and task closed with an outcome | DeadlineGuard |
| 2 | Client-money balance zero, or returned or handled under pack rules for unclaimed funds | BillGuard |
| 3 | Final bill issued, or written off with approval | BillGuard |
| 4 | No open regulatory obligations, or each transferred or closed with an outcome | RegRadar |
| 5 | No pending AI reviews | Jurexio Engine |
| 6 | Client file disposition recorded: returned, retained or offered | MatterCore |
| 7 | Closing letter approved and sent | Jurexio Engine review; ClientBridge or PulseComms |

### Conflict hit classes (D2)

| Class | Meaning | Next step |
| --- | --- | --- |
| No conflict | Reviewer finds no conflict, with reason | Condition 1 green for this hit |
| Conflict, waivable | Conflict that informed consent can cure under the pack's rules | Waiver with signed consent and dual approval (G-01-04) |
| Conflict, not waivable | Cannot be cured | Matter cannot open; decline or restructure |

### HTIL gate register

Gate classes (GUARDED, DUAL, SELF-ATTESTED) are listed under Consolidation v1.1 in Document control.

| Gate | Decision | Gate type | Approver role | Ledger events |
| --- | --- | --- | --- | --- |
| G-01-01 | Open a matter | Single approver, all six conditions green | Responsible Partner | `MATTER.OPENED` |
| G-01-02 | Decline an intake | Single approver | Intake Partner | `MATTER.INTAKE_DECLINED` |
| G-01-03 | Classify a conflict hit | Single approver | Conflicts reviewer | `MATTER.CONFLICT_HIT_DECIDED` |
| G-01-04 | Approve a conflict waiver | Dual distinct, consent attached | Responsible Partner and conflicts reviewer | `MATTER.WAIVER_APPROVED` |
| G-01-05 | Confirm the home jurisdiction | Single approver | Responsible Partner | `MATTER.HOME_JURISDICTION_CONFIRMED` |
| G-01-06 | Approve a home-jurisdiction transfer or linked split | Three distinct approvers | Responsible Partner, Data Protection Officer, Compliance Officer | `MATTER.TRANSFER_APPROVED`, `MATTER.LINKED_SPLIT` |
| G-01-07 | Create or extend an ethical wall | Single approver | Conflicts reviewer | `MATTER.WALL_CREATED`, `MATTER.WALL_EXTENDED` |
| G-01-08 | Lift or narrow an ethical wall | Dual distinct, reason required | Conflicts reviewer and responsible Partner | `MATTER.WALL_LIFTED`, `MATTER.WALL_NARROWED` |
| G-01-09 | Approve a notice to a former client about a wall | Single approver (Engine G-03-01) | Responsible Partner | `MATTER.WALL_NOTICE_APPROVED` |
| G-01-10 | Record protected-characteristic data | Single approver, legal basis required | Named lawyer on the matter | `MATTER.SPECIAL_DATA_RECORDED` |
| G-01-11 | Merge or un-merge party records | Single approver | Conflicts reviewer | `MATTER.PARTY_MERGED`, `MATTER.PARTY_MERGE_REVERSED` |
| G-01-12 | Accept an AI-suggested related-entity link | Single approver | Conflicts reviewer | `MATTER.ENTITY_LINK_CONFIRMED` |
| G-01-13 | Approve closing | Single approver, seven pre-conditions met | Responsible Partner | `MATTER.CLOSED` |
| G-01-14 | Approve reopening | Single approver, conflicts and screening re-run | Responsible Partner | `MATTER.REOPENED` |
| G-01-15 | Approve the closing letter | Single approver (Engine G-03-01) | Responsible Partner | `MATTER.CLOSING_LETTER_APPROVED` |

### Flow F1 — Intake to open

- **Entry:** a prospective matter is recorded.
- **Steps:** parties captured into the party register; conflict check and screening run; home jurisdiction proposed with its rule; team, walls, engagement and AI terms, and billing recorded; Partner approves opening (G-01-01).
- **Primary act:** the Partner reads each of the six conditions and its evidence before opening.

### Flow F2 — Conflict review

- **Steps:** hits listed with match basis (identifier, variant, transliteration, family link, AI suggestion); reviewer classifies each (G-01-03); waivable conflicts proceed to waiver (G-01-04).
- **Primary act:** the reviewer reads both matters' context side by side before classifying.

### Flow F3 — Ethical wall

- **Steps:** reviewer creates the wall naming screened people and matters (G-01-07); screened lawyers sign acknowledgements; the central access check removes walled matters from every view; blocked attempts are logged; any required notice is drafted and approved (G-01-09).
- **Primary act:** the reviewer reads the wall's effectiveness report.

### Flow F4 — Home-jurisdiction transfer

- **Steps:** Partner requests a transfer with the legal basis; Partner, DPO and Compliance Officer approve (G-01-06); the move runs as a migration with hashes and reconciliation; if the transfer is legally blocked, the matter is split into linked matters instead.
- **Primary act:** the DPO reads the stated legal basis for both jurisdictions before approving.

### Flow F5 — Closing

- **Steps:** Partner starts closing; the system lists the seven pre-conditions with status; owners resolve open items; Partner approves the closing letter (G-01-15) and the close (G-01-13); access narrows and the retention clock starts.
- **Primary act:** the Partner reads each pre-condition's evidence before closing.

### Flow F6 — Reopening

- **Steps:** Partner requests reopening with a reason; conflicts and screening re-run; the system suggests a linked new matter if more suitable; Partner approves (G-01-14).
- **Primary act:** the Partner reads the fresh conflict and screening results before deciding.

### Screen inventory for UX (FLAG-007)

| Screen | Flow / gate | Primary act |
| --- | --- | --- |
| SCR-01-01 Matter list | All | Find matters by state, type, jurisdiction and Partner |
| SCR-01-02 Intake | F1, G-01-02 | Capture the prospective matter and parties |
| SCR-01-03 Opening gate | F1, G-01-01, G-01-05 | Read six conditions and evidence; confirm jurisdiction; open |
| SCR-01-04 Conflict review | F2, G-01-03, G-01-12 | Compare hits in context and classify |
| SCR-01-05 Waiver | F2, G-01-04 | Attach consents and approve |
| SCR-01-06 Party register | G-01-11, G-01-12 | View a party's roles, family and identifiers; merge or link |
| SCR-01-07 Matter overview | All | Read team, terms, timeline and linked records |
| SCR-01-08 Ethical walls | F3, G-01-07 to G-01-09 | Create, extend or lift walls; read effectiveness reports |
| SCR-01-09 Jurisdiction transfer | F4, G-01-06 | State legal basis; approve or split |
| SCR-01-10 Protected-characteristic record | G-01-10 | Record with legal basis; view access log |
| SCR-01-11 Closing | F5, G-01-13, G-01-15 | Resolve pre-conditions; approve letter and close |
| SCR-01-12 Reopening | F6, G-01-14 | Read fresh checks; reopen or link |

## Section 4 — Data architecture

### Inputs

| Source | What enters |
| --- | --- |
| Intake users | Prospective matter details and parties |
| RegRadar (M07) | Screening results for parties |
| CommandCentre (M11) | Users, roles, HR and legal domains, lateral-hire disclosures, risk and conflicts roles |
| BillGuard (M06) | Billing arrangement, billing code, client-money and final-bill status |
| DeadlineGuard (M05) | Open deadlines and tasks per matter |
| Jurexio Engine (M03) | Suggested related-entity links; drafts of notices and closing letters; pending reviews per matter |
| DataMigrate (M14) | Legacy parties and matters into the register |
| Jurisdiction Packs | Home-jurisdiction rules, conflict rules, identifier types, archive periods, unclaimed-funds rules |

### Outputs

| Destination | What exits |
| --- | --- |
| All modules | `matter_id`, matter state, home jurisdiction, forum code, team, and the central access decision (walls, HR and legal isolation, matter access) |
| Jurexio Engine (M03) | Matter context; "AI prohibited" flag; retrieval permissions |
| Jurexio Ledger (M09) | Every intake, opening, conflict decision, wall change, transfer and closing; retention clock start at close |
| ClientBridge (M08) | Matters and roles visible to clients |
| CloudVault (M13) | Archive moves within the region |

### Party model (D3)

| Record | Key fields |
| --- | --- |
| Party | Party type (individual or organisation), display name token, party jurisdiction, status; never deleted |
| Party identifier | Party, identifier type (e.g. CIN, PAN, GSTIN, EIN, UK company number, UEN, trade licence), value, issuing jurisdiction |
| Corporate link | Parent, child, relationship (subsidiary, affiliate), ownership percentage, effective from and to |
| Matter role | Matter, party, role (client, adverse party, co-party, opposing counsel, witness, expert, regulator, arbitrator, judge), from and to |
| Party merge | Surviving and merged party, approver, reversible flag |

Individuals' names and contact details are tokens resolved through `nv_pii_vault`. This register replaces the `jrx.clients` design on hold and is the target model for DataMigrate.

### Matter records

| Record | Key fields |
| --- | --- |
| Matter | Matter reference, type, state, home jurisdiction, forum code, responsible Partner, practice area, opened and closed dates |
| Engagement | Terms reference, client AI terms, "AI prohibited" flag, billing arrangement |
| Conflict check | Matter, run time, scope, hits |
| Conflict hit | Matched party, basis (identifier, variant, transliteration, family, AI suggestion), class, reviewer, reason |
| Waiver | Hit, consents (hashed documents), approvers |
| Ethical wall | Screened people, walled matters, reason, start, acknowledgements, blocked-attempt log |
| Transfer | From and to jurisdiction, legal basis, approvers, migration reference, or linked-split reference |
| Closing record | Pre-condition statuses and evidence, file disposition, closing letter, approver |
| HR matter | Employment type, work location, subtype (no protected characteristics) |
| Special-category record | Separate encrypted store: matter, category, legal basis, named access list, read log |

**Schema changes for the CTO:** drop `protected_class_flags` from `jrx.hr_matters` (D6); replace the `jrx.clients` design with the party register (D3); keep `jrx.matter_role_grants` for cross-domain grants.

### Central access decision

One service, hosted by CommandCentre (M11) and using the policy data MatterCore owns, answers "may this person see or act on this matter?" for every module and for Engine retrieval. It evaluates, in order: HR and legal domain isolation, ethical walls, matter team and grants, matter state (read-only after close), and jurisdiction access. A "no" means the matter is absent from the caller's results, not shown as locked. Every refusal on a walled matter is logged to the wall.

### Ledger events

All events use the `MATTER.` domain and the M09 outbox.

| Family | Events |
| --- | --- |
| Intake and opening | `MATTER.INTAKE_CREATED`, `MATTER.INTAKE_DECLINED`, `MATTER.HOME_JURISDICTION_CONFIRMED`, `MATTER.OPENED` |
| Conflicts | `MATTER.CONFLICT_CHECK_RUN`, `MATTER.CONFLICT_HIT_DECIDED`, `MATTER.WAIVER_APPROVED`, `MATTER.CONFLICT_RECHECK_TRIGGERED` |
| Parties | `MATTER.PARTY_CREATED`, `MATTER.PARTY_MERGED`, `MATTER.PARTY_MERGE_REVERSED`, `MATTER.ENTITY_LINK_CONFIRMED`, `MATTER.ROLE_ADDED` |
| Walls | `MATTER.WALL_CREATED`, `MATTER.WALL_EXTENDED`, `MATTER.WALL_NARROWED`, `MATTER.WALL_LIFTED`, `MATTER.WALL_ACCESS_BLOCKED`, `MATTER.WALL_NOTICE_APPROVED` |
| Team and terms | `MATTER.TEAM_CHANGED`, `MATTER.ENGAGEMENT_RECORDED`, `MATTER.AI_TERMS_CHANGED` |
| Jurisdiction | `MATTER.TRANSFER_APPROVED`, `MATTER.TRANSFER_COMPLETED`, `MATTER.LINKED_SPLIT` |
| Special-category data | `MATTER.SPECIAL_DATA_RECORDED`, `MATTER.SPECIAL_DATA_READ`, `MATTER.SPECIAL_DATA_SHREDDED` |
| Closing | `MATTER.CLOSING_INITIATED`, `MATTER.CLOSING_LETTER_APPROVED`, `MATTER.CLOSED`, `MATTER.ARCHIVED`, `MATTER.REOPENED` |

**Critical-class events:** opening, waivers, wall creation and lifting, AI-terms changes, transfers and splits, special-category records and reads, closing, reopening.

### Data residency

- A matter and everything attached to it live in the home jurisdiction's region.
- The party register is regional: a party used in several jurisdictions has a record in each, linked by a cross-region reference that carries no personal data. Conflict checks across regions use federated queries returning match indicators only.
- Special-category data never leaves the matter's region and is excluded from federated queries.

## Section 5 — Compliance requirements

India and the US are the live jurisdictions in v1.0, so the obligations below apply through their packs. Rows for the UK, EU, Singapore and GCC apply when those packs are activated.

### Regulations and how M01 satisfies them

| Regulation / standard | Requirement | How M01 satisfies it |
| --- | --- | --- |
| ABA Model Rule 1.18 (and US state versions) | Duties to prospective clients, including confidentiality | Restricted Intake stage; declined intakes kept restricted (D1) |
| ABA Model Rules 1.7, 1.9, 1.10 | Current and former client conflicts; imputation; screening and notice for laterals | Broad conflict search, human decisions, documented waivers (D2); walls with notice where required (D5) |
| ABA Model Rule 1.16(d) | Return of client papers and property on termination | Client file disposition is a closing pre-condition (D7) |
| ABA Model Rule 1.15 and state trust rules | Safekeeping and accounting of client money | Client money settled before closing (D7) |
| Advocates Act 1961 and BCI professional-conduct rules | Conflicts and confidentiality for Indian advocates | India pack conflict rules; same controls |
| SRA Code of Conduct for Solicitors (UK) | Conflicts, confidentiality and information barriers | UK pack conflict rules; walls as effective barriers |
| Singapore Legal Profession (Professional Conduct) Rules 2015 | Conflicts and confidentiality | Singapore pack rules |
| EU member-state and GCC bar rules | Conflicts and confidentiality | Pack rules per state, counsel-validated |
| GDPR and UK GDPR (Articles 5, 9, 44–49) | Data minimisation; special-category data; transfer conditions | No default protected-characteristic field; isolated store (D6); controlled transfers with legal basis (D4) |
| DPDP Act 2023 and Rules 2025 (India) | Purpose limitation, security, transfer conditions | Same controls; India region residency |
| Singapore PDPA 2012; GCC data-protection laws (e.g. UAE and Saudi PDPL) | Consent and purpose limits; transfer restrictions | Same controls per pack |
| EU AI Act (high-risk employment uses) | Human oversight; no discriminatory use of protected characteristics | Protected characteristics never available to AI (D6); HR outputs human-reviewed (Engine R6) |
| Anti-discrimination law (e.g. US Title VII and ADA, UK Equality Act 2010) | No adverse decisions based on protected characteristics | Protected data kept separate from HR decision records and from AI |
| Sanctions laws in each jurisdiction | No dealings with designated persons | Screening is an opening condition (D1) |

### Mandatory HTIL steps (never automated)

- Opening and declining matters (G-01-01, G-01-02).
- Every conflict decision and waiver (G-01-03, G-01-04).
- Confirming and transferring home jurisdiction, and linked splits (G-01-05, G-01-06).
- Creating, extending, narrowing and lifting walls, and approving wall notices (G-01-07 to G-01-09).
- Recording protected-characteristic data (G-01-10).
- Merging parties and accepting AI-suggested entity links (G-01-11, G-01-12).
- Closing, reopening and approving closing letters (G-01-13 to G-01-15).

### Decisions that must remain human

- Whether a conflict exists and whether it can be waived.
- Whether two records are the same party, or two entities are related.
- Which jurisdiction a matter belongs to, and whether it may move.
- Who must be screened, and when a screen can end.
- Whether a matter is ready to open or close.

### Approved claims language

- "No matter opens until conflicts, screening, jurisdiction and terms are settled."
- "Ethical walls enforced across every module and AI search, with a report proving it."
- "Protected characteristics never reach AI."
- Prohibited: "automatic conflict clearance", "AI conflict decisions", and any statement that a jurisdiction is live for client matters before its pack is counsel-validated.

## Section 6 — Module dependencies

### Upstream (M01 depends on)

| Dependency | What M01 needs |
| --- | --- |
| Jurexio Ledger Core (M09) | Outbox, registry, critical-event sealing; retention clock at close |
| CommandCentre (M11) | Users, roles, HR and legal domains, conflicts-reviewer and DPO roles, lateral-hire disclosures |
| RegRadar (M07) | Screening results (opening condition 2) |
| BillGuard (M06) | Billing setup (condition 6); client-money and final-bill status (closing) |
| DeadlineGuard (M05) | Open deadlines and tasks (closing); protective deadlines during Intake |
| Jurexio Engine (M03) | Entity-link suggestions; notice and closing-letter drafts; pending reviews |
| `nv_pii_vault` | Tokenisation of individuals |
| CloudVault (M13) | In-region archive storage |
| Jurisdiction Packs | Home-jurisdiction rules, conflict rules, identifier types, archive periods, unclaimed-funds rules |

### Downstream (depend on M01)

Every module: no module can act without a `matter_id` and the central access decision.

| Module | Dependency |
| --- | --- |
| DataMigrate (M14) | Party register as target model; conflict engine for the migration sweep |
| Jurexio Engine (M03) | Matter context, "AI prohibited" flag, retrieval permissions and walls |
| DeadlineGuard (M05) | Forum code, team and responsible Partner |
| DocVault (M02), BillGuard (M06), ClientBridge (M08) | Matter access and state |
| RegRadar (M07) | Matter hold and freeze on screening matches |

### Sequencing risk

MatterCore is design order 6, yet DataMigrate (2), the Jurexio Engine (3), RegRadar (4) and DeadlineGuard (5) all depend on its party model, matter record and access decision. The **party register, matter record and central access decision** must therefore be built in Sprint 1 alongside CommandCentre and Ledger Core, even if the rest of MatterCore follows.

### Agent touchpoints

Through the Jurexio Engine only: conflict-check-agent (suggested entity links, never decisions), matter-management-agent and legal-ops-agent (drafting notices and closing letters for review).

## Section 7 — v1.0 scope vs deferred scope

The v1.0 feature list is in Section 1. India and the US are live in v1.0; the other four packs are built as configuration and inactive.

### v1.0 build increments

| Increment | Contents | Needed by |
| --- | --- | --- |
| Matter Foundation | Party register, matter record with reference format, home jurisdiction, central access decision (domains, walls, team, state), basic team roster | Sprint 1, with CommandCentre and Ledger Core; every other module depends on it |
| Opening and Conflicts | Intake, conflict engine with re-checks, waivers, opening gate, engagement and AI terms, walls with effectiveness reports and notices | Before the first client matter goes live, and before DataMigrate's conflict sweep |
| Lifecycle Completion | Closing gate, archive, reopening, controlled jurisdiction transfer and linked split, special-category store, matter timeline | Before the first matter closes in production |

### Release testing

- **Opening gate:** the open action cannot be called through the UI or API with any condition unmet.
- **Intake protection:** no AI drafting, billing or non-protective deadline can attach to an intake.
- **Conflicts:** seeded conflicts via identifiers, name variants, transliterations and corporate families are all found; nothing clears without a reviewer.
- **Waivers:** cannot complete without attached consents and two distinct approvers.
- **Walls:** a screened user finds nothing about a walled matter through any module, search, calendar, notification, report or AI answer; every attempt is logged.
- **Re-checks:** adding a party, a lateral hire or a corporate-family change re-runs affected checks.
- **Jurisdiction:** the home jurisdiction cannot be edited directly; a transfer cannot run without three approvals and a stated legal basis.
- **Protected characteristics:** never appear in Engine retrieval or outputs; every read is logged.
- **Closing:** cannot close with any pre-condition unmet; access narrows on close; walls survive close and archive.
- **Reopening:** always re-runs conflicts and screening.
- **Pack gate:** a matter cannot open in a jurisdiction whose pack is not yet counsel-validated.

### Deferred scope

| Feature | Release trigger | Reason |
| --- | --- | --- |
| Automated conflict decisions | None planned | Conflict decisions are professional judgements (D2) |
| Client self-service intake through ClientBridge | ClientBridge specification and prospective-client safeguards approved | Intake must stay restricted under Rule 1.18 |
| Matter budgeting and forecasting beyond the budget record | BillGuard specification | Owned by BillGuard |
| Mobile matter opening and closing | Mobile security review | Gate evidence review needs a desktop |

### Rejected (not deferred)

| Option | Reason |
| --- | --- |
| Opening matters before checks | Downstream controls would start on unverified facts (D1) |
| Separate client and adverse-party tables | Fragments conflict search (D3) |
| Editable home jurisdiction | An edit would be an unplanned cross-border transfer (D4) |
| Walls as a flag each module interprets | Not an effective screen (D5) |
| Default protected-characteristic field | Unnecessary sensitive data and discrimination exposure (D6) |

## Section 8 — Open questions and blockers

### Decisions requiring Chairman or CTO input

| # | Question | Owner | Recommendation |
| --- | --- | --- | --- |
| OQ-01-01 | Who may act as conflicts reviewer in firms without conflicts counsel | Chairman | General Counsel or a designated senior partner, set at onboarding; never the requesting partner |
| OQ-01-02 | Home-jurisdiction proposal rules per matter type, for all six jurisdictions | Raja Sekhar T with counsel | Forum for litigation and arbitration; governing law and lead office for advisory and transactional; work location for HR |
| OQ-01-03 | Archive period after close, per jurisdiction | Raja Sekhar T | Set per pack; never shorter than the Ledger retention floor |
| OQ-01-04 | How long declined intakes stay in the conflict database | Chairman with counsel | For the full retention period of the jurisdiction |
| OQ-01-05 | Whether former-client notices for walls are required, per jurisdiction | Raja Sekhar T with counsel | Encode per pack; draft automatically where required |
| OQ-01-06 | Matter type list: is a PSU or government matter type needed (shown in the Vantara demo) | Chairman | Model PSU and government as client attributes, not new matter types, unless their workflows differ |

### Compliance validations pending

- [ ] Counsel validation of each jurisdiction's pack (conflict rules, identifier types, notice rules) before client matters go live there.
- [ ] Special-category data rules confirmed for each of the six jurisdictions (D6).
- [ ] Transfer mechanisms between each pair of jurisdictions confirmed (D4).
- [ ] Unclaimed client-funds rules per jurisdiction (closing pre-condition 2).

### Items blocking engineering start

- [ ] Chairman sign-off (consolidated end review).
- [ ] Jurexio Ledger Core (M09) and CommandCentre (M11) roles frozen.
- [ ] Party register replaces the `jrx.clients` hold (CTO).
- [ ] `protected_class_flags` dropped from `jrx.hr_matters` (CTO).
- [ ] Central access-decision service designed, so every module calls one check.
- [ ] `nv_pii_vault` available for tokenising individuals.
- [ ] Regional infrastructure for India and the US available (regions, keys, storage).

### Housekeeping

- [ ] Retire demo matter IDs (e.g. "M-2025-IN-4471") in favour of the locked reference format.
- [ ] Replace the undefined "review" lifecycle state in the Architecture Spec with "Closing" (D7).
- [ ] Update the Architecture Spec's M01 text from IronLedger and Nyayavigya to Jurexio Ledger and Jurexio Engine.
