# `@jurexio/client-sdk`

> Official TypeScript SDK for the **Jurexio Legal AI Platform** — v5.0.0.

Powers all Jurexio platforms (NSP web/mobile, Nyayamitra, Institutional,
Academy, Ministry) and external developer integrations.

| | |
|---|---|
| Package | `@jurexio/client-sdk` |
| Version | **5.0.0** (2026-07-05) — production GA line |
| Min Node | 22.x |
| Modules | ESM + CJS, full `.d.ts`, tree-shakeable |
| Companion | `@jurexio/types`, `@jurexio/react-hooks`, `@jurexio/client-sdk-react-native`, `@jurexio/nyayamitra-sdk` |

---

## Install

```bash
npm install @jurexio/client-sdk @jurexio/types
```

## 60-second quickstart

```ts
import { NyvClient } from '@jurexio/client-sdk';

const nyv = new NyvClient({
  apiKey:  process.env.JRX_API_KEY!,        // nyv_live_sk_...
  baseUrl: 'https://app.nyayavigya.in',
});

// 1) Ask a legal question (P11 NyayaRAG)
const ans = await nyv.ask(
  'Explain BNS 2023 Section 103 (murder) with relevant case law',
);
console.log(ans.content);

// 2) Stream a Chain-of-Thought run with AG-UI events
await nyv.stream.streamPattern('cot', { task: ans.followUp ?? '' }, {
  onThinking:  (step, i, n) => console.log(`step ${i}/${n}: ${step}`),
  onTextDelta: (delta) => process.stdout.write(delta),
  onComplete:  (final)  => console.log('\n— done', final.traceId),
});

// 3) Upload a document for RAG indexing
const { docId } = await nyv.documents.uploadFormData(file, { fileName: 'contract.pdf' });
const doc = await nyv.documents.waitForCompletion(docId);

// 4) New in 5.2.0 — real multi-agent orchestration through the Queen
const run = await nyv.agents.orchestrate({ task: '...', strategy: 'parallel', jurisdiction: 'IN' });
console.log(run.synthesizedOutput, run.metrics.cost);

// 5) New in 5.2.0 — unified Auto-RAG, redline, provider readiness, usage ledger
const hits    = await nyv.rag.query('BNS 2023 Section 103', { jurisdiction: 'IN' });
const diff    = await nyv.documents.redline(versionA, versionB, { semantic: true });
const models  = await nyv.models.getProviders();   // env-key names only (no values)
const usage   = await nyv.usage.getTokens();        // daily tokens + cost + budget
```

## API surface

`NyvClient` exposes 25 API classes — 18 covering the `/api/jrx/*` gateway plus 7 wrapping the additive `/api/nv5/*` admin surface (Sessions 10–12):

