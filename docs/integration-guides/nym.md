# Nyayamitra (NYM) Integration Guide

> **Nyayamitra (NYM)** = Citizen-facing legal AI assistant. Free / freemium tier of the Nyayavigya platform.
> Same unified NYV API as NSP-Web and NSP-Mobile (NV-SDK-UNIFIED-001). NYM keys carry a smaller scope set + tighter rate limits, and route by default to lower-cost tiers (Sarvam, Groq, Gemini Flash) before falling back to premium models.

## 1. Quickstart

```bash
# Public health probe
curl https://api.nyayasiddhi.online/health

# NYM key probe
curl -H "X-API-Key: $NYV_SDK_KEY_NYM" \
     https://api.nyayasiddhi.online/api/nv/gateway/health
```

The NYM key is bundled with the Nyayamitra app; users do not need to manage keys directly.

## 2. Authentication

Same as the rest of the platform: **`X-API-Key`** (NV-AUTH-HEADER-001).

NYM does **not** carry the `enterprise:*` scope set — calls to `/api/nv/sdk/enterprise/*` will return **403 SCOPE_DENIED**. Use `/api/nv/gateway/*` and `/api/nv/sdk/legal/*` instead.

## 3. NYM-scoped endpoints

| Endpoint | Citizen use case |
|---|---|
| `POST /api/nv/gateway/research/query` | "What are my rights as a tenant in Karnataka?" |
| `POST /api/nv/sdk/legal/translate` | Translate a notice into one of 22 Indic languages (Sarvam). |
| `POST /api/nv5/doc-ai/jobs` | Convert a scanned PDF notice to plain text or markdown. |
| `POST /api/nv/voice/stream` (WS) | Voice-first legal questions in regional languages. |
| `GET  /api/nv/gateway/agents` | List the citizen-tier agent subset. |

Citizen-tier agents include: `tenant-rights-helper`, `consumer-rights-helper`, `simple-contract-explainer`, `legal-notice-translator`, `court-fee-estimator`, plus the universal `legal-research` and `doc-classifier`.

## 4. NYM client wrapper (Expo / React Native)

```ts
const NYM_BASE = "https://api.nyayasiddhi.online";

export const nym = {
  async ask(question: string, language = "en", jurisdiction = "IN") {
    const r = await fetch(`${NYM_BASE}/api/nv/gateway/research/query`, {
      method: "POST",
      headers: {
        "X-API-Key": process.env.EXPO_PUBLIC_NYV_SDK_KEY_NYM!,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: question,
        jurisdiction,
        // citizen-tier hint — the router prefers cheaper tiers for NYM keys
        preferredTier: "value",
        responseLanguage: language,
      }),
    });
    return r.json();
  },

  async translate(text: string, targetLang: string) {
    const r = await fetch(`${NYM_BASE}/api/nv/sdk/legal/translate`, {
      method: "POST",
      headers: {
        "X-API-Key": process.env.EXPO_PUBLIC_NYV_SDK_KEY_NYM!,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text, targetLang }),
    });
    return r.json();
  },
};
```

## 5. Voice-first interaction

NYM is voice-first — many citizens prefer asking questions in their regional language rather than typing. Wire `/api/nv/voice/stream` (WS) with a Sarvam Indic STT/TTS profile:

```ts
const ws = new WebSocket(
  `wss://api.nyayasiddhi.online/api/nv/voice/stream?token=${encodeURIComponent(NYM_KEY)}`,
);
ws.onopen = () => {
  ws.send(JSON.stringify({
    type: "config",
    profile: "nym-citizen",
    sttLang: "hi-IN",   // any of 22 Indic codes
    ttsLang: "hi-IN",
  }));
};
```

## 6. Cost & tier behaviour

NYM keys default to the platform's value tier — Sarvam-105B, Gemini-Flash, Groq-Llama-3.1-70B — and only fall back to premium (Claude/GPT-4o) when the value tier is exhausted or returns an error. The router's behaviour is visible in `/cost-optimizer` Console page.

Per-NYM-key monthly token budgets are enforced by `nv-credit-service.ts`. When exceeded, the gateway returns:
```json
{ "error": "monthly token budget exceeded", "code": "CREDIT_BUDGET_EXCEEDED" }
```
…with a `Retry-After-Days` header.

## 7. Privacy & PII

NYM is the most PII-sensitive surface on the platform. The standard NV-ARCH-001 ring applies — every request flows through the PII-redaction middleware before any LLM call. The `NV_PII_ENCRYPTION_KEY` (64-hex) must be set in production.

For citizens uploading court notices or ID documents, the doc-ai converter strips EXIF + tracked-changes metadata server-side before any LLM sees the content.

## 8. Multi-jurisdiction

Citizens span all 6 jurisdictions (IN / UK / US / EU / GCC / SG). Set `jurisdiction` per request — the platform's jurisdiction-mapper picks the right SLM and citation database.

## 9. Rate limits

NYM keys carry the lowest per-key rate limit on the platform. The shared NSP/NSPM/NYM API gateway's rate-limiter middleware enforces this; check `Retry-After` on 429.

## 10. References

- NSP-Web guide: `docs/integration-guides/nsp-web.md`
- NSP-Mobile guide: `docs/integration-guides/nsp-mobile.md`
- Voice endpoint detail: `docs/canonical/04-sdk-and-api-canonical-2026-05-07.md` § Voice
- Citizen agent registry: `config/agent-registries/Nyayavigya-Legal-registry-Default.json`

---

## 5. Comprehensive AI request/response — Nyayamitra (Session-15 v17 update)

NYM is citizen-facing. Best-quality routing during the dev/UAT period uses the SAME orchestrator as NSP/NSI but with `tier:"citizen"` which biases toward Indic + cheaper cascade.

### 5.1 Plain-language legal Q&A (Hindi or English)

```bash
curl -X POST https://api.nyayasiddhi.online/api/nv/orchestrate \
  -H "X-API-Key: $NYV_SDK_KEY_NYM" \
  -H "Content-Type: application/json" \
  -d '{
    "task": "मेरे landlord ने security deposit वापस नहीं किया, क्या करूं?",
    "jurisdiction": "IN",
    "tier": "citizen",
    "preferences": {
      "preferCheaper": true,
      "preferIndic": true,
      "responseLanguage": "hi",
      "complexityCap": "low"
    }
  }'
```

Returns NvResponse with `model: "sarvam-105b"` typically — Sarvam's 22-Indic specialization is the first-choice model when `preferIndic:true`.

### 5.2 Voice in / Voice out (citizen access)

```bash
# Speech-in → text transcription → orchestrator → text-to-speech-out
wscat -c "wss://api.nyayasiddhi.online/api/nv/voice/stream" \
  -H "X-API-Key: $NYV_SDK_KEY_NYM"
```

Send `{ "type":"start", "language":"hi", "ttsResponse":true }` then audio frames. Server emits transcription, orchestrator response, and TTS audio frames.

### 5.3 Offline cache (Nyayamitra-specific)

The `nyayamitra-sdk` package (`packages/nyayamitra-sdk/`) ships with offline FAQ cache + Indic helpers. See `packages/nyayamitra-sdk/README.md`.

### 5.4 Free-tier guardrails (still in effect even with rate-limit lift)

- HITL gate triggers automatically for any answer crossing the citizen-tier confidence threshold (PII redaction enforced).
- Lawyer-handoff suggestion injected into every NvResponse where `data.complexity > 0.7`.
- All responses pass through hallucination + citation safety ring (NV-ARCH-001).

Full citizen-tier safety architecture: see `docs/canonical/07-security-dedicated-2026-05-11.md`.
