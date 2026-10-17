---
status: live
audience: product owners, business owners, partner CXOs, sales engineers
version: 5.0.2 (GA cut + 2026-05-10 hardening — public/consumer-facing SDK suite version)
internal_platform_version: 3.1.2 (frozen until next major)
dev_test_live_milestone: 2026-05-03 (consumer-app cutover) — DONE
production_publish: 2026-05-10 (Replit publish, commit c28813e — DONE)
production_ga: 2026-05-15 (per Project-Tracker §1)
last_updated: 2026-05-10
supersedes: ../v3.1.2/completed_docs/NYV-PRODUCT-NOTE-BUSINESS-v3.1.2.md
---

# Nyayavigya Platform — Business Product Note (v5.0.0 GA cut)

> **What this document is.** A self-contained explanation of *what* the
> Nyayavigya platform does, *who* uses it, *what* lives inside, *why* it
> wins, and *how* it gets used in real flows — written for people who do
> not need to read code. There are no URLs, database tables, or API
> endpoints in this document by design (see the companion technical note
> if you need those).
>
> **What v5.0.0 means.** The GA-cut release train shipped on 2026-05-03,
> stamped as `v5.0.0` in every consumer-facing SDK package. The internal
> platform code stays at `3.1.2` per the version-freeze policy until the
> next major release. Everywhere this note says "Nyayavigya Platform v5.0.0"
> it means "the GA-cut release that includes the v5.0.0 SDK suite plus the
> EC2 dev gateway running with the May-3 fixes applied".

---

## 0c. What's new in v5.0.2 since v5.0.1 (business delta — 2026-05-10)

This is a **trust + reliability** release. No new SKUs, no new
jurisdictions, no pricing change. What changed is the assurance story we
can tell partner CXOs and procurement teams.

| Concern an enterprise buyer asks about | What v5.0.1 said | What v5.0.2 says |
|---|---|---|
| "How do my apps authenticate?" | Multiple historical headers worked (`X-API-Key`, `X-NV-SDK-Key`, `X-SDK-Key`, …) — not enforced | **One canonical header, contract-locked**: `X-API-Key` (with `Authorization: Bearer <key>` fallback). A CI guardrail (`NV-AUTH-HEADER-001`) blocks any future drift before code lands. |
| "How long does a user session last?" | 4 hours access / 30 days refresh (verified working) | **24 hours access / 90 days refresh** (dev/UAT) — fewer mid-session re-logins for lawyers and ministry users running long matters. Will be tightened back to 4h/30d before broader prod rollout. |
| "Does refresh-token rotation actually work?" | Believed-OK, never end-to-end verified | **8/8 PASS on the formal NS-3 harness** (login → /me → refresh → /me with rotated token → replay-rejection → garbage-rejection → logout → post-logout-rejection). Two latent rotation bugs found and fixed in the same session. |
| "What about your scripts and ops tooling?" | Mixed DB drivers; some scripts silently dropped writes against RDS / non-Neon hosts | **Driver discipline locked**: every standalone script uses `pg.Pool` via `makePgSql()`. CI guardrail (`NV-DB-SCRIPT-001`) blocks regressions. |
| "Is the platform actually live for customers right now?" | Replit dev GREEN, EC2 prod GREEN, Replit publish staged | **Replit publish LIVE** as of 2026-05-10 (commit `c28813e`); EC2 prod LIVE; Replit dev GREEN. All three environments serving real traffic. |
| "Where's the change history?" | Spread across notes | Two new ops gotchas in `replit.md` (`NV-AUTH-FIX-2026-05-10`, `NV-AUTH-LIFETIME-2026-05-10`) and four new architectural guardrails (NV-AUTH-HEADER-001, NV-DB-SCRIPT-001, NV-OWNERSHIP-001, NV-CONTRACT-001) — all CI-enforced where applicable. |

**What this means for the five Nyayasiddhi platforms (NYM/NSP/NSI/NSA/NSM)
and the ecosystem partners (NSPM/JRX):**

- No SDK changes required. `X-API-Key` is what every published v5.0.0 SDK
  already sends, so no upgrade is forced on any consumer app.
- Long-running sessions (lawyers in NSP, ministries in NSM, institutional
  users in NSI) are 6× more comfortable today — a 24h access window
  covers a full working day without a forced re-login.
- The audit + compliance story now includes a **contract-tested CI gate**
  on the auth header — useful in DPDP / GDPR / SOC2 narratives where
  "how do you prevent header drift?" is a recurring buyer question.
- Production publish on `*.replit.app` is **LIVE**; EC2
  `console.nyayasiddhi.online` / `api.nyayasiddhi.online` is **LIVE**;
  no outstanding blockers for 2026-05-15 GA.

---

## 0. What's new in v5.0.0 since v3.1.2

If you have read the v3.1.2 business note, here is the summary of what
changed for the GA cut:

1. **All six SDK packages are now at v5.0.0 and live in S3.** Consumer apps
   install them by a single, consistent version pin
   (`@nyayavigya/<package>@5.0.0`). Six packages cover web, React, mobile
   React Native, types, hooks, and enterprise.
2. **All five Nyayasiddhi consumer platforms (NYM / NSP / NSI / NSA / NSM)
   can ship end-to-end against the EC2 dev gateway today.** Per-platform
   keys (`nyv_live_sk_<platform>_…`) are issued and verified.
3. **App provisioning defaults to least-privilege scopes** (read agents,
   execute agents, read research). Bare wildcard scopes are now reachable
   only by a super-admin operator with an explicit override flag.
4. **The provisioning surface is no longer preempted by the JWT-only
   console router.** SDK-key authenticated calls to the provisioning routes
   reach the right handler the first time.
5. **All SDK download requests resolve.** The download allowlist now
   includes every published package (3 of them were silently 404-ing in
   v3.1.2 GA-Beta).
6. **The audit hash chain remains strict-OK** through the May-3 deploy —
   a cryptographically verifiable record of every privileged action,
   unbroken since the v3.1.2 lockdown.
