# NSM — Nyayasiddhi Ministry Integration Guide

> **NSM** = Nyayasiddhi Ministry™. Government / public-sector legal AI for ministries, regulators, and judicial bodies.
> Same unified Nyayavigya gateway, NSM-scoped key. Designed for sovereign-data and audit-heavy use.

## 1. Quickstart

```bash
curl https://api.nyayasiddhi.online/health

curl -H "X-API-Key: $NYV_SDK_KEY_NSM" \
     https://api.nyayasiddhi.online/api/nv/gateway/health

curl -H "X-API-Key: $NYV_SDK_KEY_NSM" \
     https://api.nyayasiddhi.online/api/nv/gateway/agents
```

## 2. Authentication

Canonical header: **`X-API-Key`** (NV-AUTH-HEADER-001).
NSM keys carry the `government` scope set: full enterprise scopes plus `gov:*`, `compliance:*`, `audit:*`, `sovereign:*`. Sovereign-data routes route to in-region providers only (Sarvam, Bedrock ap-south-1) when `preferences.sovereignOnly = true`.

```ts
const headers = { "X-API-Key": process.env.NYV_SDK_KEY_NSM };
```

## 3. Core endpoints (NSM scope)

| Endpoint | Purpose |
|---|---|
| `POST /api/nv/orchestrate` | Best-quality orchestration with maker-checker on by default. |
| `POST /api/nv/gateway/research/query` | Multi-jurisdiction legal research. |
| `POST /api/nv/sdk/legal/policy-analysis` | Policy / regulation impact analysis. |
| `POST /api/nv/sdk/gov/citizen-grievance-triage` | Triage citizen grievances against ministry SOPs. |
| `POST /api/nv5/doc-ai/jobs` | Bulk doc conversion (Acts, Rules, Gazettes). |
| `POST /api/nv/intelligence/citation-check` | Verify statutory citations + judicial references. |
| `GET  /api/nv/audit/chain` | Hash-chain audit log (every gov request appended). |
| `GET  /api/nv/audit/chain/verify` | Verify chain integrity (analyst+). |
| `GET  /api/nv/compliance/dashboard` | ISO 42001 + SOC2 + EU AI Act + DPDPA aggregate. |

Full surface: `docs/openapi/nyayavigya-v5.openapi.json` + Postman collection.

## 4. SDK pattern

```ts
class NsmClient {
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

  policyAnalysis(text: string, jurisdiction = "IN") {
    return this.req("/api/nv/sdk/legal/policy-analysis", {
      method: "POST",
      body: JSON.stringify({ text, jurisdiction, sovereignOnly: true }),
    });
  }
}
```

## 5. Comprehensive AI request/response — NSM (Session-15 v17 update)

NSM partners get **unrestricted throughput** during the dev/UAT period (rate-limit lift confirmed in `docs/canonical/12-platform-status-and-readiness-2026-05-11.md` § 2). Production tiers will be reapplied before cutover.

### 5.1 Best-quality orchestration call (policy / regulation impact)

```bash
curl -X POST https://api.nyayasiddhi.online/api/nv/orchestrate \
  -H "X-API-Key: $NYV_SDK_KEY_NSM" \
  -H "Content-Type: application/json" \
  -d '{
    "task": "Analyse the impact of the Digital Personal Data Protection Act 2023 on the Income Tax Department'\''s data-sharing MoUs with state governments. Identify clauses that require renegotiation, statutory triggers, and recommend a 90-day compliance roadmap.",
    "jurisdiction": "IN",
    "tier": "government",
    "preferences": {
      "preferCheaper": false,
      "requireReasoning": true,
      "requireCitations": true,
      "requireMakerChecker": true,
      "sovereignOnly": true
    },
    "context": {
      "ministry": "finance",
      "userRole": "joint-secretary"
    }
  }'
```

**Response (canonical NvResponse envelope):**

```json
{
  "ok": true,
  "data": {
    "answer": "## DPDPA 2023 impact on Income Tax Department data-sharing MoUs ...",
    "complianceRoadmap": [
      { "phase": 1, "days": 30, "actions": ["Inventory all 47 active MoUs", "..."] }
    ],
    "citations": [
      { "act": "DPDPA 2023", "section": "8(7)", "relevance": 0.96 },
      { "case": "Justice K.S. Puttaswamy v. Union of India", "year": 2017, "citation": "(2017) 10 SCC 1" }
    ],
    "agentic": {
      "patternUsed": "graphrag+maker-checker",
      "agentsConsulted": ["IN-007-data-protection", "IN-035-government-policy"]
    }
  },
  "model": "claude-opus-4-7",
  "provider": "anthropic",
  "latencyMs": 9241,
  "source": "queen-orchestrator",
  "orchestration": {
    "pattern": "graphrag",
    "agentsUsed": ["IN-007-data-protection", "IN-035-government-policy"],
    "fallbackLevel": 0,
    "tokensIn": 1842,
    "tokensOut": 4912,
    "makerCheckerScore": 0.94
  },
  "requestId": "req_01HE...",
  "usedFallback": false,
  "safety": {
    "hallucinationScore": 0.01,
    "citationVerified": true,
    "piiRedacted": true,
    "auditChainAppended": true
  }
}
```

### 5.2 Sovereign-data-only call (in-region providers)

Set `"preferences.sovereignOnly": true`. The router restricts the candidate cascade to providers with in-region data residency (Sarvam IN, Bedrock ap-south-1). If no sovereign provider is healthy, the call fails fast with `SOVEREIGN_NO_PROVIDER` rather than silently falling back.

### 5.3 Predict cost & latency BEFORE calling

```bash
curl -X POST https://api.nyayasiddhi.online/api/nv/v1/sdk/llm/router/explain \
  -H "X-API-Key: $NYV_SDK_KEY_NSM" -H "Content-Type: application/json" \
  -d '{ "tier":"government", "jurisdiction":"IN", "taskKind":"policy-analysis", "sovereignOnly": true }'
```

## 6. Rate limits

NSM keys are on the `internal` (effectively unlimited) tier during dev/UAT per § 2 of canonical doc 12. Production target: `government` (600 rpm / 50k rph / 200k rpd).

## 7. Audit + compliance

Every NSM request is appended to the `nv_schema.nv_audit_logs` hash-chain (canonical 09 § C.1). The chain is verifiable end-to-end via `GET /api/nv/audit/chain/verify` (analyst+ JWT). For SOC2 / ISO 42001 / DPDPA evidence packs see `GET /api/nv/compliance/dashboard`.

## 8. References

- Canonical platform status: `docs/canonical/12-platform-status-and-readiness-2026-05-11.md`
- API + route table: `docs/canonical/04-sdk-and-api-canonical-2026-05-07.md`
- Compliance posture: `docs/canonical/09-uat-and-compliance-2026-05-08.md` § C
