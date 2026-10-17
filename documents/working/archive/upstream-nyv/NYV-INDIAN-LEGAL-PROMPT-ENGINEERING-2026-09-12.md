# NYV Indian Legal Prompt Engineering — Master Reference

**Date:** 2026-09-12  
**Scope:** NYV (`nyayavigya-platform-312/`) — all NSP request surfaces (draft, chat, intelligence, research)  
**Code SSoT:** `nv-indian-draft-structure-registry.ts`, `nv-legal-drafting-prompt.ts`, `nv-legal-intelligence-overlay.ts`, `nv-citation-proposition-gate.ts`, `nv-document-type-agent-pin.ts`, `nv-draft-length-registry.ts`  
**Partner ref:** `PARTNER-AI-INTEGRATION-AND-PROMPT-ENGINEERING-2026-09-02.md` §J  
**Registry audit:** `NYV-AGENT-REGISTRY-AUDIT-2026-09-11.md`

---

## A. Global-best process (NSP → NYV → LLM → polish → envelope)

```
NSP UI/BFF
  │
  ├─ classify request (taskType + documentType + parameters)
  │
  ▼
NYV Gateway `/api/nv/orchestrate`
  │
  ├─ pin agent ──────────────── DOCUMENT_TYPE_AGENT_PIN (20 types → A-001/A-004/A-005/A-006/A-047/A-048)
  ├─ adaptive router ────────── `-fast` → specialist; `legal-draft` → Queen async
  ├─ load structure template ── INDIAN_DRAFT_STRUCTURE_CHECKLIST[documentType] OR buildLegalChatStructurePrompt()
  ├─ inject memory L3 ───────── matterId / sessionId / mem0 recall (when enabled)
  ├─ inject RAG ─────────────── NYS caselaw/statutes; skipped doc-less on `-fast` per NV-FAST-*-NORAG-001
  │
  ▼
System prompt stack (layers, bottom → top)
  §0 Security constitution (registry)
  → Agent §1 identity + §2 mandate (layered L1)
  → SME overlay (buildUniversalLegalIntelligenceOverlay)
  → documentType family checklist (formatIndianDraftStructureChecklist)
  → jurisdiction pack (BNS/BNSS/BSA, forum context, BNSS applications)
  → memory + RAG context blocks (user turn adjunct)
  │
  ▼
User prompt (+ parameters JSON, instruction, CNR/matter fields)
  │
  ▼
Safety ring (executeWithFullSafetyRing)
  PII redact → compliance → hallucination check → citation verify → CoT (when earned)
  │
  ▼
LLM tier
  `-fast` paths: Haiku 4.5 (draft/chat); token budget from DRAFT_LENGTH_REGISTRY
  counsel path: Opus 5 / Queen multi-agent (70–94s sync)
  │
  ▼
Post-process gates
  applyCitationPropositionSanitize (Hanuman sir: no date-only cites, no Bhajan Lal stretch)
  applyFastDeliveryPolish / applyDraftCompletionPolish (prayer, verification, closure)
  applyLegalResponseFormatting (headings, disclaimer)
  │
  ▼
Response envelope
  draftQuality (reviewRecommended, placeholders, voiceOk, structureMarkers)
  attestationRequired / courtDocFieldBlock (partner contract §J)
```

**Hanuman sir review patterns (mandatory in prompts + gates):**

| Pattern | Prompt rule | Post-gate |
|---------|-------------|-----------|
| Placeholder discipline | `[[PLACEHOLDER: …]]` only; never invent parties/FIR/sureties | `draftQuality.placeholderCount` |
| Citation stretch | Proposition must match holding; no cross-applied Bhajan Lal categories | `applyCitationPropositionSanitize` |
| Disclosure | Quash/criminal: other petitions clause | Checklist in `criminal_petition` |
| Date-only citation | Never "judgment dated DD.MM.YYYY" without case name | `CITATION_PROPOSITION_PROMPT_RULE` |

---

## B. Per request-type matrix (ALL NSP surfaces)

