# Nyayavigya SDK v5.0.0 — Complete API Integration Guide

> _Last reviewed: 2026-05-06 (Phase E doc-refresh sweep — see `docs/v5.0.0/NAVIGATION-AND-DASHBOARD-AUDIT-2026-05-06.md`)._

**Platform:** v3.1.2 | **SDK:** v5.0.0 | **Gateway:** `https://api.nyayasiddhi.online`  
**Date:** 2026-05-05 | **Status:** Dev-edge LIVE — 7/7 SDK keys validated end-to-end  
**Deploy:** `2026-05-05T-replit-ssm-(post-audit-F6..F12)` | **Probe matrix:** `.local/probe-results-2026-05-05.csv`

> This document maps every API endpoint on the Nyayavigya platform, grouped by
> module, with auth requirements, request/response shapes, and per-platform
> SDK client integration examples for **all 7 Nyayasiddhi ecosystem platforms**:
> NSP-WEB, NSP-MOBILE (NSPM), Nyayamitra (NYM), Nyayasiddhi Institutional (NSI),
> Nyayasiddhi Academy (NSA), Nyayasiddhi Ministry (NSM), and JurisX (JRX).
>
> **Audit history (2026-05-05):** Twelve code fixes applied since 2026-05-04
> (NYV-AUDIT-F1..F12) covering rate-limit gating, Drizzle column-mismatch
> bugs in clauses/library, document templates, multimodal capabilities scope
> check, provision/validate canonical-table query, neon-serverless boolean
> coercion workaround, and SDK app organization_id backfill. All 7 SDK keys
> now validate against the live gateway with deterministic 1/0 active flags.

---

## Table of Contents

