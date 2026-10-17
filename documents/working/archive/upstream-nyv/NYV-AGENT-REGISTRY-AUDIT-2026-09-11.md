# NYV Agent Registry Audit — 2026-09-11

> **Scope:** NYV (`nyayavigya-platform-312/`) agent mesh, NSP partner prominence, prompt quality vs global legal-AI best practices.  
> **Method:** Source read + registry JSON parse + routing code trace (NV-EXECUTE-BEFORE-CLAIM-001). No live EC2 probes in this pass.  
> **Registry SSoT:** `config/agent-registries/Nyayavigya-Legal-registry-Default.json` (164 live agents, v5.1.0).

---

## Executive summary

The NYV runtime loads **164 governed agents** (registry v**5.1.0**), not the archived 1,042 forensic set. Partner NSP/NYM flows are wired through explicit `taskType` aliases (`legal-chat-fast`, `legal-draft-fast`, `doc-draft-fast`) → capability resolution → subject-matter name hints → specialist dispatch, with SME India-first overlays injected via `nv-legal-intelligence-overlay.ts` and `nv-legal-drafting-prompt.ts`.

**Strengths:** India-first statute mapping (BNS/BNSS/BSA), 22-section agent constitutions with OWASP LLM §0, safety ring (citation + hallucination), NYS RAG hooks on research agents, explicit partner taskType bridge (NV-AGENT-CAPABILITY-ALIAS-001), adaptive router fast-sync specialist path for `-fast` aliases.

**Honest gaps:** Only **9 distinct capability sets** across 164 agents — specialization is mostly in `name`/`§1` identity, not skills; docs/code tension on Queen vs specialist for `-fast`; MCP catalog (556) vs executable (134) gap; no dedicated CNR/matter-memory agent (CNR is API + parameters); generic fallback still possible for unmapped taskTypes; subject-matter routing depends on prompt keyword classifier.

**Registry quality score: 7.6 / 10** (post NV-AGENT-PIN-CITATION-001, 2026-09-12) — P0 agent pin + research differentiation + citation/structure gates shipped; MCP executable gap and CNR continuity remain.

---

## Part 1 — Inventory

### 1.1 Headline registry facts

| Item | Value | Source |
|---|---|---|
| Registry version | **5.1.0** | `Nyayavigya-Legal-registry-Default.json` |
| Live agents | **164** | Same + `FEATURES-REGISTRY.md` §0 |
| Archived forensic | 1,042 (v5.0.0 flat backup) | `config/agent-registries/archive/v5.0.0/` |
| Queen orchestrator | Q-001 Queen Orchestration Engine | Registry |
| Primary jurisdiction | IN (overlay merge) | `NV_PRIMARY_JURISDICTION` |
| Distinct capability sets | **9** | Registry analysis |
| INTENT_CAPABILITY_MAP bindings | **~160** | `capability-manifest.ts` |
| MCP catalog / executable / partner | 556 / 134 / ~125 | `FEATURES-REGISTRY.md` §0 |
| Effective orphans (BFS) | **0** (budget) | `FEATURES-REGISTRY.md` §0 |

### 1.2 Agent mesh & capabilities (FEATURES-REGISTRY)

- **Queen:** `nv-queen-orchestrator.ts` — A2A INTENT + ROMA L5, adaptive router admission (`nv-queen-admission.ts`).
- **Capability manifest SSoT:** `src/orchestration/capability-manifest.ts` (snapshot JSON generated).
- **Intent mesh:** `INTENT_CAPABILITY_MAP` binds decomposer intents + ADaPT domains + Wave B6 leaf aliases (`template`, `precedent`, `filing`, `playbook`, etc.).
- **Partner task bridge:** `src/services/nv-agent-capability-alias.ts` — `TASK_TYPE_CAPABILITY_ALIASES` + `capabilitiesForTaskType()` + `classifySubjectArea()` + `nameHintsForSubject()`.
- **Agent selection:** `resolveAgentByCapability()` in `src/services/nv-client.ts` — capability match + subject name hints + jurisdiction filter.

