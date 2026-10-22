<!-- Source of truth: https://claude.ai/code/artifact/afa687a6-3360-415d-88a3-bb82112881b5 · exported 21 Oct 2026 · do not edit here; edit the Claude Doc and re-export -->

# Module Specification — M11 CommandCentre

Oct 17, 2026 · @Suresh Singh

## Document control

| Field | Value |
| --- | --- |
| Module | M11 CommandCentre (Organisation, Identity and Governance) |
| Spec version | v1.1, consolidated after the PDD Review Log (18 Oct 2026); draft for Chairman approval |
| Design order | 8, after the confirmed sequence; every other module depends on it, so the CTO's engineering sequence places it in the first sprints |
| Engineering owner | CTO (Vamsi) |
| Jurisdiction Pack inputs | Raja Sekhar T (unit attributes per jurisdiction, credential and practising-status rules) |
| Status | Sign-off deferred to the consolidated end review. No engineering start before sign-off. |

### Jurisdiction baseline

India and the United States (all states) are the only live jurisdictions in v1.0. The United Kingdom, European Union, Singapore and GCC packs are built as configuration but inactive until counsel-validated and activated by the Chairman (C-01, 18 Oct 2026; supersedes the earlier six-active baseline). New countries, branches and offices are still added as configuration; units in an inactive jurisdiction can exist, but no client matter opens there until its pack is activated.

### Decision log

| ID | Locked decision |
| --- | --- |
| R1 | Access built from four layers: a versioned permission catalogue, role templates and custom roles, scoped assignments (legal entity, jurisdiction, branch, practice group, domain) and context conditions (credential, competence, walls, team, matter state). One central decision, deny by default. L1–L9 numbering retired; trust levels remain only as template labels. |
| D1 | Tenant as the outer security boundary. Configurable tree of typed units (legal entity, country, branch, practice group, team, plus tenant-defined types), each carrying jurisdiction, pack, data region, time zone, calendar, language and parent entity. Multi-unit membership. Delegated administration within a unit and below. PSU and government structures are configuration (closes OQ-4). |
| D2 | Custom roles with seven guardrails: no escalation; protected permissions need dual approval; enforced separation-of-duties rules; context conditions non-removable; domain fixed at creation; versioned with impact preview; templates read-only. |
| D3 | Platform operations and tenant administration fully separated. No standing Jurexio access to tenant content, including the Chairman. Support access client-granted, scoped, time-limited, metadata by default, logged in the tenant's Ledger. Break-glass needs dual approval in Jurexio and tenant notice. |
| D4 | Single sign-on (SAML 2.0 or OpenID Connect, several identity providers per tenant); SCIM provisioning; MFA for all, phishing-resistant for privileged users and critical approvers; step-up at critical gates; just-in-time elevation; short-lived tokens replace the 24-hour and 30-day setting; optional device and network conditions. |
| D5 | Directory-driven joiners, movers and leavers. Human approval of first roles. Movers lose old scopes. Leavers revoked instantly with all open work reassigned. Emergency revocation. Dormancy suspension. External users always expire. Unrecertified access removed. |
| D6 | Identity records live in each person's home region. Minimal pseudonymous global routing index. Cross-region work through short-lived signed access assertions; decisions made in the data's region. Controlled transfer on relocation. |
| D7 | Controls are not settings: no setting, flag, plan or operator can weaken HTIL review, Ledger logging, residency, walls, same-actor guard, step-up or separation-of-duties rules; tenants may only tighten. Clear platform and tenant ownership. Rate cards and billing guidelines move to BillGuard. Every configuration change versioned, previewed, logged, and dual-approved where security-relevant. |

### Consolidation v1.1 (PDD Review Log, 18 Oct 2026)

**Platform rules applied to this specification**

- **Gate outcomes (CB-ENG-06, CB-DES-05):** every gate records approved, rejected and withdrawn outcomes as Ledger events; rejection needs a reason; the gate engine generates the `_REJECTED` and `_WITHDRAWN` event names into Event registry v1. Every gate screen shows pending, approved, rejected and withdrawn.
- **Gate classes (I-05):** GUARDED = the requester can never approve; DUAL = two distinct people; SELF-ATTESTED = an act on one's own record, with reason, evidence and step-up where stated, logged and sampled by Compliance. The locked same-actor guard governs AI draft approval.
- **Approvers (C-02, CB-ENG-04):** every approver role maps to named permissions in Permission catalogue v1; numbered RBAC levels, including the FLAG-004 "L6+" wording, are retired. "Jurexio" marks platform roles; unprefixed roles are tenant roles.
- **Canonical events (C-07, C-15):** one act produces one canonical event, owned by the module that owns the record; other context goes in attributes.
- **Design order (C-13):** the order specs were designed, not the engineering sequence, which the CTO publishes.
- **Doctrine carried in (CB-DES-01, CB-DES-03, CB-DES-04):** DOM absence applies to permissions; a state-dependent action for an authorised user may show disabled with its unmet conditions listed. Confidence bands 0.80 and above HIGH (Emerald), 0.60–0.79 MEDIUM (Gold), below 0.60 LOW (Indigo, human review mandatory). AI badge Deep Indigo with Gold text.

