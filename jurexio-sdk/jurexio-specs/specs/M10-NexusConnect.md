<!-- Source of truth: https://claude.ai/code/artifact/a41021c6-fbd2-4ab6-850e-16805424f9ec · exported 21 Oct 2026 · do not edit here; edit the Claude Doc and re-export -->

# Module Specification — M10 NexusConnect

Oct 18, 2026 · @Suresh Singh

## Document control

| Field | Value |
| --- | --- |
| Module | M10 NexusConnect (external boundary) |
| Spec version | v1.1, consolidated after the PDD Review Log (18 Oct 2026); draft for Chairman approval |
| Design order | Second infrastructure module, after CloudVault and before PulseComms |
| Engineering owner | CTO (Vamsi) |
| Jurisdiction Pack inputs | Raja Sekhar T (approved providers per jurisdiction, permitted court sources, declared regulatory sources) |
| Status | Sign-off deferred to the consolidated end review. No engineering start before sign-off. |

### Jurisdiction baseline

India and the United States (all states) are the only live jurisdictions in v1.0, so v1.0 connectors need approval for India and the US only. The United Kingdom, European Union, Singapore and GCC packs are built as configuration but inactive until counsel-validated and activated by the Chairman (C-01, 18 Oct 2026; supersedes the earlier six-active baseline); connectors for them are approved at activation.

### Decision log

| ID | Locked decision |
| --- | --- |
| R1 | Outbound calls through the gateway, plus controlled inbound accepted only from sources registered for the tenant and jurisdiction, with verified signatures or mutual TLS, replay protection and strict schema validation. SCIM uses the same path. No open partner API in v1.0. Two-way syncs treat inbound data as proposals validated by the owning module. Supersedes the earlier "outbound-only" decision. |
| R2 | v1.0 ships only connectors required by locked decisions: identity, mail and calendar, migration sources, e-signature, timestamping, regulatory sources and sanctions lists, permitted court sources, AI endpoints, messaging, document stores. Everything else on a signed-client trigger. |
| D1 | Two-level approval: platform approval (security review, vendor data processing agreement, data-flow declaration, per jurisdiction, dual approval) and tenant enablement (security administrator and DPO). Least-privilege scopes. Vaulted, rotating credentials. Lifecycle Proposed → Approved → Enabled → Suspended → Archived, with automatic suspension when unused; vendor changes re-open approval. |
| D2 | The gateway classifies every outbound payload. Client content and personal data go only to connectors approved for in-jurisdiction processing; anything else is blocked and logged. No fallback abroad. Minimal fields; references and links instead of content. Channels without a compliant provider are unavailable in that jurisdiction. |
| D3 | All inbound data untrusted until checked: authenticate, validate (schema, malware, injection), quarantine failures, verify state-changing events with the source, and hand off to the owning module. NexusConnect never writes a legal record. |
| D4 | The internal event bus is platform core infrastructure per region, built on the Ledger outbox, with ID-referenced minimal events and no content across regions. NexusConnect is the external boundary only; it subscribes to declared events and cannot publish internal state. |
| D5 | Durable regional outbound queue; retries with backoff and idempotency keys; central circuit breakers; dead-letter queue with owner alerts; fallback only to a second approved in-jurisdiction provider; business-aware escalation; visible connector health. |
| Inherited | Credentials encrypted in the regional vault; circuit breakers centralised; court APIs remain stubs until registered; DataMigrate connectors under the MIGRATION category (M14 R2); SharePoint, Drive and Box never the record (CloudVault R1); agents can never act (Engine D4). |

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
| GUARDED | G-10-06 (quarantine release; malware never released) |
| DUAL | G-10-01, G-10-02, G-10-03, G-10-04, G-10-09 |
| SELF-ATTESTED | G-10-05, G-10-07, G-10-08 |

**Module changes**

- **C-01:** vendor approvals (BQ-28) are needed for India and the US only in v1.0.
- **I-02 and CB-ENG-10:** the gate register is authoritative: archive is G-10-08, fallback pairing is G-10-09; references corrected.
- **CB-ENG-02:** the platform event bus is specified as an annex to the Ledger Core (M09), owned by the CTO.
- **C-16:** v1.0 SOC 2 evidence leaves as a tool-neutral export file; a GRC connector joins the deferred list, triggered by the Vanta or Drata choice (due about 14 Nov 2026).

## Section 1 — Module identity