### 1.3 Agents by NSP-relevant domain

#### Drafting (24 agents — practice area: Legal Drafting & Document Generation)

| ID | Name | Key capabilities |
|---|---|---|
| A-001 | Contract Drafting Agent | document-generation, clause-drafting, template-management |
| A-002 | NDA Drafting Agent | same set |
| A-003 | Employment Agreement Agent | same set |
| A-004 | **Pleading Drafting Agent** | same set — **NSP pleadings** |
| A-005 | **Legal Notice Agent** | same set |
| A-006 | Affidavit Drafting Agent | same set |
| A-007–A-024 | MoU, Lease, Will, POA, … | same capability template |

**Runtime overlay (all drafting paths):** `buildLegalDraftSystemPrompt()` — `src/services/nv-legal-drafting-prompt.ts:449–564`.

#### Case management (no CNR-specific agent; API + matter tools)

| Surface | Agent / capability | Wired? |
|---|---|---|
| CNR resolve | `/api/nv/v1/sdk/cnr/*` → NYS (no agent) | **Live** |
| Matter opening | A-116 Matter Opening Agent | Registry |
| Client intake | A-115 Client Intake Agent | Registry |
| Deadlines / limitation | A-085–A-094 (12 deadline agents) | Registry |
| Matter memory | L1–L5 tiers + mem0; `matter-manager` tool on most agents | **WIRED** |

#### AI chat / counsel

| Path | Routing | Prompt stack |
|---|---|---|
| `legal-chat-fast` | Adaptive router → **specialist** (`fast_sync_specialist`) | Registry agent §0–§22 + `buildLegalAdviceSystemPrompt()` overlay |
| `legal-chat` (bare) | May Queen if complexity/risk earned | Queen + overlays |
| Queen counsel | Q-001 + swarm leaves | Queen analyzePrompt + leaf agent prompts |

#### Research (18 agents — Legal Research & Intelligence)

| ID | Name | NYS MCP tools |
|---|---|---|
| A-047 | Statutory Research Agent | nys_search_caselaw, nys_search_statutes, nys_get_statute, nys_compare_ipc_bns |
| A-048 | Case Law Research Agent | same |
| A-051 | Precedent Research Agent | same |
| A-052–A-064 | Tax, Labour, IP, Family, … | **Identical capability[]** — differentiated by name only |

#### NSP-specific routing

- **Platform detection:** `src/utils/nv-partner-platform.ts` — NSP/NYM India-only; `-fast` alias normalization; SLA token floors; RAG skip rules (`NV-FAST-CHAT-NORAG-001`, `NV-FAST-DRAFT-NORAG-001`).
- **Adaptive path:** `src/orchestration/nv-adaptive-router.ts:278–294` — explicit `-fast` → specialist, CoT off.
- **Partner smoke taskTypes:** `scripts/nv-partner-smoke.sh`, `_ec2-partner-readiness-sweep.sh` — legal-draft-fast, legal-chat-fast, doc-draft-fast, cnr/resolve, legal-research.

---

## Part 2 — NSP prominence matrix

Sources: `NSP-MIGRATION-GO-2026-09-08.md`, `PARTNER-AI-INTEGRATION-AND-PROMPT-ENGINEERING-2026-09-02.md` §J, partner smoke matrix.

