# Console Dashboard — Route → Component → API Map (2026-08-23)

> **Updated 2026-09-02 (Phase 0+1).** NYV tree `client/`. All paths prefixed `/console` unless noted.

## Phase 1 admin surfaces (2026-09-02)

| Route / tab | Component | Primary APIs |
|---|---|---|
| `/superadmin/platforms?tab=limits` | `PlatformLimitsPanel` | `GET /api/nv/sdk/platform/tiers`, `GET /api/nv/sdk/platform/limits`, `PATCH /api/nv/platforms/:id/rate-limits` |
| `/intelligence?tab=llm-router` | `LlmRouterAdminPanel` | `GET /api/nv/v1/sdk/llm/catalog`, `/providers`, `/router/health` |
| `/operations?tab=tokens` | `TokenMetricsPanel` | `GET /api/nv/cost/overview`, `GET /api/nv/cost/trend`, link `/api/nv/token-metrics` |
| `/sdk-hub?tab=testing` | `sdk-testing-console.tsx` + `PartnerSmokePanel` | smoke probes on mounted gateway paths |
| `/superadmin/feature-flags` | `superadmin-feature-flags.tsx` | `GET/PATCH /api/nv/admin/feature-flags` |

## SDK Hub Client tab (`/sdk-hub?tab=client`)

| Section | Component | Primary APIs |
|---|---|---|
| Pattern catalog | `client-sdk-playground.tsx` | `GET /api/nv/patterns/list` (SSoT — 22 patterns) |
| Agent picker | same | `GET /api/nv/agents` (registry SSoT) |
| Model badge | same | `useNvModelCatalog()` → `GET /api/nv/models` |
| Queen execution (default) | same | `POST /api/nv/stream` (AG-UI) + `ExecutionTraceRail` |
| Pattern execution | same | `POST /api/nv/patterns/{slug}` (iterations in response) |
| History / steps | same | local + parsed `iterations` / AG-UI timeline |

## Cross-surface sync matrix

| Surface | Agents source | Models source | Platforms / keys source |
|---|---|---|---|
| Agent registry `/agent-registry` | `GET /api/nv/agents` | — | — |
| Dashboard `/dashboard` | `GET /api/nv/agents` | `useNvModelCatalog` | `GET /api/nv/admin/stats` |
| SDK Hub overview | same + swarm stats | `GET /api/nv/models` | `GET /api/nv/governance/surface` |
| SDK Hub keys | — | — | `GET /api/nv/platforms`, `GET /api/nv/sdk/keys/:appId` |
| Platform mgmt | registry count | llm_config from platform | `GET /api/nv/platforms` |
| DB (gateway boot) | `nv_agent_metrics` seed | model catalog table | `nv-env-sdk-key-sync` → `sdk_app_api_keys` hashes from `NYV_SDK_KEY_*` env (no new keys) |


| Tab / section | Component | Primary APIs |
|---|---|---|
| Overview KPIs | `nyayavigya-sdk-hub.tsx` | `GET /api/nv/health`, `GET /api/nv/agents`, `GET /api/nv/swarm/stats`, `GET /api/nv/languages/list`, `GET /api/nv/nyaya-tools/catalog`, `GET /api/nv/models` |
| Overview compliance | same | `GET /api/nv/compliance/iso` |
| Overview LLM matrix | same | `GET /api/nv/models` + `GET /api/nv/health/full` (provider health) |
| Agent Intelligence | tab `agents` | `GET /api/nv/swarm/stats`, `GET /api/nv/registry/agents` |
| Legal Infrastructure | tab `legal` | `GET /api/nv/statutes/_summary` |
| LLM Operations | tab `llm` | `GET /api/nv/models`, `GET /api/nv/health/full` |
| Security & Compliance | tab `security` | `GET /api/nv/compliance/iso`, `GET /api/nv/governance/surface` |
| Context & Memory | tab `context` | `GET /api/nv/context/strategies`, `GET /api/nv/cam/stats`, RAG stats from `health/full` |
| SDK Gateway | tab `sdk` | `GET /api/nv/nyaya-tools/catalog`, `GET /api/nv/admin/stats` |
| AI Quality | tab `quality` | `GET /api/nv/compliance/grpo`, `GET /api/nv/phase5/grpo/stats`, `GET /api/nv/governance/surface` |