| Property | Class | Purpose |
|---|---|---|
| `nyv.patterns` | `PatternsApi` | All 22 agentic patterns (P01–P22) |
| `nyv.documents` | `DocumentsApi` | Upload, OCR, indexing, search, RAG |
| `nyv.agents` | `AgentsApi` | Discovery + execution/orchestration of the 164-agent registry (real Queen) |
| `nyv.skills` | `SkillsApi` | 100+ legal skills (drafting, review…) |
| `nyv.twins` | `TwinApi` | Digital twin creation + simulation |
| `nyv.knowledge` | `KnowledgeApi` | Knowledge graph + corpus search |
| `nyv.rag` | `RagApi` | Unified Auto-RAG retrieval (`/rag/query`, `/rag/collections/auto/retrieve`) |
| `nyv.models` | `ModelsApi` | Model catalog + per-provider readiness (`/models/providers`) |
| `nyv.mcp` | `McpApi` | MCP tool list + invoke/execute (canonical SSoT executor; `developer`+ role) |
| `nyv.usage` | `UsageApi` | Token + cost ledger (`/usage/summary`, `/usage/tokens`) |
| `nyv.voice` | `VoiceApi` | Sarvam voice synthesis + transcription |
| `nyv.intelligence` | `IntelligenceApi` | Citation check, legal diff, templates |
| `nyv.testing` | `TestingApi` | Eval harness + LLM-as-Judge |
| `nyv.compliance` | `ComplianceApi` | DPDP/GDPR audit + redaction |
| `nyv.nyayatools` | `NyayaToolsApi` | India tax + GST + government APIs |
| `nyv.memory` | `MemoryApi` | Mem0 long-term memory persistence |
| `nyv.cache` | `CacheApi` | Semantic cache invalidation + stats |
| `nyv.credits` | `CreditsApi` | Org credit balance + usage |
| `nyv.orch` | `OrchApi` | `/api/nv5/orch/*` — BM25 agent shortlist, ROMA outcomes, KB / multimodal-RAG / plugins / protocols metadata (Batch A) |
| `nyv.workflows` | `WorkflowsApi` | `/api/nv5/workflows/*` — autonomous + continuous workflow engines (Batch C) |
| `nyv.docAi` | `DocAiApi` | `/api/nv5/doc-ai/*` — deterministic doc conversion (PDF/A, DOCX, OCR-PDF) (Batch C) |
| `nyv.gov` | `GovApi` | `/api/nv5/gov/*` — maker-checker, security monitor, cost optimizer, concurrency, org rate limiter (Batch D) |
| `nyv.legalPipeline` | `LegalPipelineApi` | `/api/nv5/legal-pipeline/*` — chunker, embedding catalog, RRF reranker, summarizer, readability (Batch E) |
| `nyv.complianceNv5` | `ComplianceNv5Api` | `/api/nv5/compliance/*` — EU AI Act, PQC keygen, federated-privacy (Batch F) |
| `nyv.internal` | `InternalApi` | `/api/nv5/internal/*` — 17 routing / docs / quality / adapter introspection endpoints (Batches G+H+I+J) |
| `nyv.stream` | `NyvStreamReader` | AG-UI SSE streaming for any pattern |

> **`/api/nv5/*` reachability.** Every namespace defaults OFF behind a
> `JRX_F_*` flag — calling these wrappers without the matching flag set on
> the gateway returns `404`. See the "Additive `/api/nv5/*` admin surface"
> section below for the per-batch flag matrix.

## Streaming (AG-UI)

```ts
await nyv.stream.streamPattern('react', { task: '...' }, {
  onAgentSelected: (agent) => console.log('routed to', agent),
  onThinking:      (step)  => console.log('… ', step),
  onToolCall:      (tool, input)  => console.log(`→ ${tool}`, input),
  onToolResult:    (tool, result) => console.log(`← ${tool}`, result),
  onTextDelta:     (delta) => process.stdout.write(delta),
  onComplete:      (final) => console.log('done', final.traceId),
});
```

The reader handles SSE reconnect, AG-UI v1 + legacy event shapes, and resolves
on `run_finished`. See [`NyvStreamReader`](./src/NyvStreamReader.ts) for full
options.

## Error handling

Every error is a `NyvError` with a stable `code`:

```ts
import { NyvClient, NyvError } from '@jurexio/client-sdk';

try { await nyv.ask('...'); }
catch (e) {
  if (e instanceof NyvError) {
    console.error(e.code, e.status, e.traceId, e.message);
    if (e.code === 'RATE_LIMITED') await sleep(60_000);
    if (e.code === 'AUTH_INVALID') refreshKey();
  }
}
```

## Webhooks

Configure a webhook URL + secret in the developer console (`/console/apps`).
On orchestration completion you'll receive a `POST` to your URL with:

```
X-NYV-Event: orchestration.completed
X-NYV-Timestamp: 2026-04-25T10:15:42.123Z
X-NYV-Signature: sha256=<hex hmac of `${ts}.${body}`>
X-NYV-Correlation-Id: <correlationId>
```

Verify with:

```ts
import { verifyWebhookSignature } from '@jurexio/client-sdk';

const ok = verifyWebhookSignature({
  rawBody,
  signature: req.headers['x-nyv-signature'],
  timestamp: req.headers['x-nyv-timestamp'],
  secret: process.env.JRX_WEBHOOK_SECRET!,
});
```

## Queen streaming

