# Legal Agent Registry + Bedrock Model + Post-LLM Intelligence Audit

**Date:** 2026-09-02T14:00:00Z  
**Scope:** NYV (`nyayavigya-platform-312/`) — NSP/NYM partner paths, core legal agents, model routing, output refinement  
**Companion:** [`PARTNER-AI-INTEGRATION-AND-PROMPT-ENGINEERING-2026-09-02.md`](./PARTNER-AI-INTEGRATION-AND-PROMPT-ENGINEERING-2026-09-02.md)

---

## Executive summary

| Area | Status | Action |
|------|--------|--------|
| **Agent registry (164 agents)** | Full 23-section §0–§22 structure on all focus agents | **Defer** JSON edits — runtime overlays + post-processors cover gaps |
| **Bedrock routing** | Correctly wired for `-fast` (Haiku-first) and counsel (Opus-first) | **No change** — recommend only |
| **Post-LLM intelligence** | **Not pass-through** — sanitize, format, structure-attach, safety ring | **Defer** new processors; document §17 partner-mode in registry next sprint |

---

## 1. Agent registry audit — core legal agents

### 1.1 Registry SSoT

| Layer | Path |
|-------|------|
| Runtime | `config/agent-registries/Nyayavigya-Legal-registry-{Default,IN,UK,EU,US,GC,SG}.json` |
| Loader | `src/config/agent-registry-loader.ts` |
| Prompt assembly | `src/services/nv-agent-prompt-bundle.ts` |
| Aliases | `config/agent-registries/agent-id-aliases-v5.1.0.json` |

**164 agents** per jurisdiction file. Default always loaded; `NV_PRIMARY_JURISDICTION` merges one overlay.

### 1.2 Focus agents (most-used partner + console paths)

| Agent ID | Name | Partner / console use | taskType aliases |
|----------|------|----------------------|------------------|
| **A-004** | Pleading Drafting Agent | NSP Describe & Generate, bail/BNSS apps | `legal-draft`, `legal-draft-fast`, `doc-draft-fast` |
| **A-001** | Contract Drafting Agent | Commercial drafts, Word add-in | `legal-draft`, contract flows |
| **A-047** | Statutory Research Agent | Statute lookup, instant search companion | `legal-research`, `legal-chat`, counsel Queen leaf |
| **A-048** | Case Law Research Agent | Caselaw research, hybrid search answers | `legal-research`, `legal-chat-fast` (with RAG) |
| **A-051** | Precedent Research Agent | Precedent chains, treatment readout | Queen research leaves |
| **A-061** | Criminal Law Research Agent | Bail/FIR/BNS queries | NYM citizen chat, NSP criminal |
| **Q-001** | Queen Orchestration Engine | Console legal chat, counsel-grade orchestrate | `legal-draft` (bare), `legal-chat` |
| *(no dedicated agent)* | Patra Mitra | Doc Q&A after docparse | `/api/nv/v1/sdk/patra-mitra/*` → specialist + doc context |
| *(no dedicated agent)* | Instant Search | Statute/caselaw SERP | `nyv.instantSearch.*` → knowledge plane (minimal LLM) |
| *(no dedicated agent)* | CNR Resolve | Case lookup | `/api/nv/v1/sdk/cnr/*` → NYS (no LLM on hit) |

### 1.3 System prompt quality (23-section structure)

Audit of focus agents confirms **all 23 sections present**: §0 security constitution through §22 version/SLM.

| Section | Quality | Gap |
|---------|---------|-----|
| §0 Security constitution | Strong — OWASP LLM Top 10, L1–L4 hierarchy | None |
| §4 Reasoning (IRAC / 10-step) | Present; L2–L4 depth varies by agent tier | Generic across research agents — acceptable via Queen decomposition |
| §6 Citation | Marker contract `[CITATION: …]` | Partners receive sanitized plain text; markers stripped in some paths |
| §17 Output format | **JSON envelope** `{ output, citations, disclaimer }` | **Mismatch:** partners expect markdown/plain `content`; unwrap in `nv-client-outcome-sanitize.ts` handles this post-LLM |
| §18 Quality checklist | Inherited base — citation verified, PII, bias, disclaimer | Does **not** mention post-LLM structure attach or `applyLegalResponseFormatting` |

**Prompt load-once (live):** Turn 1 = full L0 constitution; single-shot / Turn 2+ = L1 identity + mandate + selected operative sections (`nv-agent-prompt-bundle.ts`).

