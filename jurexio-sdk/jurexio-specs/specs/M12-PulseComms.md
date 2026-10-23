<!-- Source of truth: https://claude.ai/code/artifact/51fc4128-2abe-4582-9210-9d178d726b63 · exported 21 Oct 2026 · do not edit here; edit the Claude Doc and re-export -->

# Module Specification — M12 PulseComms

Oct 18, 2026 · @Suresh Singh

## Document control

| Field | Value |
| --- | --- |
| Module | M12 PulseComms (notifications and client communications delivery) |
| Spec version | v1.1, consolidated after the PDD Review Log (18 Oct 2026); draft for Chairman approval |
| Design order | Third infrastructure module, after CloudVault and NexusConnect; before LexGraph |
| Engineering owner | CTO (Vamsi) |
| Jurisdiction Pack inputs | Raja Sekhar T (messaging rules, sender registration, template approvals, consent requirements, permitted hours, required-notice channels) |
| Status | Sign-off deferred to the consolidated end review. No engineering start before sign-off. |

### Jurisdiction baseline

India and the United States (all states) are the only live jurisdictions in v1.0, so channels, providers and messaging rules are needed for India and the US only. The United Kingdom, European Union, Singapore and GCC packs are built as configuration but inactive until counsel-validated and activated by the Chairman (C-01, 18 Oct 2026; supersedes the earlier six-active baseline).

### Decision log

| ID | Locked decision |
| --- | --- |
| R1 | PulseComms delivers; it never writes. System notices come only from fixed, human-authored templates approved per jurisdiction and language. Substantive client messages are created and partner-approved in their owning module before delivery. No agent ever sends a message. |
| R2 | Voice only as a content-free escalation channel for Critical items, for internal users who opt in. Fixed template with no matter details. Acknowledgement only by signing in with MFA. In-jurisdiction providers only. Client-facing voice and AI voice deferred. |
| D1 | Four message classes (action prompts, security and access, approved client communications, operational), each with a content ceiling per channel. Reference and link by default outside the app. No privileged attachments by SMS, WhatsApp or push. Lock-screen-safe wording. Minimum channel set per class. |
| D2 | Critical, High and Standard priorities. Critical: several channels, acknowledgement by sign-in, cross-channel escalation, voice as last resort, overrides quiet hours. Delivery evidence (sent, delivered, read, acknowledged) in the Ledger. Immediate re-route on failure. |
| D3 | Mandatory floors for Critical and High prompts and security notices; users choose only extra channels and quiet hours. Recorded per-channel client consent; instant opt-out. Legally required notices by the channel the law requires. Pack-driven sender, template and consent rules; non-compliant messages blocked. No marketing in v1.0. |
| D4 | Every client communication stored in DocVault as a locked, sealed matter record with delivery evidence. Replies return through per-matter reply addresses and NexusConnect checks. Privileged by default. Internal notices logged as events only. |
| D5 | Modules address roles; PulseComms resolves people at send time through the access decision, removing screened, departed, suspended and expired users. An empty result escalates and flags a routing failure. Named individuals for action prompts. Contacts from CommandCentre in the home region. Designations in external messages. |
| Inherited | Escalation ladders of DeadlineGuard D3, RegRadar D6 and Engine D6. Client alerts only as partner-approved work (RegRadar D7). Egress residency and references-not-content (NexusConnect D2). Controls are not settings (CommandCentre D7). Walls everywhere (MatterCore D5). |

### Consolidation v1.1 (PDD Review Log, 18 Oct 2026)

**Platform rules applied to this specification**

- **Gate outcomes (CB-ENG-06, CB-DES-05):** every gate records approved, rejected and withdrawn outcomes as Ledger events; rejection needs a reason; the gate engine generates the `_REJECTED` and `_WITHDRAWN` event names into Event registry v1. Every gate screen shows pending, approved, rejected and withdrawn.
- **Gate classes (I-05):** GUARDED = the requester can never approve; DUAL = two distinct people; SELF-ATTESTED = an act on one's own record, with reason, evidence and step-up where stated, logged and sampled by Compliance. The locked same-actor guard governs AI draft approval.
- **Approvers (C-02, CB-ENG-04):** every approver role maps to named permissions in Permission catalogue v1. "Jurexio" marks platform roles; unprefixed roles are tenant roles.
- **Canonical events (C-07, C-15):** one act produces one canonical event, owned by the module that owns the record; other context goes in attributes.
- **Design order (C-13):** the order specs were designed, not the engineering sequence, which the CTO publishes.

