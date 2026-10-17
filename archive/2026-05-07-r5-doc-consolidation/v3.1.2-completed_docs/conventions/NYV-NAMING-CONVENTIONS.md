---
status: completed
version: 3.1.2
superseded_by: null
last_verified: 2026-04-25
---
# Nyayavigya Platform 3.1.2 — Naming Conventions

**Document Reference**: NYV-CONV-312-001
**Version**: 3.1.2 | **Status**: ENFORCED

---

## 1. Database Tables

All tables use `nv_` prefix. No exceptions.

```
nv_agents           nv_audit_logs       nv_auth_tokens
nv_bmad_clusters    nv_chat_sessions    nv_dag_jobs
nv_documents        nv_feature_flags    nv_grpo_runs
nv_hitl_decisions   nv_hitl_queue       nv_job_queue
nv_jurisdiction_configs               nv_llm_providers
nv_mcp_tool_calls   nv_mcp_tools        nv_memory_entries
nv_model_catalog    nv_orchestration_jobs nv_organizations
nv_pii_vault        nv_rag_chunks       nv_rag_documents
nv_roma_levels      nv_sdk_applications nv_sdk_usage_metrics
nv_sessions         nv_system_configs   nv_token_metrics
nv_users            nv_voice_sessions   nv_workspace_projects
nv_api_keys         nv_agent_configs    nv_agent_performance
nv_agent_personas
```

## 2. API Routes

All API routes: `/api/nv/*`

```
/api/nv/health          /api/nv/auth/*
/api/nv/agents/*        /api/nv/orchestration/*
/api/nv/sdk/*           /api/nv/hitl/*
/api/nv/llm/*           /api/nv/analytics/*
/api/nv/mcp/tools/*     /api/nv/avatar/*
/api/nv/jurisdiction/*  /api/nv/workspace/*
```

## 3. Source Files

| Type | Convention | Example |
|------|-----------|---------|
| Route files | `nv-*.ts` (kebab-case) | `nv-agent-routes.ts` |
| Service files | `nv-*.ts` (kebab-case) | `nv-agent-registry.ts` |
| Middleware | `nv-*.middleware.ts` | `nv-auth.middleware.ts` |
| Config files | `nv-*.config.ts` | `nv-platform.config.ts` |
| Startup | `nv-*.ts` | `nv-jwt-validator.ts` |
| DB schema | `nv-*.schema.ts` | `nv-agents.schema.ts` |
| Seed scripts | `nv-seed-*.ts` | `nv-seed-agents.ts` |
| Test files | `nv-*.test.ts` | `nv-agent-registry.test.ts` |
| JSON data | `nv-*.json` | `nv-agents-registry.json` |

## 4. Frontend

| Type | Convention | Example |
|------|-----------|---------|
| Pages | `nv-*.tsx` (kebab-case) | `nv-dashboard.tsx` |
| Components | `NvXxx.tsx` (PascalCase) | `NvAgentCard.tsx` |
| Hooks | `use-nv-*.ts` | `use-nv-agents.ts` |
| shadcn/ui | `*.tsx` (kebab-case exception) | `button.tsx` |

## 5. Agent IDs

```
NYV-AGT-{CATEGORY}-{NNN}
```

Examples:
- `NYV-AGT-CIVIL-001` — Civil Law Agent #1
- `NYV-AGT-CRIMINAL-015` — Criminal Law Agent #15
- `NYV-AGT-BNS-001` — BNS 2023 Agent #1

Categories: CIVIL, CRIMINAL, BNS, BNSS, CONSTITUTIONAL, CORPORATE, TAX, IPR, FAMILY, LABOR, BANKING, LAND, CONSUMER, ENV, CYBER, NRI, ARB, IBC, SEC, COMP, MEDIA, IMM, MARITIME, AVIATION, EDU, HEALTH, ADR, PIL, DRAFTING, RESEARCH, ORCH

## 6. Microservices

```
NYV-SVC-GATEWAY     — API Gateway (port 5000)
NYV-SVC-ORCH        — Orchestration Engine (port 3001)
NYV-SVC-SDK         — SDK Backend API (port 4000)
NYV-SVC-CONSOLE     — SDK Frontend Dashboard (port 3004)
```

## 7. MCP Tool IDs

```
NYV-MCP-{TYPE}-{NNN}
```

Examples:
- `NYV-MCP-GITHUB-001`
- `NYV-MCP-DBQUERY-001`
- `NYV-MCP-SQS-001`

## 8. Environment Variables

All NYV-specific variables: `NYV_` prefix.

```
NYV_PORT_GATEWAY    NYV_PORT_ORCH       NYV_PORT_SDK
NYV_PORT_CONSOLE    NYV_JWT_SECRET      NYV_JWT_REFRESH_SECRET
NYV_CORS_ORIGINS    NYV_GUARDRAILS_ENABLED
NYV_RATE_LIMIT_SOLO NYV_RATE_LIMIT_PRO  NYV_FEATURE_*
```

## 9. Versioning

- Platform version: `MAJOR.MINOR.PATCH` (3.1.2)
- API version: `/api/nv/v{N}/` for breaking changes
- Agent registry: No version numbers in agent IDs (use sequence numbers instead)
- Table names: NO version suffixes (no `nv_agents_v2`)
