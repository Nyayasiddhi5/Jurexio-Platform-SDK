# `@jurexio/client-sdk-react-native`

> React Native + Expo wrapper around `@jurexio/client-sdk` v6.

| | |
|---|---|
| Package | `@jurexio/client-sdk-react-native` |
| Version | **1.0.0** (GA — 2026-04-25) |
| Min RN  | 0.74 |
| Min Expo SDK | 50 |
| Pairs with | `@jurexio/client-sdk@^6.0.0` |

What you get on top of the isomorphic SDK:

- Secure API key + refresh-token storage (Keychain / Keystore via
  `expo-secure-store` or `react-native-keychain`, with AsyncStorage fallback).
- Native-aware streaming via `react-native-sse`, with a long-poll fallback for
  builds that ship without `react-native-sse`.
- One-line camera, microphone, photo-library, and push-notification permission
  helpers (Expo or bare RN).
- Push-notification handler for HITL (Human-In-The-Loop) approval responses.

---

## Install

```bash
npx expo install @jurexio/client-sdk-react-native @jurexio/client-sdk @jurexio/types

# Recommended optional native modules:
npx expo install expo-secure-store expo-camera expo-av expo-notifications expo-image-picker react-native-sse
```

> All native-only modules are **peerDependenciesMeta.optional** — install only
> what your app actually uses.

## 60-second quickstart

```tsx
import { NyvClientRN } from '@jurexio/client-sdk-react-native';

// 1) Create the client (restores any saved key from secure storage)
const nyv = await NyvClientRN.create({
  baseUrl: 'https://api.nyayavigya.com',
});

// 2) On first run, persist the API key:
await nyv.setApiKey('nyv_live_sk_...');

// 3) Ask, stream, analyze — same surface as @jurexio/client-sdk:
const ans = await nyv.client.ask('What is BNS Section 103?');
await nyv.stream.streamPattern('cot', { task: ans.followUp ?? '' }, {
  onTextDelta: (delta) => console.log(delta),
});
```

## Permissions

```ts
import { requestStandardSdkPermissions } from '@jurexio/client-sdk-react-native';

const { camera, microphone, push } = await requestStandardSdkPermissions();
if (!camera.granted) {
  // camera.reason  -> 'denied' | 'module-missing' | 'restricted' | 'undetermined' | 'error'
  // camera.module  -> 'expo-camera'
  Alert.alert('We need camera access to scan documents');
}
```

## Streaming

```ts
await nyv.stream.streamPattern('react', { task: '...' }, {
  onAgentSelected: (agent) => console.log('routed to', agent),
  onThinking:      (step)  => console.log('… ', step),
  onTextDelta:     (delta) => setBuffer(b => b + delta),
  onComplete:      (final) => save(final.traceId),
});
```

`react-native-sse` is preferred when installed. If absent, the reader auto-
falls back to a long-poll endpoint (`?stream=poll`) that returns NDJSON.

## HITL push notifications

```ts
const reg = await nyv.registerForHITL({
  onHITL: (payload) => {
    // Foreground HITL response — update UI immediately.
    showApprovalToast(payload);
  },
});
if (!reg.registered) {
  console.warn('HITL registration failed:', reg.reason, reg.error);
}
```

The library automatically persists incoming HITL payloads to a secure
`hitlInbox` so they survive app restarts.

## Examples

A full Expo example app that wires all of the above is in
`examples/nsp-mobile/` of the platform monorepo. See its README for app-config
boilerplate (`app.json`, `eas.json`).

## Documentation

- [Mobile Integration Guide](../../docs/v3.1.2/completed_docs/NYV-MOBILE-INTEGRATION-GUIDE.md)
- [v6 SDK API Reference](../../docs/v3.1.2/completed_docs/NYV-SDK-v6-API-REFERENCE.md)
- [`CHANGELOG.md`](./CHANGELOG.md)

## License

Proprietary — © Jurexio Technology Pvt Ltd.

---

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