**Gate classes in this module**

| Class | Gates |
| --- | --- |
| GUARDED | G-12-02, G-12-05 |
| DUAL | G-12-01 |
| SELF-ATTESTED | G-12-03 (consent recorded with evidence), G-12-04 (own number, with step-up) |

**Module changes**

- **C-01:** templates, providers and messaging rules are required for India and the US only in v1.0.
- **BQ-29 (accepted):** a Critical item moves to the next channel after 15 minutes without acknowledgement in working hours, 30 minutes outside them.
- **BQ-30 (accepted):** English templates everywhere; Hindi content templates for India (the interface stays in English).
- **CB-ENG-10:** reassignment after a routing failure happens in the owning module; no generic gate reference is used.

## Section 1 — Module identity

| Field | Value |
| --- | --- |
| Module | M12 PulseComms |
| Code | `jrx-pulsecomms.ts` |
| Tagline | The right person, told the right amount, on the right channel, with proof they knew. |
| Job to be done | Deliver every alert, prompt and approved client communication to the right person through a channel that suits its sensitivity, escalate until someone acknowledges what is critical, and keep a provable record of who was told what and when. |
| Platform role | The single delivery service for all modules; composes nothing itself |
| Primary users | Every internal user (as recipients); tenant administrators (templates, channels, consent records); responsible Partners (approved client communications) |
| External recipients | Clients and other external parties, only for approved class 3 communications and legally required notices |
| AI role | None. PulseComms never writes or sends AI-generated text; it delivers content approved in owning modules |

### v1.0 scope — in

- Delivery service with role-based addressing resolved at send time through the access decision (D5).
- Template library: fixed, human-authored, versioned, approved per jurisdiction and language (R1).
- Four message classes with channel content ceilings and minimum channel sets (D1).
- Channels: in-app, email, SMS, push, WhatsApp Business where approved, and content-free voice for Critical escalation (D1, R2).
- Critical, High and Standard priorities; acknowledgement by sign-in; cross-channel escalation; quiet hours by unit calendar (D2).
- Delivery evidence: sent, delivered, read where supported, acknowledged (D2).
- User preferences within mandatory floors; digests for Standard notices (D3).
- Client consent records per channel; opt-out handling; pack-driven messaging rules with blocking (D3).
- Client communications stored as sealed matter records; per-matter reply addresses with replies returned to the matter (D4).
- Routing-failure detection and escalation (D5).

### v1.0 scope — out

Deferred items and triggers are in Section 7.

## Section 2 — User stories

### US-12-01 Be reached when it matters

As a **matter owner**, I need a critical deadline alert to reach me on more than one channel and keep trying until I acknowledge so that I cannot miss it.

- Critical alerts go to in-app, email and push or SMS at once.
- If I do not acknowledge in time, the next channel and my backup are tried; voice is the last resort.
- I acknowledge only by signing in.

### US-12-02 Keep my phone screen clean

As a **Partner**, I need notifications on my phone to show only a reference and a link so that client details never appear on my lock screen.

- SMS, push and WhatsApp carry the matter reference, type and date, never client names or content.
- The full detail opens inside Jurexio after sign-in.

### US-12-03 Control my own quiet hours

As an **associate**, I need to set quiet hours and choose extra channels so that routine notices do not overwhelm me.

- I can set quiet hours and digests for Standard notices.
- I cannot switch off Critical or High action prompts or security notices.

### US-12-04 Prove the client was told

As a **responsible Partner**, I need every message to my client kept in the matter with proof of delivery so that I can show exactly what the client was told and when.

