---
status: completed
version: v5.0.0
canonical: true
locked: true
locked_reason: "Operator policy 2026-04-30T18:00Z — SDK is frozen at v5.0.0 stable until next major release. Do not bump version without explicit operator approval."
last_verified: 2026-04-30
---
# Nyayavigya SDK v5.0.0 — Integration Guide

> ## ⚠️ VERSION LOCK NOTICE — SDK v5.0.0 STABLE (2026-04-30)
>
> The Nyayavigya SDK is **frozen at v5.0.0** as the long-term stable
> release. The previously planned v6.0.0 work has been **cancelled** and
> archived under `docs/v3.1.2/superseded/NYV-SDK-v6-*.md`.
>
> - **All 6 SDK packages** (`@nyayavigya/{client-sdk,react-hooks,nyayamitra-sdk,enterprise-sdk,types,react-native}`) ship at `5.0.0`.
> - **All inter-package deps** are pinned at `^5.0.0`.
> - **All runtime config** (`src/config/{platform-config,nyv-master-config,nv-product-config,nyv-sdk-production-config}.ts`) reads `5.0.0`.
> - **Do NOT bump** the SDK version under any circumstances until the next major release is explicitly authorised by the operator.
> - The canonical pin is recorded in `Project-Tracker.md` §1.

---



**Platform 3.1.2 | Production Target: May 15, 2026 | AWS ap-south-1**

---

## Table of Contents