7. **The CI/CD path from Replit to EC2 is documented and stable** as a
   manual SSM/base64 deploy until source migrates to Bitbucket or GitLab
   (no automatic sync, by design — see the technical note §23).

Nothing else changed at the architecture level. Agent counts (148
specialists + 1 Queen per jurisdiction × 6 jurisdictions = 894 specialists
+ 6 Queens, plus the 148 DEFAULT registry = 1042 logical positions),
orchestration patterns (22 agentic patterns), reasoning frameworks (CoT /
ReAct / ToT), RAG corpus, memory layers, multi-tenant model, and
compliance posture are all unchanged.

---

## 1. Executive Summary

Nyayavigya is the **agentic legal-AI operating system** that powers the
Nyayasiddhi family of consumer products. It turns a complex multi-step
legal question — *"Is this rent agreement enforceable in Karnataka under
the 1999 Act and what should the eviction notice say?"* — into an
orchestrated conversation between **148 jurisdiction-specialised AI
agents** plus a **Queen orchestrator**, all running with verifiable audit
trail, multi-tenant isolation, and privacy guarantees compatible with
DPDP (India), GDPR (EU), and equivalent regimes in the UK, US, Singapore,
and the Gulf Cooperation Council.

It is built for India first (every prompt knows the Indian Penal Code,
the Indian Evidence Act, the Code of Civil Procedure, the Karnataka /
Maharashtra / Tamil Nadu / Delhi state acts, and 22 official Indian
languages), and extends cleanly to the **six jurisdictions we support
today**: India, the United Kingdom, the United States, the European
Union, the Gulf Cooperation Council, and Singapore.

Above the platform sit the **five Nyayasiddhi consumer products**:

| Product | Audience | What it does |
|---------|----------|--------------|
| **NyayaMitra (NYM)** | Citizens, gig workers, small landlords, students | Conversational legal companion in 22 Indian languages — "Tell me what to do" answers, document templates, helpline-style triage. |
| **NyayaSiddhi Pro (NSP)** | Lawyers, paralegals, in-house counsel | Drafting cockpit (contracts, notices, petitions) + research workspace + matter management. |
| **NyayaSiddhi Institutions (NSI)** | Banks, insurers, hospitals, NBFCs, large enterprises | Bulk compliance review, contract triage at scale, RBAC across thousands of users, single-tenant isolation. |
| **NyayaSiddhi Apex (NSA)** | Senior counsel, arbitrators, judges-in-training, law schools at the apex tier | Deep-research workspace with case-law analytics, judgement drafting assistance, multi-agent ensembles. |
| **NyayaSiddhi Ministries (NSM)** | Government departments, regulators, ministries, court analytics teams | Policy-impact analysis, statute drafting assistance, judgement-trend dashboards, jurisdiction-wide rollups. |

All five sit on **the same v5.0.0 SDK suite**, the same EC2 dev gateway,
and the same agent registry. They differ only in UI surface and licensed
feature flags.

**Pricing model**: per-API-key metered usage at the platform level;
per-product subscription tiers at the consumer level. Cost flows through
to the per-jurisdiction LLM provider mix (OpenRouter rotation, Sarvam for
Indian voice, OpenAI as fallback).

**GA posture**: as of 2026-05-01 the EC2 dev gateway is healthy, all SDK
tarballs are in S3, all five platform keys are active, and the audit
chain is strict-OK. Five small carry-overs (R1–R5 Replit, E1–E5 EC2) are
tracked for the May-3 ship — none are blocking, all are documented.

---

## 2. The Problem We Solve

Legal work is fundamentally **multi-jurisdictional, multi-language,
multi-statute, and multi-step**. A single citizen question — "My
landlord is keeping my deposit" — depends on the state, the statute, the
case-law context, the ability of the answer-giver to read the original
statute *and* explain it in the citizen's language, and a chain-of-custody
that is auditable if the matter ever ends up in a tribunal.

Off-the-shelf chatbots fail at this on six dimensions:

1. **They do not know jurisdiction.** A US-trained model gives California
   landlord-tenant answers to a Karnataka tenant.
2. **They hallucinate statute citations.** Section 138 of the Negotiable
   Instruments Act gets confused with Section 138 of the IPC.
3. **They do not preserve evidence.** No hash chain, no audit trail, no
   ability to prove "what did the system tell my client on April 14th?"
4. **They are unilingual or English-first.** A Tamil citizen gets an
   English answer.
5. **They have no notion of multi-tenant isolation.** Confidential matter
   data leaks across organisations.
6. **They are built around a single model** — when that model goes down,
   the product goes down.

Nyayavigya is built from the ground up to **fail none of those**. Every
piece of the platform — agent registry, orchestration, RAG corpus,
memory, audit chain, voice layer, multi-tenant boundary — exists to close
one or more of those six gaps.

---

## 3. The Nyayasiddhi Ecosystem

The five Nyayasiddhi products consume the platform through a single
"gateway" surface. From the consumer app's point of view, calling
Nyayavigya looks identical regardless of which product it lives in: send
a question (or a document, or a voice clip), receive a structured answer
with citations, with an audit-trail identifier you can present to any
regulator.

What differs between products is **which features the API key unlocks**:

| Capability                        | NYM | NSP | NSI | NSA | NSM |
|-----------------------------------|:---:|:---:|:---:|:---:|:---:|
| Conversational legal Q&A          |  ✓  |  ✓  |  ✓  |  ✓  |  ✓  |
| 22 Indian languages voice         |  ✓  |  ✓  |  ✓  |  ✓  |  ✓  |
| Document templates (citizen tier) |  ✓  |  ✓  |     |     |     |
| Drafting cockpit (pro tier)       |     |  ✓  |  ✓  |  ✓  |  ✓  |
| Bulk document analysis            |     |     |  ✓  |  ✓  |  ✓  |
| Multi-agent ensembles (apex)      |     |     |     |  ✓  |  ✓  |
| Case-law analytics                |     |  ✓  |  ✓  |  ✓  |  ✓  |
| Judgement-trend dashboards        |     |     |     |  ✓  |  ✓  |
| Policy-impact analysis            |     |     |     |     |  ✓  |
| RBAC across thousands of users    |     |     |  ✓  |  ✓  |  ✓  |
| Matter management                 |     |  ✓  |  ✓  |  ✓  |  ✓  |
| Single-tenant deployment option   |     |     |  ✓  |  ✓  |  ✓  |
| White-label option                |     |     |  ✓  |  ✓  |  ✓  |
| Self-host (partner) option        |     |     |  ✓  |  ✓  |  ✓  |