**Gate classes in this module**

| Class | Gates |
| --- | --- |
| GUARDED | G-11-02, G-11-04, G-11-05, G-11-07, G-11-08 (no one recertifies their own access), G-11-09 (content access needs a second approver) |
| DUAL | G-11-01, G-11-03, G-11-10, G-11-11, G-11-12, G-11-13, G-11-14 |
| SELF-ATTESTED | G-11-06 (with reason and step-up) |

**Module changes**

- **C-04:** CommandCentre owns and hosts the single access-decision service. MatterCore owns the policy data it evaluates and publishes it through a defined interface; the CTO issues the ownership statement and interface contract before Sprint 1.
- **CB-ENG-03:** Permission catalogue v1 includes a platform role catalogue (Jurexio CTO, Jurexio Compliance, Jurexio security officers, content lead and content reviewer, counsel reviewer, Jurisdiction Pack owner, language reviewer, and the Chairman as holder of `platform.jurisdiction.activate`) and the added tenant templates below. Matter-relative roles (Responsible Partner, lawyer on the matter, named connector owner) are context conditions, not templates.
- **C-06:** Jurexio staff access to tenant content always runs through G-11-09, metadata by default, each content request needing a second approver (DPO or Compliance Officer); DataMigrate's G-14-01 routes here.
- **C-08:** G-11-11 is the only platform break-glass gate, including Ledger database access; approvers are two named Jurexio security officers, neither holding engineering deploy rights (the CTO is excluded); G-09-11 is retired.
- **CB-DES-08:** seeing personal names in-app is the named permission `identity.name.view`; court, export, client and audit views always show designations.
- **BQ-10, BQ-11, BQ-12 (accepted):** Permission catalogue v1 with gate classes before Sprint 1; the Chairman names two security officers; approver templates per client type (law firm, corporate, PSU, ministry) with minimums of one executive approver plus the IT Director.

### Consolidation v1.2 (ClientBridge R1 amendments, 21 Oct 2026)

Applies the cross-module amendments from M08 ClientBridge R1.

- **Full jurisdiction stack per unit:** every office, plant, branch or site unit carries its complete stack (country, state or province, municipal or local body) plus applicability attributes (industry, headcount, establishment type, activities). Children inherit and may override. RegRadar uses these to map obligations to each location.
- **New role template, Location Compliance Owner (Shared domain, internal):** sees and acts only for their own location in ClientBridge (obligations, evidence requests, uploads, attestations). Holds no legal-advice, matter or other-location visibility. Typically site managers, plant heads or local HR.
- **New role template, Legal Department Reviewer (Legal domain):** decides attested location obligations (M08 G-08-08) and evidence reuse (G-08-09); cannot decide an obligation they attested.
- **External and stakeholder users:** ClientBridge's access paths (M08 D2) use this module's sponsorship, expiry, MFA and step-up; client-side administrators may only request colleagues (G-11-13 approves).
- **Language:** each user's interface language comes from the Jurisdiction Pack's declared languages; ClientBridge's multilingual interface is an exception to Engine R2 for client and stakeholder users only.

## Section 1 — Module identity

| Field | Value |
| --- | --- |
| Module | M11 CommandCentre |
| Code | `jrx-commandcentre.ts` |
| Tagline | Who may do what, where, and why: governed for every institution, every country, every branch. |
| Job to be done | Give every institution on Jurexio a precise, provable answer to "who can do what, in which entity, country and branch, under which conditions", while new offices, countries and roles are added without engineering and no setting can weaken a compliance control. |
| Platform role | Owns the organisation tree, identities, permissions, roles, assignments, tenant policies and configuration governance; hosts the central access decision every module calls |
| Two consoles | **Tenant console** for the client's administrators; **Platform operations console** for Jurexio staff, which never shows tenant content |
| Primary users | Tenant security administrator, unit administrators (delegated), IT Director, Compliance Officer, Data Protection Officer, unit heads (access reviews) |
| Platform users | Jurexio platform operations (packs, registries, templates, releases, plans), with no standing tenant access |
| Jurisdictions | India and the US (all states) live; other jurisdictions, countries and branches added as units, inactive for client matters until activated |
| AI role | Suggests role templates for joiners by unit and job title; never assigns a role, grants a permission or changes a policy |

### v1.0 scope — in

- Organisation tree with typed units, tenant-defined unit types, unit attributes and delegated administration (D1).
- Permission catalogue, role templates, custom roles with guardrails, scoped assignments (R1, D2).
- Central access decision with context conditions (R1).
- Separation-of-duties rule set (D2).
- Single sign-on, multiple identity providers, SCIM provisioning, MFA policy, step-up, just-in-time elevation, session policy, device and network conditions (D4).
- Professional credential and competence records: verification status, jurisdiction scope, Hindi and other language competence (FLAG-004, Engine D2, Engine R2).
- Joiner, mover, leaver automation with work reassignment; emergency revocation; dormancy; external-user expiry; access recertification (D5).
- Regional identity stores and global routing index; signed access assertions (D6).
- Support-access grants and break-glass handling (D3).
- Tenant policies within allowed ranges; versioned configuration with preview, rollback and dual approval (D7).
- Jurisdiction Pack use per unit, with the counsel-validation gate.
- Platform operations console: packs, registries, templates, release flags, plans, SDK keys, operational health (metadata only).