1. [Overview](#1-overview)
2. [Architecture](#2-architecture)
3. [Platform Variants](#3-platform-variants)
4. [Authentication & API Keys](#4-authentication--api-keys)
5. [Quick Start](#5-quick-start)
6. [SDK Client Installation](#6-sdk-client-installation)
7. [Core Integration Patterns](#7-core-integration-patterns)
8. [Platform-Specific Integration](#8-platform-specific-integration)
9. [Rate Limits & Quotas](#9-rate-limits--quotas)
10. [Error Handling](#10-error-handling)
11. [Security Best Practices](#11-security-best-practices)
12. [Webhook Integration](#12-webhook-integration)
13. [Environment Setup](#13-environment-setup)
14. [Demo Credentials](#14-demo-credentials)
15. [Support & Resources](#15-support--resources)

---

## 1. Overview

The Nyayavigya SDK v5.0.0 is the unified AI backbone for the entire Nyayasiddhi legal technology ecosystem. It provides a single integration point for all AI, automation, intelligence, and agentic tasks across all five Nyayasiddhi platforms.

### Key Capabilities

| Capability | Details |
|---|---|
| Legal AI Agents | 1,043 agents across 29 practice areas |
| Jurisdictions | 7 supported (IN, UK, US, GC, SG, EU, DEFAULT) |
| Agentic Patterns | 22 patterns (RAG, HITL, Multi-Agent, etc.) |
| Languages | 22 Indian languages + English via Sarvam AI |
| LLM Providers | 23 integrated (OpenAI, Anthropic, Google, etc.) |
| Memory System | 5-tier hierarchical legal memory |
| Document Processing | OCR, extraction, analysis, drafting |
| Voice | Real-time STT (Deepgram/Sarvam/Whisper) + TTS |
| Compliance | PII vault, audit logs, hallucination checks |

### SDK Version History

| Version | Status | Notes |
|---|---|---|
| v5.0.0 | **Current** | Unified backbone for all Nyayasiddhi platforms |
| v3.1.2 | Platform | Core platform version (frozen) |

---

## 2. Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    NYAYASIDDHI ECOSYSTEM                        │
├─────────────┬─────────────┬──────────────┬──────────┬──────────┤
│ Nyayamitra  │ NYS-Pro     │ NYS-Inst     │ NYS-Acad │ NYS-Min  │
│ (Citizens)  │ (Lawyers)   │ (Enterprise) │ (Academy)│ (Govt)   │
├─────────────┴─────────────┴──────────────┴──────────┴──────────┤
│                  NYAYAVIGYA SDK v5.0.0                          │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐          │
│  │ AI Orch  │ │ Doc Pipe │ │ Memory   │ │ Voice    │          │
│  │ 1,043    │ │ OCR/NLP  │ │ 5-Tier   │ │ STT/TTS  │          │
│  │ Agents   │ │ Draft    │ │ L1-L5    │ │ 22 lang  │          │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘          │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐          │
│  │ RAG      │ │ MCP      │ │ Guardrail│ │ Credit   │          │
│  │ Legal    │ │ 10 Tools │ │ PII/Audit│ │ System   │          │
│  │ Corpus   │ │ External │ │ Safety   │ │ Billing  │          │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘          │
├────────────────────────────────────────────────────────────────┤
│  PostgreSQL/Neon | Redis | S3 | Qdrant | Neo4j                │
└────────────────────────────────────────────────────────────────┘
```

---

## 3. Platform Variants

The SDK serves 5 distinct platform variants, each pre-configured with appropriate agents, features, and limits:

### 3.1 Nyayamitra™ (Citizen Legal Intake)

| Property | Value |
|---|---|
| Code | `nyayamitra` |
| Audience | Citizens seeking legal assistance |
| Tier | Plus |
| Default LLM | Gemini 2.5 Flash |
| Rate Limit | 100 rpm / 5,000 rpd |
| Token Budget | 500K daily / 15M monthly |
| Max Tokens/Request | 2,048 |
| Agent Categories | 12 (intake, FIR drafting, RTI, consumer, family, property, labour) |
| Patterns | 5 (NyayaRAG, HITL, MultiModal, Conversational, DocAnalysis) |
| Memory Tiers | L1, L2 |
| Key Features | Voice STT/TTS (22 languages), WhatsApp, PII Vault, Credit System |
| Scopes | `agents:read`, `agents:execute`, `documents:read` |

### 3.2 Nyayasiddhi Professional™ (Practice Management OS)

| Property | Value |
|---|---|
| Code | `nys-professional` |
| Audience | Solo lawyers, small and mid-size law firms |
| Tier | Pro |
| Default LLM | Claude Sonnet 4.6 |
| Rate Limit | 60 rpm / 20,000 rpd |
| Token Budget | 200K daily / 6M monthly |
| Max Tokens/Request | 16,384 |
| Agent Categories | 18 (contract, research, case analysis, billing, IP, litigation) |
| Patterns | 12 (includes JudgeSimulator, PrecedentMining, ContractNegotiation) |
| Memory Tiers | L1, L2, L3 |
| Key Features | Case management, client mgmt, billing, digital twin, MCP tools, webhooks |
| Scopes | `agents:read/execute`, `documents:read/write`, `research:read`, `usage:read` |

### 3.3 Nyayasiddhi Institutional™ (Enterprise Legal Governance)

| Property | Value |
|---|---|
| Code | `nys-institutional` |
| Audience | Large law firms, multinational corporations |
| Tier | Enterprise |
| Default LLM | Claude Opus 4.6 |
| Rate Limit | 600 rpm / 200,000 rpd |
| Token Budget | 1M daily / 30M monthly |
| Max Tokens/Request | 32,768 |
| Agent Categories | 28 (all Professional + regulatory, ESG, M&A, sanctions, AML/KYC) |
| Patterns | 22 (all patterns including GRPO, BMAD, Federated Privacy) |
| Memory Tiers | L1, L2, L3, L4, L5 (full 5-tier) |
| Key Features | All features enabled, sovereign compliance, GRPO optimization, BMAD clusters |
| Scopes | `*` (all permissions) |

### 3.4 Nyayasiddhi Academy™ (Legal Intelligence Training)

| Property | Value |
|---|---|
| Code | `nys-academy` |
| Audience | Law students, legal professionals, bar associations |
| Tier | Pro |
| Default LLM | GPT-4.1 |
| Rate Limit | 80 rpm / 5,000 rpd |
| Token Budget | 300K daily / 9M monthly |
| Max Tokens/Request | 8,192 |
| Agent Categories | 12 (moot court, exam tutor, writing coach, quiz generator) |
| Patterns | 10 (includes JudgeSimulator, AdversarialReview, PrecedentMining) |
| Memory Tiers | L1, L2 |
| Key Features | MCP tools, analytics, sandbox mode, hallucination checks |
| Scopes | `agents:read/execute`, `documents:read`, `research:read` |

### 3.5 Nyayasiddhi Ministry™ (Sovereign Regulatory Governance)

| Property | Value |
|---|---|
| Code | `nys-ministry` |
| Audience | Government ministries, regulatory bodies, judiciary |
| Tier | Government |
| Default LLM | O3 |
| Rate Limit | 200 rpm / 200,000 rpd |
| Token Budget | 2M daily / 60M monthly |
| Max Tokens/Request | 32,768 |
| Agent Categories | 20 (policy drafting, judicial analytics, sanctions, constitutional) |
| Patterns | 22 (all patterns including SovereignDeployment) |
| Memory Tiers | L1, L2, L3, L4, L5 (full 5-tier) |
| Key Features | Sovereign compliance, PQC-ready, air-gap option, GRPO, BMAD |
| Scopes | `*` (all permissions) |

---

## 4. Authentication & API Keys

### 4.1 Key Format

```
Production:  nyv_live_sk_{platform}_{48-char-hex}
Sandbox:     nyv_test_sk_{platform}_{48-char-hex}

Platform codes: nym (Nyayamitra), nsp (Professional), nsi (Institutional),
                nsa (Academy), nsm (Ministry)
```

### 4.2 Authentication Methods

**Method 1: Bearer Token (JWT)**
```http
Authorization: Bearer <jwt_token>
```
Obtain JWT via `POST /api/nv/auth/login` with email/password.

**Method 2: SDK API Key**
```http
Authorization: Bearer nyv_live_sk_nsp_c6280c97...
```
Use directly in the Authorization header for SDK-level access.

**Method 3: Inter-Service Auth**
```http
X-NSP-Inter-Secret: <inter_service_secret>
```
For platform-to-platform internal calls (NSP ↔ NSI ↔ NyayaMitra).

### 4.3 Key Security

- Keys are **SHA-256 hashed** before database storage
- Raw keys are returned **only once** at creation time
- Keys can be rotated via the SDK Console or API
- Revoked keys immediately cease to function
- All key usage is logged in `nv_audit_logs` with SHA-256 hash chain

### 4.4 Pre-issued Dev Key (EC2 dev gateway, v5.0.0 lockdown)

A **live, end-to-end-verified** SDK key has been issued against the
**EC2 dev gateway** at `http://13.232.165.242` for the v5.0.0 lockdown
integration phase. Operator distributes this key out-of-band; it is
**NOT** committed to the repo.

| Field | Value |
| --- | --- |
| Issued at | 2026-04-30T18:40Z |
| Verified | 2026-04-30T18:42Z (HTTP 200 on `/api/nv/gateway/agents`) |
| Application ID (`sdk_applications.id`) | `7` |
| Client ID | `nyv_sdk_v5_dev_38b982f0` |
| API Key ID (`sdk_app_api_keys.id`) | `6` |
| Key Prefix | `nyv_live_sk_5f50` |
| Key Hash (16) | `8637fbb5f76206db…` |
| Tier | enterprise |
| Tenant | `org_id=1` (Nyayavigya Demo Tenant) |
| Scopes | `["*", "agents:execute", "documents:analyze", "research:query", "translate"]` |
| Rate limit | 300 req/min |
| Daily token budget | 500,000 |
| Monthly token budget | 5,000,000 |
| Stored at | `.local/secrets/nyv-sdk-v5-api-key.txt` (operator console only, mode 600) |

**Quickstart against dev gateway:**

```bash
# Replace KEY with the raw value from .local/secrets/nyv-sdk-v5-api-key.txt
export NYV_KEY="nyv_live_sk_5f50…"

# 1. Public health (no auth)
curl http://13.232.165.242/api/nv/health

# 2. List allowed agents (SDK auth)
curl -H "Authorization: Bearer $NYV_KEY" \
  http://13.232.165.242/api/nv/gateway/agents

# 3. Execute an agent (SDK auth)
curl -X POST \
  -H "Authorization: Bearer $NYV_KEY" \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Summarize section 138 of the Negotiable Instruments Act", "agent": "legal-research"}' \
  http://13.232.165.242/api/nv/gateway/agents/legal-research/execute
```

> **Operator notes**:
> - The route mount is `/api/nv/gateway/*` (NOT `/api/nv/sdk/*` — the
>   latter is reserved for the SDK Console UI which uses JWT auth).
> - To issue additional keys for downstream consumers, INSERT into
>   `sdk_applications` + `sdk_app_api_keys` (the tables actually read by
>   the `sdkGatewayAuth` middleware), or use the Console "Create App"
>   wizard. Do **NOT** use the `/api/nv/sdk/provision/create-app` route
>   — it writes to `nv_api_keys` which is a parallel/legacy table that
>   `sdkGatewayAuth` does not consult.
> - Rotate this dev key via `UPDATE sdk_app_api_keys SET is_active=false
>   WHERE id=6` and re-provision.

---

## 5. Quick Start

### 5.1 Using cURL

```bash
# 1. Health Check (no auth required)
curl https://app.nyayavigya.in/api/nv/health

# 2. Authenticate (request demo credentials from operator out-of-band — NEVER
#    commit live credentials to docs)
curl -X POST https://app.nyayavigya.in/api/nv/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "<demo-account-email>", "password": "<demo-account-password>"}'

# 3. Run an AI agent
curl -X POST https://app.nyayavigya.in/api/nv/orchestrate \
  -H "Authorization: Bearer <your_api_key>" \
  -H "Content-Type: application/json" \
  -d '{
    "agentKey": "contract-review-specialist",
    "prompt": "Review this NDA clause for risks: The party agrees to...",
    "jurisdiction": "IN",
    "tier": "pro"
  }'

# 4. Stream AI response (SSE)
curl -X POST https://app.nyayavigya.in/api/nv/stream \
  -H "Authorization: Bearer <your_api_key>" \
  -H "Content-Type: application/json" \
  -d '{
    "agentKey": "legal-research-analyst",
    "prompt": "Find precedents for Section 138 NI Act cases in 2024",
    "stream": true
  }'

# 5. Search legal corpus
curl "https://app.nyayavigya.in/api/nv/legal-corpus/search?q=Section%20420%20BNS&limit=5" \
  -H "Authorization: Bearer <your_api_key>"

# 6. List available agents
curl https://app.nyayavigya.in/api/nv/agents \
  -H "Authorization: Bearer <your_api_key>"
```

### 5.2 Using the TypeScript SDK Client

```typescript
import NyvClient from '@nyayavigya/sdk';

const nyv = new NyvClient({
  apiKey: 'nyv_live_sk_nsp_...',
  baseUrl: 'https://app.nyayavigya.in',
  defaultJurisdiction: 'IN',
  defaultPlatform: 'nys-professional',
});

// Health check
const health = await nyv.healthCheck();
console.log(health.status); // 'ok'

// Ask a legal question (uses NyayaRAG pattern)
const answer = await nyv.ask('What are the grounds for divorce under Hindu Marriage Act?');
console.log(answer);

// Analyze a document
const fileBuffer = fs.readFileSync('contract.pdf');
const analysis = await nyv.analyzeDocument(fileBuffer, 'contract.pdf');
console.log(analysis);

// Run a specific agent
const result = await nyv.patterns.nyayaRag({
  task: 'Draft a non-disclosure agreement for a tech startup',
  jurisdiction: 'IN',
});

// Stream response
const stream = await nyv.stream.connect('/api/nv/stream', {
  agentKey: 'contract-drafter',
  prompt: 'Draft employment contract for senior developer',
});
for await (const token of stream) {
  process.stdout.write(token);
}
```

---

## 6. SDK Client Installation

### 6.1 TypeScript/JavaScript

```bash
npm install @nyayavigya/sdk
# or
pnpm add @nyayavigya/sdk
```

### 6.2 Configuration

```typescript
const nyv = new NyvClient({
  apiKey: 'nyv_live_sk_...',           // Required
  baseUrl: 'https://app.nyayavigya.in', // Default production URL
  defaultJurisdiction: 'IN',           // Default: 'IN'
  defaultPlatform: 'nys-professional', // Your platform variant
  timeout: 30_000,                     // Request timeout (ms)
  debug: false,                        // Enable debug logging
});
```

### 6.3 Available API Modules

| Module | Access | Description |
|---|---|---|
| `nyv.patterns` | All tiers | 22 agentic patterns (NyayaRAG, HITL, etc.) |
| `nyv.documents` | All tiers | Document upload, OCR, extraction, analysis |
| `nyv.agents` | All tiers | Agent registry, execution, configuration |
| `nyv.skills` | Pro+ | Skill marketplace and custom skills |
| `nyv.twins` | Pro+ | Digital twin management |
| `nyv.knowledge` | All tiers | Knowledge base and RAG queries |
| `nyv.voice` | All tiers | STT/TTS voice interactions |
| `nyv.intelligence` | Pro+ | Case risk analysis, legal intelligence |
| `nyv.testing` | All tiers | Sandbox testing and validation |
| `nyv.compliance` | All tiers | Compliance checks and audit logs |
| `nyv.nyayaTools` | Pro+ | MCP tool execution |
| `nyv.memory` | All tiers | 5-tier memory system |
| `nyv.cache` | All tiers | Response caching |
| `nyv.credits` | All tiers | Credit balance and usage |
| `nyv.stream` | All tiers | SSE streaming client |

---

## 7. Core Integration Patterns

### 7.1 AI Orchestration (Core Pattern)

Every AI request flows through the **10-step safety pipeline**:

```
User Request → Rate Limit → Auth Check → PII Detection → Prompt Enhancement →
Agent Selection → LLM Execution → Response Engineering → Hallucination Check →
Audit Log → Response
```

```typescript
// Basic orchestration
const result = await fetch('/api/nv/orchestrate', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    agentKey: 'contract-review-specialist',
    prompt: 'Review this merger agreement for anti-trust risks',
    jurisdiction: 'IN',
    tier: 'pro',
    useRAG: true,
    matterId: 12345,     // Optional: link to case/matter
    orgId: 1,            // Optional: org-scoped memory
  }),
});
```

### 7.2 Document Analysis Pipeline

```typescript
// Upload and analyze a legal document
const formData = new FormData();
formData.append('file', documentFile);
formData.append('jurisdiction', 'IN');
formData.append('analysisType', 'contract_review');

const analysis = await fetch('/api/nv/sdk/documents/analyze', {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${apiKey}` },
  body: formData,
});

// Response includes:
// - Extracted text (OCR if scanned)
// - Key clauses identified
// - Risk assessment
// - Compliance flags
// - Suggested amendments
```

### 7.3 Voice Integration (STT)

```typescript
// WebSocket connection for real-time speech-to-text
const ws = new WebSocket('wss://app.nyayavigya.in/api/nv/voice/stream');

ws.onopen = () => {
  ws.send(JSON.stringify({
    type: 'config',
    provider: 'sarvam',   // or 'deepgram', 'whisper'
    language: 'hi',        // Hindi (22 Indian languages supported)
    legalMode: true,       // Enable legal vocabulary boosting
    sessionId: 'court-hearing-001',
  }));
};

// Send audio chunks
ws.send(audioBuffer); // 16kHz, 16-bit PCM

// Receive transcriptions
ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  if (data.type === 'transcript') {
    console.log(`[${data.isFinal ? 'FINAL' : 'INTERIM'}] ${data.text}`);
    // Legal terms auto-enhanced: "BNS Section 302" not "bns section three oh two"
  }
};
```

### 7.4 Memory System (5-Tier)

```typescript
// L1: Session memory (auto-managed)
// L2: Matter memory (case-specific)
await fetch('/api/nv/memory/matter', {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    matterId: 'CASE-2026-001',
    key: 'client_preferences',
    value: { preferredLanguage: 'hi', communicationChannel: 'whatsapp' },
    tier: 2,
  }),
});

// L3: Client memory (cross-matter)
// L4: Jurisdictional memory (precedent-aware)
// L5: Precedent memory (immutable legal knowledge)
```

---

## 8. Platform-Specific Integration

### 8.1 Nyayamitra Integration

```typescript
const nyv = new NyvClient({
  apiKey: 'nyv_live_sk_nym_...',
  defaultPlatform: 'nyayamitra',
  defaultJurisdiction: 'IN',
});

// Citizen intake flow
const intake = await nyv.patterns.nyayaRag({
  task: 'I received a notice from my landlord to vacate within 7 days. What are my rights?',
  jurisdiction: 'IN',
});

// FIR drafting
const fir = await nyv.agents.execute('fir-drafting-assistant', {
  prompt: 'Draft an FIR for theft of mobile phone from railway station',
  jurisdiction: 'IN',
});

// WhatsApp-ready response format
const whatsappResponse = await nyv.patterns.conversational({
  task: intake.data.content,
  outputFormat: 'whatsapp',
  language: 'hi',
});
```

### 8.2 Nyayasiddhi Professional Integration

```typescript
const nyv = new NyvClient({
  apiKey: 'nyv_live_sk_nsp_...',
  defaultPlatform: 'nys-professional',
});

// Case management
const caseAnalysis = await nyv.intelligence.analyzeCaseRisk({
  caseId: 'CASE-2026-001',
  jurisdiction: 'IN',
  practiceArea: 'criminal-law',
});

// Contract review with opposing counsel simulation
const review = await nyv.patterns.adversarialReview({
  document: contractText,
  perspective: 'opposing_counsel',
  jurisdiction: 'IN',
});

// Digital twin for client simulation
const twinSession = await nyv.twins.createSession({
  clientProfile: { name: 'Demo Client', caseType: 'property_dispute' },
  scenario: 'cross_examination_prep',
});
```

### 8.3 Nyayasiddhi Institutional Integration

```typescript
const nyv = new NyvClient({
  apiKey: 'nyv_live_sk_nsi_...',
  defaultPlatform: 'nys-institutional',
});

// Multi-agent orchestration
const dueDiligence = await nyv.patterns.hierarchicalOrchestration({
  task: 'Full M&A due diligence for target company',
  subTasks: [
    { agent: 'regulatory-analysis', focus: 'competition-law' },
    { agent: 'ip-analysis', focus: 'patent-portfolio' },
    { agent: 'esg-compliance', focus: 'environmental-risks' },
    { agent: 'aml-kyc', focus: 'beneficial-ownership' },
  ],
  jurisdiction: 'IN',
});

// Batch document processing
const batchJob = await nyv.documents.batchAnalyze({
  documents: arrayOfFileBuffers,
  analysisType: 'contract_review',
  priority: 'high',
});

// GRPO model optimization
const optimized = await nyv.patterns.grpoOptimization({
  task: 'Optimize contract review accuracy for real estate domain',
  trainingData: historicalReviews,
});
```

### 8.4 Nyayasiddhi Academy Integration

```typescript
const nyv = new NyvClient({
  apiKey: 'nyv_live_sk_nsa_...',
  defaultPlatform: 'nys-academy',
});

// Moot court simulation
const mootCourt = await nyv.patterns.judgeSimulator({
  case: 'Constitutional validity of Section 377',
  role: 'petitioner',
  benchSize: 3,
  jurisdiction: 'IN',
});

// Exam preparation
const quiz = await nyv.agents.execute('quiz-generator', {
  prompt: 'Generate 20 MCQs on Indian Contract Act 1872',
  difficulty: 'advanced',
  jurisdiction: 'IN',
});

// Legal writing feedback
const feedback = await nyv.agents.execute('legal-writing-coach', {
  prompt: writerDraftText,
  format: 'judgment_summary',
  jurisdiction: 'IN',
});
```

### 8.5 Nyayasiddhi Ministry Integration

```typescript
const nyv = new NyvClient({
  apiKey: 'nyv_live_sk_nsm_...',
  defaultPlatform: 'nys-ministry',
});

// Policy impact analysis
const impact = await nyv.patterns.multiAgentDebate({
  task: 'Analyze impact of proposed Digital India Act on data privacy rights',
  perspectives: ['civil_liberties', 'law_enforcement', 'industry', 'judiciary'],
  jurisdiction: 'IN',
});

// Judicial analytics
const analytics = await nyv.intelligence.judicialAnalytics({
  court: 'supreme_court',
  subject: 'right_to_privacy',
  dateRange: { from: '2020-01-01', to: '2026-04-14' },
});

// Inter-ministry coordination
const coordination = await nyv.patterns.consensusBuilding({
  stakeholders: ['MoLJ', 'MeitY', 'MHA'],
  proposal: 'Unified legal identity framework',
  constraints: ['DPDPA_2023', 'IT_Act_2000'],
});
```

---

## 9. Rate Limits & Quotas

### 9.1 Tier-Based Rate Limits

| Tier | RPM | RPD | Token Budget (Daily) | Token Budget (Monthly) |
|---|---|---|---|---|
| Free | 10 | 500 | 10,000 | 300,000 |
| Solo | 20 | 2,000 | 50,000 | 1,500,000 |
| Plus | 40 | 5,000 | 500,000 | 15,000,000 |
| Pro | 60 | 20,000 | 200,000 | 6,000,000 |
| Enterprise | 600 | 200,000 | 1,000,000 | 30,000,000 |
| Government | 200 | 200,000 | 2,000,000 | 60,000,000 |
| Internal | 9,999 | Unlimited | Unlimited | Unlimited |

### 9.2 Rate Limit Headers

Every API response includes rate limit headers:

```http
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 45
X-RateLimit-Reset: 1713091200
X-TokenBudget-Remaining: 185000
```

### 9.3 Rate Limit Exceeded Response

```json
{
  "success": false,
  "error": "Rate limit exceeded",
  "code": "RATE_LIMIT_EXCEEDED",
  "retryAfter": 12
}
```

---

## 10. Error Handling

### 10.1 Error Response Format

```json
{
  "success": false,
  "error": "Human-readable error message",
  "code": "ERROR_CODE",
  "details": {}
}
```

### 10.2 Error Codes

| HTTP | Code | Description |
|---|---|---|
| 400 | `INVALID_REQUEST` | Malformed request body |
| 400 | `INVALID_AGENT_KEY` | Agent key not found in registry |
| 400 | `INVALID_JURISDICTION` | Unsupported jurisdiction code |
| 401 | `UNAUTHORIZED` | Missing or invalid authentication |
| 401 | `TOKEN_EXPIRED` | JWT token has expired |
| 401 | `KEY_REVOKED` | API key has been revoked |
| 403 | `FORBIDDEN` | Insufficient permissions/scopes |
| 403 | `TIER_INSUFFICIENT` | Agent requires higher tier |
| 404 | `NOT_FOUND` | Resource not found |
| 429 | `RATE_LIMIT_EXCEEDED` | Too many requests |
| 429 | `TOKEN_BUDGET_EXCEEDED` | Daily/monthly token budget exhausted |
| 500 | `INTERNAL_ERROR` | Server-side error |
| 502 | `LLM_PROVIDER_ERROR` | Upstream LLM provider failure |
| 503 | `SERVICE_DEGRADED` | Service temporarily degraded |

### 10.3 Retry Strategy

```typescript
async function callWithRetry(fn: () => Promise<any>, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      if (error.status === 429) {
        const retryAfter = error.retryAfter || Math.pow(2, attempt) * 1000;
        await new Promise(resolve => setTimeout(resolve, retryAfter));
        continue;
      }
      if (error.status >= 500 && attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, attempt * 2000));
        continue;
      }
      throw error;
    }
  }
}
```

---

## 11. Security Best Practices

### 11.1 API Key Management

- Store API keys in environment variables, never in source code
- Use `nyv_test_sk_*` keys for development/sandbox environments
- Use `nyv_live_sk_*` keys only in production
- Rotate keys every 90 days via the SDK Console
- Revoke keys immediately if compromised

### 11.2 PII Protection

The SDK automatically detects and vaults PII (Personally Identifiable Information):

- Aadhaar numbers
- PAN numbers
- Phone numbers
- Email addresses
- Bank account numbers
- Passport numbers

PII is replaced with vault references in prompts before LLM processing.

### 11.3 Audit Trail

Every SDK call generates an immutable audit log entry with SHA-256 hash chain:

```json
{
  "id": "nvaudit-...",
  "action": "agent_execution",
  "agentKey": "contract-review-specialist",
  "userId": "...",
  "orgId": 1,
  "jurisdiction": "IN",
  "tokensUsed": 1250,
  "hashChain": "sha256:abc123...",
  "timestamp": "2026-04-14T10:30:00Z"
}
```

---

## 12. Webhook Integration

Available for Pro, Enterprise, Government, and Institutional tiers.

### 12.1 Registering a Webhook

```typescript
await fetch('/api/nv/webhooks', {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    url: 'https://your-app.com/webhook/nyv',
    events: ['agent.completed', 'document.analyzed', 'batch.completed', 'key.rotated'],
    secret: 'your_webhook_signing_secret',
  }),
});
```

### 12.2 Webhook Payload

```json
{
  "event": "agent.completed",
  "timestamp": "2026-04-14T10:30:00Z",
  "data": {
    "requestId": "req_...",
    "agentKey": "contract-review-specialist",
    "status": "success",
    "tokensUsed": 1250,
    "processingTimeMs": 3200
  },
  "signature": "sha256=..."
}
```

---

## 13. Environment Setup

### 13.1 Development

```bash
# Base URL for development
BASE_URL=https://<your-repl>.replit.dev

# Environment variables
NYV_SDK_VERSION=5.0.0
NYV_API_KEY=nyv_test_sk_nsp_...
NYV_JURISDICTION=IN
NYV_PLATFORM=nys-professional
```

### 13.2 Staging

```bash
BASE_URL=https://staging.nyayavigya.in
NYV_API_KEY=nyv_test_sk_nsp_...
```

### 13.3 Production

```bash
BASE_URL=https://app.nyayavigya.in
NYV_API_KEY=nyv_live_sk_nsp_...
# AWS ap-south-1 (Mumbai)
```

---

## 14. Demo Credentials

### 14.1 Demo User Accounts

> **NYV-SECURITY-DOC-CREDS-001 (2026-04-30)**: passwords for demo
> accounts are no longer published in this guide. Operator distributes
> them out-of-band (1Password / Vaultwarden) via `NYV_ADMIN_PASSWORD`
> + per-account env-mapped values. Rotate after every external audit
> per the working policy in `Project-Tracker.md` §4.

| Email | Role | Tier | Password |
|---|---|---|---|
| admin@nyayavigya.in | super_admin | enterprise | _operator-managed_ |
| dev@demo.nyayavigya.in | developer | pro | _operator-managed_ |
| analyst@demo.nyayavigya.in | analyst | plus | _operator-managed_ |
| operator@demo.nyayavigya.in | operator | pro | _operator-managed_ |
| manager@demo.nyayavigya.in | manager | enterprise | _operator-managed_ |
| user@demo.nyayavigya.in | user | solo | _operator-managed_ |

### 14.2 Demo SDK API Keys (v5.0.0)

| Platform | Tier | Live Key Prefix | Test Key Prefix |
|---|---|---|---|
| Nyayamitra™ | plus | `nyv_live_sk_nym_...` | `nyv_test_sk_nym_...` |
| Nyayasiddhi Professional™ | pro | `nyv_live_sk_nsp_...` | `nyv_test_sk_nsp_...` |
| Nyayasiddhi Institutional™ | enterprise | `nyv_live_sk_nsi_...` | `nyv_test_sk_nsi_...` |
| Nyayasiddhi Academy™ | pro | `nyv_live_sk_nsa_...` | `nyv_test_sk_nsa_...` |
| Nyayasiddhi Ministry™ | government | `nyv_live_sk_nsm_...` | `nyv_test_sk_nsm_...` |

Run `npx tsx scripts/nv-seed-sdk-keys.ts` to regenerate demo keys. Keys are shown once and stored as SHA-256 hashes.

### 14.3 Demo SDK Applications

| App ID | Platform | Tier |
|---|---|---|
| nvsdkapp-demo-nm-001 | Nyayamitra | plus |
| nvsdkapp-demo-nsp-001 | Nyayasiddhi Professional | pro |
| nvsdkapp-demo-nyi-001 | Nyayasiddhi Institutional | enterprise |
| nvsdkapp-demo-academy-001 | Nyayasiddhi Academy | pro |
| nvsdkapp-demo-ministry-001 | Nyayasiddhi Ministry | government |

---

## 15. Support & Resources

| Resource | URL |
|---|---|
| API Documentation (Swagger UI) | `/api/nv/docs` |
| OpenAPI Spec (JSON) | `/api/nv/docs/swagger.json` |
| SDK Console | `/sdk-console` |
| Health Check | `/api/nv/health` |
| Full Health Check | `/api/nv/health/full` |
| Agent Registry | `/api/nv/agents` |
| Legal Corpus Search | `/api/nv/legal-corpus/search` |
| Engineering Contact | engineering@nyayavigya.com |

---

*Nyayavigya SDK v5.0.0 | Platform 3.1.2 | Document Version 1.0 | April 14, 2026*
*Production Target: May 15, 2026 | AWS ap-south-1 (Mumbai)*

---

## Optional MCP Integrations

Nyayavigya supports the **Model Context Protocol (MCP)** to grant agents access to external tools (GitHub, Jira, AWS, Slack, etc.). MCP integrations are **opt-in** — they activate only when their environment variables are set. When a variable is missing, the corresponding tool returns `{ success: false, reason: 'not_configured' }` and the agent gracefully proceeds without that capability (it does NOT crash).

### Supported MCP servers

| Provider | Required env vars | Capabilities |
|---|---|---|
| **GitHub** | `GITHUB_TOKEN` | Read repos, list issues, create PRs, fetch commits |
| **Jira** | `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN` | Create/update issues, search JQL, list projects |
| **AWS** | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION` | S3 read/write, Lambda invoke, CloudWatch logs |
| **Slack** | `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET` | Post messages, read channels, manage threads |
| **Sentry** | `SENTRY_DSN`, `SENTRY_AUTH_TOKEN` | Search issues, replay sessions, update bug status |
| **Figma** | `FIGMA_PERSONAL_ACCESS_TOKEN` | Read design files, export frames |

### How to enable in production

```bash
# In your AWS deployment .env (deploy/.env.aws-dev or k8s secrets):
GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxx
JIRA_BASE_URL=https://your-org.atlassian.net
JIRA_EMAIL=devops@nyayasiddhi.com
JIRA_API_TOKEN=ATATT3xxxxx...
SLACK_BOT_TOKEN=xoxb-xxxxxx
# (etc.)
```

Restart the gateway. MCP tools will auto-register and become callable from any agent that uses the `mcp:tool` skill.

### Querying available MCP tools

```bash
curl -H "Authorization: Bearer nyv_live_sk_..." \
  https://your-deployment/api/nv/mcp/tools
```

Returns the live registry — only tools whose env vars are set will appear in the result.

### Graceful degradation guarantee

The MCP tool registry (`src/services/mcp-tool-registry.ts`) **never throws** when a credential is missing. Instead it logs a warning at startup (`[MCP] <provider> disabled — missing <ENV_VAR>`) and the tool resolves to a no-op handler that returns `{ success: false, status: 'not_configured', message: '...' }`. Your agents can safely call `mcp:list-tools` and filter by `status === 'available'`.

### CI/local development

For local dev without MCP credentials, simply leave the env vars unset. All non-MCP routes (orchestrate, stream, agents, embeddings via OpenRouter) continue to work normally. There is **no hard dependency on any MCP provider** — they are all optional capabilities.