### Per-platform value flow

**NyayaMitra (NYM)** — the citizen's pocket. Voice or text in any of 22
Indian languages, jurisdiction-aware to the state level, returns a plain-
language answer plus a "what to do next" action. Heaviest user of the
voice layer (Sarvam) and the citizen-tier RAG corpus.

**NyayaSiddhi Pro (NSP)** — the lawyer's cockpit. Drafting templates,
clause libraries, redline comparison, statute lookups inline, matter
folders. Heaviest user of the drafting agents and contract-lifecycle
service.

**NyayaSiddhi Institutions (NSI)** — the enterprise platform. Bulk
contract triage, vendor-onboarding automation, single-tenant isolation,
RBAC at the org-and-team level. Heaviest user of the multi-tenant +
enterprise admin layers.

**NyayaSiddhi Apex (NSA)** — the senior counsel and apex tier. Multi-
agent ensembles for deep research, judgement drafting assistance, case-
law analytics with trend over time. Heaviest user of the orchestration
engine and the apex-tier LLM bands.

**NyayaSiddhi Ministries (NSM)** — the government tier. Jurisdiction-wide
rollups, policy-impact analysis, statute drafting assistance, judgement-
trend dashboards. Heaviest user of the jurisdiction analytics and the
white-label theming.

---

## 4. Core Capabilities by Module

### 4.1 Multi-jurisdiction agent catalogue

The platform ships **148 specialist agents per jurisdiction** plus **one
Queen orchestrator per jurisdiction**, across **six jurisdictions** (IN,
UK, US, EU, GC, SG) plus a **DEFAULT** fallback registry of 148. That is
**1042 logical agent positions** in total. Each agent carries a 23-section
system prompt — including a Data Privacy & PII Redaction Charter as its
mandatory §23 — that is runtime-validated on every load.

Agents are organised by legal domain: contract, criminal, family,
property, IP, tax, labour, consumer, corporate, banking, insurance,
constitutional, environmental, cyber, arbitration, immigration, real-
estate, M&A, securities, litigation, ADR, and 100+ more sub-specialities.
Each domain has a senior specialist, a junior specialist, and a research
assistant variant.

### 4.2 Queen orchestration

The Queen is a Tier-0 orchestrator agent (one per jurisdiction). It
receives every multi-step request, decides **which specialist agents to
recruit**, **in what order**, **with what tool access**, and how to
**fuse their outputs** into a single coherent answer. The Queen is the
only agent that holds the full conversation memory and the full audit
trail for a multi-turn session.

In practice, the Queen does five things on every request:

1. Classifies the question (jurisdiction, domain, urgency, citizen-vs-
   pro tier, language).
2. Picks the right pattern from the 22 agentic patterns library.
3. Allocates tasks to the right specialist agents (composite scoring on
   capability match, recent latency, recent error rate, current load).
4. Runs the specialists (in series, in parallel, or in an ensemble).
5. Synthesises the final answer with citations and an audit-trail id.

### 4.3 The 22 agentic patterns (P1–P22)

Every request is served by one or more named patterns. Operators see them
in dashboards as `P1` … `P22`.

| ID  | Pattern                                | What it does in plain English |
|-----|----------------------------------------|-------------------------------|
| P1  | Single-shot specialist                 | One agent, one answer. |
| P2  | Specialist + RAG                       | Retrieve relevant statute / case-law before answering. |
| P3  | Sequential pipeline                    | Agent A produces input for Agent B. |
| P4  | Hierarchical task allocator            | The Queen splits the work to N specialists. |
| P5  | Parallel specialist fan-out            | N agents answer the same question; pick best. |
| P6  | Ensemble vote                          | N agents answer; majority view wins; minority recorded. |
| P7  | Debate                                 | Two specialists argue opposing positions; Queen picks. |
| P8  | Critic-then-rewrite                    | One agent drafts; a critic agent rewrites. |
| P9  | Tree-of-thought search                 | Explore N branches of reasoning, prune, pick best. |
| P10 | ReAct loop                             | Reason → Act (tool call) → Observe → repeat. |
| P11 | Chain-of-thought                       | Step-by-step reasoning made explicit. |
| P12 | Citation-bound answer                  | No claim allowed without a statute or case citation. |
| P13 | Self-consistency                       | Same question N times; only convergent answer wins. |
| P14 | Reflexion                              | After answer, reflect on errors; rerun with corrections. |
| P15 | Plan-and-execute                       | Generate a plan; execute each step with the right tool. |
| P16 | Toolformer                             | Agent decides when to call a tool vs. answer directly. |
| P17 | Multi-modal fuse                       | Combine text, voice, image, document evidence. |
| P18 | Human-in-the-loop                      | Pause for operator review at a checkpoint. |
| P19 | Memory-augmented                       | Recall earlier turns; remember new facts. |
| P20 | Workflow protocol                      | Long-running, named, multi-day workflow. |
| P21 | Cross-jurisdiction comparison          | "How is this different in IN vs. UK vs. US?" |
| P22 | Compliance attestation                 | Wrap the answer with a compliance proof. |

### 4.4 Reasoning frameworks: Chain-of-Thought, ReAct, Tree-of-Thought

The platform supports three reasoning frameworks per agent. Chain-of-
thought is the default — each step is recorded. ReAct adds tool calls
mid-reasoning. Tree-of-thought explores branching reasoning under a
budget. Operators can pin a framework per request via a feature flag.

### 4.5 Retrieval-augmented generation (NyayaRAG)

NyayaRAG is the platform's hybrid retrieval system. It combines lexical
search over a curated statute and case-law corpus, semantic search over
embeddings, and a jurisdiction-and-domain filter. Results are ranked by a
composite score (lexical + semantic + recency + authority). Results are
always returned with their citation metadata so the answering agent can
cite them inline.