| Field | Value |
| --- | --- |
| Module | M10 NexusConnect |
| Code | `jrx-nexusconnect.ts` |
| Tagline | The guarded border: only approved connections, only lawful data, nothing in without inspection, nothing lost on the way out. |
| Job to be done | Connect Jurexio to the outside world — identity providers, mailboxes, signing providers, timestamp authorities, regulators, courts, model endpoints, messaging and document stores — so that every connection is approved, every outbound payload respects residency, every inbound item is verified, and no external failure loses work. |
| Platform role | The only path between Jurexio and any external system; no module calls an external service directly |
| Primary users | Platform operations (Jurexio) for catalogue approval; tenant security administrators and DPOs for enablement |
| Indirect users | Every module that sends or receives external data |
| AI role | None. NexusConnect carries AI traffic to approved regional endpoints but makes no AI decisions |

### v1.0 scope — in

- Outbound gateway with payload classification and residency enforcement (D2).
- Controlled inbound endpoints for registered sources, with authentication, validation, quarantine and source verification (R1, D3).
- SCIM provisioning path for CommandCentre (R1).
- Connector catalogue with platform approval, data-flow declarations and per-jurisdiction approval (D1).
- Tenant enablement with security administrator and DPO approval; least-privilege scopes (D1).
- Regional credential vault with rotation and destruction at archive (D1).
- Connector lifecycle with automatic suspension (D1).
- Subscriptions to declared internal events, never publication of internal state (D4).
- Durable outbound queues, idempotency, circuit breakers, dead letters, approved fallbacks, escalation, health views (D5).
- The v1.0 connector set (R2): identity, Microsoft 365 and Google Workspace mail and calendar, CSV/Excel, file systems, Clio, iManage, in-region e-signature providers, RFC 3161 timestamp authorities, declared regulatory sources and licensed feeds, sanctions lists, permitted cause lists and case status, regional AI endpoints, regional email and SMS providers, WhatsApp Business where approved, SharePoint, Google Drive and Box for import and export.
- Court API stubs pending registration.

### v1.0 scope — out

Deferred items and triggers are in Section 7.

## Section 2 — User stories

### US-10-01 Approve a connector knowing where our data goes

As a **Data Protection Officer**, I need to see exactly what data a connector receives, why, where it is processed and for how long so that I can approve it for our records of processing.

- Every connector shows its data-flow declaration for our jurisdictions.
- It can be enabled only after our security administrator and I both approve.

### US-10-02 Grant only what is needed

As a **tenant security administrator**, I need each connection to ask for the narrowest access possible so that a compromised connection exposes as little as possible.

- A docketing-mailbox connection reads only the designated mailbox, never the whole tenant's mail.
- Scope changes need fresh approval and are logged.

### US-10-03 Keep outbound data in-country

As a **General Counsel**, I need notifications, signatures and AI calls processed only by in-jurisdiction providers so that our data is not exported through a vendor.

- Content and personal data go only to connectors approved for in-jurisdiction processing.
- If no compliant provider is available, the message waits or escalates; it is never rerouted abroad.

### US-10-04 Trust that a callback is real

As a **transactional lawyer**, I need a "signature completed" event checked with the signing provider before the contract is marked Executed so that a forged callback cannot change the record.

- The callback's signature is verified, then the completion certificate is fetched from the provider.
- Only then does DocVault lock the document as Executed.

### US-10-05 Keep malicious attachments out

As a **tenant security administrator**, I need every inbound attachment scanned so that malware and hidden AI instructions never reach our records.

- Attachments are scanned for malware and hidden text before any module sees them.
- Failures go to quarantine with the reason.

### US-10-06 Never lose an outbound message

As a **matter owner**, I need deadline notices and calendar updates delivered even if a vendor is down so that an outage never causes a miss.

- Every outbound request is stored before sending and retried without duplicates.
- If delivery keeps failing, an owner is alerted and the module's escalation applies.

### US-10-07 See integration health

As an **IT Director**, I need the status of every connector we use so that I know when something needs attention.

- Each enabled connector shows health, recent incidents, queued items and dead letters.

### US-10-08 Retire a connection cleanly

As a **tenant security administrator**, I need unused connections to suspend automatically and archived ones to lose their credentials so that no forgotten access remains.

- Unused connections suspend after the set period.
- Archiving destroys credentials, with a Ledger record.

## Section 3 — Boundary controls and key user flows

### The boundary