### v1.0 scope — out

Deferred items and triggers are in Section 7.

## Section 2 — User stories

### US-11-01 Add a new country or branch

As a **tenant security administrator**, I need to add a new office in a new country without engineering so that the firm can expand on its own timeline.

- I create a unit, choose its type and parent, and it inherits jurisdiction, pack, data region, calendar and time zone.
- The change is previewed and needs a second approver because it sets a data region.
- Client matters in that unit can go live only once the jurisdiction's pack is counsel-validated.

### US-11-02 Create a role the templates don't cover

As a **tenant security administrator**, I need to build a custom role from permissions so that our real job structures are reflected exactly.

- I can only include permissions I hold myself, within my scope.
- Protected permissions need a second approver.
- The preview shows everything the role can do and who would gain or lose access before I save.
- A forbidden combination (e.g. request and approve the same waiver) is rejected.

### US-11-03 Delegate administration to a branch

As a **tenant security administrator**, I need branch administrators who manage only their own branch so that day-to-day administration is local and contained.

- A branch administrator sees and manages only users and roles in their unit and below.
- They cannot grant anything they do not hold.

### US-11-04 Sign in strongly, approve deliberately

As a **Partner**, I need to sign in through my firm's identity provider and confirm my identity again when I approve something critical so that no one can approve in my name.

- Sign-in uses the firm's single sign-on with MFA.
- Approving an AI release, certifying evidence, approving a waiver or a transfer asks me to re-authenticate.

### US-11-05 Use admin power only when needed

As an **IT Director**, I need my administrator rights to stay off until I activate them so that a stolen session cannot be used to change access.

- I activate admin rights for a short window with a reason; the activation is logged.
- They switch off automatically at the end of the window.

### US-11-06 Remove a leaver without losing work

As a **unit head**, I need a departing lawyer's access removed immediately and their open work reassigned so that nothing is exposed and nothing is missed.

- When the directory disables them, all sessions end and all access is revoked at once.
- Their deadlines, AI reviews, obligations and pending approvals move to named backups or eligible colleagues.
- Their past actions stay attributed to them.

### US-11-07 Recertify my team's access

As a **unit head**, I need to confirm or remove my people's access on schedule so that access never outlives its purpose.

- I see each person's roles, scopes and protected permissions.
- Anything I do not confirm by the deadline is removed automatically.

### US-11-08 Prove Jurexio cannot read our files

As a **client General Counsel**, I need proof that Jurexio staff have no access to our data so that I can satisfy our board and regulators.

- No Jurexio role exists inside our tenant unless we grant one.
- Every support grant we approved, and everything done under it, appears in our own Ledger.

### US-11-09 Keep staff data in its country

As a **Data Protection Officer**, I need each person's identity data held in their own country's region so that our people's data is not transferred abroad by default.

- A user's record lives in the region of their primary work location.
- Working on another country's matter uses a short-lived signed assertion, not a copy of their record.

## Section 3 — Access model, controls and key user flows

### The access model (R1)

Every request from every module, and every Engine retrieval, is answered by one central access decision. It allows an action only if all four layers agree, and denies by default.

| Layer | Question it answers | Owned by |
| --- | --- | --- |
| 1 Permission | Does any role the person holds include this named action (e.g. `engine.review.approve`)? | Catalogue: platform. Roles: tenant |
| 2 Scope | Does that role assignment cover this legal entity, jurisdiction, unit and domain? | Tenant |
| 3 Context | Are credential, competence, walls, team membership, matter state and any device or network conditions satisfied? | Conditions: platform. Values: tenant and modules |
| 4 Strength | Was step-up authentication completed, and is the elevation active, where the action requires it? | Platform rule |

> **Diagram:** Central access decision — rendered in the source Claude Doc: https://claude.ai/code/artifact/afa687a6-3360-415d-88a3-bb82112881b5

### Organisation tree (D1)

The tenant is the security boundary. Beneath it sits a tree of typed units; any unit can be added, renamed, moved or retired under change control. Standard unit types are legal entity, country or jurisdiction, office or branch, department or practice group, and team; tenants may define their own (e.g. Regional Office, Unit, Division, Field Office). Every unit carries jurisdiction, pack, data region, time zone, calendar, language and parent legal entity; children inherit unless overridden.

> **Diagram:** Example organisation tree — rendered in the source Claude Doc: https://claude.ai/code/artifact/afa687a6-3360-415d-88a3-bb82112881b5

### Role templates (shipped by Jurexio, read-only)

| Domain | Templates |
| --- | --- |
| Legal | Partner, Senior Counsel, Associate, Paralegal, Docketing Staff, Conflicts Reviewer, Employment Counsel, Records Officer, Intake Partner, General Counsel, Knowledge Owner, Compliance Lawyer, Legal Department Reviewer |
| HR | HR Director / CHRO, HR Business Partner, HR Viewer |
| Shared | Compliance Officer, Data Protection Officer, Tenant Security Administrator, Unit Administrator, IT Director, Finance Owner, Risk Owner, Board Approver, CEO Approver, Credential Verifier, Authorised Signatory, Location Compliance Owner |
| External (always expiring) | Client Contact, Co-counsel, Expert, External Auditor |