0. [Environment Configuration & Domains](#0-environment-configuration--domains)
1. [Quick Start](#1-quick-start)
2. [Authentication Reference](#2-authentication-reference)
3. [SDK Client Libraries](#3-sdk-client-libraries)
4. [Per-Platform Integration](#4-per-platform-integration)
5. [API Endpoints — Complete Reference](#5-api-endpoints--complete-reference)
   - 5.1 Health & System
   - 5.2 Authentication
   - 5.3 SDK Gateway (Core AI)
   - 5.4 SDK Provision & Key Management
   - 5.5 SDK Document Pipeline
   - 5.6 SDK Multimodal & Voice
   - 5.7 SDK Workflow & Protocol Engine
   - 5.8 SDK Protocol Analytics
   - 5.9 SDK Intelligence
   - 5.10 SDK Enterprise Research
   - 5.11 Orchestration Engine
   - 5.12 Legal Chat
   - 5.13 Documents
   - 5.14 Agents
   - 5.15 Jurisdictions
   - 5.16 Case Management
   - 5.17 Memory & Knowledge
   - 5.18 Intelligence (Advanced)
   - 5.19 Nyaya Tools
   - 5.20 Patterns (Agentic AI)
   - 5.21 Skills Marketplace
   - 5.22 TwinDesk
   - 5.23 AutomateAI
   - 5.24 SkillShop
   - 5.25 ClaWdBot & OpenBot
   - 5.26 Enterprise Admin
   - 5.27 Payments (Razorpay)
   - 5.28 Subscriptions & Credits
   - 5.29 Compliance & Consent
   - 5.30 RAG & eCourts
   - 5.31 Observability & Admin
   - 5.32 SDK Downloads
   - 5.33 SDK Console (App Management)
   - 5.34 SDK Developer Portal
   - 5.35 Platform Registry
   - 5.36 Model Registry
   - 5.37 Feature Flags
   - 5.38 Tenant Management
   - 5.39 Version Management
   - 5.40 Workspace Projects
   - 5.41 Identity Extraction
   - 5.42 Content Generation
   - 5.43 GST & Invoicing
   - 5.44 Institutional Onboarding
   - 5.45 WhatsApp Channel
   - 5.46 Org RLS (Row-Level Security)
6. [Per-Platform Endpoint Access Matrix](#6-per-platform-endpoint-access-matrix)
7. [Error Codes](#7-error-codes)
8. [Rate Limits](#8-rate-limits)
9. [Webhook Events](#9-webhook-events)

---

## 0. Environment Configuration & Domains

All Nyayasiddhi ecosystem platforms connect to the same Nyayavigya gateway. Two environments are available — **Replit (development)** and **AWS nysdev (staging/production)**. Platforms should first integrate and test against Replit, then switch the domain to AWS for staging and production validation.

### 0.1 Gateway Domains

| Environment | Gateway Base URL | Health Check | Purpose |
|---|---|---|---|
| **Replit Dev** | `https://<repl-slug>.replit.dev` | `GET /api/nv/health` | Development & rapid iteration — live code reload, Replit DB |
| **AWS nysdev** | `https://api.nyayasiddhi.online` | `GET /api/nv/health` | Staging & production — RDS PostgreSQL, ElastiCache Redis, S3, ALB |
| **AWS Production** | `https://api.nyayasiddhi.com` | `GET /api/nv/health` | Production (future — same gateway, production DNS) |

> **Quick switch:** All SDK clients accept a `baseUrl` parameter. Change **only** the domain — all API paths, auth headers, and SDK key formats remain identical across environments.

### 0.2 Per-Platform SDK API Keys (all 7 platforms)

Each Nyayasiddhi platform has a dedicated SDK API key minted via `/api/nv/sdk/create-app`
and recorded in `public.sdk_app_api_keys`. Keys are scoped to the platform's tier and
allowed agent set. Store keys as environment variables — never hardcode them.

The values shown below were re-verified live on **2026-05-06** by direct
`SELECT scopes FROM sdk_app_api_keys WHERE is_active = true` — they reflect
the **current DB state** (which is the runtime source of truth, not
`src/config/nv-sdk-variants.ts`):

| # | Platform | Code | Env Variable | App ID | Org ID | Key Prefix | Tier | Scopes (live DB) |
|---|---|---|---|---|---|---|---|---|
| 1 | **Nyayasiddhi Professional™** (lawyer/firm — Web) | `NSP` | `NYV_SDK_KEY_NSP` | 2 | 3 | `nyv_live_sk_nsp_...` | professional | `agents:read`, `agents:execute`, `documents:read`, `documents:write`, `research:read`, `usage:read` |
| 2 | **Nyayasiddhi Professional Mobile™** (lawyer/firm — Mobile) | `NSPM` | `NYV_SDK_KEY_NSPM` | 8 | 3 | `nyv_live_sk_nspm_...` | professional | `agents:read`, `agents:execute`, `documents:read`, `documents:write`, `research:read`, `usage:read`, `voice:read`, `voice:execute` |
| 3 | **Nyayasiddhi Institutional™** (enterprise — IN) | `NSI` | `NYV_SDK_KEY_NSI` | 4 | 2 | `nyv_live_sk_nsi_...` | enterprise | `*` (full) |
| 4 | **Nyayasiddhi Academy™** (education) | `NSA` | `NYV_SDK_KEY_NSA` | 5 | 4 | `nyv_live_sk_nsa_...` | professional | `agents:read`, `agents:execute`, `documents:read`, `research:read`, `translate:write`, `usage:read` |
| 5 | **Nyayasiddhi Ministry™** (government) | `NSM` | `NYV_SDK_KEY_NSM` | 6 | 4 | `nyv_live_sk_nsm_...` | enterprise | `*` (full) |
| 6 | **Nyayamitra™ Citizen App** | `NYM` | `NYV_SDK_KEY_NYM` | 7 | 1 | `nyv_live_sk_nym_...` | citizen | `agents:read`, `agents:execute`, `documents:read`, `documents:write`, `translate:write`, `consumer_intake:write`, `usage:read` |
| 7 | **JurisX™** (enterprise — US) | `JRX` | `NYV_SDK_KEY_JRX` | 9 | 2 | `nyv_live_sk_jrx_...` | enterprise | `*` (full) |

> **Scopes are stored per-key** on `public.sdk_app_api_keys.scopes` (NOT on the
> `sdk_applications` row). After the **B2 fix on 2026-05-06**, NYM and NSA
> both gained `documents:read` (and NYM additionally got `documents:write`,
> `translate:write`; NSA got `translate:write`) so citizen FIR/RTI uploads
> and academy translation flows now work. The earlier "no documents" guidance
> for NYM/NSA is **obsolete** — see `nv-sdk-variants.ts:132-135` and `:357-359`
> for the rationale and `scripts/migrations/2026-05-06-b2-scopes.sql` (or the
> equivalent psql update applied directly) for the runtime change.
>
> NSI / NSM / JRX hold the wildcard `["*"]` scope and may call any
> SDK-key-authed endpoint, including `/api/nv/sdk/enterprise/research/*`
> and `/api/nv/sdk/enterprise/assets/*` (the `enterprise:research` and
> `enterprise:assets` Phase G scopes added 2026-05-06 — see
> `SDK-ENDPOINTS-CANONICAL-2026-05-06.md` §addendum).

> **Key prefix on Replit (production):** All 7 Replit-side secrets currently use
> the `nyv_live_sk_<code>_…` prefix (live mode). The `nyv_test_sk_…` prefix
> in earlier docs is reserved for sandbox keys minted via the SDK Console.

> **Important:** SDK keys are stored as Replit Secrets (never displayed in logs).
> On AWS EC2, keys are stored in `/opt/Nyayavigya/secrets/.env.production`. The
> **same key** works against both Replit and AWS — only the `baseUrl` changes.

#### 0.2.1 Database mapping (for operators)

```sql
-- Verify the 7 keys + 7 apps + org binding (run against the production RDS):
SELECT k.id AS key_id, a.id AS app_id, a.app_name, a.organization_id AS org_id,
       k.key_prefix, k.is_active, k.scopes
FROM public.sdk_app_api_keys k
JOIN public.sdk_applications a ON a.id = k.application_id
WHERE k.is_active = true
ORDER BY a.id;
-- Expected: 7 rows, app IDs {2,4,5,6,7,8,9}, org IDs {1,2,3,4}, all is_active=true.
```

### 0.3 Environment Quick-Switch Pattern

Every platform should use a single environment config that swaps the domain based on the target environment:

```typescript
const NYV_CONFIG = {
  apiKey: process.env.NYV_SDK_KEY_NSP,  // same key for both environments
  baseUrl: process.env.NYV_ENV === 'production'
    ? 'https://api.nyayasiddhi.online'    // AWS nysdev
    : process.env.REPLIT_DEV_DOMAIN
      ? `https://${process.env.REPLIT_DEV_DOMAIN}`  // Replit dev
      : 'http://localhost:5000',                     // local dev
  timeout: 30000,
};
```

**For React/Next.js (NSP-WEB):**
```bash
# .env.local (Replit development)
NEXT_PUBLIC_NYV_BASE_URL=https://<repl-slug>.replit.dev
NYV_SDK_KEY_NSP=nyv_test_sk_nsp_...

# .env.production (AWS staging/production)
NEXT_PUBLIC_NYV_BASE_URL=https://api.nyayasiddhi.online
NYV_SDK_KEY_NSP=nyv_test_sk_nsp_...  # same key
```

**For React Native (NSP-MOBILE):**
```typescript
import { NyvClientRN } from '@nyayavigya/client-sdk-react-native';

const client = await NyvClientRN.create({
  baseUrl: __DEV__
    ? 'https://<repl-slug>.replit.dev'    // Replit
    : 'https://api.nyayasiddhi.online',   // AWS
  secureStorageKey: 'nyv_api_key',
  defaultPlatform: 'nys-professional',
});
```

**For Nyayamitra (Node.js backend):**
```typescript
import { NyayamitraClient } from '@nyayavigya/nyayamitra-sdk';

const mitra = new NyayamitraClient({
  apiKey: process.env.NYV_SDK_KEY_NYM,
  baseUrl: process.env.NYV_GATEWAY_URL || 'https://api.nyayasiddhi.online',
  defaultLanguage: 'hi',
});
```

**For NSI / JRX (Enterprise):**
```typescript
import { NyayavignyaEnterpriseClient } from '@nyayavigya/enterprise-sdk';

const ent = new NyayavignyaEnterpriseClient({
  apiKey: process.env.NYV_SDK_KEY_NSI,
  baseUrl: process.env.NYV_GATEWAY_URL || 'https://api.nyayasiddhi.online',
  orgId: process.env.NYV_ORG_ID || '2',
});
```

### 0.4 CORS Allowlist

The gateway allows requests from the following origins (configured in `src/index.ts`):

| Origin Pattern | Environment |
|---|---|
| `https://nyayasiddhi.com`, `https://www.nyayasiddhi.com` | Production |
| `https://app.nyayasiddhi.com` | NSP Production |
| `https://institutional.nyayasiddhi.com` | NSI Production |
| `https://academy.nyayasiddhi.com` | NSA Production |
| `https://ministry.nyayasiddhi.com` | NSM Production |
| `https://*.nyayasiddhi.online` | Staging/Dev-edge (regex match) |
| `https://*.nyayavigya.in` | Nyayavigya corporate |
| `https://*.replit.dev`, `https://*.repl.co`, `https://*.replit.app` | Replit development |
| `http://localhost:3000`, `:3004`, `:5000` | Local development |
| Custom via `CORS_ORIGINS` env var | Any environment (comma-separated) |

> **Adding your platform's origin:** Set the `CORS_ORIGINS` environment variable to add additional origins. Example: `CORS_ORIGINS=https://myapp.example.com,https://staging.myapp.example.com`

### 0.5 Health Check Verification

Before integrating, verify connectivity to both environments:

```bash
# Replit dev
curl https://<repl-slug>.replit.dev/api/nv/health
# Expected: { "status": "healthy", "version": "v5.0.0", "environment": "development", ... }

# AWS nysdev
curl https://api.nyayasiddhi.online/api/nv/health
# Expected: { "status": "healthy", "version": "v5.0.0", "environment": "production", ... }

# Full health (includes DB, Redis, agent registry, LLM providers)
curl https://api.nyayasiddhi.online/api/nv/health/full
```

### 0.6 Environment Variables Reference (Gateway-Side)

These are configured on the Nyayavigya gateway — platforms do **not** need to set these, but they affect behavior:

| Variable | Purpose | Default |
|---|---|---|
| `NYV_PUBLIC_URL` | Public-facing gateway URL | auto-detected |
| `NYV_ENV` | Environment override (`staging`, `production`) | from `NODE_ENV` |
| `NV_PUBLIC_CORS` | Allow any origin (no credentials) | `false` |
| `NYV_SDK_DOWNLOADS_PUBLIC` | Allow unauthenticated SDK tarball downloads | `true` |
| `NYV_TENANT_ENFORCE` | RLS enforcement level (`0`, `1`, `strict`) | `0` |
| `NYV_RATE_LIMITER` | Enable/disable Redis rate limiter | `on` |
| `NYV_QUEUE_WORKERS` | Enable/disable BullMQ background workers | `on` |

---

## 1. Quick Start

### 1.1 Install the SDK

```bash
# For NSP-WEB (React/Next.js)
npm install @nyayavigya/client-sdk @nyayavigya/react-hooks @nyayavigya/types

# For NSP-MOBILE (React Native)
npm install @nyayavigya/client-sdk-react-native @nyayavigya/types

# For Nyayamitra (citizen-tier)
npm install @nyayavigya/nyayamitra-sdk @nyayavigya/types

# For NSI / JRX (enterprise-tier)
npm install @nyayavigya/enterprise-sdk @nyayavigya/types
```

**Download sources (v5.0.0 tarballs):**

| Package | S3 Path | Size |
|---|---|---|
| `client-sdk` | `s3://nyayavigya-sdk-devapp/sdk/client-sdk/5.0.0.tgz` | 43 KB |
| `client-sdk-react-native` | `s3://nyayavigya-sdk-devapp/sdk/client-sdk-react-native/5.0.0.tgz` | 20 KB |
| `nyayamitra-sdk` | `s3://nyayavigya-sdk-devapp/sdk/nyayamitra-sdk/5.0.0.tgz` | 22 KB |
| `enterprise-sdk` | `s3://nyayavigya-sdk-devapp/sdk/enterprise-sdk/5.0.0.tgz` | 7 KB |
| `react-hooks` | `s3://nyayavigya-sdk-devapp/sdk/react-hooks/5.0.0.tgz` | 18 KB |
| `types` | `s3://nyayavigya-sdk-devapp/sdk/types/5.0.0.tgz` | 13 KB |

### 1.2 Initialize the client

```typescript
import { NyvClient } from '@nyayavigya/client-sdk';

const nyv = new NyvClient({
  apiKey: 'nyv_test_sk_nsp_...',       // your platform SDK key
  baseUrl: 'https://api.nyayasiddhi.online',
  defaultPlatform: 'nys-professional', // or 'nyayamitra', 'nys-institutional'
  timeout: 30000,
});
```

### 1.3 First API call

```typescript
const health = await nyv.healthCheck();
// → { status: 'healthy', version: 'v5.0.0', environment: 'production' }

const result = await nyv.ask('What is Section 420 IPC?', 'IN');
// → { answer: '...', citations: [...], agentId: 'indian-criminal-specialist' }
```

---

## 2. Authentication Reference

### 2.1 Two auth models

| Auth Type | Header | When to use |
|---|---|---|
| **SDK API Key** | `X-API-Key: nyv_test_sk_...` or `Authorization: Bearer nyv_test_sk_...` | All `/api/nv/sdk/*` and `/api/nv/gateway/*` endpoints |
| **JWT Token** | `Authorization: Bearer eyJ...` | All `/api/nv/orchestrate`, `/api/nv/documents/*`, `/api/nv/twindesk/*`, and other user-session endpoints |

> **Note:** The SDK gateway middleware (`sdkGatewayAuth`) also accepts a valid JWT
> as an internal bypass — if a request carries a JWT with a recognized role
> (`admin`, `super_admin`, `developer`), it is allowed through even without an
> SDK API key. This is by design for admin tooling and the SDK Console UI.

### 2.2 Four key types per platform

| Key Type | Prefix | Purpose |
|---|---|---|
| `sdk_api_key` | `nyv_test_sk_<platform>_...` | Primary API authentication — use in server-side code |
| `publishable_key` | `nyv_test_pk_<platform>_...` | Client-side safe key — limited scope, embeddable in browser/mobile |
| `signing_key` | `nyv_ss_<platform>_...` | HMAC request signing (reserved for v3.2) |
| `webhook_secret` | `nyv_wh_<platform>_...` | Verify inbound webhook payloads |

### 2.3 Getting a JWT (for user-session endpoints)

```bash
# Step 1: Login
curl -X POST https://api.nyayasiddhi.online/api/nv/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"dev@demo.nyayavigya.in","password":"<password>"}'

# Response:
# {
#   "token": "[PURGED-JWT]...",
#   "refreshToken": "[PURGED-JWT]...",
#   "user": { "id": 2, "email": "dev@demo.nyayavigya.in", "role": "developer" }
# }

# Step 2: Use the JWT
curl -H "Authorization: Bearer eyJ..." \
  https://api.nyayasiddhi.online/api/nv/orchestrate \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Explain Section 302 BNS","jurisdiction":"IN"}'
```

### 2.4 Public endpoints (no auth required)

| Endpoint | Method |
|---|---|
| `/health` | GET |
| `/api/nv/health` | GET |
| `/api/nv/health/full` | GET |
| `/api/nv/health/full/ready` | GET |
| `/api/nv/health/full/live` | GET |
| `/api/nv/voice/info` | GET |
| `/api/nv/docs` | GET |
| `/api/nv/docs/swagger.json` | GET |
| `/api/nv/docs/openapi.json` | GET |
| `/api/nv/gst/rates` | GET |
| `/api/nv/gst/validate-gstin` | POST |
| `/api/nv/institutional/request` | POST |
| `/api/nv/channels/whatsapp/health` | GET |
| `/api/nv/channels/whatsapp/webhook` | GET (challenge) |
| `/downloads/sdk/*` | GET (when `NYV_SDK_DOWNLOADS_PUBLIC=true`, default) |

---

## 3. SDK Client Libraries

### 3.1 `@nyayavigya/client-sdk` — NyvClient (14 API classes)

```typescript
const nyv = new NyvClient({ apiKey, baseUrl });

// 14 API namespaces:
nyv.agents        // AgentsApi      — run, getExecution, waitForExecution
nyv.documents     // DocumentsApi   — upload, search, analyze, status
nyv.patterns      // PatternsApi    — CoT, ReAct, ToT, MCTS, SwarmAI (22 patterns)
nyv.voice         // VoiceApi       — synthesize, transcribe, stream
nyv.intelligence  // IntelligenceApi — precedents, regulatory, contracts, NER
nyv.skills        // SkillsApi      — marketplace, install, publish
nyv.twins         // TwinApi        — create, chat, simulate, benchmark
nyv.knowledge     // KnowledgeApi   — graph, add, search
nyv.nyayaTools    // NyayaToolsApi  — citation check, templates, forensic, e-discovery
nyv.memory        // MemoryApi      — matter, client, erase
nyv.cache         // CacheApi       — lookup, invalidate, warmup
nyv.testing       // TestingApi     — oracle, adversarial, LLM judge, scorecard
nyv.compliance    // ComplianceApi  — EU AI Act, bias audit, watermark, signing
nyv.credits       // CreditsApi     — wallet, transactions, estimate
nyv.stream        // NyvStreamReader — SSE streaming for patterns
```

### 3.2 `@nyayavigya/nyayamitra-sdk` — NyayamitraClient

```typescript
import { NyayamitraClient } from '@nyayavigya/nyayamitra-sdk';

const mitra = new NyayamitraClient({
  apiKey: 'nyv_test_sk_nym_...',
  baseUrl: 'https://api.nyayasiddhi.online',
  defaultLanguage: 'hi',  // Hindi default
});

// 3 main methods:
await mitra.chat({ message: 'मुझे IPC 420 के बारे में बताइए', jurisdiction: 'IN' });
await mitra.classifyClauses({ text: 'The tenant shall pay...', jurisdiction: 'IN' });
await mitra.generateCaseBrief({ facts: '...', jurisdiction: 'IN', category: 'criminal' });
```

### 3.3 `@nyayavigya/enterprise-sdk` — NyayavignyaEnterpriseClient

```typescript
import { NyayavignyaEnterpriseClient } from '@nyayavigya/enterprise-sdk';

const ent = new NyayavignyaEnterpriseClient({
  apiKey: 'nyv_test_sk_nsi_...',
  baseUrl: 'https://api.nyayasiddhi.online',
  orgId: '2',
});

await ent.healthCheck();
// Access: full 10-module enterprise set + domain research + analytics
```

### 3.4 `@nyayavigya/client-sdk-react-native` — NyvClientRN

```typescript
import { NyvClientRN } from '@nyayavigya/client-sdk-react-native';

const client = await NyvClientRN.create({
  baseUrl: 'https://api.nyayasiddhi.online',
  secureStorageKey: 'nyv_api_key',      // reads from SecureStore
  defaultPlatform: 'nys-professional',
  enablePushNotifications: true,         // for HITL push
});

// Same 14 API namespaces as NyvClient, plus:
// - SecureStore for API key persistence
// - Push notification registration for HITL reviews
// - Offline queue for intermittent connectivity
```

### 3.5 `@nyayavigya/react-hooks` — 17 React hooks

```typescript
import {
  useNyvClient,           // Provider + context
  useJurisdiction,        // Jurisdiction selector
  useTimeline,            // Case timeline
  useIntelligence,        // Legal intelligence
  useCompliance,          // Compliance dashboard
  useConflictDetector,    // Conflict of interest
  useAmendmentImpact,     // Amendment tracker
  usePrecedentSimilarity, // Precedent search
  useRegulatoryFeed,      // Regulatory updates
  useCredits,             // Credit wallet
  useAuditLog,            // Audit trail
  useForensicVerifier,    // Document forensics
  useGovernanceBadge,     // Governance badge
  useTemplateAssistant,   // Template fill
  usePatternStream,       // SSE pattern streaming
  useAgentTesting,        // Agent test runner
} from '@nyayavigya/react-hooks';
```

---

## 4. Per-Platform Integration

### 4.1 NSP-WEB (Nyayasiddhi Professional — Web)

| Property | Value |
|---|---|
| **SDK packages** | `client-sdk` + `react-hooks` + `types` |
| **Platform code** | `nsp-web` |
| **Org ID** | 3 |
| **Tier** | pro |
| **Jurisdiction** | IN |
| **S3 prefix** | `orgs/3/nv/users/{userId}/documents/` |
| **Key prefix** | `nyv_test_sk_nsp_...` |

```typescript
// pages/_app.tsx (Next.js)
import { NyvProvider } from '@nyayavigya/react-hooks';

export default function App({ Component, pageProps }) {
  return (
    <NyvProvider config={{
      apiKey: process.env.NEXT_PUBLIC_NYV_API_KEY,
      baseUrl: 'https://api.nyayasiddhi.online',
      defaultPlatform: 'nys-professional',
    }}>
      <Component {...pageProps} />
    </NyvProvider>
  );
}
```

```typescript
// components/LegalChat.tsx
import { useNyvClient, usePatternStream } from '@nyayavigya/react-hooks';

function LegalChat() {
  const nyv = useNyvClient();
  const { stream, isStreaming, text } = usePatternStream();

  const handleAsk = async (question: string) => {
    await stream('cot', {
      task: question,
      jurisdiction: 'IN',
    });
  };

  return <div>{isStreaming ? text : 'Ask a question...'}</div>;
}
```

### 4.2 NSP-MOBILE (Nyayasiddhi Professional — Mobile)

| Property | Value |
|---|---|
| **SDK packages** | `client-sdk-react-native` + `types` |
| **Platform code** | `nsp-mobile` |
| **Org ID** | 3 |
| **Tier** | pro |
| **Jurisdiction** | IN |
| **S3 prefix** | `orgs/3/nv/users/{userId}/documents/` |
| **Key prefix** | `nyv_test_sk_nsb_...` |
| **Upload cap** | 25 MB |

```typescript
// App.tsx (React Native / Expo)
import { NyvClientRN } from '@nyayavigya/client-sdk-react-native';

const client = await NyvClientRN.create({
  baseUrl: 'https://api.nyayasiddhi.online',
  secureStorageKey: 'nyv_api_key',
  defaultPlatform: 'nys-professional',
  enablePushNotifications: true,
});

// Use BFF pattern: your mobile backend holds the SDK key,
// mobile app sends requests through your BFF
const result = await client.agents.run({
  agentId: 'indian-contracts-specialist',
  task: 'Review this rental agreement',
  jurisdiction: 'IN',
});
```

### 4.3 Nyayamitra (Citizen-Tier)

| Property | Value |
|---|---|
| **SDK packages** | `nyayamitra-sdk` + `types` |
| **Platform code** | `nayamitra` |
| **Org ID** | 1 |
| **Tier** | citizen |
| **Jurisdiction** | IN |
| **S3 prefix** | `orgs/1/nv/users/{userId}/documents/` |
| **Key prefix** | `nyv_test_sk_nym_...` |

```typescript
import { NyayamitraClient } from '@nyayavigya/nyayamitra-sdk';

const mitra = new NyayamitraClient({
  apiKey: process.env.NYV_SDK_KEY_NYM,
  baseUrl: 'https://api.nyayasiddhi.online',
  defaultLanguage: 'hi',
});

// Citizen-tier: limited to community agents
const response = await mitra.chat({
  message: 'What are my rights as a tenant?',
  jurisdiction: 'IN',
  language: 'en',
});
// → { answer: '...', citations: [...], agentId: 'community-rights-assistant' }

// Indic language support (22 Indian languages via Sarvam AI)
const hindi = await mitra.chat({
  message: 'किरायेदार के अधिकार क्या हैं?',
  jurisdiction: 'IN',
  language: 'hi',
});
```

### 4.4 NSI (Nyayasiddhi Institutional — India)

| Property | Value |
|---|---|
| **SDK packages** | `enterprise-sdk` + `types` |
| **Platform code** | `nsi` |
| **Org ID** | 2 |
| **Tier** | enterprise |
| **Jurisdiction** | IN |
| **S3 prefix** | `orgs/2/nv/users/{userId}/documents/` |
| **Key prefix** | `nyv_test_sk_nsi_...` |

```typescript
import { NyayavignyaEnterpriseClient } from '@nyayavigya/enterprise-sdk';

const nsi = new NyayavignyaEnterpriseClient({
  apiKey: process.env.NYV_SDK_KEY_NSI,
  baseUrl: 'https://api.nyayasiddhi.online',
  orgId: '2',
});

// Full 10-module enterprise access:
// 1. Agent orchestration
// 2. Document intelligence
// 3. Legal research (domain-specific)
// 4. Financial analytics
// 5. Code review
// 6. Investment research
// 7. Visual analytics
// 8. Workflow automation
// 9. Protocol engine (A2A, AG-UI, ROMA, MCP)
// 10. Enterprise admin
```

### 4.5 JRX (Nyayasiddhi Institutional — US)

| Property | Value |
|---|---|
| **SDK packages** | `enterprise-sdk` + `types` |
| **Platform code** | `jrx` |
| **Org ID** | 2 |
| **Tier** | enterprise |
| **Jurisdiction** | US |
| **S3 prefix** | `orgs/2/nv/users/{userId}/documents/` |
| **Key prefix** | `nyv_test_sk_jrx_...` |

```typescript
const jrx = new NyayavignyaEnterpriseClient({
  apiKey: process.env.NYV_SDK_KEY_JRX,
  baseUrl: 'https://api.nyayasiddhi.online',
  orgId: '2',
  defaultJurisdiction: 'US',  // Bluebook citation format enforced
});
```

---

## 5. API Endpoints — Complete Reference

> **Base URL:** `https://api.nyayasiddhi.online`
>
> **Auth legend:**
> - 🔓 = Public (no auth)
> - 🔑 = SDK API Key (`X-API-Key`)
> - 🔐 = JWT (`Authorization: Bearer <jwt>`)
> - 👑 = Admin JWT (admin/super_admin role required)

---

### 5.1 Health & System

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/health` | 🔓 | Basic health check |
| GET | `/api/nv/health` | 🔓 | Gateway health (same as above) |
| GET | `/api/nv/health/full` | 🔓 | Full health with services, agents, DB, Redis status |
| GET | `/api/nv/health/full/ready` | 🔓 | Kubernetes-style readiness probe |
| GET | `/api/nv/health/full/live` | 🔓 | Kubernetes-style liveness probe |
| GET | `/api/nv/admin/health/full` | 👑 | Admin-only detailed health (includes secrets status) |
| GET | `/api/nv/admin/heap` | 👑 | V8 heap snapshot for memory debugging |
| GET | `/api/nv/token-metrics` | 🔓 | Token usage metrics |

**Example — Full Health Check:**
```bash
curl https://api.nyayasiddhi.online/api/nv/health/full
```
```json
{
  "status": "healthy",
  "version": "v5.0.0",
  "environment": "production",
  "uptime": "4d 12h 30m",
  "services": {
    "database": "connected",
    "redis": "connected",
    "s3": "connected",
    "openai": "configured",
    "anthropic": "configured"
  },
  "agents": 148,
  "mcpTools": 502,
  "jurisdictions": ["IN", "US", "UK", "EU", "SG", "AE"]
}
```

---

### 5.2 Authentication

Mount: `/api/nv/auth`

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/api/nv/auth/register` | 🔓 | Register new user |
| POST | `/api/nv/auth/signup` | 🔓 | Alias for register |
| POST | `/api/nv/auth/login` | 🔓 | Login → returns JWT + refresh token |
| GET | `/api/nv/auth/me` | 🔐 | Get current user profile |
| GET | `/api/nv/auth/providers` | 🔓 | List available auth providers |
| POST | `/api/nv/auth/refresh` | 🔓 | Refresh JWT using refresh token |
| POST | `/api/nv/auth/logout` | 🔐 | Invalidate current session |
| POST | `/api/nv/auth/otp/send` | 🔓 | Send OTP to phone/email |
| POST | `/api/nv/auth/otp/verify` | 🔓 | Verify OTP code |
| POST | `/api/nv/auth/api-key` | 🔐 | Generate API key for current user |

**Example — Login:**
```bash
curl -X POST https://api.nyayasiddhi.online/api/nv/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "dev@demo.nyayavigya.in",
    "password": "<password>"
  }'
```
```json
{
  "success": true,
  "token": "[PURGED-JWT]...",
  "refreshToken": "[PURGED-JWT]...",
  "user": {
    "id": 2,
    "email": "dev@demo.nyayavigya.in",
    "role": "developer",
    "tier": "pro",
    "orgId": 3
  }
}
```

**Example — Register:**
```bash
curl -X POST https://api.nyayasiddhi.online/api/nv/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "newuser@example.com",
    "password": "StrongP@ss123!",
    "fullName": "New User",
    "role": "developer"
  }'
```

---

### 5.3 SDK Gateway (Core AI)

Mount: `/api/nv/gateway` | Auth: 🔑 SDK API Key

This is the primary SDK-key-authenticated API surface. All calls require `X-API-Key`
(or a valid JWT via the internal bypass — see §2.1 note).

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/nv/gateway/agents` | List all agents available to your tier |
| POST | `/api/nv/gateway/agents/:agentId/execute` | Execute an agent with a prompt |
| GET | `/api/nv/gateway/agents/:agentId/status` | Agent availability status |
| POST | `/api/nv/gateway/documents/analyze` | AI document analysis |
| POST | `/api/nv/gateway/documents/draft` | AI document drafting |
| POST | `/api/nv/gateway/documents/summarize` | Document summarization |
| POST | `/api/nv/gateway/documents/extract-entities` | Named entity extraction |
| POST | `/api/nv/gateway/documents/compare` | Compare two documents |
| POST | `/api/nv/gateway/documents/classify-clauses` | Classify contract clauses |
| POST | `/api/nv/gateway/documents/embeddings` | Generate document embeddings |
| POST | `/api/nv/gateway/documents/qa` | Document Q&A |
| POST | `/api/nv/gateway/research/query` | Legal research query |
| POST | `/api/nv/gateway/research/precedent` | Precedent search |
| POST | `/api/nv/gateway/translate` | Translate text (22 Indian languages via Sarvam) |
| POST | `/api/nv/gateway/translate/batch` | Batch translation |
| POST | `/api/nv/gateway/translate/transliterate` | Transliteration |
| POST | `/api/nv/gateway/translate/detect-language` | Language detection |
| GET | `/api/nv/gateway/translate/languages` | Supported languages list |
| GET | `/api/nv/gateway/translate/stats` | Translation usage stats |
| POST | `/api/nv/gateway/ocr/process` | OCR processing |
| POST | `/api/nv/gateway/ocr/jobs` | Submit async OCR job |
| GET | `/api/nv/gateway/ocr/jobs/:jobId` | Check OCR job status |
| GET | `/api/nv/gateway/ocr/stats` | OCR usage stats |
| GET | `/api/nv/gateway/usage` | API usage summary |
| GET | `/api/nv/gateway/usage/tokens` | Token consumption details |
| POST | `/api/nv/gateway/payments/orders` | Create Razorpay order |
| GET | `/api/nv/gateway/payments/orders/:orderId` | Get order details |
| POST | `/api/nv/gateway/payments/capture` | Capture payment |
| POST | `/api/nv/gateway/payments/refund` | Process refund |
| POST | `/api/nv/gateway/payments/subscriptions/plans` | Create subscription plan |
| POST | `/api/nv/gateway/payments/subscriptions` | Create subscription |
| GET | `/api/nv/gateway/payments/subscriptions/:id` | Get subscription |
| DELETE | `/api/nv/gateway/payments/subscriptions/:id` | Cancel subscription |
| POST | `/api/nv/gateway/payments/customers` | Create customer |
| POST | `/api/nv/gateway/payments/invoices` | Create invoice |
| POST | `/api/nv/gateway/payments/payment-links` | Create payment link |
| GET | `/api/nv/gateway/health` | Gateway health |

**Example — List Agents:**
```bash
curl -H "X-API-Key: nyv_test_sk_nsp_..." \
  https://api.nyayasiddhi.online/api/nv/gateway/agents
```
```json
{
  "success": true,
  "agents": [
    {
      "id": "indian-contracts-specialist",
      "name": "Indian Contracts Specialist",
      "category": "legal",
      "jurisdiction": "IN",
      "tier": "pro",
      "capabilities": ["contract-review", "clause-analysis", "risk-assessment"]
    },
    {
      "id": "criminal-law-analyst",
      "name": "Criminal Law Analyst",
      "category": "legal",
      "jurisdiction": "IN",
      "tier": "pro"
    }
  ],
  "total": 148
}
```

**Example — Execute Agent:**
```bash
curl -X POST -H "X-API-Key: nyv_test_sk_nsp_..." \
  -H "Content-Type: application/json" \
  https://api.nyayasiddhi.online/api/nv/gateway/agents/indian-contracts-specialist/execute \
  -d '{
    "prompt": "What is the limitation period for filing a suit for breach of contract?",
    "jurisdiction": "IN",
    "context": { "caseType": "civil" }
  }'
```
```json
{
  "success": true,
  "result": {
    "answer": "Under the Indian Limitation Act, 1963...",
    "citations": [
      { "statute": "Limitation Act, 1963", "section": "3", "article": "55" }
    ],
    "agentId": "indian-contracts-specialist",
    "model": "claude-sonnet-4-20250514",
    "tokensUsed": { "input": 245, "output": 1820 },
    "traceId": "nyv-trace-abc123"
  }
}
```

**Example — Translate:**
```bash
curl -X POST -H "X-API-Key: nyv_test_sk_nsp_..." \
  -H "Content-Type: application/json" \
  https://api.nyayasiddhi.online/api/nv/gateway/translate \
  -d '{
    "text": "The court held that the plaintiff was entitled to damages.",
    "sourceLanguage": "en",
    "targetLanguage": "hi"
  }'
```

**Example — Document Analysis:**
```bash
curl -X POST -H "X-API-Key: nyv_test_sk_nsp_..." \
  -H "Content-Type: application/json" \
  https://api.nyayasiddhi.online/api/nv/gateway/documents/analyze \
  -d '{
    "text": "This Agreement is made on...",
    "analysisType": "contract-review",
    "jurisdiction": "IN"
  }'
```

---

### 5.4 SDK Provision & Key Management

Mount: `/api/nv/sdk` | Auth: mixed

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/api/nv/sdk/provision` | 🔑 | Initialize SDK session (handshake) |
| POST | `/api/nv/sdk/provision/validate` | 🔓 | Validate an SDK key (key passed in body, no auth middleware) |
| POST | `/api/nv/sdk/provision/health` | 🔑 | SDK provision health check |
| POST | `/api/nv/sdk/create-app` | 🔐 (developer+) | Register a new SDK application |
| POST | `/api/nv/sdk/keys/:appId/generate` | 🔐 | Generate new API key for app |
| POST | `/api/nv/sdk/keys/:appId/rotate` | 🔐 | Rotate API key |
| POST | `/api/nv/sdk/keys/:appId/revoke/:keyId` | 🔐 | Revoke specific key |
| POST | `/api/nv/sdk/keys/:appId/revoke-all` | 🔐 | Revoke all keys for app |
| GET | `/api/nv/sdk/keys/:appId` | 🔐 | List keys for app |
| GET | `/api/nv/sdk/keys/:appId/status` | 🔐 | Key status summary |
| POST | `/api/nv/sdk/keys/verify` | 🔐 | Verify a key is valid |

**Example — Provision (SDK handshake):**
```bash
curl -X POST -H "X-API-Key: nyv_test_sk_nsp_..." \
  -H "Content-Type: application/json" \
  https://api.nyayasiddhi.online/api/nv/sdk/provision \
  -d '{
    "platform": "nsp-web",
    "version": "5.0.0",
    "capabilities": ["agents", "documents", "voice"]
  }'
```

---

### 5.5 SDK Document Pipeline

Mount: `/api/nv/sdk/docs-pipeline` | Auth: 🔑 SDK API Key

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/nv/sdk/docs-pipeline/documents/parse` | Parse document (multipart upload) |
| POST | `/api/nv/sdk/docs-pipeline/documents/intelligence` | AI document intelligence |
| POST | `/api/nv/sdk/docs-pipeline/documents/embeddings` | Generate embeddings |
| POST | `/api/nv/sdk/docs-pipeline/documents/compare` | Compare documents |
| POST | `/api/nv/sdk/docs-pipeline/documents/summarize` | Summarize document |
| GET | `/api/nv/sdk/docs-pipeline/documents/templates` | List document templates |
| POST | `/api/nv/sdk/docs-pipeline/documents/compliance-check` | Compliance check |
| GET | `/api/nv/sdk/docs-pipeline/clauses/library` | Clause library |
| GET | `/api/nv/sdk/docs-pipeline/clauses/:clauseId` | Get clause detail |
| POST | `/api/nv/sdk/docs-pipeline/clauses/suggest` | AI clause suggestions |

**Example — Parse Document:**
```bash
curl -X POST -H "X-API-Key: nyv_test_sk_nsp_..." \
  -F "file=@contract.pdf" \
  -F "jurisdiction=IN" \
  -F "analysisType=full" \
  https://api.nyayasiddhi.online/api/nv/sdk/docs-pipeline/documents/parse
```

**SDK Client:**
```typescript
const result = await nyv.documents.upload(fileBuffer, {
  filename: 'contract.pdf',
  jurisdiction: 'IN',
  analysisType: 'full',
});
```

---

### 5.6 SDK Multimodal & Voice

Mount: `/api/nv/sdk/multimodal` | Auth: 🔑 SDK API Key

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/nv/sdk/multimodal/multimodal/vision/analyze` | Image/vision analysis |
| POST | `/api/nv/sdk/multimodal/multimodal/video/generate-script` | Video script generation |
| POST | `/api/nv/sdk/multimodal/multimodal/3d/generate` | 3D model generation |
| POST | `/api/nv/sdk/multimodal/multimodal/avatar/create-session` | Avatar session |
| POST | `/api/nv/sdk/multimodal/multimodal/rag/query` | Multimodal RAG query |
| GET | `/api/nv/sdk/multimodal/multimodal/capabilities` | List capabilities |
| POST | `/api/nv/sdk/multimodal/voice/synthesize` | Text-to-speech |
| POST | `/api/nv/sdk/multimodal/voice/transcribe` | Speech-to-text |
| POST | `/api/nv/sdk/multimodal/voice/stream/start` | Start voice stream |
| POST | `/api/nv/sdk/multimodal/voice/stream/stop` | Stop voice stream |
| POST | `/api/nv/sdk/multimodal/voice/voiceover/generate` | Generate voiceover |

**Example — Voice Transcribe:**
```bash
curl -X POST -H "X-API-Key: nyv_test_sk_nsp_..." \
  -H "Content-Type: application/json" \
  https://api.nyayasiddhi.online/api/nv/sdk/multimodal/voice/transcribe \
  -d '{"audioUrl": "https://...", "language": "hi"}'
```

**SDK Client:**
```typescript
const transcript = await nyv.voice.transcribe({
  audioUrl: 'https://...',
  language: 'hi',
});
```

---

### 5.7 SDK Workflow & Protocol Engine

Mount: `/api/nv/sdk/workflows` | Auth: 🔑 SDK API Key

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/nv/sdk/workflows/workflows/create` | Create workflow |
| POST | `/api/nv/sdk/workflows/workflows/execute` | Execute workflow |
| GET | `/api/nv/sdk/workflows/workflows/list` | List workflows |
| GET | `/api/nv/sdk/workflows/workflows/:id/status` | Workflow status |
| POST | `/api/nv/sdk/workflows/workflows/schedule` | Schedule workflow |
| DELETE | `/api/nv/sdk/workflows/workflows/:id` | Delete workflow |
| POST | `/api/nv/sdk/workflows/workflows/autonomous/start` | Start autonomous workflow |
| POST | `/api/nv/sdk/workflows/protocols/agui/event` | AG-UI protocol event |
| GET | `/api/nv/sdk/workflows/protocols/agui/state` | AG-UI state |
| POST | `/api/nv/sdk/workflows/protocols/roma/evaluate` | ROMA L5 evaluation |
| POST | `/api/nv/sdk/workflows/protocols/bmad/analyze` | BMAD analysis |
| POST | `/api/nv/sdk/workflows/protocols/parlant/interact` | Parlant interaction |
| POST | `/api/nv/sdk/workflows/protocols/context-engineering/optimize` | Context optimization |
| GET | `/api/nv/sdk/workflows/protocols/context-engineering/strategies` | List strategies |
| POST | `/api/nv/sdk/workflows/protocols/mcp/tools/invoke` | Invoke MCP tool |
| GET | `/api/nv/sdk/workflows/protocols/mcp/tools` | List MCP tools |
| GET | `/api/nv/sdk/workflows/usage/summary` | Workflow usage |

---

### 5.8 SDK Protocol Analytics

Mount: `/api/nv/sdk/analytics` | Auth: 🔑 SDK API Key

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/nv/sdk/analytics/protocols/a2a/task` | Create A2A task |
| GET | `/api/nv/sdk/analytics/protocols/a2a/task/:taskId` | Get A2A task status |
| GET | `/api/nv/sdk/analytics/protocols/a2a/stats` | A2A protocol stats |
| POST | `/api/nv/sdk/analytics/workflows/schedule` | Schedule analytics workflow |
| GET | `/api/nv/sdk/analytics/workflows/stats` | Workflow stats |
| GET | `/api/nv/sdk/analytics/workflows/:id` | Get workflow |
| DELETE | `/api/nv/sdk/analytics/workflows/:id` | Delete workflow |
| POST | `/api/nv/sdk/analytics/analytics/predict` | Predictive analytics |
| POST | `/api/nv/sdk/analytics/analytics/cost/estimate` | Cost estimation |
| GET | `/api/nv/sdk/analytics/analytics/cost/stats` | Cost stats |
| POST | `/api/nv/sdk/analytics/analytics/advanced/query` | Advanced analytics query |
| GET | `/api/nv/sdk/analytics/analytics/advanced/dashboard` | Analytics dashboard |
| POST | `/api/nv/sdk/analytics/analytics/optimize` | Optimization suggestions |
| GET | `/api/nv/sdk/analytics/analytics/optimize/stats` | Optimization stats |

---

### 5.9 SDK Intelligence

Mount: `/api/nv/v1/sdk/intelligence` | Auth: 🔑 SDK API Key

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/nv/v1/sdk/intelligence/capabilities` | List intelligence capabilities |
| POST | `/api/nv/v1/sdk/intelligence/dashboard-insights` | Dashboard insights |
| POST | `/api/nv/v1/sdk/intelligence/case-risk-analysis` | Case risk scoring |
| POST | `/api/nv/v1/sdk/intelligence/predict-outcome` | Outcome prediction |
| POST | `/api/nv/v1/sdk/intelligence/suggest-invoice-items` | Invoice item suggestions |
| POST | `/api/nv/v1/sdk/intelligence/hearing-prep-checklist` | Hearing preparation |
| POST | `/api/nv/v1/sdk/intelligence/classify-document` | Document classification |
| POST | `/api/nv/v1/sdk/intelligence/sentiment-analysis` | Legal sentiment analysis |
| POST | `/api/nv/v1/sdk/intelligence/legal-research` | Legal research query |
| POST | `/api/nv/v1/sdk/intelligence/translate-legal` | Legal-specific translation |
| POST | `/api/nv/v1/sdk/intelligence/portfolio-risk-analysis` | Portfolio risk |
| GET | `/api/nv/v1/sdk/intelligence/client-health` | Client health overview |
| GET | `/api/nv/v1/sdk/intelligence/client-health/:clientId` | Client-specific health |

**Example — Case Risk Analysis:**
```bash
curl -X POST -H "X-API-Key: nyv_test_sk_nsi_..." \
  -H "Content-Type: application/json" \
  https://api.nyayasiddhi.online/api/nv/v1/sdk/intelligence/case-risk-analysis \
  -d '{
    "caseDescription": "Breach of contract for supply of goods worth INR 50 lakhs",
    "jurisdiction": "IN",
    "courtType": "High Court"
  }'
```

---

### 5.10 SDK Enterprise Research

Mount: `/api/nv/sdk/enterprise` | Auth: 🔑 SDK API Key (enterprise tier only)

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/nv/sdk/enterprise/financial/quote/:symbol` | Stock quote |
| GET | `/api/nv/sdk/enterprise/financial/historical/:symbol` | Historical data |
| GET | `/api/nv/sdk/enterprise/financial/fundamentals/:symbol` | Fundamentals |
| GET | `/api/nv/sdk/enterprise/financial/search` | Financial search |
| GET | `/api/nv/sdk/enterprise/financial/stats` | Financial stats |
| POST | `/api/nv/sdk/enterprise/code-review/analyze` | Code review |
| GET | `/api/nv/sdk/enterprise/code-review/stats` | Code review stats |
| POST | `/api/nv/sdk/enterprise/research/domain/legal` | Legal domain research |
| POST | `/api/nv/sdk/enterprise/research/domain/academic` | Academic research |
| POST | `/api/nv/sdk/enterprise/research/domain/patents` | Patent research |
| POST | `/api/nv/sdk/enterprise/research/domain/medical` | Medical research |
| POST | `/api/nv/sdk/enterprise/research/domain/synthesize` | Cross-domain synthesis |
| POST | `/api/nv/sdk/enterprise/research/investment/analyze` | Investment analysis |
| POST | `/api/nv/sdk/enterprise/research/investment/filings` | SEC/MCA filings |
| POST | `/api/nv/sdk/enterprise/research/investment/market-trends` | Market trends |
| POST | `/api/nv/sdk/enterprise/analytics/visual/chart` | Generate chart |
| POST | `/api/nv/sdk/enterprise/analytics/visual/dashboard` | Generate dashboard |
| GET | `/api/nv/sdk/enterprise/analytics/visual/stats` | Visual analytics stats |
| POST | `/api/nv/sdk/enterprise/assets/upload` | Upload asset |

---

### 5.11 Orchestration Engine

Mount: `/api/nv/orchestration` and `/api/nv` (alias) | Auth: 🔐 JWT

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/nv/orchestration/agents` | List agents |
| POST | `/api/nv/orchestrate` | **Primary orchestration** — send prompt, get AI response |
| POST | `/api/nv/orchestration/stream` | Streaming orchestration (SSE) |
| POST | `/api/nv/orchestration/agent/auto-select` | Auto-select best agent |
| POST | `/api/nv/orchestration/feedback` | Submit feedback |
| GET | `/api/nv/orchestration/feedback/stats` | Feedback stats |
| GET | `/api/nv/orchestration/feedback/recent` | Recent feedback |
| GET | `/api/nv/orchestration/hitl/pending` | Pending HITL reviews |
| GET | `/api/nv/orchestration/hitl/stats` | HITL stats |
| GET | `/api/nv/orchestration/hitl/:reviewId` | Get HITL review |
| POST | `/api/nv/orchestration/hitl/:reviewId/decision` | Submit HITL decision |
| POST | `/api/nv/orchestration/hallucination/check` | Hallucination detection |
| POST | `/api/nv/orchestration/bias/audit` | Bias audit |
| GET | `/api/nv/orchestration/bias/history` | Bias audit history |
| POST | `/api/nv/orchestration/citations/verify` | Citation verification |
| POST | `/api/nv/orchestration/explainability/generate` | Explainability report |
| GET | `/api/nv/orchestration/agent/metrics` | Agent performance metrics |
| GET | `/api/nv/orchestration/routing/weights` | LLM routing weights |
| GET | `/api/nv/orchestration/lineage/:requestId` | Request lineage/trace |
| POST | `/api/nv/orchestration/pii/tokenize` | PII tokenization |
| POST | `/api/nv/orchestration/pii/detokenize` | PII detokenization |
| POST | `/api/nv/orchestration/pii/cleanup` | PII cleanup |
| GET | `/api/nv/orchestration/model-governance` | Model governance policies |
| POST | `/api/nv/orchestration/model-governance` | Create governance policy |
| PUT | `/api/nv/orchestration/model-governance/:id` | Update governance policy |

**Example — Orchestrate (primary prompt):**
```bash
curl -X POST -H "Authorization: Bearer eyJ..." \
  -H "Content-Type: application/json" \
  https://api.nyayasiddhi.online/api/nv/orchestrate \
  -d '{
    "prompt": "What are the grounds for divorce under Hindu Marriage Act?",
    "jurisdiction": "IN",
    "agentId": "indian-family-law-specialist"
  }'
```

---

### 5.12 Legal Chat

Mount: `/api/nv/legal-chat` | Auth: 🔐 JWT

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/nv/legal-chat/sessions` | Create chat session |
| GET | `/api/nv/legal-chat/sessions` | List sessions |
| GET | `/api/nv/legal-chat/sessions/:id` | Get session detail |
| POST | `/api/nv/legal-chat/upload` | Upload files to session |
| POST | `/api/nv/legal-chat/send` | Send message |
| GET | `/api/nv/legal-chat/timeline/:orchestrationId` | Orchestration timeline |
| POST | `/api/nv/legal-chat/feedback` | Submit feedback |
| GET | `/api/nv/legal-chat/agents` | List available agents |
| GET | `/api/nv/legal-chat/models` | List available models |
| POST | `/api/nv/legal-chat/replay/:orchestrationId` | Replay orchestration |

---

### 5.13 Documents

Mount: `/api/nv/documents` | Auth: 🔐 JWT

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/nv/documents/upload` | Upload document (multipart) |
| GET | `/api/nv/documents/:docId/status` | Document processing status |
| GET | `/api/nv/documents/list` | List user documents |
| POST | `/api/nv/documents/search` | Search documents |
| DELETE | `/api/nv/documents/:docId` | Delete document |
| GET | `/api/nv/documents/graph/stats` | Document graph stats |

Mount: `/api/nv/doc-analyze` | Auth: 🔐 JWT

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/nv/doc-analyze/extract` | Extract text from document |
| POST | `/api/nv/doc-analyze/analyze` | Analyze document content |
| POST | `/api/nv/doc-analyze/extract-and-analyze` | Extract + analyze combined |
| GET | `/api/nv/doc-analyze/stats` | Analysis stats |
| GET | `/api/nv/doc-analyze/checklist` | Document checklist |

---

### 5.14 Agents

Mount: `/api/nv/agents` | Auth: 🔐 JWT (optional for list)

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/nv/agents` | List all agents (with tier filtering) |
| GET | `/api/nv/agents/tier/:tier` | List agents by tier |
| GET | `/api/nv/agents/:agentId` | Get agent details |
| POST | `/api/nv/agents/execute` | Execute agent |
| POST | `/api/nv/agents/orchestrate` | Multi-agent orchestration |

---

### 5.15 Jurisdictions

Mount: `/api/nv/jurisdiction` | Auth: 🔐 JWT (optional)

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/nv/jurisdiction` | List all jurisdictions |
| GET | `/api/nv/jurisdiction/stats` | Jurisdiction stats |
| GET | `/api/nv/jurisdiction/db-stats` | Database stats by jurisdiction |
| POST | `/api/nv/jurisdiction/sync` | Sync jurisdiction data |
| GET | `/api/nv/jurisdiction/compliance` | Compliance overview |
| GET | `/api/nv/jurisdiction/:code` | Get jurisdiction detail |
| GET | `/api/nv/jurisdiction/:code/compliance` | Jurisdiction compliance |
| GET | `/api/nv/jurisdiction/:code/data-residency` | Data residency rules |
| GET | `/api/nv/jurisdiction/:code/llm-routing` | LLM routing rules |
| GET | `/api/nv/jurisdiction/:code/languages` | Supported languages |
| POST | `/api/nv/jurisdiction/validate-transfer` | Validate cross-jurisdiction transfer |
| GET | `/api/nv/jurisdiction/registries/stats` | Registry stats |
| GET | `/api/nv/jurisdiction/registries/agents` | Agents by registry |
| GET | `/api/nv/jurisdiction/:code/agents` | Agents for jurisdiction |
| GET | `/api/nv/jurisdiction/:code/agents/:agentId` | Specific agent in jurisdiction |
| POST | `/api/nv/jurisdiction/resolve-agent` | Resolve agent for jurisdiction |

---

### 5.16 Case Management

Mount: `/api/nv/case-management` | Auth: 🔐 JWT

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/nv/case-management` | Create case |
| GET | `/api/nv/case-management` | List cases |
| GET | `/api/nv/case-management/stats` | Case statistics |
| GET | `/api/nv/case-management/:id` | Get case detail |
| PATCH | `/api/nv/case-management/:id` | Update case |
| POST | `/api/nv/case-management/:id/documents` | Add documents to case |
| GET | `/api/nv/case-management/:id/documents` | List case documents |
| POST | `/api/nv/case-management/:id/insights` | Generate case insights |
| GET | `/api/nv/case-management/:id/insights` | Get case insights |

Mount: `/api/nv/case-updates` | Auth: 🔐 JWT

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/nv/case-updates/types` | List update types |
| POST | `/api/nv/case-updates` | Create case update |
| GET | `/api/nv/case-updates/case/:caseId` | Get updates for case |
| GET | `/api/nv/case-updates/:updateId` | Get specific update |
| PATCH | `/api/nv/case-updates/:updateId` | Modify update |
| DELETE | `/api/nv/case-updates/:updateId` | Delete update |

---

### 5.17 Memory & Knowledge

Mount: `/api/nv/memory` | Auth: 🔐 JWT

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/nv/memory/remember` | Store memory |
| POST | `/api/nv/memory/recall` | Recall memory |
| DELETE | `/api/nv/memory/flush/:userId` | Flush user memory |
| GET | `/api/nv/memory/stats` | Memory stats |
| GET | `/api/nv/memory/export/:userId` | Export user memory |
| POST | `/api/nv/memory/import` | Import memory |
| POST | `/api/nv/memory/agent/publish` | Publish agent memory |
| GET | `/api/nv/memory/agent/recall/:sessionId` | Recall agent session |
| GET | `/api/nv/memory/health` | Memory service health |

Mount: `/api/nv/memory/social` | Auth: 🔐 JWT

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/nv/memory/social/org/:orgId` | Org social memory |
| GET | `/api/nv/memory/social/:userId/:agentKey` | User-agent memory |
| DELETE | `/api/nv/memory/social/:userId/:agentKey` | Delete user-agent memory |
| POST | `/api/nv/memory/social/:userId/:agentKey/refresh-opinion` | Refresh opinion |
| POST | `/api/nv/memory/social/record` | Record social interaction |

Mount: `/api/nv/knowledge` | Auth: 🔐 JWT

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/nv/knowledge` | List knowledge modules |
| POST | `/api/nv/knowledge/run-all` | Run all modules |
| POST | `/api/nv/knowledge/:moduleId/run` | Run specific module |
| GET | `/api/nv/knowledge/content` | Get knowledge content |
| DELETE | `/api/nv/knowledge/content/:id` | Delete content |
| PUT | `/api/nv/knowledge/:moduleId/settings` | Update module settings |
| GET | `/api/nv/knowledge/:moduleId/context` | Get module context |

---

### 5.18 Intelligence (Advanced)

Mount: `/api/nv/intelligence` | Auth: 🔐 JWT

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/nv/intelligence/status` | Intelligence service status |
| POST | `/api/nv/intelligence/conflict-detect` | Conflict of interest detection |
| POST | `/api/nv/intelligence/amendment-impact` | Amendment impact analysis |
| POST | `/api/nv/intelligence/statute-history` | Statute amendment history |
| POST | `/api/nv/intelligence/litigation-risk-v2` | Litigation risk scoring v2 |
| GET | `/api/nv/intelligence/regulatory-feed` | Regulatory update feed |
| POST | `/api/nv/intelligence/precedent-similarity` | Precedent similarity |
| POST | `/api/nv/intelligence/regulatory-digest` | Regulatory digest |
| GET | `/api/nv/intelligence/compliance-calendar` | Compliance calendar |
| POST | `/api/nv/intelligence/contract-analysis` | Contract analysis |
| POST | `/api/nv/intelligence/legal-ner` | Legal named entity recognition |
| POST | `/api/nv/intelligence/secure-session/create` | Create secure session |

**SDK Client:**
```typescript
const risk = await nyv.intelligence.litigationRiskV2({
  caseDescription: 'Breach of employment contract',
  jurisdiction: 'IN',
  courtLevel: 'high-court',
});

const feed = await nyv.intelligence.getRegulatoryFeed('IN');
const calendar = await nyv.intelligence.getComplianceCalendar('IN');
```

---

### 5.19 Nyaya Tools

Mount: `/api/nv/nyaya-tools` | Auth: 🔐 JWT

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/nv/nyaya-tools/status` | Tools status |
| POST | `/api/nv/nyaya-tools/graph/traverse` | Knowledge graph traversal |
| POST | `/api/nv/nyaya-tools/citations/verify` | Citation verification |
| POST | `/api/nv/nyaya-tools/compare/diff` | Document diff comparison |
| GET | `/api/nv/nyaya-tools/templates` | List templates |
| POST | `/api/nv/nyaya-tools/templates/generate` | Generate from template |
| POST | `/api/nv/nyaya-tools/templates/fill-session` | Interactive template fill |
| POST | `/api/nv/nyaya-tools/timeline/limitation` | Limitation period calculator |
| POST | `/api/nv/nyaya-tools/timeline/checklist` | Hearing checklist |
| POST | `/api/nv/nyaya-tools/forensic/verify` | Forensic document verification |
| POST | `/api/nv/nyaya-tools/trail/classify` | Trail classification |
| POST | `/api/nv/nyaya-tools/trail/privilege-log` | Privilege log |
| POST | `/api/nv/nyaya-tools/trail/e-discovery` | E-discovery |
| POST | `/api/nv/nyaya-tools/amend/record` | Record amendment |
| POST | `/api/nv/nyaya-tools/amend/timeline` | Amendment timeline |
| POST | `/api/nv/nyaya-tools/amend/as-of` | As-of-date query |
| POST | `/api/nv/nyaya-tools/amend/impact` | Amendment impact |
| GET | `/api/nv/nyaya-tools/amend/recent/:jurisdiction` | Recent amendments |
| POST | `/api/nv/nyaya-tools/lifecycle/spawn` | Spawn lifecycle |
| POST | `/api/nv/nyaya-tools/lifecycle/transition` | Lifecycle transition |
| GET | `/api/nv/nyaya-tools/lifecycle/health` | Lifecycle health |
| GET | `/api/nv/nyaya-tools/lifecycle/events` | Lifecycle events |
| POST | `/api/nv/nyaya-tools/memory/episodic` | Episodic memory |
| GET | `/api/nv/nyaya-tools/memory/episodic/:sessionId` | Recall episodic |
| POST | `/api/nv/nyaya-tools/memory/matter` | Matter memory |
| GET | `/api/nv/nyaya-tools/memory/matter/:matterId` | Recall matter |

**SDK Client:**
```typescript
const citationResult = await nyv.nyayaTools.citationCheck(
  'AIR 1973 SC 1461',
  'IN'
);

const templates = await nyv.nyayaTools.templatesList({
  jurisdiction: 'IN',
  category: 'contracts',
});
```

---

### 5.20 Patterns (22 Agentic AI Patterns)

Mount: `/api/nv/patterns` | Auth: 🔐 JWT

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/nv/patterns/react` | ReAct pattern (Reason + Act) |
| POST | `/api/nv/patterns/cot` | Chain-of-Thought |
| POST | `/api/nv/patterns/tot` | Tree-of-Thought |
| POST | `/api/nv/patterns/mcts` | Monte Carlo Tree Search |
| POST | `/api/nv/patterns/swarm` | SwarmAI (multi-agent) |
| POST | `/api/nv/patterns/rag` | RAG pattern |
| POST | `/api/nv/patterns/debate` | Multi-agent debate |
| POST | `/api/nv/patterns/verify` | Verification pattern |
| POST | `/api/nv/patterns/plan-execute` | Plan-and-Execute |
| POST | `/api/nv/patterns/self-refine` | Self-refinement |
| POST | `/api/nv/patterns/meta-prompt` | Meta-prompting |
| POST | `/api/nv/patterns/reflection` | Reflection pattern |

**SDK Client (streaming):**
```typescript
await nyv.stream.streamPattern('cot', {
  task: 'Analyze the merits of a wrongful termination claim',
  jurisdiction: 'IN',
}, {
  onTextDelta: (delta) => process.stdout.write(delta),
  onComplete: (result) => console.log('Done:', result.citations),
});
```

---

### 5.21 Skills Marketplace

Mount: `/api/nv/skills` | Auth: 🔐 JWT

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/nv/skills/health` | Skills service health |
| GET | `/api/nv/skills` | List skills |
| GET | `/api/nv/skills/marketplace` | Browse marketplace |
| GET | `/api/nv/skills/:skillId` | Get skill detail |
| POST | `/api/nv/skills/activate` | Activate skill |
| POST | `/api/nv/skills/register` | Register new skill |
| POST | `/api/nv/skills/record-performance` | Record performance |
| GET | `/api/nv/skills/meta/categories` | Skill categories |
| GET | `/api/nv/skills/meta/stats` | Skills stats |

---

### 5.22 TwinDesk™ — Digital Twin

Mount: `/api/nv/twindesk` | Auth: 🔐 JWT

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/nv/twindesk/twins` | Create digital twin |
| GET | `/api/nv/twindesk/twins` | List twins |
| GET | `/api/nv/twindesk/twins/:twinId` | Get twin detail |
| PATCH | `/api/nv/twindesk/twins/:twinId` | Update twin |
| DELETE | `/api/nv/twindesk/twins/:twinId` | Delete twin |
| POST | `/api/nv/twindesk/twins/:twinId/simulate` | Run simulation |
| GET | `/api/nv/twindesk/twins/:twinId/simulations` | List simulations |
| POST | `/api/nv/twindesk/twins/:twinId/chat` | Chat with twin |
| POST | `/api/nv/twindesk/twins/:twinId/benchmark` | Benchmark twin |
| GET | `/api/nv/twindesk/personas` | List personas |
| GET | `/api/nv/twindesk/stats` | TwinDesk stats |

**Example — Create & Chat with Digital Twin:**
```bash
# Create twin
curl -X POST -H "Authorization: Bearer eyJ..." \
  -H "Content-Type: application/json" \
  https://api.nyayasiddhi.online/api/nv/twindesk/twins \
  -d '{
    "name": "Senior Corporate Counsel Twin",
    "persona": "corporate-lawyer",
    "jurisdiction": "IN",
    "specialization": "mergers-acquisitions"
  }'
# → { "twinId": "tw_abc123", ... }

# Chat with twin
curl -X POST -H "Authorization: Bearer eyJ..." \
  -H "Content-Type: application/json" \
  https://api.nyayasiddhi.online/api/nv/twindesk/twins/tw_abc123/chat \
  -d '{
    "message": "Draft a non-compete clause for an employment agreement",
    "context": { "industry": "technology", "duration": "2 years" }
  }'
```

**SDK Client:**
```typescript
const twin = await nyv.twins.create({
  name: 'Corporate Counsel',
  persona: 'corporate-lawyer',
  jurisdiction: 'IN',
});
const response = await nyv.twins.chat(twin.twinId, {
  message: 'Draft a non-compete clause',
});
```

---

### 5.23 AutomateAI™ — Workflow Builder

Mount: `/api/nv/automateai` | Auth: 🔐 JWT

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/nv/automateai/workflows` | Create workflow |
| GET | `/api/nv/automateai/workflows` | List workflows |
| GET | `/api/nv/automateai/workflows/:id` | Get workflow |
| PUT | `/api/nv/automateai/workflows/:id` | Update workflow |
| DELETE | `/api/nv/automateai/workflows/:id` | Delete workflow |
| POST | `/api/nv/automateai/workflows/:id/activate` | Activate workflow |
| POST | `/api/nv/automateai/workflows/:id/pause` | Pause workflow |
| POST | `/api/nv/automateai/workflows/:id/execute` | Execute workflow |
| GET | `/api/nv/automateai/executions/:executionId` | Get execution |
| GET | `/api/nv/automateai/workflows/:id/executions` | List executions |
| POST | `/api/nv/automateai/executions/:executionId/approve` | Approve HITL gate |
| GET | `/api/nv/automateai/gate-types` | List 8 AI gate types |
| GET | `/api/nv/automateai/stats` | AutomateAI stats |

**Example — Create & Execute Workflow:**
```bash
# Create workflow
curl -X POST -H "Authorization: Bearer eyJ..." \
  -H "Content-Type: application/json" \
  https://api.nyayasiddhi.online/api/nv/automateai/workflows \
  -d '{
    "name": "New Matter Intake",
    "description": "Automated intake: extract parties → conflict check → draft engagement letter",
    "steps": [
      { "type": "extract-entities", "config": { "entityTypes": ["parties","dates"] } },
      { "type": "conflict-check", "config": { "scope": "org" } },
      { "type": "ai-gate", "gateType": "approval", "config": { "threshold": 0.8 } },
      { "type": "draft-document", "config": { "template": "engagement-letter" } }
    ]
  }'

# Execute
curl -X POST -H "Authorization: Bearer eyJ..." \
  https://api.nyayasiddhi.online/api/nv/automateai/workflows/wf_xyz/execute \
  -d '{ "input": { "matterDescription": "..." } }'
```

---

### 5.24 SkillShop™ — Legal AI Marketplace

Mount: `/api/nv/skillshop` | Auth: 🔐 JWT

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/nv/skillshop/skills` | Browse skills |
| GET | `/api/nv/skillshop/skills/:skillId` | Get skill detail |
| POST | `/api/nv/skillshop/skills/:skillId/install` | Install skill |
| DELETE | `/api/nv/skillshop/skills/:skillId/install` | Uninstall skill |
| GET | `/api/nv/skillshop/installed` | List installed skills |
| GET | `/api/nv/skillshop/categories` | List categories |
| GET | `/api/nv/skillshop/stats` | SkillShop stats |
| POST | `/api/nv/skillshop/publish` | Publish a skill |
| GET | `/api/nv/skillshop/publisher/:publisherName` | Publisher profile |

---

### 5.25 ClaWdBot & OpenBot

Mount: `/api/nv/clawdbot` | Auth: 🔐 JWT — WhatsApp/Telegram legal chatbot

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/nv/clawdbot/bots` | Create bot |
| GET | `/api/nv/clawdbot/bots` | List bots |
| GET | `/api/nv/clawdbot/bots/:botId` | Get bot |
| PUT | `/api/nv/clawdbot/bots/:botId` | Update bot |
| POST | `/api/nv/clawdbot/bots/:botId/activate` | Activate |
| POST | `/api/nv/clawdbot/bots/:botId/pause` | Pause |
| DELETE | `/api/nv/clawdbot/bots/:botId` | Delete |

Mount: `/api/nv/openbot` | Auth: 🔐 JWT — Multi-channel studio

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/nv/openbot/channels` | Register channel |
| GET | `/api/nv/openbot/channels` | List channels |
| DELETE | `/api/nv/openbot/channels/:channelId` | Remove channel |
| POST | `/api/nv/openbot/channels/:channelId/send` | Send message |
| GET | `/api/nv/openbot/channels/:channelId/inbox` | Channel inbox |
| GET | `/api/nv/openbot/inbox` | Combined inbox |
| POST | `/api/nv/openbot/rules` | Create automation rule |
| POST | `/api/nv/openbot/webhooks/:channel/:channelId` | Webhook receiver |
| GET | `/api/nv/openbot/stats` | OpenBot stats |

---

### 5.26 Enterprise Admin

Mount: `/api/nv/enterprise/admin` | Auth: 🔐 JWT (org_admin/super_admin)

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/nv/enterprise/admin/organizations` | List organizations |
| POST | `/api/nv/enterprise/admin/organizations` | Create organization |
| PATCH | `/api/nv/enterprise/admin/organizations/:id` | Update organization |
| DELETE | `/api/nv/enterprise/admin/organizations/:id` | Delete organization |
| GET | `/api/nv/enterprise/admin/users` | List users |
| POST | `/api/nv/enterprise/admin/users` | Create user |
| PATCH | `/api/nv/enterprise/admin/users/:id` | Update user |
| DELETE | `/api/nv/enterprise/admin/users/:id` | Delete user |
| PATCH | `/api/nv/enterprise/admin/users/:id/role` | Change user role |
| GET | `/api/nv/enterprise/admin/platform-settings` | Get settings |
| PATCH | `/api/nv/enterprise/admin/platform-settings` | Update settings |
| GET | `/api/nv/enterprise/admin/stats` | Platform statistics |
| GET | `/api/nv/enterprise/admin/audit-log` | Audit log |
| GET | `/api/nv/enterprise/admin/audit-logs` | Paginated audit logs |
| GET | `/api/nv/enterprise/admin/audit-logs/stats` | Audit stats |
| GET | `/api/nv/enterprise/admin/audit-logs/export` | Export audit logs |
| GET | `/api/nv/enterprise/admin/webhooks` | List webhooks |
| POST | `/api/nv/enterprise/admin/webhooks` | Create webhook |

---

### 5.27 Payments (Razorpay)

Mount: `/api/nv/payments` | Auth: mixed

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/api/nv/payments/health` | 🔓 | Payment service health |
| POST | `/api/nv/payments/webhook` | 🔓 | Razorpay webhook |
| POST | `/api/nv/payments/orders` | 🔐 | Create order |
| GET | `/api/nv/payments/orders/:orderId` | 🔐 | Get order |
| POST | `/api/nv/payments/capture` | 🔐 | Capture payment |
| POST | `/api/nv/payments/refund` | 🔐 | Process refund |
| POST | `/api/nv/payments/verify` | 🔐 | Verify payment signature |
| POST | `/api/nv/payments/plans` | 🔐 | Create subscription plan |
| POST | `/api/nv/payments/subscriptions` | 🔐 | Create subscription |
| GET | `/api/nv/payments/subscriptions/:id` | 🔐 | Get subscription |
| POST | `/api/nv/payments/subscriptions/:id/cancel` | 🔐 | Cancel subscription |
| POST | `/api/nv/payments/customers` | 🔐 | Create customer |
| POST | `/api/nv/payments/invoices` | 🔐 | Create invoice |
| POST | `/api/nv/payments/links` | 🔐 | Create payment link |

---

### 5.28 Subscriptions & Credits

Mount: `/api/nv/subscription` | Auth: mixed

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/api/nv/subscription/plans` | 🔓 | List subscription plans |
| GET | `/api/nv/subscription/me` | 🔐 | My subscription |
| POST | `/api/nv/subscription/create` | 🔐 | Create subscription |
| POST | `/api/nv/subscription/cancel` | 🔐 | Cancel subscription |
| GET | `/api/nv/subscription/credits/wallet` | 🔐 | Credit wallet balance |
| GET | `/api/nv/subscription/credits/transactions` | 🔐 | Credit transactions |
| POST | `/api/nv/subscription/credits/topup` | 🔐 | Top up credits (enterprise only) |
| GET | `/api/nv/subscription/credits/costs` | 🔓 | Cost table |

Mount: `/api/nv/credits` | Auth: 🔐 JWT

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/nv/credits/wallet` | Wallet balance |
| GET | `/api/nv/credits/transactions` | Transactions |
| POST | `/api/nv/credits/topup` | Top up |
| GET | `/api/nv/credits/costs` | Cost reference |

**SDK Client:**
```typescript
const wallet = await nyv.credits.getWallet();
// → { balance: 5000, currency: 'INR', tier: 'pro' }

const cost = await nyv.credits.estimateCost('cot', {
  estimatedInputTokens: 500,
  estimatedOutputTokens: 2000,
});
// → { estimatedCost: 12.5, currency: 'INR' }
```

---

### 5.29 Compliance & Consent (DPDPA 2023 / EU AI Act)

Mount: `/api/nv/consent` | Auth: 🔐 JWT

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/nv/consent/grant` | Grant consent |
| POST | `/api/nv/consent/withdraw` | Withdraw consent |
| GET | `/api/nv/consent/status` | Consent status |
| GET | `/api/nv/consent/export` | Export personal data (DPDPA right) |
| DELETE | `/api/nv/consent/delete-my-data` | Right to erasure |
| GET | `/api/nv/consent/purposes` | Consent purposes list |

Mount: `/api/nv/compliance` | Auth: 🔐 JWT

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/nv/compliance/health` | Compliance health |
| GET | `/api/nv/compliance/aims/inventory` | AI system inventory |
| GET | `/api/nv/compliance/aims/risk-register` | Risk register |
| GET | `/api/nv/compliance/aims/model-cards` | Model cards |

---

### 5.30 RAG & eCourts

Mount: `/api/nv/rag` | Auth: 🔐 JWT

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/nv/rag/health` | RAG service health |
| POST | `/api/nv/rag/query` | Query vector store |
| POST | `/api/nv/rag/embed` | Embed document |
| GET | `/api/nv/rag/namespaces` | List namespaces |

Mount: `/api/nv/ecourts` | Auth: 🔐 JWT

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/nv/ecourts/health` | eCourts health |
| GET | `/api/nv/ecourts/case/:cnrNumber` | Case status by CNR |
| GET | `/api/nv/ecourts/case/:cnrNumber/orders` | Case orders |
| GET | `/api/nv/ecourts/causelist/:courtCode` | Cause list |

---

### 5.31 Observability & Admin

Mount: `/api/nv/observability` | Auth: mixed

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/nv/observability/router-stats` | LLM routing statistics |
| GET | `/api/nv/observability/router-stats/persistent` | Persistent stats (admin) |
| GET | `/api/nv/observability/router-stats/recent` | Recent decisions |
| GET | `/api/nv/observability/router-stats/catalog` | Model catalog |
| POST | `/api/nv/observability/router-stats/explain` | Explain routing decision |

Mount: `/api/nv/admin/routing-weights` | Auth: 👑

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/nv/admin/routing-weights` | Live routing weights dashboard (HTML) |

Mount: `/api/nv/docs` | Auth: 🔓

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/nv/docs` | Swagger UI |
| GET | `/api/nv/docs/swagger.json` | Swagger JSON spec |
| GET | `/api/nv/docs/openapi.json` | OpenAPI JSON spec |
| GET | `/api/nv/docs/openapi.yaml` | OpenAPI YAML spec |

---

### 5.32 SDK Downloads

Mount: `/downloads/sdk` | Auth: 🔓 Public by default (env-configurable)

> **Important:** SDK downloads are **public by default** (`NYV_SDK_DOWNLOADS_PUBLIC=true`).
> Set `NYV_SDK_DOWNLOADS_PUBLIC=false` on the gateway to require token or HMAC auth.

| Method | Endpoint | Description |
|---|---|---|
| GET | `/downloads/sdk/:package/:version.tgz` | Download SDK tarball |
| GET | `/downloads/sdk/manifest.json` | SDK manifest (all packages + versions) |

```bash
# Download client-sdk v5.0.0
curl -H "X-API-Key: nyv_test_sk_nsp_..." \
  -L -o client-sdk-5.0.0.tgz \
  https://api.nyayasiddhi.online/downloads/sdk/client-sdk/5.0.0.tgz
```

---

### 5.33 SDK Console (App Management)

Mount: `/api/nv/sdk` (catch-all) | Auth: 🔐 JWT

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/nv/sdk/info` | SDK platform info |
| POST | `/api/nv/sdk/apps` | Create SDK app |
| GET | `/api/nv/sdk/apps` | List apps |
| GET | `/api/nv/sdk/apps/:appId` | Get app detail |
| PUT | `/api/nv/sdk/apps/:appId` | Update app |
| POST | `/api/nv/sdk/apps/:appId/suspend` | Suspend app |
| POST | `/api/nv/sdk/apps/:appId/revoke` | Revoke app |
| POST | `/api/nv/sdk/apps/:appId/activate` | Activate app |
| POST | `/api/nv/sdk/apps/:appId/rotate-secret` | Rotate app secret |
| POST | `/api/nv/sdk/apps/:appId/keys` | Generate key |
| GET | `/api/nv/sdk/apps/:appId/keys` | List keys |
| POST | `/api/nv/sdk/apps/:appId/keys/:keyId/revoke` | Revoke key |
| POST | `/api/nv/sdk/apps/:appId/keys/:keyId/activate` | Activate key |
| POST | `/api/nv/sdk/apps/:appId/agents` | Assign agents |
| GET | `/api/nv/sdk/apps/:appId/agents` | List assigned agents |
| DELETE | `/api/nv/sdk/apps/:appId/agents/:agentId` | Remove agent |
| GET | `/api/nv/sdk/apps/:appId/usage` | App usage |
| GET | `/api/nv/sdk/overview` | Console overview |
| POST | `/api/nv/sdk/apps/:appId/webhook/test` | Test webhook |

---

### 5.34 SDK Developer Portal

Mount: `/api/nv/sdk/developer-portal` | Auth: 🔓

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/nv/sdk/developer-portal` | Portal home |
| GET | `/api/nv/sdk/developer-portal/getting-started` | Getting started guide |
| GET | `/api/nv/sdk/developer-portal/api-reference` | API reference index |
| GET | `/api/nv/sdk/developer-portal/quickstarts` | Platform quickstarts |
| GET | `/api/nv/sdk/developer-portal/quickstarts/:platformId` | Platform-specific quickstart |
| GET | `/api/nv/sdk/developer-portal/webhooks` | Webhook reference |
| GET | `/api/nv/sdk/developer-portal/packages` | SDK package listing |
| GET | `/api/nv/sdk/developer-portal/jurisdictions` | Jurisdiction reference |
| GET | `/api/nv/sdk/developer-portal/patterns` | Pattern reference |
| GET | `/api/nv/sdk/developer-portal/errors` | Error code reference |

---

### 5.35 Platform Registry

Mount: `/api/nv/platforms` | Auth: 🔐 JWT (admin)

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/nv/platforms` | List all 5 Nyayasiddhi platforms |
| GET | `/api/nv/platforms/:id` | Get platform detail |
| POST | `/api/nv/platforms` | Create platform definition |
| PUT | `/api/nv/platforms/:id` | Update platform |
| PATCH | `/api/nv/platforms/:id/status` | Toggle platform status |
| PATCH | `/api/nv/platforms/:id/modules` | Update platform modules |
| PATCH | `/api/nv/platforms/:id/llm-config` | Update LLM routing config |
| PATCH | `/api/nv/platforms/:id/rate-limits` | Update rate limits |
| PATCH | `/api/nv/platforms/:id/agents` | Update agent assignments |
| GET | `/api/nv/platforms/:id/usage` | Platform usage stats |
| DELETE | `/api/nv/platforms/:id` | Delete platform |

---

### 5.36 Model Registry

Mount: `/api/nv/models` | Auth: 🔐 JWT

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/nv/models` | List all registered LLM models |
| GET | `/api/nv/models/stats` | Model usage statistics |
| GET | `/api/nv/models/select` | Model selection helper (by capability/tier) |
| GET | `/api/nv/models/:modelId` | Get model detail |
| POST | `/api/nv/models/register` | Register new model |
| PATCH | `/api/nv/models/:modelId/toggle` | Enable/disable model |
| DELETE | `/api/nv/models/:modelId` | Remove model |
| POST | `/api/nv/models/reload` | Reload model registry from config |
| GET | `/api/nv/models/jurisdiction/:code` | Models available for jurisdiction |

---

### 5.37 Feature Flags

Mount: `/api/nv/flags` | Auth: 🔐 JWT (admin)

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/nv/flags` | List all feature flags |
| GET | `/api/nv/flags/evaluate` | Evaluate flags for current context |
| GET | `/api/nv/flags/:key` | Get flag detail |
| POST | `/api/nv/flags` | Create feature flag |
| PATCH | `/api/nv/flags/:key/toggle` | Toggle flag on/off |
| POST | `/api/nv/flags/:key/kill-switch` | Emergency kill switch |
| DELETE | `/api/nv/flags/:key` | Delete flag |
| POST | `/api/nv/flags/sync` | Sync flags from config |

---

### 5.38 Tenant Management

Mount: `/api/nv/tenants` | Auth: 🔐 JWT (admin)

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/nv/tenants` | List all tenants |
| GET | `/api/nv/tenants/:tenantId` | Get tenant detail |
| POST | `/api/nv/tenants` | Create tenant |
| PATCH | `/api/nv/tenants/:tenantId/tier` | Change tenant tier |
| POST | `/api/nv/tenants/:tenantId/suspend` | Suspend tenant |
| POST | `/api/nv/tenants/:tenantId/activate` | Activate tenant |
| GET | `/api/nv/tenants/:tenantId/usage` | Tenant usage stats |
| GET | `/api/nv/tenants/:tenantId/model-access` | Tenant model access |
| POST | `/api/nv/tenants/:tenantId/audit` | Tenant audit entry |
| GET | `/api/nv/tenants/by-org/:orgId` | Tenants by organization |

---

### 5.39 Version Management

Mount: `/api/nv/versions` | Auth: 🔐 JWT

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/nv/versions` | Current platform version |
| GET | `/api/nv/versions/changelog` | Version changelog |
| GET | `/api/nv/versions/modules` | List all modules + versions |
| GET | `/api/nv/versions/modules/:moduleId` | Module version detail |
| GET | `/api/nv/versions/modules/:moduleId/changelog` | Module changelog |
| POST | `/api/nv/versions/modules/:moduleId/bump` | Bump module version (admin) |
| POST | `/api/nv/versions/modules/:moduleId/rollback` | Rollback module (admin) |
| GET | `/api/nv/versions/deployments` | Deployment history |
| POST | `/api/nv/versions/deployments` | Record deployment |

---

### 5.40 Workspace Projects

Mount: `/api/nv/workspace` | Auth: 🔐 JWT

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/nv/workspace` | List workspaces |
| GET | `/api/nv/workspace/:id` | Get workspace detail |
| POST | `/api/nv/workspace` | Create workspace |
| PATCH | `/api/nv/workspace/:id` | Update workspace |
| GET | `/api/nv/workspace/:id/progress` | Workspace progress |
| GET | `/api/nv/workspace/:id/tasks` | List workspace tasks |
| GET | `/api/nv/workspace/:id/messages` | Workspace messages |
| GET | `/api/nv/workspace/:id/agents` | Workspace agents |
| GET | `/api/nv/workspace/:id/files` | Workspace files |
| POST | `/api/nv/workspace/:id/initialize` | Initialize workspace |
| GET | `/api/nv/workspace/:id/cost-metrics` | Cost metrics |
| GET | `/api/nv/workspace/:id/deployments` | Workspace deployments |
| POST | `/api/nv/workspace/:id/deploy` | Deploy workspace |
| GET | `/api/nv/workspace/tasks/:taskId` | Get task detail |
| POST | `/api/nv/workspace/tasks/:taskId/execute` | Execute task |

---

### 5.41 Identity Extraction

Mount: `/api/nv/identity` | Auth: 🔐 JWT

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/nv/identity/extract` | Extract identity from document |
| GET | `/api/nv/identity/extractions` | List extractions |
| GET | `/api/nv/identity/extractions/:id` | Get extraction detail |
| POST | `/api/nv/identity/extractions/:id/review` | Review extraction |
| POST | `/api/nv/identity/extractions/:id/apply` | Apply extraction |

---

### 5.42 Content Generation

Mount: `/api/nv/content` | Auth: 🔐 JWT

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/nv/content/generate` | Generate legal content |
| GET | `/api/nv/content/history` | Content generation history |
| POST | `/api/nv/content/insights` | Content insights |
| GET | `/api/nv/content/schedule` | Content schedule |
| POST | `/api/nv/content/bulk-generate` | Bulk content generation |

---

### 5.43 GST & Invoicing (India)

Mount: `/api/nv/gst` | Auth: mixed

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/api/nv/gst/rates` | 🔓 | GST rate table |
| POST | `/api/nv/gst/compute` | 🔐 | Compute GST for amount |
| POST | `/api/nv/gst/invoice` | 🔐 | Generate GST invoice |
| POST | `/api/nv/gst/payment-ref` | 🔐 | Create payment reference |
| POST | `/api/nv/gst/validate-gstin` | 🔓 | Validate GSTIN number |
| POST | `/api/nv/gst/invoice/pdf` | 🔐 | Generate invoice PDF |

---

### 5.44 Institutional Onboarding

Mount: `/api/nv/institutional` | Auth: mixed

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/api/nv/institutional/request` | 🔓 | Submit institutional inquiry/demo request |
| GET | `/api/nv/institutional/lead/:id` | 🔐 (enterprise/govt) | Get lead detail |
| GET | `/api/nv/institutional/leads` | 🔐 (enterprise/govt) | List leads |
| PATCH | `/api/nv/institutional/lead/:id` | 🔐 (enterprise/govt) | Update lead |

---

### 5.45 WhatsApp Channel

Mount: `/api/nv/channels/whatsapp` | Auth: mixed

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/api/nv/channels/whatsapp/health` | 🔓 | WhatsApp service health |
| GET | `/api/nv/channels/whatsapp/webhook` | 🔓 | WhatsApp webhook verification (GET challenge) |
| POST | `/api/nv/channels/whatsapp/webhook` | 🔓 | WhatsApp webhook receiver |
| POST | `/api/nv/channels/whatsapp/send/text` | 🔐 | Send text message |
| POST | `/api/nv/channels/whatsapp/send/template` | 🔐 | Send template message |
| POST | `/api/nv/channels/whatsapp/send/alert` | 🔐 | Send alert message |

---

### 5.46 Org RLS (Row-Level Security)

Mount: `/api/nv/org/rls` | Auth: 🔐 JWT (admin)

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/nv/org/rls/status` | RLS enforcement status |
| POST | `/api/nv/org/rls/apply` | Apply RLS policies |
| GET | `/api/nv/org/rls/stats/:orgId` | RLS stats for organization |

---

## 6. Per-Platform Endpoint Access Matrix (all 7 platforms)

> Verified live 2026-05-05 against the running v5.0.0 gateway. ✅ = `200 OK`,
> ❌ = `403 Forbidden` (insufficient scope), ⚠ = JWT-only (SDK key alone returns 401).
> The 4 SDK gateway columns reflect actual `scopes` on `sdk_app_api_keys`.

| Endpoint Group | NSP | NSPM | NYM | NSI | NSA | NSM | JRX |
|---|---|---|---|---|---|---|---|
| `/api/nv/sdk/provision/health` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `/api/nv/sdk/provision/validate` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `/api/nv/gateway/health` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `/api/nv/gateway/agents` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `/api/nv/gateway/translate*` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `/api/nv/gateway/research/*` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `/api/nv/gateway/documents/*` | ✅ | ✅ | ❌ | ✅ | ❌ | ✅ | ✅ |
| `/api/nv/gateway/usage*` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `/api/nv/gateway/payments/*` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ (IN-only) |
| `/api/nv/gateway/ocr/*` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `/api/nv/sdk/docs-pipeline/*` | ✅ | ✅ | ❌ | ✅ | ❌ | ✅ | ✅ |
| `/api/nv/sdk/docs-pipeline/clauses/library` | ✅ | ✅ | ❌ | ✅ | ❌ | ✅ | ✅ |
| `/api/nv/sdk/docs-pipeline/documents/templates` | ✅ | ✅ | ❌ | ✅ | ❌ | ✅ | ✅ |
| `/api/nv/sdk/multimodal/multimodal/capabilities` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `/api/nv/sdk/multimodal/voice/*` | ✅ | ✅ | ❌ | ✅ | ❌ | ✅ | ✅ |
| `/api/nv/sdk/multimodal/multimodal/vision/*` | ✅ | ✅ | ❌ | ✅ | ❌ | ✅ | ✅ |
| `/api/nv/sdk/enterprise/*` (research, analytics, code-review) | ❌ | ❌ | ❌ | ✅ | ❌ | ✅ | ✅ |
| `/api/nv/orchestrate` (JWT) | ⚠ JWT | ⚠ JWT | ⚠ JWT | ⚠ JWT | ⚠ JWT | ⚠ JWT | ⚠ JWT |
| `/api/nv/twindesk/*` (JWT) | ⚠ JWT | ⚠ JWT | ❌ | ⚠ JWT | ❌ | ⚠ JWT | ⚠ JWT |
| `/api/nv/automateai/*` (JWT) | ⚠ JWT | ⚠ JWT | ❌ | ⚠ JWT | ❌ | ⚠ JWT | ⚠ JWT |
| `/api/nv/skillshop/*` (JWT) | ⚠ JWT | ⚠ JWT | ❌ | ⚠ JWT | ⚠ JWT | ⚠ JWT | ⚠ JWT |
| `/api/nv/admin/*` (Admin JWT) | 👑 only | 👑 only | ❌ | 👑 only | ❌ | 👑 only | 👑 only |
| `/api/nv/gst/*` (India tax) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ (US plat) |
| `/api/nv/channels/whatsapp/*` | ⚠ JWT | ⚠ JWT | ⚠ JWT | ⚠ JWT | ⚠ JWT | ⚠ JWT | ❌ (IN-only) |
| `/api/nv/org/rls/*` | ❌ | ❌ | ❌ | 👑 only | ❌ | 👑 only | 👑 only |

---

## 7. Error Codes

| HTTP | Code | Meaning |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Invalid request body or parameters |
| 401 | `UNAUTHORIZED` | Missing or invalid API key / JWT |
| 403 | `FORBIDDEN` | Valid auth but insufficient tier/role |
| 404 | `NOT_FOUND` | Endpoint or resource not found |
| 409 | `CONFLICT` | Resource already exists |
| 422 | `UNPROCESSABLE` | Valid format but semantically wrong |
| 429 | `RATE_LIMIT` | Rate limit exceeded |
| 500 | `INTERNAL_ERROR` | Server error |
| 503 | `SERVICE_UNAVAILABLE` | Service temporarily unavailable |

**Error response shape:**
```json
{
  "success": false,
  "code": "RATE_LIMIT",
  "message": "Rate limit exceeded. Retry after 30 seconds.",
  "traceId": "nyv-trace-abc123",
  "details": { "limit": 100, "remaining": 0, "resetAt": "2026-05-04T10:30:00Z" }
}
```

---

## 8. Rate Limits

| Tier | Public endpoints | Auth endpoints | AI patterns | SDK endpoints | Enterprise |
|---|---|---|---|---|---|
| **solo/citizen** | 30/min | 60/min | 10/min | 30/min | — |
| **plus** | 60/min | 120/min | 20/min | 60/min | — |
| **pro** | 120/min | 300/min | 50/min | 120/min | — |
| **enterprise** | 300/min | 600/min | 100/min | 300/min | 200/min |
| **government** | 600/min | 1200/min | 200/min | 600/min | 400/min |

Login/register endpoints: 5 attempts per 15 minutes.

---

## 9. Webhook Events

When configured, Nyayavigya sends POST requests to your webhook URL with these events:

| Event | Trigger |
|---|---|
| `documents.analysis.completed` | Document analysis finished |
| `documents.analysis.failed` | Document analysis failed |
| `orchestration.completed` | Orchestration request completed |
| `orchestration.hitl.required` | Human-in-the-loop review needed |
| `agents.execution.completed` | Agent execution finished |
| `agents.execution.failed` | Agent execution failed |
| `workflow.step.completed` | Workflow step completed |
| `workflow.approval.required` | Workflow needs human approval |
| `subscription.created` | Subscription created |
| `subscription.cancelled` | Subscription cancelled |
| `payment.captured` | Payment captured |
| `payment.failed` | Payment failed |

**Webhook verification:**
```typescript
import crypto from 'crypto';

function verifyWebhook(rawBody: Buffer, signature: string, secret: string): boolean {
  const expected = 'sha256=' + crypto
    .createHmac('sha256', secret)  // secret = nyv_wh_<platform>_...
    .update(rawBody)
    .digest('hex');
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

// In your Express handler:
app.post('/webhooks/nyayavigya', express.raw({ type: 'application/json' }), (req, res) => {
  const sig = req.headers['x-nyv-signature'] as string;
  if (!verifyWebhook(req.body, sig, process.env.NYV_WEBHOOK_SECRET)) {
    return res.status(401).send('Invalid signature');
  }
  const event = JSON.parse(req.body.toString());
  // Handle event...
  res.status(200).json({ received: true });
});
```

---

## Appendices

### A. Cross-reference documents

| Document | Purpose |
|---|---|
| [`NYV-MASTER-INTEGRATION-GUIDE-2026-05-04.md`](./NYV-MASTER-INTEGRATION-GUIDE-2026-05-04.md) | Operator-facing: deploy flow, S3, code structure |
| [`SDK-ENDPOINTS-CANONICAL-2026-05-02.md`](./SDK-ENDPOINTS-CANONICAL-2026-05-02.md) | Reality-checked endpoint truth table |
| [`NYV-OPS-RUNBOOK.md`](./NYV-OPS-RUNBOOK.md) | Operations SOP (deploy, rollback, key mint) |
| [`SDK-PLATFORM-NSP-WEB.md`](./SDK-PLATFORM-NSP-WEB.md) | NSP-WEB detailed guide |
| [`SDK-PLATFORM-NSP-MOBILE.md`](./SDK-PLATFORM-NSP-MOBILE.md) | NSP-MOBILE detailed guide |
| [`SDK-PLATFORM-NYAYAMITRA.md`](./SDK-PLATFORM-NYAYAMITRA.md) | Nyayamitra detailed guide |
| [`SDK-PLATFORM-NSI.md`](./SDK-PLATFORM-NSI.md) | NSI detailed guide |
| [`SDK-PLATFORM-JRX.md`](./SDK-PLATFORM-JRX.md) | JRX detailed guide |

### B. Environment variables (SDK client-side) — 7 platforms

| Variable | Example | Platform | Notes |
|---|---|---|---|
| `NYV_SDK_KEY_NSP` | `nyv_live_sk_nsp_...` | NSP-WEB (Nyayasiddhi Professional Web) | Replit Secret / AWS `.env.production` |
| `NYV_SDK_KEY_NSPM` | `nyv_live_sk_nspm_...` | NSPM (Nyayasiddhi Professional Mobile) | Replit Secret / AWS `.env.production` |
| `NYV_SDK_KEY_NYM` | `nyv_live_sk_nym_...` | NYM (Nyayamitra Citizen) | Replit Secret / AWS `.env.production` |
| `NYV_SDK_KEY_NSI` | `nyv_live_sk_nsi_...` | NSI (Institutional — IN) | Replit Secret / AWS `.env.production` |
| `NYV_SDK_KEY_NSA` | `nyv_live_sk_nsa_...` | NSA (Academy) | Replit Secret / AWS `.env.production` |
| `NYV_SDK_KEY_NSM` | `nyv_live_sk_nsm_...` | NSM (Ministry) | Replit Secret / AWS `.env.production` |
| `NYV_SDK_KEY_JRX` | `nyv_live_sk_jrx_...` | JRX (Institutional — US) | Replit Secret / AWS `.env.production` |
| `NYV_GATEWAY_URL` | `https://api.nyayasiddhi.online` | All | AWS nysdev gateway domain |
| `NYV_BASE_URL` | `https://api.nyayasiddhi.online` | All | Alias for `NYV_GATEWAY_URL` |
| `REPLIT_DEV_DOMAIN` | `<slug>.replit.dev` | All (Replit) | Auto-set by Replit — use for dev |
| `NYV_WEBHOOK_SECRET` | `nyv_wh_<code>_...` | All (webhook receiver) | Platform-specific webhook secret |
| `NEXT_PUBLIC_NYV_API_KEY` | `nyv_test_pk_nsp_...` | NSP-WEB only | Publishable key (safe for browser) |
| `NEXT_PUBLIC_NYV_BASE_URL` | `https://api.nyayasiddhi.online` | NSP-WEB only | Browser-safe base URL |
| `NYV_ENV` | `production` / `staging` / `development` | All | Switches domain logic (see §0.3) |

### C. SDK package → tarball mapping

| npm package | Tarball path | Who uses |
|---|---|---|
| `@nyayavigya/client-sdk` | `sdk/client-sdk/5.0.0.tgz` | NSP-WEB |
| `@nyayavigya/client-sdk-react-native` | `sdk/client-sdk-react-native/5.0.0.tgz` | NSP-MOBILE |
| `@nyayavigya/nyayamitra-sdk` | `sdk/nyayamitra-sdk/5.0.0.tgz` | Nyayamitra |
| `@nyayavigya/enterprise-sdk` | `sdk/enterprise-sdk/5.0.0.tgz` | NSI, JRX |
| `@nyayavigya/react-hooks` | `sdk/react-hooks/5.0.0.tgz` | NSP-WEB |
| `@nyayavigya/types` | `sdk/types/5.0.0.tgz` | All |
