---
status: completed
version: v5.0.0
canonical: true
locked: true
locked_reason: "Operator policy 2026-04-30T18:00Z — SDK is frozen at v5.0.0 stable until next major release. Do not bump version without explicit operator approval."
last_verified: 2026-04-30
---
# Nyayavigya SDK v5.0.0 — Master Integration Guide

**Audience:** Engineers integrating the Nyayasiddhi-ecosystem platforms (Nyayamitra, NYS Professional, Institutional, Academy, Ministry) **and** any third-party platform consuming Nyayavigya as the AI backbone.
**Production base URL:** `https://api.nyayavigya.in`
**SDK packages (npm):** `@nyayavigya/client-sdk@5.0.0`, `@nyayavigya/react-hooks@5.0.0`, `@nyayavigya/enterprise-sdk@5.0.0`, `@nyayavigya/types@5.0.0`
**Repo SDK (Nyayamitra contract):** `sdk/nyayamitra-sdk/`

---

## 1. Quick start (5 minutes)

```bash
npm i @nyayavigya/client-sdk@5.0.0
```

```ts
import { NyvClient } from '@nyayavigya/client-sdk';

const nyv = new NyvClient({
  apiKey: process.env.NYV_API_KEY!,            // nyv_live_sk_...
  baseUrl: 'https://api.nyayavigya.in',
  defaultPlatform: 'nys-professional',          // see §3
  jurisdiction: 'IN',
  tier: 'pro',
});

const reply = await nyv.ask('Explain BNS 2023 Section 103 with case law.');
console.log(reply.text, reply.citations, reply.governance);
```

---

## 2. Authentication

### 2.1 Headers (every request)

```
Authorization: Bearer nyv_live_sk_<40-char>      # SDK / inter-service key
X-Client-ID:    nyayamitra | nys-professional | nys-institutional | nys-academy | nys-ministry
X-Correlation-ID: <uuid v4>
X-NSP-Tier:    citizen | solo | plus | pro | enterprise | government | internal
X-NSP-Jurisdiction: IN | UK | US | EU | GC | SG
Content-Type:  application/json
```

### 2.2 Key types

| Key prefix | Use | Where to get |
|---|---|---|
| `nyv_live_sk_` | Production inter-service / SDK | `POST /api/nv/sdk/create-app` |
| `nyv_test_sk_` | Staging | same endpoint, env=test |
| `nyv_sandbox_sk_` | Local | same endpoint, env=sandbox |
| `nyv_internal_sk_` | NYV-owned services only | seeded by `nv-seed-sdk-keys.ts` |

### 2.3 Single-click app creation

```http
POST /api/nv/sdk/create-app
Authorization: Bearer <admin-jwt>
Content-Type: application/json

{
  "name": "my-platform",
  "platform_type": "professional",
  "tier": "pro",
  "jurisdiction": "IN",
  "contact_email": "you@example.com",
  "modules": { "nyayarag": true, "doc_intelligence": true, "automateai": true, "hitl": true }
}
```

Response (201):

```json
{
  "success": true,
  "app_id": "uuid",
  "api_key": "nyv_live_sk_...",
  "platform": { "name":"my-platform","tier":"pro","jurisdiction":"IN","total_agents":1043 },
  "rate_limits": { "rpm":60,"rpd":20000 },
  "quickstart": { "base_url":"https://api.nyayavigya.in","npm":"@nyayavigya/client-sdk" }
}
```

> The raw `api_key` is shown **once**. Store it in your secrets manager immediately.

---

## 3. Platform integration cheat-sheet

| Platform | Code | SDK init `defaultPlatform` | Key env var | Channels | Memory tiers |
|---|---|---|---|---|---|
| Nyayamitra | NYM | `nyayamitra` | `NYV_KEY_NYAYAMITRA` | WhatsApp, Web, Voice, Telegram | L1–L3 |
| NYS Professional | NYS-PRO | `nys-professional` | `NYV_KEY_NYS_PRO` | Web, API | L1–L5 |
| NYS Institutional | NYS-INS | `nys-institutional` | `NYV_KEY_NYS_INS` | Web, API, Slack, Teams, Webhook | L1–L5 |
| NYS Academy | NYS-ACE | `nys-academy` | `NYV_KEY_NYS_ACE` | Web, API | L1–L3 |
| NYS Ministry | NYS-MIN | `nys-ministry` | `NYV_KEY_NYS_MIN` | API, Webhook, Secure-portal | L1–L5 + PQC |

