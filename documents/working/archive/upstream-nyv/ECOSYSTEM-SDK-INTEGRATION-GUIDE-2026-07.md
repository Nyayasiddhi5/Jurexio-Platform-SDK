# Nyayasiddhi Ecosystem — SDK Integration Guide (v5.0.0)

> **Audience:** Engineering leads for all Nyayasiddhi ecosystem platforms.  
> **SDK line:** `@nyayavigya/*` **5.0.0** GA tarball · Client additive **`@nyayavigya/client-sdk@5.0.7+`** (Instant Search + Legal Feed)  
> **Live API:** `https://api.nyayasiddhi.online`  
> **Download:** `nyayavigya-platform-312/sdk-dist/v5.0.0/` or EC2 `/opt/Nyayavigya/sdk-dist/v5.0.0/`  
> **Companion:** `PARTNER-SDK-RELEASE-2026-05.md`, platform-specific guides below.  
> **Canonical entry (NSP/NYM):** [`Nyayavigya-platform-Integration-document-5.0.0.md`](./Nyayavigya-platform-Integration-document-5.0.0.md) — includes §2.1 best-outcome + Instant Search / Legal Feed.  
> **Legal intel surface:** [`NSP-LEGAL-INTELLIGENCE-SDK-SURFACE-2026-08.md`](./NSP-LEGAL-INTELLIGENCE-SDK-SURFACE-2026-08.md) · Instant Search: [`NSP-INSTANT-SEARCH-NYAYASEARCH-API-2026-07.md`](./NSP-INSTANT-SEARCH-NYAYASEARCH-API-2026-07.md)  
> **Multi-mode guide:** [`NYV-PLATFORM-INTEGRATION-GUIDE-NSP-NYM-JRX-2026-07.md`](./NYV-PLATFORM-INTEGRATION-GUIDE-NSP-NYM-JRX-2026-07.md)

---

## 1. Executive status (2026-07-05)

### 1.1 Nyayavigya SDK & API — **READY for partner integration (5.0.0 locked)**

| Item | Status | Evidence |
|---|---|---|
| 6 SDK packages @ **5.0.0** (incl. NYS `knowledge`/`legalWork`) | **DONE** | `npm run publish:sdk:dist` → 6 `.tgz` + `SHA256SUMS` |
| Local + EC2 tarball handoff | **DONE** | `sdk-dist/v5.0.0/` |
| Partner smoke (core + NYS plane/search/legal-work/orchestrate) × 7 SKUs | **READY** | `NYV_SDK_SHARED_KEYS=1 npm run partner:smoke:ec2` |
| Queen orchestrate + gateway quality | **DONE** | `nyv.orchestrate()`, `verifyCitations`, `checkHallucination` |
| NYS Knowledge Plane SDK | **DONE** | `nyv.knowledge.*` / `nyv.legalWork.*` |
| Shared integration keys (all platforms same key) | **ACTIVE** | until production rotation |
| npmjs.com public publish | **HOLD** | after G7 + partner smoke green |

### 1.2 Roadmap features — split by owner

| Track | Status | Notes |
|---|---|---|
| **Nyayavigya SDK/API** (this repo) | **GREEN** | P0/P1 dev complete per `PRODUCTION-READINESS-DEV-PENDING.md` |
| **NSP product UI** (Tier 1–3 in `NSP-ENHANCEMENT-ROADMAP-2026.md`) | **PENDING** | HITL console, citation badges, template gallery, etc. — NSP frontend work |
| **Per-platform app integration** | **IN FLIGHT** | Each platform wires SDK calls into their UI (this guide) |

> **Important:** Nyayavigya ships the **AI backbone**. Surfacing features in NSP/NSI/NYM UIs is each platform team's integration work using the SDK methods below.

---

## 2. Download & install (all platforms)

### 2.1 Tarballs (recommended — pinned 5.0.0)

```bash
# From repo clone or partner zip
cd nyayavigya-platform-312
shasum -a 256 -c sdk-dist/v5.0.0/SHA256SUMS

mkdir -p vendor
cp sdk-dist/v5.0.0/*.tgz vendor/
```

