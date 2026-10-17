# `nyayamitra-mobile` — Expo (React Native) sample for `@nyayavigya/nyayamitra-sdk@^1`

Citizen-facing legal-aid app. Hindi/Indic-first. Three flows:

| Tab     | What it shows |
|---|---|
| CHAT    | Conversational chat in any of 10 languages, auto-detected. |
| CLASSIFY| Paste a contract → per-clause risk + plain-language explanation. |
| BRIEF   | Free-text narrative → structured case brief + next steps. |

Includes:

- A horizontal language picker prefilled with all 10 supported scripts.
- An offline-draft queue (`OfflineDraftQueue` over `AsyncStorage`) — when the
  device goes offline, drafts are saved locally and the user sees a localised
  "Saved offline" message.
- Secure key storage via `@nyayavigya/client-sdk-react-native` (Keychain /
  Keystore through `expo-secure-store`).

## Run

```bash
npm install
npx expo start
```

Scan the QR code with Expo Go.

## Manual smoke test

1. Paste a real `nyv_live_sk_…` key on first launch.
2. CHAT tab → tap a Hindi chip → type "मेरा मकान मालिक…" → **send** → reply in Hindi.
3. Toggle airplane mode on → type a message → **send** → see the
   "Saved offline" reply (queued locally).
4. Toggle airplane mode off → switch to **CLASSIFY**, paste any contract text,
   hit **send** → see structured per-clause output JSON.
5. **BRIEF** tab → paste a short narrative → see a JSON brief with
   `applicableLaws` + `nextSteps`.

## Replaying the offline queue

The sample doesn't auto-flush on reconnect to keep the demo simple — wire
`OfflineDraftQueue.flush(dispatcher)` in your real app on
`NetInfo.addEventListener`. Example:

```ts
NetInfo.addEventListener(s => {
  if (s.isConnected) queue.flush(async (env) => {
    if (env.draft.kind === 'chat')       await nym.chat(env.draft.payload);
    if (env.draft.kind === 'classify')   await nym.classifyClauses(env.draft.payload);
    if (env.draft.kind === 'case-brief') await nym.generateCaseBrief(env.draft.payload);
  });
});
```

## Store submission

See [`docs/v3.1.2/completed_docs/NYV-MOBILE-STORE-SUBMISSION-CHECKLIST.md`](../../docs/v3.1.2/completed_docs/NYV-MOBILE-STORE-SUBMISSION-CHECKLIST.md).