- Each client communication is stored as a locked record with content, attachments, recipients, approver and delivery evidence.
- It appears on the matter timeline.

### US-12-05 Keep client replies in the matter

As a **paralegal**, I need client replies to land in the right matter so that conversations are not lost in personal inboxes.

- Replies to Jurexio messages arrive through per-matter reply addresses and are filed to the matter after NexusConnect's checks.

### US-12-06 Respect client consent

As a **Compliance Officer**, I need the system to send only through channels the client consented to and that local rules allow so that we never breach messaging law.

- Consent per channel is recorded with source, date and wording.
- An opt-out stops that channel immediately.
- A message that would break the pack's rules is blocked and logged.

### US-12-07 Never notify the wrong person

As a **conflicts reviewer**, I need screened lawyers excluded from every notification about walled matters so that the wall holds in messages too.

- Recipients are resolved at send time through the access decision.
- Screened, departed, suspended and expired users are removed.

### US-12-08 Catch an unowned alert

As a **Compliance Officer**, I need alerts with no remaining eligible recipient escalated to me so that nothing falls into a gap.

- An empty recipient result escalates to the next responsible role and flags a routing failure.

## Section 3 — Delivery controls and key user flows

### How a message is delivered

A module asks PulseComms to notify a role (for example "owner of deadline X") with a template or an approved communication. PulseComms resolves the role to eligible people, applies the class and channel rules, checks consent and pack rules, sends through NexusConnect, records delivery evidence, and escalates until a Critical item is acknowledged.

> **Diagram:** Delivery and escalation — rendered in the source Claude Doc: https://claude.ai/code/artifact/51fc4128-2abe-4582-9210-9d178d726b63

### Message classes and channel ceilings (D1)

| Class | Examples | In-app | Email | Push, SMS, WhatsApp | Voice |
| --- | --- | --- | --- | --- | --- |
| 1 Action prompt (internal) | Deadline reminder, review waiting, approval needed | Full detail | Reference, type, date, link | Reference and link only | Content-free (Critical only) |
| 2 Security and access | Sign-in alert, access expiring, elevation started | Full detail | Full detail, no secrets | Short notice and link | Not used |
| 3 Client communication (approved) | Matter update, regulatory alert, document shared | Full in ClientBridge | Approved content or secure link | Notice and secure link only | Not used |
| 4 Operational | Connector down, dead letter, drill result | Full detail | Summary and link | Only if Critical | Not used |

### Priorities (D2)

| Priority | Used for | Channels | Acknowledgement | Quiet hours |
| --- | --- | --- | --- | --- |
| Critical | Deadline T-1 or T-0 unacknowledged, confirmed sanctions match, chain break, kill-switch, missed-deadline incident | In-app, email and push or SMS together; voice last | Required, by sign-in | Overridden |
| High | Deadlines within 7 days, review SLA breaches, High regulatory alerts | In-app and email | Where the owning module requires | Respected, except where the module escalates |
| Standard | Routine prompts, digests | In-app and preferred channel | Not required | Respected |

### Recipient resolution (D5)

| Step | Rule |
| --- | --- |
| 1 Address | Modules address a role or responsibility, never an email address or number |
| 2 Resolve | PulseComms resolves people at send time through the central access decision |
| 3 Remove | Screened, departed, suspended and expired users are removed |
| 4 Empty result | Escalate to the next responsible role and flag a routing failure |
| 5 Contacts | Work channels from CommandCentre; personal numbers only if the user registered them; held in the home region |
| 6 External | Designations, not names, unless a named lawyer deliberately signs a letter |

### HTIL gate register

Approval of substantive client communications sits in the owning module (Engine G-03-01, RegRadar G-07-07, DocVault G-02-11). Channel enablement uses NexusConnect G-10-03. Gate classes are listed under Consolidation v1.1 in Document control.

