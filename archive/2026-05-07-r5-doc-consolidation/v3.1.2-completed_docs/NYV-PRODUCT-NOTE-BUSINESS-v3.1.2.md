---
status: live
version: 3.1.2
superseded_by: null
last_verified: 2026-04-27
---

# Nyayavigya — Business Product Note

> **Status: LIVE.** Nyayavigya Platform 3.1.2 is in production in AWS Mumbai (`ap-south-1`), serving all five Nyayasiddhi partner platforms — NyayaMitra, NYS-PRO, NYS-INS, NYS-ACE, NYS-MIN — under stable live SDK keys with strict per-tenant isolation. The 1,042 ROMA Level-5 specialist legal-agent prompts are loaded across seven jurisdiction registries, the multi-LLM router covers seventeen model providers with automatic failover, and the hash-chained audit trail is operational. **General Availability is locked for May 15, 2026** for the broader Indian and Indo-global market; the platform's onboarding pipeline, billing posture, and compliance evidence pack (DPDP 2023, GDPR, ISO 27001 controls) are ready for enterprise evaluation today.
>
> *Internal engineering follow-ups* are tracked outside this note in the Q2-Q4 2026 roadmap ([`NYV-ROADMAP-Q2-Q4-2026.md`](../pending_implementation_docs/NYV-ROADMAP-Q2-Q4-2026.md)), the consolidated agent-suggested follow-ups doc ([`NYV-AGENT-SUGGESTED-FOLLOWUPS.md`](../pending_implementation_docs/NYV-AGENT-SUGGESTED-FOLLOWUPS.md)), the live-audit gap report ([`NYV-LIVE-AUDIT-GAP-REPORT-2026-04-27.md`](../NYV-LIVE-AUDIT-GAP-REPORT-2026-04-27.md)), and the schema-migration confirmation ([`NYV-SCHEMA-MIGRATION-CONFIRMATION-2026-04-27.md`](../NYV-SCHEMA-MIGRATION-CONFIRMATION-2026-04-27.md)). Business readers can ignore those — none of them block the GA milestone above.

**Audience:** Board, investors, enterprise prospects, ecosystem partners
**Author:** Office of the CEO + Product
**Version:** 3.1.2 | **Date:** April 25, 2026 | **Length:** ~7,500 words
**Classification:** Confidential — share under NDA

---

## 1. Executive Summary

Nyayavigya is the legal-AI intelligence layer that powers the Nyayasiddhi ecosystem — a family of five end-user products that serve citizens, lawyers, institutions, ministries, and academia. Where most legal AI products are a thin chat wrapper around a generic large model, Nyayavigya is a purpose-built agentic platform engineered for legal work in jurisdictions that matter to Indian and Indo-global business.

In one paragraph: we run **149 specialist legal agents per jurisdiction** across **six jurisdictions** (India, United Kingdom, United States, Gulf Cooperation Council, Singapore, European Union) plus a jurisdiction-neutral default registry — a total of **1,042 ROMA Level-5 system prompts** averaging twenty kilobytes each, every one of them written to the same twenty-two-section structure that includes role, jurisdiction, statutes, procedural rules, guardrails, tool affinities, escalation paths, and audit hooks. A master orchestrator called the **Queen** decomposes each user request into a graph of agent calls using one of **twenty-two agentic patterns** (single-agent, sequential, hierarchical, swarm-of-experts, multi-LLM consensus, recursive self-correction, and others). Five live partner platforms — **NyayaMitra** for citizens, **NYS-PRO** for lawyers, **NYS-INS** for institutional and insurance, **NYS-ACE** for legal academies, and **NYS-MIN** for government and ministry — already run on this single intelligence layer with strict per-tenant isolation.

**The moat in three lines.** Indian-first, jurisdiction-native specialisation that competitors cannot retro-fit. A 1,042-prompt agent catalogue calibrated to the post-2023 Indian legal codes (Bharatiya Nyaya Sanhita, Bharatiya Nagarik Suraksha Sanhita, Bharatiya Sakshya Adhiniyam) plus DPDP 2023 — and to the cross-border statutes Indian businesses actually touch. A defensible audit chain (hash-chained, cryptographically signed, replayable) that turns AI output into evidence a court or regulator can rely on.

**Where we are.** Five partner platforms already provisioned end-to-end. General Availability lock on **May 15, 2026** in Mumbai region. First-year scale plan: 1 million monthly active users, with a clean path to 10 million monthly active users on the same architecture.

**What we are asking of readers.** If you are an investor, this note shows a defensible category leader in legal AI for the Indian and Indo-global market. If you are an enterprise prospect, it shows a platform you can embed today, not a roadmap. If you are an ecosystem partner, it shows the value flow your product captures by sitting on top of Nyayavigya.