Tenants copy templates into custom roles and adjust within the guardrails. Trust levels appear only as a label for sorting.

### Protected permissions (D2)

Adding any of these to a role needs dual approval (tenant security administrator and Compliance Officer), and using them needs step-up authentication:

- AI output approval and kill-switch: `engine.review.approve`, `engine.killswitch.activate`, `engine.killswitch.reinstate`
- Evidence and erasure: `ledger.export.certify`, `ledger.erasure.approve`, `ledger.hold.apply`
- Matter controls: `matter.open.approve`, `matter.waiver.approve`, `matter.wall.lift`, `matter.transfer.approve`
- Document controls: `document.classification.lower`, `document.privileged.release`, `document.filing.approve`
- Migration: `migrate.cutover.approve`, `migrate.rollback.approve`
- Administration: `access.role.manage`, `access.policy.change`, `access.support.grant`, `access.revoke.emergency`

### Separation-of-duties rules (examples)

| Rule | Forbidden in one role or one action |
| --- | --- |
| SoD-01 | Request a conflict waiver and approve it |
| SoD-02 | Assemble an evidence package and certify it |
| SoD-03 | Create a role containing protected permissions and approve its protected permissions |
| SoD-04 | Request support access and approve it |
| SoD-05 | Initiate a cross-border transfer and approve it as Data Protection Officer |
| SoD-06 | Hold HR approval permissions and Legal approval permissions in one role |

The full rule set is published and versioned by platform operations (G-11-12).

### HTIL gate register

Gate classes are listed under Consolidation v1.1 in Document control; protected actions require step-up authentication.

| Gate | Decision | Gate type | Approver role | Ledger events |
| --- | --- | --- | --- | --- |
| G-11-01 | Create or change a unit that sets a jurisdiction or data region | Dual distinct | Tenant security administrator and Data Protection Officer | `ADMIN.UNIT_CREATED`, `ADMIN.UNIT_CHANGED` |
| G-11-02 | Create or change a custom role (no protected permissions) | Single approver, within own scope | Tenant security administrator or unit administrator | `ADMIN.ROLE_VERSIONED` |
| G-11-03 | Add a protected permission to a role | Dual distinct | Tenant security administrator and Compliance Officer | `ADMIN.PROTECTED_PERMISSION_APPROVED` |
| G-11-04 | Assign or change a person's role and scopes | Single approver, within own scope | Unit administrator or unit head | `ADMIN.ROLE_ASSIGNED`, `ADMIN.ROLE_REMOVED` |
| G-11-05 | Verify a professional credential or a competence (e.g. Hindi) | Single approver | Designated credential verifier | `ADMIN.CREDENTIAL_VERIFIED`, `ADMIN.COMPETENCE_VERIFIED` |
| G-11-06 | Activate just-in-time elevation | Self with reason and step-up; tenant may require an approver | Holder of the eligible role | `ADMIN.ELEVATION_ACTIVATED`, `ADMIN.ELEVATION_ENDED` |
| G-11-07 | Revoke a person's access in an emergency | Single approver with step-up | Tenant security administrator | `ADMIN.ACCESS_REVOKED_EMERGENCY` |
| G-11-08 | Recertify access | Single approver | Unit head | `ADMIN.ACCESS_RECERTIFIED`, `ADMIN.ACCESS_REMOVED_UNCONFIRMED` |
| G-11-09 | Grant Jurexio support access (content access needs a second approver) | Single approver; dual for content | Tenant security administrator; plus DPO or Compliance Officer for content | `ADMIN.SUPPORT_ACCESS_GRANTED`, `ADMIN.SUPPORT_ACCESS_ENDED` |
| G-11-10 | Change a security-relevant setting (identity provider, session policy, device or network rule, pack use for a unit) | Dual distinct | Tenant security administrator and Compliance Officer | `ADMIN.CONFIG_CHANGED` |
| G-11-11 | Platform break-glass access to a tenant | Dual distinct in Jurexio, with tenant notice | Two Jurexio security officers | `PLATFORM.BREAK_GLASS_APPROVED`, `PLATFORM.BREAK_GLASS_CLOSED` |
| G-11-12 | Publish a permission catalogue, template or separation-of-duties version | Dual distinct | Jurexio CTO and Jurexio Compliance | `PLATFORM.CATALOGUE_PUBLISHED` |
| G-11-13 | Approve an external user | Dual distinct | Internal sponsor and unit administrator | `ADMIN.EXTERNAL_USER_APPROVED` |
| G-11-14 | Relocate a person's identity record to another region | Dual distinct | Unit head and Data Protection Officer | `ADMIN.USER_RELOCATED` |

### Flow F1 — Add a country or branch

