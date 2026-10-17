---
status: completed
version: v6.0.0
superseded_by: null
last_verified: 2026-04-25
---
# Nyayavigya SDK v6 — API Reference (GA)

> Status: **General Availability** · Last updated: 2026-04-25
> Packages: `@nyayavigya/client-sdk@^6.0.0`, `@nyayavigya/types@^6.0.0`,
> `@nyayavigya/react-hooks@^6.0.0`, `@nyayavigya/client-sdk-react-native@^1.0.0`,
> `@nyayavigya/nyayamitra-sdk@^1.0.0`.

---

## 1. Package matrix

| Package | Runtime | Purpose |
|---|---|---|
| `@nyayavigya/client-sdk`             | Node ≥ 22, Browser, RN | The isomorphic core SDK. 14 typed API classes. |
| `@nyayavigya/types`                  | universal              | Pure types shared across SDK + back-end. |
| `@nyayavigya/react-hooks`            | React ≥ 18             | React hook bindings (`useNyv`, `useStreamPattern`, …). |
| `@nyayavigya/client-sdk-react-native`| React Native ≥ 0.74    | RN wrapper: secure storage, native SSE, permissions, push. |
| `@nyayavigya/nyayamitra-sdk`         | Node, RN, Browser      | Citizen-facing 3-agent surface + Indic helpers. |

---

## 2. `NyvClient`

```ts
import { NyvClient } from '@nyayavigya/client-sdk';

const nyv = new NyvClient({
  apiKey: 'nyv_live_sk_...',
  baseUrl: 'https://api.nyayavigya.com',  // optional; default https://app.nyayavigya.in
  timeout: 30_000,                         // optional
  defaultJurisdiction: 'IN',               // optional; one of IN | UK | US | GC | EU | SG
  defaultPlatform: 'web',                  // optional; one of web | mobile | api | console
  debug: false,
});
```

The single root client exposes 14 typed API classes:

| Property | Class | What it covers |
|---|---|---|
| `nyv.patterns`     | `PatternsApi`       | All 22 reasoning patterns (CoT, ReAct, GRPO, MCTS, ToT, …) |
| `nyv.documents`    | `DocumentsApi`      | Upload, status-poll, search, OCR, analyze (clauses / risks). |
| `nyv.agents`       | `AgentsApi`         | List / install / `run({ agentId, task, context })` agents. |
| `nyv.skills`       | `SkillsApi`         | Skill marketplace: search, install, publish. |
| `nyv.twins`        | `TwinApi`           | Digital-twin create / simulate / chat. |
| `nyv.knowledge`    | `KnowledgeApi`      | Knowledge graph search + traversal. |
| `nyv.voice`        | `VoiceApi`          | Sarvam TTS / STT / voice command. |
| `nyv.intelligence` | `IntelligenceApi`   | Precedent search, secure session, NER, contract analysis. |
| `nyv.testing`      | `TestingApi`        | Oracle / adversarial testing, LLM-as-judge. |
| `nyv.compliance`   | `ComplianceApi`     | EU / India / UK compliance reports, bias audit. |
| `nyv.nyayaTools`   | `NyayaToolsApi`     | Citation-check, legal-diff, watermark, signing. |
| `nyv.memory`       | `MemoryApi`         | Matter memory + client memory. |
| `nyv.cache`        | `CacheApi`          | SLM availability, cache stats. |
| `nyv.credits`      | `CreditsApi`        | Wallet balance + credit ledger. |
| `nyv.stream`       | `NyvStreamReader`   | AG-UI streaming for any pattern. |

### 2.1 `nyv.ask(question)` — convenience NyayaRAG

```ts
const r = await nyv.ask('Explain BNS Section 103 (murder) with case law.');
// → { answer: string, citations: NyvCitation[], traceId: string, ... }
```

### 2.2 `nyv.agents.run(req)`

```ts
interface AgentRunRequest {
  agentId: string;
  task: string;
  jurisdiction?: NyvJurisdiction;
  context?: Record<string, unknown>;
  pattern?: NyvAgentPattern;
  maxIterations?: number;
}

const exec = await nyv.agents.run({
  agentId: 'mitra-conversational',
  task: 'मेरे मकान मालिक ने…',
  jurisdiction: 'IN',
  context: { sessionId, language: 'hi', history: [...] },
});
```

### 2.3 `nyv.documents.uploadFormData(file, opts)`

```ts
const { docId } = await nyv.documents.uploadFormData(file, { fileName: 'contract.pdf' });
const status = await nyv.documents.waitForCompletion(docId);
const analysis = await nyv.documents.analyze(docId, { mode: 'clauses' });
```

### 2.4 Streaming — `nyv.stream.streamPattern`