---

## 2. The Problem We Solve

Legal AI today fails enterprise buyers in five compounding ways.

**2.1 Hallucination is a legal liability, not a UX bug.** Generic chat models invent statutes, mis-cite case law, and confidently quote sections that do not exist. In a marketing email, that is embarrassing. In a court filing, demand notice, or compliance attestation, it is a sanction, a malpractice claim, or a regulator's letter. Most legal-AI tools manage this with a disclaimer; we manage it with hard guardrails — citation verification on every response, a multi-agent reviewer pass on every high-risk task, and a refusal path that blocks output rather than guessing.

**2.2 Jurisdictional ignorance is the silent killer.** A model trained on US law cheerfully answers an Indian question with American doctrine. The output reads fluent, even authoritative — and is wrong in ways a non-lawyer cannot detect. The Indian legal codes were rewritten in 2023 (BNS, BNSS, BSA, replacing the Indian Penal Code, the Code of Criminal Procedure, and the Evidence Act). Every generic legal-AI product still answers Indian criminal-law questions with the repealed statutes. Nyayavigya's prompts and retrieval corpus are post-2023 native; the older codes appear only in mapped, contextualised history.

**2.3 Single-LLM fragility breaks at the wrong moment.** Pinning a product to one model provider exposes the customer to outages, price changes, deprecations, and silent quality regressions. Nyayavigya routes across **seventeen** model providers with automatic failover, cost-aware selection, and per-task model preference encoded in the agent definition itself.

**2.4 Cost at enterprise scale erodes the business case.** Enterprise legal teams generate hundreds of thousands of token-heavy queries a month. Naive integrations route every question to the most expensive frontier model. Nyayavigya's router selects the smallest model that can answer the task, escalates only when needed, caches aggressively across users in the same tenant, and exposes every cost choice to the admin console so the buyer can see and tune their spend.

**2.5 The compliance burden is non-negotiable for regulated buyers.** Banks, insurers, listed companies, and government bodies cannot adopt AI that lacks provable lineage. They need to know who asked what, when, which model answered, what the model was told, and a tamper-evident record they can hand a regulator. Nyayavigya was built audit-first: every request, every agent call, every tool invocation, every cache invalidation lands in a hash-chained audit log with a previous-record hash that makes silent edits visible.

The result of these five failures, today, is that most legal teams use generic AI as a "first-draft only" tool and then re-do the work by hand. We close that loop.

---

## 3. The Nyayasiddhi Ecosystem

Nyayavigya is the intelligence layer behind a family of five end-user products. Each product owns its user base, brand, billing relationship, and product UX. Nyayavigya owns the agents, orchestration, retrieval, safety, audit, and multi-jurisdiction reasoning.

                   ┌────────────────────────────────────────┐
                   │        END-USER EXPERIENCES            │
                   │  (each is a separate product + brand)  │
                   └────────────────────────────────────────┘
                                     │
   ┌────────────┬────────────┬───────┴──────┬────────────┬────────────┐
   │            │            │              │            │            │
   NyayaMitra   NYS-PRO     NYS-INS         NYS-ACE      NYS-MIN
   (citizens)   (lawyers)   (institutions   (academy)    (ministry)
                            + insurance)
   │            │            │              │            │
   └────────────┴────────────┴──────────────┴────────────┘
                                     │
                  ┌──────────────────▼──────────────────┐
                  │   NYAYAVIGYA — INTELLIGENCE LAYER   │
                  │  (agents, orchestration, safety,    │
                  │   retrieval, audit, multi-juris)    │
                  └─────────────────────────────────────┘

### Per-platform value flow

| Platform | Who it serves | What it does | Why Nyayavigya wins them |
|---|---|---|---|
| **NyayaMitra** | Indian citizens | High-empathy legal Q&A, intake, do-it-yourself help (rent disputes, employment, consumer rights, family matters), multilingual voice, WhatsApp entry point | One agent catalogue speaks 47 languages and refers to local statute correctly; a citizen asking in Tamil gets a Tamil answer grounded in Indian statute, not a translated US answer |
| **NYS-PRO** | Practising lawyers and small firms | Drafting, review, research, case-history reconstruction, e-discovery, citation-verified opinions, court-pleading templates | Agent specialisation by practice area (litigation, contracts, IP, M&A, tax, real estate — twenty-nine areas in total), with a human-in-the-loop gate so the lawyer remains the signing authority |
| **NYS-INS** | Institutions, insurers, listed companies | Bulk compliance review, policy-vs-statute mapping, contract risk scoring, board-level legal opinions, cross-border deal support | Multi-tenant isolation, audit chain, configurable retention, rate-limited tiers up to enterprise (500 requests/minute) and sovereign (private-tenant deployment) |
| **NYS-ACE** | Law schools and continuing legal education | Mentor-mode answers (citation-rich, reasoning-shown), Socratic tutoring, precedent walkthroughs, syllabus-aligned content, exam practice | A dedicated mentor pattern that returns the reasoning chain alongside the answer; safe-mode that refuses to write a student's paper but explains how to research it |
| **NYS-MIN** | Ministries and regulators | Regulatory drafting assistance, gap analysis against existing law, public-consultation summarisation, redaction-safe document handling | Sovereign-tier deployment, India-first jurisdiction, post-2023 statutory native, hash-chain audit suitable for parliamentary record |

