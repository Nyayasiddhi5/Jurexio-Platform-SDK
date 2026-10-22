<!-- Source of truth: https://claude.ai/code/artifact/4709f3c1-d33a-4cf6-9b98-662cbca406e5 · exported 21 Oct 2026 · do not edit here; edit the Claude Doc and re-export -->

# Module Specification — M13 CloudVault

Oct 18, 2026 · @Suresh Singh

## Document control

| Field | Value |
| --- | --- |
| Module | M13 CloudVault (governed storage of record) |
| Spec version | v1.1, consolidated after the PDD Review Log (18 Oct 2026); draft for Chairman approval |
| Design order | First infrastructure module after the confirmed sequence; ahead of NexusConnect and PulseComms |
| Engineering owner | CTO (Vamsi) |
| Jurisdiction Pack inputs | Raja Sekhar T (primary and recovery locations, localisation rules, retention and disposal rules) |
| Status | Sign-off deferred to the consolidated end review. No engineering start before sign-off. |

### Jurisdiction baseline

India and the United States (all states) are the only live jurisdictions in v1.0, so v1.0 needs live storage, keys and recovery in ap-south-1 (with in-country recovery) and us-east-1 (with a second US region) only. The United Kingdom, European Union, Singapore and GCC packs are built as configuration but inactive until counsel-validated and activated by the Chairman (C-01, 18 Oct 2026; supersedes the earlier six-active baseline). Their regions are provisioned when they are activated.

### Decision log