Modules talk to each other on the regional platform event bus (D4). NexusConnect sits at the edge: outbound traffic passes the gateway's classification, residency check and durable queue; inbound traffic passes authentication, validation and quarantine before reaching the owning module.

> **Diagram:** External boundary — rendered in the source Claude Doc: https://claude.ai/code/artifact/a41021c6-fbd2-4ab6-850e-16805424f9ec

### Connector lifecycle (D1)

| State | Meaning | Who moves it |
| --- | --- | --- |
| Proposed | Vendor under security review; data-flow declaration drafted | Jurexio platform operations |
| Approved | In the catalogue for named jurisdictions | Jurexio CTO and Compliance (G-10-01) |
| Enabled | Switched on for a tenant's units with approved scopes | Tenant security administrator and DPO (G-10-03) |
| Suspended | Paused: unused past the set period, vendor change, or security concern | Automatic, or either approver level |
| Archived | Retired; credentials destroyed | Tenant security administrator (G-10-08) |

A vendor change in processing location or sub-processors returns every affected connector to platform review (G-10-02).

### Data-flow declaration (one per connector per jurisdiction)

| Field | Example |
| --- | --- |
| Purpose | Capture court notices from the designated docketing mailbox |
| Data received or sent | Email metadata and attachments from one mailbox |
| Processing location | In-jurisdiction region named by the vendor |
| Retention at vendor | Vendor's stated period |
| Sub-processors | Listed |
| Internal events subscribed | e.g. "deadline confirmed" for calendar publishing |
| Scopes requested | Read-only, single mailbox |

### Egress rules (D2)

| Payload class | May go to |
| --- | --- |
| Client content (documents, matter details, AI prompts) | Only connectors approved for in-jurisdiction processing in the matter's home jurisdiction |
| Personal data (names, contacts, identifiers) | Only connectors approved for in-jurisdiction processing in the person's or matter's jurisdiction |
| Operational metadata (references, links, status) | Any connector approved for the purpose |

Anything else is blocked and logged. Notifications carry references and links back to Jurexio wherever possible.

### Inbound pipeline (D3)

| Step | Checks | On failure |
| --- | --- | --- |
| 1 Authenticate | Signature or mutual TLS; SPF, DKIM and DMARC for email; publisher checksum for lists and feeds; replay protection | Quarantine |
| 2 Validate | Schema, size, file type, malware scan, hidden-text and injection scan | Quarantine; malware never released |
| 3 Verify (state-changing events) | Confirm with the source, e.g. fetch the completion certificate or the official list | Hold until verified |
| 4 Hand off | Deliver to the owning module, which applies its own rules | — |

### Resilience (D5)

| Mechanism | Behaviour |
| --- | --- |
| Durable queue | Every outbound request is stored in-region before sending |
| Idempotency | Every request carries a key so retries never duplicate |
| Circuit breaker | Opens on repeated failure (central) |
| Dead letter | Persistently failing requests held with an alert to a named owner |
| Fallback | Only to a second provider approved for the same jurisdiction and purpose (G-10-09) |
| Escalation | Time-critical failures trigger the owning module's ladder (e.g. DeadlineGuard D3) |

### HTIL gate register

Gate classes are listed under Consolidation v1.1 in Document control.

| Gate | Decision | Gate type | Approver role | Ledger events |
| --- | --- | --- | --- | --- |
| G-10-01 | Approve a connector for a jurisdiction, including its data-flow declaration and event subscriptions | Dual distinct | Jurexio CTO and Jurexio Compliance | `PLATFORM.CONNECTOR_APPROVED` |
| G-10-02 | Re-approve or suspend after a vendor change | Dual distinct | Jurexio CTO and Jurexio Compliance | `PLATFORM.CONNECTOR_REAPPROVED`, `PLATFORM.CONNECTOR_SUSPENDED` |
| G-10-03 | Enable a connector for tenant units | Dual distinct | Tenant security administrator and DPO | `NEXUS.CONNECTOR_ENABLED` |
| G-10-04 | Change a connection's scopes | Dual distinct | Tenant security administrator and DPO | `NEXUS.SCOPE_CHANGED` |
| G-10-05 | Register an inbound source or endpoint | Single approver | Tenant security administrator | `NEXUS.INBOUND_SOURCE_REGISTERED` |
| G-10-06 | Release or discard a quarantined item (never malware) | Single approver | Tenant security administrator | `NEXUS.QUARANTINE_RELEASED`, `NEXUS.QUARANTINE_DISCARDED` |
| G-10-07 | Resolve a dead-letter item | Single approver | Named connector owner | `NEXUS.DEAD_LETTER_RESOLVED` |
| G-10-08 | Archive a connection | Single approver | Tenant security administrator | `NEXUS.CONNECTOR_ARCHIVED`, `NEXUS.CREDENTIALS_DESTROYED` |
| G-10-09 | Approve a fallback provider pairing for a jurisdiction and purpose | Dual distinct | Jurexio CTO and Jurexio Compliance | `PLATFORM.FALLBACK_APPROVED` |