### 1.4 Runtime overlays (outside registry JSON)

These compensate for registry gaps without editing 164 × 7 JSON files:

| Overlay | File | When |
|---------|------|------|
| Legal intelligence | `nv-legal-intelligence-overlay.ts` | All safety-ring paths |
| Drafting SME rules | `nv-legal-drafting-prompt.ts` | Draft task kinds |
| Structure fill hint | `nv-legal-structure-attach.ts` | Pre-LLM overlay + post-LLM attach |
| Partner counsel sys | `nv-orchestration-routes.ts` | NSP/NYM when no client `systemPrompt` |
| Enhancement pipeline | `nv-prompt-enhancement-pipeline.ts` | All orchestrated paths |

Partner `-fast` doc-less: legal-intel overlay depth = **`micro`** (`nv-client.ts`).

### 1.5 Registry change recommendations

| # | Recommendation | Implement now? | Rationale |
|---|----------------|----------------|-----------|
| R1 | Add `intents: ["legal-draft", "legal-draft-fast"]` to **A-004**, **A-001** | **Defer** | INTENT map + Queen `analyzePrompt` already route by taskType; empty intents not blocking |
| R2 | Add `intents: ["legal-research", "legal-chat"]` to **A-047**, **A-048**, **A-051** | **Defer** | Same — mesh routing works via taskType + capability factory |
| R3 | §17 add **partner delivery mode** paragraph: "On `-fast` partner paths emit markdown in `output`; gateway unwraps JSON envelope" | **Defer** | Document-only win; unwrap already wired |
| R4 | §18 append: "Post-delivery: NV-LEGAL-STRUCTURE-ATTACH may append IRAC/Prayer skeletons; NV-LEGAL-FORMAT-001 adds disclaimers" | **Defer** | Reduces agent/human confusion in registry audits; no runtime change |
| R5 | Dedicated **Patra Mitra** agent stub (A-1xx) with doc-Q&A mandate | **Defer** | Patra path uses doc context + generic specialist; no quality regression observed |
| R6 | Differentiate **A-047 vs A-048** §4 reasoning (statute-first vs caselaw-first) | **Defer** | Queen leaf selection handles this; large diff for marginal gain |

**Verdict:** Registry JSON is structurally sound. **Recommend documenting R3–R4 in next registry maintenance sprint; do not bulk-edit JSON this release.**

---

## 2. Bedrock legal model matrix

Aligned with `src/config/nv-llm-routing-policy.ts`, `MODEL_CATALOG`, and **NV-FAST-SERVING-TIER-001**.

| Use case | Primary model | Fallback cascade | Why (accuracy · cost · latency) |
|----------|---------------|------------------|--------------------------------|
| **Fast chat / draft** (`*-fast` aliases) | `global.anthropic.claude-haiku-4-5-20251001-v1:0` | Nova 2 Lite → Nova Pro → Gemini 3.7 Flash → Sonnet 5 | Live probe: cold **~10.7s**, warm **~59ms** (LM cache). Haiku = best latency/$ for 4k-char drafts; quality sufficient for prayers/one-liners |
| **Doc-less chat-fast** | Haiku 4.5 | Gemini 3.7 Flash | RAG skipped (`NV-FAST-CHAT-NORAG-001`); same SLA cascade |
| **Counsel draft** (`legal-draft` bare) | `us.anthropic.claude-opus-5` | Opus 4.8 → Sonnet 5 → Sonnet 4.6 | Live cold **~73–107s**; Opus for paper-book depth, multi-section pleadings |
| **Research depth** (Queen / counsel chat) | `global.anthropic.claude-sonnet-5` | Opus 5 (escalation) → Gemini 3.7 Flash | Sonnet 5 = best interactive accuracy/speed for IRAC memos; Opus when Queen escalates |
| **Extract / summarize / classify** | `us.amazon.nova-pro-v1:0` | Nova 2 Lite | Task-class rails — not legal reasoning |
| **Console SME / maker-checker** | Sonnet 5 → Opus 5 | DeepSeek R1 (Bedrock) | Quality-first; CoT + multi-agent when enabled |
| **Partner premium escape** (`NYV_PARTNER_LEGAL_PREMIUM_FIRST=1`) | Direct Claude/Gemini before Bedrock | OpenRouter paid | Ops-only; default Bedrock-first for AWS credits |
| **Terminal fallback** | AgentZero | — | Sovereign always-on |