```ts
await nyv.stream.streamPattern(
  'cot',
  { task: 'Compare BNS 103 vs IPC 302' },
  {
    onStart:        (ev)      => {},
    onAgentSelected:(agent)   => {},
    onThinking:     (s, i, n) => {},
    onToolCall:     (t, in_)  => {},
    onToolResult:   (t, out)  => {},
    onTextDelta:    (delta)   => {},
    onCitationBlock:(c)       => {},
    onMetadata:     (ev)      => {},
    onComplete:     (final)   => {},
    onError:        (err)     => {},
  },
  { signal: ac.signal },
);
```

Patterns the gateway accepts: `cot`, `react`, `tot`, `mcts`, `grpo`, `nyayarag`,
`tot-judge`, `pattern-router`, `panel-of-judges`, `digital-twin`, plus the 12
specialised patterns documented in `docs/NYV-22-PATTERNS-COMPLETE.md`.

### 2.5 Errors — `NyvError`

```ts
import { NyvError } from '@nyayavigya/client-sdk';

try { await nyv.documents.uploadFormData(file); }
catch (e) {
  if (e instanceof NyvError) {
    console.log(e.code, e.statusCode, e.requestId, e.message);
  }
}
```

---

## 3. `@nyayavigya/client-sdk-react-native`

```ts
import { NyvClientRN, requestStandardSdkPermissions } from '@nyayavigya/client-sdk-react-native';

const nyv = await NyvClientRN.create({ baseUrl: 'https://api.nyayavigya.com' });
await nyv.setApiKey('nyv_live_sk_...');           // persists to Keychain/Keystore
await requestStandardSdkPermissions();            // camera + mic + photos + push

// Same surface as NyvClient — exposed via nyv.client
const r = await nyv.client.ask('What is BNS 103?');

// Native streaming (uses react-native-sse if installed; long-poll otherwise)
await nyv.stream.streamPattern('cot', { task: '...' }, { onTextDelta: console.log });

// HITL push notifications
const hitl = await nyv.registerForHITL({ onHITL: payload => showToast(payload) });
```

See `packages/client-sdk-react-native/README.md` for the full surface.

---

## 4. `@nyayavigya/nyayamitra-sdk`

```ts
import { NyayamitraClient } from '@nyayavigya/nyayamitra-sdk';

const nym = new NyayamitraClient({ apiKey, defaultLanguage: 'hi' });

await nym.chat({ sessionId, language: 'hi', message: 'अपील कैसे करें?' });
await nym.classifyClauses({ documentText, language: 'hi', documentType: 'rent-agreement' });
await nym.generateCaseBrief({ narrative: '…', language: 'hi' });
```

Includes:

- `detectLanguage(text)` — heuristic Indic detector.
- `t(key, lang)` + `NYAYAMITRA_UI_STRINGS` — UI string table for 11 keys × 10 langs.
- `OfflineDraftQueue({ store })` — versioned envelope queue with `flush(dispatcher)`.

---

## 5. Webhooks — `orchestration.completed`

When an orchestration completes for an SDK app whose `webhookUrl` is set, the
gateway POSTs:

```http
POST {webhookUrl}
Content-Type: application/json
X-NYV-Event: orchestration.completed
X-NYV-Timestamp: 1745798400000
X-NYV-Signature: sha256=<hex>

{
  "event": "orchestration.completed",
  "appId": 42,
  "deliveryId": "wh_abc123",
  "data": {
    "orchestrationId": "orch_...",
    "status": "completed",
    "startedAt": "...",
    "completedAt": "...",
    "result": { ... }
  }
}
```

Verification recipe (Node):

```ts
import { createHmac, timingSafeEqual } from 'node:crypto';
function verify(sig: string, ts: string, body: string, secret: string) {
  const expected = 'sha256=' + createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error('bad sig');
  if (Math.abs(Date.now() - Number(ts)) > 5 * 60_000) throw new Error('stale');
}
```

The console exposes `POST /api/nv/sdk/console/apps/:appId/webhook/test` to send
a synthetic delivery so you can verify the receiver before going live.

---

## 6. Rate limits

| Plan      | Requests / minute |
|---|---|
| Free      | 10 |
| Pro       | 60 |
| Enterprise| 600 |

Counted per API key. `429` responses include `Retry-After` and the SDK retries
automatically with exponential back-off (3 attempts).

---

## 7. Versioning

Versioning policy lives in [`packages/client-sdk/SEMVER.md`](../../../packages/client-sdk/SEMVER.md).
v5 is in maintenance — see [`docs/v3.1.2/superseded/NYV-SDK-v5-DEPRECATION-POLICY.md`](../superseded/NYV-SDK-v5-DEPRECATION-POLICY.md).
