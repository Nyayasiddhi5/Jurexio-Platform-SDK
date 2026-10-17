# Dead-Stub Cleanup — 2026-05-10

## Why these were removed (NYV-DEAD-STUB-CLEANUP-001)

A user-prompted audit on 2026-05-10 found that three files were
misleading dead stubs (each <30 lines, returning empty success responses,
zero consumers anywhere in the codebase).

The actual production implementations they appeared to "promise" already
exist elsewhere — keeping the stubs created risk of someone wiring them
and accidentally bypassing the real safety-ring-protected pipelines.

| Removed file | Lines | Real implementation that supersedes it |
|---|---|---|
| `src/orchestration/nyayavigya-unified-orchestrator-v9.ts` | 21 | `src/orchestration/nyayavigya-orchestration-core-v9.ts` (592 lines, "Stub mode removed", consumed by 9 files including nv-orchestration-engine.ts and nv-sdk-auto-initialization.ts) |
| `src/orchestration/unified-multimodal-orchestrator.ts` | 12 | `src/routes/nv-sdk-multimodal-voice-routes.ts` (12 endpoints: vision/analyze, video/generate-script, 3d/generate, avatar/create-session, rag/query, capabilities, voice/synthesize, voice/transcribe, voice/stream/start, voice/stream/stop, voice/voiceover/generate) — mounted at /api/nv/sdk/multimodal/* |
| `src/services/microservice-contracts/nv-voice-service-contract.ts` | 112 | `src/routes/nv-voice-ws-routes.ts` (305 lines, real Deepgram+Sarvam+Whisper pipeline, 22 Indian languages, ws endpoint /api/nv/voice/stream) — mounted at /api/nv/voice/* |

## Consumer audit (proves zero references, safe to delete)

```
$ rg -n 'NyayavigyaUnifiedOrchestratorV9|UnifiedMultimodalOrchestrator\b|unifiedMultimodalOrchestrator\b|NvVoiceServiceAdapter|NvVoiceServiceContract' src --type ts -l
src/services/microservice-contracts/nv-voice-service-contract.ts   ← self
src/orchestration/unified-multimodal-orchestrator.ts               ← self
src/orchestration/nyayavigya-unified-orchestrator-v9.ts            ← self
```

Three self-references only. No external consumers. Removal is safe.
