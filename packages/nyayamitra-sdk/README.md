# `@jurexio/nyayamitra-sdk`

> Citizen-facing legal-aid SDK that wraps the Jurexio gateway with the
> three Nyayamitra agents (`mitra-conversational`, `clause-classifier`,
> `case-brief-generator`), plus the 9-language Indic helpers and offline
> draft queue every NYM consumer app needs.

| | |
|---|---|
| Package | `@jurexio/nyayamitra-sdk` |
| Version | **5.0.0** (GA — 2026-07-05) |
| Pairs with | `@jurexio/client-sdk@^5.0.0` |
| Runtimes | Node.js ≥ 22, React Native, Web |

---

## Install

```bash
npm i @jurexio/nyayamitra-sdk @jurexio/client-sdk @jurexio/types
```

For a React Native consumer app, also install the RN wrapper to get secure
storage + native streaming:

```bash
npx expo install @jurexio/client-sdk-react-native
```

## Quickstart

```ts
import { NyayamitraClient } from '@jurexio/nyayamitra-sdk';

const nym = new NyayamitraClient({
  apiKey: process.env.NYM_API_KEY!,
  defaultLanguage: 'hi',
});

// 1. Conversational chat
const reply = await nym.chat({
  sessionId: 'sess_42',
  language: 'hi',
  message: 'मेरे मकान मालिक ने बिना नोटिस के किराया बढ़ा दिया है, क्या मैं कुछ कर सकता हूँ?',
});

// 2. Classify the clauses of a rent agreement
const review = await nym.classifyClauses({
  documentText: agreementText,
  documentType: 'rent-agreement',
  language: 'hi',
});

// 3. Build a case brief from a free-text narrative
const brief = await nym.generateCaseBrief({
  narrative: 'मेरी पत्नी ने झूठा 498A दर्ज कराया है…',
  language: 'hi',
});
```

## Indic helpers

```ts
import { detectLanguage, t, NYAYAMITRA_LANGUAGE_LIST } from '@jurexio/nyayamitra-sdk';

const lang = detectLanguage(userInput); // 'hi' | 'bn' | 'ta' | …
console.log(t('send', lang));           // localized "Send"
```

`NYAYAMITRA_LANGUAGE_LIST` is the canonical drop-down order used in the
official Nyayamitra app — use it to keep your language picker consistent.

## Offline drafts

```ts
import { OfflineDraftQueue } from '@jurexio/nyayamitra-sdk';
import AsyncStorage from '@react-native-async-storage/async-storage';

const queue = new OfflineDraftQueue({ store: AsyncStorage });

// Capture a draft while offline:
await queue.enqueue({ kind: 'chat', payload: chatRequest });

// When connectivity returns, replay through the gateway:
await queue.flush(async (env) => {
  if (env.draft.kind === 'chat') await nym.chat(env.draft.payload);
  // ... other kinds
});
```

The queue persists envelopes with a `v: 1` schema marker so future versions
of the SDK can migrate without losing user data.

## Documentation

- [v6 SDK API Reference](../../docs/v3.1.2/completed_docs/NYV-SDK-v6-API-REFERENCE.md)
- [Mobile Integration Guide](../../docs/v3.1.2/completed_docs/NYV-MOBILE-INTEGRATION-GUIDE.md)
- [Store-Submission Checklist](../../docs/v3.1.2/completed_docs/NYV-MOBILE-STORE-SUBMISSION-CHECKLIST.md)
- [Nyayamitra SDK final spec](../../docs/v3.1.2/completed_docs/NYAYAMITRA-SDK-FINAL.md)
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