| Package | Tarball | Use |
|---|---|---|
| `@nyayavigya/types` | `nyayavigya-types-5.0.0.tgz` | Shared types (all platforms) |
| `@nyayavigya/client-sdk` | `nyayavigya-client-sdk-5.0.0.tgz` | Web + Node backends (NSP, NSI, NSA, NSM, JRX) |
| `@nyayavigya/react-hooks` | `nyayavigya-react-hooks-5.0.0.tgz` | React web apps |
| `@nyayavigya/client-sdk-react-native` | `nyayavigya-client-sdk-react-native-5.0.0.tgz` | NSPM mobile |
| `@nyayavigya/nyayamitra-sdk` | `nyayavigya-nyayamitra-sdk-5.0.0.tgz` | NYM citizen apps |
| `@nyayavigya/enterprise-sdk` | `nyayavigya-enterprise-sdk-5.0.0.tgz` | NSI, NSM, enterprise admin |

### 2.2 Install examples

```bash
# NSP / NSI / NSA / NSM / JRX (Node backend)
npm install ./vendor/nyayavigya-types-5.0.0.tgz \
            ./vendor/nyayavigya-client-sdk-5.0.0.tgz

# NSPM (React Native)
npm install ./vendor/nyayavigya-types-5.0.0.tgz \
            ./vendor/nyayavigya-client-sdk-5.0.0.tgz \
            ./vendor/nyayavigya-client-sdk-react-native-5.0.0.tgz

# NYM (citizen legal aid)
npm install ./vendor/nyayavigya-types-5.0.0.tgz \
            ./vendor/nyayavigya-client-sdk-5.0.0.tgz \
            ./vendor/nyayavigya-nyayamitra-sdk-5.0.0.tgz

# NSI / NSM (enterprise admin + compliance)
npm install ./vendor/nyayavigya-types-5.0.0.tgz \
            ./vendor/nyayavigya-client-sdk-5.0.0.tgz \
            ./vendor/nyayavigya-enterprise-sdk-5.0.0.tgz
```

### 2.3 Auth (mandatory — all platforms)

```http
X-API-Key: nyv_live_sk_<platform-key>
Content-Type: application/json
X-NYV-SDK-Version: 5.0.0
```

| Platform | Env var | Product hostname (dev-live) |
|---|---|---|
| **NSP** | `NYV_SDK_KEY_NSP` | `pro.nyayasiddhi.online` |
| **NSPM** | `NYV_SDK_KEY_NSPM` | NSP mobile app |
| **NSI** | `NYV_SDK_KEY_NSI` | `ins.nyayasiddhi.online` |
| **NSA** | `NYV_SDK_KEY_NSA` | Academy surface |
| **NSM** | `NYV_SDK_KEY_NSM` | Ministry surface |
| **NYM** | `NYV_SDK_KEY_NYM` | `nym.nyayasiddhi.online` |
| **JRX** | `NYV_SDK_KEY_JRX` | Integrator / white-label |

**Never** embed live keys in browser bundles — proxy via your backend (`examples/nsp-web-quickstart/`).

**Base URL:** `https://api.nyayasiddhi.online` (EC2) · `http://127.0.0.1:5000` (local)

---

## 3. Platform integration matrix

| Platform | SDK packages | Primary AI features | Key SDK entry points |
|---|---|---|---|
| **NSP** Professional | `client-sdk` + `types` | Orchestrate, research, drafting, shared-docs, EDJ, citations | `orchestrate()`, `legalResearch()`, `draftDocument()`, `processSharedDoc()`, `verifyCitations()` |
| **NSPM** Mobile | `client-sdk-react-native` + `client-sdk` | Same as NSP + voice, secure storage, push/HITL | `NyvClientRN.create()`, `nyv.voice.*`, `nyv.stream.*` |
| **NSI** Institutional | `client-sdk` + `enterprise-sdk` | Multi-org, compliance, bulk doc intelligence, enterprise RAG | `enterprise-sdk` org/compliance + `nyv.orchestrate()`, `nyv.docsPipeline.*` |
| **NSA** Academy | `client-sdk` | Mentor chat, legal education, read-heavy research | `mentorChat()`, `legalResearch()`, `nyv.patterns.*` |
| **NSM** Ministry | `client-sdk` + `enterprise-sdk` | Gov compliance, audit, policy analysis, DPDPA | `complianceCheck()`, `nyv.gov.*`, `enterprise-sdk` compliance |
| **NYM** Nyayamitra | `nyayamitra-sdk` + `client-sdk` | Citizen chat (9 languages), clause classify, case brief | `NyayamitraClient.chat()`, `classifyClauses()`, `generateCaseBrief()` |
| **JRX** Integrator | `client-sdk` or `enterprise-sdk` | White-label API access, custom workflows | Full `NyvClient` surface + `enterprise-sdk` org APIs |