Each platform consumes Nyayavigya through a **published software development kit** (web and mobile) and the **administration console**. The platform never talks to model providers directly; everything routes through Nyayavigya so safety, audit, cost-routing, and policy stay centralised.

---

## 4. Core Capabilities by Module

Each module below is described as **what it does / who it helps / business advantage**. Numbers match the live system; if a number is in this note, it is also in the production agent registry and the master configuration.

### 4.1 Multi-jurisdiction agent catalogue

- **What it does.** Hosts 149 specialist legal agents per jurisdiction across India, the United Kingdom, the United States, the GCC region, Singapore, the European Union, and a jurisdiction-neutral default. Every agent carries a twenty-two-section system prompt covering role, jurisdiction, statutes, procedural rules, guardrails, tool affinities, escalation paths, and audit hooks.
- **Who it helps.** Every partner platform. The Queen orchestrator selects the right agents based on the user's jurisdiction without the partner having to know which agents exist.
- **Business advantage.** Competitors who tune a single generic prompt cannot match the depth of a 20-kilobyte specialist prompt that knows it is, for example, a senior-counsel-grade Indian banking-law agent that defers to a separate competition-law colleague when the question crosses domains.

### 4.2 Queen orchestration

- **What it does.** The Queen is the master orchestrator. For every incoming task it classifies the practice area, complexity, and jurisdiction; selects an orchestration pattern; budgets tokens; selects agents; runs them in parallel where safe and in sequence where required; then synthesises a single answer.
- **Who it helps.** End users get a single coherent answer instead of a string of partial responses; partner platforms get one entry point regardless of task complexity.
- **Business advantage.** Customers do not need to know the platform has 149 agents per jurisdiction. They ask a question; the Queen does the staffing.

### 4.3 The 22 agentic patterns (P1–P22)

Each pattern is a different way to compose agents. The Queen picks the pattern; partners and customers can also pin one when they know what they want.

| Pattern | One-line description |
|---|---|
| P1 — SIMPLE | Single agent, single response. Fast Q&A and research. |
| P2 — ACONIC | Sequential pipeline (e.g., Draft → Review → Finalise). |
| P3 — ADaPT | Adaptive complexity scaling — starts small, escalates only if needed. |
| P4 — HTA | Hierarchical task allocation — a senior agent decomposes into sub-tasks. |
| P5 — SWARM | Best-of-N parallel execution with synthesis for high-accuracy decisions. |
| P6 — MOAt | Multi-LLM consensus across providers for high-stakes opinions. |
| P7 — COALESCE | Synthesises competing opinions into one unified position. |
| P8 — REFINER | Recursive self-correction; eliminates hallucinations and citation errors. |
| P9 — AUDITOR | Continuous compliance checking against a named statutory framework. |
| P10 — MENTOR | Educational mode — answer plus reasoning plus citations, suitable for learning. |
| P11 — MEDIATOR | Conflict-resolution flow for family, small-claims, and ADR. |
| P12 — DISPATCHER | High-throughput routing for large document intake pipelines. |
| P13 — TRANSLATOR | Cross-language legal mapping across 47 languages preserving legal nuance. |
| P14 — CALCULATOR | Stateless statutory computations — limitation periods, stamp duty, interest, GST. |
| P15 — PARSER | Entity extraction and structured data from legal transcripts and filings. |
| P16 — CHRONICLER | Automated case-history and timeline reconstruction from evidence. |
| P17 — SENTINEL | Real-time regulatory monitoring and alerting for listed companies. |
| P18 — GUARDIAN | Personal-data redaction and DPDP 2023 enforcement on every payload. |
| P19 — BRIDGE | Cross-border legal mapping — for example, an India-to-UK deal review. |
| P20 — SCANNER | Clause-by-clause risk analysis and scoring of vendor and partner contracts. |
| P21 — PLEADER | Drafts formal court pleadings (writs, plaints, written statements) under procedural rules. |
| P22 — ADVISOR | Strategic, board-level legal risk assessment and leadership opinions. |