## Orchestration Hub (`/orchestration?tab=`)

| Tab | Component | Primary APIs |
|---|---|---|
| overview | `AgentOrchestration.tsx` | `GET /api/nv/agents`, `GET /api/nv/orchestration/dashboard` |
| trace | `OrchestrationTracePane.tsx` | `POST /api/nv/stream` (AG-UI Queen) + `ExecutionTraceRail` |
| live | `live-activity-feed.tsx` | `GET /api/nv/activity/recent`, SSE `/api/nv/activity/stream` |
| swarm | `SwarmTopologiesPanel.tsx` | `GET /api/nv/swarm/topologies`, `GET /api/nv/swarm/stats` |
| digital-twin | `digital-twin-creator.tsx` | `GET/POST /api/nv/twindesk/twins`, simulate/chat/benchmark sub-routes |
| cam | `CAMDashboardPage.tsx` | `GET /api/nv/orchestration/dashboard`, `GET /api/nv/health`, healing/guardrails/routing weights |
| cam-telemetry | `CAMTelemetryPage` → `CAMMonitoringDashboard` | `GET /api/nyayavigya/cam/dashboard` (5s poll) |
| router | `RouterDecisionsPage.tsx` | `GET /api/nv/orchestration/router-decisions` |
| a2a | `A2ACollaborationDashboard.tsx` | `GET /api/nv/orchestration/protocols`, `GET /api/nv/orchestration/chains` |
| bmad | `BMADWorkflowVisualizer.tsx` | `GET /api/nv/orchestration/bmad/templates`, chains |
| memory | `MemoryBrowserCAM.tsx` | `GET /api/nv/cam/entries`, `GET /api/nv/cam/stats` |
| grpo | `GRPOTrainingDashboard.tsx` | `GET /api/nv/compliance/grpo` |
| policies | `PolicyManagementConsole.tsx` | `GET /api/nv/policies`, drilldown `GET /api/nv/policies/:id` |

## Agents section (all routes)

| Route | Component | Primary APIs | Execution visibility |
|---|---|---|---|
| `/agent-registry` | `AgentRegistry.tsx` | `GET /api/nv/agents`, `GET /api/nv/swarm/topologies` | Fleet + swarm tabs |
| `/agent-live-testing` | `agent-live-testing.tsx` | `GET /api/nv/agents`, `useNvModelCatalog`, `POST /api/nv/orchestrate`, `POST /api/nv/stream` | `ExecutionTraceRail` + AG-UI on general mode |
| `/roma-l5-admin` | `roma-l5-admin.tsx` | `GET /api/nv/admin/roma-l5/*` | Live metrics (no mock generators) |
| `/digital-twin`, `/digital-twin-creator` | `digital-twin-creator.tsx` | `GET/POST /api/nv/twindesk/twins/*` | Honest empty/error states (NV-NO-STUB-001) |
| `/sdk-hub?tab=client` | `client-sdk-playground.tsx` | `POST /api/nv/stream`, patterns | `ExecutionTraceRail` + task decomposition |

## Other pages (prior GO scope)

| Route | Component | Primary APIs |
|---|---|---|
| `/dpdpa-compliance` | `dpdpa-compliance.tsx` | `GET /api/nv/compliance/dpdpa` |
| `/chat?tab=legal` | `ChatHub` → `legal-chat.tsx` | `POST /api/nv/legal-chat/*`, `POST /api/nv/stream`, orchestrate |
| `/roma-l5-admin` | `roma-l5-admin.tsx` | `GET /api/nv/admin/roma-l5/*` (agents, stats, topologies, languages, grpo) |
| `/agent-live-testing` | `agent-live-testing.tsx` | `GET /api/nv/agents`, `GET /api/nv/models`, `POST /api/nv/orchestrate`, `POST /api/nv/stream` |
| `/agent-registry` | `AgentRegistry.tsx` | `GET /api/nv/agents`, `GET /api/nv/swarm/topologies` |
| `/governance` | `nyayasiddhi-governance.tsx` | `GET /api/nv/governance/surface`, `GET /api/nv/compliance/iso`, registry |
| `/dashboard` | `console-dashboard.tsx` | health, agents, hitl, activity, platform-health |

## Model SSoT

All model pickers should use `useNvModelCatalog()` → `GET /api/nv/models` (dynamic model registry).
