# Nyayavigya Orchestration Map (v5.0.0)

> Audience: platform engineers, partner SDK integrators, Queen/agentic maintainers.  
> Authority: `src/orchestration/capability-manifest.ts` + Queen (`nv-queen-orchestrator.ts`).  
> Roadmap source: `documents/roadmap-pending/orchestrate-services-into-agentic-framework.md`.

## 1. Request path (caller → intelligence)

Every authenticated call to `POST /api/nv/orchestrate` (and `/orchestrate/stream`) follows this pipeline:

```
1. dualSdkOrJwt          → SDK key / JWT identity + sdkContext
2. partnerIndiaScope     → NSP/NYM force jurisdiction=IN
3. consentGate           → purpose=ai_processing
4. Credit / rate check   → nv-ai-credit-enforcer (specialist/doc paths)
5. AdaptiveRouter        → complexity × risk × taskType → queen | specialist | doc-pipeline
                           partnerSyncLean → specialist only (unchanged)
6. Language Step-0       → script detect (hi/ta/te/… ) when caller omits language
7. Memory fan-in         → Queen path: fanInMemoryRecall
8. Skills / capabilities → skills ∩ tier; doc-pipeline leaf invoke when applicable
9. Task decomposition    → Queen: P01–P22 / TOP-10; specialist: single-agent
10. Parallel / DAG       → Queen concurrency-governor + circuit-breaker
11. CoT / maker-checker  → scaled by AdaptiveRouter risk/depth (not lean Queen CoT)
12. QualityEnvelope      → fail-closed if mandatory gates skipped (prod / NYV_QUALITY_ENVELOPE_FAIL_CLOSED=1)
13. Safety ring          → PII + compliance + hallucination + citation + bias
14. Response contract    → curated sections + CoT + citations + cost + routing
15. Metering + audit     → usage + hash-chain
```

**Mandatory on both Queen and specialist (never skip):** identity, consent/credits, task classify,
jurisdiction prompts, PII, compliance pre-check, RAG/grounding attempt, LLM route+budget,
hallucination, citation, bias, response format, metering/audit.
Lean skips only multi-agent Queen / Queen CoT / Queen maker-checker.

## 2. Capability manifest (SSoT)

| Item | Location |
|------|----------|
| TypeScript SSoT | `src/orchestration/capability-manifest.ts` |
| Snapshot | `src/orchestration/capability-manifest.snapshot.json` |
| Tool registry bind | `NvProtocolRegistryService.initializeFromManifest()` at boot |
| Skills bind | `SkillsSystemService.getCapabilitiesForContext()` |
| SDK tier surface | `nv-sdk-auto-initialization.ts` → `capabilitiesForTier()` |

**Count (2026-07-29):** ~142 live leaves with real factories (Wave B6 mesh + Wave B7 extended).  
Partner **MCP sell surface** remains curated **~125** tools (not the ~556 catalog stubs).

Regenerate snapshot:

```bash
cd nyayavigya-platform-312 && npm run manifest:snapshot
```

## 3. Parallel execution policy

Applied on every `capabilityManifest.invoke()`:

- Per-tenant + per-provider (category) slots via `concurrency-governor`
- Retry + circuit breaker via `circuit-breaker` (`runWithRetryAndBreaker`)
- DAG plans: context budget, fail-fast vs continue-on-error per node, fan-in synthesis
- Override: request-level policy fields documented on capability descriptors (`costClass`, `safetyClass`, patterns)

## 4. Middleware stack (uniform on Queen plans)

| Stage | Module |
|-------|--------|
| Memory recall | `nv-memory-fan-in.ts` + middleware |
| RAG grounding | Auto-RAG / neural rerank flags (`FLAG_DEFAULT_ON_IN_NON_DEV`) |
| Safety | `orchestration-middleware.ts` + safety ring |
| HITL | risk-class escalation |
| Metering / audit | usage + hash-chain |

Lite / explicit lean sync may skip Queen; RAG/citation gates still default ON for partners.

## 5. Per-tier / per-platform surface