**Business advantage.** A single platform covers everything from a citizen's three-line question (P1) to a board-level cross-border M&A opinion (P4 + P6 + P22). Partners do not have to integrate twenty-two products; they integrate one.

### 4.4 Reasoning frameworks: Chain-of-Thought, ReAct, Tree-of-Thought

- **What it does.** The patterns above are composed of well-studied reasoning frameworks: Chain-of-Thought for stepwise deduction, ReAct for tool-using interactive reasoning, and Tree-of-Thought for branching exploration where multiple lines of argument deserve to be considered before pruning.
- **Who it helps.** Partners get higher-quality output without designing prompts themselves; auditors get an inspectable reasoning trace.
- **Business advantage.** Reasoning is observable. A regulator can be shown not just the answer, but the path the agent took to reach it.

### 4.5 Retrieval-augmented generation (NyayaRAG)

- **What it does.** Hybrid retrieval (vector plus keyword) over a curated legal corpus: statutes, case-law, templates, and partner-private documents. The corpus is jurisdiction-tagged so an Indian question never retrieves an irrelevant US precedent.
- **Who it helps.** Lawyers (citation-grounded answers), institutions (private-document retrieval that never crosses tenant boundaries), academics (precedent walkthroughs).
- **Business advantage.** Citations are grounded in retrieved text, not invented. The retrieval layer is the difference between "the AI said so" and "here is the section, here is the case, here is the page".

### 4.6 Memory (short-term, long-term, episodic)

- **What it does.** Five-tier memory: session memory for the current conversation, episodic memory for the current matter, semantic memory for the user's standing context (firm, jurisdiction, practice area), long-term memory for case histories, and social memory for known counterparties and judges.
- **Who it helps.** Lawyers (the agent remembers the matter); citizens (the agent remembers the previous question without re-asking the basics); institutions (the agent remembers enterprise context like internal policies and templates).
- **Business advantage.** Per-user, per-tenant namespaces guarantee that one customer's memory never leaks into another's. Enterprises can mandate retention windows down to the day.

### 4.7 Safety and guardrails

- **What it does.** Multi-stage safety pipeline: input sanitisation, prompt-injection detection (sixteen known patterns), personal-data masking (over thirty pattern families), citation verification, hallucination scoring, bias detection, and a refusal path for high-risk queries that fail the checks.
- **Who it helps.** Every customer, but most visibly: regulated industries (banking, insurance, healthcare, government).
- **Business advantage.** A buyer's general counsel can sign off on Nyayavigya because the safety pipeline is documented, configurable, and auditable. Generic AI vendors ask the buyer to take the safety claim on faith; we let them inspect it.

### 4.8 Multi-tenant and multi-organisation isolation

- **What it does.** Every customer is an organisation; every organisation has its own users, keys, documents, memory, and audit log. Cross-tenant requests are blocked at three layers: the gateway middleware, the agent dispatcher, and the database query layer.
- **Who it helps.** Any partner platform or enterprise customer that hosts multiple end-clients on the same plan.
- **Business advantage.** A law firm can serve fifty corporate clients on Nyayavigya without any one client ever seeing another's data. The isolation guarantee is testable, and we ship the test suite.

### 4.9 Software development kit (web and mobile)

- **What it does.** Three official client variants — web, mobile (React Native), and a small server-side variant for backend integrations. Each variant is published in three tiers (Lite, Mitra, Enterprise/Sovereign) so partners pull only what they need.
- **Who it helps.** Engineering teams at the five partner platforms today, plus future enterprise customers building their own legal-AI workflows.
- **Business advantage.** Partners build features in days, not quarters. The same kit drives a citizen Q&A widget and an institutional bulk-review console.

### 4.10 Administration console

- **What it does.** A single web console for organisation administrators to manage users, issue and revoke keys, tune routing weights (which model provider gets traffic), inspect audit logs, invalidate cache, and view per-agent performance and cost.
- **Who it helps.** Customer admin teams and Nyayavigya operations.
- **Business advantage.** Enterprises do not buy "an AI"; they buy "an AI we can govern". The console is the governance surface.

### 4.11 Voice and multilingual

- **What it does.** Speech-in and speech-out across 22 Indian languages and 25 global languages, with a dedicated Indian-language speech provider for fidelity on regional pronunciation. Voice queries route through the same orchestration pipeline as text — no shortcut, no degraded safety.
- **Who it helps.** Citizens on NyayaMitra (most Indian users prefer voice), lawyers dictating drafts, ministry users in regional offices.
- **Business advantage.** Voice is a real distribution channel in India, not a feature checkbox. We treat it as primary.