- **Steps:** administrator creates a unit, chooses type and parent; attributes are inherited or set; impact preview; second approver confirms (G-11-01); unit goes live for users; client matters open only once its pack is counsel-validated.
- **Primary act:** the second approver reads the unit's jurisdiction, region and pack before approving.

### Flow F2 — Build a custom role

- **Steps:** copy a template or start empty; add permissions (only ones the builder holds); separation-of-duties check; impact preview of who gains or loses what; protected permissions to dual approval (G-11-03); new role version saved (G-11-02).
- **Primary act:** the builder reads the impact preview before saving.

### Flow F3 — Joiner

- **Steps:** directory creates the account; templates suggested by unit and job title; unit administrator approves first assignments (G-11-04); credential verification before any approval permission works (G-11-05); MFA enrolment, phishing-resistant if privileged.
- **Primary act:** the unit administrator reads suggested roles and scopes before approving.

### Flow F4 — Mover

- **Steps:** directory reports a unit change; old scoped assignments end; new ones proposed and approved (G-11-04); walls tied to the person remain.
- **Primary act:** the new unit's administrator approves the proposed access.

### Flow F5 — Leaver

- **Steps:** directory disables the person; all sessions and tokens end; all access revoked; open deadlines, AI reviews, obligations and approvals reassigned to backups or eligible colleagues; records stay attributed.
- **Primary act:** the unit head reviews the reassignment summary and fixes any item without a backup.

### Flow F6 — Access recertification

- **Steps:** campaign opens on schedule; unit heads confirm or remove each person's access (G-11-08); protected permissions reviewed more often; unconfirmed access removed at the deadline.
- **Primary act:** the unit head reads each person's roles, scopes and last use before deciding.

### Flow F7 — Support access

- **Steps:** Jurexio support raises a request naming scope and period; tenant approves (G-11-09), metadata only by default; content needs a second approver; every action logged in the tenant's Ledger; access ends automatically.
- **Primary act:** the tenant security administrator reads the requested scope and period before approving.

### Screen inventory for UX (FLAG-007)

| Screen | Flow / gate | Primary act |
| --- | --- | --- |
| SCR-11-01 Organisation tree | F1, G-11-01 | Browse and edit units; read inherited attributes |
| SCR-11-02 People | F3–F5, G-11-04, G-11-07 | Find a person; read roles, scopes, credentials; act |
| SCR-11-03 Role builder | F2, G-11-02, G-11-03 | Build or edit a role; read the impact preview |
| SCR-11-04 Access explorer | — | Answer "who can do X here?" and "what can this person do, and why?" |
| SCR-11-05 Credentials and competence | G-11-05 | Verify credentials, jurisdiction scope and language competence |
| SCR-11-06 Identity and sign-in | G-11-10 | Configure identity providers, MFA, sessions, device and network rules |
| SCR-11-07 Access reviews | F6, G-11-08 | Run and complete recertification campaigns |
| SCR-11-08 External users | G-11-13 | Sponsor, approve and renew external users |
| SCR-11-09 Support access | F7, G-11-09 | Approve, watch and end Jurexio support sessions |
| SCR-11-10 Policies and configuration history | G-11-10 | Change policies within allowed ranges; view versions and roll back |
| SCR-11-11 Elevation | G-11-06 | Activate and end just-in-time elevation |
| SCR-11-12 Platform operations console (Jurexio) | G-11-11, G-11-12 | Manage packs, registries, templates, plans; metadata only |

## Section 4 — Data architecture

### Inputs

| Source | What enters |
| --- | --- |
| Client identity providers (SAML 2.0, OpenID Connect) | Sign-in assertions, MFA results |
| Client directories (SCIM 2.0) | Joiners, movers, leavers; job titles; unit membership |
| Tenant administrators | Units, roles, assignments, policies, external users, support grants |
| Credential verifiers | Bar and practising-certificate verification; jurisdiction and language competence |
| Platform operations | Permission catalogue, role templates, separation-of-duties rules, Jurisdiction Packs, registries, plans, release flags |

### Outputs

| Destination | What exits |
| --- | --- |
| Every module and the Jurexio Engine | Central access decisions; signed access assertions across regions |
| Jurexio Engine (M03) | Reviewer eligibility: credential, jurisdiction scope, language competence |
| DeadlineGuard, Engine, RegRadar | Reassignment of a leaver's open work |
| Jurexio Ledger (M09) | Every administrative, identity and configuration event |
| RegRadar (M07) | Practising-status evidence for the firm compliance check |
| BillGuard (M06) | Subscription entitlements (rate cards and billing guidelines now live in BillGuard) |

### Core records