| ID | Locked decision |
| --- | --- |
| R1 | CloudVault is the governed storage layer of record for every module. Optional bring-your-own-storage in the client's own account and approved region, under identical controls. SharePoint, Google Drive, Box and similar are NexusConnect integrations, never the record; edits there return as new uploads. |
| D1 | Every pack names a primary region and a recovery location, both inside the jurisdiction. Country-level packs inside the GCC, and inside the EU where clients require. No client go-live where no compliant location exists. Every location shown to clients. |
| D2 | Key hierarchy: jurisdiction root key, then a tenant key per region, then per-subject and per-purpose keys. Optional customer-managed keys held by the client in-region; revocation stops Jurexio's access and service. Keys never leave their region; every use logged; destruction dual-approved with a certificate. |
| D3 | AWS for v1.0 through provider-neutral internal interfaces. Three editions with identical controls: Jurexio Cloud, Dedicated, Sovereign or On-premises. Dedicated and Sovereign editions released on a signed-client trigger after passing the same tests. |
| D4 | Tiered recovery: Tier 0 no data loss and 1 hour; Tier 1 15 minutes and 4 hours; Tier 2 24 hours. Region failover inside the jurisdiction. Immutable, in-jurisdiction backups under tenant keys. Hash-verified restores. 24-hour single-tenant restore. Quarterly restore drills and annual failover exercise. The 7-day recovery time is retired. |
| D5 | Record-level disposal by crypto-shredding. Tenant exit: complete hash-verified export confirmed by the client, then tenant-key destruction. Media sanitisation attested by the provider. Certificates state method, unreadable-from time and last-copy-gone date. Holds always win. Dual approval for tenant and bulk disposal. |
| Inherited | Writes to the wrong region blocked with HTTP 451. Employee data stored by work location. Subject keys excluded from general backups (Ledger review fix). Controls are not settings (CommandCentre D7). No standing Jurexio access to tenant content (CommandCentre D3). |

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
| GUARDED | None |
| DUAL | G-13-01, G-13-02, G-13-03, G-13-05, G-13-06, G-13-07, G-13-09 |
| SELF-ATTESTED | G-13-04 (confirmation of receipt by the tenant's signatory), G-13-08 (request; executed only under client-granted support access) |

**Module changes**

- **C-01 and BQ-31:** the live region map reduces to ap-south-1 and us-east-1 with their in-jurisdiction recovery locations; CTO confirms availability, counsel confirms localisation. GCC country packs (OQ-13-01) are decided at activation.
- **C-09:** the recovery tiers are internal targets until proven by drills; they are never quoted to clients as commitments before drill evidence exists.
- **C-10:** migration staging uses a per-project, per-purpose key under the tenant key, so it can be crypto-shredded; staging destruction is G-14-11 in DataMigrate.
- **CB-CMP-01:** storage write batches may be aggregated in the Ledger, but every underlying object record stays individually retrievable.
- **CB-CMP-02 and D-04 (confirmed):** CloudVault certificates of destruction are Jurexio-issued and carry the "© Jurexio Inc." footer; the specification export template carries it too.

## Section 1 — Module identity

| Field | Value |
| --- | --- |
| Module | M13 CloudVault |
| Code | `jrx-cloudvault.ts` |
| Tagline | Every byte in its own country, under its owner's key, recoverable on demand and provably gone when it must be. |
| Job to be done | Store every record of every module in the right jurisdiction, encrypted under the right key, recoverable within defined targets, and destroyed with an exact certificate when the law or the client requires. |
| Platform role | The only storage layer modules write to; enforces residency, encryption, immutability, holds, retention, recovery and disposal for all of them |
| Primary users | Platform operations (Jurexio), tenant security administrators, Data Protection Officers, Compliance Officers |
| Indirect users | Every module and every user, through the documents and records they store |
| Editions | Jurexio Cloud (default), Dedicated, Sovereign or On-premises |
| AI role | None. CloudVault is deterministic infrastructure |

### v1.0 scope — in

- Governed object and record storage for all modules, through provider-neutral internal interfaces (R1, D3).
- Jurisdiction-pinned placement: primary and recovery locations per pack; HTTP 451 on wrong-region writes (D1).
- Region and location coverage view for clients (D1).
- Key hierarchy: jurisdiction root, tenant key per region, per-subject and per-purpose keys; key-use logging; rotation (D2).
- Optional customer-managed tenant keys (D2).
- Optional bring-your-own-storage in a client account and approved region (R1).
- Immutable, in-jurisdiction backups; tiered recovery targets; region failover; single-tenant restore; hash-verified restores (D4).
- Legal holds and pack-driven retention enforcement at the storage layer.
- Record-level crypto-shredding; tenant-exit export and tenant-key destruction; certificates of destruction (D5).
- Restore drills and failover exercises with logged evidence (D4).

### v1.0 scope — out

Deferred items and triggers are in Section 7.

## Section 2 — User stories

### US-13-01 Know exactly where our data lives

As a **Data Protection Officer**, I need to see the primary and recovery location of every unit's data so that I can answer regulators precisely.

- The coverage view lists, per unit and jurisdiction, the primary region and the recovery location.
- Recovery locations are always inside the same jurisdiction.

### US-13-02 Hold our own key

As a **bank's Chief Information Security Officer**, I need our data encrypted under a key we control so that Jurexio cannot read it if we withdraw consent.

- Our tenant key lives in our own key service, in the approved region.
- If we revoke it, Jurexio can no longer decrypt our data, and the platform states clearly that service stops.

### US-13-03 Keep data in our own account

As a **government IT head**, I need our records stored in our own cloud account so that we own the storage outright.

- Bring-your-own-storage uses our account in an approved region.
- Every control (hashing, holds, retention, residency, disposal) applies exactly as on Jurexio Cloud.

### US-13-04 Recover fast after an outage

As a **managing Partner**, I need critical services back within an hour so that court deadlines and approvals are never stranded.

- The Ledger, access decision, alert scheduler and identity return within 1 hour with no loss of sealed events or alerts.
- Matters, documents and deadlines return within 4 hours with at most 15 minutes of data loss.

### US-13-05 Survive ransomware

As a **tenant security administrator**, I need backups that attackers cannot alter or delete so that we can always restore a clean copy.

- Backups are immutable for their retention period and stored only in-jurisdiction.
- Restored documents are verified against their sealed hashes before anyone can use them.

### US-13-06 Never resurrect erased data

As a **Data Protection Officer**, I need erased data to stay erased after any restore so that erasure is real.

- Erased records are unreadable everywhere the moment their key is destroyed, including in backups.
- Restores cannot bring back keys that were destroyed.

### US-13-07 Leave with everything, and prove nothing remains

As a **General Counsel** of a departing client, I need a complete export and a certificate that nothing readable remains so that we can change provider safely.

- The export contains documents with hashes, matter records, our Ledger chain, production and privilege logs.
- After we confirm receipt and the exit window ends, the tenant key is destroyed under dual approval.
- The certificate states method, the time the data became unreadable, and the date the last physical copy is gone.

### US-13-08 Respect holds absolutely

As a **litigation Partner**, I need held records protected from every disposal path so that nothing under hold can be destroyed.

- No retention expiry, erasure, tenant exit or bulk disposal can touch held records until the hold is released.

## Section 3 — Storage controls and key user flows

### Key hierarchy (D2)

Each layer can be destroyed independently, which is what makes precise disposal possible.

| Layer | Scope | Destroying it makes unreadable |
| --- | --- | --- |
| Jurisdiction root key | One per jurisdiction region | Never destroyed in normal operation |
| Tenant key | One per tenant per region (Jurexio-held or customer-managed) | Everything that tenant stores in that region, including backups |
| Subject and purpose keys | Per data subject, special-category record, staging area or migration | Only those records |

> **Diagram:** Key hierarchy — rendered in the source Claude Doc: https://claude.ai/code/artifact/4709f3c1-d33a-4cf6-9b98-662cbca406e5

### Region map (D1, indicative)

Live in v1.0: the India and US rows only (C-01, BQ-31); the other rows apply when those packs are activated. Each row is confirmed by the CTO and counsel before validation.

| Jurisdiction | Primary | Recovery (in-jurisdiction) |
| --- | --- | --- |
| India | Mumbai region | Hyderabad region |
| United States | US East | Second US region |
| United Kingdom | London region | Multiple London data centres plus in-UK backup |
| European Union | Frankfurt region | Second EU region; in-country where a client requires |
| Singapore | Singapore region | Multiple data centres within the Singapore region |
| GCC | Per country | Per country where its law requires localisation; otherwise a pack-approved GCC region |

Where no compliant location exists for a jurisdiction, client matters cannot go live there.

### Recovery tiers (D4)

| Tier | Services | Data loss allowed | Back in service |
| --- | --- | --- | --- |
| 0 Critical | Ledger, access decision, deadline alert scheduler, identity | None for sealed events and alerts | 1 hour |
| 1 Core | Matters, documents, deadlines, Engine review queue, obligations | 15 minutes | 4 hours |
| 2 Rebuildable | Search indexes, analytics, caches | 24 hours (rebuilt) | 24 hours |
| Region loss | Failover to the in-jurisdiction recovery location | As per tier | Tier 0 within 4 hours; Tier 1 within 24 hours |
| Single tenant | Restore after corruption or client error | Point in time chosen | 24 hours |

All figures are targets for the CTO to prove in testing before they are stated to clients.

### Disposal paths (D5)

| Path | Method | Unreadable from | Physically gone |
| --- | --- | --- | --- |
| Record-level (erasure, retention, special-category, staging) | Destroy the record's own key | Key destruction time | When the last backup holding it expires |
| Tenant exit | Confirmed export, then destroy the tenant key | Key destruction time | When the last tenant backup expires |
| Media | Provider sanitisation under certified processes | — | Per provider attestation |

Held records are excluded from every path until the hold is released.

### HTIL gate register

Record-level disposal approvals sit in the source modules (e.g. G-09-04, G-09-05, G-14-11). Gate classes are listed under Consolidation v1.1 in Document control.

| Gate | Decision | Gate type | Approver role | Ledger events |
| --- | --- | --- | --- | --- |
| G-13-01 | Approve or change a pack's primary or recovery location | Dual distinct | Jurexio CTO and Jurexio Compliance | `PLATFORM.LOCATION_APPROVED` |
| G-13-02 | Connect bring-your-own-storage | Dual distinct | Tenant security administrator and Data Protection Officer | `STORAGE.BYOS_CONNECTED` |
| G-13-03 | Enable a customer-managed key, acknowledging that revocation stops service | Dual distinct | Tenant security administrator and Compliance Officer | `STORAGE.CMK_ENABLED` |
| G-13-04 | Confirm receipt of the exit export | Single approver | Tenant authorised signatory | `STORAGE.EXIT_EXPORT_CONFIRMED` |
| G-13-05 | Destroy a tenant key at exit | Dual distinct | Tenant authorised signatory and Jurexio security officer | `STORAGE.TENANT_KEY_DESTROYED` |
| G-13-06 | Approve a bulk disposal batch | Dual distinct | Compliance Officer and Data Protection Officer | `STORAGE.BULK_DISPOSAL_APPROVED` |
| G-13-07 | Invoke region failover | Dual distinct, tenant notice | Jurexio CTO and Jurexio security officer | `PLATFORM.FAILOVER_INVOKED`, `PLATFORM.FAILBACK_COMPLETED` |
| G-13-08 | Request a single-tenant restore | Single approver; executed under client-granted support access | Tenant security administrator | `STORAGE.TENANT_RESTORE_APPROVED` |
| G-13-09 | Release the Dedicated or Sovereign edition for a client | Dual distinct, after release tests | Jurexio CTO and Jurexio Compliance | `PLATFORM.EDITION_RELEASED` |

A client revoking its own customer-managed key is the client's act in its own key service; CloudVault records it as `STORAGE.CMK_REVOKED` and stops service for that tenant.

### Flow F1 — Write

- **Steps:** a module asks to store an object for a unit; CloudVault resolves the unit's region; a wrong-region request is refused with HTTP 451; the object is encrypted under the tenant key (and subject or purpose key where applicable), hashed, written, and the hash returned to the module for sealing.
- **Primary act:** none for users; the writing module receives the hash.

### Flow F2 — Restore

- **Steps:** a restore is requested (G-13-08 for a single tenant, or automatic within tier targets); data restored from immutable in-jurisdiction backup; every document re-hashed against the Ledger; mismatches quarantined; destroyed keys stay destroyed.
- **Primary act:** the tenant security administrator reads the restore report, including any quarantined items.

### Flow F3 — Region failover

- **Steps:** loss of a region detected; Jurexio CTO and security officer invoke failover (G-13-07); tenants notified; Tier 0 then Tier 1 services resume in the in-jurisdiction recovery location; failback planned and logged.
- **Primary act:** the approvers read the impact summary (tenants, tiers, expected times) before invoking.

### Flow F4 — Tenant exit

- **Steps:** client gives notice; export package built (documents with hashes, matter records, Ledger chain, production and privilege logs); client verifies and confirms (G-13-04); exit window passes; held records excluded; tenant key destroyed under dual approval (G-13-05); certificate issued.
- **Primary act:** the client's signatory verifies the export manifest against its hashes before confirming.

### Flow F5 — Customer-managed key

- **Steps:** client provisions a key in its in-region key service; enablement approved with the revocation consequence acknowledged (G-13-03); tenant data re-wrapped under the client key; key use logged; on revocation, service for the tenant stops and is shown as stopped.
- **Primary act:** the approvers read the revocation consequence statement before enabling.

### Flow F6 — Bring-your-own-storage

- **Steps:** client provides an account in an approved region; CloudVault verifies region, encryption and immutability settings; connection approved (G-13-02); all controls applied as on Jurexio Cloud.
- **Primary act:** the DPO reads the verification report before approving.

### Screen inventory for UX (FLAG-007)

| Screen | Flow / gate | Primary act |
| --- | --- | --- |
| SCR-13-01 Data locations | US-13-01 | Read primary and recovery locations per unit |
| SCR-13-02 Keys | F5, G-13-03 | View key layers and key-use log; enable customer-managed keys |
| SCR-13-03 Bring-your-own-storage | F6, G-13-02 | Connect and verify a client-owned store |
| SCR-13-04 Recovery and drills | F2, G-13-08 | Request a restore; read drill and restore reports |
| SCR-13-05 Holds and disposal | G-13-06 | Review disposal batches; confirm holds are excluded |
| SCR-13-06 Certificates | D5 | Read and download certificates of destruction |
| SCR-13-07 Tenant exit | F4, G-13-04, G-13-05 | Track the export, confirm receipt, approve key destruction |
| SCR-13-08 Platform storage console (Jurexio) | F3, G-13-01, G-13-07, G-13-09 | Manage locations, failover and editions; metadata only |

## Section 4 — Data architecture

### Inputs

| Source | What enters |
| --- | --- |
| Every module | Objects and records to store, with tenant, unit and purpose |
| CommandCentre (M11) | Unit-to-region mapping, tenant identity, approvers |
| Jurisdiction Packs | Primary and recovery locations, retention and disposal rules |
| Source modules (Ledger, MatterCore, DataMigrate, DocVault) | Approved disposal instructions; hold status |
| Client key services (optional) | Customer-managed tenant keys |
| Client storage accounts (optional) | Bring-your-own-storage targets |

### Outputs

| Destination | What exits |
| --- | --- |
| Calling modules | Stored-object references and hashes for sealing |
| Jurexio Ledger (M09) | Storage, key, restore, failover and disposal events; certificates |
| Tenants | Coverage view, restore reports, drill reports, certificates of destruction, exit export packages |
| RegRadar (M07) | Retention and disposal evidence for the firm compliance check |

### Core records

| Record | Key fields |
| --- | --- |
| Location | Jurisdiction or country, provider, primary region, recovery location, edition, approval |
| Stored object | Tenant, unit, region, key reference, hash, retention class, hold flags, immutability period |
| Key | Layer, scope, region, holder (Jurexio or client), status, rotation, destruction record |
| Backup set | Tier, region, immutability lock until, key references |
| Restore | Requester, scope, point in time, verification result, quarantined items |
| Disposal | Path, scope, approvers, key-destruction time, last-copy-gone date, certificate |
| Exit | Tenant, export manifest with hashes, confirmation, window end, key-destruction record |
| BYOS connection | Tenant, account, region, verification result, approvers |

### Ledger events

| Domain | Events |
| --- | --- |
| `STORAGE.` | `STORAGE.OBJECT_STORED`, `STORAGE.WRITE_BLOCKED_RESIDENCY`, `STORAGE.BYOS_CONNECTED`, `STORAGE.CMK_ENABLED`, `STORAGE.CMK_REVOKED`, `STORAGE.KEY_ROTATED`, `STORAGE.KEY_DESTROYED`, `STORAGE.BACKUP_COMPLETED`, `STORAGE.TENANT_RESTORE_APPROVED`, `STORAGE.RESTORE_VERIFIED`, `STORAGE.RESTORE_ITEM_QUARANTINED`, `STORAGE.BULK_DISPOSAL_APPROVED`, `STORAGE.DISPOSAL_CERTIFIED`, `STORAGE.EXIT_EXPORT_CONFIRMED`, `STORAGE.TENANT_KEY_DESTROYED`, `STORAGE.DRILL_COMPLETED` |
| `PLATFORM.` | `PLATFORM.LOCATION_APPROVED`, `PLATFORM.FAILOVER_INVOKED`, `PLATFORM.FAILBACK_COMPLETED`, `PLATFORM.EDITION_RELEASED` |

**Critical-class events:** residency blocks, customer-managed key enablement and revocation, key destruction, bulk disposal, tenant-key destruction, failover.

`STORAGE.OBJECT_STORED` is batched per transaction to keep the Ledger proportionate; every stored object's hash is still sealed through its owning module's event.

### Residency and isolation

- Objects, backups and keys stay in the jurisdiction's primary and recovery locations.
- Tenants are isolated by tenant keys and access policies; no storage path is shared across tenants without encryption separation.
- Bring-your-own-storage and customer-managed keys stay in the client's approved region.

### Integrity and availability

- Every write returns a hash; every restore is verified against sealed hashes before use.
- Backups are immutable for their lock period and cannot be altered or deleted, including by Jurexio operators.
- Recovery targets and drills follow Section 3; the drill results are SOC 2 evidence.

## Section 5 — Compliance requirements

India and the US are the live jurisdictions in v1.0, so the obligations below apply through their packs. Rows for the UK, EU, Singapore and GCC apply when those packs are activated.

### Regulations and standards, and how M13 satisfies them

| Regulation / standard | Requirement | How M13 satisfies it |
| --- | --- | --- |
| SOC 2 (Availability criteria; CC6 encryption and disposal; CC7 recovery) | Defined recovery, encryption, secure disposal, tested continuity | Recovery tiers, immutable backups, key hierarchy, certified disposal, drills (D2, D4, D5) |
| ISO/IEC 27001:2022 Annex A (5.30, 8.10, 8.13, 8.14, 8.24) | Continuity readiness; information deletion; backup; redundancy; cryptography | Same controls; restore and failover evidence |
| NIST SP 800-88 | Media sanitisation | Provider-attested sanitisation cited on certificates (D5) |
| GDPR and UK GDPR (Articles 5, 17, 32, 44–49) | Storage limitation; erasure; security; transfer conditions | In-jurisdiction primary and recovery; crypto-shredding; tenant keys (D1, D2, D5) |
| DPDP Act 2023 and Rules 2025 (India) | Security safeguards; erasure; transfer conditions | India primary and recovery in-country; same controls |
| CERT-In Directions 2022 (India) | Logs maintained within India for a defined period | India logs and backups held in India |
| Singapore PDPA (retention and transfer limitation obligations) | Do not retain longer than necessary; restrict transfers | Pack retention, crypto-shredding, in-country storage |
| GCC data-protection laws (e.g. Saudi and UAE PDPL) | Transfer restrictions; localisation in some cases | Country-level packs and locations; no go-live without a compliant location (D1) |
| Government cloud requirements (e.g. empanelment for Indian government workloads) | Approved hosting for public-sector data | Sovereign or On-premises edition on a signed-client trigger (D3) |
| ABA Model Rule 1.6(c); BCI, SRA and other confidentiality rules | Reasonable safeguards for client information | Tenant keys, customer-managed keys, no standing operator access |
| Bharatiya Sakshya Adhiniyam s.63; FRE 902(13)/(14) | Integrity of electronic records | Hash on every write; hash-verified restores |

### Mandatory HTIL steps (never automated)

- Approving any primary or recovery location (G-13-01).
- Connecting bring-your-own-storage and enabling customer-managed keys (G-13-02, G-13-03).
- Confirming exit exports and destroying tenant keys (G-13-04, G-13-05).
- Approving bulk disposal (G-13-06).
- Invoking region failover (G-13-07) and requesting single-tenant restores (G-13-08).
- Releasing Dedicated or Sovereign editions (G-13-09).

### Decisions that must remain human

- Whether a location satisfies a jurisdiction's law.
- Whether data may be destroyed, and when.
- Whether to fail over a region.

The system acts alone only to protect: blocking wrong-region writes, enforcing immutability and holds, quarantining restored items that fail verification.

### Approved claims language

- "Your data and its recovery copies stay in your jurisdiction."
- "Hold your own key: revoke it and we cannot read your data."
- "Leave with everything, with proof that nothing readable remains."
- Prohibited: "zero downtime", any recovery figure not yet proven in testing, "deleted" for data still held in immutable backups without the certificate's dates, and any claim of a region's availability not yet confirmed.

## Section 6 — Module dependencies

### Upstream (M13 depends on)

| Dependency | What M13 needs |
| --- | --- |
| Cloud provider (AWS for v1.0) | Regional object storage, key management, immutability (object lock), backup, multiple data centres per region |
| CommandCentre (M11) | Units and their regions; tenant identity; approver roles; support-access grants for restores |
| Jurexio Ledger Core (M09) | Sealing of storage events and certificates |
| Jurisdiction Packs | Locations, retention and disposal rules |

### Downstream (depend on M13)

Every module stores through CloudVault; none may call cloud storage directly.

| Module | Dependency |
| --- | --- |
| Jurexio Ledger (M09) | Durable in-region storage for chains and evidence packages; subject key store excluded from general backups |
| DocVault (M02) | Intact originals, versions, derived copies; hash-verified restores |
| DataMigrate (M14) | Staging per jurisdiction; sealed source exports; staging destruction certificates |
| MatterCore (M01) | Archive storage; special-category store |
| Jurexio Engine (M03) | Storage of approved outputs and sealed intermediate content |
| CommandCentre (M11) | Regional identity stores (sharing the same residency rules) |

### External integrations

| Integration | Purpose | Condition |
| --- | --- | --- |
| Client key services (optional) | Customer-managed tenant keys | In the client's approved region |
| Client storage accounts (optional) | Bring-your-own-storage | Approved region; verified encryption and immutability settings |
| SharePoint, Google Drive, Box | Import and export only | Through NexusConnect and DocVault; never the record (R1) |

### Sequencing

CloudVault's write path, key hierarchy and residency enforcement are needed in Sprint 1, because Ledger Core, CommandCentre and MatterCore Foundation all store data from day one. Recovery tiers and disposal paths follow before the first client goes live.

## Section 7 — v1.0 scope vs deferred scope

The v1.0 feature list is in Section 1. India and the US are live in v1.0; the other four packs are built as configuration and inactive.

### v1.0 build increments

| Increment | Contents | Needed by |
| --- | --- | --- |
| Storage Core | Provider-neutral interfaces, write path with residency enforcement, key hierarchy (root, tenant, subject and purpose), hashing, holds, retention enforcement, primary and recovery locations for India and the US | Sprint 1: Ledger Core, CommandCentre and MatterCore Foundation store data from day one |
| Resilience | Immutable in-jurisdiction backups, recovery locations, tiered recovery, single-tenant restore, hash-verified restores, drills | Before the first client goes live |
| Control and exit | Customer-managed keys, bring-your-own-storage, disposal paths, certificates, tenant exit export and key destruction, coverage view | Before the first regulated client (bank, PSU, government) goes live |

### Release testing

- **Residency:** wrong-region writes are refused with HTTP 451; no backup or replica exists outside the jurisdiction.
- **Provider neutrality:** no module calls the cloud provider's storage or key services directly.
- **Immutability:** backups cannot be altered or deleted before their lock expires, including by Jurexio operators.
- **Restore integrity:** a tampered file in a backup is quarantined on restore; destroyed keys are never restored.
- **Recovery targets:** each tier meets its target in a timed drill before the target is stated to any client.
- **Customer-managed key:** revoking the client key stops Jurexio's access within the stated time.
- **Disposal:** after key destruction, the data cannot be decrypted from any copy; certificates carry correct dates.
- **Holds:** no disposal path can touch held records.
- **Tenant exit:** the export manifest's hashes match every exported item.
- **Isolation:** one tenant's key cannot decrypt another tenant's data.

### Deferred scope

| Feature | Release trigger | Reason |
| --- | --- | --- |
| Dedicated edition | Signed client requiring it, after release tests | Shared edition covers v1.0 (D3) |
| Sovereign or On-premises edition | Signed government or sovereign client, after release tests | Needs empanelled or client-hosted infrastructure (D3) |
| Second cloud provider adapter | Dedicated client need, or a GCC country without a compliant AWS location | Provider-neutral interfaces make it an adapter, not a rewrite (D3) |
| In-country EU hosting for specific member states | Client requirement | One EU region is lawful under GDPR for most clients (D1) |

### Rejected (not deferred)

| Option | Reason |
| --- | --- |
| Recovery copies outside the jurisdiction | Breaks residency during recovery (D1) |
| One key per jurisdiction shared by all tenants | Largest blast radius; no tenant-level destruction (D2) |
| SharePoint or Drive as a system of record | Jurexio cannot guarantee integrity, holds or residency there (R1) |
| 7-day recovery time | Unacceptable for deadline-driven legal work (D4) |
| "Deleted" certificates while backups still hold data | Overstates destruction (D5) |

## Section 8 — Open questions and blockers

### Gating item (read first)

The region map in Section 3 is indicative. Before each jurisdiction's pack is validated, the CTO must confirm current regional availability (including a second in-country region where one is assumed, and an in-Kingdom location for Saudi clients), and counsel must confirm each country's localisation and transfer rules, especially across the GCC states. No client matter goes live in a jurisdiction until both are confirmed.

### Decisions requiring Chairman or CTO input

| # | Question | Owner | Recommendation |
| --- | --- | --- | --- |
| OQ-13-01 | Which GCC countries get their own country pack and location in v1.0 | Chairman with counsel | Start with Saudi Arabia and the UAE; add others on client demand |
| OQ-13-02 | Tenant exit window between confirmed export and key destruction | Chairman | 30 days |
| OQ-13-03 | Backup retention and immutability lock period per tier | CTO | Set per pack retention; Tier 0 and Tier 1 locks at least 35 days |
| OQ-13-04 | Commercial terms for customer-managed keys and bring-your-own-storage | Chairman | Offer in the Dedicated tier first; price the operational overhead |
| OQ-13-05 | Who are Jurexio's security officers for failover and tenant-key destruction | Chairman | Same two officers as CommandCentre break-glass (OQ-11-06) |
| OQ-13-06 | Statement shown when a client revokes its key | Chairman with counsel | Plain-language notice that service stops and data is unreadable to Jurexio until the key is restored |

### Compliance validations pending

- [ ] Localisation and transfer rules per GCC country (counsel).
- [ ] Confirmation that in-jurisdiction multi-data-centre recovery satisfies regulators where only one region exists (e.g. Singapore).
- [ ] Government hosting requirements per jurisdiction for the Sovereign edition.
- [ ] Provider attestation reports for media sanitisation, reviewed and filed.

### Items blocking engineering start

- [ ] Chairman sign-off (consolidated end review).
- [ ] Primary and recovery locations for India and the US confirmed and provisioned.
- [ ] Provider-neutral storage and key interfaces designed before any module writes data.
- [ ] Jurisdiction root keys created in each region; tenant-key creation automated.
- [ ] Immutability (object lock) available and tested in each region.

### Housekeeping

- [ ] Retire "External Storage Integration" as CloudVault's description; use "governed storage of record".
- [ ] Retire the 7-day recovery time from all documents.
- [ ] Replace the demo's three-region list (India, EU, US) with the six-jurisdiction map.
