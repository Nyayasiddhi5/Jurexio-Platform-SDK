<!-- Source of truth: https://claude.ai/code/artifact/e9471381-b5a1-4c11-ae4e-82ec0ec0b80b · exported 21 Oct 2026 · do not edit here; edit the Claude Doc and re-export -->

# Module Specification — M03 Jurexio Engine

Oct 16, 2026 · @Suresh Singh

## Document control

| Field | Value |
| --- | --- |
| Module | M03 Jurexio Engine (formerly Nyayavigya Engine) |
| Spec version | v1.1 (consolidated after the PDD Review Log, 18 Oct 2026), consolidation of Track A Backend v2, Track A v2.0, Track B v2 and UI v3 with October 2026 decisions |
| Design order | 3 of 14 |
| Engineering owner | CTO (Vamsi) |
| Jurisdiction Pack inputs | Raja Sekhar T |
| Status | Sign-off deferred to the consolidated end review. No engineering start before sign-off. |

### Decision log

Inherited April 2026 architecture decisions (Track A) remain in force except where an October decision replaces them.

| ID | Decision | Status |
| --- | --- | --- |
| DR-01 | Gate 7 is output-release authorisation with three sub-checks | Inherited; sub-check 1 amended by R1 |
| DR-02 | Agent router resolves chains; the Queen is stateless per request | Inherited |
| DR-03 | outputContext drives review for MEDIUM risk | Replaced by R1 and R6 |
| DR-04 | billingCode always mandatory; SYS\_ namespace for system calls | Inherited |
| DR-05 | No streaming: server-side buffer, 30-second timeout | Inherited (FLAG-005) |
| DR-06 | Two-layer product isolation by key namespace | Inherited; branding per R4 |
| R1 | Human review on every output that can affect a matter, client or third party; classification fixed by calling route; SYSTEM\_REPORT internal-only; LOW-risk direct release closed | Locked |
| R2 | English interface always; Hindi as content language; Hindi outputs approved only by verified Hindi-competent reviewers | Locked |
| R3 | Reviewer stamp: name and designation in-app (L4+); designation only in external views; rendered from Ledger at display time | Locked |
| R4 | The Jurexio SDK is used by Jurexio only. Ownership of the engine core and any licence of it to another entity is governed by an intercompany agreement, outside this PDD (C-17) | Locked |
| R5 | Registry is the source of truth; public wording "148+ specialised agents and a Queen orchestration layer"; variants counted within agents | Locked |
| R6 | outputContext: LEGAL\_WORKFLOW, HR\_WORKFLOW, SYSTEM\_REPORT; every HR tier reviewed; unknown HR types default to Tier 3 | Locked |
| R7 | India and US (all states) live; UK, EU, SG, GCC built-inactive until validated and activated by the Chairman; ISO 3166 and forum codes | Locked |
| D1 | In-region inference only; per-jurisdiction model registry; zero-retention and no-training terms; residency gate | Locked |
| D2 | Reviewer jurisdiction match: state level for jurisdiction-specific work, country level for general; co-approval exception | Locked |
| D3 | Automatic citation verification before the queue; "Not found" blocks approval; "Unverifiable" must be opened | Locked |
| D4 | Layered injection defence; agents can never act | Locked |
| D5 | Retrieval mirrors the requester's permissions; institutional knowledge only through approved promotion | Locked |
| D6 | SLA ladder ending "Review not completed"; SLA capped before linked deadlines | Locked |
| D7 | Billing and disclosure under firm policy; per-matter "AI prohibited" flag enforced at JESS | Locked |
| D8 | Per-agent monitoring; quality triggers need dual human decision; safety triggers suspend automatically; evaluation before model changes | Locked |

### Rename register (Nyayavigya retired)

| Former | Current |
| --- | --- |
| Nyayavigya Engine | Jurexio Engine |
| Nyayavigya SDK v5.0.0 | Jurexio SDK v5.0.0 (version pin kept) |
| `/api/nv/*` | `/api/jxsdk/*` (internal SDK routes, called only by M03) |
| `NYV_` environment variables | `JXSDK_` |
| `X-NYV-Platform` header | `X-JXSDK-Platform` |
| `api.nyayavigya.ai` (single global URL) | Per-region Jurexio SDK endpoints (D1) |
| NYV pattern P01–P22 | JX pattern P01–P22 |
| `nyayavigya-registry-v5.0.0.json` | `jurexio-sdk-registry-v5.0.0.json` |
| "Nyayavigya AI" in interface strings | "Jurexio Engine" |
| AI\_*, HITL\_*, SECURITY\_\* events | `ENGINE.*` (M09 naming rule) |

Proposed new identifiers above are for CTO confirmation (OQ-03-01).

### Consolidation v1.1 (PDD Review Log, 18 Oct 2026)

**Platform rules applied to this specification**