| Agent (resolved) | NSP use case | Prominence | Live wired? | `-fast` path? |
|---|---|:---:|:---:|:---:|
| A-047/A-048 (subject-ranked) | Legal Chat Q&A (`legal-chat-fast`) | **P0** | Yes | Yes — specialist, doc-less RAG skip |
| A-001/A-003/A-004 (capability + subject) | Describe & Generate (`legal-draft-fast`) | **P0** | Yes | Yes — specialist + draft overlay |
| A-004 Pleading Drafting Agent | Written statement, bail, SLP prompts | **P0** | Yes (via subject hints) | Yes |
| A-005 Legal Notice Agent | Notice drafting | **P1** | Yes | Yes |
| Q-001 Queen | Full pleading / `legal-draft` async counsel | **P0** (async) | Yes | No — 70–94s Opus path |
| — (CNR API) | Matter autofill before draft (§J.8) | **P0** | Yes | N/A |
| A-048 Case Law Research | Caselaw / research orchestrate | **P1** | Yes | Via `legal_research` |
| A-025 Contract Risk Review | Contract review / citation_check | **P1** | Yes | No |
| Patra Mitra (capability leaf) | File companion summarize/Q&A | **P1** | Yes | Sync 90s |
| Gateway summarize | Selection summarize | **P1** | Yes | N/A |
| A-115/A-116 | Intake / matter open (future NSP UX) | **P2** | Registry only | No |
| A-085–A-094 | Deadline tracking | **P2** | Registry + tools | No NSP UI yet |

### NSP §J taskType → endpoint map (condensed)

| User action | taskType | Path | Target latency |
|---|---|---|---|
| Quick legal Q&A | `legal-chat-fast` | orchestrate (sync/stream) | ~4–7s sync |
| Short draft / prayer | `legal-draft-fast` | orchestrate (sync/stream) | ~5–23s (SLA ON) |
| Doc-grounded draft | `doc-draft-fast` | orchestrate + documentText/ragDocumentIds | ~15–45s |
| Full pleading | `legal-draft` | async worker + poll | 600s |
| CNR autofill | — → `cnr/resolve` → orchestrate parameters | sync | 60s + 90s |

---

## Part 3 — Top 10 NSP agents (detail)

### Resolution note

`resolveAgentByCapability()` picks the first agent matching capability skills, then breaks ties with `classifySubjectArea(prompt)` + `nameHintsForSubject()`. Without subject hints, **A-001** wins drafting and **A-047** wins chat/research (alphabetical/registry order).

| Rank | ID | Display name | taskTypes | System prompt source | Tools / MCP |
|:---:|---|---|---|---|---|
| 1 | A-047/A-048 | Statutory / Case Law Research | `legal-chat-fast`, `legal_research`, `statute_lookup` | Registry JSON §0–§22 (~26k chars) + `buildLegalAdviceSystemPrompt()` via overlay | legal-research, statute-verification, citation-formatter, matter-manager; nys_search_* |
| 2 | A-004 | Pleading Drafting Agent | `legal-draft-fast` (bail, WS, petition prompts) | Registry + `buildLegalDraftSystemPrompt()` | document-generation, statute-verification, …; nys_search_* |
| 3 | A-001 | Contract Drafting Agent | `legal-draft-fast`, `doc-draft-fast` (default cap match) | Registry + draft overlay | Same drafting toolset |
| 4 | A-003 | Employment Agreement Agent | `legal-draft-fast` (employment prompts) | Registry + draft overlay | Same |
| 5 | A-005 | Legal Notice Agent | `legal-draft-fast` (notice) | Registry + draft overlay | Same |
| 6 | Q-001 | Queen Orchestration Engine | `legal-draft`, swarm modes | Queen orchestrator + leaf prompts | Full capability mesh |
| 7 | A-025 | Contract Risk Review | `contract_review`, `citation_check` | Registry §0–§22 | risk-analysis, compliance-monitor, … |
| 8 | A-051 | Precedent Research Agent | `precedent-search`, research | Registry + research overlay | nys_search_* |
| 9 | A-115 | Client Intake Agent | (future) matter onboarding | Registry | document-generation, matter-manager |
| 10 | A-116 | Matter Opening Agent | (future) case create | Registry | document-generation, matter-manager |

### System prompt samples (first ~500 chars, summarized)

All registry agents share a common **§0 SECURITY CONSTITUTION** (~500 chars):