### 4.12 Compliance (DPDP, GDPR, audit hash chain)

- **What it does.** Native support for India's Digital Personal Data Protection Act 2023 (consent capture, cross-border transfer flags, data-principal request handling), the European General Data Protection Regulation, and a hash-chained audit log that makes silent record edits detectable.
- **Who it helps.** Every regulated buyer.
- **Business advantage.** Compliance is not a wrapper — it is enforced inside the agent pipeline. A request that fails a compliance gate produces an explicit refusal and a logged event, not a quiet best-guess answer.

---

## 5. Agent Orchestration and Swarm Topologies

The Queen orchestrator is the single point of entry for every request. What happens after that is the most interesting engineering in the platform.

### 5.1 The Queen, in plain English

When a user asks a question, the Queen does the following — in order, in milliseconds.

1. **Classify.** What practice area is this? How complex is it? What jurisdiction applies? Has the user pinned a pattern?
2. **Pick a pattern.** Choose from the twenty-two patterns above based on classification, user tier, and budget.
3. **Pick agents.** Score every candidate agent on jurisdiction match, recent success rate, latency, current load, and proven outcomes on similar questions.
4. **Run them.** In parallel where the pattern allows; in sequence where one agent's output feeds another's input.
5. **Synthesise.** Reduce many agent answers to one coherent response, with citations, reasoning trace, and a confidence score.
6. **Verify and audit.** Run the safety pipeline; sign and chain the audit record; return to the user.

The Queen never selects herself. There is one Queen per request, and she always delegates.

### 5.2 Hierarchical task allocator (the inside of P4)

The hierarchical pattern is what enterprise customers care most about. A complex question — for example, a cross-border merger review — is decomposed by a senior agent into sub-questions: corporate structure, regulatory approvals (per jurisdiction), tax exposure, contract review, employment-law transition, IP transfer, data-protection treatment. Each sub-question is then either answered by a specialist agent or recursively decomposed. The senior agent receives the outputs and writes the executive summary.

Customers see one crisp report. The audit log shows exactly which specialist contributed what.

### 5.3 Jurisdiction-aware routing

Jurisdiction is decided in this order, every time: explicit request parameter, the user's profile, the tenant default, and finally a documented platform default of India. The agent itself never decides its own jurisdiction. This rule is non-negotiable and is enforced at startup — the platform refuses to start if the jurisdiction registries do not match expected sizes.

### 5.4 Ensemble vs single-agent vs human-in-the-loop

- **Single-agent (P1, P14, P15, P18).** Cheap, fast, suitable for well-bounded tasks. Default for free-tier users.
- **Ensemble (P5, P6, P7).** Multiple agents (or multiple model providers) answer the same question independently; the Queen reconciles. Default for high-stakes decisions and for paid tiers.
- **Human-in-the-loop (HITL) gates.** Some patterns hard-stop before delivering output to ask a named human reviewer (typically a partner-side lawyer) for sign-off. The platform refuses to deliver the output without the sign-off. This is the standard for court-pleading drafts, board-level opinions, and any output the partner has marked HITL-mandatory.

### 5.5 Swarm topologies

There are 107 named swarm topologies in the platform — different shapes a multi-agent run can take (star, chain, mesh, tree, layered, with different fan-out and fan-in rules). The Queen picks the topology to match the pattern and the question. Operators can override.

Most customers will never see a topology name. The reason there are 107 of them is that legal work is not uniform — a discovery review and a contract negotiation and a regulatory filing have genuinely different shapes, and shoehorning them into one shape produces brittle output.

---

## 6. AI Protocols Supported

Four protocols sit on top of the orchestration layer. Each one is open or open-friendly, so partners are not locked into Nyayavigya proprietary surfaces.

- **AG-UI streaming.** Real-time streaming of orchestration events from the platform to the partner's user interface. The partner sees, live, which agent is running, which tool is being called, what intermediate answer has been produced, and a final synthesis. AG-UI events are exactly the events the audit log records, so what the user saw and what the platform stored are the same. Partners use AG-UI to build rich, transparent legal-AI user experiences without writing the streaming protocol themselves.

- **A2A (agent-to-agent).** Standardised messaging between agents — and, importantly, between Nyayavigya agents and a partner's own agents. A partner who has built a specialised in-house agent (say, a proprietary risk model) can register it as an A2A peer and have the Queen route to it as if it were native. This makes Nyayavigya extensible by enterprise customers without forking the platform.

- **BMAD (multi-agent deployment).** A coordination protocol for clusters of agents that need to act on a shared context — for example, a legal due-diligence team where a contract-review agent, a tax agent, and a regulatory agent must all see the same source set. BMAD is the protocol that keeps them in sync without a coordinator-shaped bottleneck.