| Record | Key fields | Where it lives |
| --- | --- | --- |
| Tenant | Name, plan, home regions in use | Platform |
| Unit | Type, parent, legal entity, jurisdiction, pack, data region, time zone, calendar, language, status | Tenant, in each unit's region |
| Unit type | Standard or tenant-defined, allowed parents | Tenant |
| Person | Profile, primary unit, units, status, identity-provider reference | Person's home region |
| Routing index entry | Pseudonymous ID, tenant, home region, identity-provider reference | Global (no personal data) |
| Credential and competence | Type, jurisdiction scope, evidence pointer, verifier, status, expiry | Person's home region |
| Permission | Name, module, protected flag, step-up flag, catalogue version | Platform |
| Role and role version | Domain, permissions, template origin, version, approvers | Tenant |
| Assignment | Person, role version, scopes (entity, jurisdiction, units, domain, include children), start, expiry, approver | Person's home region |
| Separation-of-duties rule | Forbidden permission pairs, version | Platform |
| Policy and configuration version | Setting, value, allowed range, effective date, approvers, previous version | Tenant |
| Support grant | Requester, scope, content flag, period, approvers, actions log | Tenant's Ledger |
| Elevation | Person, permissions, reason, start, end | Person's home region |
| Review campaign | Unit, reviewer, items, decisions, deadline | Tenant |

**Schema changes for the CTO:** `jrx.rbac_roles` and `jrx.rbac_permissions` become the permission catalogue, roles and role versions; `jrx.org_config` becomes units, policies and configuration versions; `jrx.matter_role_grants` stays as matter-scoped assignments; `jrx.rate_cards` moves to BillGuard; `jrx.sdk_api_keys` moves to platform operations. The `role_domain` column (LEGAL, HR, SHARED) is retained on roles.

### Ledger events

| Domain | Events |
| --- | --- |
| `AUTH.` | `AUTH.SIGNED_IN`, `AUTH.SIGN_IN_FAILED`, `AUTH.MFA_ENROLLED`, `AUTH.STEP_UP_COMPLETED`, `AUTH.SESSION_ENDED`, `AUTH.ACCESS_DENIED` |
| `ADMIN.` | `ADMIN.UNIT_CREATED`, `ADMIN.UNIT_CHANGED`, `ADMIN.ROLE_VERSIONED`, `ADMIN.PROTECTED_PERMISSION_APPROVED`, `ADMIN.ROLE_ASSIGNED`, `ADMIN.ROLE_REMOVED`, `ADMIN.CREDENTIAL_VERIFIED`, `ADMIN.COMPETENCE_VERIFIED`, `ADMIN.ELEVATION_ACTIVATED`, `ADMIN.ELEVATION_ENDED`, `ADMIN.ACCESS_REVOKED_EMERGENCY`, `ADMIN.USER_DEPROVISIONED`, `ADMIN.WORK_REASSIGNED`, `ADMIN.ACCESS_RECERTIFIED`, `ADMIN.ACCESS_REMOVED_UNCONFIRMED`, `ADMIN.EXTERNAL_USER_APPROVED`, `ADMIN.SUPPORT_ACCESS_GRANTED`, `ADMIN.SUPPORT_ACCESS_ENDED`, `ADMIN.CONFIG_CHANGED`, `ADMIN.USER_RELOCATED` |
| `PLATFORM.` | `PLATFORM.CATALOGUE_PUBLISHED`, `PLATFORM.BREAK_GLASS_APPROVED`, `PLATFORM.BREAK_GLASS_CLOSED`, `PLATFORM.PACK_PUBLISHED` |

**Critical-class events:** protected-permission approvals, emergency revocations, deprovisioning, support grants, security-relevant configuration changes, break-glass, catalogue publication.

`AUTH.ACCESS_DENIED` is logged for every denial on protected actions and walled matters; routine denials are aggregated to keep the Ledger meaningful.

### Identity residency (D6)

- A person's record, credentials, assignments, elevations and sign-in history live in their home region.
- The global routing index holds only a pseudonymous ID, tenant, home region and identity-provider reference.
- Cross-region work uses a short-lived, signed access assertion from the home region; the decision is made in the region of the data, which keeps only a token and designation.

### Availability, performance and fail-safe behaviour

- The access-decision service runs highly available in every region; if it cannot decide, the answer is **deny** (fail closed).
- Decisions may be cached only briefly; revocations and leaver events invalidate caches at once, so a revoked person loses access within seconds (exact target set by the CTO).
- Sign-in depends on the client's identity provider; if it is down, Jurexio offers no weaker fallback for privileged users.
- Configuration rollbacks restore the previous version exactly and are themselves logged.

## Section 5 — Compliance requirements

India and the US are the live jurisdictions in v1.0, so the obligations below apply through their packs. Rows for the UK, EU, Singapore and GCC apply when those packs are activated.

### Regulations and standards, and how M11 satisfies them