| Gate | Decision | Gate type | Approver role | Ledger events |
| --- | --- | --- | --- | --- |
| G-12-01 | Publish a platform system-notice template version for a jurisdiction and language | Dual distinct | Jurexio Compliance and a qualified language reviewer | `PLATFORM.TEMPLATE_PUBLISHED` |
| G-12-02 | Adapt a template's wording for a tenant, within allowed fields | Single approver | Tenant Compliance Officer | `COMMS.TEMPLATE_ADAPTED` |
| G-12-03 | Record a client's channel consent, with evidence | Single approver | Matter team member | `COMMS.CONSENT_RECORDED` |
| G-12-04 | Register a personal number for SMS or voice escalation | Self, with step-up | The user | `COMMS.CONTACT_REGISTERED`, `COMMS.VOICE_OPT_IN` |
| G-12-05 | Resolve a routing failure | Single approver | Compliance Officer or unit administrator | `COMMS.ROUTING_FAILURE_RESOLVED` |

### Flow F1 — Critical alert

- **Steps:** a module raises a Critical item addressed to a role; recipients resolved; messages sent on in-app, email and push or SMS at once; delivery evidence recorded; no acknowledgement in the window → next channel and the module's escalation ladder; voice as last resort for opted-in users; acknowledgement by sign-in closes the cycle.
- **Primary act:** the recipient signs in and acknowledges the item.

### Flow F2 — Approved client communication

- **Steps:** content created and approved in its owning module; consent and pack rules checked; delivered by email or secure link with lock-screen-safe notices; stored in DocVault as a locked record with delivery evidence; appears on the matter timeline.
- **Primary act:** the Partner approves in the owning module; PulseComms only delivers.

### Flow F3 — Client reply

- **Steps:** client replies to a per-matter reply address or thread; NexusConnect authenticates and scans; DocVault files it to the matter (privileged by default); the matter owner is notified.
- **Primary act:** the matter owner reads the reply in the matter.

### Flow F4 — Blocked message

- **Steps:** a message would breach consent or a pack rule (unregistered sender, unapproved template, no consent, outside permitted hours); it is blocked and logged; the sender module is told; an alternative compliant channel is used where one exists.
- **Primary act:** the matter team records consent or chooses a compliant channel.

### Flow F5 — Routing failure

- **Steps:** a role resolves to nobody (e.g. owner and backup both left); the message escalates to the next responsible role; a routing failure is opened; the administrator assigns a new owner in the owning module and resolves it (G-12-05).
- **Primary act:** the administrator reads the failure and assigns an owner.

### Screen inventory for UX (FLAG-007)

| Screen | Flow / gate | Primary act |
| --- | --- | --- |
| SCR-12-01 Notification centre (in-app) | F1 | Read and acknowledge notifications by priority |
| SCR-12-02 My preferences | D3, G-12-04 | Choose extra channels, quiet hours, digests; register numbers |
| SCR-12-03 Client consent | G-12-03 | Record and view consent per client and channel |
| SCR-12-04 Templates | G-12-01, G-12-02 | View platform templates; adapt allowed wording |
| SCR-12-05 Delivery evidence | F1, F2 | See who was told what, how and when, per item |
| SCR-12-06 Blocked and failed messages | F4, F5, G-12-05 | Resolve blocks and routing failures |

## Section 4 — Data architecture

### Inputs

| Source | What enters |
| --- | --- |
| Modules (via the platform event bus) | Notification requests: role, class, priority, template or approved content, matter reference |
| Owning modules for client communications | Approved class 3 content with approver |
| CommandCentre (M11) | Access decisions, role resolution, work contacts, unit calendars and time zones |
| Users | Preferences within floors; registered personal numbers |
| Matter teams | Client consent records per channel |
| Jurisdiction Packs | Messaging rules, sender registrations, approved templates, permitted hours, required-notice channels |
| NexusConnect (M10) | Delivery receipts; inbound client replies (after checks) |

### Outputs

| Destination | What exits |
| --- | --- |
| Recipients (through NexusConnect) | Notifications and approved communications within channel ceilings |
| DocVault (M02) | Client communications as locked matter records; client replies for filing |
| Jurexio Ledger (M09) | Delivery evidence, acknowledgements, blocks, routing failures, consent changes |
| Owning modules | Acknowledgement and delivery status for their escalation ladders |

### Core records

