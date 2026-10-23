<!-- Source of truth: https://claude.ai/code/artifact/08713ed2-aa2f-4250-a239-2870bae84206 · exported 21 Oct 2026 · do not edit here; edit the Claude Doc and re-export -->

# Module Specification — M08 ClientBridge

Oct 21, 2026 · @Suresh Singh

## Document control

| Field | Value |
| --- | --- |
| Module | M08 ClientBridge (Client and Stakeholder Portal) |
| Spec version | v1.0, written to the v1.1 platform rules (PDD Review Log, 18 Oct 2026); draft for Chairman approval |
| Design order | 16 (last module); specified ahead of pilot feedback by Chairman override |
| Engineering owner | CTO (Vamsi) |
| Jurisdiction Pack inputs | Raja Sekhar T (languages per pack, signature requirements, consent rules, layered jurisdiction model, location obligation applicability) |
| Status | Sign-off deferred to the consolidated end review. Expect a v1.1 after pilot feedback. |

### Jurisdiction baseline

India and the United States (all states) are the only live jurisdictions in v1.0. The UK, EU, Singapore and GCC packs are built as configuration but inactive until counsel-validated and activated by the Chairman (C-01). Languages go live with their jurisdictions.

### Platform rules (built in)

- **Gate outcomes:** every gate records approved, rejected and withdrawn outcomes as Ledger events; rejection needs a reason; event names are generated into Event registry v1. Every gate screen shows pending, approved, rejected and withdrawn.
- **Gate classes:** GUARDED = the requester can never approve; DUAL = two distinct people; SELF-ATTESTED = an act on one's own record, with reason and evidence, logged and sampled. The locked same-actor guard governs AI output approval.
- **Approvers** are named permissions in Permission catalogue v1; "Jurexio" marks platform roles; unprefixed roles are tenant roles.
- **Canonical events:** one act, one event, owned by the module that owns the record.
- **Doctrine:** status vocabulary Met, Due, At risk, Overdue, Not assessed; confidence bands 0.80 HIGH, 0.60–0.79 MEDIUM, below 0.60 LOW (review mandatory); AI badge Deep Indigo with Gold text; DOM absence for things a user may not see.

### Decision log

