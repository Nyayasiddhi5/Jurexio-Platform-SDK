---
status: completed
version: 3.1.2
superseded_by: null
last_verified: 2026-04-25
---
# Nyayavigya — Mobile Integration Guide (React Native + Expo)

> Audience: mobile engineers shipping Nyayasiddhi (NSP) or Nyayamitra (NYM)
> on iOS / Android. Web readers should read
> [`NYV-SDK-v6-INTEGRATION-GUIDE.md`](./NYV-SDK-v6-INTEGRATION-GUIDE.md) first.

---

## 1. Pick a stack

| You are building | Use |
|---|---|
| The **Nyayasiddhi** consumer/professional app    | `@nyayavigya/client-sdk-react-native` |
| The **Nyayamitra** citizen legal-aid app          | `@nyayavigya/nyayamitra-sdk` (which composes the RN wrapper) |
| A **bare RN** app you maintain yourself           | Either of the above + your own permission shims |

All three target Expo SDK 50+ and React Native 0.74+.

## 2. Install

```bash
npx expo install \
  @nyayavigya/client-sdk \
  @nyayavigya/client-sdk-react-native \
  @nyayavigya/nyayamitra-sdk \
  @nyayavigya/types

# Native modules — install only what you need:
npx expo install expo-secure-store expo-camera expo-av expo-image-picker \
                 expo-notifications react-native-sse \
                 @react-native-async-storage/async-storage \
                 @react-native-community/netinfo
```

> Every native module is **peer-optional**. The SDK falls back gracefully and
> tells you which module to install if you call something that needs it.

## 3. Wire the client at app startup

```tsx
import { NyvClientRN, requestStandardSdkPermissions } from '@nyayavigya/client-sdk-react-native';

let nyv: NyvClientRN;

export async function bootstrap() {
  nyv = await NyvClientRN.create({ baseUrl: 'https://api.nyayavigya.com' });
  // Restore happens automatically — getApiKey() returns null on first launch.
  if (!nyv.getApiKey()) {
    // Show your sign-in screen, then call:
    // await nyv.setApiKey(keyFromYourAuthFlow);
  }
  // Ask once, after sign-in:
  await requestStandardSdkPermissions();
}
```

## 4. Permissions (Info.plist + AndroidManifest)

The RN wrapper does NOT mutate your `app.json` / `Info.plist`. You must add
the usage strings yourself or your app will be rejected at submission.

### iOS — `app.json`

```json
{
  "expo": {
    "ios": {
      "infoPlist": {
        "NSCameraUsageDescription":      "Used to scan legal documents for OCR.",
        "NSMicrophoneUsageDescription":  "Used to record voice queries.",
        "NSPhotoLibraryUsageDescription":"Used to attach existing PDFs."
      }
    }
  }
}
```

### Android — `app.json`

```json
{
  "expo": {
    "android": {
      "permissions": ["CAMERA", "RECORD_AUDIO", "READ_MEDIA_IMAGES", "POST_NOTIFICATIONS"]
    }
  }
}
```

## 5. Streaming on mobile

```tsx
await nyv.stream.streamPattern('cot', { task: '...' }, {
  onTextDelta: (delta) => setBuffer(b => b + delta),
});
```

The wrapper uses `react-native-sse` if installed, otherwise falls back to the
gateway's `?stream=poll` NDJSON endpoint. Both paths emit the same handler
contract — application code does not need to branch.

## 6. HITL push notifications

When a Human-In-The-Loop reviewer responds to one of your orchestrations, the
gateway pushes a notification to the device. Register the token after sign-in:

```tsx
const reg = await nyv.registerForHITL({
  onHITL: (payload) => showApprovalToast(payload),
});
if (!reg.registered) {
  console.warn('HITL registration failed:', reg.reason);
}
```

The wrapper persists incoming HITL payloads to a secure inbox under the
`hitlInbox` storage key — they survive app restart and you can read them with
`nyv.storage.getItem('hitlInbox')` to render an "Inbox" tab.

## 7. Offline drafts (Nyayamitra)

```tsx
import { OfflineDraftQueue } from '@nyayavigya/nyayamitra-sdk';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';

const queue = new OfflineDraftQueue({ store: AsyncStorage });

NetInfo.addEventListener(s => {
  if (s.isConnected) queue.flush(async (env) => {
    if (env.draft.kind === 'chat')       await nym.chat(env.draft.payload);
    if (env.draft.kind === 'classify')   await nym.classifyClauses(env.draft.payload);
    if (env.draft.kind === 'case-brief') await nym.generateCaseBrief(env.draft.payload);
  });
});
```

## 8. Indic UX defaults

```tsx
import { detectLanguage, NYAYAMITRA_LANGUAGE_LIST, t, isRTL } from '@nyayavigya/nyayamitra-sdk';

const lang = detectLanguage(userText);              // 'hi' | 'bn' | 'ta' | …
const writingDirection = isRTL(lang) ? 'rtl' : 'ltr';
console.log(t('send', lang));                       // localised "Send"
```

Use `NYAYAMITRA_LANGUAGE_LIST` as the source of truth for your language picker
order — it matches the official Nyayamitra app.

## 9. Network and SSE on Android Hermes

Hermes still has occasional issues with long-lived `fetch` streams on certain
devices. The wrapper detects this via `react-native-sse` presence and falls
back to long-poll NDJSON. If you ship without `react-native-sse`, set
`{ forcePoll: true }` in your stream options to silence the auto-detect.

## 10. Build and submit

See [`NYV-MOBILE-STORE-SUBMISSION-CHECKLIST.md`](./NYV-MOBILE-STORE-SUBMISSION-CHECKLIST.md).

```bash
npx eas build --platform ios --profile production
npx eas build --platform android --profile production
npx eas submit --platform ios
npx eas submit --platform android
```

## 11. Common pitfalls

- **"No secure storage backend installed"** — install `expo-secure-store` (or
  pass `{ allowInsecureStorage: true }` to `NyvClientRN.create` for dev only).
- **`expo-notifications` MODULE_NOT_FOUND** — push registration silently
  returns `{ registered: false, reason: 'module-missing' }`. Render a banner
  to the user instead of crashing.
- **iOS background SSE drops at app suspend** — by design. Re-establish on
  `AppState.addEventListener('change', s => s === 'active' && reconnect())`.
- **Webhook never fires on mobile** — webhooks go to your *server*, not the
  device. Use HITL push for device delivery.