| Record | Key fields | Where it lives |
| --- | --- | --- |
| Template | Class, jurisdiction, language, version, wording, lock-screen variant, approvers | Platform; tenant adaptations in tenant |
| Notification | Source module, role addressed, resolved recipients, class, priority, matter reference, template or content reference | Tenant region |
| Delivery attempt | Notification, recipient, channel, provider, status (sent, delivered, read), time | Tenant region |
| Acknowledgement | Notification, recipient, sign-in session, time | Tenant region |
| Preference | User, extra channels, quiet hours, digests | User's home region |
| Consent | External party, channel, source, wording, date, opt-out | Matter's region |
| Routing failure | Notification, role, reason, resolver, resolution | Tenant region |
| Reply address | Matter, address or thread identifier, status | Matter's region |

### Ledger events

| Domain | Events |
| --- | --- |
| `COMMS.` | `COMMS.NOTIFICATION_RAISED`, `COMMS.RECIPIENTS_RESOLVED`, `COMMS.SENT`, `COMMS.DELIVERED`, `COMMS.READ`, `COMMS.ACKNOWLEDGED`, `COMMS.ESCALATED`, `COMMS.CHANNEL_FAILED`, `COMMS.BLOCKED_BY_RULE`, `COMMS.ROUTING_FAILURE`, `COMMS.ROUTING_FAILURE_RESOLVED`, `COMMS.CLIENT_MESSAGE_SENT`, `COMMS.CLIENT_REPLY_RECEIVED`, `COMMS.CONSENT_RECORDED`, `COMMS.CONSENT_WITHDRAWN`, `COMMS.TEMPLATE_ADAPTED`, `COMMS.CONTACT_REGISTERED`, `COMMS.VOICE_OPT_IN` |
| `PLATFORM.` | `PLATFORM.TEMPLATE_PUBLISHED` |

**Critical-class events:** acknowledgement of Critical items, escalations of Critical items, client messages sent, consent withdrawals, blocks.

The April events `COMMS.NOTIFICATION_SENT`, `COMMS.DELIVERY_FAILED` and `COMMS.CLIENT_MESSAGE` map to `COMMS.SENT`, `COMMS.CHANNEL_FAILED` and `COMMS.CLIENT_MESSAGE_SENT`.

### Residency

- Notifications, delivery records and consent stay in the tenant's or matter's region.
- Outbound messages follow NexusConnect's egress rules: in-jurisdiction providers only; no foreign fallback.
- Personal contact details live in each user's home region (CommandCentre D6).

### Availability

- The notification service runs highly available in every region, as a Tier 0 dependency of the deadline alert scheduler (CloudVault D4).
- If a channel fails, the next approved channel is used immediately; if all external channels fail, in-app delivery continues and the failure escalates to administrators.

## Section 5 — Compliance requirements

India and the US are the live jurisdictions in v1.0, so the obligations below apply through their packs. Rows for the UK, EU, Singapore and GCC apply when those packs are activated.

### Regulations and standards, and how M12 satisfies them

| Regulation / standard | Requirement | How M12 satisfies it |
| --- | --- | --- |
| ABA Model Rule 1.4; BCI and other duties to keep clients informed | Communicate material developments to clients | Approved client communications delivered and stored with delivery evidence (D2, D4) |
| ABA Model Rule 1.6(c); BCI, SRA and other confidentiality rules | Reasonable safeguards for client information | Channel content ceilings, references not content, lock-screen-safe wording, walls in routing (D1, D5) |
| India: TRAI commercial communication regulations (DLT registration) | Registered senders and approved templates for SMS | Pack rules enforce registration and template approval; non-compliant messages blocked (D3) |
| US: Telephone Consumer Protection Act; CAN-SPAM Act | Consent for automated calls and texts; commercial email rules | Recorded consent; voice only for opted-in internal users; no marketing (R2, D3) |
| UK PECR; EU ePrivacy rules with GDPR | Consent and rules for electronic communications | Pack consent rules; transactional messages only (D3) |
| Singapore PDPA (Do Not Call provisions) | Restrictions on specified messages | Pack rules; no marketing (D3) |
| GCC telecommunications and messaging rules (e.g. UAE regulator rules) | Sender and consent requirements | Country-level pack rules (D3) |
| WhatsApp Business messaging policy | Opt-in; approved templates for business-initiated messages | Consent records; approved templates only (D3) |
| GDPR, UK GDPR, DPDP, PDPA, GCC data-protection laws | Minimisation, security, transfer conditions | Minimal content outside the app; in-jurisdiction providers (D1, NexusConnect D2) |
| SOC 2 (CC2 communication; CC7 monitoring) | Communicate security matters; monitor and respond | Security notices class with mandatory floors; Critical escalation with evidence (D1, D2) |