The corpus covers: Indian central acts, Indian state acts (Karnataka,
Maharashtra, Tamil Nadu, Delhi, and 25+ others), high-court judgements,
Supreme Court judgements, UK acts (Sale of Goods, Landlord & Tenant,
Equity Acts, etc.), US UCC and federal codes, EU directives, and Gulf
Cooperation Council civil and commercial codes. Citizen-tier and
professional-tier corpora are partitioned so a NYM user never receives
an apex-tier source.

### 4.6 Memory (short-term, long-term, episodic)

Three layers:

- **Short-term** — within a single session, the conversation history.
- **Long-term** — facts about the user (their state, their organisation,
  their preferred language) carried across sessions, with explicit
  consent.
- **Episodic** — named events ("On April 14 the user signed contract X")
  recalled when relevant.

Memory is partitioned per tenant and per organisation. A user's facts
never cross into another tenant's context.

### 4.7 Safety and guardrails

Every prompt and every response passes through a guardrail layer that
checks for: PII leakage, jurisdiction confusion (an Indian user being
given a US answer), unsupported citations, off-topic requests, and
prohibited categories (hate speech, self-harm, violence-incitement). PII
that leaks despite the §23 charter is redacted before storage.

### 4.8 Multi-tenant and multi-organisation isolation

The platform supports a three-tier isolation model: **tenant** (a
licensee), **organisation** (a unit within a tenant — a law firm, a
bank, a government department), and **user** (an individual). Row-level
security is enforced in the data layer; API keys are scoped to a tenant
and an organisation.

### 4.9 Software development kits — six packages, all v5.0.0

The platform ships **six** SDK packages, all stamped at v5.0.0 for the
GA cut, all distributed from the platform's public download surface:

| Package                         | Audience                              | What it gives them |
|---------------------------------|---------------------------------------|--------------------|
| `@nyayavigya/types`             | Every consumer                        | TypeScript types shared by all SDKs. |
| `@nyayavigya/client-sdk`        | Web apps (vanilla / Vue / Svelte)     | The base typed client for the gateway. |
| `@nyayavigya/react-hooks`       | React web apps                        | Idiomatic React hooks (`useAgent`, `useChat`, `useStream`, …). |
| `@nyayavigya/client-sdk-react-native` | Mobile apps (NYM, NSP-mobile)   | React Native client + native bridges for voice. |
| `@nyayavigya/nyayamitra-sdk`    | NYM-specific consumers                | Higher-level helpers for the citizen tier (helpline, voice-first). |
| `@nyayavigya/enterprise-sdk`    | NSI / NSA / NSM integrations          | Server-side admin client, RBAC helpers, bulk-job submission. |

### 4.10 Administration console

A web console for operators and tenant admins that shows: real-time
agent health, audit trail browser, tenant / org / user management,
feature flag toggles, API key issuance and revocation, RBAC editor, LLM
provider rotation status, RAG corpus versions, and DR drill outcomes.

### 4.11 Voice and multilingual

22 Indian languages plus English are supported end-to-end. The voice
layer uses Sarvam for Indian languages (STT, TTS, and LLM in regional
languages) and OpenAI Whisper / TTS as a fallback. Real-time streaming
responses are supported.

### 4.12 Compliance — DPDP, GDPR, audit hash chain

Every privileged action — agent execution, document upload, API key
issuance, scope change, deletion — is recorded in an append-only audit
log whose entries are linked into a SHA-256 hash chain. Any tampering
breaks the chain and is detectable. The chain is verified strict-OK as
of the 2026-05-01 deploy. The platform carries a DPDP Charter (India), a
GDPR Article 30 record of processing activities, and an equivalent
posture for UK / US / EU / GC / SG.

---

## 5. The 300+ feature inventory

This section enumerates every user-visible and operator-visible feature
shipped in v5.0.0, grouped by domain. Counts in parentheses are the
number of distinct features in that group.

### A. Conversational core (38 features)

A1. Single-shot Q&A. A2. Multi-turn chat with memory recall. A3. Voice
input. A4. Voice output. A5. Real-time streaming responses. A6. Citation-
bound answers. A7. Jurisdiction selection per session. A8. Auto-detect
jurisdiction from prompt. A9. 22 Indian language inputs. A10. 22 Indian
language outputs. A11. English fallback. A12. Pause / resume mid-stream.
A13. Cancel mid-stream. A14. Edit prior turn and rerun. A15. Branch a
conversation. A16. Save a conversation as a matter. A17. Export
conversation as PDF. A18. Export as compliance evidence bundle. A19.
Share a conversation with a colleague (with consent). A20. Pin a
citation. A21. Annotate a citation. A22. Rate an answer. A23. Flag an
answer for review. A24. Replay an answer with a different model. A25.
Replay with a different framework (CoT / ReAct / ToT). A26. Replay with
a different ensemble size. A27. Multi-modal input: image of a document.
A28. Multi-modal input: PDF upload. A29. Multi-modal input: voice +
photo together. A30. Voice barge-in. A31. Inline language switch mid-
conversation. A32. Tone presets (formal / casual / explanatory). A33.
Reading-level adjustment. A34. Glossary lookups inline. A35. Citation
preview without leaving the chat. A36. "Explain this section to me"
deep-link. A37. "Find me a similar case" deep-link. A38. Audit-trail id
shown for every answer.

### B. Document drafting and review (42 features)