- **Gate outcomes (CB-ENG-06, CB-DES-05):** every gate records approved, rejected and withdrawn outcomes as Ledger events; rejection needs a reason; the gate engine generates the `_REJECTED` and `_WITHDRAWN` event names into Event registry v1. Every gate screen shows pending, approved, rejected and withdrawn.
- **Gate classes (I-05):** GUARDED = the requester can never approve; DUAL = two distinct people; SELF-ATTESTED = an act on one's own record, with reason, evidence and step-up where stated, logged and sampled by Compliance.
- **Approvers (C-02, CB-ENG-04):** numbered RBAC levels are retired; every approver maps to named permissions in Permission catalogue v1. "Jurexio" marks platform roles; unprefixed roles are tenant roles.
- **Canonical events (C-07, C-15):** one act produces one canonical event, owned by the module that owns the record; other context goes in attributes.
- **Design order (C-13):** the order specs were designed, not the engineering sequence, which the CTO publishes.
- **Doctrine defined here for all modules (CB-DES-03, CB-DES-04):** confidence bands 0.80 and above HIGH (Emerald), 0.60–0.79 MEDIUM (Gold), below 0.60 LOW (Indigo, human review mandatory); HTIL HOLD shown as a Royal Blue banner. AI badge: Deep Indigo background, Gold text, mandatory on all Engine-drafted or AI-suggested content, per paragraph in the read-only preview. The UX Manager issues one shared badge component for every suggestion surface.

**Gate classes in this module**

| Class | Gates |
| --- | --- |
| GUARDED | G-03-01, G-03-03, G-03-06, G-03-10 |
| DUAL | G-03-02, G-03-04, G-03-05 (sequential, separate sessions), G-03-07, G-03-08, G-03-09 |
| SELF-ATTESTED | None |

**Module changes**

- **C-05 and CB-DES-07:** five citation verdicts platform-wide, each with an event and a citation-panel state: Verified (may proceed), Not found (hard block), Quote mismatch (hard block on that quotation), Unverifiable (reviewer must open the source), Negative treatment (reviewer must open and acknowledge). No "good law" badge.
- **C-14:** for client-facing drafts, module gates narrow G-03-01: the approver is the Responsible Partner, or an eligible partner where the Responsible Partner requested the draft. One approval writes `ENGINE.REVIEW_APPROVED` and the module event, linked by `request_id`.
- **C-17 and D-01 (P0, Chairman with counsel):** R4 restated without other-company references; OQ-03-03 removed.
- **D-05 and BQ-09:** one identifier prefix family for routes, environment variables and headers, confirmed by the CTO in the rename register before Sprint 2.
- **CB-ENG-08 and BQ-06 (accepted):** LOW-risk legal output review SLA of 48 hours; every review SLA ends at least 24 hours before a linked court deadline; packs may tighten per forum.
- **CB-DES-06:** Engine screens renumber to SCR-03-01 onward, with a legacy Figma mapping table.
- **CB-DES-08:** in-app names require `identity.name.view`; court, export, client and audit views always show designations.
- **BQ-07 (accepted):** state-level reviewer match for filings, pleadings, state-law advice and deadline calculations, encoded per state pack.
- **BQ-08 (P0, launch-critical):** the CTO confirms at least one approved model per live region (ap-south-1, us-east-1), including Hindi content capability, on zero-retention and no-training terms. Without one in ap-south-1 there is no India AI launch; Jurexio's own Hindi SLM trained on the India corpus (M04 D7) runs as a parallel track.

## Section 1 — Module identity

| Field | Value |
| --- | --- |
| Module | M03 Jurexio Engine |
| Code | `jrx-ai-engine.ts` |
| Tagline | Governed legal AI: every output gated, verified and approved by a qualified human. |
| Job to be done | Route every AI request from the other 13 modules to the Jurexio SDK through seven enterprise gates, keep data in its home region, and release nothing that can affect a matter, client or third party without a qualified human's approval. |
| Agent pool | 148+ specialised agents and a Queen orchestration layer (stateless per request); registry is the source of truth (R5) |
| Hard rules | M03 is the only caller of the SDK. Every call carries matter, billing code and jurisdiction. Seven JESS gates run before every call. No streaming. Agents can never act (D4). |
| Primary users | Partners and senior associates (reviewers), HR Directors and employment counsel (HR reviewers), Compliance Officer, CTO, holders of the kill-switch permission |
| Secondary users | Every module that requests AI; lawyers who request drafts, research and summaries |
| Live jurisdictions | India and the United States, every state and union territory (R7) |
| Languages | English interface; English and Hindi content (R2) |

### v1.0 scope — in

- SDK gateway with seven JESS gates, extended for residency of the model endpoint (D1) and client AI terms (D7).
- Agent router and stateless Queen orchestration with per-node governance (DR-02).
- Server-side output buffer with 30-second timeout (DR-05).
- Three output types with route-fixed classification (R1, R6).
- Legal review queue and full review interface with annotations.
- HR three-tier review chain with Tier 3 dual sign-off (R6).
- Reviewer eligibility: credential, jurisdiction match, Hindi competence (FLAG-004, D2, R2).
- Citation verification before the queue (D3).
- Injection defence and output leakage check (D4).
- Permission-mirrored retrieval (D5).
- SLA ladder and deadline cap (D6).
- Per-jurisdiction model registry and in-region inference (D1).
- Per-agent quality monitoring and agent suspension (D8).
- Kill-switch with dual reinstatement.
- AI usage dashboard and cost records per matter.
- Hindi drafting, summarisation and labelled AI translation for India packs.

