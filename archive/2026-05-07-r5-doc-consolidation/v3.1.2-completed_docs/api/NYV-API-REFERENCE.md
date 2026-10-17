---
status: completed
version: 3.1.2
superseded_by: null
last_verified: 2026-04-25
---
# Nyayavigya Platform 3.1.2 — API Reference

**Document Reference**: NYV-API-312-001
**Base URL**: `https://your-domain/api/nv`
**Auth**: `Authorization: Bearer <JWT>` or `X-NV-API-Key: NYV-KEY-<key>`

---

## Authentication

### POST /api/nv/auth/login
Login and get JWT tokens.

**Request**:
```json
{ "email": "dev@demo.nyayavigya.in", "password": "<operator-managed>" }
```
**Response**: `{ "accessToken": "...", "refreshToken": "...", "user": {...} }`

### POST /api/nv/auth/refresh
Refresh access token using refresh token.

### POST /api/nv/auth/logout
Revoke current session.

---

## Health

### GET /api/nv/health
Basic health check.

### GET /api/nv/health/full
Full service status with DB, agents, LLM providers.

---

## Agents

### GET /api/nv/agents
List all 452 legal agents. Supports `?category=civil_law&jurisdiction=IN&tier=solo` filters.

### GET /api/nv/agents/:id
Get agent by `NYV-AGT-{CAT}-{NNN}` ID.

### POST /api/nv/agents
Register a new agent (operator role required).

### PUT /api/nv/agents/:id
Update agent config.

### GET /api/nv/agents/:id/performance
Get agent performance metrics.

---

## Orchestration

### POST /api/nv/orchestration/run
Run a single agent orchestration job.

**Request**:
```json
{
  "agentId": "NYV-AGT-CIVIL-001",
  "jurisdiction": "IN",
  "query": "Explain Section 100 CPC",
  "language": "en",
  "context": {}
}
```

### GET /api/nv/orchestration/jobs
List orchestration jobs for the authenticated user.

### GET /api/nv/orchestration/jobs/:id
Get status and result of a specific job.

### POST /api/nv/orchestration/dag
Run a DAG (multi-step orchestration pipeline).

### GET /api/nv/orchestration/a2a
List active A2A collaboration sessions.

### POST /api/nv/orchestration/bmad/cluster/form
Form a BMAD agent cluster for a complex task.

---

## HITL (Human-in-the-Loop)

### GET /api/nv/hitl/queue
Get pending HITL decisions.

### POST /api/nv/hitl/queue
Submit a HITL decision request.

### POST /api/nv/hitl/queue/:id/approve
Approve a HITL item.

### POST /api/nv/hitl/queue/:id/reject
Reject a HITL item.

### POST /api/nv/hitl/escalate
Escalate a HITL item to manager.

---

## SDK Applications

### GET /api/nv/sdk/apps
List all SDK apps for the authenticated user.

### POST /api/nv/sdk/apps
Create a new SDK app.

**Request**:
```json
{
  "name": "My Legal App",
  "app_type": "nyayasiddhi_professional",
  "jurisdiction": "IN",
  "tier": "pro"
}
```

### GET /api/nv/sdk/apps/:id
Get SDK app details.

### GET /api/nv/sdk/apps/:id/keys
List API keys for an SDK app.

### POST /api/nv/sdk/apps/:id/keys
Generate a new API key for an SDK app. Returns the plaintext key ONCE.

### DELETE /api/nv/sdk/apps/:id/keys/:keyId
Revoke an API key.

---

## LLM Providers

### GET /api/nv/llm/providers
List all 23 LLM providers with capabilities and cost info.

### GET /api/nv/model-catalog
List all supported models across all providers.

---

## Analytics

### GET /api/nv/analytics/token-costs
Get token usage and cost breakdown by agent, model, and time period.

### GET /api/nv/analytics/usage
Platform usage analytics.

---

## MCP Tools

### POST /api/nv/mcp/tools/github
Execute a GitHub MCP tool action.

### POST /api/nv/mcp/tools/db-query
Execute a safe read-only database query via MCP.

### POST /api/nv/mcp/tools/sqs-batch
Push a batch job to SQS via MCP.

---

## Avatar Sessions

### POST /api/nv/avatar/session
Create an avatar interaction session.

---

## Voice (WebSocket)

Connect to `ws://your-domain/api/nv/voice` for real-time voice sessions.

---

## Jurisdiction

### GET /api/nv/jurisdiction
List all configured jurisdictions (IN, AE, SA, SG, US, EU).

---

## Swagger UI

Full interactive API documentation available at:
`http://localhost:5000/api/nv/docs`