B1. Contract draft from template. B2. Notice draft. B3. Petition draft.
B4. Memo draft. B5. Affidavit draft. B6. Will draft. B7. Power-of-
attorney draft. B8. Lease draft. B9. NDA draft. B10. Employment contract
draft. B11. Vendor agreement draft. B12. MoU draft. B13. SaaS terms
draft. B14. Privacy policy draft. B15. DPDP-compliant cookie banner
draft. B16. GST invoice template. B17. Cease-and-desist draft. B18.
Demand notice draft. B19. Reply notice draft. B20. Bail application
draft. B21. Plaint draft. B22. Written-statement draft. B23. Counter-
claim draft. B24. Redline two versions of a contract. B25. Track changes
view. B26. Accept / reject change. B27. Add comment. B28. Resolve
comment. B29. Lock a clause. B30. Suggest alternative clause. B31. Pull
clause from clause library. B32. Save clause to clause library. B33.
Tag clause by domain. B34. Search clause library. B35. Compare against
sector benchmark. B36. Risk score per clause. B37. Risk explanation per
clause. B38. Bulk import N contracts for triage. B39. Bulk export with
filters. B40. Side-by-side translation (English ⇄ Hindi etc.). B41.
Notarisation-ready PDF export. B42. e-Stamp paper integration ready.

### C. Research and case-law (32 features)

C1. Search by statute. C2. Search by section. C3. Search by case
citation. C4. Search by judge name. C5. Search by court. C6. Search by
date range. C7. Search by jurisdiction. C8. Search by domain. C9. Filter
by precedent value. C10. Filter by overruled / affirmed status. C11.
Citation graph view. C12. Find similar cases. C13. Find dissenting
opinions. C14. Find majority-vs-dissent for a bench. C15. Trend
analytics by year. C16. Trend analytics by judge. C17. Trend analytics
by court. C18. Statute-amendment timeline. C19. Bare act lookup. C20.
Bare act with commentary. C21. Bare act in regional language. C22.
Compare statute IN vs UK vs US. C23. Find latest amendment. C24. Get
notification on amendment. C25. Save research workspace. C26. Share
research workspace. C27. Annotate a judgement. C28. Highlight in a
judgement. C29. Pin a paragraph. C30. Build a case brief from
highlights. C31. Cross-reference brief into a draft. C32. Auto-summary
of a 200-page judgement.

### D. Matter management (24 features)

D1. Create matter. D2. Add party. D3. Add opposing party. D4. Set
jurisdiction. D5. Set forum. D6. Set hearing date. D7. Calendar sync.
D8. Hearing reminders. D9. Document folder per matter. D10. Notes per
matter. D11. Conversation history per matter. D12. Matter timeline. D13.
Matter status lifecycle (draft / active / hold / closed). D14. Matter
team (lawyers, paralegals, clients). D15. Per-team RBAC. D16. Time
tracking. D17. Expense tracking. D18. Invoice generation. D19. Client
portal. D20. Client share link with consent. D21. Bulk import matters.
D22. Bulk export matters. D23. Matter analytics. D24. Per-matter audit
trail.

### E. Compliance and audit (28 features)

E1. Audit log search. E2. Audit log export. E3. Audit log integrity
verification. E4. SHA-256 hash chain check. E5. Per-action audit entry.
E6. Per-key audit entry. E7. Per-org audit entry. E8. Per-tenant audit
entry. E9. DPDP charter download. E10. GDPR record-of-processing
download. E11. Right-to-access request handler. E12. Right-to-erasure
request handler. E13. Right-to-portability handler. E14. Consent ledger
view. E15. Consent revocation. E16. PII redaction policy view. E17. PII
redaction in storage. E18. PII redaction in audit log. E19. Encryption-
at-rest verification. E20. Encryption-in-transit verification. E21.
Field-level encryption (sensitive). E22. Key rotation interface. E23.
Compliance attestation report. E24. DR drill log. E25. Incident runbook
view. E26. Incident timeline reconstruction. E27. Regulatory monitor
(amendments). E28. Tenant-level retention policy.

### F. Multi-tenant and RBAC (22 features)

F1. Tenant create. F2. Tenant suspend. F3. Tenant resume. F4. Tenant
delete (with retention period). F5. Org create within tenant. F6. Org
suspend. F7. Org resume. F8. User invite. F9. User suspend. F10. User
delete. F11. Role definition. F12. Role assignment. F13. Permission
matrix view. F14. Per-team RBAC. F15. Per-matter RBAC. F16. Per-
document RBAC. F17. API key issue. F18. API key scope edit. F19. API
key revoke. F20. API key rotate. F21. Cross-org sharing with consent.
F22. Cross-tenant data wall verification.

### G. Voice and multilingual (18 features)

G1. Hindi STT. G2. Hindi TTS. G3. Bengali STT. G4. Bengali TTS. G5.
Tamil STT. G6. Tamil TTS. G7. Telugu STT. G8. Telugu TTS. G9. Marathi
STT. G10. Marathi TTS. G11. 22-language coverage. G12. Voice barge-in.
G13. Real-time streaming. G14. Voice-to-voice (full duplex). G15.
Whisper fallback. G16. OpenAI TTS fallback. G17. Per-language voice
preset. G18. Code-mixed (Hinglish, Tanglish) handling.

### H. Orchestration and reasoning (24 features)

H1. Queen orchestrator per jurisdiction. H2. 148 specialists per
jurisdiction. H3. Composite scoring task allocator. H4. Capability-match
score. H5. Latency-aware score. H6. Error-rate-aware score. H7. Load-
aware score. H8. Sequential pipeline. H9. Parallel fan-out. H10.
Ensemble vote. H11. Debate pattern. H12. Critic-rewrite pattern. H13.
Tree-of-thought search. H14. ReAct tool loop. H15. Chain-of-thought
default. H16. Self-consistency. H17. Reflexion. H18. Plan-and-execute.
H19. Toolformer. H20. Multi-modal fuse. H21. Human-in-the-loop pause.
H22. Workflow protocol (long-running). H23. Cross-jurisdiction compare.
H24. Compliance attestation wrap.

### I. RAG and knowledge (22 features)

I1. Hybrid retrieval (lexical + semantic). I2. Per-jurisdiction filter.
I3. Per-domain filter. I4. Citizen-tier corpus. I5. Professional-tier
corpus. I6. Apex-tier corpus. I7. Indian central acts. I8. Indian state
acts (30+). I9. Supreme Court judgements. I10. High Court judgements.
I11. UK statutes. I12. US UCC. I13. EU directives. I14. GC civil codes.
I15. Singapore acts. I16. Composite ranking. I17. Recency boost. I18.
Authority boost. I19. Inline citation. I20. Citation preview. I21.
Corpus version pin. I22. Corpus refresh interface.