### Flow F1 — Bring a connector into service

- **Steps:** vendor reviewed; data processing agreement signed; data-flow declaration completed per jurisdiction; Jurexio approves (G-10-01); tenant security administrator and DPO review the declaration and enable it for named units with narrow scopes (G-10-03); credentials stored in the regional vault.
- **Primary act:** the DPO reads the data-flow declaration before approving.

### Flow F2 — Outbound call

- **Steps:** a module or subscribed event requests an external action; the payload is classified; the residency rule is applied; the request is stored in the durable queue with an idempotency key; sent; retried with backoff on failure; fallback only to an approved pairing; dead-lettered with an owner alert if it keeps failing.
- **Primary act:** none for users unless a dead letter or escalation reaches them.

### Flow F3 — Inbound item

- **Steps:** item arrives at a registered endpoint or mailbox; authenticated; validated and scanned; state-changing events verified with the source; handed to the owning module; failures quarantined.
- **Primary act:** the security administrator reviews quarantined items and releases or discards them.

### Flow F4 — Vendor change

- **Steps:** a vendor announces a new processing location or sub-processor; affected connectors return to platform review (G-10-02); tenants are notified; connectors are re-approved or suspended; tenant DPOs re-confirm where the declaration changed.
- **Primary act:** tenant DPOs read the changed declaration.

### Flow F5 — Retirement

- **Steps:** unused connections suspend automatically; the administrator archives (G-10-08); credentials are destroyed; DataMigrate connections archive at cutover (M14 R2).
- **Primary act:** the administrator confirms nothing still depends on the connection.

### Screen inventory for UX (FLAG-007)

| Screen | Flow / gate | Primary act |
| --- | --- | --- |
| SCR-10-01 Connector catalogue | F1 | Browse approved connectors and their declarations per jurisdiction |
| SCR-10-02 Enable connector | F1, G-10-03, G-10-04 | Read the declaration; choose units and scopes; approve |
| SCR-10-03 My connections | F2, F5, G-10-08 | See health, queues, scopes and last use; archive |
| SCR-10-04 Inbound sources | F3, G-10-05 | Register and manage endpoints and mailboxes |
| SCR-10-05 Quarantine | F3, G-10-06 | Review failed items and their reasons |
| SCR-10-06 Dead letters | F2, G-10-07 | Resolve persistently failing requests |
| SCR-10-07 Vendor changes | F4 | Review changed declarations and re-confirm |
| SCR-10-08 Platform connector console (Jurexio) | G-10-01, G-10-02, G-10-09 | Review vendors, approve per jurisdiction, approve fallbacks; metadata only |

## Section 4 — Data architecture

### Inputs

| Source | What enters |
| --- | --- |
| Modules (via subscriptions and direct requests) | Outbound requests with tenant, unit, jurisdiction, purpose and payload |
| Registered external sources | Callbacks, webhooks, mailbox items, list and feed files, SCIM updates |
| Platform operations | Connector approvals, data-flow declarations, fallback pairings |
| Tenant administrators | Enablements, scopes, inbound source registrations |
| CommandCentre (M11) | Units, regions, approvers, access decisions |

### Outputs

| Destination | What exits |
| --- | --- |
| Approved external systems | Outbound requests that pass classification and residency |
| Owning modules | Validated, verified inbound items |
| Jurexio Ledger (M09) | Every approval, enablement, scope change, block, quarantine, dead letter, archive |
| PulseComms (M12) | Owner alerts for dead letters, suspensions and vendor changes |
| Tenants | Connector health, queue status, quarantine and dead-letter views |

### Core records