```ts
await nyv.orchestrate.stream(
  { prompt: 'Notice period under Karnataka Rent Act?', jurisdiction: 'IN' },
  {
    onAgentSelected: (agent) => console.log('routed to', agent),
    onThinking: (step) => console.log('…', step),
    // meta.provisional / meta.gated — see contract below
    onTextDelta: (delta, _acc, meta) => {
      if (meta?.gated) process.stdout.write('\n[gated]\n');
      process.stdout.write(delta);
    },
    onComplete: (final) => console.log('done', final.traceId),
  },
);
```

### Queen provisional → gated replace contract (5.0.6+)

Queen SSE may emit **two phases** of `text_delta`:

| Phase | Flags | Meaning | Client action |
|---|---|---|---|
| Provisional | `provisional: true` (default) | Pre-safety-gate synthesizer tokens | Paint for latency UX only |
| Gated | `provisional: false`, `gated: true` | Post-`stampSafetyVerdict` authoritative text | **Replace** UI buffer (do not append onto provisional) |
| Final | `synthesis_final` / `run_completed` | Sentinel after gated chunks | Prefer this as source of truth |

`NyvStreamReader` (5.0.6+) **resets** its accumulated buffer on the first gated event so `onTextDelta` never double-paints. Hand-rolled EventSource clients must do the same:

```ts
let ui = '';
let sawGate = false;
es.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.type !== 'text_delta') return;
  if (m.gated === true || m.provisional === false) {
    if (!sawGate) { sawGate = true; ui = ''; }
  }
  ui += m.delta || '';
  render(ui);
};
```

Ops: set `JRX_QUEEN_SUPPRESS_PROVISIONAL=1` on the gateway to emit only gated tokens (higher TTFT, simpler clients). `JRX_QUEEN_GATED_TOKEN_STREAM=0` disables post-gate chunking (still emits `synthesis_final`).

Partner alias: `POST /api/jrx/v1/sdk/orchestrate/stream` is equivalent to `/api/jrx/orchestrate/stream`.

## Documentation

- [v6 API Reference](../../docs/v3.1.2/completed_docs/NYV-SDK-v6-API-REFERENCE.md)
- [v6 Integration Guide](../../docs/v3.1.2/completed_docs/NYV-SDK-v6-INTEGRATION-GUIDE.md)
- [v5 → v6 Deprecation Policy](../../docs/v3.1.2/superseded/NYV-SDK-v5-DEPRECATION-POLICY.md)
- [Mobile Integration Guide](../../docs/v3.1.2/completed_docs/NYV-MOBILE-INTEGRATION-GUIDE.md)
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) · [`CHANGELOG.md`](./CHANGELOG.md) · [`SEMVER.md`](./SEMVER.md)

## License

Proprietary — © Jurexio Technology Pvt Ltd.

---

## Additive `/api/nv5/*` admin surface (Session-10/11/12)

The `/api/jrx/*` gateway surface (1,503 operations across 132 mounts per the
generated OpenAPI baseline) grows additively. Sessions 10–11 added an
**additive** admin / capability surface under `/api/nv5/*`. Since
`@jurexio/client-sdk@5.1.x` the SDK ships typed wrappers for every Batch A–J namespace below — see the
"API surface" table above for property names (`nyv.orch`, `nyv.workflows`,
`nyv.docAi`, `nyv.gov`, `nyv.legalPipeline`, `nyv.complianceNv5`,
`nyv.internal`). Multimodal + voice still flow through the canonical
`nyv.voice` / multimodal helpers. **Every `/api/nv5/*` namespace defaults OFF**;
each is opt-in per environment via `JRX_F_*` env-vars on the gateway.

