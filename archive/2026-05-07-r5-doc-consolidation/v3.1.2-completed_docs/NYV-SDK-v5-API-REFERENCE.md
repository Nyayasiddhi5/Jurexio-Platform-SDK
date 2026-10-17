---
status: completed
version: v5.0.0
canonical: true
locked: true
locked_reason: "Operator policy 2026-04-30T18:00Z — SDK is frozen at v5.0.0 stable until next major release. Do not bump version without explicit operator approval."
last_verified: 2026-04-30
---
# Nyayavigya SDK v5.0.0 — API Reference & Implementation Guide

**Platform 3.1.2 | Complete API Definition | All Endpoints, Schemas & Agentic Patterns**

---

## Table of Contents

1. [API Overview](#1-api-overview)
2. [Base Configuration](#2-base-configuration)
3. [Authentication Endpoints](#3-authentication-endpoints)
4. [AI Orchestration API](#4-ai-orchestration-api)
5. [Agent Registry API](#5-agent-registry-api)
6. [Document Processing API](#6-document-processing-api)
7. [Legal Corpus & RAG API](#7-legal-corpus--rag-api)
8. [Voice & STT API](#8-voice--stt-api)
9. [Memory System API](#9-memory-system-api)
10. [SDK Application Management API](#10-sdk-application-management-api)
11. [API Key Management API](#11-api-key-management-api)
12. [Case Management API](#12-case-management-api)
13. [Compliance & Audit API](#13-compliance--audit-api)
14. [Credits & Billing API](#14-credits--billing-api)
15. [Digital Twin API](#15-digital-twin-api)
16. [MCP Tools API](#16-mcp-tools-api)
17. [Webhook Events API](#17-webhook-events-api)
18. [Health & Monitoring API](#18-health--monitoring-api)
19. [22 Agentic Patterns — Full Reference](#19-22-agentic-patterns--full-reference)
20. [5-Tier Memory Architecture](#20-5-tier-memory-architecture)
21. [LLM Provider Configuration](#21-llm-provider-configuration)
22. [SDK Variant Feature Matrix](#22-sdk-variant-feature-matrix)
23. [Error Code Reference](#23-error-code-reference)
24. [Data Models & Schemas](#24-data-models--schemas)
25. [SDK Deployment Checklist](#25-sdk-deployment-checklist)

---

## 1. API Overview

### Base URL
```
Production:  https://app.nyayavigya.in/api
Development: https://<repl-domain>/api
```

### API Prefix
All Nyayavigya Core endpoints use the `/nv/` prefix:
```
/api/nv/orchestrate
/api/nv/stream
/api/nv/agents
/api/nv/health
```

### Platform-Specific Prefixes
```
Nyayamitra:     /api/nys/nym/
Professional:   /api/nys/pro/
Institutional:  /api/nys/ins/
Academy:        /api/nys/ace/
Ministry:       /api/nys/gov/
```

### Request Format
- Content-Type: `application/json` (unless uploading files)
- Character encoding: UTF-8
- Maximum request body: 10MB (configurable per tier)
- File uploads: `multipart/form-data` (max 500MB for Enterprise)

### Response Format
All responses follow the standard envelope:
```json
{
  "success": true,
  "data": { ... },
  "meta": {
    "requestId": "req_abc123",
    "processingTimeMs": 1250,
    "tokensUsed": 850,
    "model": "claude-sonnet-4-6",
    "cached": false
  }
}
```

---

## 2. Base Configuration

### Headers

| Header | Required | Description |
|---|---|---|
| `Authorization` | Yes | `Bearer <jwt_token>` or `Bearer <api_key>` |
| `Content-Type` | Yes | `application/json` |
| `X-Request-ID` | No | Client-generated request ID for tracing |
| `X-Organization-ID` | No | Override org context (enterprise only) |
| `X-Jurisdiction` | No | Override default jurisdiction |
| `X-NYV-SDK-Version` | Auto | SDK version header (auto-set by client) |
| `X-NSP-Inter-Secret` | Internal | Inter-service authentication |

### SDK Client Initialization

```typescript
import NyvClient from '@nyayavigya/sdk';

const nyv = new NyvClient({
  apiKey: string;                          // Required: API key
  baseUrl?: string;                        // Default: 'https://app.nyayavigya.in'
  defaultJurisdiction?: string;            // Default: 'IN'
  defaultPlatform?: NyvPlatformVariant;    // Your platform code
  timeout?: number;                        // Default: 30000 (ms)
  debug?: boolean;                         // Default: false
  version?: string;                        // Default: '5.0.0'
});
```

---

## 3. Authentication Endpoints

### POST /api/nv/auth/login
Authenticate and receive JWT tokens.

**Request:**
```json
{
  "email": "<demo-account-email>",
  "password": "<demo-account-password>"
}
```
> Demo credentials are operator-managed (see INTEGRATION-GUIDE §14.1
> for the account list; passwords distributed out-of-band per
> NYV-SECURITY-DOC-CREDS-001).

**Response (200):**
```json
{
  "success": true,
  "data": {
    "token": "[PURGED-JWT]...",
    "refreshToken": "[PURGED-JWT]...",
    "user": {
      "id": 1,
      "email": "dev@demo.nyayavigya.in",
      "role": "developer",
      "tier": "pro",
      "organizationId": 1
    },
    "expiresIn": 3600
  }
}
```

### POST /api/nv/auth/refresh
Refresh an expired JWT token.

**Request:**
```json
{
  "refreshToken": "[PURGED-JWT]..."
}
```

### POST /api/nv/auth/logout
Revoke all refresh tokens for the current session.

---

## 4. AI Orchestration API

### POST /api/nv/orchestrate
Core AI orchestration endpoint. Runs any of 1,043 legal agents through the full 10-step safety pipeline.

**Request Schema:**
```json
{
  "agentKey": "string (required)",
  "prompt": "string (required)",
  "userPrompt": "string (alias for prompt)",
  "systemPrompt": "string (override agent system prompt)",
  "tier": "free|solo|plus|pro|enterprise|government|internal",
  "jurisdiction": "IN|UK|US|GC|SG|EU",
  "matterId": "number (link to case/matter for memory)",
  "orgId": "number (organization-scoped memory)",
  "useRAG": "boolean (enable RAG retrieval, default: false)",
  "stream": "boolean (SSE streaming, default: false)",
  "temperature": "number (0.0-1.0, overrides agent default)",
  "maxTokens": "number (override max response tokens)",
  "model": "string (override LLM model selection)"
}
```

**Response Schema (200):**
```json
{
  "success": true,
  "data": {
    "content": "string (AI-generated response — may be JSON string)",
    "agentKey": "contract-review-specialist",
    "model": "claude-sonnet-4-6",
    "tokensUsed": 1250,
    "processingTimeMs": 3200,
    "tier": "pro",
    "cached": false,
    "ragContext": {
      "documentsUsed": 3,
      "relevanceScore": 0.89
    },
    "safety": {
      "piiDetected": false,
      "hallucinationScore": 0.05,
      "guardrailPassed": true
    }
  }
}
```

### POST /api/nv/stream
Same as `/orchestrate` but streams tokens via Server-Sent Events (SSE).

**SSE Event Format:**
```
data: {"token": "The ", "index": 0}

data: {"token": "contract ", "index": 1}

data: {"token": "contains...", "index": 2}

data: {"meta": {"tokensUsed": 1250, "model": "claude-sonnet-4-6"}}

data: [DONE]
```

### POST /api/nv/embed
Generate text embeddings for RAG/similarity search.

**Request:**
```json
{
  "text": "Section 302 of the Bharatiya Nyaya Sanhita",
  "model": "text-embedding-3-small"
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "embedding": [0.0123, -0.0456, ...],
    "dimensions": 1536,
    "model": "text-embedding-3-small",
    "tokensUsed": 12
  }
}
```

---

## 5. Agent Registry API

### GET /api/nv/agents
List all available legal agents.

**Query Parameters:**
| Parameter | Type | Description |
|---|---|---|
| `practice_area` | string | Filter by practice area |
| `jurisdiction` | string | Filter by jurisdiction |
| `tier` | string | Filter by minimum tier |
| `search` | string | Full-text search agent names/descriptions |
| `limit` | number | Results per page (default: 50) |
| `offset` | number | Pagination offset |

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "key": "contract-review-specialist",
      "name": "Contract Review Specialist",
      "description": "Reviews contracts for risks, compliance issues, and missing clauses",
      "practiceAreas": ["contract-law", "corporate-law"],
      "jurisdiction": "IN",
      "tier": "pro",
      "version": "5.0.0",
      "inputSchema": {
        "type": "object",
        "required": ["prompt"],
        "properties": {
          "prompt": { "type": "string" },
          "contractType": { "type": "string", "enum": ["nda", "employment", "lease", "merger"] }
        }
      },
      "capabilities": ["rag", "document_analysis", "citation_generation"],
      "avgResponseTimeMs": 2800,
      "avgTokensUsed": 1100
    }
  ],
  "meta": {
    "total": 1043,
    "limit": 50,
    "offset": 0
  }
}
```

### GET /api/nv/agents/:agentKey
Get detailed information about a specific agent.

### POST /api/nv/agents/:agentKey/execute
Execute a specific agent directly (bypasses auto-selection).

---

## 6. Document Processing API

### POST /api/nv/sdk/documents/upload
Upload a document for processing.

**Request:** `multipart/form-data`
| Field | Type | Description |
|---|---|---|
| `file` | File | Document file (PDF, DOCX, images) |
| `jurisdiction` | string | Jurisdiction context |
| `analysisType` | string | `contract_review`, `case_analysis`, `compliance_check`, `general` |
| `language` | string | Document language (auto-detected if omitted) |

**Response (200):**
```json
{
  "success": true,
  "data": {
    "documentId": "doc_abc123",
    "filename": "contract.pdf",
    "pages": 12,
    "extractedText": "...",
    "language": "en",
    "ocrUsed": true,
    "ocrProvider": "got-ocr-2.0",
    "processingTimeMs": 4500
  }
}
```

### POST /api/nv/sdk/documents/analyze
Analyze an uploaded document.

**Request:**
```json
{
  "documentId": "doc_abc123",
  "analysisType": "contract_review",
  "agentKey": "contract-review-specialist",
  "jurisdiction": "IN",
  "focusAreas": ["risk_clauses", "compliance", "missing_provisions"]
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "documentId": "doc_abc123",
    "analysis": {
      "summary": "...",
      "riskLevel": "medium",
      "keyClauses": [...],
      "complianceFlags": [...],
      "suggestedAmendments": [...],
      "citations": [...]
    },
    "agentKey": "contract-review-specialist",
    "tokensUsed": 3400,
    "processingTimeMs": 8200
  }
}
```

### POST /api/nv/sdk/documents/draft
Generate a legal document from specifications.

**Request:**
```json
{
  "documentType": "nda",
  "jurisdiction": "IN",
  "parties": [
    { "name": "Company A", "role": "disclosing_party" },
    { "name": "Company B", "role": "receiving_party" }
  ],
  "parameters": {
    "duration": "2_years",
    "confidentialityScope": "broad",
    "governingLaw": "Indian Contract Act 1872",
    "disputeResolution": "arbitration_mumbai"
  }
}
```

### POST /api/nv/sdk/documents/batch
Batch process multiple documents (Enterprise/Government only).

---

## 7. Legal Corpus & RAG API

### GET /api/nv/legal-corpus/search
Search the Indian legal corpus (BNS, BNSS, BSA, IPC, CrPC, CPC, and 300+ Acts).

**Query Parameters:**
| Parameter | Type | Description |
|---|---|---|
| `q` | string (required) | Search query |
| `act` | string | Filter by act name |
| `jurisdiction` | string | Jurisdiction filter |
| `section` | string | Specific section number |
| `limit` | number | Results (default: 20) |

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "bns-302",
      "act": "Bharatiya Nyaya Sanhita 2023",
      "section": "302",
      "title": "Murder",
      "text": "Whoever commits murder shall be punished with death...",
      "jurisdiction": "IN",
      "effectiveDate": "2024-07-01",
      "previousLaw": "IPC Section 302",
      "relevanceScore": 0.95
    }
  ]
}
```

### POST /api/nv/rag/query
Execute a RAG-powered legal query with citation retrieval.

**Request:**
```json
{
  "query": "What are the penalties for cybercrime under Indian law?",
  "jurisdiction": "IN",
  "sources": ["statutes", "case_law", "commentaries"],
  "maxCitations": 10,
  "includeAnalysis": true
}
```

---

## 8. Voice & STT API

### WebSocket: /api/nv/voice/stream
Real-time speech-to-text transcription with legal vocabulary boosting.

**Connection:**
```
wss://app.nyayavigya.in/api/nv/voice/stream
```

**Config Message (send first):**
```json
{
  "type": "config",
  "provider": "deepgram|sarvam|whisper",
  "language": "en-IN|hi|ta|te|mr|bn|gu|kn|ml|pa|or|as|ur|sd|kok|mai|sat|doi|mni|bodo|ne|sa",
  "sampleRate": 16000,
  "encoding": "linear16",
  "legalMode": true,
  "sessionId": "string",
  "jurisdiction": "IN"
}
```

**Audio Data:** Send raw PCM audio buffers.

**Transcript Events:**
```json
{
  "type": "transcript",
  "text": "Under Section 302 of the Bharatiya Nyaya Sanhita...",
  "isFinal": true,
  "confidence": 0.94,
  "words": [
    { "word": "Section", "start": 0.5, "end": 0.8, "confidence": 0.98 },
    { "word": "302", "start": 0.8, "end": 1.1, "confidence": 0.96 }
  ],
  "legalTermsDetected": ["BNS", "Section 302"],
  "language": "en-IN"
}
```

### GET /api/nv/voice/info
Get voice service capabilities and supported languages.

### STT Providers

| Provider | Best For | Languages | Latency |
|---|---|---|---|
| Deepgram Nova-2 | English (legal) | en-IN, en-US, en-GB | <300ms |
| Sarvam AI | Indian languages | 22 Indian languages | <500ms |
| OpenAI Whisper | Fallback/accuracy | 100+ languages | <2000ms |

### Legal Vocabulary Boosting
When `legalMode: true`, the following terms are auto-enhanced (80+ court terms):
- Court names: Supreme Court, High Court, District Court, NCLT, NCLAT
- Legal codes: BNS, BNSS, BSA, IPC, CrPC, CPC, Evidence Act
- Latin terms: habeas corpus, certiorari, mandamus, quo warranto
- Procedural: FIR, chargesheet, bail application, anticipatory bail

---

## 9. Memory System API

### 5-Tier Memory Architecture

| Tier | Table | Scope | TTL | Use Case |
|---|---|---|---|---|
| L1 | `nv_memory_entries` | Session | 24h | Current conversation context |
| L2 | `nv_matter_memory` | Matter/Case | 365d | Case-specific knowledge |
| L3 | `nv_client_memory` | Client | Permanent | Cross-matter client history |
| L4 | `nv_jurisdictional_memory` | Jurisdiction | Permanent | Court-specific precedents |
| L5 | `nv_precedent_memory` | Global | Immutable | Universal legal principles |

### POST /api/nv/memory
Store a memory entry.

**Request:**
```json
{
  "tier": 2,
  "key": "case_strategy",
  "value": { "approach": "settlement", "targetAmount": 5000000 },
  "matterId": "CASE-2026-001",
  "jurisdiction": "IN",
  "ttlDays": 365
}
```

### GET /api/nv/memory
Retrieve memories by context.

**Query Parameters:**
| Parameter | Type | Description |
|---|---|---|
| `tier` | number | Memory tier (1-5) |
| `matterId` | string | Filter by matter ID |
| `key` | string | Filter by memory key |
| `jurisdiction` | string | Filter by jurisdiction |

### DELETE /api/nv/memory/:id
Delete a specific memory entry (L1-L3 only; L4-L5 are immutable).

---

## 10. SDK Application Management API

### POST /api/nv/sdk/apps
Create a new SDK application.

**Request:**
```json
{
  "name": "My Legal App",
  "appType": "lawyer_platform",
  "jurisdiction": "IN",
  "tier": "pro",
  "description": "Practice management integration",
  "llmConfig": {
    "defaultProvider": "openrouter",
    "defaultModel": "claude-sonnet-4-6",
    "temperature": 0.7,
    "maxTokensPerRequest": 16384
  },
  "rateLimitPerMinute": 60,
  "dailyTokenBudget": 200000
}
```

**Response (201):**
```json
{
  "success": true,
  "data": {
    "appId": "nvsdkapp-...",
    "clientId": "nyv_app_abc123...",
    "clientSecret": "nyv_sk_xyz789...",
    "name": "My Legal App",
    "tier": "pro",
    "createdAt": "2026-04-14T10:00:00Z"
  }
}
```

### GET /api/nv/sdk/apps
List SDK applications for the authenticated organization.

### GET /api/nv/sdk/apps/:appId
Get application details.

### PUT /api/nv/sdk/apps/:appId
Update application configuration.

### DELETE /api/nv/sdk/apps/:appId
Delete an SDK application (cascades to keys and allocations).

### POST /api/nv/sdk/apps/:appId/agents
Allocate specific agents to an application.

**Request:**
```json
{
  "agents": [
    "contract-review-specialist",
    "legal-research-analyst",
    "document-drafter"
  ]
}
```

---

## 11. API Key Management API

### POST /api/nv/api-keys
Create a new SDK API key.

**Request:**
```json
{
  "name": "NSP Production Key",
  "platform": "nys-professional",
  "tier": "pro",
  "rateLimitPerMinute": 60
}
```

**Response (201):**
```json
{
  "success": true,
  "data": {
    "id": "nvkey-...",
    "name": "NSP Production Key",
    "key": "nyv_live_sk_nsp_abc123...",
    "platform": "nys-professional",
    "tier": "pro",
    "createdAt": "2026-04-14T10:00:00Z"
  }
}
```

### GET /api/nv/api-keys
List active API keys for the authenticated organization.

### DELETE /api/nv/api-keys/:id
Revoke an API key.

### POST /api/nv/sdk/keys/:keyId/rotate
Rotate an API key (generates new key, revokes old one).

---

## 12. Case Management API

### POST /api/nv/cases
Create a new case.

**Request:**
```json
{
  "title": "Smith v. Jones — Property Dispute",
  "caseType": "civil",
  "practiceArea": "property-law",
  "jurisdiction": "IN",
  "court": "Delhi High Court",
  "clientId": 123,
  "description": "Property boundary dispute...",
  "priority": "high"
}
```

### GET /api/nv/cases
List cases with filters.

### GET /api/nv/cases/:caseId
Get case details with linked documents, insights, and timeline.

### POST /api/nv/cases/:caseId/analyze
Run AI analysis on case documents.

### POST /api/nv/cases/:caseId/updates
Add a case update (6 types: HEARING, FILING, DOCUMENT, COMMUNICATION, TASK, NOTE).

**Request:**
```json
{
  "updateType": "HEARING",
  "title": "Next date hearing before Bench 3",
  "description": "Arguments on maintainability concluded. Next date for evidence.",
  "date": "2026-05-15",
  "metadata": {
    "court": "Delhi High Court",
    "bench": "Justice A.B. Sharma",
    "caseNumber": "CS(OS) 1234/2026"
  }
}
```

---

## 13. Compliance & Audit API

### GET /api/nv/compliance/audit-logs
Retrieve audit logs with SHA-256 hash chain verification.

**Query Parameters:**
| Parameter | Type | Description |
|---|---|---|
| `startDate` | ISO date | From date |
| `endDate` | ISO date | To date |
| `action` | string | Filter by action type |
| `userId` | number | Filter by user |
| `limit` | number | Results per page |

### POST /api/nv/compliance/pii-check
Check text for PII and vault sensitive data.

**Request:**
```json
{
  "text": "Client Aadhaar: 1234 5678 9012, PAN: ABCDE1234F",
  "autoVault": true
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "piiDetected": true,
    "entities": [
      { "type": "aadhaar", "value": "***VAULTED***", "vaultRef": "pii_vault_abc123" },
      { "type": "pan", "value": "***VAULTED***", "vaultRef": "pii_vault_def456" }
    ],
    "sanitizedText": "Client Aadhaar: [PII_VAULT:pii_vault_abc123], PAN: [PII_VAULT:pii_vault_def456]"
  }
}
```

### GET /api/nv/compliance/hallucination-report
Get hallucination detection reports for recent AI responses.

---

## 14. Credits & Billing API

### GET /api/nv/credits/balance
Get current credit balance.

**Response:**
```json
{
  "success": true,
  "data": {
    "balance": 45000,
    "currency": "INR",
    "dailyBudget": 200000,
    "monthlyBudget": 6000000,
    "usedToday": 155000,
    "usedThisMonth": 4200000,
    "tier": "pro"
  }
}
```

### GET /api/nv/credits/usage
Get detailed usage breakdown.

### POST /api/nv/credits/topup
Top up credits (integrates with Razorpay).

---

## 15. Digital Twin API

### POST /api/nv/twins/sessions
Create a digital twin simulation session.

**Request:**
```json
{
  "twinType": "client_simulation",
  "clientProfile": {
    "name": "Demo Client",
    "caseType": "property_dispute",
    "emotionalState": "anxious",
    "communicationPreference": "hindi"
  },
  "scenario": "cross_examination_prep",
  "jurisdiction": "IN"
}
```

### POST /api/nv/twins/sessions/:sessionId/interact
Interact with the digital twin.

### GET /api/nv/twins/sessions/:sessionId/insights
Get insights from the twin simulation.

---

## 16. MCP Tools API

### GET /api/nv/mcp/tools
List available MCP tools.

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "NYV-MCP-GITHUB-001",
      "name": "GitHub Repository Tool",
      "description": "Interact with GitHub repositories",
      "category": "developer",
      "inputSchema": {...},
      "requiredScopes": ["mcp:execute"]
    },
    {
      "id": "NYV-MCP-DBQUERY-001",
      "name": "Database Query Tool",
      "description": "Execute read-only database queries",
      "category": "data"
    }
  ]
}
```

### POST /api/nv/mcp/tools/:toolId/execute
Execute an MCP tool.

**Available Tools:**
| Tool ID | Name | Category |
|---|---|---|
| NYV-MCP-GITHUB-001 | GitHub Repository Tool | Developer |
| NYV-MCP-DBQUERY-001 | Database Query Tool | Data |
| NYV-MCP-SQS-001 | SQS Batch Processing | Infrastructure |
| NYV-MCP-SEARCH-001 | Web Search Tool | Research |
| NYV-MCP-SCRAPE-001 | Web Scraping Tool | Research |
| NYV-MCP-DOC-001 | Document Processing Tool | Documents |
| NYV-MCP-CODE-001 | Code Execution Tool | Developer |
| NYV-MCP-STORAGE-001 | Storage Tool | Infrastructure |
| NYV-MCP-EMAIL-001 | Email Notification Tool | Communication |
| NYV-MCP-CALENDAR-001 | Calendar Tool | Productivity |

---

## 17. Webhook Events API

### POST /api/nv/webhooks
Register a webhook endpoint.

### GET /api/nv/webhooks
List registered webhooks.

### DELETE /api/nv/webhooks/:id
Remove a webhook.

### Supported Events

| Event | Trigger |
|---|---|
| `agent.started` | Agent execution begins |
| `agent.completed` | Agent execution completes |
| `agent.failed` | Agent execution fails |
| `document.uploaded` | Document uploaded |
| `document.analyzed` | Document analysis complete |
| `batch.completed` | Batch processing complete |
| `key.rotated` | API key rotated |
| `key.revoked` | API key revoked |
| `memory.updated` | Memory entry created/updated |
| `case.updated` | Case status changed |
| `compliance.alert` | Compliance violation detected |
| `credit.low` | Credit balance below threshold |

### Webhook Signature Verification

```typescript
import crypto from 'crypto';

function verifyWebhookSignature(payload: string, signature: string, secret: string): boolean {
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}
```

---

## 18. Health & Monitoring API

### GET /api/nv/health
Basic health check (no auth required).

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2026-04-14T10:00:00Z",
  "responseTime": 5,
  "version": "v5.0.0",
  "uptime": 86400,
  "environment": "production"
}
```

### GET /api/nv/health/full
Full health check including all sub-services.

**Response:**
```json
{
  "status": "healthy",
  "services": {
    "database": { "status": "healthy", "latencyMs": 3 },
    "redis": { "status": "healthy", "latencyMs": 1 },
    "llm": { "status": "healthy", "provider": "openrouter", "model": "claude-sonnet-4-6" },
    "orchestration": { "status": "healthy" },
    "rag": { "status": "healthy", "documentsIndexed": 305 },
    "voice": { "status": "healthy", "providers": ["deepgram", "sarvam", "whisper"] },
    "memory": { "status": "healthy", "tiersActive": 5 }
  }
}
```

---

## 19. 22 Agentic Patterns — Full Reference

### Pattern 1: NyayaRAG
Legal Retrieval-Augmented Generation with Indian legal corpus.
```typescript
await nyv.patterns.nyayaRag({
  task: "What is the limitation period for filing a civil suit?",
  jurisdiction: "IN",
  sources: ["statutes", "case_law"],
  maxCitations: 5,
});
```

### Pattern 2: HumanInTheLoop (HITL)
AI-assisted decisions requiring human approval before execution.
```typescript
await nyv.patterns.humanInTheLoop({
  task: "Review and approve this settlement draft",
  document: draftText,
  approvalRequired: true,
  escalationTimeoutMinutes: 60,
});
```

### Pattern 3: MultiModalLegal
Process text, images, audio, and video for legal analysis.
```typescript
await nyv.patterns.multiModal({
  text: "Analyze this evidence",
  images: [evidencePhoto],
  audioUrl: "https://...",
  analysisType: "evidence_review",
});
```

### Pattern 4: ConversationalAgent
Multi-turn conversational AI for legal consultations.

### Pattern 5: DocumentAnalysis
Comprehensive document parsing, extraction, and analysis.

### Pattern 6: JudgeSimulator
Simulate judicial reasoning and bench perspective.
```typescript
await nyv.patterns.judgeSimulator({
  case: caseDetails,
  role: "petitioner",
  benchSize: 3,
  court: "supreme_court",
});
```

### Pattern 7: ParallelResearch
Execute multiple research queries simultaneously.

### Pattern 8: IterativeRefinement
Progressive improvement of AI outputs through multiple passes.

### Pattern 9: ChainOfLegalThought
Step-by-step legal reasoning chain with citations.

### Pattern 10: AdversarialReview
Review from opposing counsel's perspective.

### Pattern 11: PrecedentMining
Deep mining of relevant case law precedents.

### Pattern 12: ContractNegotiation
Simulate contract negotiation between parties.

### Pattern 13: HierarchicalOrchestration
Multi-level agent orchestration with task decomposition.
```typescript
await nyv.patterns.hierarchicalOrchestration({
  task: "Complete M&A due diligence",
  subTasks: [
    { agent: "regulatory-analysis", focus: "competition-law" },
    { agent: "ip-analysis", focus: "patent-portfolio" },
    { agent: "financial-analysis", focus: "valuation" },
  ],
  coordination: "parallel",
  consolidation: "summary_report",
});
```

### Pattern 14: FederatedPrivacy
Privacy-preserving analysis across organizational boundaries.

### Pattern 15: BatchProcessing
High-volume document or query processing.

### Pattern 16: RealTimeMonitoring
Continuous monitoring of legal events and triggers.

### Pattern 17: SelfHealingPipeline
Auto-recovery from failures with fallback chains.

### Pattern 18: AutonomousExecution
Long-running autonomous agent tasks with checkpointing.

### Pattern 19: MultiAgentDebate
Multiple agents debating from different perspectives.
```typescript
await nyv.patterns.multiAgentDebate({
  topic: "Constitutional validity of Aadhaar mandate",
  perspectives: ["petitioner", "respondent", "amicus_curiae"],
  rounds: 3,
  moderator: "constitutional-law-expert",
});
```

### Pattern 20: ConsensusBuilding
Build consensus across multiple stakeholders/agents.

### Pattern 21: EscalationChain
Automated escalation from junior to senior agents based on complexity.

### Pattern 22: GRPOOptimization
Group Relative Policy Optimization for model fine-tuning.

---

## 20. 5-Tier Memory Architecture

### Architecture Diagram
```
┌─────────────────────────────────────────────────────────┐
│ L5: Precedent Memory (Immutable)                        │
│   Universal legal principles, landmark judgments         │
│   Table: nv_precedent_memory | TTL: Never expires       │
├─────────────────────────────────────────────────────────┤
│ L4: Jurisdictional Memory (Permanent)                   │
│   Court-specific precedents, local rules                │
│   Table: nv_jurisdictional_memory | TTL: Never expires  │
├─────────────────────────────────────────────────────────┤
│ L3: Client Memory (Permanent)                           │
│   Cross-matter client preferences, history              │
│   Table: nv_client_memory | TTL: Permanent              │
├─────────────────────────────────────────────────────────┤
│ L2: Matter Memory (365 days)                            │
│   Case-specific facts, strategy, communications        │
│   Table: nv_matter_memory | TTL: 365 days               │
├─────────────────────────────────────────────────────────┤
│ L1: Session Memory (24 hours)                           │
│   Current conversation context, working memory          │
│   Table: nv_memory_entries | TTL: 24 hours              │
└─────────────────────────────────────────────────────────┘
```

### Platform Access by Tier

| Platform | L1 | L2 | L3 | L4 | L5 |
|---|---|---|---|---|---|
| Nyayamitra | Yes | Yes | - | - | - |
| Professional | Yes | Yes | Yes | - | - |
| Institutional | Yes | Yes | Yes | Yes | Yes |
| Academy | Yes | Yes | - | - | - |
| Ministry | Yes | Yes | Yes | Yes | Yes |

---

## 21. LLM Provider Configuration

### 23 Integrated Providers

| Provider | Models | Best For |
|---|---|---|
| OpenAI | GPT-4.1, GPT-4.1-nano, o3, o4-mini | General, reasoning |
| Anthropic | Claude Opus 4.6, Sonnet 4.6 | Legal analysis, safety |
| Google | Gemini 2.5 Flash, Gemini 2.5 Pro | Fast, multilingual |
| OpenRouter | All models via single API | Fallback, cost optimization |
| Groq | LLaMA 3.3 70B, Mixtral 8x7B | Ultra-low latency |
| Sarvam AI | Sarvam-2B, Sarvam-Translate | Indian languages |
| DeepSeek | DeepSeek-V3, DeepSeek-R1 | Code, reasoning |
| Mistral AI | Mistral Large 2 | European compliance |
| Cohere | Command R+ | RAG, embeddings |
| Perplexity | Sonar Pro | Research, citations |
| Together AI | Open-source models | Cost-effective |
| Fireworks AI | Serverless inference | Low latency |
| Meta LLaMA | LLaMA 3.1 405B | Open-source sovereign |
| NVIDIA NIM | NIM inference | Enterprise deployment |
| Azure OpenAI | Azure-hosted GPT-4 | Compliance, SLA |
| AWS Bedrock | Bedrock-hosted models | AWS integration |
| Alibaba Qwen | Qwen 2.5 | Multilingual |
| Kimi (Moonshot) | Moonshot-v1 | Long context |
| Google Gemma | Gemma 2 | Lightweight |
| Replicate | Various | Specialized models |
| Hugging Face | Open-source | Custom models |
| Exa | Search AI | Semantic search |
| Tavily | Search API | Legal research |

### Default LLM by Platform

| Platform | Primary | Fallback | Tier |
|---|---|---|---|
| Nyayamitra | Gemini 2.5 Flash | GPT-4.1-nano | Minimal |
| Professional | Claude Sonnet 4.6 | GPT-4.1 | Balanced |
| Institutional | Claude Opus 4.6 | O3 | Premium |
| Academy | GPT-4.1 | Gemini 2.5 Flash | Balanced |
| Ministry | O3 | Claude Opus 4.6 | Sovereign |

---

## 22. SDK Variant Feature Matrix

| Feature | Nyayamitra | Professional | Institutional | Academy | Ministry |
|---|---|---|---|---|---|
| AI Orchestration | Yes | Yes | Yes | Yes | Yes |
| SSE Streaming | Yes | Yes | Yes | Yes | Yes |
| RAG Search | Yes | Yes | Yes | Yes | Yes |
| Document Analysis | Yes | Yes | Yes | Yes | Yes |
| Voice STT | Yes | Yes | Yes | Yes | Yes |
| Voice TTS | Yes | Yes | Yes | - | Yes |
| Memory L1-L2 | Yes | Yes | Yes | Yes | Yes |
| Memory L3 | - | Yes | Yes | - | Yes |
| Memory L4-L5 | - | - | Yes | - | Yes |
| Digital Twin | - | Yes | Yes | - | Yes |
| MCP Tools | - | Yes | Yes | Yes | Yes |
| Case Management | - | Yes | Yes | - | Yes |
| Client Management | - | Yes | Yes | - | - |
| Billing | - | Yes | Yes | - | - |
| Compliance | Yes | Yes | Yes | Yes | Yes |
| Audit Log | Yes | Yes | Yes | Yes | Yes |
| PII Vault | Yes | Yes | Yes | - | Yes |
| Hallucination Check | Yes | Yes | Yes | Yes | Yes |
| Multi-Jurisdiction | - | Yes | Yes | Yes | - |
| A2A Collaboration | - | Yes | Yes | - | Yes |
| GRPO Optimization | - | - | Yes | - | Yes |
| BMAD Clusters | - | - | Yes | - | Yes |
| Custom Agents | - | Yes | Yes | - | Yes |
| WhatsApp | Yes | Yes | Yes | - | - |
| Email Automation | - | Yes | Yes | - | Yes |
| Analytics | - | Yes | Yes | Yes | Yes |
| Credit System | Yes | Yes | Yes | Yes | - |
| Webhooks | - | Yes | Yes | - | Yes |
| Sandbox Mode | - | - | - | Yes | - |
| Compliance Level | Standard | Enhanced | Sovereign | Standard | Sovereign |

---

## 23. Error Code Reference

### HTTP Status Codes

| Code | Meaning | Retry? |
|---|---|---|
| 200 | Success | N/A |
| 201 | Created | N/A |
| 400 | Bad Request | No |
| 401 | Unauthorized | No (re-auth) |
| 403 | Forbidden | No |
| 404 | Not Found | No |
| 409 | Conflict | No |
| 422 | Validation Error | No (fix input) |
| 429 | Rate Limited | Yes (after delay) |
| 500 | Internal Error | Yes |
| 502 | LLM Provider Error | Yes |
| 503 | Service Degraded | Yes (after delay) |

### Application Error Codes

| Code | Description | Resolution |
|---|---|---|
| `AUTH_INVALID_CREDENTIALS` | Wrong email/password | Check credentials |
| `AUTH_TOKEN_EXPIRED` | JWT expired | Refresh token |
| `AUTH_KEY_REVOKED` | API key revoked | Generate new key |
| `AUTH_INSUFFICIENT_SCOPE` | Missing required scope | Request scope upgrade |
| `RATE_LIMIT_EXCEEDED` | Too many requests | Wait and retry |
| `TOKEN_BUDGET_EXCEEDED` | Token budget exhausted | Wait for reset or upgrade |
| `AGENT_NOT_FOUND` | Invalid agent key | Check agent registry |
| `AGENT_TIER_REQUIRED` | Agent needs higher tier | Upgrade subscription |
| `JURISDICTION_UNSUPPORTED` | Invalid jurisdiction | Use supported code |
| `DOCUMENT_TOO_LARGE` | File exceeds limit | Compress or split |
| `DOCUMENT_FORMAT_UNSUPPORTED` | Unsupported file type | Use PDF, DOCX, images |
| `PII_DETECTED` | PII found in input | Enable autoVault |
| `HALLUCINATION_FLAGGED` | Response flagged for hallucination | Review manually |
| `LLM_TIMEOUT` | LLM provider timeout | Retry or use fallback |
| `LLM_QUOTA_EXCEEDED` | Provider quota hit | Switch provider |
| `MEMORY_TIER_UNAVAILABLE` | Memory tier not in plan | Upgrade tier |
| `WEBHOOK_DELIVERY_FAILED` | Webhook endpoint unreachable | Check endpoint URL |
| `BATCH_LIMIT_EXCEEDED` | Too many items in batch | Reduce batch size |

---

## 24. Data Models & Schemas

### User

```typescript
interface NyvUser {
  id: number;
  email: string;
  role: 'super_admin' | 'admin' | 'manager' | 'developer' | 'analyst' | 'operator' | 'user';
  tier: 'free' | 'solo' | 'plus' | 'pro' | 'enterprise' | 'government' | 'internal';
  organizationId: number;
  jurisdiction: string;
  createdAt: string;
}
```

### SDK Application

```typescript
interface NyvSdkApplication {
  id: string;
  name: string;
  appType: 'consumer_intake' | 'lawyer_platform' | 'institutional' | 'government' | 'education' | 'custom';
  clientId: string;
  tier: string;
  jurisdiction: string;
  rateLimitPerMinute: number;
  dailyTokenBudget: number;
  monthlyTokenBudget: number;
  llmConfig: {
    defaultProvider: string;
    defaultModel: string;
    temperature: number;
    maxTokensPerRequest: number;
  };
  isActive: boolean;
  createdAt: string;
}
```

### API Key

```typescript
interface NyvApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  platform: NyvPlatformVariant;
  tier: string;
  permissions: string[];
  rateLimit: number;
  isActive: boolean;
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}
```

### Agent

```typescript
interface NyvAgent {
  key: string;
  name: string;
  description: string;
  practiceAreas: string[];
  jurisdiction: string;
  tier: string;
  version: string;
  inputSchema: object;
  capabilities: string[];
  avgResponseTimeMs: number;
  avgTokensUsed: number;
}
```

### Orchestration Response

```typescript
interface NyvOrchestrationResponse {
  success: boolean;
  data: {
    content: string;
    agentKey: string;
    model: string;
    tokensUsed: number;
    processingTimeMs: number;
    tier: string;
    cached: boolean;
    ragContext?: {
      documentsUsed: number;
      relevanceScore: number;
    };
    safety: {
      piiDetected: boolean;
      hallucinationScore: number;
      guardrailPassed: boolean;
    };
  };
  meta: {
    requestId: string;
    processingTimeMs: number;
    tokensUsed: number;
    model: string;
    cached: boolean;
  };
}
```

---

## 25. SDK Deployment Checklist

### Pre-Deployment

- [ ] SDK version set to `5.0.0` across all components
- [ ] API keys generated for all 5 platform variants
- [ ] Rate limits configured per platform tier
- [ ] LLM provider API keys configured (OpenAI, Anthropic, OpenRouter)
- [ ] Database migrated with all required tables
- [ ] Redis configured for rate limiting and session cache
- [ ] PII vault enabled and tested
- [ ] Audit log hash chain verified

### Per-Platform Deployment

- [ ] **Nyayamitra**: WhatsApp integration configured, Sarvam AI keys set
- [ ] **Professional**: Case management tables seeded, billing integration tested
- [ ] **Institutional**: GRPO training pipeline validated, BMAD clusters configured
- [ ] **Academy**: Sandbox mode enabled, quiz generators tested
- [ ] **Ministry**: Sovereign compliance verified, air-gap option tested

### Production Readiness

- [ ] Health check returns `healthy` on all sub-services
- [ ] Swagger documentation accessible at `/api/nv/docs`
- [ ] Rate limiting verified for all tiers
- [ ] Error responses follow standard envelope format
- [ ] Webhook delivery tested with retry logic
- [ ] SSL/TLS configured (AWS ACM)
- [ ] CloudFront CDN configured for static assets
- [ ] ElastiCache Redis cluster provisioned
- [ ] RDS/Aurora PostgreSQL failover tested
- [ ] Sentry error monitoring configured
- [ ] Grafana dashboards deployed

### Security Checklist

- [ ] All API keys SHA-256 hashed in database
- [ ] PII detection enabled on all AI orchestration endpoints
- [ ] Math.random() eliminated (using crypto.randomBytes)
- [ ] JWT secrets rotated and stored in AWS Secrets Manager
- [ ] CORS configured for production domains only
- [ ] Rate limiting active on all public endpoints
- [ ] Audit log hash chain integrity verified
- [ ] Input validation on all endpoints (Zod schemas)

---

*Nyayavigya SDK v5.0.0 | Platform 3.1.2 | API Reference v1.0 | April 14, 2026*
*Total Endpoints: 45+ | Agents: 1,043 | Patterns: 22 | Jurisdictions: 7*
*Production Target: May 15, 2026 | AWS ap-south-1 (Mumbai)*