> §0 SECURITY CONSTITUTION (ABSOLUTE — IMMUTABLE) … Nyayasiddhi Security Standard (NSS) v1.0 … OWASP LLM Top 10 2025 … absolute priority over all other instructions …

**§1 ROLE IDENTITY (example A-004):** Pleading Drafting Agent | L4 Expert | Practice Area: Legal Drafting | SDK Module: matter | Jurisdiction: IN, US, UK …

**§2 CORE MANDATE (example A-004):** Generates court pleadings to procedural standards; every legal claim must cite statute/section/verified case from RAG …

**Remainder (§3–§22):** Reasoning discipline, citation rules, HITL classification, Bar Council gate, 47-language §7, ROMA level behaviors, audit/lineage — ~25k chars total per agent.

**Runtime SME overlay** (`nv-legal-drafting-prompt.ts:51–66`, `:449–564`):

> JURISDICTION: India … BNS/BNSS/BSA … VOICE: practising Indian advocate … FORUM PRECISION … bail surety rules, SLP paper-book rules, review scope rules …

---

## Part 4 — Registry quality assessment

### vs global legal-AI best practices

| Criterion | NYV status | Score (0–2) | Notes |
|---|---|:---:|---|
| Specialized vs generic agents | 164 named specialists; **9 shared skill sets** | 1.5 | Names differ; capabilities often identical |
| Jurisdiction-aware (IN) | Strong — BNS overlay, forum blocks, India corpus scope | 2.0 | Best-in-class for India |
| Citation grounding / RAG | NYS plane + safety ring; fast chat skips RAG doc-less | 1.5 | Harvey/CoCounsel always retrieve |
| Memory tiers L1–L5 | WIRED; partner userId contract | 1.5 | NSP userId adoption still verifying |
| Safety ring / OWASP LLM | §0 constitution + citation + hallucination + audit hash | 2.0 | Strong |
| Intent mesh NV-MESH-001 | ~160 INTENT bindings + tool bridge | 1.5 | CI `guardrail:intent-mesh` |
| Orphan agents | 0 effective (FEATURES-REGISTRY) | 2.0 | Local guardrail tsx permission issue this session |
| MCP catalog vs live | 556 defined / 134 executable | 0.5 | Large gap; partner sees ~125 |

**Overall: 7.2 / 10**

### Top 5 gaps (fix priority)

| # | Gap | Priority | Concrete fix (not stub) |
|---|---|:---:|---|
| 1 | **Capability homogeneity** — 18 research agents share identical `capabilities[]` | P0 | **DONE 2026-09-12:** `RESEARCH_CAPABILITY_AGENT_ID` + research task aliases + Queen hints — minimal diff |
| 2 | **Default agent tie-break** — generic capability match → A-001/A-047 | P0 | **DONE 2026-09-12:** `nv-document-type-agent-pin.ts` — 20 types → specialist agents; wired pre tie-break |
| 3 | **Fast-path citation depth** — doc-less chat skips RAG | P1 | **DONE 2026-09-12:** `tryStatutePrefetchLightweight()` — 1.8s lookup / 2s wall on `legal-chat-fast` |
| 4 | **MCP executable gap** — 422 catalog tools without handlers | P1 | Publish partner-facing "live tools" manifest; prune catalog or implement top 20 NSP tools |
| 5 | **CNR → draft continuity** — no agent owns matter memory thread | P2 | Extend A-116 Matter Opening Agent with `cnr-resolved` memory seed + orchestrate parameter schema in INTENT map |

---

## Part 5 — Top agent system prompts (deep dive)

### 5.1 A-048 Case Law Research Agent (`legal-chat-fast`)