---

## 4. Shared SDK surface (`NyvClient` 5.0.0)

All platforms except pure NYM flows start with:

```typescript
import { NyvClient } from '@nyayavigya/client-sdk';

const nyv = new NyvClient({
  apiKey: process.env.NYV_SDK_KEY_NSP!,  // use your platform key
  baseUrl: 'https://api.nyayasiddhi.online',
  defaultJurisdiction: 'IN',
  defaultPlatform: 'nys-professional',   // see per-platform table below
  timeout: 600_000,                      // orchestrate can run 5–10 min
});
```

### 4.1 Flat facade (recommended for platform backends)

| Method | Purpose |
|---|---|
| `nyv.orchestrate({ prompt, taskType, jurisdiction, … })` | Queen orchestration — primary AI path |
| `nyv.legalResearch(query, jurisdiction)` | Agentic legal research |
| `nyv.verifyCitations(text, jurisdiction)` | Standalone citation verification |
| `nyv.checkHallucination(text, opts)` | Grounding / hallucination check |
| `nyv.findPrecedents(caseDescription, jurisdiction)` | Precedent similarity search |
| `nyv.draftDocument(template, params, jurisdiction)` | Gateway document drafting |
| `nyv.draftDocumentFromTemplate(key, fields, jurisdiction)` | Template library generate |
| `nyv.assessRisk(caseDescription, jurisdiction)` | Matter risk scoring |
| `nyv.evaluateWithJudge(response, query, jurisdiction)` | LLM-as-judge quality gate |
| `nyv.complianceCheck(framework, content, jurisdiction)` | Compliance orchestration |
| `nyv.processSharedDoc(body)` | NSP shared-docs → RAG index |
| `nyv.ask(question, jurisdiction)` | Quick NyayaRAG (P11) |
| `nyv.analyzeDocument(buffer, fileName)` | Upload + extract + analyze |

### 4.2 Namespaced APIs (advanced)

| Namespace | Features |
|---|---|
| `nyv.orchestrateApi` / `nyv.queen` | Same as `orchestrate()` with full typed request |
| `nyv.gateway` | Research, draft, agents, usage, citations, hallucination |
| `nyv.knowledge` | **NYS Knowledge Plane** — `search`, `retrieve`, caselaw/statutes, archive, templates, `planeHealth` |
| `nyv.legalWork` | **NYS legal tasks/runs/chat** — `listTasks`, `createRun`, `evaluateRun`, … |
| `nyv.swarm` | 107 swarm topologies (list/get/stats) |
| `nyv.legalSdk` | Partner `caseAnalysis` |
| `nyv.partnerIntelligence` | Case risk, hearing prep, dashboard insights |
| `nyv.docsPipeline` | Parse, summarize, compliance-check, clause suggest |
| `nyv.ecosystemDocuments` | EDJ: createJob, waitForJob, getContent, getFields |
| `nyv.documents` | Upload, OCR, RAG search, redline |
| `nyv.patterns` | 22 agentic patterns (CoT, ReAct, GraphRAG, …) |
| `nyv.stream` | SSE streaming (AG-UI lifecycle) |
| `nyv.intelligence` | Precedents, contract analysis, NER |
| `nyv.nyayaTools` | Template library, statute diff (IPC→BNS) |
| `nyv.voice` | STT/TTS (Sarvam 22-Indic) |
| `nyv.llmRouter` | Model catalog, router explain |
| `nyv.cam` | Continuous Agent Monitoring dashboard |
| `nyv.rag` | Unified Auto-RAG retrieval |
| `nyv.memory` | Matter memory L1–L5 |
| `nyv.mcp` | MCP tool list + invoke (includes `nys_*` when allowed) |

**Auth during integration:** set `NYV_SDK_SHARED_KEYS=1` (or `NYV_SDK_KEY_SHARED`) so NSP/NYM/JRX use the **same** key until production rotation — see `NSP-API-KEYS-HANDOVER.md`.

OpenAPI (live): `GET https://api.nyayasiddhi.online/api/nv/docs`

---

## 5. Per-platform integration playbooks

### 5.1 NSP — Nyayasiddhi Professional

| Field | Value |
|---|---|
| SDK | `@nyayavigya/client-sdk@5.0.0` |
| Key | `NYV_SDK_KEY_NSP` |
| `defaultPlatform` | `nys-professional` |
| Optional header | `X-NSP-Client: nyayasiddhi-professional/1.0.0` (shared-docs) |
| Full guide | `NSP-PARTNER-SDK-INTEGRATION-GUIDE-2026-06.md` |
| Cheat sheet | `NSP-INTEGRATION-CHEATSHEET-2026-06.md` |