| taskType | Pinned agent | Structure template | Mandatory checklist source | Citation rules | Output | LLM tier | Path |
|----------|--------------|-------------------|---------------------------|----------------|--------|----------|------|
| `legal-draft-fast` | A-004/A-005/A-006/A-001 per `documentType` | `INDIAN_DRAFT_STRUCTURE_CHECKLIST` | `nv-indian-draft-structure-registry.ts` | CITATION_PROPOSITION + no fabricate | Markdown pleading | Haiku 4.5 | specialist sync/stream |
| `doc-draft-fast` | same + RAG on `documentText`/`ragDocumentIds` | same + doc-grounded facts | same | cite retrieved doc + corpus | Markdown | Haiku 4.5 | specialist |
| `legal-draft` | Q-001 + leaf (A-004) | `indiaStructureFor(family)` + checklist | same | full citation verify | Markdown paper-book | Opus 5 | Queen async 600s |
| `legal-chat-fast` | A-047/A-048 (subject-ranked) | `buildLegalChatStructurePrompt()` | overlay § chat | retrieved only; SOURCES CONSULTED | Markdown counsel brief | Haiku 4.5 | specialist |
| `legal-chat` | A-047 or Q-001 if earned | chat structure + 7 headings | overlay full | same | Markdown | Haiku/Opus | specialist/Queen |
| `legal_research` | A-048/A-051 | research mode + chat structure | overlay | SCC/AIR adjacent to name | Research brief | Haiku + RAG | specialist |
| `statute_lookup` / `statute-research` | A-047 | compact legal core + statute mapping | BNSS pack if matched | statute text from NYS plane | JSON/Markdown | Haiku FAQ / RAG | specialist; zero-cost FAQ when hit |
| `caselaw-research` | A-048 | research + SOURCES CONSULTED | overlay | NYS metadata cites | Brief | Haiku + RAG | specialist |
| `contract_review` | A-025 | analysis mode + ICA/DPDP checklist | overlay analysis | clause-level, no US templates | Scored review | Haiku/Opus | specialist |
| `citation_check` | A-025 + safety.citation-verify | verification intent | proposition gate | verify or [CITATION REQUIRED] | Report | Haiku | specialist |
| CNR resolve → orchestrate | — (API) + matter params | forum context injection | `formatForumContext` | N/A | parameters merge | N/A | sync 60s + draft |
| template flows | templates.generate | catalog fill (not freeform) | template schema | N/A | filled doc | Haiku | capability leaf |
| Queen counsel (async) | Q-001 swarm | full family skeleton + checklist | all layers | full safety ring | counsel-grade | Opus multi | poll worker |

### All 20 `documentType` values (`legal-draft-fast`)

| documentType | Agent | Token default (medium) |
|--------------|-------|------------------------|
| `bail_application` | A-004 | 8,500 |
| `criminal_petition` | A-004 | 15,000 |
| `writ_petition` | A-004 | 25,000 |
| `petition_application` | A-004 | 13,000 |
| `interlocutory_application` | A-004 | 9,500 |
| `civil_suit_plaint` | A-004 | 30,000 |
| `written_statement` | A-004 | 30,000 |
| `rejoinder` | A-004 | 15,000 |
| `divorce_petition` | A-004 | 21,000 |
| `written_arguments` | A-004 | 25,000 |
| `final_arguments` | A-004 | 40,000 |
| `legal_notice` | A-005 | 8,500 |
| `reply_legal_notice` | A-005 | 10,000 |
| `affidavit_simple` | A-006 | 4,500 |
| `affidavit_case` | A-006 | 9,000 |
| `counter_affidavit` | A-006 | 21,000 |
| `simple_agreement` | A-001 | 21,000 |
| `complex_agreement` | A-001 | 80,000 (chunked) |
| `legal_opinion` | A-047 | 21,000 |
| `case_summary` | A-048 | 8,000 |

---

## C. Draft structure templates (Indian counsel acceptable)

Detailed mandatory sections live in code: `INDIAN_DRAFT_STRUCTURE_CHECKLIST` (`nv-indian-draft-structure-registry.ts`). Summary by major type:

### Quash / criminal petition (`criminal_petition`)

Cause title → list of dates → memo of parties → facts (numbered) → grounds (numbered; rebut omnibus) → **disclosure other petitions** → prayer → verification → vakalatnama.