### v1.0 scope — out

Deferred items and triggers are in Section 7.

## Section 2 — User stories

### US-03-01 Request AI help inside a matter

As an **associate**, I need to request a draft, research or summary from within my matter so that the AI works with the right context and billing.

- Every request carries matter, billing code and jurisdiction; a missing billing code is rejected.
- If a gate fails, I see which gate and a plain-language reason (e.g. "Client terms prohibit AI on this matter").
- No partial text appears while the AI works; I see a status, then the complete output after review.

### US-03-02 Review an AI draft properly

As a **Partner**, I need to review the full output with its context, citations and confidence before deciding so that my approval is an informed professional act.

- Approve, approve with edits, reject and escalate stay inactive until the dwell and scroll gate is met (FLAG-007) and my credential is verified (FLAG-004).
- I only see items I am eligible to approve: jurisdiction match (D2) and, for Hindi, verified Hindi competence (R2).
- Rejection needs a reason of at least 50 characters.

### US-03-03 Trust every citation

As a **Partner**, I need every citation checked before I see the draft so that I never file a fabricated authority.

- Each citation shows Verified, Not found, or Unverifiable.
- Any "Not found" keeps approval inactive until I remove it or attach its source.
- Each "Unverifiable" citation must be opened before approval activates.

### US-03-04 Approve high-exposure HR documents safely

As an **HR Director**, I need terminations and settlements approved by employment counsel and me in separate sessions so that no single person releases a high-exposure document.

- Tier 3 requires two distinct people; the same person cannot approve twice.
- Unknown HR document types are treated as Tier 3.
- Tier assignments follow the matter's Jurisdiction Pack.

### US-03-05 Keep client data in its country

As a **Compliance Officer**, I need every AI call processed only in the matter's home region so that the zero cross-border promise holds for AI.

- A call to a model endpoint outside the matter's region is blocked and logged.
- There is no fallback to another region; an unavailable capability shows as a gate failure.
- Only models in the jurisdiction's approved registry can be called.

### US-03-06 Never miss a deadline because of a stuck review

As a **Partner**, I need reviews linked to court deadlines escalated before they endanger the deadline so that AI review never causes a missed filing.

- Reminder at 50% of SLA, escalation at breach, partner escalation at second breach.
- A review linked to a DeadlineGuard deadline cannot run past the safe margin before it.
- An unreviewed output ends as "Review not completed" and is never released.

### US-03-07 Stop one bad agent without stopping everything

As a **CTO**, I need to suspend a single underperforming agent in one jurisdiction so that quality problems are contained without a platform-wide shutdown.

- Quality alerts require a joint Jurexio CTO and Jurexio Compliance decision to suspend.
- Safety triggers suspend the agent automatically; reinstatement needs both approvers.
- Every suspension and reinstatement is logged.

### US-03-08 Halt all AI in an emergency

As an **kill-switch administrator**, I need a kill-switch so that all AI can be stopped instantly in a security incident.

- Activation needs a reason of at least 30 characters.
- Reinstatement needs two distinct L7 administrators.
- In-flight requests are cancelled and logged.

## Section 3 — Pipeline, gates and key user flows

### The seven JESS gates

Gates run in order and fail fast. Before Gate 1, the kill-switch is checked. Every gate result writes a Ledger event.

| Gate | Check | Failure | Change from April |
| --- | --- | --- | --- |
| 1 Authentication | SDK key in the JRX\_ namespace; valid session | 401 | Product isolation per R4 |
| 2 Role | User holds the task's required permission | 403 | — |
| 3 Rate limit | Organisation within its per-minute quota | 429 | — |
| 4 Residency | Matter's home jurisdiction matches the pack's region **and** the target model endpoint is in that region and in the jurisdiction's approved registry | 451 | Model endpoint check added (D1) |
| 5 Matter eligibility | Conflict check cleared **and** the matter is not flagged "AI prohibited" | 409 | Client AI terms added (D7) |
| 6 Budget | Projected cost within the matter's AI cap | 429 | — |
| 7 Output release authorisation | Sets review requirement, destination rules and jurisdiction restrictions (SUPPRESS, ANNOTATE, FORCE\_HITL) | 451 on SUPPRESS | Review rule replaced (R1) |

The router excludes suspended agents (D8); if no eligible agent remains, the request ends as "Agent suspended".

### Checks after generation, before the queue

1. **Citation verification (D3):** every citation marked Verified, Not found or Unverifiable.
2. **Leakage check (D4):** content from outside the matter holds the output for security review.
3. **Source flags (D4):** hidden or instruction-like text found at ingestion is shown to the reviewer.

### Review rules (replaces the April Gate 7 matrix)

| Output type | Review | Reviewer |
| --- | --- | --- |
| LEGAL\_WORKFLOW | Always. Risk level sets SLA and depth only | Credential-verified, jurisdiction-matched (D2); Hindi-competent for Hindi (R2) |
| HR\_WORKFLOW | Always, by tier; unknown types are Tier 3 | Tier 1: HR Director. Tier 2: HR Director and employment counsel. Tier 3: counsel, then HR Director, separate sessions |
| SYSTEM\_REPORT | No individual review; AI badge; monthly sampled review | Internal roles only; cannot be attached, exported or sent without reclassification and review |
| Any output to ClientBridge | Always | As for LEGAL\_WORKFLOW |
| Pack rule FORCE\_HITL | Always | As above |
| Pack rule SUPPRESS | Not deliverable in that jurisdiction | — |