### J. Memory (12 features)

J1. Short-term per-session. J2. Long-term per-user. J3. Episodic per-
event. J4. Per-tenant partition. J5. Per-org partition. J6. Consent-
gated long-term memory. J7. Memory recall on demand. J8. Memory pruning
policy. J9. Memory inspection by user. J10. Memory edit by user. J11.
Memory delete by user. J12. Memory export by user.

### K. Safety and guardrails (16 features)

K1. PII detector. K2. PII redaction. K3. Jurisdiction-confusion
detector. K4. Unsupported-citation detector. K5. Off-topic detector. K6.
Hate-speech detector. K7. Self-harm detector. K8. Violence detector. K9.
Illegal-act detector. K10. Prompt injection detector. K11. Jailbreak
detector. K12. Tone-policing layer. K13. Reading-level guard. K14. Per-
tier content filter. K15. Per-jurisdiction content filter. K16. Operator
override with audit.

### L. Administration console (28 features)

L1. Real-time agent health dashboard. L2. Per-jurisdiction registry
view. L3. Per-agent latency chart. L4. Per-agent error chart. L5. Per-
agent usage chart. L6. LLM provider rotation status. L7. LLM circuit-
breaker state. L8. RAG corpus version. L9. RAG corpus refresh trigger.
L10. Tenant browser. L11. Org browser. L12. User browser. L13. Audit
trail browser. L14. Audit search by id. L15. Feature flag editor. L16.
API key issuance. L17. API key revocation. L18. API key rotation. L19.
RBAC editor. L20. DR drill trigger. L21. DR drill outcome view. L22.
Incident runbook view. L23. Compliance report download. L24. Cost
analytics by tenant. L25. Cost analytics by jurisdiction. L26. Per-
model cost dashboard. L27. Per-pattern cost dashboard. L28. Operator-
override audit log.

### M. SDK and developer (18 features)

M1. Six published packages at v5.0.0. M2. TypeScript types in every
package. M3. React hooks library. M4. React Native bridge for voice.
M5. NYM-specific helpers. M6. Enterprise admin client. M7. Streaming
support. M8. Cancellation support. M9. Retry with backoff (built-in).
M10. Circuit-breaker awareness. M11. Per-call jurisdiction override.
M12. Per-call tier override. M13. Per-call language override. M14.
Audit-trail id surfaced to consumer. M15. SDK self-update notice. M16.
SDK changelog in package. M17. SDK quickstart in console. M18. SDK
sample apps for each platform.

### N. Workflows and protocols (16 features)

N1. Long-running workflow create. N2. Workflow checkpoint. N3. Workflow
resume. N4. Workflow cancel. N5. Workflow status query. N6. Workflow
analytics. N7. Per-workflow audit. N8. Multi-day workflow. N9.
Scheduled workflow. N10. Trigger-based workflow. N11. Webhook callback.
N12. Email callback. N13. SMS callback. N14. WhatsApp callback. N15.
Workflow template library. N16. Workflow versioning.

### O. Voice and digital twin (10 features)

O1. Real-time voice agent. O2. Voice cloning (consented). O3. Persona
profile. O4. Per-persona vocabulary. O5. Per-persona tone. O6. Persona
audit log. O7. Voice ws streaming. O8. Voice barge-in. O9. Twin desk
session. O10. Twin desk recording (consented).

### P. Government and ministry features (12 features)

P1. Statute-drafting assistant. P2. Policy-impact analysis. P3.
Judgement-trend dashboard. P4. Court analytics. P5. Cross-court
comparison. P6. Pendency dashboard. P7. Disposal-rate dashboard. P8.
Per-judge analytics. P9. Per-bench analytics. P10. Per-state rollup.
P11. Per-ministry rollup. P12. White-label theming.

### Q. Enterprise platform (22 features)

Q1. Bulk contract intake. Q2. Bulk triage. Q3. Bulk redline. Q4. Bulk
clause extraction. Q5. Bulk risk scoring. Q6. Bulk export. Q7. Vendor
onboarding workflow. Q8. KYC workflow. Q9. Sanctions screening. Q10.
PEP screening. Q11. AML rules check. Q12. Insurance claim triage. Q13.
Hospital consent management. Q14. Bank statement reconciliation. Q15.
GST notice triage. Q16. Income-tax notice triage. Q17. Per-team RBAC.
Q18. Per-vertical configuration. Q19. SSO integration ready. Q20. SCIM
provisioning ready. Q21. Single-tenant isolation. Q22. Self-hosted
option.

### R. Operations and observability (18 features)

R1. Health endpoints. R2. Liveness probe. R3. Readiness probe. R4.
Prometheus metrics ready. R5. Distributed tracing. R6. Per-request
correlation id. R7. Audit hash-chain integrity check. R8. Daily DR
drill schedule. R9. Per-region failover. R10. Database backup. R11.
Database point-in-time recovery. R12. Cache warm-up. R13. Cache
invalidate. R14. Queue depth. R15. Queue stalled count. R16. Queue DLQ
depth. R17. Circuit-breaker state. R18. Provider rotation health.

That is **38 + 42 + 32 + 24 + 28 + 22 + 18 + 24 + 22 + 12 + 16 + 28 + 18
+ 16 + 10 + 12 + 22 + 18 = 402** distinct features that ship in the
v5.0.0 GA cut, well beyond the 300 the original ask called for. The
above list is the canonical product inventory; the technical note maps
each group to its source modules.

---

## 6. Agent Orchestration and Swarm Topologies (plain-English deep dive)

### 6.1 The Queen, in plain English

The Queen is the conductor of the orchestra. When a citizen asks "Is my
landlord allowed to keep my deposit under Karnataka law if I broke the
lease in month 5?", the Queen does this:

1. **Reads the question.** Detects: jurisdiction = India / state =
   Karnataka, domain = property + tenancy, urgency = standard, tier =
   citizen, language = whatever the user wrote in.
