# JRX — Jurix Integration Guide

> **JRX** = Jurix™. Judicial-research / court-tech surface for registries, court IT teams, and judges' bench-clerks.
> Same unified Nyayavigya gateway, JRX-scoped key. Designed for high-precision citation work.

## 1. Quickstart

```bash
curl https://api.nyayasiddhi.online/health

curl -H "X-API-Key: $NYV_SDK_KEY_JRX" \
     https://api.nyayasiddhi.online/api/nv/gateway/health

curl -H "X-API-Key: $NYV_SDK_KEY_JRX" \
     https://api.nyayasiddhi.online/api/nv/gateway/agents
```

## 2. Authentication

Canonical header: **`X-API-Key`** (NV-AUTH-HEADER-001).
JRX keys carry the `judicial` scope set: `legal:research`, `documents:*`, `citation:*`, `judicial:*`, `audit:read`, `compliance:read`.

```ts
const headers = { "X-API-Key": process.env.NYV_SDK_KEY_JRX };
```

## 3. Core endpoints (JRX scope)

| Endpoint | Purpose |
|---|---|
| `POST /api/nv/orchestrate` | Best-quality orchestration with citation verification on by default. |
| `POST /api/nv/gateway/research/query` | Court-tier legal research. |
| `POST /api/nv/sdk/legal/case-analysis` | Case fact-pattern analysis with full reasoning trace. |
| `POST /api/nv/intelligence/citation-check` | Verify every cited authority against the registry. |
| `POST /api/nv/intelligence/ner` | Legal NER (parties, courts, statutes, sections). |
| `POST /api/nv5/doc-ai/jobs` | Convert pleadings, orders, judgments (1 GB safe). |
| `GET  /api/nv/audit/chain` | Hash-chain audit log. |

Full surface: `docs/openapi/nyayavigya-v5.openapi.json` + Postman collection.

## 4. SDK pattern

```ts
class JrxClient {
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

  citationCheck(citations: string[], jurisdiction = "IN") {
    return this.req("/api/nv/intelligence/citation-check", {
      method: "POST",
      body: JSON.stringify({ citations, jurisdiction }),
    });
  }
}
```

## 5. Comprehensive AI request/response — JRX (Session-15 v17 update)

JRX partners get **unrestricted throughput** during the dev/UAT period (rate-limit lift confirmed in `docs/canonical/12-platform-status-and-readiness-2026-05-11.md` § 2). Production tiers will be reapplied before cutover.

### 5.1 Best-quality orchestration call (judgment summarisation with citation verification)

```bash
curl -X POST https://api.nyayasiddhi.online/api/nv/orchestrate \
  -H "X-API-Key: $NYV_SDK_KEY_JRX" \
  -H "Content-Type: application/json" \
  -d '{
    "task": "Summarise the attached 87-page Supreme Court judgment in [Case ref] and produce a head-note in the standard SCC format. Verify every authority cited by the bench against the registry; flag any that cannot be located.",
    "jurisdiction": "IN",
    "tier": "judicial",
    "preferences": {
      "preferCheaper": false,
      "requireReasoning": true,
      "requireCitations": true,
      "requireCitationVerification": true
    },
    "context": {
      "court": "supreme-court-india",
      "userRole": "bench-clerk",
      "documentRef": "doc_01HE..."
    }
  }'
```

**Response (canonical NvResponse envelope):**

```json
{
  "ok": true,
  "data": {
    "answer": "## HEAD-NOTE\n\nA. Constitutional Law — Article 14 — ...",
    "headnote": {
      "court": "Supreme Court of India",
      "bench": "...",
      "ratio": "...",
      "issues": ["..."],
      "citations": ["..."]
    },
    "citationsVerified": [
      { "citation": "(2020) 5 SCC 1", "verified": true, "source": "indiankanoon.org" },
      { "citation": "(2018) 9 SCC 388", "verified": false, "reason": "year mismatch — found at (2017) 9 SCC 388" }
    ],
    "agentic": {
      "patternUsed": "graphrag",
      "agentsConsulted": ["IN-002-supreme-court", "IN-014-constitutional"]
    }
  },
  "model": "claude-opus-4-7",
  "provider": "anthropic",
  "latencyMs": 11420,
  "source": "queen-orchestrator",
  "orchestration": {
    "pattern": "graphrag",
    "agentsUsed": ["IN-002-supreme-court", "IN-014-constitutional"],
    "fallbackLevel": 0,
    "tokensIn": 18420,
    "tokensOut": 4218
  },
  "requestId": "req_01HE...",
  "usedFallback": false,
  "safety": {
    "hallucinationScore": 0.01,
    "citationVerified": true,
    "piiRedacted": true
  }
}
```

### 5.2 Stand-alone citation verification

```bash
curl -X POST https://api.nyayasiddhi.online/api/nv/intelligence/citation-check \
  -H "X-API-Key: $NYV_SDK_KEY_JRX" \
  -H "Content-Type: application/json" \
  -d '{
    "citations": [
      "(2020) 5 SCC 1",
      "AIR 1973 SC 1461",
      "(2017) 10 SCC 1"
    ],
    "jurisdiction": "IN"
  }'
```

Returns one record per citation with `{ verified, canonicalCitation, partyNames, year, court, source }` plus a flag for any citation that could not be resolved.

### 5.3 Predict cost & latency BEFORE calling

```bash
curl -X POST https://api.nyayasiddhi.online/api/nv/v1/sdk/llm/router/explain \
  -H "X-API-Key: $NYV_SDK_KEY_JRX" -H "Content-Type: application/json" \
  -d '{ "tier":"judicial", "jurisdiction":"IN", "taskKind":"judgment-summary" }'
```

## 6. Rate limits

JRX keys are on the `internal` (effectively unlimited) tier during dev/UAT per § 2 of canonical doc 12. Production target: `enterprise` tier (600 rpm / 50k rph / 200k rpd).

## 7. Citation accuracy

Citation verification is a first-class concern for judicial work. The `requireCitationVerification: true` preference forces every cited authority through the registry before the response is returned; unverifiable citations are surfaced (not suppressed) so the bench-clerk can decide.

## 8. References

- Canonical platform status: `docs/canonical/12-platform-status-and-readiness-2026-05-11.md`
- API + route table: `docs/canonical/04-sdk-and-api-canonical-2026-05-07.md`
- Hash-chain integrity: `docs/canonical/09-uat-and-compliance-2026-05-08.md` § C.1