### Mandatory HTIL steps (never automated)

- Approving the content of every client communication, in its owning module (Engine G-03-01, RegRadar G-07-07, DocVault G-02-11).
- Publishing and adapting templates (G-12-01, G-12-02).
- Recording client consent (G-12-03).
- Resolving routing failures (G-12-05).
- Acknowledging Critical items, by signing in.

### Decisions that must remain human

- What a client is told.
- Whether a client has consented to a channel.
- Who takes over an item when its owners are gone.

The system acts alone only to protect: removing ineligible recipients, blocking non-compliant messages, escalating unacknowledged Critical items.

### Approved claims language

- "Critical alerts escalate across channels until someone acknowledges them, with proof."
- "Client details never appear on a lock screen."
- "Every client communication kept in the matter, exactly as sent."
- Prohibited: "AI-written client updates", "AI voice assistant", "guaranteed delivery" (delivery depends on external networks; acknowledgement is what is guaranteed to be tracked).

## Section 6 — Module dependencies

### Upstream (M12 depends on)

| Dependency | What M12 needs |
| --- | --- |
| Platform event bus (core) | Notification requests from every module |
| CommandCentre (M11) | Access decisions, role resolution, contacts, unit calendars |
| NexusConnect (M10) | Approved in-jurisdiction email, SMS, WhatsApp, push and voice providers; delivery receipts; inbound replies |
| DocVault (M02) | Storage of client communications as locked matter records; filing of replies |
| Jurexio Ledger Core (M09) | Sealing of delivery evidence |
| Jurisdiction Packs | Messaging rules, templates, permitted hours, required-notice channels |

### Downstream (depend on M12)

| Module | Dependency |
| --- | --- |
| DeadlineGuard (M05) | Alert ladder delivery and acknowledgement (Tier 0 path) |
| Jurexio Engine (M03) | Reviewer notifications and SLA escalation |
| RegRadar (M07) | Alert tiers, acknowledgements, client alerts after approval |
| Jurexio Ledger (M09) | Chain-break and anchoring alerts |
| CommandCentre (M11) | Security and access notices, recertification reminders |
| NexusConnect (M10) | Dead-letter and vendor-change owner alerts |
| ClientBridge (M08) | Notices and secure links to client portal content |

### Sequencing

In-app delivery, email, role resolution and the Critical acknowledgement path are needed before DeadlineGuard and the Engine go live, because their escalation ladders depend on them. SMS, WhatsApp, push and voice follow as approved providers become available per jurisdiction.

## Section 7 — v1.0 scope vs deferred scope

The v1.0 feature list is in Section 1. India and the US are live in v1.0; the other four packs are built as configuration and inactive.

### v1.0 build increments

| Increment | Contents | Needed by |
| --- | --- | --- |
| Alerting Core | Role addressing and resolution, template library, classes and ceilings, in-app and email, Critical acknowledgement by sign-in, escalation, delivery evidence, preferences within floors, routing failures | DeadlineGuard and Engine go-live |
| Mobile channels | Push, SMS, WhatsApp where approved, content-free voice escalation | As in-jurisdiction providers are approved |
| Client communications | Class 3 delivery, consent records, pack messaging rules with blocking, sealed matter records, per-matter reply addresses | Before the first client communication |

### Release testing