| Field | Detail |
|---|---|
| **Prompt location** | `config/agent-registries/Nyayavigya-Legal-registry-Default.json` (agent A-048 `systemPrompt`) + runtime overlay `src/services/nv-legal-intelligence-overlay.ts` |
| **How it works** | `taskType: legal-chat-fast` → adaptive router `fast_sync_specialist` → `resolveAgentByCapability` → A-047/A-048 + `buildLegalAdviceSystemPrompt(IN)` merged via `buildUniversalLegalIntelligenceOverlay()` |
| **Model / polish** | `preferredModels`: claude-sonnet-4-6 cascade; fast tier `NYV_PARTNER_FAST_SERVING_TIER=plus` (Haiku-first); CoT **off** on `-fast` |
| **Gap vs Harvey/CoCounsel** | No mandatory retrieval-before-answer on doc-less chat; relies on model parametric knowledge + optional RAG |
| **Fix** | Wire `tryStatuteFaqFastPath` / NYS hybrid search as pre-LLM gate for all IN chat-fast; attach `citations[]` block in partner response |

### 5.2 A-004 Pleading Drafting Agent (`legal-draft-fast`)

| Field | Detail |
|---|---|
| **Prompt location** | Registry A-004 + `src/services/nv-legal-drafting-prompt.ts:449` (`buildLegalDraftSystemPrompt`) |
| **How it works** | Specialist path; `parameters.documentType` → `inferDraftDocFamily()` → India structure + BNSS pack + forum context + firm clause overlay |
| **Model / polish** | Draft SLA cap (`NYV_DRAFT_FAST_SLA`); human polish pass; `draftQuality` + `attestationRequired` in response |
| **Gap vs Harvey** | Strong India SME rules; weaker on automatic citation insertion from retrieved judgments |
| **Fix** | Post-draft citation pass: NYS search on key legal phrases → inject `[YYYY] SCC …` footnotes with verify-citation |

### 5.3 Q-001 Queen (`legal-draft` counsel)

| Field | Detail |
|---|---|
| **Prompt location** | Registry Q-001 + `src/orchestration/nv-queen-orchestrator.ts` (analyzePrompt, leaf dispatch) |
| **How it works** | Queen admission gate → decompose → swarm leaves → maker-checker (flag) → ROMA L5 trackOutcome |
| **Gap vs CoCounsel** | Comparable depth; latency 70–94s — correct for async, not sync UI |
| **Fix** | Document in NSP contract only (done); add `routing.queenAdmission` to partner SDK types |

### 5.4 Shared draft overlay (`buildLegalDraftSystemPrompt`)

| Field | Detail |
|---|---|
| **File:line** | `src/services/nv-legal-drafting-prompt.ts:449–564` |
| **First 500 chars (paraphrase)** | India jurisdiction core; BNS/BNSS/BSA; advocate voice; forum precision; family-specific structures (bail, SLP, review, rejoinder rules) |
| **Gap** | 622+ token overlay on every draft — good for quality, competes with SLA token caps |
| **Fix** | Tiered overlay: compact mode for `-fast` SLA ON (forum + family rule only) |

### 5.5 `buildLegalAdviceSystemPrompt` (chat overlay)

| Field | Detail |
|---|---|
| **File:line** | `src/services/nv-legal-drafting-prompt.ts:631–651` |
| **Structure** | Issue → Short answer → Analysis → Options → Next steps → Risks |
| **Gap** | No required "Sources consulted" section with NYS hit IDs |
| **Fix** | Append `SOURCES:` block when RAG or statute fastpath fired |

### 5.6 Partner platform routing

| Field | Detail |
|---|---|
| **File** | `src/utils/nv-partner-platform.ts` |
| **Key behaviors** | `-fast` CoT off; India-only; token floors; RAG skip rules; stream gated replace semantics |
| **Doc tension** | `NYV_NSP_COUNSEL_QUEEN=1` affects SLA detection but `-fast` still hits `fast_sync_specialist` in adaptive router — **docs and code align for `-fast`** |

### 5.7 INTENT_CAPABILITY_MAP