| Batch | Namespace | Flag(s) | Purpose |
|---|---|---|---|
| A | `/api/nv5/orch/*` | `JRX_F_AI_ORCH_KB`, `…_CONTEXT`, `…_MULTIMODAL_RAG`, `…_PLUGINS`, `…_ROMA`, `…_AGENT_SELECT`, `…_PROTOCOLS` | BM25 agent shortlist, ROMA-L5 outcomes, KB / multimodal-RAG metadata |
| B | `/api/nv5/multimodal/*` | `JRX_F_MULTIMODAL_AVATAR_UNITY`, `…_AVATAR_CHATDOLL`, `…_RAG_ADV`, `…_3D_IMMERSIVE`, `…_AVATAR_3D` | Vision analysis, 3D / avatar sessions, multimodal-RAG (delegates to canonical pipeline) |
| B | `/api/nv5/voice/*` | `JRX_F_VOICE_STREAM_RT`, `JRX_F_VOICE_SYNTH`, `JRX_F_VOICE_ENHANCED` | Realtime voice streaming, TTS synthesis, voice provider cost reports |
| C | `/api/nv5/workflows/*` | `JRX_F_WORKFLOW_AUTONOMOUS`, `JRX_F_WORKFLOW_CONTINUOUS` | Autonomous + continuous workflow engines (per-task safety-ring fan-out) |
| C | `/api/nv5/doc-ai/*` | `JRX_F_DOC_AI_CONVERT` | Pure-deterministic doc conversion (PDF/A, DOCX, OCR-PDF) |
| D | `/api/nv5/gov/*` | `JRX_F_GOV_MAKER_CHECKER`, `…_SECURITY_MON`, `…_COST_OPT`, `…_CONCURRENCY`, `…_ORG_RATELIMIT` | Governance — maker-checker, security monitor, cost optimiser, concurrency, per-org rate limiter |
| E | `/api/nv5/legal-pipeline/*` | `JRX_F_LEGAL_PIPELINE_CHUNKER`, `…_EMBEDDING`, `…_RERANKER`, `…_SUMMARIZER`, `…_READABILITY` | RAG primitives — chunker preview, embedding catalog, RRF fusion, readability scoring |
| F | `/api/nv5/compliance/*` | `JRX_F_COMPLIANCE_EU_AI_ACT`, `…_PQC`, `…_FEDERATED_PRIVACY` | EU AI Act reports, PQC keygen, federated-privacy session listings |
| G+H+I+J | `/api/nv5/internal/*` | `JRX_F_INTERNAL_SURFACE` | Single-namespace barrel for 17 routing / docs / quality / adapter introspection endpoints |

**Auth.** Same `X-API-Key` header as the v6 surface (NV-AUTH-HEADER-001).
Most admin routes additionally require `admin` scope, which super-admin-
minted SDK keys hold via the wildcard `*` scope.

**Safety ring.** No `/api/nv5/*` route emits an LLM call directly —
heavy paths either delegate to the canonical `/api/jrx/*` chain
(multimodal, voice) or return deterministic compute / metadata only.
Full per-batch trace: see `docs/canonical/11-agentic-architecture-2026-05-10.md`
in the platform repo.

**Reference docs.**
- Endpoint tables, scopes, flags — `docs/canonical/04-sdk-and-api-canonical-2026-05-07.md` §§ 11–17
- Per-batch capability + SKU mapping — `docs/canonical/01-product-comprehensive-2026-05-07.md` § 11
- 1,042-agent registry summary — `docs/canonical/01-product-comprehensive-2026-05-07.md` § 12

## MCP server (standalone)

For Cursor / Claude Desktop / partner agent hosts, use the companion package
[`@jurexio/mcp-server`](../mcp-server/README.md) (v5.0.0):

```bash
JRX_API_KEY=nyv_live_sk_... JRX_MCP_SKU=nsp npx @jurexio/mcp-server
```

Curated executable tools only (~35); SKU allowlists via `JRX_MCP_SKU` or
`JRX_MCP_ALLOWLIST`. Gateway invoke path:
`POST /api/jrx/sdk/workflows/protocols/mcp/tools/invoke`.

## Live API base URL

```
https://api.jurexio.example
```

Authenticate with `Authorization: Bearer <NV_API_KEY_xxx>` and a matching
`Origin` header (e.g. `https://pro.jurexio.example` for the NSP key).
For inter-service callers, also set `X-NSP-Inter-Secret` (or alias
`X-Inter-Service-Secret`) to `NV_INTER_SERVICE_SECRET`.

## Project tracker

Every SDK release is logged in:
- the per-package `CHANGELOG.md` (this directory)
- the root [`CHANGELOG.md`](../../../CHANGELOG.md)
- the root [`Project-Tracker.md`](../../../Project-Tracker.md) (audit row)

See [`AGENTS.md`](../../../AGENTS.md) at the repo root for the mandatory
update protocol.