### Wiring verification

- `-fast` → `isSlaFastLegalRoute()` → `BEDROCK_SLA_FAST_LEGAL` (Haiku-first) ✅
- Bare `legal-draft` → `BEDROCK_CLAUDE_DEEP` + Opus lead ✅
- No misconfiguration found; **recommend only**.

---

## 3. Post-LLM agent intelligence pipeline

### 3.1 Question: pass-through or refined?

**Answer: Refined — not pass-through.** The gateway applies multiple post-LLM layers before partner `content` is returned.

### 3.2 Pipeline trace (order of execution)

```
LLM raw completion
  → unwrapAgentOutcomeEnvelope (JSON → plain output)
  → safetyPipeline.runPostProcessingPipeline (Steps 6–10: hallucination, citation verify, confidence)
  → applyLegalResponseFormatting (NV-LEGAL-FORMAT-001)
       · repairSplitBoldMarkers
       · normalize headings / pleading openers
       · India statute reminder (BNS/BNSS/BSA)
       · disclaimer attach
       · ensureIndiaCounselHeadings → attachStoredLegalStructure (IRAC / Prayer)
  → async parallel: hallucinationDetector, citationVerifier (non-blocking metadata)
  → sanitizeOrchestrationContentForClient (strip Queen chrome, thinking blocks, CoT preamble)
  → partner response assembly (nv-orchestration-routes.ts)
```

**Key files:**

| Step | File |
|------|------|
| Unwrap + sanitize | `src/utils/nv-client-outcome-sanitize.ts` |
| Safety post-ring | `src/services/safety-pipeline.ts` (`runPostProcessingPipeline`) |
| Legal formatting | `src/services/nv-legal-response-format.ts` |
| Structure attach | `src/services/nv-legal-structure-attach.ts` |
| Orchestration assembly | `src/routes/nv-orchestration-routes.ts` |
| Queen synthesis format | `src/orchestration/nv-queen-orchestrator.ts` |

### 3.3 What gets BETTER for end users

| Enhancement | Active on partner `-fast`? | Effect |
|-------------|---------------------------|--------|
| JSON envelope unwrap | ✅ | Partners see markdown, not `{ agentId, output }` |
| PII / orchestration chrome strip | ✅ | No Queen/swarm/thinking leaks |
| Hallucination + citation verify | ✅ (async) | Metadata + warnings; does not rewrite body |
| IRAC / Prayer skeleton attach | ✅ (India counsel/draft) | Appends **missing** headings from stored templates — no extra LLM pass |
| Disclaimer attach | ✅ | Advocate / information disclaimers |
| Markdown polish (bold, spacing) | ✅ | Readability |
| Self-RAG regeneration | ❌ on `-fast` | Pro-tier research only |
| CoT reasoning capture | ❌ on `-fast` | Forced off (`NV-FAST-COT-OFF-001`) |
| Confidence scorer | ❌ on `-fast` | Skipped for latency |
| Second LLM "enhance output" pass | ❌ | By design — structure attach replaces this |

### 3.4 Gaps and recommended enhancements

| Gap | Severity | Recommendation |
|-----|----------|----------------|
| §17 JSON envelope vs partner markdown | Low (unwrap works) | Registry doc R3; optional `deliveryFormat: markdown` field |
| Structure attach placeholders visible to users | Medium | Future: thin Haiku pass to fill `[Orchestrator skeleton…]` slots on counsel path only |
| `-fast` skips confidence metadata | Low | Acceptable for SLA; document in partner guide |
| Patra Mitra / Instant Search bypass full agent registry | Low | Optional dedicated agents (R5) for observability only |
| Citation verify async — body not auto-corrected | Medium | Consider inline `[unverified]` tags on flagged cites (safety-pipeline enhancement) |

---

## 4. Cross-reference — partner integration

See [`PARTNER-AI-INTEGRATION-AND-PROMPT-ENGINEERING-2026-09-02.md`](./PARTNER-AI-INTEGRATION-AND-PROMPT-ENGINEERING-2026-09-02.md) §A–E for path-by-path prompt pipeline crosscheck and latency evidence.

---

*Generated 2026-09-02T14:00:00Z · Code audit + EC2 probe SSM `74ff4861` · Deploy `d67dce2c5`*