- **No authorship:** no path lets PulseComms or an agent compose or send unapproved substantive content.
- **Ceilings:** SMS, push and WhatsApp never carry client names, matter content or privileged attachments.
- **Floors:** users cannot disable Critical or High prompts or security notices.
- **Acknowledgement:** a Critical item is acknowledged only by signing in; links and replies do not count.
- **Escalation:** an unacknowledged Critical item moves to the next channel and the ladder on time; voice is used only for opted-in internal users and carries no matter detail.
- **Walls and leavers:** screened, departed, suspended and expired users never receive notices about the matter.
- **Routing failure:** a role resolving to nobody escalates and is flagged.
- **Consent and rules:** messages without consent or breaking a pack rule are blocked and logged.
- **Records:** every client communication is stored as a locked matter record with delivery evidence; replies land in the right matter.
- **Residency:** no message is sent through a provider outside the jurisdiction.

### Deferred scope

| Feature | Release trigger | Reason |
| --- | --- | --- |
| Client-facing voice calls | Client need and a confidentiality design | Voice exposes content to whoever answers (R2) |
| AI voice explaining matters | None planned under the AI doctrine | Same as R1 |
| Marketing communications | Separate product decision with consent regime design | Keeps PulseComms transactional (D3) |
| Two-way chat with clients over WhatsApp | ClientBridge specification after pilots | Conversations belong in the client portal with matter controls |

### Rejected (not deferred)

| Option | Reason |
| --- | --- |
| AI-written client messages sent automatically | Contradicts Engine R1, RegRadar D7 and "agents can never act" (R1) |
| Same content on every channel | Leaks privileged details to lock screens and carrier logs (D1) |
| Send-once-and-log for critical alerts | Proves sending, not knowing (D2) |
| Users switching off critical alerts | Breaks "controls are not settings" (D3) |
| Delivery logs as the only record of client communication | Vendor-held and incomplete (D4) |
| Module-chosen recipient addresses | Walls and departures would be missed (D5) |

## Section 8 — Open questions and blockers

### Gating item (read first)

Mobile channels depend on approved in-jurisdiction providers and on registrations that take time (for example sender and template registration for commercial SMS in India, and WhatsApp template approval). Until each is in place for a jurisdiction, Critical alerts there rely on in-app and email, and the pack must state which channels are available.

### Decisions requiring Chairman or CTO input

| # | Question | Owner | Recommendation |
| --- | --- | --- | --- |
| OQ-12-01 | Acknowledgement window before a Critical item moves to the next channel | Chairman | 15 minutes during working hours; 30 minutes outside them |
| OQ-12-02 | Default quiet hours | Chairman | Set per unit calendar; tenants may tighten |
| OQ-12-03 | Initial template set and languages per jurisdiction | Chairman with Raja Sekhar T | English everywhere; Hindi content templates for India packs; others as packs require |
| OQ-12-04 | Whether WhatsApp is offered to clients in v1.0 in any jurisdiction | Chairman | Offer only where consent and template approval are complete; otherwise email and secure link |
| OQ-12-05 | Retention of delivery evidence for internal notices | CTO with counsel | Same as the related record's retention; Critical evidence at least as long as the matter |

### Compliance validations pending

- [ ] Messaging rules per jurisdiction encoded in packs (sender registration, consent, permitted hours).
- [ ] Required-notice channels per jurisdiction (e.g. which notices must go by email or post).
- [ ] Lock-screen-safe wording reviewed per language.
- [ ] Provider agreements with in-jurisdiction processing for every channel (NexusConnect D1).

### Items blocking engineering start

- [ ] Chairman sign-off (consolidated end review).
- [ ] Platform event bus and CommandCentre role resolution available.
- [ ] Template library v1 approved for each jurisdiction and language.
- [ ] At least in-app and email approved in India and the US.

### Housekeeping

- [ ] Remove "AI-drafted client correspondence" and the voice agent from the Architecture Spec's PulseComms section (R1, R2).
- [ ] Replace "route to correct reviewer via agents\[\].escalationPath" with role resolution through the access decision (D5).
- [ ] Rename Nyayavigya references to Jurexio Engine.
