# NSP-Mobile Integration Guide

> **NSP-Mobile** = Nyayasiddhi Professional, Mobile SKU (iOS + Android via Expo / React Native).
> Same unified NYV API as NSP-Web (NV-SDK-UNIFIED-001) — only the SDK key changes.

## 1. Quickstart

```bash
# From the NSP-Mobile repo
npm install
expo start
```

Set the API key in your `.env.local`:
```
EXPO_PUBLIC_NYV_API_BASE=https://api.nyayasiddhi.online
EXPO_PUBLIC_NYV_SDK_KEY=$NYV_SDK_KEY_NSPM
```

## 2. Authentication

The canonical header is **`X-API-Key`** (NV-AUTH-HEADER-001). On mobile, store the key in `expo-secure-store`, never in `AsyncStorage`.

```ts
import * as SecureStore from "expo-secure-store";

export async function getApiKey(): Promise<string | null> {
  return SecureStore.getItemAsync("nyv_sdk_key");
}

export async function setApiKey(key: string) {
  await SecureStore.setItemAsync("nyv_sdk_key", key);
}
```

For end-user authentication on top of the SDK key, use refresh-token rotation against `/api/nv/auth/refresh` — the platform sets `jwtExpiryHours = 24` and `refreshTokenExpiryDays = 90` by default (NV-AUTH-LIFETIME-2026-05-10), so a single rotation covers a typical mobile session lifetime.

## 3. Mobile-specific endpoints

The same NYV API surface is reachable from mobile. The endpoints most useful for mobile UX:

| Endpoint | Mobile use |
|---|---|
| `POST /api/nv/voice/stream` (WS) | Live legal Q&A with Sarvam Indic STT/TTS. |
| `POST /api/nv/sdk/multimodal/*` | Camera capture → document AI pipeline (12 endpoints). |
| `POST /api/nv5/doc-ai/jobs` | Doc convert; mobile can `sourceBase64` instead of multipart. |
| `POST /api/nv/sdk/legal/translate` | 22 Indic languages via Sarvam. |
| `GET  /api/nv/gateway/agents` | List agents for the user's tier; cache locally. |

## 4. NSP-Mobile client wrapper

```ts
// services/nyv-client.ts
import { Platform } from "react-native";

const BASE = process.env.EXPO_PUBLIC_NYV_API_BASE!;

export class NyvMobileClient {
  constructor(private apiKey: string) {}

  private headers(json = true): Record<string, string> {
    const h: Record<string, string> = {
      "X-API-Key": this.apiKey,
      "X-Client-Platform": Platform.OS,
    };
    if (json) h["Content-Type"] = "application/json";
    return h;
  }

  research(query: string, jurisdiction = "IN") {
    return fetch(`${BASE}/api/nv/gateway/research/query`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ query, jurisdiction }),
    }).then(r => r.json());
  }

  // Camera capture → base64 → conversion
  async convertCapturedDoc(base64: string, sourceFormat: string, targetFormat: string) {
    return fetch(`${BASE}/api/nv5/doc-ai/jobs`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ sourceBase64: base64, sourceFormat, targetFormat }),
    }).then(r => r.json());
  }
}
```

## 5. Voice chat (WS)

```ts
import { Audio } from "expo-av";

const ws = new WebSocket(
  `wss://api.nyayasiddhi.online/api/nv/voice/stream?token=${encodeURIComponent(apiKey)}`,
);
ws.binaryType = "arraybuffer";
ws.onmessage = (e) => {
  // server emits { type: "transcript" | "tts_chunk" | "done", ... }
  const msg = JSON.parse(typeof e.data === "string" ? e.data : new TextDecoder().decode(e.data));
  // ... feed to your audio queue
};
```

The voice endpoint speaks all 22 Indic languages via Sarvam; English & EU langs via Deepgram + Whisper.

## 6. Offline + reconnection

- Persist the last `requestId` from any in-flight call so the app can resume after backgrounding.
- For doc-conversion jobs, store the returned `jobId` locally; the result is held server-side for `JOB_TTL_MS` (default 5 min) and can be retrieved on reconnect.
- Use exponential backoff for auth-refresh; the gateway returns `429` with a `Retry-After` header on rate limits.

## 7. Push notifications (Expo)

Wire your Expo push token to the gateway via `POST /api/nv/notifications/register-device`. The platform's notification fan-out service (`/api/nv/notifications/*`) supports per-org broadcast.

## 8. App Store / Play Store

- The mobile SDK does not embed the API key; users sign in to receive it.
- Background uploads: use `expo-background-fetch` + chunked upload via the same `/api/nv5/doc-ai/jobs` endpoint (sourceBase64 mode for files < 10 MB; multipart with `expo-file-system.uploadAsync` for larger).

## 9. Observability hooks

The mobile client should set `X-Client-Platform: ios|android` so the gateway's activity feed (`/api/nv/activity/recent`) can attribute traffic per platform — see the `/live-activity-feed` Console page.

## 10. References

- NSP-Web guide: `docs/integration-guides/nsp-web.md`
- Canonical API + route table: `docs/canonical/04-sdk-and-api-canonical-2026-05-07.md`
- Postman: `docs/postman/nyayavigya-v5.postman.json`

---

## 5. Comprehensive AI request/response — NSP-Mobile (Session-15 v17 update)

Same unified API as NSP-Web (NV-SDK-UNIFIED-001). Differences: use `EXPO_PUBLIC_NYV_SDK_KEY=$NYV_SDK_KEY_NSPM`, smaller payload sizes preferred, voice + multimodal endpoints heavily used.

### 5.1 Voice-first AI call (Sarvam 22-Indic + fallback)

```bash
# WebSocket streaming (recommended for real-time UX)
wscat -c "wss://api.nyayasiddhi.online/api/nv/voice/stream" \
  -H "X-API-Key: $NYV_SDK_KEY_NSPM"

# REST (single-shot)
curl -X POST https://api.nyayasiddhi.online/api/nv5/voice/transcribe \
  -H "X-API-Key: $NYV_SDK_KEY_NSPM" \
  -F "audio=@./query.wav" -F "language=hi" -F "preferProvider=sarvam"
```

### 5.2 Mobile-optimized orchestration (cheaper-first cascade)

```bash
curl -X POST https://api.nyayasiddhi.online/api/nv/orchestrate \
  -H "X-API-Key: $NYV_SDK_KEY_NSPM" \
  -H "Content-Type: application/json" \
  -d '{
    "task": "Summarize this client meeting note in 3 bullets",
    "jurisdiction": "IN",
    "tier": "professional",
    "preferences": {
      "preferCheaper": true,
      "maxCostUsd": 0.005,
      "requireReasoning": false
    }
  }'
```

Returns the same NvResponse envelope as NSP-Web § 5.1 but typically with `model: "sarvam-30b"` or `"gpt-5-nano"` due to `preferCheaper:true`.

### 5.3 Multimodal (12 endpoints)

```bash
# Image → legal analysis
curl -X POST https://api.nyayasiddhi.online/api/nv/sdk/multimodal/image-analyze \
  -H "X-API-Key: $NYV_SDK_KEY_NSPM" \
  -F "image=@./contract-page.jpg" -F "task=extract-clauses"
```

Full multimodal endpoint list: see `docs/canonical/04c-sdk-troubleshooting-2026-05-11.md` § Multimodal.