| Regulation / standard | Requirement | How M11 satisfies it |
| --- | --- | --- |
| SOC 2 (CC6 logical access; CC7 monitoring; CC8 change management) | Provisioning, timely removal, periodic access review, privileged-access control, controlled change | Directory-driven lifecycle with instant revocation, recertification with automatic removal, just-in-time elevation, versioned and dual-approved configuration (D2, D4, D5, D7) |
| ISO/IEC 27001:2022 Annex A (5.3, 5.15–5.18, 8.2, 8.5) | Segregation of duties; access control; identity management; authentication; access rights; privileged access; secure authentication | Separation-of-duties rules, permission model, phishing-resistant MFA, step-up, elevation (R1, D2, D4) |
| NIST SP 800-63B; NIST SP 800-53 (AC-2, AC-5, AC-6); NIST SP 800-207 zero trust | Authenticator strength; account management; separation of duties; least privilege; per-request decisions | Phishing-resistant authenticators for privileged users; deny-by-default central decision evaluated on every request (R1, D4) |
| ISO/IEC 42001 | Defined roles and accountability for AI oversight | Named permissions for AI approval, credential and competence conditions (R1) |
| CERT-In Directions 2022 (India) | Maintain logs for a defined period; report incidents quickly | Identity and admin events in the Ledger; India pack sets retention and reporting duties |
| GDPR and UK GDPR (Articles 5, 32, 44–49) | Minimisation and security of staff data; transfer conditions | Home-region identity records, minimal routing index, signed assertions instead of copies (D6) |
| DPDP Act 2023 and Rules 2025; Singapore PDPA; GCC data-protection laws | Same duties for staff personal data | Same controls per pack (D6) |
| ABA Model Rules 1.6(c), 5.1, 5.3; BCI, SRA and other professional rules | Prevent unauthorised access; supervise staff and vendors | Operator separation, client-granted support access, scoped roles, walls in the access decision (D3) |
| Financial-sector outsourcing and third-party risk expectations (banks and other regulated clients) | Vendor access to client data must be controlled, logged and auditable | No standing vendor access; support access approved and logged in the client's own Ledger (D3) |

### Mandatory HTIL steps (never automated)

- Creating or changing units that set a jurisdiction or data region (G-11-01).
- Adding protected permissions to roles (G-11-03), and every role assignment (G-11-04).
- Verifying credentials and competence (G-11-05).
- Emergency revocation (G-11-07) and recertification decisions (G-11-08).
- Granting Jurexio support access (G-11-09) and approving break-glass (G-11-11).
- Security-relevant configuration changes (G-11-10).
- Publishing catalogue, template and separation-of-duties versions (G-11-12).
- Approving external users and relocating identity records (G-11-13, G-11-14).

### Decisions that must remain human

- Who may hold which permissions, in which units.
- Whether a person's credential and competence are genuine and current.
- Whether Jurexio may see anything inside a tenant.
- Whether access still serves its purpose.

The system acts on its own only to protect: denying by default, revoking leavers, ending elevations, removing unconfirmed access and suspending dormant accounts.

### Approved claims language

- "Add countries, branches and roles without engineering."
- "Every permission scoped, reviewed and provable."
- "Jurexio staff cannot read your data, and your own Ledger proves it."
- "No setting can switch off a compliance control."
- Prohibited: "Platform Chairman full access", "8-tier RBAC" or "L1–L9" as current descriptions, "Jurexio super admin", and any claim of certification (SOC 2, ISO) before it is achieved.

## Section 6 — Module dependencies

### Upstream (M11 depends on)

| Dependency | What M11 needs |
| --- | --- |
| Jurexio Ledger Core (M09) | Outbox and critical-event sealing for every administrative and identity event |
| Client identity providers and directories | SAML 2.0 or OpenID Connect sign-in; SCIM 2.0 provisioning |
| Regional infrastructure in all six jurisdictions | Identity stores, keys and access-decision services per region |
| Jurisdiction Packs | Unit attributes per jurisdiction; credential and practising-status rules; CERT-In and other log duties |
| `nv_pii_vault` | Tokenisation of personal identifiers in Ledger events |

### Downstream (depend on M11)

Every module. No module may implement its own access rules; each calls the central access decision.

| Module | What it takes from M11 |
| --- | --- |
| MatterCore (M01) | Units, people, roles for opening, conflicts and walls; walls are evaluated inside the access decision |
| Jurexio Engine (M03) | Reviewer eligibility; protected permissions for approval and kill-switch; model-registry approvers |
| Jurexio Ledger (M09) | Approver roles for certification, erasure, holds; identity-resolution rights |
| DeadlineGuard, RegRadar, Engine | Leaver work reassignment; risk owner and conflicts reviewer roles |
| DataMigrate (M14) | Board, CEO and IT Director approver mapping per client type; operator support grants |
| DocVault (M02) | Lawyer-only actions gated by credential verification |
| BillGuard (M06) | Entitlements; takes over rate cards and billing guidelines |

### Sequencing

M11 builds in Sprint 1 with Ledger Core and MatterCore Foundation. Its role taxonomy freezes before any other module's approval logic is coded, as the CTO Mapping requires.

### Agent touchpoints

Through the Jurexio Engine only: suggestion of role templates for joiners, by unit and job title. No agent can assign, grant, revoke or configure anything.

## Section 7 — v1.0 scope vs deferred scope

The v1.0 feature list is in Section 1. India and the US are live in v1.0; the other four packs are built as configuration and inactive.

### v1.0 build increments

| Increment | Contents | Needed by |
| --- | --- | --- |
| Identity and Access Core | Tenants, organisation tree, permission catalogue, role templates, scoped assignments, central access decision, single sign-on, SCIM, MFA, step-up, session policy, regional identity stores and routing index, platform and tenant console separation | Sprint 1: every module's first line of code |
| Governance | Custom roles with guardrails and impact preview, separation-of-duties rules, just-in-time elevation, credential and competence verification, configuration versioning with dual approval, support-access grants, break-glass | Before any approval permission is used in production |
| Lifecycle | Mover and leaver automation with work reassignment, emergency revocation, dormancy, external-user expiry, access recertification campaigns, identity relocation | Before the first client goes live |

