# NSP-Web Integration Guide

> **NSP-Web** = Nyayasiddhi Professional, Web SKU. Browser-based legal research workspace for law firms.
> One unified NYV API powers it (NV-SDK-UNIFIED-001 — no per-platform URL prefix). The platform is differentiated only by SDK key + per-key rate limit.

## 1. Quickstart (5 min)

```bash
# Health check (no auth required)
curl https://api.nyayasiddhi.online/health

# Authenticated probe — substitute your NSP key
curl -H "X-API-Key: $NYV_SDK_KEY_NSP" \
     https://api.nyayasiddhi.online/api/nv/gateway/health

# List all available agents (NSP-tier subset returned automatically based on key scope)
curl -H "X-API-Key: $NYV_SDK_KEY_NSP" \
     https://api.nyayasiddhi.online/api/nv/gateway/agents
```

## 2. Authentication

NSP-Web uses the canonical **`X-API-Key`** header (NV-AUTH-HEADER-001).
`Authorization: Bearer <key>` is accepted as a fallback for SDKs that cannot set arbitrary headers.

```ts
const headers = { "X-API-Key": process.env.NYV_SDK_KEY_NSP };
```

The key's **scopes** (in `sdk_app_api_keys.scopes`) determine which endpoints the request can reach.
A typical NSP key carries scopes for: legal research, document AI conversion, citation verification, drafting assistance, and basic compliance checks. **Enterprise-scoped endpoints** (`/api/nv/sdk/enterprise/*`) require an NSI/NSM/JRX key, not NSP.

## 3. Core endpoints (NSP scope)

| Endpoint | Purpose |
|---|---|
| `POST /api/nv/gateway/research/query` | Run a legal-research query through the agent network. |
| `POST /api/nv/sdk/legal/case-analysis` | Analyse a case fact-pattern + jurisdiction; returns reasoning + citations. |
| `POST /api/nv5/doc-ai/jobs` | Convert a document (multipart upload). 1-GB safe, bounded server-side concurrency. |
| `GET  /api/nv5/doc-ai/jobs/:id` | Poll a conversion job. |
| `GET  /api/nv5/doc-ai/jobs/:id/result` | Stream the converted bytes back. |
| `POST /api/nv/sdk/legal/translate` | Translate legal text (Indic & EU languages via Sarvam/OpenAI). |
| `GET  /api/nv/observability/router-stats` | Live LLM-routing telemetry: cost, fallbacks, model health. |

The full surface (1,206 operations) is in the OpenAPI snapshot at `docs/openapi/nyayavigya-v5.openapi.json` and the Postman collection at `docs/postman/nyayavigya-v5.postman.json`.

## 4. Browser SDK pattern

```ts
// NSP-Web client wrapper
class NsplClient {
  constructor(private apiKey: string, private baseUrl = "https://api.nyayasiddhi.online") {}

  private async req(path: string, init: RequestInit = {}) {
    const r = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        "X-API-Key": this.apiKey,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });
    if (!r.ok) throw new Error(`NYV ${r.status}: ${await r.text()}`);
    return r.json();
  }

  research(query: string, jurisdiction = "IN") {
    return this.req("/api/nv/gateway/research/query", {
      method: "POST",
      body: JSON.stringify({ query, jurisdiction }),
    });
  }

  async convertDoc(file: File, sourceFormat: string, targetFormat: string) {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("sourceFormat", sourceFormat);
    fd.append("targetFormat", targetFormat);
    const r = await fetch(`${this.baseUrl}/api/nv5/doc-ai/jobs`, {
      method: "POST",
      headers: { "X-API-Key": this.apiKey },
      body: fd,
    });
    return r.json();
  }
}
```

## 5. Bulk document conversion

The Console ships a Bulk Document Conversion page (`/bulk-doc-upload`) that wraps `/api/nv5/doc-ai/jobs` with a 4-way parallel uploader and per-file progress + download. Use it as a reference implementation.

## 6. Rate limits

NSP keys are throttled per-key by the platform rate-limiter middleware. Limits scale with the key's tier; check `/api/nv/sdk/keys/:keyId/usage` for live consumption.

## 7. Security checklist

- Never expose your NSP key in client-side bundles. Proxy through your own backend.
- Rotate keys periodically via the Console (`/sdk-key-management` → Rotate).
- Revoke immediately on suspicion via the Console (`/sdk-key-management` → Revoke).
- Watch for `X-API-Version` in responses; v5.0.0 is current per NV-API-CONTRACT-001.

## 8. Observability

- **Audit chain**: `/audit-chain` Console page for hash-chain explorer + JSON export.
- **Live activity feed**: `/live-activity-feed` Console page for SSE-driven request log.
- **Cost optimizer**: `/cost-optimizer` Console page for live router-stats.