| Platform | Jurisdiction | AdaptiveRouter default |
|----------|--------------|------------------------|
| NSP, NYM | **IN locked** | Hybrid: Queen on complex/research/filing; doc-pipeline on OCR/parse; specialist otherwise |
| NSI, NSA, NSM, NSPM, NYV | request → profile → tenant → DEFAULT | Same hybrid |
| JRX | multi (US-oriented) | Queen on complex; not forced for simple |
| Console JWT | as requested | Complexity-driven |

**Lean:** `partnerSyncLean` / `X-NYV-Partner-Sync-Lean: 1` + agentKey + sync taskType → **specialist only** (quality gates ON).

**Agents:** Runtime registry loads **only** `Nyayavigya-Legal-registry-Default.json` → **164** agents (`initializeAgentRegistry`). Archive/forensic mode is opt-in (`NV_REGISTRY_FORENSIC_MODE=1`).

## 6. Patterns & topologies

- Pattern map: `nv-pattern-execution-map.ts` (P01–P22 hooks)
- TOP-10 soak: `nv-topology-algorithms.ts` + unit tests
- Swarm / DAG / CoT / collective: Queen modes + smoke suite under `tests/orchestration/`

## 7. Multitenant storage (logical — shared EC2/S3 today)

Canonical key builder: `StoragePathBuilder` in `nyv-document-storage-service.ts`

```
orgs/{orgId}/{platform}/users/{userId}/documents/{docId}/{fileName}
orgs/{orgId}/{platform}/users/{userId}/parsed/{docId}/...
orgs/{orgId}/{platform}/users/{userId}/embeddings/{docId}/...
ecosystem-edj/{platform}/{orgId}/{docId}/{fileName}
```

SDK RLS bind: `req.withSdkTenant` → `nv.platform_id` + `nv.customer_org_id`.

## 8. Worked examples

### Single-agent (lean opt-in)

`POST /orchestrate` with `agentKey`, `taskType=extract`, `partnerSyncLean=true` → safety ring only, no Queen.

### Full Queen (AdaptiveRouter)

`POST /orchestrate` with NSP SDK key + complex legal research prompt → AdaptiveRouter `queen` → memory → RAG → pattern → agents from 164 → CoT → maker-checker → QualityEnvelope → curated contract.

### Doc-pipeline

`POST /orchestrate` with `taskType=ocr|parse|embed|classify|summarize|compare` → AdaptiveRouter `doc-pipeline` → capability leaf (when args present) or specialist with doc system prompt → QualityEnvelope → curated contract.

### Mesh leaf

Prompt containing “e-filing” / “playbook” / “digital twin” / “automateai” / “bmad” / “web search” / “OCR” → `INTENT_CAPABILITY_MAP` + `analyzePrompt` hints → Queen `bindCapabilitiesToSubtasks` → `capabilityManifest.invoke`. **NV-MESH-001:** factory alone is not enough — INTENT + hint required (`npm run guardrail:intent-mesh`).

### Agent tools

Registry `tools` / `mcpToolsAllowed` → `nv-agent-tool-bridge` → prompt directive + cost-capped pre-invoke (skips duplicate RAG).

### Stream parity

`POST /orchestrate/stream` uses the same AdaptiveRouter decision as sync (credit gate first); doc-pipeline/specialist short-path when not Queen.

## 9. Smoke

```bash
cd nyayavigya-platform-312
npm run guardrail:intent-mesh
npx vitest run tests/unit/nv-adaptive-router.test.ts tests/unit/nv-agent-tool-bridge.test.ts
npx vitest run tests/orchestration/smoke.test.ts -t "Wave B"
```

## 10. Honest boundaries

- Curated MCP **120–140** live; remaining catalog IDs are partner-hidden (501 if forced).
- Caselaw semantic embed remains ops-backfill (~3–7% of corpus).
- Provider token streaming through full safety ring is still a stretch goal; SSE lifecycle + AdaptiveRouter path events are live.
- Multi-AZ / SOC2 Type II / sealed SC-HC forms are **not sold**.
- Doc A/B compare uses `sdk.document-pipeline`; statute IPC/BNS compare uses `nyaya-tools.compare`.