# `nsp-mobile` — Expo (React Native) sample for `@nyayavigya/client-sdk-react-native@^1`

A minimal Expo app demonstrating the four standard NSP flows on mobile:

| Tab | What it shows |
|---|---|
| CHAT  | NyayaRAG `ask()` over the v6 SDK. |
| DOC   | Pick an image from the library and POST it to `/documents/ocr`. |
| VOICE | Sarvam Hindi text-to-speech. |
| INTEL | Precedent search via `nyv.intelligence.findPrecedents(query, 'IN', { topK })`. |

The API key is stored in **secure storage** (Keychain / Keystore via
`expo-secure-store`) and survives app restarts.

## Run

```bash
npm install
npx expo prebuild   # only needed for bare-RN builds
npx expo start
```

…then scan the QR code with the Expo Go app, or press `i`/`a` for simulator.

On first launch the app asks for your `nyv_live_sk_…` key. After saving, it
prompts for camera, microphone, photo-library, and push-notification
permissions in one go.

## Manual smoke test

1. Paste a real `nyv_live_sk_…` key in the input → tap **Save key**.
2. Verify the storage backend printed below the input is `expo-secure-store`.
3. CHAT tab → tap **Ask** → see a non-empty answer come back.
4. VOICE tab → tap **Synthesize** → see a non-empty JSON response.
5. INTEL tab → tap **Search** → see a precedent list.
6. Force-close the app and re-open — the key is still present (no input shown).
7. Tap **Sign out** at the bottom → app returns to the key-input screen.

## Store submission

See [`docs/v3.1.2/completed_docs/JRX-MOBILE-STORE-SUBMISSION-CHECKLIST.md`](../../docs/v3.1.2/completed_docs/JRX-MOBILE-STORE-SUBMISSION-CHECKLIST.md)
for the full Play Store / App Store submission walk-through (icons, splash,
permission strings, age rating, content rating questionnaire, data-safety
section, privacy URL, etc).