### Release testing

- **Deny by default:** an action with no matching permission, scope, context or strength is refused.
- **No escalation:** no administrator can create or assign permissions they do not hold, or act outside their unit.
- **Separation of duties:** every forbidden pair is rejected in roles and in actions.
- **Controls are not settings:** no tenant setting, flag, plan or operator action can disable HTIL review, Ledger logging, residency, walls, same-actor guard, step-up or separation-of-duties rules.
- **Operator separation:** Jurexio operator accounts cannot read any tenant content; support access works only after tenant approval and ends on time.
- **Strength:** protected actions fail without fresh step-up; privileged users cannot sign in without phishing-resistant MFA.
- **Leavers:** a deprovisioned user loses all access within the target time, and every open item is reassigned.
- **Recertification:** unconfirmed access is removed at the deadline.
- **Residency:** identity records stay in the home region; the routing index holds no personal data; cross-region decisions use signed assertions.
- **Fail closed:** when the decision service is unavailable, requests are denied.
- **New unit:** a new country or branch can be added and used without a release.

### Deferred scope

| Feature | Release trigger | Reason |
| --- | --- | --- |
| Password-based sign-in for small firms without an identity provider | Approved design using Jurexio-hosted identity with phishing-resistant MFA | Institutional clients bring their own identity provider; a hosted option needs its own security review |
| Hardware-backed device attestation | Client demand from government or defence tenants | Device and network conditions cover v1.0 |
| Attribute feeds from HR systems beyond SCIM (e.g. Workday job architecture) | NexusConnect HRIS connectors released | SCIM covers joiners, movers and leavers |

### Rejected (not deferred)

| Option | Reason |
| --- | --- |
| Fixed L1–L9 tiers | Cannot express scoped, multi-location, custom roles (R1) |
| Jurexio super administrator with tenant access | Breaks client confidentiality and buyer trust (D3) |
| One global identity directory | Standing cross-border transfer of staff data (D6) |
| Settings or flags that weaken controls | Would make every compliance guarantee optional (D7) |
| 24-hour access and 30-day refresh tokens | Too long for privileged sessions (D4) |

## Section 8 — Open questions and blockers

### Decisions requiring Chairman or CTO input

| # | Question | Owner | Recommendation |
| --- | --- | --- | --- |
| OQ-11-01 | Permission catalogue v1, compiled from every gate register already specified (G-01 to G-14) | CTO | Deliver before any Sprint 1 code; one named permission per gate decision |
| OQ-11-02 | Recertification cadence | Chairman | Quarterly for protected permissions; twice a year for all other access |
| OQ-11-03 | Dormancy suspension period | Chairman | 45 days for privileged users; 90 days for others |
| OQ-11-04 | Default session limits (tenants may tighten) | CTO | Privileged: 15-minute idle, 8-hour absolute. Standard: 30-minute idle, 12-hour absolute |
| OQ-11-05 | Revocation propagation target | CTO | Under 60 seconds across all regions |
| OQ-11-06 | Who are Jurexio's security officers for break-glass and catalogue publication | Chairman | Two named officers, neither holding engineering deploy rights |
| OQ-11-07 | Default approver mapping for Board, CEO and IT Director roles per client type (law firm, corporate, PSU, ministry) | Chairman | Ship a template per client type, editable by the tenant (links OQ-14-02) |
| OQ-11-08 | How pilot clients without an identity provider sign in | Chairman | Require an identity provider for the first pilots; prioritise the hosted-identity design only if a pilot needs it |

### Compliance validations pending

- [ ] CERT-In log-retention and incident-reporting duties confirmed for identity and admin logs (India counsel).
- [ ] Lawful basis for processing staff identity data, per jurisdiction.
- [ ] Employee-consultation requirements (e.g. works councils in some EU member states) for logging staff sign-in and activity.
- [ ] Credential-verification sources per jurisdiction: bar registers, practising-certificate verification.

### Items blocking engineering start

- [ ] Chairman sign-off (consolidated end review).
- [ ] Jurexio Ledger Core (M09) design frozen.
- [ ] Regional infrastructure available in India and the US (identity store, keys, decision service).
- [ ] Permission catalogue v1 and role-template set v1 (OQ-11-01).
- [ ] Separation-of-duties rule set v1.
- [ ] Test tenants with real SAML or OpenID Connect identity providers and SCIM.

### Housekeeping

- [ ] Retire "8-tier RBAC", "L1–L9" and "L9 Super Admin — Platform Chairman" from both demos and the Architecture Spec.
- [ ] Replace the CTO Mapping's trust-level seeds (HR roles at 2, 4, 6) with role templates.
- [ ] In the consolidation pass, replace numbered levels in the Ledger, Engine and DataMigrate specs (e.g. "RBAC L5+", "L7 kill-switch", "L8 key rotation") with named permissions.
- [ ] Move rate cards and billing guidelines into the BillGuard specification.