Full per-platform config in `config/platforms/platform-access-matrix.json`.

---

## 4. Microservice / API surface (REST)

> Full OpenAPI 3.0.3 spec: `GET /api/nv/docs/swagger.json` · UI: `GET /api/nv/docs`.

### 4.1 Health & meta

| Method | Path | Purpose | Auth |
|---|---|---|---|
| GET | `/health` | LB probe | none |
| GET | `/api/nv/health` | quick health | none |
| GET | `/api/nv/health/full` | per-subsystem | none |
| GET | `/api/nv/docs/swagger.json` | OpenAPI | none |
| GET | `/api/nv/jurisdictions` | list | bearer |
| GET | `/api/nv/models` | model catalog | bearer |
| GET | `/api/nv/flags` | feature flags | bearer |
| GET | `/api/nv/versions` | versions | bearer |

### 4.2 Auth

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/api/nv/auth/login` | `{email,password}` | `{token,refreshToken,user}` |
| POST | `/api/nv/auth/refresh` | `{refreshToken}` | `{token}` |
| POST | `/api/nv/auth/logout` | — | 204 |

### 4.3 Orchestration (the central entrypoint)

```http
POST /api/nv/orchestrate
Authorization: Bearer nyv_live_sk_...
X-Client-ID: nys-professional
X-Correlation-ID: 4ebd...
Content-Type: application/json

{
  "agentKey": "in-civil-001",
  "prompt": "Draft a written statement for a partition suit",
  "jurisdiction": "IN",
  "tier": "pro",
  "context": { "matterId":"M-1234", "clientId":"C-77" },
  "stream": false
}
```

Response (200):

```json
{
  "success": true,
  "data": {
    "answer": "...markdown...",
    "agentsInvoked": ["in-civil-001"],
    "citations": [{"statute":"CPC 1908","section":"Order VII","url":"..."}],
    "tokensUsed": 1842,
    "costUsd": 0.0046,
    "latencyMs": 2310,
    "governance": { "riskScore":0.12, "hallucination":false, "biasFlags":[] },
    "traceId": "9f1e..."
  }
}
```

### 4.4 Patterns (P01–P22)

`POST /api/nv/patterns/<slug>` for: `react, cot, tot, reflection, plan-execute, refine, maker-checker, tool-retry, function-router, mcp-chain, nyayarag, graphrag, mem0, semantic-cache, hta, swarm, aconic, moat, adapt, computer-use, grpo, digital-twin`.

Body shape (universal):

```json
{ "task":"...", "jurisdiction":"IN", "tier":"pro", "options":{} }
```

### 4.5 Agents

| Method | Path | Returns |
|---|---|---|
| GET | `/api/nv/agents` | paginated list of 1043 agents |
| GET | `/api/nv/agents/:id` | full persona (22-section) + system prompt |
| POST | `/api/nv/agents/:id/execute` | one-shot execution |
| GET | `/api/nv/agents/:id/stream` | SSE streaming execution |

### 4.6 Documents (async)

```http
POST /api/nv/documents/upload    multipart/form-data: file, fileName
GET  /api/nv/documents/:id       -> {status, extractedText?, chunks?, summary?}
POST /api/nv/documents/:id/qa    {question} -> {answer, citations}
POST /api/nv/documents/compare   {sourceId,targetId} -> {redline, clauseDiff}
```

### 4.7 RAG family

```http
POST /api/nv/rag/query            (NyayaRAG)
POST /api/nv/rag/light            (LightRAG)
POST /api/nv/rag/adaptive         (Adaptive)
POST /api/nv/rag/corrective       (Corrective)
POST /api/nv/rag/self             (Self-RAG)
POST /api/nv/rag/entities/merge   (entity merger)
```

### 4.8 8 Nyaya Tools

`POST /api/nv/nyaya-tools/{graph|watch|compare|template|timeline|forensic|trail|amend}`

### 4.9 6 Intelligence features

```http
POST /api/nv/intelligence/conflict-detect        {parties, matter}
POST /api/nv/intelligence/amendment-impact       {statute, section}
POST /api/nv/intelligence/precedent-similarity   {caseFacts, jurisdiction}
GET  /api/nv/intelligence/regulatory-feed        ?since=...
POST /api/nv/intelligence/secure-session/create  {participants}
POST /api/nv/intelligence/litigation-risk-v2     {caseDescription, jurisdiction}
```

### 4.10 Voice

```http
POST /api/nv/voice/tts            {text, language, voice?} -> audio/mpeg
POST /api/nv/voice/stt            multipart audio -> {transcript, language, segments}
WS   /ws/voice                    real-time duplex
POST /api/nv/translate            {text, src, tgt}
```

### 4.11 Memory (5-tier)

```http
POST /api/nv/memory/store         {tier:'L1|L2|L3|L4|L5', key, content, agentId, scope}
POST /api/nv/memory/recall        {tier?, query, limit?}
POST /api/nv/memory/erase         {userId}            (DPDPA right-to-erasure)
GET  /api/nv/memory/stats         per-tier counts
```

### 4.12 Billing

```http
GET  /api/nv/credits/wallet
POST /api/nv/credits/charge       {amountInr, plan}
GET  /api/nv/billing/invoices
POST /api/nv/payments/razorpay/create-order
POST /api/nv/payments/razorpay/webhook        (signed)
```

### 4.13 SDK Console (operator-only, JWT super-admin)

`/api/nv/sdk/console/{info,overview,apps[,/:id[,/{suspend,activate,revoke,rotate-secret,keys[,/:id/{revoke,activate}],usage}]]}` — 18 endpoints. Full list in `NYV-SDK-RELEASE-PLAN.md §6.4`.

---

## 5. Client SDK methods (12 API classes)

```ts
const nyv = new NyvClient({ apiKey, baseUrl });