Classification comes from the calling route's registered output type, never from the AI and never from a value the calling module supplies freely.

### Review SLAs (inherited from Track A; shortest applicable wins)

| Trigger | SLA |
| --- | --- |
| Court-filing flag from DeadlineGuard | 1 hour |
| Draft task; HIGH or CRITICAL risk; ClientBridge destination | 2 hours |
| MEDIUM-risk legal workflow; Hindi output | 24 hours |
| LOW-risk legal workflow (newly reviewed under R1) | To be set (OQ-03-02) |
| HR Tier 1 / Tier 2 / Tier 3 | 4 / 8 / 24 hours |

Any SLA is capped at the safe margin before a linked DeadlineGuard deadline (D6).

### Request states

The nine April states remain: awaiting AI, processing, held for review, extended processing (over 30 seconds), approved and released, rejected, gate failed, budget exceeded, kill-switch active. Three end states are added:

- **Review not completed:** SLA ladder exhausted; output never released (D6).
- **Blocked by policy:** client AI terms, residency, or reviewer eligibility prevented the request (D1, D2, D7).
- **Agent suspended:** no eligible agent available (D8).

Release of an approved output is a Ledger critical event; in Ledger degraded mode it shows "Awaiting seal" until sealed.

### HTIL gate register

Gate classes are listed under Consolidation v1.1 in Document control. The locked same-actor guard applies to every AI output approval: the requester can never approve.

