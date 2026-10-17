# NSI — Nyayasiddhi Institutional Integration Guide

> **NSI** = Nyayasiddhi Institutional™. Enterprise legal AI for in-house counsel teams, GCs, and large litigation departments.
> Same unified Nyayavigya gateway (NV-SDK-UNIFIED-001), differentiated by SDK key scope + per-key tier.

## 1. Quickstart

```bash
# Health (no auth)
curl https://api.nyayasiddhi.online/health

# Authenticated probe — substitute your NSI key
curl -H "X-API-Key: $NYV_SDK_KEY_NSI" \
     https://api.nyayasiddhi.online/api/nv/gateway/health

# List enterprise-tier agents available to this key
curl -H "X-API-Key: $NYV_SDK_KEY_NSI" \
     https://api.nyayasiddhi.online/api/nv/gateway/agents
```

## 2. Authentication

Canonical header: **`X-API-Key`** (NV-AUTH-HEADER-001).
`Authorization: Bearer <key>` is accepted as a fallback.

```ts
const headers = { "X-API-Key": process.env.NYV_SDK_KEY_NSI };
```

NSI keys carry the **enterprise** scope set: `legal:research`, `documents:*`, `compliance:*`, `enterprise:*`, `audit:read`, `bulk:*`. Enterprise-only routes under `/api/nv/sdk/enterprise/*` are reachable from NSI/NSM/JRX keys but not NSP/NYM.

## 3. Core endpoints (NSI scope)

| Endpoint | Purpose |
|---|---|
| `POST /api/nv/orchestrate` | Best-quality orchestration (queen → safety ring → real LLM). |
| `POST /api/nv/gateway/research/query` | Multi-jurisdiction legal research. |
| `POST /api/nv/sdk/legal/case-analysis` | Case fact-pattern analysis with citations. |
| `POST /api/nv/sdk/enterprise/contract-review` | Enterprise contract review pipeline. |
| `POST /api/nv/sdk/enterprise/clause-library` | Org-scoped clause library CRUD + retrieval. |
| `POST /api/nv5/doc-ai/jobs` | Bulk doc conversion (1 GB safe, bounded concurrency). |
| `POST /api/nv/intelligence/litigation-risk-v2` | Quantitative litigation-risk score. |
| `GET  /api/nv/compliance/dashboard` | ISO 42001 + SOC2 + EU AI Act + DPDPA aggregate. |
| `GET  /api/nv/audit/chain` | Hash-chain audit log (analyst+ for `/verify`). |

Full surface: `docs/openapi/nyayavigya-v5.openapi.json` + Postman collection.

## 4. SDK pattern

```ts
class NsiClient {
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

  contractReview(text: string, jurisdiction = "IN") {
    return this.req("/api/nv/sdk/enterprise/contract-review", {
      method: "POST",
      body: JSON.stringify({ text, jurisdiction, depth: "full" }),
    });
  }
}
```

## 5. Comprehensive AI request/response — NSI (Session-15 v17 update)

NSI partners get **unrestricted throughput** during the dev/UAT period (rate-limit lift confirmed in `docs/canonical/12-platform-status-and-readiness-2026-05-11.md` § 2). Production tiers will be reapplied before cutover.

### 5.1 Best-quality orchestration call (enterprise contract review)

```bash
curl -X POST https://api.nyayasiddhi.online/api/nv/orchestrate \
  -H "X-API-Key: $NYV_SDK_KEY_NSI" \
  -H "Content-Type: application/json" \
  -d '{
    "task": "Review the attached MSA between Acme India and Beta SaaS for risk concentration in indemnity, liability cap, IP assignment, and data-protection clauses. Highlight non-market terms and propose redlines aligned with Indian Contract Act 1872 + DPDPA 2023.",
    "jurisdiction": "IN",
    "tier": "enterprise",
    "preferences": {
      "preferCheaper": false,
      "requireReasoning": true,
      "requireCitations": true,
      "requireMakerChecker": true
    },
    "context": {
      "practiceArea": "commercial",
      "userRole": "general-counsel",
      "documentRef": "doc_01HE..."
    }
  }'
```

**Response (canonical NvResponse envelope):**

```json
{
  "ok": true,
  "data": {
    "answer": "MSA review summary ...",
    "redlines": [
      { "clause": "8.2 Liability Cap", "issue": "1x fees is below market for SaaS at this ARR", "suggested": "12x fees or USD 5M, whichever is higher", "severity": "high" }
    ],
    "citations": [
      { "case": "Y v. Z Pvt Ltd", "year": 2024, "citation": "(2024) 6 SCC 411", "relevance": 0.92 }
    ],
    "agentic": {
      "patternUsed": "graphrag+maker-checker",
      "agentsConsulted": ["IN-021-commercial", "IN-007-data-protection"]
    }
  },
  "model": "claude-opus-4-7",
  "provider": "anthropic",
  "latencyMs": 8742,
  "source": "queen-orchestrator",
  "orchestration": {
    "pattern": "graphrag",
    "agentsUsed": ["IN-021-commercial", "IN-007-data-protection"],
    "fallbackLevel": 0,
    "tokensIn": 4521,
    "tokensOut": 5218
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

### 5.2 Bulk contract analysis (enterprise pipeline)

```bash
curl -X POST https://api.nyayasiddhi.online/api/nv/sdk/enterprise/contract-review \
  -H "X-API-Key: $NYV_SDK_KEY_NSI" \
  -H "Content-Type: application/json" \
  -d '{
    "documentIds": ["doc_a", "doc_b", "doc_c"],
    "jurisdiction": "IN",
    "checks": ["liability-cap", "indemnity", "ip-assignment", "data-protection", "termination"]
  }'
```

Returns one report per document plus an aggregate risk-distribution summary.

### 5.3 Predict cost & latency BEFORE calling

```bash
curl -X POST https://api.nyayasiddhi.online/api/nv/v1/sdk/llm/router/explain \
  -H "X-API-Key: $NYV_SDK_KEY_NSI" -H "Content-Type: application/json" \
  -d '{ "tier":"enterprise", "jurisdiction":"IN", "taskKind":"contract-review" }'
```

## 6. Rate limits

NSI keys are on the `internal` (effectively unlimited) tier during dev/UAT per § 2 of canonical doc 12. Production target: `enterprise` (600 rpm / 50k rph / 200k rpd). Revert path documented in `config/rate-limits/rate-limits.json` `_prod_tier`.

## 7. Compliance & audit

- ISO 42001 + SOC2 + EU AI Act + DPDPA aggregate: `GET /api/nv/compliance/dashboard`
- Audit-chain explorer: Console `/audit-chain` page or `GET /api/nv/audit/chain`
- Per-org RBAC: Console `/admin/rbac-console`
- Per-org console layout: Console `/admin/org-console-layout`

## 8. References

- NSP-Web guide: `docs/integration-guides/nsp-web.md`
- Canonical platform status: `docs/canonical/12-platform-status-and-readiness-2026-05-11.md`
- API + route table: `docs/canonical/04-sdk-and-api-canonical-2026-05-07.md`
- Troubleshooting: `docs/canonical/04c-sdk-troubleshooting-2026-05-11.md`