```typescript
// Typical NSP matter AI flow
const answer = await nyv.orchestrate({
  prompt: userPrompt,
  jurisdiction: 'IN',
  taskType: 'draft',
  ragDocumentIds: ['doc_abc'],  // from shared-docs pipeline
});

const citations = await nyv.verifyCitations(answer.content ?? '', 'IN');
const grounded = await nyv.checkHallucination(answer.content ?? '', {
  inputText: userPrompt,
});
```

**Shared documents:** NSP uploads to object storage → `nyv.processSharedDoc({ storageKey, … })` → poll → use `ragDocumentIds` in orchestrate.

**Long prompts:** Set client timeout ≥ **600 s** (ALB/nginx already 600 s on dev-edge).

---

### 5.2 NSPM — NSP Mobile (React Native)

| Field | Value |
|---|---|
| SDK | `@nyayavigya/client-sdk-react-native@5.0.0` + `client-sdk` |
| Key | `NYV_SDK_KEY_NSPM` |
| `defaultPlatform` | `nys-professional-mobile` |

```typescript
import { NyvClientRN } from '@nyayavigya/client-sdk-react-native';

const nyv = await NyvClientRN.create({
  baseUrl: 'https://api.nyayasiddhi.online',
  defaultJurisdiction: 'IN',
});
await nyv.setApiKey(process.env.NYV_SDK_KEY_NSPM!);

// Delegate to inner NyvClient
const result = await nyv.client.orchestrate({
  prompt: 'Summarize this hearing order',
  taskType: 'summarize',
});

// Voice (offline-tolerant with secure key storage)
await nyv.client.voice.transcribe(audioBuffer, { language: 'hi' });

// HITL push when high-risk output needs review
await nyv.registerForHITLPush({ /* expo push token */ });
```

---

### 5.3 NSI — Nyayasiddhi Institutional

| Field | Value |
|---|---|
| SDK | `@nyayavigya/client-sdk` + `@nyayavigya/enterprise-sdk` |
| Key | `NYV_SDK_KEY_NSI` |
| `defaultPlatform` | `nys-institutional` |

```typescript
import { NyvClient } from '@nyayavigya/client-sdk';
import { NyayavignyaEnterpriseClient } from '@nyayavigya/enterprise-sdk';

const nyv = new NyvClient({
  apiKey: process.env.NYV_SDK_KEY_NSI!,
  defaultPlatform: 'nys-institutional',
  timeout: 600_000,
});

const enterprise = new NyayavignyaEnterpriseClient({
  apiKey: process.env.NYV_SDK_KEY_NSI!,
  baseUrl: 'https://api.nyayasiddhi.online',
});

// Bulk document intelligence (EDJ)
const job = await nyv.ecosystemDocuments.createJob({
  storageKey: 's3://bucket/firm-docs/contract.pdf',
  tenantId: orgId,
  operations: ['parse', 'extract-fields', 'index'],
});
const content = await nyv.ecosystemDocuments.waitForJob(job.jobId);

// Enterprise compliance
const consent = await enterprise.compliance.getDpdpaConsentStatus(userId);
```

**Primary features:** multi-tenant RAG, EDJ at scale, org RBAC, DPDPA consent, ISO 42001 reporting.

---

### 5.4 NSA — Nyayasiddhi Academy

| Field | Value |
|---|---|
| SDK | `@nyayavigya/client-sdk@5.0.0` |
| Key | `NYV_SDK_KEY_NSA` |
| `defaultPlatform` | `nys-academy` |

```typescript
const nyv = new NyvClient({
  apiKey: process.env.NYV_SDK_KEY_NSA!,
  defaultPlatform: 'nys-academy',
});

// Legal mentor for students
const lesson = await nyv.mentorChat(
  'Explain the doctrine of precedent with an Indian example',
  { taskType: 'mentor', jurisdiction: 'IN' },
);

// Research for coursework (read-heavy — avoid documents:write in prod scopes)
const research = await nyv.legalResearch('Article 21 and privacy after Puttaswamy', 'IN');

// Pattern-based reasoning demo
await nyv.stream.streamPattern('cot', {
  task: 'Compare strict liability vs negligence in tort',
  jurisdiction: 'IN',
}, { onTextDelta: (d) => process.stdout.write(d) });
```