### Bail (`bail_application`)

Cause title → FIR synopsis (BNS/BNSS) → showeth/facts → grounds (no surety in prayer) → prayer ("terms Court deems fit") → verification. **Surety rule:** post-grant only (`BAIL_SURETY_RULE`).

### Legal notice (`legal_notice`)

Letterhead → parties → facts → legal basis → demand → consequence → timeline → signature.

### Writ (`writ_petition`)

Cause title → synopsis/list of dates → memo of parties → showeth/facts → grounds (A/B/C maintainability/rights/prejudice) → affidavit ref → prayer → verification → vakalatnama.

### Affidavit (`affidavit_case` / `affidavit_simple`)

Deponent block → numbered averments → verification clause → oath.

### Agreement (`simple_agreement` / `complex_agreement`)

Recitals → definitions → operative clauses → boilerplate (India law, arbitration seat) → execution/stamp placeholders.

Extended families (18 doc families in `nv-legal-drafting-prompt.ts`): SLP paper-book, review petition scope, execution petition Order XXI, caveat s.148A, written statement Order VIII, counter-affidavit, rejoinder traverse, interim application Order XXXIX.

---

## D. Chat / intelligence structure

**Mandatory flow** (`buildLegalChatStructurePrompt`):

1. Issue identification → short answer  
2. Applicable law & ingredients (BNS/BNSS/BSA post–1 Jul 2024)  
3. Analysis (reasoned, not scratchpad dump)  
4. Options & trade-offs  
5. Risks & caveats  
6. Next steps / prayer  
7. **SOURCES CONSULTED** — case name + citation + proposition supported  

**Citation discipline:** refuse to fabricate; `[CITATION REQUIRED]` when uncertain; never date-only cites (Hanuman sir gate).

---

## E. System prompt architecture (layers)

| Layer | Source | When injected |
|-------|--------|---------------|
| §0 Security | Registry XML `section_0_security_constitution` | Every agent call |
| Agent persona | Registry §1 identity + §2 mandate | Layered L1 via `assembleLayeredAgentSystemPrompt` |
| SME overlay | `buildUniversalLegalIntelligenceOverlay` | All paths unless `NYV_LEGAL_INTEL_FORCE=0` |
| Drafting SME | `buildLegalDraftSystemPrompt` | `taskKind=draft` or partner draft taskTypes |
| Chat structure | `buildLegalChatStructurePrompt` | chat/advice/research/general |
| documentType checklist | `formatIndianDraftStructureChecklist` | When `documentType` or partner draft taskType |
| document family | `indiaStructureFor(inferDraftDocFamily(...))` | India drafts |
| Jurisdiction pack | INDIA_CORE + BNSS overlay + forum context | `jurisdiction=IN` |
| Memory L3 | mem0 / tiered recall | `enableMemory` + matterId |
| RAG context | NYS plane excerpts | `enableRAG` (skipped doc-less fast) |
| User turn | prompt + parameters JSON | Always |

Merge policy: `mergeLegalIntelligencePrompt` / `preferLegalIntelligenceSystemPrompt` — overlay never dropped for longer generic registry.

---

## F. Gap analysis: global best vs needs focus

| Area | Current /10 | Global best benchmark | Gap | Priority | Fix |
|------|-------------|----------------------|-----|----------|-----|
| India draft structure | **9** | Per-type mandatory sections in every draft prompt | Minor: complex_agreement chunk cohesion | P2 | Chunk orchestrator prayer merge |
| Citation proposition gate | **8** | Automated proposition↔holding verify | Post-hoc sanitize only, no retrieval verify loop | P1 | Wire `intelligence.statute-verify` to gate |
| Agent specialization | **6** | Distinct capabilities per research agent | 18 research agents share same capability[] | P1 | Registry capability differentiation (not prompt-only) |
| Chat structure compliance | **8** | 100% answers with SOURCES CONSULTED | Model sometimes omits heading | P1 | Post-process heading stub (exists for thin answers) |
| `-fast` latency | **7** | 5–8s cold draft | LLM generation dominates (~10–23s historical) | P1 | Token tier + cache warming (partially done) |
| CNR → draft continuity | **6** | Matter memory auto-injected on CNR autofill | Manual parameters merge | P1 | NSP: always pass CNR fields in orchestrate body |
| Queen vs specialist docs | **7** | Single documented truth | Historical doc tension | P2 | PLATFORM-STATUS sync (done in §J) |
| MCP executable gap | **5** | 556 catalog = runnable | 134 executable | P2 | Partner MCP allowlist |
| Template vs freeform draft | **9** | INTENT `draft` ≠ `templates.generate` | Fixed NV-LEGAL-DRAFT-BEST-001 | — | Maintained |
| Hanuman review automation | **7** | SME rubric → auto flag | Manual review for stretch/placeholder | P1 | Expand `draftQuality.structureMarkers` |