// Conversation
await nyv.ask(prompt: string, opts?): Promise<NyvAnswer>;

// Patterns (22)
await nyv.patterns.cot({ task, jurisdiction, tier });
await nyv.patterns.react(...);  await nyv.patterns.tot(...);  // ...all 22

// Streaming (AG-UI SSE)
await nyv.stream.streamPattern('cot', { task }, {
  onThinking: (step, i, total) => {},
  onTextDelta: (delta) => {},
  onComplete: (result) => {},
  onError:    (err) => {},
});

// Agents
await nyv.agents.list({ jurisdiction, tier });
await nyv.agents.execute({ agentId, task, jurisdiction });
await nyv.agents.stream({ agentId, task });

// Documents
const { docId } = await nyv.documents.uploadFormData(file, { fileName });
const status     = await nyv.documents.waitForCompletion(docId);
await nyv.documents.qa(docId, 'Find the indemnity clause');
await nyv.documents.compare(srcId, tgtId);

// Knowledge / RAG
await nyv.knowledge.search({ query, jurisdiction, top: 10 });
await nyv.knowledge.embed({ text });
await nyv.knowledge.indexDocument(docId);

// Intelligence (6)
await nyv.intelligence.conflictDetect({ parties, matter });
await nyv.intelligence.litigationRisk({ caseDescription, jurisdiction });
await nyv.intelligence.regulatoryFeed({ since });

// Nyaya Tools (8)
await nyv.nyayaTools.graph({ query, depth });
await nyv.nyayaTools.compare({ source, target });
await nyv.nyayaTools.timeline({ caseId });

// Voice
await nyv.voice.textToSpeech({ text, language: 'hi-IN' });
await nyv.voice.speechToText({ audio, language });
await nyv.voice.voiceChat({ stream: true });

// Memory
await nyv.memory.store({ tier:'matter', key, content, agentId });
await nyv.memory.recall({ tier:'matter', query });
await nyv.memory.erase({ userId });

// Twins
const twin = await nyv.twins.create({ name, persona, jurisdiction, expertise });
await nyv.twins.simulate({ twinId, scenario, task });

// Testing (6-layer)
await nyv.testing.runOracle({ agentId, fixtures });
await nyv.testing.runAdversarial({ agentId });
await nyv.testing.llmJudge({ output, rubric });

// Compliance
await nyv.compliance.euAiAct({ output });
await nyv.compliance.biasAudit({ output });
await nyv.compliance.watermark({ pdfId });
await nyv.compliance.digitalSign({ docId });