| Record | Key fields | Where it lives |
| --- | --- | --- |
| Connector | Vendor, category, version, approved jurisdictions, status | Platform |
| Data-flow declaration | Connector, jurisdiction, purpose, data classes, processing location, retention, sub-processors, subscribed events, scopes | Platform |
| Connection | Tenant, connector, units, scopes, state, last use, approvers | Tenant region |
| Credential | Connection, vault reference, rotation date, destruction record | Tenant region vault |
| Inbound source | Connection, endpoint or mailbox, authentication method, schema | Tenant region |
| Outbound request | Payload class, idempotency key, attempts, status, provider used | Tenant region queue |
| Quarantine item | Source, failed check, hash, decision, decider | Tenant region |
| Dead letter | Request, failure history, owner, resolution | Tenant region |
| Fallback pairing | Primary and secondary connector, jurisdiction, purpose, approvers | Platform |

**Schema changes for the CTO:** the existing `jrx.connectors` table splits into connector (platform catalogue) and connection (tenant) records; credentials stay KMS-encrypted in the regional vault; the MIGRATION category remains for DataMigrate.

### Ledger events

| Domain | Events |
| --- | --- |
| `NEXUS.` | `NEXUS.CONNECTOR_ENABLED`, `NEXUS.SCOPE_CHANGED`, `NEXUS.CREDENTIAL_ROTATED`, `NEXUS.CONNECTOR_SUSPENDED`, `NEXUS.CONNECTOR_ARCHIVED`, `NEXUS.CREDENTIALS_DESTROYED`, `NEXUS.INBOUND_SOURCE_REGISTERED`, `NEXUS.EGRESS_BLOCKED`, `NEXUS.INBOUND_RECEIVED`, `NEXUS.INBOUND_VERIFIED`, `NEXUS.INBOUND_QUARANTINED`, `NEXUS.QUARANTINE_RELEASED`, `NEXUS.QUARANTINE_DISCARDED`, `NEXUS.HANDED_OFF`, `NEXUS.DEAD_LETTERED`, `NEXUS.DEAD_LETTER_RESOLVED`, `NEXUS.FALLBACK_USED`, `NEXUS.CIRCUIT_OPENED` |
| `PLATFORM.` | `PLATFORM.CONNECTOR_APPROVED`, `PLATFORM.CONNECTOR_REAPPROVED`, `PLATFORM.CONNECTOR_SUSPENDED`, `PLATFORM.FALLBACK_APPROVED` |

**Critical-class events:** enablement, scope changes, egress blocks, quarantine releases, credential destruction, connector approval and suspension.

The April events `NEXUS.CONNECTOR_SYNC`, `NEXUS.WEBHOOK_RECEIVED`, `HRIS_SYNC_INITIATED` and `HRIS_SYNC_COMPLETED` map to `NEXUS.HANDED_OFF`, `NEXUS.INBOUND_RECEIVED`, and deferred HR-system events.

### Residency

- Queues, quarantine, dead letters, inbound items and credentials live in the tenant's region for that jurisdiction.
- Outbound payloads follow the egress rules in Section 3; no foreign fallback.
- The platform catalogue holds connector metadata only, never tenant data.

### Availability

- The gateway and queues run highly available in every region.
- If the gateway cannot classify a payload, it blocks it (fail closed).
- Vendor outages are absorbed by durable queues; recovery replays in order with idempotency keys.

## Section 5 — Compliance requirements

India and the US are the live jurisdictions in v1.0, so the obligations below apply through their packs. Rows for the UK, EU, Singapore and GCC apply when those packs are activated.

### Regulations and standards, and how M10 satisfies them

| Regulation / standard | Requirement | How M10 satisfies it |
| --- | --- | --- |
| GDPR and UK GDPR (Articles 28, 30, 44–49) | Processor contracts; records of processing; transfer conditions | Vendor data processing agreements; data-flow declarations for client records; gateway-enforced egress (D1, D2) |
| DPDP Act 2023 and Rules 2025 (India) | Processor obligations; security; transfer conditions | Same controls; India-approved connectors only for Indian data |
| Singapore PDPA; GCC data-protection laws | Transfer limitation; processor obligations | Country-level approvals and egress rules |
| SOC 2 (CC6 logical access; CC7 monitoring; CC9 vendor risk) | Restrict external access; monitor; manage vendors | Least-privilege scopes, vaulted credentials, health monitoring, vendor review and re-approval (D1, D5) |
| ISO/IEC 27001:2022 Annex A (5.19–5.22 supplier relationships; 8.20–8.23 network security; 8.7 malware) | Supplier security; network controls; malware protection | Two-level approval, gateway controls, malware and injection scanning (D1, D3) |
| ABA Model Rules 1.6(c) and 5.3; BCI, SRA and other professional rules | Safeguard client information; supervise vendors | Vendor review, residency enforcement, minimal payloads |
| Court and portal terms of use | Lawful automated access | Only permitted cause lists and case status; court APIs only after registration |
| Email authentication standards (SPF, DKIM, DMARC) | Detect spoofed senders | Applied to every captured email (D3) |
| Messaging rules per jurisdiction (e.g. commercial SMS registration in India, US texting consent rules) | Registered senders and consent | Pack rules for messaging connectors; detailed in PulseComms |

