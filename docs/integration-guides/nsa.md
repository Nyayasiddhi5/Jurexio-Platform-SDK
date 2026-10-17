# NSA — Nyayasiddhi Academy Integration Guide

> **NSA** = Nyayasiddhi Academy™. Legal-education SKU for law schools, bar coaching academies, and CLE providers.
> Same unified Nyayavigya gateway, NSA-scoped key.

## 1. Quickstart

```bash
curl https://api.nyayasiddhi.online/health

curl -H "X-API-Key: $NYV_SDK_KEY_NSA" \
     https://api.nyayasiddhi.online/api/nv/gateway/health

curl -H "X-API-Key: $NYV_SDK_KEY_NSA" \
     https://api.nyayasiddhi.online/api/nv/gateway/agents
```

## 2. Authentication

Canonical header: **`X-API-Key`** (NV-AUTH-HEADER-001).
NSA keys carry the `plus` scope set: `legal:research`, `documents:read`, `learning:*`, `quiz:*`, `case-study:*`. Premium enterprise routes are not exposed.

```ts
const headers = { "X-API-Key": process.env.NYV_SDK_KEY_NSA };
```

## 3. Core endpoints (NSA scope)

| Endpoint | Purpose |
|---|---|
| `POST /api/nv/orchestrate` | Best-quality orchestration (capped maxTokens for cost control). |
| `POST /api/nv/gateway/research/query` | Legal-research Q&A for students. |
| `POST /api/nv/sdk/legal/case-analysis` | Moot-court case analysis with reasoning steps. |
| `POST /api/nv/sdk/learning/quiz/generate` | Auto-generate quiz items from a syllabus topic. |
| `POST /api/nv/sdk/learning/case-study` | Generate annotated case-study from a citation. |
| `POST /api/nv5/doc-ai/jobs` | Convert lecture notes / case briefs (1 GB safe). |

Full surface: `docs/openapi/nyayavigya-v5.openapi.json` + Postman collection.

## 4. SDK pattern

```ts
class NsaClient {
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

  generateQuiz(topic: string, jurisdiction = "IN", difficulty = "intermediate") {
    return this.req("/api/nv/sdk/learning/quiz/generate", {
      method: "POST",
      body: JSON.stringify({ topic, jurisdiction, difficulty, count: 10 }),
    });
  }
}
```

## 5. Comprehensive AI request/response — NSA (Session-15 v17 update)

NSA partners get **unrestricted throughput** during the dev/UAT period (rate-limit lift confirmed in `docs/canonical/12-platform-status-and-readiness-2026-05-11.md` § 2). Production tiers will be reapplied before cutover.

### 5.1 Best-quality orchestration call (case-study generation)

```bash
curl -X POST https://api.nyayasiddhi.online/api/nv/orchestrate \
  -H "X-API-Key: $NYV_SDK_KEY_NSA" \
  -H "Content-Type: application/json" \
  -d '{
    "task": "Generate an annotated case study on Kesavananda Bharati v. State of Kerala (1973) for a third-year LLB constitutional-law class. Include: facts, issues, ratio decidendi, obiter dicta, dissenting opinions, and 5 discussion questions.",
    "jurisdiction": "IN",
    "tier": "academic",
    "preferences": {
      "preferCheaper": false,
      "requireReasoning": true,
      "requireCitations": true,
      "maxTokens": 3000
    },
    "context": {
      "audience": "llb-3rd-year",
      "subject": "constitutional-law"
    }
  }'
```

**Response (canonical NvResponse envelope):**

```json
{
  "ok": true,
  "data": {
    "answer": "## Kesavananda Bharati v. State of Kerala (1973) — Case Study\n\n### Facts\n...",
    "citations": [
      { "case": "Kesavananda Bharati v. State of Kerala", "year": 1973, "citation": "(1973) 4 SCC 225", "relevance": 1.0 }
    ],
    "discussionQuestions": ["..."],
    "agentic": {
      "patternUsed": "cot",
      "agentsConsulted": ["IN-014-constitutional", "IN-040-academic"]
    }
  },
  "model": "claude-sonnet-4-5",
  "provider": "anthropic",
  "latencyMs": 5421,
  "source": "queen-orchestrator",
  "orchestration": {
    "pattern": "cot",
    "agentsUsed": ["IN-014-constitutional", "IN-040-academic"],
    "fallbackLevel": 0,
    "tokensIn": 612,
    "tokensOut": 2884
  },
  "requestId": "req_01HE...",
  "usedFallback": false,
  "safety": {
    "hallucinationScore": 0.03,
    "citationVerified": true,
    "piiRedacted": false
  }
}
```

### 5.2 Quiz generation

```bash
curl -X POST https://api.nyayasiddhi.online/api/nv/sdk/learning/quiz/generate \
  -H "X-API-Key: $NYV_SDK_KEY_NSA" \
  -H "Content-Type: application/json" \
  -d '{
    "topic": "Doctrine of Basic Structure",
    "jurisdiction": "IN",
    "difficulty": "advanced",
    "count": 10,
    "format": "mcq"
  }'
```

### 5.3 Predict cost & latency BEFORE calling

```bash
curl -X POST https://api.nyayasiddhi.online/api/nv/v1/sdk/llm/router/explain \
  -H "X-API-Key: $NYV_SDK_KEY_NSA" -H "Content-Type: application/json" \
  -d '{ "tier":"academic", "jurisdiction":"IN", "taskKind":"learning" }'
```

## 6. Rate limits

NSA keys are on the `internal` (effectively unlimited) tier during dev/UAT per § 2 of canonical doc 12. Production target: `plus` (40 rpm / 1.5k rph / 5k rpd).

## 7. Cost guidance

Academic tier biases toward the cost-optimal cascade — Sarvam, Gemini-Flash, Groq-Llama. Premium models are reserved for `requireReasoning:true` calls. Use the router-explain endpoint to budget course-wide token spend.

## 8. References

- NSP-Web guide: `docs/integration-guides/nsp-web.md`
- Canonical platform status: `docs/canonical/12-platform-status-and-readiness-2026-05-11.md`
- API + route table: `docs/canonical/04-sdk-and-api-canonical-2026-05-07.md`