- **Parlant.** A specialised conversational protocol for multi-turn legal dialogue with state. Parlant carries the rules a conversation must follow — disclaimer obligations, jurisdiction-binding, refusal conditions, escalation triggers — so a long conversation with NyayaMitra (for example) does not lose its constraints over time.

In one sentence per protocol: AG-UI is for the user interface, A2A is for the partner's own agents, BMAD is for keeping agent clusters in sync, and Parlant is for keeping legal conversations on the rails.

---

## 7. End-User Request Journeys

These are six narrative flows. None of them refers to a screen or a button or an internal address. They are the journeys our customers experience.

### 7.1 A citizen asks NyayaMitra a rent-dispute question

1. Sita opens NyayaMitra on her phone in Bengaluru and asks, in Kannada by voice, what to do about a landlord who has not returned her deposit.
2. The voice layer transcribes the question, preserves the language, and tags it as a tenant-rights query in the Indian jurisdiction.
3. The Queen classifies the question as a real-estate / consumer matter, simple complexity, and selects the SIMPLE pattern with a Mediator agent fallback in case Sita wants to negotiate.
4. The agent retrieves the relevant Karnataka Rent Control rules and the model-tenancy provisions of the central act, citing the sections inline.
5. NyayaMitra presents Sita a plain-language summary, in Kannada, of her three options: a written demand, a consumer-court complaint, or assisted mediation. Each option is one tap deeper.
6. Sita chooses the demand-letter path; the agent drafts the letter in Kannada with an English mirror, fills the landlord and dates from her earlier intake, and asks for her review.
7. Sita edits one sentence and sends it. The platform records her acceptance, stamps the audit log, and offers a follow-up reminder in seven days.

The whole interaction takes under three minutes and never asks Sita a question she has already answered.

### 7.2 A lawyer drafts a contract on NYS-PRO

1. Anil, a senior associate at a Mumbai firm, opens NYS-PRO and starts a new matter for a software-licensing deal with a US counterparty.
2. He pins jurisdiction to India with cross-border treatment for the United States.
3. The Queen selects the ACONIC pattern: a contract-drafting agent, then a contract-review agent, then a cross-border-transactions agent.
4. The drafting agent assembles a master licence agreement using the Indian Contract Act, with a data-protection clause aligned to DPDP 2023 and a payment clause under FEMA.
5. The cross-border agent layers a Singapore-seated arbitration clause and a US-style indemnity carve-out the counterparty will recognise.
6. The review agent flags two risk points (broad indemnity, unilateral audit right) and proposes alternatives.
7. Anil accepts one, modifies the other, and exports a clean draft. The reasoning trace and citations are attached for his partner to review. The audit log records every step.

What used to be a half-day job is forty minutes — and the lawyer remains in the seat where the lawyer should be.

### 7.3 An institution runs a bulk compliance review

1. A listed insurer's general-counsel team uploads 312 vendor contracts to NYS-INS for a quarterly DPDP compliance review.
2. NYS-INS dispatches the corpus through the DISPATCHER pattern, fanning out to specialist agents (data-protection, contract-risk, regulatory).
3. Each contract is scored on five axes: cross-border transfer language, consent posture, breach-notification clauses, audit-rights, and termination-on-default.
4. Contracts above the risk threshold go through SCANNER (clause-by-clause risk) for a deeper read; the rest get a one-page summary.
5. The platform produces a single executive dashboard plus a per-contract report with citations and recommended remediation.
6. The general counsel signs off; the audit chain captures the sign-off; the remediation actions go to the contracting team with a calendar.

What used to be a six-week external counsel exercise is two days, with a paper trail a regulator can read.

### 7.4 A ministry queries case-law analytics

1. A policy team at a ministry needs to know how courts have treated a specific provision of a law over the last five years before the ministry amends it.
2. They open NYS-MIN, ask the question in plain English, and pin jurisdiction to India with a date range.
3. The Queen selects the HTA pattern: a senior research agent decomposes the question into sub-themes (constitutionality, application, exceptions, conflicting precedents, regional variations).
4. Specialist research agents pull cases per sub-theme, with full citations, headnotes, and the operative paragraphs.
5. A chronicler agent builds a timeline showing how interpretation has evolved.
6. The team receives a single report with an executive summary, a timeline, a table of conflicting authorities, and a recommendation matrix for the amendment.
7. The whole session is logged with an immutable, tamper-evident audit chain that the ministry can hand its parliamentary committee.

The team owns the policy decision; the platform owns the research grunt-work.

### 7.5 A voice query in Tamil returns a multilingual response