---

### 5.5 NSM — Nyayasiddhi Ministry

| Field | Value |
|---|---|
| SDK | `@nyayavigya/client-sdk` + `@nyayavigya/enterprise-sdk` |
| Key | `NYV_SDK_KEY_NSM` |
| `defaultPlatform` | `nys-ministry` |

```typescript
const nyv = new NyvClient({
  apiKey: process.env.NYV_SDK_KEY_NSM!,
  defaultPlatform: 'nys-ministry',
  timeout: 600_000,
});

// Policy / statute analysis
const analysis = await nyv.orchestrate({
  prompt: 'Analyze DPDPA 2023 impact on government data sharing',
  taskType: 'compliance-check',
  jurisdiction: 'IN',
});

// Bias / governance check
const bias = await nyv.complianceCheck('bias', draftPolicyText, 'IN');

// Gov-specific routes
const govReport = await nyv.gov.generateComplianceReport({ framework: 'dpdpa' });
```

---

### 5.6 NYM — Nyayamitra (citizen legal aid)

| Field | Value |
|---|---|
| SDK | `@nyayavigya/nyayamitra-sdk@5.0.0` |
| Key | `NYV_SDK_KEY_NYM` |
| Languages | 9 Indic + English (`NYAYAMITRA_LANGUAGES`) |

```typescript
import { NyayamitraClient } from '@nyayavigya/nyayamitra-sdk';

const nym = new NyayamitraClient({
  apiKey: process.env.NYV_SDK_KEY_NYM!,
  defaultLanguage: 'hi',
});

const reply = await nym.chat({
  sessionId: 'sess_42',
  language: 'hi',
  message: 'किरायेदारी कानून में 30 दिन का नोटिस कब जरूरी है?',
});

const clauses = await nym.classifyClauses({
  documentText: agreementText,
  documentType: 'rent-agreement',
  language: 'hi',
});

const brief = await nym.generateCaseBrief({
  narrative: '…',
  language: 'hi',
});

// Advanced: access full NyvClient via nym.inner
await nym.inner.verifyCitations(reply.content, 'IN');
```

**Offline:** use `OfflineDraftQueue` from `@nyayavigya/nyayamitra-sdk` for draft sync when connectivity returns.

---

### 5.7 JRX — Integrator / white-label

| Field | Value |
|---|---|
| SDK | `client-sdk` ± `enterprise-sdk` |
| Key | `NYV_SDK_KEY_JRX` |

JRX teams receive the **full SDK surface** with integrator scopes. Use `enterprise-sdk` when managing sub-orgs, white-label config, or billing. Use `NyvClient` for all AI/document features.

```typescript
const nyv = new NyvClient({
  apiKey: process.env.NYV_SDK_KEY_JRX!,
  defaultPlatform: 'jrx-integrator',
  platformClient: 'partner-app/1.0.0',
});
```

Full E2E matrix: `node scripts/nv-sdk-platform-e2e.mjs` with `NV_BASE_URL` set.

---

## 6. Document & intelligence features (all platforms)

### 6.0 Patra Mitra — interactive parse + ask (NSP / NYM / NYS)

**Live:** `POST /api/nv/v1/sdk/patra-mitra/sessions` → fields + summary;  
`POST …/sessions/:id/chat` → grounded Q&A. OCR for images and scanned PDFs.

Full contract: [`PATRA-MITRA-API-NSP-NYM-NYS-2026-08.md`](./PATRA-MITRA-API-NSP-NYM-NYS-2026-08.md).

```ts
// NYM SDK
const session = await nym.openPatraMitra({ base64, fileName, mimeType: 'application/pdf' });
const { answer } = await nym.askPatraMitra(session.sessionId, 'List the parties');
```

```http
POST /api/nv/v1/sdk/patra-mitra/sessions
X-API-Key: <NYV_SDK_KEY_NSP>
X-NYV-Platform: nsp
{ "base64": "…", "fileName": "nda.pdf", "mimeType": "application/pdf", "jurisdiction": "IN" }
```

Prefer Patra Mitra for interactive panes; prefer EDJ (§6.1) for large/async DMS ingest.

### 6.1 Ecosystem Document Jobs (EDJ) — large / async docs

```typescript
const { jobId } = await nyv.ecosystemDocuments.createJob({
  storageKey: 's3://…/matter/pleading.pdf',
  tenantId: 'org_123',
  sourcePlatform: 'NSP',
});
await nyv.ecosystemDocuments.waitForJob(jobId, { pollMs: 3000, timeoutMs: 600_000 });
const raw = await nyv.ecosystemDocuments.getContent(jobId);
const fields = await nyv.ecosystemDocuments.getFields(jobId);
```