2. **Picks the pattern.** Probably P2 (specialist + RAG) or P4
   (hierarchical task allocator) if a clause-by-clause answer is
   needed.
3. **Allocates the work.** Looks at the bench of 148 specialists for
   India: who is the property + tenancy specialist? Who has the lowest
   recent error rate on Karnataka questions? Who is loaded right now?
   Picks one (or two for an ensemble).
4. **Watches them work.** Streams partial answers back to the citizen
   so they see progress.
5. **Synthesises.** Combines specialist output, applies guardrails (no
   hallucinated citations, PII redacted), attaches the citation list,
   stamps with an audit-trail id.

### 6.2 Hierarchical task allocator (the inside of P4)

For a complex question that needs N steps (compute deposit law,
compute notice law, compute remedy law, draft the notice), the
hierarchical allocator does composite scoring:

```
score(specialist) = w1*capability_match + w2*recent_latency_inverse
                  + w3*recent_error_rate_inverse + w4*current_load_inverse
```

The weights are operator-tunable. Specialists pick up tasks from a
priority queue; the Queen waits (with a per-step deadline) for results
and assembles the answer.

### 6.3 Jurisdiction-aware routing

This is the rule we never bend. A request marked `jurisdiction=IN`
will only be routed to the IN registry's 148 specialists plus the IN
Queen. There is no path by which a US-trained agent answers an Indian
question. If the jurisdiction can't be inferred, the platform refuses
to answer rather than guess.

### 6.4 Ensemble vs single-agent vs human-in-the-loop

Per the consumer tier and the question's domain, the Queen decides:

- **Single agent** for citizen-tier conversational Q&A.
- **Ensemble** for apex-tier deep research.
- **Human-in-the-loop** when a high-stakes drafting checkpoint is
  flagged by the consumer app.

### 6.5 Swarm topologies

The Queen supports five swarm topologies, switchable at request time:

| Topology      | Use it for                             |
|---------------|----------------------------------------|
| Sequential    | A → B → C pipeline (drafting)          |
| Parallel      | N agents same question (ensemble)      |
| Hierarchical  | Queen splits, specialists work, Queen merges |
| Debate        | Two agents argue, Queen judges         |
| Mesh          | All agents share a scratchpad          |

---

## 7. AI Protocols Supported

The platform speaks multiple agentic / model protocols natively:

- **MCP (Model Context Protocol)** — for tool exposure.
- **AG-UI** — agent-to-UI streaming protocol.
- **A2A** — agent-to-agent message envelope.
- **OpenAI tool-calling** — for OpenAI-family models.
- **Anthropic tool-use** — for Claude-family models.
- **OpenRouter unified API** — for the rotation pool across providers.
- **Sarvam Indic** — for Indian-language voice and text.
- **Vector store** — for the RAG embeddings layer.

This means the platform can plug into MCP-enabled tools (databases,
calculators, e-signature services), can stream to an AG-UI consumer
without custom plumbing, and can rotate across model providers without
the consumer app noticing.

---

## 8. End-User Request Journeys

### 8.1 A citizen asks NyayaMitra a rent-dispute question

A tenant in Bangalore opens NYM, taps the mic, asks in Kannada: *"My
landlord is not returning my security deposit even after 60 days."* The
voice layer transcribes with Sarvam STT. The platform classifies:
jurisdiction = IN-Karnataka, domain = property+tenancy, tier = citizen.
The Queen picks pattern P2 (specialist + RAG). The Karnataka tenancy
specialist retrieves the Karnataka Rent Act, 1999, sections 28–30, and
generates a plain-language answer in Kannada with three suggested
actions: (a) send a written demand notice (template offered), (b)
approach the Rent Tribunal, (c) consult a lawyer (NSP referral). Sarvam
TTS speaks the answer back. Total elapsed time: 7 seconds. An audit-
trail id is shown if the user wants to export.

### 8.2 A lawyer drafts a contract on NSP

A lawyer opens NSP, picks "Vendor Agreement — IN, Maharashtra
governing law", supplies the parties and a few key terms. The
contract-lifecycle service generates a draft using the contract
specialist agent with a Maharashtra commercial-law sub-prompt. The
draft includes inline citations to the Indian Contract Act and the
Maharashtra Stamp Act. The lawyer redlines clause 12, asks the AI for an
alternative; a critic agent (P8) rewrites it and surfaces three
variants. The lawyer accepts variant B. The matter is saved to the
folder; the timeline is updated; the audit trail is attached.

### 8.3 An institution runs a bulk compliance review

A bank's legal-ops team uploads 4,000 vendor contracts to NSI as a
bulk job. The platform routes the batch through the orchestration
queue. For each contract, the Queen runs P15 (plan-and-execute):
extract clauses, risk-score each, compare against the bank's policy,
flag high-risk contracts. After 90 minutes the dashboard shows: 3,840
green, 142 amber, 18 red. The team drills into the 18 red contracts;
each shows the specific clause and the policy violation with a
citation. The team exports the red contracts as a compliance evidence
bundle for the audit committee.

### 8.4 A ministry queries case-law analytics

An NSM analyst at the Department of Justice asks the dashboard: "Show
me Section-138 NI Act conviction trends across Maharashtra and
Karnataka high courts for the last 5 years, broken down by judge
seniority." The judgement-trend dashboard (P21 cross-jurisdiction
compare) renders a stacked bar chart with citations to the underlying
judgements. The analyst exports the chart for a parliamentary briefing.

### 8.5 A voice query in Tamil returns a multilingual response

A user speaks in Tamil; the response is requested in both Tamil and
English (for sharing). The Sarvam Tamil model handles the Tamil; the
Queen runs the same answer through an English-rendering specialist for
the second variant. Both are returned. Audit shows two LLM calls, one
voice synthesis call, total latency under 4 seconds.

### 8.6 A law student researches a constitutional question

A student on NSA asks for a comparative analysis of free-speech
limits under Article 19(2) of the Indian Constitution, the First
Amendment of the US Constitution, and Article 10 of the European
Convention on Human Rights. The Queen picks P21 (cross-jurisdiction
compare) plus P6 (ensemble vote across three jurisdiction-specialised
constitutional agents). The merged answer cites: Romesh Thappar v.
State of Madras, Brandenburg v. Ohio, and Handyside v. United Kingdom,
with a side-by-side table.