// Skills (marketplace)
await nyv.skills.list();
await nyv.skills.execute({ skillId, input });
```

---

## 6. React hooks (16)

```ts
import {
  useNyvClient, usePatternStream, useCredits, useGovernanceBadge,
  useJurisdiction, useAuditLog, useIntelligence, useAgentTesting,
  useCompliance, useConflictDetector, useAmendmentImpact,
  useTemplateAssistant, useTimeline, useForensicVerifier,
  useRegulatoryFeed, usePrecedentSimilarity,
} from '@nyayavigya/react-hooks';
```

Example:

```tsx
function Research() {
  const { streamPattern, content, thinking, isStreaming, governance } = usePatternStream();
  return (
    <>
      <button onClick={() => streamPattern('nyayarag', { task: 'DPDP Act consent', jurisdiction: 'IN' })} disabled={isStreaming}>
        Research
      </button>
      <GovernanceBadge {...governance} />
      <ThinkingTrace steps={thinking} />
      <Markdown>{content}</Markdown>
    </>
  );
}
```

---

## 7. Per-platform integration recipes

### 7.1 Nyayamitra (citizen, WhatsApp + Voice)

```ts
import { NyayamitraClient } from 'sdk/nyayamitra-sdk';
const sdk = new NyayamitraClient(); // env: NYV_KEY_NYAYAMITRA, NV_BASE_URL

// 1. WhatsApp inbound
await sdk.sendChatMessage({ text, sessionId, userId, language: 'hi-IN' });

// 2. doc analysis (rental agreement photo OCR'd in app)
await sdk.analyzeDocument({ documentText, documentType: 'rental_agreement', userId });

// 3. case brief
await sdk.generateCaseBrief({ intakeTranscript, jurisdiction: 'IN', userId });
```

### 7.2 NYS Professional (lawyer)

```ts
const nyv = new NyvClient({ apiKey: process.env.NYV_KEY_NYS_PRO!, defaultPlatform: 'nys-professional' });

// Daily research with citations
const r = await nyv.patterns.nyayarag({ task: 'Latest SC ruling on Section 138 NI Act', jurisdiction: 'IN' });

// Drafting with maker-checker
const d = await nyv.patterns.makerChecker({ task: 'Draft NDA for IT services', jurisdiction: 'IN' });

// Precedent search + similarity
const sims = await nyv.intelligence.precedentSimilarity({ caseFacts, jurisdiction: 'IN' });
```

### 7.3 NYS Institutional (in-house GC)

```ts
import { Org, Billing, Compliance } from '@nyayavigya/enterprise-sdk';

const org = new Org({ apiKey: process.env.NYV_KEY_NYS_INS! });
await org.tenants.create({ name: 'Acme Corp', tier: 'enterprise' });
await org.rbac.assign({ userId, role: 'compliance-officer', tenantId });

const bill = new Billing({ apiKey });
const wallet = await bill.getWallet(); // INR + GST aware

const cmp = new Compliance({ apiKey });
await cmp.euAiAct.report({ since: '2026-01-01' });
```

### 7.4 NYS Academy (law school)

```ts
const nyv = new NyvClient({ apiKey: process.env.NYV_KEY_NYS_ACE!, defaultPlatform: 'nys-academy' });

// Socratic tutoring
const lesson = await nyv.agents.execute({ agentId: 'academy-tutor', task: 'Explain res judicata in Indian law' });

// Moot-court grading
const grade = await nyv.agents.execute({ agentId: 'moot-court-judge', task: studentArgument });

// 6-layer testing of an agent the student tuned
const test = await nyv.testing.runOracle({ agentId: 'student-12-agent', fixtures: ['oracle-1', 'oracle-2'] });
```

### 7.5 NYS Ministry (sovereign)

```ts
const nyv = new NyvClient({ apiKey: process.env.NYV_KEY_NYS_MIN!, defaultPlatform: 'nys-ministry' });

// Regulatory feed
const updates = await nyv.intelligence.regulatoryFeed({ since: lastRunIso });