### Mandatory HTIL steps (never automated)

- Approving any connector for a jurisdiction, and re-approving after vendor change (G-10-01, G-10-02).
- Enabling a connector and changing its scopes (G-10-03, G-10-04).
- Registering inbound sources (G-10-05).
- Releasing or discarding quarantined items (G-10-06).
- Resolving dead letters (G-10-07) and archiving connections (G-10-08).
- Approving fallback pairings (G-10-09).

### Decisions that must remain human

- Whether a vendor may receive a client's data, and which data.
- Whether a quarantined item is safe to release.
- What to do with a request that cannot be delivered.

The system acts alone only to protect: blocking non-compliant egress, quarantining failed inbound items, suspending unused connections, opening circuit breakers.

### Approved claims language

- "Every integration approved twice: by Jurexio and by your DPO."
- "Your data reaches only vendors that process it in your jurisdiction."
- "Every inbound item authenticated, scanned and verified before it touches a record."
- Prohibited: "real-time sync with courts", "open API", "integrates with everything", and naming a connector as available before it is approved for that jurisdiction.

## Section 6 — Module dependencies

### Upstream (M10 depends on)

| Dependency | What M10 needs |
| --- | --- |
| Jurexio Ledger Core (M09) | Outbox (durable queue pattern), event sealing |
| Platform event bus (core infrastructure, D4) | Declared internal events for subscriptions |
| CloudVault (M13) | Regional storage for queues, quarantine and dead letters; regional credential vault keys |
| CommandCentre (M11) | Units and regions, approver roles, SCIM ownership rules |
| Jurisdiction Packs | Approved providers, permitted court sources, declared regulatory sources and lists |

### Downstream (depend on M10)

| Module | Connectors used |
| --- | --- |
| CommandCentre (M11) | SAML, OpenID Connect, SCIM |
| DocVault (M02) | Mailbox capture, e-signature providers, document-store import and export |
| DeadlineGuard (M05) | Mailbox capture of court notices, permitted court sources, calendar publishing |
| RegRadar (M07) | Official sources, licensed feeds, sanctions lists |
| Jurexio Ledger (M09) | RFC 3161 timestamp authorities |
| Jurexio Engine (M03) | Regional SDK and model endpoints |
| DataMigrate (M14) | CSV/Excel, file systems, Clio, iManage (MIGRATION category) |
| PulseComms (M12) | Email, SMS and approved WhatsApp providers |

### Sequencing

The gateway, durable queue, credential vault and identity connectors are needed in Sprint 1, because CommandCentre sign-in and provisioning depend on them. Other connectors follow the module that needs them.

## Section 7 — v1.0 scope vs deferred scope

The v1.0 feature list is in Section 1. India and the US are live in v1.0; the other four packs are built as configuration and inactive.

### v1.0 build increments

| Increment | Contents | Needed by |
| --- | --- | --- |
| Boundary Core | Outbound gateway with classification and residency enforcement, durable queue, idempotency, circuit breakers, dead letters, inbound pipeline with authentication, validation, quarantine and hand-off, credential vault, connector catalogue and lifecycle, identity connectors (SAML, OpenID Connect, SCIM) | Sprint 1 |
| Module connectors | Mail and calendar, e-signature, timestamp authorities, regulatory sources and sanctions lists, permitted court sources, regional AI endpoints, messaging, document stores, migration sources | Each with the module that needs it |
| Operations | Vendor-change re-approval, fallback pairings, tenant health views, platform connector console | Before the first client goes live |

### Release testing