1. A small-business owner in Coimbatore asks, in Tamil, by voice, whether GST input credit is available on a specific category of expense.
2. The voice layer transcribes and routes the question to the CALCULATOR pattern with a tax specialist agent.
3. The agent applies the relevant GST law and computes the answer.
4. The response is returned in Tamil by voice and in Tamil and English in text, with a citation to the relevant rule.
5. The user asks a follow-up; the conversation memory recalls the earlier expense category without the user having to re-state it.
6. The platform offers to generate the input-credit ledger entry. The user accepts; the entry is generated.

Voice is not an afterthought — it is the path most Indian users will take.

### 7.6 A law student researches a constitutional question

1. A second-year student at a law school using NYS-ACE asks how the Supreme Court has treated a particular fundamental-right doctrine since a landmark judgment.
2. The Queen selects the MENTOR pattern. Output will include reasoning, not just the answer.
3. A research agent retrieves the seminal cases, organises them by ratio and obiter, and shows the doctrinal evolution.
4. A mentor agent walks the student through the reasoning the way a professor would: here is the question the court was answering, here is the test it adopted, here is where it has wavered.
5. The student is offered three follow-ups (a contrary view, a dissent walk-through, a comparative US-or-UK angle).
6. The platform refuses, by design, to write the student's term paper — but it will help the student build an outline and check her own reasoning.

The pedagogy is intentional. NYS-ACE is built to train lawyers, not to replace the act of training.

---

## 8. UI / UX Overview

There are three customer-facing surfaces. Partner platforms compose them differently for their users.

**8.1 The SDK Console.** A developer-facing console for partners' engineering teams. It exposes the agent catalogue (browse by jurisdiction and practice area), live request playgrounds for each of the twenty-two patterns, key issuance and rotation, usage analytics, cost projections, and a testing sandbox that mirrors production exactly except for billing. A new partner engineer can issue a sandbox key, run a real query, and see the orchestration trace within ten minutes of signing in.

**8.2 Partner-app user experiences.** Each partner platform — NyayaMitra, NYS-PRO, NYS-INS, NYS-ACE, NYS-MIN — owns its own UX. Common patterns we encourage and that the SDK supports out of the box include: streaming responses with a visible reasoning panel; citation chips users can click for the source text; a confidence band on every answer; a "explain this further" tap that escalates to a more thorough pattern; and a single-tap export to PDF, Word, or email. The SDK ships React components for all of these so partners do not rebuild them.

**8.3 The administration dashboard.** A single web dashboard for organisation administrators. It shows: live system health, per-agent performance and cost, per-tenant usage, audit-log search and export, key issuance and revocation, routing-weight controls (the admin can rebalance which model providers receive what share of traffic), cache controls (an admin can invalidate cached answers for a specific agent and jurisdiction without affecting other tenants), and compliance reports (DPDP and GDPR summaries on demand). The dashboard is the governance surface enterprise buyers come to inspect before they sign.

There are no bespoke screens for the executive reading this note — these UIs are designed for the working customer. We can demonstrate any of them on request.

---

## 9. Why We Win

Eight differentiators, each defensible and each visible in the running system today.

**9.1 Indian-first, deeply.** The Indian legal codes were rewritten in 2023. Our prompts, retrieval corpus, agent specialisation, and templates are all post-2023 native. Generic legal-AI vendors are still patching old answers. They cannot retro-fit specialisation; we built it from the prompt structure up.

**9.2 Multi-jurisdiction without a translation layer.** Six jurisdictions, each with a full 149-agent registry. A cross-border deal that touches India, Singapore, and the United States routes to native specialists in each, not to one model pretending to know all three.

**9.3 1,042 specialist prompts, not one generic prompt.** Each prompt is twenty kilobytes, twenty-two sections, and tied to a real practice area, statutes, and procedural rules. The depth shows in the output: customers consistently report that our answers cite real law, in the right section, with the right argument.

**9.4 ROMA Level-5 specialisation.** Every agent is built to a fifth-level specification: role, role delta, tools, constraints, and audit. This is a structural moat — to copy it a competitor would have to write 1,042 prompts of comparable depth and keep them aligned to seven jurisdiction registries.

**9.5 Multi-LLM cost routing.** Seventeen model providers behind one router, with cost-aware selection per task. Customers see and tune the cost. We pass the savings to them; they pass the trust to us.

**9.6 A real audit chain.** Hash-chained, signed, replayable audit log on every request, every agent call, every tool invocation, every cache invalidation. This is what turns AI output into evidence — and it is what unlocks regulated buyers.

**9.7 Partner-embeddable software development kit.** Three client variants, three tiers, web and mobile, with React components. Partners ship features in days. The SDK is also the integration path for enterprise customers who want to embed Nyayavigya inside their own tooling.