### 6.2 Docs pipeline (deterministic + LLM)

```typescript
await nyv.docsPipeline.parseDocument({ contentBase64, fileName: 'contract.pdf' });
await nyv.docsPipeline.summarize({ documentId, jurisdiction: 'IN' });
await nyv.docsPipeline.complianceCheck({ documentId, framework: 'dpdpa' });
await nyv.docsPipeline.suggestClauses({ documentId, intent: 'limitation-of-liability' });
```

### 6.3 Statute diff & templates (India transition)

```typescript
await nyv.nyayaTools.compareDiff('IPC-302', 'BNS-103', 'IN');
await nyv.nyayaTools.templatesList('IN');
await nyv.draftDocumentFromTemplate('bail-application', { applicantName: '…' }, 'IN');
```

---

## 7. Testing & verification

### 7.1 Quick smoke (per platform)

```bash
cd nyayavigya-platform-312
source ../.local/secrets/runtime.env   # keys never committed

NYV_PLATFORM=NSP  npm run partner:smoke:ec2   # repeat for NSI, NYM, …
npm run partner:smoke:ec2                     # all 7 SKUs
```

### 7.2 Full platform E2E

```bash
NV_BASE_URL=https://api.nyayasiddhi.online node scripts/nv-sdk-platform-e2e.mjs
```

### 7.3 Local dev

```bash
npm run infra:local:up    # optional Postgres + Redis
npm run dev               # gateway :5000
bash scripts/nv-start-console.sh   # console :3004
npm run partner:smoke:local
```

---

## 8. Roadmap — what each team should build next

These are **platform product** items (not Nyayavigya SDK gaps). SDK methods already exist unless noted.

| Priority | Feature | SDK ready? | Platform owner |
|---|---|---|---|
| P1 | Citation-check badge on drafts | ✅ `verifyCitations` | NSP, NSI |
| P1 | Hallucination / grounded indicator | ✅ `checkHallucination` | All |
| P1 | Streaming research UI | ✅ `nyv.stream.*` | NSP, NSA |
| P1 | Shared-docs → RAG wiring | ✅ `processSharedDoc` | NSP |
| P2 | Precedent similarity panel | ✅ `findPrecedents` | NSP, NSI |
| P2 | Template gallery UI | ✅ `nyayaTools.templatesList` | NSP |
| P2 | IPC→BNS comparator UI | ✅ `nyayaTools.compareDiff` | NSP, NSM |
| P2 | LLM-judge "evaluate draft" | ✅ `evaluateWithJudge` | NSP |
| P2 | EDJ job status UI | ✅ `ecosystemDocuments.*` | NSI, NSP |
| P3 | HITL review console | Gateway wired; UI in NSP | NSP |
| P3 | Word/add-in | SDK HTTP; add-in TBD | NSP |
| P3 | e-Courts integration | External API | NSP |

Full NSP roadmap: `NSP-ENHANCEMENT-ROADMAP-2026.md` · Execution spec: `NSP-EXECUTION-PLAN-2026.md`

---

## 9. Error handling & support

- Every error includes `requestId` — include in support tickets.
- Retry: ≤3 attempts, exponential backoff; honour `Retry-After` on 429.
- 4xx = fix request/scopes; 5xx = retry with backoff.
- Guide: `docs/canonical/04c-sdk-troubleshooting-2026-05-11.md`

---

## 10. Document index (by platform)

| Platform | Start here |
|---|---|
| **All** | This guide + `PARTNER-SDK-RELEASE-2026-05.md` |
| **NSP** | `NSP-PARTNER-SDK-INTEGRATION-GUIDE-2026-06.md`, `NSP-INTEGRATION-CHEATSHEET-2026-06.md` |
| **NSP handoff index** | `NSP-TEAM-HANDOFF-PACKAGE-INDEX-2026-06.md` |
| **Keys (names only)** | `NSP-API-KEYS-HANDOVER.md` |
| **API canonical** | `docs/canonical/04-sdk-and-api-canonical-2026-05-07.md` |
| **Production status** | `PLATFORM-STATUS.md`, `Nyayavigya-Platform-5.0.0-PRODUCTION.md` |

---

*Tracker: 2026-07-05T11:30:00Z — Ecosystem SDK integration guide v5.0.0*