---

## G. Implementation roadmap

### P0 (NYV — shipped 2026-09-12, NV-INDIAN-STRUCTURE-001)

| Item | Owner | Status |
|------|-------|--------|
| `INDIAN_DRAFT_STRUCTURE_CHECKLIST` all 20 types | NYV | **DONE** |
| Wire into `buildLegalDraftSystemPrompt()` | NYV | **DONE** |
| `buildLegalChatStructurePrompt()` + overlay | NYV | **DONE** |
| Orchestrate `documentType` → overlay | NYV | **DONE** |
| INTENT map: draft, legal-chat, statute/caselaw-research, contract_review, citation_check | NYV | **DONE** |
| Unit tests checklist injection | NYV | **DONE** |
| This master doc | NYV | **DONE** |

### P1 (next sprint)

| Item | Owner |
|------|-------|
| NSP: always send `documentType` on Describe & Generate | NSP |
| NSP: CNR resolve → merge into orchestrate `parameters` | NSP |
| NYV: `draftQuality.structureMarkers` probe bail + writ_petition | NYV |
| NYV: citation verify loop on draft output | NYV |
| Registry: differentiate A-047 vs A-048 capabilities | NYV |

### P2 (backlog)

| Item | Owner |
|------|-------|
| MCP executable expansion for partner | NYV |
| Hindi/regional language draft structure variants | NYV + NSP |
| Automated SME rubric (Hanuman patterns) in CI eval | NYV |

---

## Code references

| Module | Path |
|--------|------|
| Structure checklists | `src/services/nv-indian-draft-structure-registry.ts` |
| Draft system prompt | `src/services/nv-legal-drafting-prompt.ts` |
| Chat/intel overlay | `src/services/nv-legal-intelligence-overlay.ts` |
| Citation gate | `src/services/nv-citation-proposition-gate.ts` |
| Agent pin map | `src/services/nv-document-type-agent-pin.ts` |
| Token budgets | `src/config/nv-draft-length-registry.ts` |
| INTENT bindings | `src/orchestration/capability-manifest.ts` |
| Queen hints | `src/orchestration/nv-queen-orchestrator.ts` `analyzePrompt()` |
| Tests | `tests/unit/nv-indian-draft-structure-registry.test.ts` |

---

## Top 5 strengths (already global best)

1. **India-first statute mapping** — BNS/BNSS/BSA mandatory in every overlay; IPC/CrPC blocked for post–Jul 2024 matters.  
2. **Layered prompt merge** — registry identity preserved; SME overlay never stripped by length-prefer.  
3. **Document-type agent pin** — 20 registry keys → correct specialist (A-004 pleading, A-005 notice, etc.).  
4. **Citation proposition gate** — Hanuman sir patterns codified (date-only, Bhajan Lal stretch, [CITATION REQUIRED]).  
5. **Partner `-fast` architecture** — explicit taskType aliases, specialist path, draftQuality envelope, stream TTFB ~42ms.

## Top 5 focus areas

1. **Structure marker verification in production** — probe bail + writ_petition outputs for checklist sections.  
2. **CNR → orchestrate parameter continuity** — matter context should flow without NSP re-entry.  
3. **Research agent capability differentiation** — prompt-only specialization insufficient for routing honesty.  
4. **Cold draft latency** — LLM token generation still above 5–8s SLA target.  
5. **Automated citation proposition verification** — sanitize is post-hoc; need retrieval-backed verify before envelope.