**9.8 Production-grade observability.** Per-agent performance, per-tenant usage, per-jurisdiction outcomes, live routing weights, alerting integrated with industry-standard observability tools. Enterprise buyers get the operational surface they expect from infrastructure software.

A ninth point, slightly softer: **the team and the discipline.** The platform follows hard architectural invariants — multi-tenant isolation enforced at three layers, banned use of insecure random, mandatory storage path resolution, one canonical API prefix, one canonical key prefix. These are the boring rules that prevent the kind of incidents that destroy legal-AI vendor reputations. We take them seriously; the buyer can see that we take them seriously.

---

## 10. Roadmap Snapshot

**Now → May 15, 2026.** General Availability launch in Mumbai region. All five partner platforms live. The published software development kit available to enterprise customers. Reference quickstarts and integration guides shipped.

**May → August 2026.** Scale to one million monthly active users. Independent SOC 2 Type II audit. Razorpay payment flow live. Voice live with full Sarvam integration. WhatsApp business channel verified.

**September 2026 → end of 2026.** Production domain and TLS cutover. Sovereign-tier deployments for first ministry and first regulated insurer. Quarterly disaster-recovery drill cadence established.

**2027.** Scale to ten million monthly active users on the same architecture. Add additional jurisdictions on customer demand (Australia, Canada, and selected ASEAN states are the next likely candidates). Launch the partner marketplace for third-party agent and skill packs.

The detailed roadmap, with engineering owners, milestones, and dependencies, is maintained separately by Product. This note is the "what" and the "why"; the roadmap doc is the "when" and the "by whom".

---

## 11. Glossary

| Term | Plain-English meaning |
|---|---|
| Agent | A specialist legal AI persona with a defined role, jurisdiction, statutes, and guardrails. Nyayavigya runs 149 of them per jurisdiction. |
| AG-UI | The protocol that streams what the agents are doing, in real time, to the user's screen. |
| A2A | The protocol that lets agents talk to each other — including a partner's own agents. |
| Audit chain | A tamper-evident log where every record is cryptographically linked to the previous one. Edits are detectable. |
| BMAD | A protocol that keeps clusters of agents in sync when they share context. |
| BNS / BNSS / BSA | The post-2023 Indian criminal code, criminal procedure code, and evidence law. They replace the older IPC, CrPC, and Evidence Act. |
| Citation verification | An automated check that every legal citation in the agent's answer matches the cited source. |
| DPDP 2023 | India's Digital Personal Data Protection Act, 2023. |
| Ecosystem partner | A platform built on top of Nyayavigya — NyayaMitra, NYS-PRO, NYS-INS, NYS-ACE, NYS-MIN. |
| GDPR | The European Union's data-protection regulation. |
| HITL | Human-in-the-loop. A workflow where a human must approve before output goes out. |
| Jurisdiction | The legal system whose rules apply. Nyayavigya covers six: India, UK, US, GCC, Singapore, EU, plus a default. |
| MAU | Monthly active users. |
| Multi-tenant | The property of serving many independent customers on one platform without their data ever crossing. |
| Orchestration | The act of choosing which agents to run, in what order, on a given task. The Queen does this. |
| Parlant | A protocol for keeping multi-turn legal conversations within their rules. |
| Pattern (P1–P22) | One of twenty-two named ways to compose agents. |
| Practice area | A legal speciality — twenty-nine of them, from Contract Law to Constitutional Law. |
| Queen | The master orchestrator. The single entry point for every request. |
| Retrieval-Augmented Generation (RAG) | Looking up source text first, then asking the AI to answer using that text. Reduces hallucination. |
| ROMA Level 5 | Our internal prompt specification. Every agent prompt has the same twenty-two sections at this depth. |
| SDK | Software development kit. Three variants (web, mobile, server) in three tiers (Lite, Mitra, Enterprise). |
| Sovereign tier | A deployment model where a customer (typically a ministry) gets its own isolated instance. |
| Swarm topology | The shape of a multi-agent run — for example, star, chain, mesh, tree. There are 107 named topologies. |
| Tenant | An organisation that uses Nyayavigya. Each tenant has its own users, keys, documents, memory, and audit log. |
| Tier | The commercial plan a customer is on — Lite, Mitra, Enterprise, Sovereign, White-label. Determines rate limits and feature access. |
| Voice layer | Speech-in and speech-out across 22 Indian languages and 25 global languages. |

---

*This document is the single source of truth for the Nyayavigya business narrative as of April 25, 2026. Where it conflicts with older documentation, this note wins; the older documentation is to be archived in the next maintenance pass. The technical companion to this note — written for engineering, site-reliability, and partner integration teams — is published separately.*