| Gate | Decision | Gate type | Approver role | Ledger events |
| --- | --- | --- | --- | --- |
| G-03-01 | Approve, edit, reject or escalate a legal output | Single approver | Credential-verified, jurisdiction-matched reviewer holding \`engine.review.approve\` | `ENGINE.REVIEW_APPROVED`, `ENGINE.REVIEW_APPROVED_ANNOTATED`, `ENGINE.REVIEW_REJECTED`, `ENGINE.REVIEW_ESCALATED` |
| G-03-02 | Cross-jurisdiction co-approval | Dual distinct | Non-matching reviewer and matching reviewer | `ENGINE.CO_APPROVAL_RECORDED` |
| G-03-03 | HR Tier 1 approval | Single approver | HR Director | `ENGINE.HR_TIER1_APPROVED` |
| G-03-04 | HR Tier 2 approval | Dual distinct | HR Director and employment counsel | `ENGINE.HR_TIER2_APPROVED` |
| G-03-05 | HR Tier 3 approval | Sequential, separate sessions | Employment counsel, then HR Director | `ENGINE.HR_TIER3_COUNSEL_APPROVED`, `ENGINE.HR_TIER3_RELEASED` |
| G-03-06 | Extend a review SLA within the deadline cap | Single approver | Responsible Partner | `ENGINE.SLA_EXTENDED` |
| G-03-07 | Reinstate AI after a kill-switch | Dual distinct | Two holders of \`engine.killswitch.reinstate\` | `ENGINE.KILLSWITCH_REINSTATED` |
| G-03-08 | Suspend (quality) or reinstate an agent | Dual distinct | Jurexio CTO and Jurexio Compliance | `ENGINE.AGENT_SUSPENDED`, `ENGINE.AGENT_REINSTATED` |
| G-03-09 | Add or retire a model in a jurisdiction's registry | Dual distinct | Jurexio CTO and Jurexio Compliance | `ENGINE.MODEL_REGISTERED`, `ENGINE.MODEL_RETIRED` |
| G-03-10 | Activate a jurisdiction | Single approver | Chairman | `ENGINE.JURISDICTION_ACTIVATED` |

Hindi-competence tags and credential scope are verified in CommandCentre (M11). Knowledge promotion into LexGraph is specified in M04.

### Flow F1 — Request to release

- **Entry:** any module calls M03 with matter, billing code, jurisdiction and its registered route.
- **Step 1:** kill-switch check, then the seven gates.
- **Step 2:** router resolves the agent chain, excluding suspended agents; the Queen executes node by node in the home region, logging each step (M09 D11).
- **Step 3:** output collects in the server-side buffer; after 30 seconds the requester sees "Processing".
- **Step 4:** citation, leakage and source-flag checks.
- **Step 5:** review by output type; on approval, the release is sealed in the Ledger and delivered to the requesting module.
- **Primary act:** the requester reads the status and, on failure, the plain-language reason.

> **Diagram:** Flow F1 · request to release — rendered in the source Claude Doc: https://claude.ai/code/artifact/e9471381-b5a1-4c11-ae4e-82ec0ec0b80b

A failed gate, a rejection, or an exhausted SLA ends the request; none of them ever releases output.

### Flow F2 — Legal review

- **Entry:** reviewer opens an item from the queue (only eligible items are visible).
- **Steps:** read matter context, full output with AI badges, confidence, citation panel and source flags; resolve every "Not found" citation; open every "Unverifiable" one; annotate if needed; decide.
- **Primary act:** read the full output to the end, then decide; actions stay inactive until the dwell and scroll gate and citation conditions are met.

### Flow F3 — HR Tier 3 dual sign-off

- **Steps:** employment counsel reviews and approves; a different person, the HR Director, reviews in a separate session and co-approves to release, or rejects or escalates to the CHRO.
- **Primary act:** each approver reads the document and the other approver's notes before deciding.

### Flow F4 — SLA escalation

- **Steps:** reminder at 50%; at breach, reassignment to the next eligible reviewer and a notice to the requester; at second breach, the responsible Partner and Compliance Officer view; final state "Review not completed".
- **Primary act:** the Partner reads the overdue item and its deadline link, then reassigns, extends within the cap (G-03-06), or lets it close.

### Flow F5 — Kill-switch

- **Steps:** an L7 administrator activates with a reason of at least 30 characters; all in-flight requests are cancelled and logged; two distinct L7 administrators reinstate (G-03-07).
- **Primary act:** the administrator reads the scope and impact count before confirming.

### Flow F6 — Agent quality and suspension

- **Steps:** metrics cross a threshold; the Jurexio CTO and Jurexio Compliance review and decide (G-03-08). Safety triggers suspend automatically and await the same reinstatement.
- **Primary act:** the approvers read the agent's metrics and sample outputs before deciding.

### Screen inventory for UX (FLAG-007)

| Screen | Flow / gate | Primary act |
| --- | --- | --- |
| SCR-01 Review queue | F2, F4 | Pick the most urgent eligible item; filters show active jurisdictions only |
| SCR-02 Legal review interface | F2, G-03-01, G-03-02 | Read the full output, resolve citations, then decide |
| SCR-02-HR HR review interface | F3, G-03-03 to G-03-05 | Read, check tier and co-approver notes, then decide |
| SCR-03/04 Request states (in requesting module) | F1 | Read status and any failure reason |
| SCR-05 AI usage dashboard | — | Read usage and cost by matter, agent and output type |
| SCR-06 Kill-switch activation | F5 | Read impact, give reason, confirm |
| SCR-07 Kill-switch reinstatement | F5, G-03-07 | Second administrator reads the incident record and approves |
| SCR-08 Agent quality and suspension (new) | F6, G-03-08 | Read metrics and samples, then suspend or reinstate |
| SCR-09 Model registry (new) | G-03-09 | Review evaluation results, then register or retire a model |

The citation panel and source-flag banner are components of SCR-02 and SCR-02-HR. Names appear in-app for holders of \`identity.name.view\`; designations only in exports (R3).

## Section 4 — Data architecture

### Inputs

| Source | What enters |
| --- | --- |
| Calling modules (13) | Request with matter, billing code, jurisdiction, registered route, intent and payload |
| MatterCore (M01) | Matter context, conflict status, "AI prohibited" flag |
| BillGuard (M06) | Matter AI budget and cap |
| CommandCentre (M11) | Org config, permissions, credential scope, Hindi-competence tags, model registry, Jurisdiction Pack |
| DocVault (M02) | Documents the requester may open (retrieval mirrors permissions, D5) |
| LexGraph (M04) | Promoted institutional knowledge; authorities for citation verification |
| Jurexio SDK (per region) | Agent outputs, token counts, model versions |

### Outputs

| Destination | What exits |
| --- | --- |
| Requesting module | Approved output, or status and failure reason |
| Review queue | Held outputs with context, citations and flags |
| Jurexio Ledger (M09) | Every gate, step, review and release event (hashes and pointers only) |
| BillGuard (M06) | Cost record per call: matter, agent, jurisdiction, output type, tokens, cost, billing code |
| PulseComms (M12) | Reviewer notifications, SLA reminders and escalations, kill-switch alerts |
| DeadlineGuard (M05) | Dependency flags where a deadline waits on a review |

Cost records move through the Ledger outbox, not fire-and-forget, so none can be lost.

### Ledger events (renamed to the M09 rule)

| April name | New name |
| --- | --- |
| AI\_REQUEST\_INITIATED | `ENGINE.REQUEST_INITIATED` |
| AI\_GATE\_PASSED / AI\_GATE\_FAILED | `ENGINE.GATE_PASSED` / `ENGINE.GATE_FAILED` |
| AI\_NODE\_COMPLETED | `ENGINE.AGENT_STEP_COMPLETED` (sub-chain by request, M09 D11) |
| AI\_OUTPUT\_HELD | `ENGINE.OUTPUT_HELD` |
| HITL\_NOTIFIED / HITL\_REVIEWED | `ENGINE.REVIEWER_NOTIFIED` / `ENGINE.REVIEW_OPENED` |
| HITL\_APPROVED / \_ANNOTATED / \_REJECTED / \_ESCALATED | `ENGINE.REVIEW_APPROVED` / `_APPROVED_ANNOTATED` / `_REJECTED` / `_ESCALATED` |
| HITL\_SLA\_BREACH | `ENGINE.SLA_BREACHED` |
| AI\_OUTPUT\_RELEASED | `ENGINE.OUTPUT_RELEASED` (critical: sealed before delivery) |
| AI\_STREAM\_ERROR / AI\_BUFFER\_TIMEOUT | `ENGINE.BUFFER_ERROR` / `ENGINE.BUFFER_TIMEOUT` |
| AI\_BUDGET\_THRESHOLD / \_EXCEEDED / \_EXTENDED | `ENGINE.BUDGET_THRESHOLD` / `_EXCEEDED` / `_EXTENDED` |
| SECURITY\_KILLSWITCH / \_REINSTATED | `ENGINE.KILLSWITCH_ACTIVATED` / `ENGINE.KILLSWITCH_REINSTATED` |
| SECURITY\_KEY\_ROTATION | `ENGINE.SDK_KEY_ROTATED` |
| AI\_FEDERATED\_EXECUTION | `ENGINE.FEDERATED_EXECUTION` |

**New events from October decisions:** `ENGINE.CITATIONS_VERIFIED`, `ENGINE.CITATION_SOURCE_ATTACHED`, `ENGINE.SOURCE_FLAGGED`, `ENGINE.LEAKAGE_HELD`, `ENGINE.REVIEW_NOT_COMPLETED`, `ENGINE.SLA_EXTENDED`, `ENGINE.CO_APPROVAL_RECORDED`, `ENGINE.OUTPUT_RECLASSIFIED`, `ENGINE.SYSTEM_REPORT_SAMPLED`, `ENGINE.AGENT_SUSPENDED`, `ENGINE.AGENT_REINSTATED`, `ENGINE.MODEL_REGISTERED`, `ENGINE.MODEL_RETIRED`, `ENGINE.JURISDICTION_ACTIVATED`, and the HR tier events in the gate register.

**Critical-class events** (sealed and anchored before the action proceeds): output release, every review decision, kill-switch activation and reinstatement, agent suspension and reinstatement, model registry changes, jurisdiction activation.

Event payloads carry hashes, pointers and metadata only (M09 D5). Reviewers and requesters appear as tokens with designations.

### Data residency

| Jurisdiction | Region | Inference | What may leave the region |
| --- | --- | --- | --- |
| India (all states and UTs) | AWS ap-south-1 | India model registry only, including Hindi models | Nothing that carries content; aggregate counts only (M09 D8) |
| United States (all states) | AWS us-east-1 | US model registry only | Same as above |
| UK, EU, Singapore, GCC | Per pack, when activated | Per pack registry | Same as above |

A multi-jurisdiction research request runs one agent chain per jurisdiction, each in its own region, and logs `ENGINE.FEDERATED_EXECUTION` with confirmation that no data crossed regions.

### Availability and degraded behaviour

| Condition | Behaviour |
| --- | --- |
| SDK endpoint in the home region unavailable | Circuit breaker opens (503); no fallback to another region |
| Output takes longer than 30 seconds | Requester sees "Processing" (202) and polls status |
| Citation verification unavailable | Output held as "Awaiting verification"; never queued unverified |
| Ledger cannot seal | Approved output shows "Awaiting seal" and is released once sealed |
| Kill-switch active | All AI requests refused (503); in-flight requests cancelled |

The Queen holds no state between requests; any cross-request state is treated as a compliance defect, not a bug (Track A rule 3).

### Security

- Product isolation in two independent layers: the API gateway and the controller each reject keys outside the JRX\_ namespace (DR-06, R4).
- SDK keys rotated only by Jurexio platform operations under just-in-time elevation (M11 D4); every rotation logged.
- No jurisdiction literals in core code; all jurisdiction rules read from packs (Track A rule 1).

## Section 5 — Compliance requirements

### Regulations and how M03 satisfies them

| Regulation / standard | Requirement | How M03 satisfies it |
| --- | --- | --- |
| ABA Formal Opinion 512; Model Rules 1.1, 5.1, 5.3 | Competence with AI tools; supervision of AI as non-lawyer assistance | Mandatory qualified review on every legal and HR output (R1, R6); provenance and agent-step logging |
| ABA Model Rule 3.3 | Candour to the tribunal; no false statements of law | Citation verification with hard block on "Not found" (D3) |
| ABA Model Rule 1.6(c) | Prevent unauthorised disclosure of client information | In-region inference with zero-retention terms (D1); permission-mirrored retrieval (D5); leakage check (D4) |
| ABA Model Rule 1.10 | Imputed conflicts; effective ethical walls | Retrieval enforces walls; conflict gate (Gate 5) |
| ABA Model Rule 5.5 | No unauthorised practice of law | Reviewer jurisdiction match, state level where required (D2) |
| ABA Model Rules 1.4 and 1.5 | Client communication; reasonable fees | Firm policy (D7), plus enforced "AI prohibited" flag where the client forbids AI |
| Advocates Act 1961 and Bar Council of India rules | Practice by enrolled advocates; confidentiality; professional conduct | Indian reviewers enrolled with a State Bar Council; BCI constraint NO\_AUTONOMOUS\_FILING in the India pack |
| Court standing orders on AI use (various US and Indian courts) | Disclosure or certification of AI use in filings | Forum-coded pack rules (ANNOTATE, FORCE\_HITL) applied at Gate 7 |
| DPDP Act 2023 and Rules 2025 | Purpose limitation, security safeguards, limits on transfer | Data stays in India; prompts handled under the India pack's personal-data rules |
| CCPA/CPRA and US state privacy and AI-in-employment laws | Consumer data rights; rules on automated employment decisions | US state packs; HR outputs always human-decided (R6) |
| EU AI Act Articles 12 and 14 (architecture-ready) | Logging and human oversight; employment uses are high-risk | Agent-step logging; HR tier chain; EU pack inactive until validated (R7) |
| ISO/IEC 42001:2023 | AI management system: monitoring, change control, traceability | Per-agent monitoring and evaluation before model changes (D8); model registry gate (G-03-09) |
| SOC 2 (CC6, CC7, CC8) | Access control, monitoring, change management | Permission gates, kill-switch, registry change control, complete event trail |

### Mandatory HTIL steps (never automated)

- Approving, editing, rejecting or escalating any legal output (G-03-01, G-03-02).
- Approving any HR output at every tier (G-03-03 to G-03-05).
- Resolving every "Not found" citation; opening every "Unverifiable" one.
- Extending a review SLA (G-03-06).
- Reinstating AI after a kill-switch (G-03-07).
- Suspending an agent for quality, and reinstating any suspended agent (G-03-08).
- Changing a jurisdiction's model registry (G-03-09).
- Activating a jurisdiction (G-03-10).

### Decisions that must remain human

- Whether an AI output is correct, complete and fit to use.
- Whether a citation supports the proposition it is cited for.
- Whether an HR document should issue.
- Whether a model or agent is fit for service in a jurisdiction.
- Whether a jurisdiction is ready to go live.

The only automatic actions M03 may take are protective: blocking at a gate, holding an output, and suspending an agent on a safety trigger. None of them ever releases output.

### Approved claims language

- "148+ specialised agents and a Queen orchestration layer" (R5).
- "Every AI output that affects a matter or a client is approved by a qualified human."
- "Client data is processed by AI only in its home region."
- "Every citation verified or explicitly confirmed by a lawyer" only after release testing proves the citation gate (D3).
- Prohibited: "autonomous", "AI lawyer", "165 agents", "164 agents", and any wording that implies AI output is released without review.

## Section 6 — Module dependencies

### Upstream (M03 depends on)

| Dependency | What M03 needs |
| --- | --- |
| Jurexio Ledger Core (M09) | Outbox, registry, critical-event sealing, agent-step sub-chains; must run before M03 integration tests |
| CommandCentre (M11) | Permission catalogue and role templates including HR roles, credential scope (country, state, forum), Hindi-competence tags, model registry, Jurisdiction Packs, system billing-code registry |
| MatterCore (M01) | Matter context, conflict status, "AI prohibited" flag |
| BillGuard (M06) | Budget caps; UTBMS code validation; cost records |
| DocVault (M02) | Permission-checked document retrieval; storage of approved outputs |
| LexGraph (M04) | Authorities for citation verification; promoted knowledge |
| PulseComms (M12) | Notifications and escalations |
| NexusConnect (M10) | Outbound connection to regional SDK endpoints, with circuit breakers |
| Jurexio SDK registry | `jurexio-sdk-registry-v5.0.0.json` and the platform registry, uploaded and reconciled (R5) |

### Downstream (depend on M03)

Every module that uses AI: DocVault drafting, LexGraph research, RegRadar monitoring, DeadlineGuard calculations, BillGuard narratives, DataMigrate mapping and tagging, ClientBridge deliveries, CommandCentre usage views. No module calls the SDK directly.

### External integrations

| Integration | Purpose | Condition |
| --- | --- | --- |
| Model providers, India region | Inference for India packs, English and Hindi | Listed in the India registry; zero-retention, no-training, in-region terms (D1) |
| Model providers, US region | Inference for US packs | Listed in the US registry; same terms |
| Legal authority sources per pack | Citation verification | Coverage per jurisdiction confirmed in the M04 spec |

The April India pack routes Hindi to Sarvam AI. It may be used only after it passes the India registry gate (G-03-09) with confirmed in-region processing and zero-retention terms.

### Agent touchpoints

All 148+ agents are reached only through M03. The router reads each pack's agent constraints (e.g. BCI NO\_AUTONOMOUS\_FILING). Agent and variant identifiers must match the uploaded registry before engineering starts.

## Section 7 — v1.0 scope vs deferred scope

The v1.0 feature list is in Section 1.

### v1.0 build increments

| Increment | Contents | Unlocks |
| --- | --- | --- |
| Engine Core | Controller, seven gates (with residency and AI-terms checks), router, stateless Queen, buffer, kill-switch, model registry, legal review queue and interface, reviewer eligibility, citation verification, injection and leakage defences, permission-mirrored retrieval, SLA ladder, cost records, all events | Every module's legal AI use in India and the US |
| HR Workflow | HR output type, three-tier classifier with Tier 3 default, Tier 3 dual sign-off, HR review interface, tier maps per pack | HR and employment work |
| Monitoring | Per-agent metrics, quality and safety triggers, suspension console, evaluation sets per jurisdiction, monthly SYSTEM\_REPORT sampling | Safe scaling of agents and models |

Track A schedules M03 for Sprint 2, after Ledger Core and CommandCentre in Sprint 1.

### Release testing

- **Review cannot be bypassed:** no route, risk level or calling module can release a LEGAL\_WORKFLOW or HR\_WORKFLOW output without approval.
- **Classification cannot be spoofed:** a module supplying a false output type is overridden by its registered route.
- **Residency:** calls to an out-of-region or unregistered endpoint are blocked; no fallback occurs when a regional endpoint is down.
- **Citations:** seeded fabricated citations are all marked "Not found" and block approval.
- **Injection:** a seeded hidden-instruction document cannot change an agent's task or cause any action; leakage tests hold outputs carrying another matter's content.
- **Retrieval walls:** an agent acting for a walled-off user retrieves nothing behind the wall.
- **Reviewer eligibility:** ineligible reviewers never see the item; same-actor and Tier 3 distinct-actor guards hold.
- **No streaming:** no token reaches the client before release.
- **SLA ladder and deadline cap:** an unreviewed item ends "Review not completed" and is never released.
- **Kill-switch:** activation stops all calls; single-person reinstatement is refused.
- **Statelessness:** no data from one request appears in another.

### Deferred scope

| Feature | Release trigger | Reason |
| --- | --- | --- |
| UK, EU, Singapore, GCC jurisdictions | Pack validated by local counsel and activated by the Chairman (G-03-10) | Unvalidated rules must never drive legal output (R7) |
| Additional languages beyond English and Hindi | Language added to a pack with verified reviewers | Every output language needs competent reviewers (R2) |
| Client-facing AI disclosure and billing automation | Change in firm-policy decision (D7) | Left to firm policy by Chairman decision |
| Mobile review | Mobile security review and demand | Review needs a full screen for the dwell and scroll gate and citation checks |

### Rejected (not deferred)

| Option | Reason |
| --- | --- |
| Token streaming to the interface | Partial exposure is a legal liability (DR-05, FLAG-005) |
| LOW-risk direct release | Risk scores are AI-adjacent judgements; review is mandatory (R1) |
| Cross-region inference fallback | Breaks the zero cross-border promise (D1) |
| Agents that send, file or update records | Agents can never act (D4) |
| Automatic approval on SLA breach | Prohibited by the AI doctrine (D6) |

## Section 8 — Open questions and blockers

### Decisions requiring Chairman or CTO input

| # | Question | Owner | Recommendation |
| --- | --- | --- | --- |
| OQ-03-01 | Confirm new identifiers in the rename register (routes, environment variables, header, regional endpoint domains) | CTO | Rename before any Sprint 2 code is written |
| OQ-03-02 | Review SLA for LOW-risk legal outputs, now reviewed under R1 | Chairman | 48 hours, still capped before any linked deadline |
| OQ-03-03 | Removed (C-17, D-01): not a Jurexio question | Chairman | — |
| OQ-03-04 | Safe margin between a review SLA and a linked court deadline (D6) | Chairman with CTO | At least 24 hours before a court deadline |
| OQ-03-05 | Quality thresholds and evaluation sets per jurisdiction (D8) | CTO with Raja Sekhar T | Set from a baseline period before go-live |
| OQ-03-06 | Which output types require a state-level reviewer match, per pack (D2) | Raja Sekhar T with counsel | Start with filings, pleadings, state-law advice and deadline calculations |
| OQ-03-07 | Sample size for monthly SYSTEM\_REPORT review (R1) | Compliance Officer | A fixed percentage per month, documented once |
| OQ-03-08 | Which approved models are actually deployable in ap-south-1 and us-east-1, including for Hindi | CTO | Verify before committing any capability to clients (D1) |

### Compliance validations pending

- [ ] Model provider contracts per region: zero retention, no training, in-region processing (D1).
- [ ] Inventory of court standing orders on AI use, per forum code, encoded as pack rules (Raja Sekhar T).
- [ ] Counsel review of reviewer-match rules for India and US (D2).
- [ ] LexGraph authority coverage per jurisdiction, sufficient for citation verification (M04).

### Items blocking engineering start

- [ ] Chairman sign-off (consolidated end review).
- [ ] Jurexio Ledger Core (M09) live and accepting events.
- [ ] CommandCentre (M11) permission catalogue frozen, including HR roles, credential scope and Hindi-competence tags.
- [ ] Platform registry and `jurexio-sdk-registry-v5.0.0.json` uploaded and reconciled with "148+" (R5).
- [ ] Review-queue schema updated: output types LEGAL\_WORKFLOW, HR\_WORKFLOW, SYSTEM\_REPORT; HR tier columns.
- [ ] Rename register executed in code (OQ-03-01).
- [ ] At least one approved model per live jurisdiction in the registry.

### Housekeeping

- [ ] Remove the LOW-risk direct-release branch and caller-supplied output type from the Track A Gate 7 code (R1).
- [ ] Replace the single `citationVerified` flag with per-citation status (D3).
- [ ] Update UI v3: Jurexio Engine naming; jurisdiction selector showing active jurisdictions only (R7); per-citation status panel (D3); designation-only stamps in exports (R3).
- [ ] Retire Track B's Hindi interface strings (R2).
- [ ] Retire "165" and "164" agent counts from all materials (R5).
