# Capability inventory classification (2026-07-30)

> **Rule (NV-MESH-001):** factory exists ≠ Queen-schedulable until INTENT + analyzePrompt.  
> Do **not** force all 142 leaves onto every Queen plan (cost). Schedule by intent.

## INTENT-NEXT (A1 Wave — now REQUIRED in mesh guardrail)

| Leaf | Intent token(s) |
|---|---|
| `rag.graph` | graphrag, rag_graph, graph |
| `rag.reranker` | rerank, reranker |
| `rag.corrective` | corrective_rag |
| `rag.adaptive` | adaptive_rag |
| `rag.self` | self_rag |
| `rag.lightrag` | lightrag |
| `memory.mem0.recall` | mem0, mem0_recall |
| `memory.social.context` | social_memory |
| `docs.intelligence` | docs_intelligence, doc_intelligence |
| `intelligence.compliance-calendar` | compliance_calendar |
| `workflow.bulk-analysis` | bulk_analysis |
| `workflow.calendar-extract` | calendar_extract |
| `sdk.workflow-protocol` | workflow_protocol |
| `sdk.usage-metering` | usage_metering |
| `nyaya-tools.agent-lifecycle` | agent_lifecycle |
| `openbot.send` | openbot_send, openbot |

Already INTENT-covered high-value set remains in `REQUIRED_INTENT_MESH_LEAF_IDS` (OCR, bots, enterprise, BMAD, GRPO, CLM, e-filing, …).

## KEEP-SIDE-PATH (intentional — route/API/CLI, not default Queen)

Examples (not exhaustive): security PQC / federated-privacy leaves, memory store/consolidate variants, testing.judge/oracle when not keyword-triggered, queue internals, white-label ops, monitoring-only leaves.

These stay callable via explicit capability invoke / specialist routes without INTENT pressure.

## ARCHIVE / do-not-schedule

None moved this wave. Prefer KEEP-SIDE-PATH over deleting factories.

## Ops note

Caselaw embed % is **ops backfill**, not an INTENT leaf issue. See `documents/working/NYS-CASELAW-EMBED-SLO-2026-07.md`.