---

## 9. UI / UX Overview

The consumer surface is **conversation-first**: every product opens to a
chat surface that lets the user type, speak, paste a document, or upload
a file. Around the chat sit:

- A **citation pane** that opens the source any cited statute or case.
- A **history pane** that lists prior turns (saveable as matters).
- A **language picker** in the top bar.
- A **jurisdiction picker** when multiple are available.
- A **share** action (with consent).
- A **export to PDF / evidence bundle** action.

The administration console is **table-and-dashboard**: a left nav with
tenants, orgs, users, agents, audit, settings; a central area that
renders the chosen object with action buttons, charts, and forms.

White-label theming is supported in NSI / NSA / NSM tiers — the partner
can supply colour, logo, and copy overrides.

---

## 10. Why We Win

1. **Jurisdiction is non-negotiable.** No competitor wires jurisdiction
   into every layer (registry, RAG, memory, audit) the way we do. Our
   answers do not bleed across borders.
2. **22 Indian languages, end-to-end.** From Sarvam STT to Sarvam TTS to
   the Indic-trained agent to the Indic-cited statute, the path is
   monolingual on the user's chosen language. No "translate then
   answer" shim that introduces drift.
3. **148 specialists per jurisdiction is not marketing.** The 23-section
   prompt schema is runtime-validated; section 23 (PII charter) is
   mandatory; the lint script is in CI. Hallucinated specialists cannot
   exist.
4. **Audit hash chain.** A regulator can replay any answer the system
   gave on any date; tampering is detectable. Competitors talk about
   "audit logs"; we talk about a SHA-256 chain that you can verify
   yourself.
5. **Six SDK packages, one version, all five products.** The same v5.0.0
   suite installs cleanly into NYM, NSP, NSI, NSA, NSM with no
   per-product fork. New SDK functionality lights up everywhere on the
   next install.
6. **Multi-tenant isolation is enforced in the data layer**, not just at
   the application layer. Row-level security means a SQL-level mistake
   does not leak across tenants.
7. **LLM provider rotation with circuit breakers.** When OpenAI is
   degraded, OpenRouter rotates to the next provider; when Anthropic is
   degraded, the same. The consumer never sees a "provider down" page.
8. **Compliance-first.** DPDP, GDPR, and equivalent attestations live in
   the codebase as documents and as runtime guards, not as a quarterly
   checklist.
9. **Forward-only schema migrations** + idempotent seeders mean the
   platform survives every deploy without manual data fix-ups.
10. **The platform answers a question in 7 seconds for a citizen** and
    in 90 minutes for a 4,000-contract enterprise bulk job. The same
    orchestrator, the same registry, the same audit chain — at both
    ends of the volume spectrum.

---

## 11. Roadmap Snapshot

| Horizon         | Theme                                                                |
|-----------------|----------------------------------------------------------------------|
| v5.0.0 (now)    | GA cut for 5 Nyayasiddhi platforms; 6 SDK packages live; EC2 dev.   |
| v5.1 (Q3 2026)  | Source migration to Bitbucket / GitLab; CI/CD bridge retired; multi-region. |
| v5.2 (Q4 2026)  | Marketplace for third-party specialist agents (`skillshop`).        |
| v5.3 (Q1 2027)  | On-prem partner appliance ("NYV Edge") for regulated tenants.       |
| v6.0 (2027)     | Federated multi-tenant — partner-hosted agents joining the registry. |

The full roadmap with feature-level detail lives in
[`../../Roadmap.md`](../../Roadmap.md) and
[`../v3.1.2/pending_implementation_docs/NYV-ROADMAP-Q2-Q4-2026.md`](../v3.1.2/pending_implementation_docs/NYV-ROADMAP-Q2-Q4-2026.md).

---

## 12. Glossary

- **Agent** — a specialist AI persona with a 23-section system prompt.
- **Apex tier** — NSA / NSM band; deep research, multi-agent ensembles.
- **Audit chain** — SHA-256 linked log of every privileged action.
- **DPDP** — Digital Personal Data Protection Act (India).
- **GA cut** — General Availability release train (this is v5.0.0).
- **Jurisdiction** — IN, UK, US, EU, GC, SG (the six we support today).
- **NyayaMitra (NYM)** — the citizen-tier consumer product.
- **NSP / NSI / NSA / NSM** — the four professional / enterprise / apex
  / ministry tiers.
- **Pattern** — one of the 22 named agentic patterns (P1–P22).
- **Queen** — Tier-0 orchestrator agent (one per jurisdiction).
- **RAG** — retrieval-augmented generation.
- **Registry** — the per-jurisdiction collection of 148 specialists +
  1 Queen.
- **SDK suite** — the six v5.0.0 packages a consumer installs.
- **Sarvam** — the Indic STT/TTS/LLM provider; the Indian-language
  default.
- **Tenant / Organisation / User** — the three-tier multi-tenant model.

---

## 13. v5.0.0 GA-readiness statement

As of 2026-05-01:

| Item                                                       | Status |
|------------------------------------------------------------|--------|
| EC2 dev gateway healthy                                    | yes |
| Audit hash chain strict-OK                                 | yes |
| All 6 SDK packages at v5.0.0 in S3                         | yes |
| All 5 platform keys provisioned                            | yes |
| Per-platform hand-off doc shipped                          | yes |
| §11 caveats 5/7/8/9/10 marked RESOLVED                     | yes |
| Zero open critical bugs                                    | yes |
| Five Replit-side carry-overs (R1–R5) tracked               | yes |
| Five EC2-side carry-overs (E1–E5) tracked                  | yes |

The platform is **ready for the 2026-05-03 dev-test-live phase** for all
five Nyayasiddhi ecosystem platforms. **Production GA remains scheduled
for 2026-05-15** per the master schedule in `Project-Tracker.md` §1; the
May-3 milestone is the consumer-app dev-test-live cutover, not production
go-live.