## 9. Errors

The gateway returns a uniform error envelope:
```json
{ "error": "human message", "code": "MACHINE_CODE", "platform": "Nyayavigya Platform 5.0.0" }
```
Common codes: `AUTH_TOKEN_MISSING` (401), `SCOPE_DENIED` (403), `NYV-404` (route not found), `RATE_LIMIT_EXCEEDED` (429), `UPSTREAM_PROVIDER_ERROR` (502).

## 10. Support

Issues → `docs/canonical/00-README.md` for canonical operational truth.

---

## 5. Comprehensive AI request/response — NSP-Web (Session-15 v17 update)

NSP-Web partners get **unrestricted throughput** during the dev/UAT period (rate-limit lift confirmed in `docs/canonical/12-platform-status-and-readiness-2026-05-11.md` § 2). Production tiers will be reapplied before cutover.

### 5.1 Best-quality orchestration call (legal research)

```bash
curl -X POST https://api.nyayasiddhi.online/api/nv/orchestrate \
  -H "X-API-Key: $NYV_SDK_KEY_NSP" \
  -H "Content-Type: application/json" \
  -d '{
    "task": "Research the latest Supreme Court of India judgments on the scope of Article 14 in administrative law from 2024-2026, with citations",
    "jurisdiction": "IN",
    "tier": "professional",
    "preferences": {
      "preferCheaper": false,
      "requireReasoning": true,
      "requireCitations": true
    },
    "context": {
      "practiceArea": "constitutional",
      "userRole": "senior-advocate"
    }
  }'
```

**Response (canonical NvResponse envelope):**

```json
{
  "ok": true,
  "data": {
    "answer": "Recent Supreme Court jurisprudence on Article 14 ...",
    "citations": [
      { "case": "X v. Union of India", "year": 2025, "citation": "(2025) 4 SCC 123", "relevance": 0.94 }
    ],
    "ragContext": [
      { "source": "indiankanoon.org", "snippet": "...", "score": 0.91 }
    ],
    "agentic": {
      "patternUsed": "graphrag",
      "reasoningSteps": ["..."],
      "agentsConsulted": ["IN-014-constitutional", "IN-002-supreme-court"]
    }
  },
  "model": "claude-opus-4-7",
  "provider": "anthropic",
  "latencyMs": 6234,
  "source": "queen-orchestrator",
  "orchestration": {
    "pattern": "graphrag",
    "agentsUsed": ["IN-014-constitutional", "IN-002-supreme-court"],
    "fallbackLevel": 0,
    "tokensIn": 1247,
    "tokensOut": 3856
  },
  "requestId": "req_01HE9X2T...",
  "usedFallback": false,
  "safety": {
    "hallucinationScore": 0.02,
    "citationVerified": true,
    "piiRedacted": false
  }
}
```

### 5.2 Streaming (AGUI lifecycle events)

```bash
curl -N -X POST https://api.nyayasiddhi.online/api/nv/stream/cot \
  -H "X-API-Key: $NYV_SDK_KEY_NSP" \
  -H "Content-Type: application/json" \
  -d '{ "task": "...", "jurisdiction": "IN" }'
```

Returns Server-Sent Events with AGUI lifecycle events: `agent.start`, `agent.thinking`, `tool.call`, `tool.result`, `agent.token`, `agent.complete`. Same auth and same envelope shape on completion as § 5.1.

### 5.3 Predict cost & latency BEFORE calling

```bash
curl -X POST https://api.nyayasiddhi.online/api/nv/v1/sdk/llm/router/explain \
  -H "X-API-Key: $NYV_SDK_KEY_NSP" -H "Content-Type: application/json" \
  -d '{ "tier":"professional", "jurisdiction":"IN", "taskKind":"legal-research", "requireReasoning":true }'
```

### 5.4 Document AI (NSP-Web specific — bulk upload, draft, analyze)

```bash
# Upload + convert (1 GB safe, path-based, bounded concurrency)
curl -X POST https://api.nyayasiddhi.online/api/nv5/doc-ai/convert \
  -H "X-API-Key: $NYV_SDK_KEY_NSP" \
  -F "file=@./contract.pdf" -F "targetFormat=text"

# Draft (308-redirect alias preserved for backward compat)
curl -X POST https://api.nyayasiddhi.online/api/nv/gateway/documents/draft \
  -H "X-API-Key: $NYV_SDK_KEY_NSP" -H "Content-Type: application/json" \
  -d '{ "templateId": "fir_template", "jurisdiction":"IN", "fields": {...} }'
```

Full doc-AI pipeline architecture: see `docs/canonical/12-platform-status-and-readiness-2026-05-11.md` § 4.