// Policy drafting under PQC-signed audit
const draft = await nyv.agents.execute({
  agentId: 'compliance-min-001',
  task: 'Draft an amendment to DPDPA Section 6 covering minor consent',
  options: { pqcSign: true },
});
```

---

## 8. Webhook integration

Register a webhook (per-app):

```http
POST /api/nv/sdk/console/apps/:appId/webhooks
{ "url":"https://my-platform.com/nyv/hook", "events":["doc.processed","hitl.decided","agent.completed","compliance.alert"], "secret":"<32-byte hex>" }
```

Payload (signed `X-NYV-Signature: sha256=...`):

```json
{ "event":"doc.processed", "appId":"...", "data":{"docId":"...","status":"complete"}, "ts":"2026-05-15T07:00:00Z" }
```

Verify HMAC-SHA256 over the raw body using the per-webhook secret.

---

## 9. Rate limits

Effective per-platform limits live in `config/rate-limits/rate-limits.json` and are exposed on every response:

```
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 41
X-RateLimit-Reset: 1747299600
```

429 response:

```json
{ "success":false, "error":{ "code":"RATE_LIMITED", "retryAfterSec":12 } }
```

Defaults per platform:

| Platform | RPM | RPD | Concurrent streams |
|---|---|---|---|
| nyayamitra | 200 | 50,000 | 8 |
| nys-professional | 120 | 30,000 | 6 |
| nys-institutional | 600 | 200,000 | 16 |
| nys-academy | 40 | 5,000 | 3 |
| nys-ministry | 600 | 200,000 | 16 |

---

## 10. Errors

```json
{ "success":false, "error":{ "code":"AUTH_TOKEN_MISSING|INVALID_API_KEY|TOKEN_EXPIRED|TIER_INSUFFICIENT|JURISDICTION_DENIED|CONSENT_REQUIRED|RATE_LIMITED|VALIDATION|HALLUCINATION_BLOCKED|PII_LEAK|PROMPT_INJECTION|UPSTREAM_LLM|INTERNAL", "message":"...", "requestId":"...", "retryAfterSec":null } }
```

Retry policy: exponential back-off on `RATE_LIMITED`, `UPSTREAM_LLM`. Do **not** retry on `AUTH_*`, `JURISDICTION_DENIED`, `TIER_INSUFFICIENT`, `CONSENT_REQUIRED`.

---

## 11. Streaming (AG-UI / SSE)

```http
GET /api/nv/stream?pattern=cot&task=...
Accept: text/event-stream
```

Events: `event: thinking | text_delta | citation | governance | complete | error`. Frame:

```
event: text_delta
data: {"delta":"...","i":12}
```

The `@nyayavigya/client-sdk` exposes `nyv.stream.streamPattern()` to abstract this.

---

## 12. WebSocket voice

```ts
const ws = new WebSocket('wss://api.nyayavigya.in/ws/voice', { headers: { Authorization: `Bearer ${KEY}` } });
ws.onopen = () => ws.send(JSON.stringify({ type:'config', language:'hi-IN', agentId:'mitra-conversational' }));
ws.onmessage = (m) => { const f = JSON.parse(m.data); /* {type:'transcript'|'reply'|'tts_chunk'|'end',...} */ };
mediaStream.on('chunk', c => ws.send(c));
```

---

## 13. Security best practices

* Keep API keys in your secrets manager. Never ship raw keys to a browser.
* Use **per-environment** keys (live / test / sandbox).
* Rotate every 90 days via `POST /api/nv/sdk/console/apps/:id/rotate-secret`.
* Send `X-Correlation-ID` (uuid v4) so support can trace across our hash-chained audit.
* Always pass `X-NSP-Jurisdiction` to enforce data residency.
* For PII, prefer the dedicated PII vault endpoints over passing PII in prompts.

---

## 14. Versioning & deprecation

* Wire-format breaking changes are gated behind `/api/nv/v<major>/`.
* Today's surface is implicitly v1; `/api/nv/v311/...` reserved for 3.1.x.
* Deprecated endpoints emit `Sunset` header per RFC 8594.
* SDK versions follow semver; `5.0.0` is the GA cut for **May 15, 2026**.

---

## 15. Where to look in this repo

| Need | File |
|---|---|
| OpenAPI source | served at `/api/nv/docs/swagger.json`; generated from route decorators |
| Master config | `config/nyv-master-config.json` |
| Per-platform access | `config/platforms/platform-access-matrix.json` |
| Rate limits | `config/rate-limits/rate-limits.json` |
| LLM routing | `config/llm/llm-config.json` |
| Memory | `config/memory/memory-config.json` |
| Storage | `config/storage/storage-config.json` |
| Cache | `config/cache/cache-config.json` |
| Security | `config/security/security-config.json` |
| Integrations | `config/integrations/integrations.json` |
| Agents + system prompts | `config/agents/agents-master.json` |
| One-click deploy | `scripts/one-click-deploy.sh` |
| AWS plan | `docs/NYV-AWS-ONE-CLICK-DEPLOYMENT-v5.md` |
| Pending config checklist | `docs/NYV-PENDING-CONFIG-CHECKLIST.md` |