| ID | Locked decision |
| --- | --- |
| R1 | Two portal modes: external client mode (law firms' clients) and internal stakeholder mode (business requesters for in-house, PSU and government tenants). Corporate HR and Legal departments of Fortune 500 and multinational organisations are first-class users through CommandCentre's legal and HR domains. Location compliance owners per office or site receive their location's obligations, submit evidence and attestations, and see status; the corporate legal department sees all locations and decides what is Met. HR-matter participants (complainants, subjects, witnesses) are excluded in v1.0 and handled through logged channels. Separate contexts per client for people who serve several. |
| R2 | The Engine drafts plain-language summaries; the Responsible or designated partner approves every one, after a plain-language check that nothing material was dropped; LOW-confidence content is rewritten; labelling follows the firm's AI-disclosure policy; no live client AI chat in v1.0. |
| D1 | Publish-only: the portal is empty by default and the Responsible Partner enables each matter per contact. Publishable: curated status, release-checked documents, chosen key dates, approved updates, shared billing, the allow-listed trail, the team as the firm chooses. Location owners see only their location. Never: internal notes, drafts, unreviewed AI, conflict or wall data, other clients, firm profitability, protected-characteristic data. Unpublishing keeps the record of visibility. |
| D2 | Internal stakeholders and location owners through tenant single sign-on; corporate clients through their own identity provider or Jurexio accounts with mandatory MFA, partner-sponsored with expiry, client admin may request colleagues; individuals with MFA and verified identity. Step-up for instructions, consents and contact changes. Payment details never changed through the portal or messages; out-of-band verification. Read-only after closure, then expiry. Sign-in monitoring. |
| D3 | Messages threaded by matter or location, stored as locked privileged records; honest claim "encrypted in transit and at rest, under your organisation's keys" ("E2E" retired); AI-drafted replies only after lawyer approval; instruction-like messages converted to formal instruction records; response expectations shown; attachments through intake; reference-only notifications. |
| D4 | Firm-created structured requests for instructions, approvals, consents and attestations; responses with step-up, hashed exact version, identity and authority check; e-signature where law requires; sealed, revocable only by explicit revocation; consents feed MatterCore, the Engine, PulseComms and BillGuard; location attestations labelled "Attested", legal department decides Met with sampling; no AI acts on instructions. |
| D5 | All uploads through NexusConnect and DocVault intake (scan, quarantine, hash, locked Received originals); tied to a purpose (request, obligation evidence, general); requested uploads file automatically, general ones confirmed by the team; Confidential by default, a lawyer may raise; location evidence bound to its location; uploader sees status; size and type limits; bulk through the legal team. |
| D6 | Sealed invoices and credit notes only, when the firm enables billing visibility; client-money statement as of the last reconciled period, labelled; budget status where shared; whole or line-level disputes pause reminders and route to the Responsible Partner; corporate invoice approval as a structured instruction; verified bank details only, changes firm-side and dual-approved; "Pay now" only with a live Jurexio Pay edition. |
| D7 | Global multilingual design: every Jurisdiction Pack declares its languages; languages go live with their jurisdictions (v1.0: English, Hindi, Spanish); right-to-left layout, all scripts and local formats built in from v1.0; client content approved by verified language-competent reviewers; exact language version recorded for every instruction and consent, binding version identified; WCAG 2.1 AA; mobile-first web, no app required, low-bandwidth mode. Engine R2 still governs professional users. |
| Inherited | Every share needs Responsible Partner approval (M02 G-02-11). Client alerts only as partner-approved work (M07 D7); PulseComms delivers, never writes (M12 R1). Client-visible Ledger trail only on the counsel-approved allow-list (BQ-04). External users expire and need MFA (M11 D4, D5). Walls everywhere (M01 D5). AI review stamps show designations (M03 R3). BillGuard frozen contract for billing fields (M06). |

## Section 1 — Module identity

| Field | Value |
| --- | --- |
| Module | M08 ClientBridge |
| Code | `jrx-clientbridge.ts` |
| Tagline | What the client sees is deliberate, approved and provable; what the client says is recorded and authorised. |
| Job to be done | Give clients, business stakeholders and location compliance owners one secure place to see what their legal team has chosen to share, ask questions, give authorised instructions and consents, provide evidence, and settle billing questions, in their own language, with every exchange forming part of the legal record. |
| Modes | **External client** (law firms' clients: companies, individuals, family offices). **Internal stakeholder** (business requesters and location compliance owners in in-house, PSU and government tenants, including multinational corporate HR and Legal departments with many offices). |
| Primary users | Client contacts and their authorised signatories; business requesters; location compliance owners; on the firm side, Responsible Partners and matter teams who publish, respond and approve |
| Excluded in v1.0 | Participants in HR matters (complainants, subjects, witnesses) |
| Jurisdictions | India and the US live; English, Hindi and Spanish live in v1.0 |
| AI role | Drafts plain-language summaries, translations and reply drafts for lawyers to approve; never talks to clients directly, never sends, never acts on an instruction |

### v1.0 scope — in

- External client and internal stakeholder modes, with separate contexts per client (R1).
- Location compliance: location obligations from RegRadar, evidence requests, attestations, status per location, and an all-locations view for the legal department (R1, D4, D5).
- Approved plain-language summaries (R2).
- Publish-only visibility with honest unpublishing (D1).
- Identity paths, step-up, expiry, payment-detail protection, sign-in monitoring (D2).
- Matter- and location-threaded secure messaging, AI-drafted replies after lawyer approval (D3).
- Structured instructions, approvals, consents and attestations with authority checks and e-signature where required (D4).
- Uploads through intake, tied to purpose, location-bound evidence (D5).
- Sealed invoices, reconciled client-money statements, budget status, disputes, corporate invoice approval, verified payment details (D6).
- Multilingual interface and content, right-to-left and all scripts, WCAG 2.1 AA, mobile-first, low-bandwidth mode (D7).

### v1.0 scope — out

Deferred items and triggers are in Section 7.

## Section 2 — User stories

### US-08-01 Know where my matter stands

As a **corporate client's General Counsel**, I need a clear status of my matters with the documents my lawyers have shared so that I do not chase them by email.

- I see only matters and items the Responsible Partner has published to me.
- Status uses the platform vocabulary; updates are lawyer-approved.

### US-08-02 Understand my case in plain words

As an **individual client**, I need updates I can understand, in my own language, so that I know what is happening and what I must do.

- Updates are plain-language, approved by my lawyer, in English, Hindi or Spanish where available.
- Nothing material is left out of a simplified update.

### US-08-03 Give an instruction that counts

As a **client's authorised signatory**, I need to approve a settlement or filing formally so that my instruction is clear and provable.

- I see the exact text and documents I am approving, confirm with fresh authentication, and the record stores exactly what I saw, in the language I saw it.
- Only authorised signatories for my company can give that instruction.

### US-08-04 Comply at every site

As a **multinational's Head of Legal**, I need every office and plant to see and evidence the obligations that apply to it, under national, state and local law, so that I can prove compliance location by location.

- Each location's owner sees only their location's obligations and evidence requests.
- I see all locations in one view and decide what is Met.

### US-08-05 Prove my site's compliance

As a **plant manager** (location compliance owner), I need to upload certificates and attest to obligations for my site so that the legal team knows we are compliant.

- My uploads count only for my site unless Legal confirms otherwise.
- Attestations are labelled "Attested" until Legal decides.

### US-08-06 Ask the legal team for help

As a **business requester** in an in-house tenant, I need to raise a request and follow it so that I know when my contract review will be ready.

- I see requests I raised or am named on, nothing else.

### US-08-07 Talk to my lawyers securely

As a **client**, I need to message my legal team and know it is kept confidential so that I can speak freely.

- Messages are kept as privileged matter records, encrypted in transit and at rest.
- I am told expected response times and how to raise something urgent.

### US-08-08 Query a bill without being chased

As a **client's finance contact**, I need to dispute an invoice line so that the firm reviews it before chasing payment.

- My dispute pauses reminders and goes to the Responsible Partner; I see its status.

### US-08-09 Pay the right account

As a **client**, I need to know the firm's genuine bank details so that I never pay a fraudster.

- Bank details appear only on sealed invoices and the verified firm page; the portal tells me the firm never changes them by email.

## Section 3 — Portal controls and key user flows

### How something reaches a client

Nothing is visible until someone publishes it. Every item passes the module that owns it (DocVault's release check for documents, the Engine's review for AI summaries, BillGuard's seal for invoices), then the Responsible Partner publishes it to named contacts. Responses, consents and attestations flow back as structured, sealed records to the modules that depend on them.

> **Diagram:** Publish out, sealed responses back — rendered in the source Claude Doc: https://claude.ai/code/artifact/08713ed2-aa2f-4250-a239-2870bae84206

### Visibility model (D1)

| Item | Source | Rule |
| --- | --- | --- |
| Matter summary and milestones | Curated by the matter team | Status vocabulary only; never internal task lists |
| Documents | DocVault | Release check and Responsible Partner approval (G-02-11) |
| Key dates | DeadlineGuard | Only dates the partner selects; never internal review deadlines |
| Plain-language updates | Jurexio Engine | Approved under R2 |
| Invoices, statements, budget status | BillGuard frozen contract | Only where the firm enables billing visibility (D6) |
| Activity trail | Jurexio Ledger | Counsel-approved allow-list only (BQ-04) |
| Team | MatterCore | Names and contacts as the firm chooses; AI review stamps show designations |
| Location obligations and evidence requests | RegRadar | Only the owner's own location |

**Never visible:** internal notes, drafts, unreviewed AI output, conflict and wall data, other clients, firm profitability, protected-characteristic data.

### Access paths (D2)

| User | Sign-in | Lifecycle |
| --- | --- | --- |
| Internal stakeholders and location compliance owners | Tenant single sign-on and MFA | Tenant directory, joiner-mover-leaver rules |
| Corporate client contacts | Their identity provider, or Jurexio account with mandatory MFA | Partner-sponsored, expiring; client admin may request colleagues, firm approves |
| Individual clients | Jurexio account with MFA and verified contact details | Partner-sponsored, expiring; identity checked against party record and screening |

Step-up authentication is required to give instructions, approve settlements, sign consents and change contact details. Payment details can never be changed through the portal or messages.

### Structured requests (D4)

| Request type | Who may respond | Feeds |
| --- | --- | --- |
| Instruction (settle, file, sign, proceed) | Named authorised signatory for that client | Matter record; owning module |
| Conflict-waiver consent | Each affected client's authorised signatory | MatterCore G-01-04 |
| AI terms | Client's authorised signatory | Engine "AI prohibited" flag |
| Channel consent | The contact | PulseComms consent record |
| Client-money authority | Client's authorised signatory | BillGuard G-06-15 |
| Engagement letter acceptance | Authorised signatory; e-signature where required | MatterCore engagement record |
| Corporate invoice approval | Client's invoice approver | BillGuard invoice status |
| Location attestation | Location compliance owner | RegRadar obligation, as "Attested" until Legal decides |

### HTIL gate register

Every gate also records rejected and withdrawn outcomes (platform rule).

| Gate | Decision | Class | Approver role | Ledger events |
| --- | --- | --- | --- | --- |
| G-08-01 | Enable a matter for a client contact | GUARDED | Responsible Partner | `CLIENT.MATTER_ENABLED` |
| G-08-02 | Publish a status, date or update item, or set a standing publication rule | GUARDED | Responsible Partner | `CLIENT.ITEM_PUBLISHED` |
| G-08-03 | Approve a plain-language summary for a client | GUARDED (requester excluded) | Responsible or designated partner, through Engine G-03-01 | `CLIENT.SUMMARY_PUBLISHED` |
| G-08-04 | Approve a colleague requested by a client admin | GUARDED | Responsible Partner, then CommandCentre G-11-13 | `CLIENT.COLLEAGUE_APPROVED` |
| G-08-05 | Issue a structured request to a client or location owner | GUARDED for consents with legal effect | Responsible Partner, or legal department reviewer for location requests | `CLIENT.REQUEST_ISSUED` |
| G-08-06 | Respond to a request (instruct, approve, consent, attest) | SELF-ATTESTED, step-up, authority checked | The authorised client contact or location owner | `CLIENT.INSTRUCTION_GIVEN`, `CLIENT.CONSENT_GIVEN`, `CLIENT.ATTESTATION_SUBMITTED` |
| G-08-07 | Revoke an instruction or consent | SELF-ATTESTED, step-up | The authorised client contact | `CLIENT.REVOCATION_RECORDED` |
| G-08-08 | Decide an attested location obligation (Met or not) | GUARDED (attester excluded) | Legal department reviewer | `REGRADAR.OBLIGATION_STATUS_DECIDED` (RegRadar owns the record) |
| G-08-09 | Approve reuse of location evidence for another location | GUARDED | Legal department reviewer | `CLIENT.EVIDENCE_REUSE_APPROVED` |
| G-08-10 | Convert a client message into a formal instruction record | GUARDED | Lawyer on the matter | `CLIENT.INSTRUCTION_RECORDED` |
| G-08-11 | Send an AI-drafted reply | GUARDED | Lawyer on the matter, through Engine G-03-01 | `CLIENT.MESSAGE_SENT` |
| G-08-12 | Approve client-facing content in another language | GUARDED | Verified language-competent reviewer | `CLIENT.TRANSLATION_APPROVED` |
| G-08-13 | Change the firm's verified payment details | DUAL | Finance owner and managing partner | `CLIENT.PAYMENT_DETAILS_CHANGED` |
| G-08-14 | Unpublish an item | GUARDED | Responsible Partner | `CLIENT.ITEM_UNPUBLISHED` |
| G-08-15 | Suspend a client account on a security concern | GUARDED | Tenant security administrator | `CLIENT.ACCOUNT_SUSPENDED` |

### Flow F1 — Publish and inform

- **Steps:** matter enabled for a contact (G-08-01); items published by owning modules and the partner (G-08-02, G-02-11, G-08-03); a reference-only notice sent through PulseComms; the client signs in and reads.
- **Primary act:** the partner reads exactly what the contact will see before publishing.

### Flow F2 — Structured instruction

- **Steps:** the team issues a request (G-08-05); the client opens it in their language, reads the exact text and documents, authenticates again and responds (G-08-06); authority checked; e-signature where required; response sealed and routed to the owning module; the team is notified.
- **Primary act:** the authorised signatory reads the exact version before responding.

### Flow F3 — Location compliance (internal stakeholder mode)

- **Steps:** RegRadar maps obligations to each location by its jurisdiction layers (national, state, municipal) and attributes; owners see their obligations; Legal issues evidence requests (G-08-05); owners upload evidence and attest (D5, G-08-06); Legal decides each (G-08-08); the all-locations view shows status per site.
- **Primary act:** the legal reviewer reads the evidence before deciding Met.

### Flow F4 — Secure message

- **Steps:** the client writes in a matter thread; attachments pass intake; the team replies, optionally from an AI draft approved by a lawyer (G-08-11); instruction-like messages are converted to formal instructions (G-08-10); every message stored as a locked privileged record.
- **Primary act:** the lawyer decides whether a message is an instruction.

### Flow F5 — Invoice dispute

- **Steps:** the client opens a sealed invoice; disputes it or specific lines with a reason; BillGuard pauses reminders and routes it to the Responsible Partner; the outcome is published back.
- **Primary act:** the partner decides the dispute.

### Screen inventory for UX (FLAG-007)

| Screen | Flow / gate | Primary act |
| --- | --- | --- |
| SCR-08-01 Client home | F1 | See matters and items needing attention |
| SCR-08-02 Matter view | F1 | Read status, dates, documents, updates, team |
| SCR-08-03 Requests | F2, G-08-06, G-08-07 | Read and respond to instructions and consents |
| SCR-08-04 Messages | F4 | Read and write matter messages |
| SCR-08-05 Uploads | D5 | Upload against requests; see file status |
| SCR-08-06 Billing | F5 | Read invoices and statements; raise disputes; see verified payment details |
| SCR-08-07 My location (location owner) | F3 | See obligations, evidence requests and status for my site |
| SCR-08-08 All locations (legal department) | F3, G-08-08, G-08-09 | Review evidence and decide by location |
| SCR-08-09 Publishing console (firm side) | F1, G-08-01 to G-08-03, G-08-14 | Choose what each contact sees |
| SCR-08-10 Client access (firm side) | G-08-04, G-08-15 | Manage contacts, sponsors, expiry, suspensions |
| SCR-08-11 Language and accessibility settings | D7 | Choose language, low-bandwidth mode |

## Section 4 — Data architecture

### Inputs

| Source | What enters |
| --- | --- |
| MatterCore (M01) | Matters, parties, authorised signatories, engagement terms, team, home jurisdiction |
| DocVault (M02) | Released documents; intake results for uploads |
| Jurexio Engine (M03) | Approved plain-language summaries, approved reply drafts, approved translations |
| DeadlineGuard (M05) | Dates selected for publication |
| BillGuard (M06) | `invoice_record`, `client_money_balance` with `last_reconciled_period`, `budget_status` |
| RegRadar (M07) | Location obligations, evidence requests, status |
| Jurexio Ledger (M09) | Allow-listed activity trail entries |
| CommandCentre (M11) | Users, sponsors, expiry, units and locations, access decisions |
| Clients and stakeholders | Messages, uploads, responses, disputes, language choice |

### Outputs

| Destination | What exits |
| --- | --- |
| MatterCore | Conflict-waiver consents, engagement acceptance, instruction records |
| Jurexio Engine | AI-terms consent (sets or clears "AI prohibited") |
| PulseComms (M12) | Channel consents; client replies (through NexusConnect and DocVault intake) |
| BillGuard | `invoice_dispute`; client-money authority; corporate invoice approvals |
| RegRadar | Location attestations and evidence links |
| DocVault | Uploads and messages as matter records |
| Jurexio Ledger | Every publication, view of a sensitive item, request, response, revocation and access change |

### Interface contract

Fields ClientBridge produces for other modules. Frozen for v1.0; additive changes only; breaking changes need CTO approval and every consumer's owner. Consumed BillGuard fields follow M06's frozen contract.

| Field | Meaning | Consumers |
| --- | --- | --- |
| `client_response` | Request ID, type, response (approve, reject, question, attest), responder, authority basis, exact version hash, language version, step-up session, time | MatterCore, Engine, PulseComms, BillGuard, RegRadar |
| `client_revocation` | Original response ID, revoker, reason, time | Same as above |
| `invoice_dispute` | Invoice, lines, reason, raised-by, raised-at | BillGuard (pauses reminders) |
| `location_attestation` | Location, obligation, evidence links, attester, time; status "Attested" | RegRadar |
| `publication_record` | Item, contact, published-by, from and to times | Ledger, MatterCore timeline |

### Core records

| Record | Key fields | Where it lives |
| --- | --- | --- |
| Portal access | Contact, client, matters or locations, sponsor, expiry, MFA status | Contact's home region (CommandCentre D6) |
| Publication | Item reference, contact, publisher, visible from and to | Matter's region |
| Message | Thread, author, content, attachments, privilege label | Matter's region |
| Request and response | Type, exact content hash, language versions, responder, authority, step-up, seal | Matter's region |
| Location obligation view | Location, obligation reference, evidence, attestation, decision | Location unit's region |
| Dispute | Invoice, lines, reason, status | Billing entity's region (with matter-region detail per BillGuard D7) |

### Ledger events

All events use the `CLIENT.` domain. Rejected and withdrawn variants of every gate event are generated into Event registry v1.

| Family | Events |
| --- | --- |
| Access | `CLIENT.USER_INVITED`, `CLIENT.COLLEAGUE_APPROVED`, `CLIENT.SIGNED_IN`, `CLIENT.STEP_UP_COMPLETED`, `CLIENT.ACCOUNT_SUSPENDED`, `CLIENT.ACCESS_EXPIRED` |
| Publishing | `CLIENT.MATTER_ENABLED`, `CLIENT.ITEM_PUBLISHED`, `CLIENT.SUMMARY_PUBLISHED`, `CLIENT.ITEM_UNPUBLISHED`, `CLIENT.ITEM_VIEWED` (sensitive items) |
| Requests | `CLIENT.REQUEST_ISSUED`, `CLIENT.INSTRUCTION_GIVEN`, `CLIENT.CONSENT_GIVEN`, `CLIENT.ATTESTATION_SUBMITTED`, `CLIENT.REVOCATION_RECORDED`, `CLIENT.INSTRUCTION_RECORDED` |
| Messaging | `CLIENT.MESSAGE_RECEIVED`, `CLIENT.MESSAGE_SENT` |
| Uploads and evidence | `CLIENT.UPLOAD_RECEIVED`, `CLIENT.EVIDENCE_REUSE_APPROVED` |
| Billing and safety | `CLIENT.DISPUTE_RAISED`, `CLIENT.PAYMENT_DETAILS_CHANGED`, `CLIENT.PAYMENT_CHANGE_REQUEST_FLAGGED` |
| Language | `CLIENT.TRANSLATION_APPROVED`, `CLIENT.LANGUAGE_SELECTED` |

**Critical-class events:** instructions, consents, revocations, attestations, payment-detail changes, account suspensions.

### Residency

- Matter content, messages, requests and responses stay in the matter's home region.
- Location obligations and evidence stay in the location unit's region.
- Contact identities live in each contact's home region; cross-region access uses signed assertions (CommandCentre D6).

## Section 5 — Compliance requirements

India and the US are the live jurisdictions in v1.0; obligations for the other packs apply when they are activated.

### Regulations and standards, and how M08 satisfies them

| Regulation / standard | Requirement | How M08 satisfies it |
| --- | --- | --- |
| ABA Model Rule 1.4 and BCI duties to keep clients informed | Keep clients reasonably informed; explain enough for informed decisions | Publish-only status and approved plain-language updates in the client's language (R2, D1, D7) |
| ABA Model Rule 1.2 | The client decides key matters such as settlement | Structured instructions from authorised signatories, sealed with the exact version (D4) |
| ABA Model Rule 1.7(b) and state versions; BCI conflict rules | Informed consent to conflicts, confirmed in writing | Structured waiver consents feeding MatterCore G-01-04 (D4) |
| ABA Model Rule 1.6(c); BCI and other confidentiality rules | Reasonable safeguards for client information | Deny-by-default visibility, strong identity, step-up, privileged messaging, honest encryption claims (D1–D3) |
| Information Technology Act 2000 (India); US ESIGN and UETA | Valid electronic records and signatures | E-signature through DocVault D4 where required; hashed, sealed responses (D4) |
| Bharatiya Sakshya Adhiniyam s.63; FRE 902(13)/(14) | Integrity of electronic records | Locked, hashed messages, uploads and responses (D3–D5) |
| DPDP Act 2023 and Rules 2025 (India) | Clear consent and notices, available in English or a scheduled Indian language | Consents in the client's language with the exact version recorded (D4, D7) |
| US state privacy laws; GDPR when EU packs activate | Notice, consent, rights requests | Consent records; rights requests routed to the DPO |
| Labour, employment, environmental, company and other location-specific laws (national, state, municipal) | Comply at every establishment | Location obligations from RegRadar's layered packs; attestations decided by Legal (R1, D4) |
| Accessibility: ADA expectations (US), Section 508 for public bodies, India's RPwD Act 2016 and government web guidelines | Accessible digital services | WCAG 2.1 AA floor (D7) |
| Payment-fraud prevention (business email compromise) | Protect clients from diverted payments | Verified payment details only; no changes via portal or messages; dual-approved firm-side changes (D2, D6) |
| SOC 2 (CC6 logical access; CC7 monitoring) | External user access control and monitoring | Sponsored, expiring accounts with MFA; sign-in monitoring; suspension (D2) |

### Mandatory HTIL steps (never automated)

- Enabling matters, publishing and unpublishing items (G-08-01, G-08-02, G-08-14).
- Approving every client-facing summary, reply and translation (G-08-03, G-08-11, G-08-12).
- Approving colleagues requested by client admins (G-08-04).
- Issuing consent requests with legal effect (G-08-05).
- Converting messages to instructions (G-08-10).
- Deciding location obligations and evidence reuse (G-08-08, G-08-09).
- Changing verified payment details (G-08-13) and suspending accounts (G-08-15).

### Decisions that must remain human

- What a client sees and is told.
- Whether a message is an instruction, and acting on any instruction.
- Whether a location has met an obligation.
- Whether a translation says exactly what the original says.

### Approved claims language

- "Your clients see only what you choose to share, and every word they rely on is reviewed by a lawyer."
- "Every instruction and consent recorded exactly as the client saw it, in their language."
- "Encrypted in transit and at rest, under your organisation's keys."
- "Compliance proven location by location."
- Prohibited: "end-to-end encrypted", "real-time visibility into everything", "AI legal assistant for your clients", "covers all local laws", and any payment claim before a Jurexio Pay edition is live.

## Section 6 — Module dependencies

### Upstream (M08 depends on)

| Dependency | What M08 needs |
| --- | --- |
| CommandCentre (M11) | External and stakeholder identities, sponsors, expiry, step-up, access decisions, location units |
| MatterCore (M01) | Matters, parties, authorised signatories, engagement terms, walls |
| DocVault (M02) | Release check, intake for uploads and messages, e-signature |
| Jurexio Engine (M03) | Approved summaries, reply drafts and translations |
| DeadlineGuard (M05) | Dates chosen for publication |
| BillGuard (M06) | Frozen billing contract fields |
| RegRadar (M07) | Location obligations, evidence requests and status |
| Jurexio Ledger (M09) | Sealing; allow-listed client trail |
| NexusConnect (M10) | Inbound checks for replies and uploads; client identity providers |
| PulseComms (M12) | Reference-only notices to clients |
| Jurisdiction Packs | Languages, signature rules, consent rules, layered jurisdiction model |

### Downstream (depend on M08)

See the interface contract in Section 4: MatterCore (waivers, engagement acceptance, instructions), the Engine (AI terms), PulseComms (channel consents), BillGuard (disputes, client-money authority, invoice approvals) and RegRadar (attestations).

### Cross-module amendments from R1 (for the next consolidation pass)

| Module | Amendment |
| --- | --- |
| Jurisdiction Packs | Layered model: country → state or province → municipal or local body → industry or establishment type. Coverage at each layer declared publicly; municipal coverage starts with the cities where clients have offices |
| RegRadar (M07) | Lane B obligations mapped to each location by its jurisdiction layers and attributes (industry, headcount, establishment type, activities); location evidence requests and attestations through ClientBridge |
| CommandCentre (M11) | Units carry their full jurisdiction stack down to municipal level and their applicability attributes; new role template: Location Compliance Owner |
| Language packs (all modules) | Each Jurisdiction Pack declares its languages; ClientBridge interface supports any of them, including right-to-left and non-Latin scripts |

### Agent touchpoints

Through the Jurexio Engine only: plain-language summary, translation and reply-draft agents. Every output is reviewed by a lawyer or language reviewer before a client sees it; no agent talks to clients, sends messages or acts on instructions.

## Section 7 — v1.0 scope vs deferred scope

The v1.0 feature list is in Section 1. India and the US are live in v1.0, with English, Hindi and Spanish.

### v1.0 build increments

| Increment | Contents | Needed by |
| --- | --- | --- |
| Portal Core | Access paths, sponsorship and expiry, step-up, publish-only visibility, publishing console, documents through the release check, messaging, uploads through intake, sign-in monitoring | First client go-live |
| Requests and records | Structured instructions, consents, approvals and revocations, authority checks, e-signature routing, interface contract to consuming modules | First matter needing client instructions or consents |
| Billing view | Sealed invoices, reconciled statements, budget status, disputes, corporate approvals, verified payment details | BillGuard go-live |
| Location compliance | Location owner portal, evidence requests, attestations, all-locations legal view | First multinational or multi-site in-house client |
| Language and access | English, Hindi and Spanish interface; right-to-left and non-Latin script support; language-of-record capture; WCAG 2.1 AA; low-bandwidth mode | Go-live in India and the US |

### Release testing

- **Deny by default:** a new contact sees nothing until a matter is enabled and items are published.
- **No leakage:** internal notes, drafts, unreviewed AI output, conflict and wall data, other clients and protected-characteristic data never appear through any screen, export or notification.
- **Location isolation:** a location owner never sees another location's obligations or evidence.
- **Authority:** a contact without signatory authority cannot give an instruction for the client.
- **Exact version:** every response stores the hash and language of exactly what the responder saw.
- **No AI to clients:** no path lets the Engine message, answer or act for a client without lawyer approval.
- **Payment safety:** payment details cannot be changed through the portal or messages; a change request raises an out-of-band alert.
- **Disputes:** a dispute pauses BillGuard reminders within the target time.
- **Language:** right-to-left layout and non-Latin scripts render correctly on every screen and document, even before those languages go live.
- **Accessibility:** WCAG 2.1 AA checks pass on all client screens.
- **Expiry:** access becomes read-only after closure and expires on schedule.

### Deferred scope

| Feature | Release trigger | Reason |
| --- | --- | --- |
| Portal access for HR-matter participants | Signed client, separate design and counsel review | Confidentiality of investigations (R1) |
| Live client-facing AI chat | None planned under the AI doctrine | Unreviewed advice (R2) |
| Client self-service intake for new matters | MatterCore intake safeguards for prospective clients extended to the portal | Prospective-client duties (M01 D1) |
| "Pay now" | A live Jurexio Pay edition for that firm (M06 Section 7) | v1.0 moves no money |
| Two-way WhatsApp or chat-app messaging with clients | Consent and retention design per jurisdiction | Keeps conversations in the governed portal |
| Additional languages beyond English, Hindi and Spanish | Activation of their Jurisdiction Packs or a signed client | Languages go live with their jurisdictions (D7) |
| Native mobile apps | Usage evidence from pilots | Mobile-first web covers v1.0 |

### Rejected (not deferred)

| Option | Reason |
| --- | --- |
| Mirroring the internal matter to clients | One hiding-rule error exposes the matter (D1) |
| Magic-link or email-only sign-in | The mailbox is the attack vector (D2) |
| "End-to-end encrypted" claim | Inaccurate for a recorded, scanned, governed channel (D3) |
| Tick-box approvals | Weak evidence of authority and content (D4) |
| Uploads straight into matter records | Bypasses scanning and integrity (D5) |
| Live, unreconciled billing figures | Invites disputes (D6) |
| English-only client interface | Excludes the clients Jurexio's mission serves (D7) |

## Section 8 — Open questions and blockers

### Gating item (read first)

Location compliance (R1) depends on layered Jurisdiction Packs and RegRadar's per-location mapping, neither of which exists yet. For multinational clients, the portal's location features go live only for the jurisdiction layers whose coverage is declared. The first multinational pilot should be scoped to its actual office and plant locations, with central and state layers first and municipal coverage only for those cities.

### Decisions requiring Chairman or CTO input

| # | Question | Owner | Recommendation |
| --- | --- | --- | --- |
| OQ-08-01 | Read-only period after matter closure before client access expires | Chairman | 90 days, extendable by the Responsible Partner |
| OQ-08-02 | Default response-expectation text and urgent-contact guidance | Chairman | "One business day; for court-urgent matters call the number shown", editable per firm |
| OQ-08-03 | Which sensitive items record each client view (`CLIENT.ITEM_VIEWED`) | CTO with Compliance | Documents, instructions, consents and invoices; not routine status |
| OQ-08-04 | First multinational pilot and its locations | Chairman | One client with offices in at least two Indian states and two US states, to prove layered compliance |
| OQ-08-05 | Spanish interface in v1.0 for the US | Chairman | Yes, given US access-to-justice needs; reviewers verified in CommandCentre |
| OQ-08-06 | Client-side administrators for corporate clients: request-only, or limited self-management | Chairman | Request-only in v1.0 (the firm approves every colleague) |

### Compliance validations pending

- [ ] E-signature and consent-form requirements per pilot jurisdiction (with DocVault D4).
- [ ] DPDP notice and consent wording in English and Hindi.
- [ ] Accessibility review against WCAG 2.1 AA before go-live.
- [ ] Rules on who may give instructions for corporate clients (authorised signatory evidence) per jurisdiction.
- [ ] Layered jurisdiction model and municipal coverage plan (Raja Sekhar T with counsel).

### Items blocking engineering start

- [ ] Chairman sign-off (consolidated end review).
- [ ] CommandCentre external-user paths and step-up available (M11 D2, D4).
- [ ] BillGuard frozen contract and ClientBridge contract reviewed by consuming module owners.
- [ ] Localisation framework supporting right-to-left and non-Latin scripts.
- [ ] Layered Jurisdiction Pack model agreed (cross-module amendment).

### Housekeeping

- [ ] Retire "E2E encrypted", "real-time visibility" and "INTERNAL\_STAKEHOLDER mode for HR matters" from demos.
- [ ] Replace the Architecture Spec's "AI summary delivery" with approved plain-language updates (R2).
- [ ] Replace "Nyayavigya" and "P01-SIMPLE / P10-MENTOR" pattern references with Jurexio Engine wording.
