# NV Orphan Disposition Matrix

Generated: 2026-05-11T01:29:02.893Z
Total orphans: **24**

## Tally

| Disposition | Count | Meaning |
|---|---:|---|
| **WIRE-ROUTE** | 0 | Has Express router → mount under additive /api/nv/... path (zero v5 impact) |
| **WIRE-CHAIN** | 0 | Middleware function → insert into the /api/nv/* safety-ring chain |
| **WIRE-INTERNAL** | 0 | Service/engine class → import from a reachable service (no new HTTP) |
| **MERGE-DUPLICATE** | 0 | Name collides with a wired file → merge or archive as older variant |
| **KEEP-BARREL** | 15 | Pure re-export barrel — no wiring needed, intentional |
| **KEEP-CLI** | 3 | Test/seed/CLI entry — intentionally not HTTP-wired |
| **KEEP-CONTRACT** | 3 | Microservice contract spec — used at deploy/contract-test time |
| **KEEP-TEST** | 0 | Type-test or compile-time-only test — intentionally not in runtime graph |
| **KEEP-DYNAMIC-IMPORT** | 3 | Consumed via await import() — invisible to static BFS auditor |
| **REVIEW-DELETE** | 0 | Matches user-flagged temporary surface (video/ppt/voiceover) — confirm |
| **REVIEW-MANUAL** | 0 | No heuristic matched — needs human classification |

## Per-orphan rows (grouped by disposition)

### KEEP-BARREL (15)

| File | Lines | Exports | Note |
|---|---:|---|---|
| `src/orchestration/index.ts` | 2 | — | allowlisted: pure re-export barrel |
| `src/packages/analytics/index.ts` | 39 | analyticsPackageInfo | allowlisted: pure re-export barrel; no src/index.ts consumer yet but intentional package surface |
| `src/packages/i18n/index.ts` | 25 | i18nPackageInfo | allowlisted: pure re-export barrel |
| `src/packages/protocols/index.ts` | 29 | — | allowlisted: pure re-export barrel |
| `src/packages/security/index.ts` | 50 | securityPackageInfo | allowlisted: pure re-export barrel |
| `src/packages/tools/code/index.ts` | 7 | — | allowlisted: pure re-export barrel |
| `src/packages/tools/database/index.ts` | 7 | — | allowlisted: pure re-export barrel |
| `src/packages/tools/index.ts` | 29 | NYAYAVIGYA_TOOLS_VERSION, TOOL_COUNT | allowlisted: pure re-export barrel |
| `src/packages/voice/index.ts` | 20 | voicePackageInfo | allowlisted: Session-11 (2026-05-10): metadata-only re-export (voicePackageInfo). Voice impls are wired via /api/nv5/voice/* in Batch B + canonical /api/nv/voice/* — this barrel intentionally exposes no runtime services |
| `src/packages/workflows/index.ts` | 11 | NYAYAVIGYA_WORKFLOWS_VERSION | allowlisted: pure re-export barrel |
| `src/services/document-pipeline/index.ts` | 71 | — | allowlisted: pure re-export barrel |
| `src/services/memory/index.ts` | 82 | — | allowlisted: pure re-export barrel |
| `src/services/orchestration/index.ts` | 81 | — | allowlisted: pure re-export barrel |
| `src/services/rag/index.ts` | 61 | — | allowlisted: Session-11 (2026-05-10): pure re-export barrel for adaptiveRAG/correctiveRAG/selfRAG/ragService/lightRAG/entityMerger — every named export is wired-internal via direct file imports from nv-queen-orchestrator/rag-service consumers; barrel itself has no runtime consumer |
| `src/services/redis-client.ts` | 29 | redisClient, ensureRedis | allowlisted: Session-11 (2026-05-10): NYV-ORCH-SEAM-007 back-compat seam re-exporting nvRedisCache + redisClient + ensureRedis from canonical nv-redis-cache-service.js + redis.js (both wired). Kept as a compat surface for legacy importers but has no current src/index.ts consumer; the canonical primitive is nvRedisCache directly |

### KEEP-CLI (3)

| File | Lines | Exports | Note |
|---|---:|---|---|
| `src/orchestration/nv-queen-lifecycle-events.types-test.ts` | 205 | — | allowlisted: type-test file; runtime-no-op compile-time-only check |
| `src/services/nv-model-catalog-seeding-service.ts` | 89 | seedModelCatalog | allowlisted: standalone seeding script invoked manually / by deploy job |
| `src/services/nv-statute-seeding-service.ts` | 673 | — | allowlisted: standalone seeding script invoked manually / by deploy job |

### KEEP-CONTRACT (3)

| File | Lines | Exports | Note |
|---|---:|---|---|
| `src/services/microservice-contracts/nv-agent-service-contract.ts` | 116 | NvAgentServiceContract, NvAgentServiceAdapter | allowlisted: type contract for east-west microservice — published surface, no runtime consumer in monolith |
| `src/services/microservice-contracts/nv-doc-service-contract.ts` | 138 | NvDocServiceContract, NvDocServiceAdapter | allowlisted: type contract for east-west microservice — published surface |
| `src/services/microservice-contracts/nv-rag-service-contract.ts` | 118 | NvRagServiceContract, NvRagServiceAdapter | allowlisted: type contract for east-west microservice — published surface |

### KEEP-DYNAMIC-IMPORT (3)

| File | Lines | Exports | Note |
|---|---:|---|---|
| `src/packages/multimodal/index.ts` | 52 | ChatDollKitAvatarService, multimodalPackageInfo | allowlisted: Session-11 (2026-05-10): top-level await import('./chatdollkit-avatar-service.js') for lazy ChatDollKit loader + metadata-only re-export. Heavy multimodal impls are wired directly via /api/nv5/multimodal/* in Batch B; this barrel intentionally exposes only metadata + lazy hook |
| `src/services/enterprise-platform/index.ts` | 3 | enterprisePlatform | allowlisted: consumed via await import('./enterprise-platform/index.js') in src/services/index.ts:196 (lazy capability loader); static BFS auditor cannot follow dynamic import() — Session-9 architect catch 2026-05-10 |
| `src/services/multi-org/index.ts` | 3 | multiOrg | allowlisted: consumed via await import('./multi-org/index.js') in src/services/index.ts:207 + import('../services/multi-org/index.js') in src/orchestration/capability-manifest.ts:1578 — Session-9 architect catch 2026-05-10 |
