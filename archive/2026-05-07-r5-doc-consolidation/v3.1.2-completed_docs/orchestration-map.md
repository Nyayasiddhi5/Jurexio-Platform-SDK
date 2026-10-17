---
status: completed
version: 3.1.2
superseded_by: null
last_verified: 2026-04-25
---
# Nyayavigya Orchestration Map

**Doc id:** `NYV-DOC-ORCH-MAP-001`
**Owner:** Platform Engineering
**Status:** Authoritative — keep in sync with `src/orchestration/capability-manifest.ts`

This document is the human-readable mirror of the runtime capability manifest.
Anything documented here must exist in the manifest, and vice-versa. The
manifest is the single source of truth for:

- Queen Orchestrator (decomposition + dispatch)
- `NvToolExecutionService.executeFromManifest`
- `SkillsSystemService.getCapabilitiesForContext`
- `SDKAutoInitializationEngine.wireOrchestrationCapabilities`
- DAG Orchestration Service (`dagOrchestrationService.bindCapabilityManifestExecutor`)
- Orchestration Middleware (memory + RAG + safety + HITL + metering + audit)

---

## 1. Architectural Wiring

```
                    ┌──────────────────────────────────────┐
                    │   Capability Manifest (SSoT)         │
                    │   src/orchestration/capability-…ts   │
                    └──────────────────────────────────────┘
                                   ▲      ▲      ▲      ▲
                                   │      │      │      │
        ┌──────────────────────────┘      │      │      └────────────────────┐
        │                                 │      │                           │
┌───────────────┐                  ┌──────────────┐              ┌──────────────────┐
│ Queen         │                  │ NvToolExec   │              │ Skills System    │
│ Orchestrator  │                  │ (manifest    │              │ (per-tier        │
│ (decompose +  │                  │  executor)   │              │  capability      │
│  dispatch)    │                  └──────────────┘              │  surface)        │
└───────────────┘                         ▲                       └──────────────────┘
        │                                 │                                ▲
        ▼                                 │                                │
┌───────────────┐    bindExecutor   ┌──────────────┐               ┌──────────────┐
│ DAG           │◄──────────────────│  capability  │◄──────────────│ SDK Auto-    │
│ Orchestration │   per-tier policy │  Manifest    │   per-tier    │ Initialization│
│ Service       │   (concurrency)   │   Executor   │   surface     │ Engine        │
└───────────────┘                   └──────────────┘               └──────────────┘
        ▲
        │ pluggable executor
        │
┌────────────────────────────────────────────────────────────────────────────┐
│ Orchestration Middleware (uniform, all patterns)                            │
│ pre :  consent → memory recall → RAG enrich → safety pre-check              │
│ post:  hallucination → bias → HITL gate → memory persist → metering → audit │
└────────────────────────────────────────────────────────────────────────────┘
```

### Jurisdiction precedence (NEVER violate)

1. **Explicit** request `jurisdiction` field (highest precedence)
2. **User** profile jurisdiction (resolved upstream of Queen)
3. **Tenant** default jurisdiction
4. **`DEFAULT`** (`'IN'` for the current build)

`agent.jurisdiction` is **never** consulted by the dispatcher. The capability
manifest only declares `supportedJurisdictions` for filtering — never for
override.

---

## 2. Capability Categories

| Category              | Tier visibility                                        | Notes |
|-----------------------|--------------------------------------------------------|-------|
| `memory`              | All tiers                                              | tiered recall + store |
| `rag`                 | All tiers                                              | best-effort enrich |
| `skills`              | All tiers                                              | activation + tool list |
| `safety`              | `lite`+ for hallucination, `mitra`+ for bias / PII     | fail-loud in prod |
| `hitl`                | `mitra`+                                               | gates high/critical risk |
| `metering`            | All tiers                                              | per-call usage log |
| `tools`               | All tiers                                              | sandboxed executor |
| `document-pipeline`   | `mitra`+                                               | parsing + chunking |
| `vector`              | `mitra`+                                               | embed + similarity |
| `streaming`           | `mitra`+                                               | SSE sessions |
| `protocol`            | `enterprise`+                                          | ROMA / MCP / A2A |

---

## 3. Per-Tier Execution Policy

Source: `src/orchestration/orchestration-policy.ts`

| Tier         | Max concurrent nodes | Context budget | Failure policy       | Max failed nodes | Per-node timeout |
|--------------|----------------------|----------------|----------------------|------------------|------------------|
| `lite`       | 2                    | 32 K tokens    | fail-fast            | 0                | 20 s             |
| `mitra`      | 4                    | 128 K tokens   | partial-tolerate     | 1                | 45 s             |
| `enterprise` | 8                    | 500 K tokens   | partial-tolerate     | 3                | 90 s             |
| `sovereign`  | 16                   | 1.5 M tokens   | best-effort          | 8                | 180 s            |
| `white-label`| 8                    | 500 K tokens   | partial-tolerate     | 3                | 90 s             |

The DAG Orchestration Service consumes this policy via `setTier(tier)` and uses
`runWithConcurrency` for every level.

---

## 4. Replaced Stub Seams

| Module                                     | Was                                | Now                                                                               |
|--------------------------------------------|-------------------------------------|-----------------------------------------------------------------------------------|
| `services/agent-orchestration.ts`          | Returns `{ status: 'completed' }`   | Delegates to Queen Orchestrator + manifest middleware fallback                    |
| `services/hierarchical-task-allocator.ts`  | Returns `{ assignedAgent: 'default' }` | Real agent selection from registry + coalition formation via hierarchy coordinator |
| `services/database-system.ts`              | Returns `[]` from `query`           | Wraps drizzle/neon pool with `getDatabase().execute(query, params?)`             |
| `services/document-processor.ts`           | Returns `{ ok: true }`              | Re-exports `NyayavignyaDocumentProcessor`                                         |
| `services/vector-database.ts`              | Returns `[]` from `query`           | Re-exports `NyayavignyaVectorDatabase`                                            |
| `services/openrouter-universal-gateway.ts` | Throws on `chat()`                  | Real `selectOptimalModel(req, ctx, strategy)` over a maintained model catalog     |
| `services/circuit-breaker.ts`              | Already real                        | (unchanged — already a real re-export)                                            |
| `services/redis-client.ts`                 | Already real                        | (unchanged — already a real re-export)                                            |

---

## 5. Adding A New Capability

1. Pick a stable kebab-case id under one of the listed categories.
2. Add a `CapabilityDescriptor` entry to `CAPABILITIES` in
   `src/orchestration/capability-manifest.ts`.
3. Implement the `factory` so it returns a real bound instance with an
   `invoke(input, ctx)` method. **Do not** silently swallow errors.
4. Add a row in §2 above and (if it changes execution semantics) §3.
5. Add a test in `tests/orchestration/smoke.test.ts`.

That's it — Queen, the tool registry, the skills system, and the SDK auto-init
will all pick up the capability automatically the next time they refresh.

---

## 6. Smoke Tests

`tests/orchestration/smoke.test.ts` exercises five orchestration patterns
end-to-end against the manifest:

1. **Sequential** — single capability invocation
2. **Parallel** — multi-capability `runWithConcurrency`
3. **DAG** — multi-level execution with the bound manifest executor
4. **Swarm** — best-of-N parallel with synthesis fan-in
5. **Hierarchical** — coalition formation + delegated invocation

Run: `pnpm vitest tests/orchestration/smoke.test.ts`