- **Egress:** a payload with client content or personal data cannot reach a connector not approved for in-jurisdiction processing; no fallback abroad occurs during a provider outage.
- **Registered sources only:** an unregistered sender cannot reach any endpoint.
- **Forgery:** a forged signature callback cannot mark a document Executed; source verification blocks it.
- **Spoofing:** a spoofed court-notice email fails authentication and is quarantined.
- **Malware and injection:** seeded files are quarantined; malware can never be released.
- **No direct writes:** NexusConnect cannot create or change a record in any module.
- **No internal publication:** NexusConnect cannot publish internal state events.
- **Durability:** a provider outage loses no outbound request; recovery sends each exactly once.
- **Least privilege:** a connection cannot exceed its approved scopes.
- **Retirement:** archived connections hold no usable credentials.

### Deferred scope

| Feature | Release trigger | Reason |
| --- | --- | --- |
| Open partner and developer API | Signed client need, plus a dedicated security review | Largest attack surface (R1) |
| Payment gateways (e.g. Razorpay, Stripe) | BillGuard specification after pilots | Owned by BillGuard (R2) |
| ERP and CRM (e.g. SAP, Salesforce, Microsoft Dynamics) | Signed client | Not required by any locked decision (R2) |
| HR systems (e.g. Workday, SAP SuccessFactors, Oracle HCM) | Signed client | Not required by any locked decision (R2) |
| Corporate registries beyond declared regulatory sources (e.g. MCA21, Companies House, SEC EDGAR) | Signed client or MatterCore identifier verification need | Not required for v1.0 (R2) |
| Court e-filing and case APIs | Registration with each court | Stubs until registered |

### Rejected (not deferred)

| Option | Reason |
| --- | --- |
| Strictly outbound-only | Contradicts locked inbound needs (R1) |
| Tenant admins connecting vendors without DPO approval | No record of data flows; client DPO decision bypassed (D1) |
| Relying on vendor contracts for residency | Data still crosses borders (D2) |
| Inbound data writing records directly | Forged or malicious input would corrupt the legal record (D3) |
| Internal event bus inside NexusConnect | Mixes trusted and untrusted zones (D4) |
| Fallback to foreign or unapproved providers | Breaks residency (D5) |

## Section 8 — Open questions and blockers

### Gating item (read first)

Every v1.0 connector needs an approved vendor per jurisdiction that processes data in-jurisdiction. For some categories and countries (messaging in particular GCC states, e-signature in some jurisdictions, model endpoints in some regions) no compliant vendor may exist yet. Those channels stay unavailable there until one is approved, and each pack must say so before validation.

### Decisions requiring Chairman or CTO input

| # | Question | Owner | Recommendation |
| --- | --- | --- | --- |
| OQ-10-01 | Vendor shortlist per v1.0 category and jurisdiction (mail capture, e-signature, timestamping, messaging, model endpoints) | CTO with procurement | Shortlist with in-jurisdiction processing confirmed in contract |
| OQ-10-02 | Auto-suspension period for unused connections | Chairman | 90 days |
| OQ-10-03 | Credential rotation schedule | CTO | Every 90 days, or immediately on suspicion |
| OQ-10-04 | Maximum time a request may sit in a dead-letter queue before escalation to the tenant security administrator | CTO | 24 hours, or sooner for time-critical purposes |
| OQ-10-05 | Which internal events each v1.0 connector may subscribe to | CTO | Declared in each data-flow declaration; minimum needed per purpose |
| OQ-10-06 | Whether any pilot client needs a deferred connector (payments, ERP, HR systems) | Chairman | Confirm before pilot contracts; otherwise keep deferred |

### Compliance validations pending

- [ ] Vendor data processing agreements and in-jurisdiction processing terms per v1.0 connector.
- [ ] Court and portal terms reviewed per forum for permitted automated access.
- [ ] Messaging registration and consent rules per jurisdiction (with PulseComms).
- [ ] Licensed-feed terms permitting AI analysis (RegRadar D1).

### Items blocking engineering start

- [ ] Chairman sign-off (consolidated end review).
- [ ] Platform event bus designed as core infrastructure on the Ledger outbox (D4).
- [ ] Regional credential vault available in India and the US.
- [ ] Data-flow declaration template agreed.
- [ ] Malware and injection scanning services available in every region.

### Housekeeping

- [ ] Retire "outbound-only" from earlier records; it is superseded by R1.
- [ ] Remove the event bus from NexusConnect's description in the Architecture Spec (D4).
- [ ] Replace "real-time sync with eCourts, HMCTS, PACER" and the full connector list in demos with the v1.0 catalogue.
- [ ] Rename SDK connectivity references from Nyayavigya to Jurexio SDK.