| Field | Detail |
|---|---|
| **File:line** | `src/orchestration/capability-manifest.ts:4791+` |
| **Notable** | `draft`/`drafting` intentionally NOT bound to `templates.generate` (NV-LEGAL-DRAFT-BEST-001) |
| **Gap** | No `cnr` or `matter_memory` intent binding |
| **Fix** | Add `{ intent: 'cnr', capabilityIds: ['nyaya-tools.cnr-resolve', 'memory.tiered.store'] }` |

### 5.8 Subject-matter routing

| Field | Detail |
|---|---|
| **File:line** | `src/services/nv-agent-capability-alias.ts:306–337` |
| **Fixes IPC→BNS regressions** | Keyword classifier + name hints |
| **Gap** | Classifier can miss multi-issue prompts |
| **Fix** | Lightweight LLM subject classifier on first turn only (cached in session) |

---

## Part 6 — Top 15 agents (summary table)

| # | ID | Name | Primary NSP taskTypes | Practice area | ROMA | -fast? |
|:---:|---|---|---|---|:---:|:---:|
| 1 | A-048 | Case Law Research Agent | legal-chat-fast | Research | L2 | Yes |
| 2 | A-047 | Statutory Research Agent | legal-chat-fast, statute_lookup | Research | L2 | Yes |
| 3 | A-004 | Pleading Drafting Agent | legal-draft-fast | Drafting | L4 | Yes |
| 4 | A-001 | Contract Drafting Agent | legal-draft-fast, doc-draft-fast | Drafting | L3 | Yes |
| 5 | A-005 | Legal Notice Agent | legal-draft-fast | Drafting | L3 | Yes |
| 6 | A-003 | Employment Agreement Agent | legal-draft-fast | Drafting | L4 | Yes |
| 7 | Q-001 | Queen Orchestration Engine | legal-draft, swarm | Governance | L5 | No |
| 8 | A-025 | Contract Risk Review Agent | contract_review, citation_check | Review | L4 | No |
| 9 | A-051 | Precedent Research Agent | legal_research | Research | L2 | No |
| 10 | A-006 | Affidavit Drafting Agent | legal-draft-fast | Drafting | L3 | Yes |
| 11 | A-002 | NDA Drafting Agent | doc-draft-fast | Drafting | L3 | Yes |
| 12 | A-115 | Client Intake Agent | (future intake) | Correspondence | L4 | No |
| 13 | A-116 | Matter Opening Agent | (future matter create) | Correspondence | L3 | No |
| 14 | A-112 | Court Communication Agent | correspondence | Correspondence | L4 | No |
| 15 | A-085 | Court Deadline Tracker Agent | limitation, deadline | Timelines | L2 | No |

---

## Appendix — Key file index

| Purpose | Path |
|---|---|
| Registry JSON | `nyayavigya-platform-312/config/agent-registries/Nyayavigya-Legal-registry-Default.json` |
| TaskType aliases | `nyayavigya-platform-312/src/services/nv-agent-capability-alias.ts` |
| Agent selection | `nyayavigya-platform-312/src/services/nv-client.ts` (`resolveAgentByCapability`) |
| Draft prompts | `nyayavigya-platform-312/src/services/nv-legal-drafting-prompt.ts` |
| Intel overlay | `nyayavigya-platform-312/src/services/nv-legal-intelligence-overlay.ts` |
| Partner routing | `nyayavigya-platform-312/src/utils/nv-partner-platform.ts` |
| Adaptive router | `nyayavigya-platform-312/src/orchestration/nv-adaptive-router.ts` |
| Queen | `nyayavigya-platform-312/src/orchestration/nv-queen-orchestrator.ts` |
| Intent map | `nyayavigya-platform-312/src/orchestration/capability-manifest.ts` |
| NSP migration | `documents/working/NSP-MIGRATION-GO-2026-09-08.md` |
| Partner §J | `documents/working/PARTNER-AI-INTEGRATION-AND-PROMPT-ENGINEERING-2026-09-02.md` |

---

*Audit generated 2026-09-11 · NV-AGENT-REGISTRY-AUDIT-001 · Evidence: registry parse + source trace (no secrets logged).*
