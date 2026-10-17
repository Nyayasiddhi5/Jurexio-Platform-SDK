---
status: completed
version: 3.1.2
superseded_by: null
last_verified: 2026-04-25
---
# Nyayavigya Mobile — Store Submission Checklist (iOS App Store + Google Play)

> Use this checklist for both the **NSP Mobile** and **Nyayamitra** apps.
> Tick every box before clicking "Submit for Review".

---

## A. Universal pre-flight

- [ ] App icon: 1024×1024 (iOS) and 512×512 (Play) — no transparency, no rounded corners.
- [ ] Splash screen renders without flicker on iOS dark mode and Android 12 splash API.
- [ ] All copy in the app is consistent with the store listing (name, description).
- [ ] No `console.log`, no debug toasts, no test API keys in the production build.
- [ ] `NyvClientRN` is created with the production `baseUrl` (no `localhost`).
- [ ] `nyv_live_sk_…` keys are never bundled. Keys are obtained at runtime via
      your auth flow and stored in secure storage.
- [ ] All third-party libraries appear in the **Open Source Notices** screen.
- [ ] Crash + analytics SDKs (Sentry / Firebase) initialised before first render.
- [ ] App version + build number bumped (`expo.version`, `ios.buildNumber`,
      `android.versionCode`).
- [ ] EAS build profile `production` has been built and smoke-tested on a real
      device for both iOS and Android.

## B. iOS App Store specifics

- [ ] **Bundle identifier** registered in Apple Developer portal.
- [ ] **App Store Connect** record created with category = `Reference` and
      sub-category = `Legal`.
- [ ] **Age rating**: 17+ ("Frequent/Intense Mature/Suggestive Themes" — legal
      content can include violence/sexual offences in case briefs).
- [ ] **Encryption export compliance**: declare uses of standard TLS only
      (no proprietary crypto). `ITSAppUsesNonExemptEncryption = false`.
- [ ] **Privacy nutrition labels** populated:
      - Data collected: contact info, usage data, diagnostics.
      - Data linked to user: account id, device id.
      - Tracking: NONE (we don't do cross-app tracking).
- [ ] **Privacy policy URL**: <https://nyayavigya.in/legal/privacy>
- [ ] **Support URL**: <https://nyayavigya.in/support>
- [ ] **Marketing URL** (optional): <https://nyayavigya.in/products/mobile>
- [ ] All `NS*UsageDescription` strings present in `app.json` `ios.infoPlist`:
      - `NSCameraUsageDescription`
      - `NSMicrophoneUsageDescription`
      - `NSPhotoLibraryUsageDescription`
      - `NSUserTrackingUsageDescription` only if you add an ATT prompt — we
        currently do NOT.
- [ ] Screenshots: 6.7", 6.5", 5.5" iPhone + 12.9" iPad — at least 3 each.
- [ ] App preview video (≤ 30s) optional but recommended for Nyayamitra.
- [ ] **Test account credentials** filled in App Review → Sign-in info.
      Provide a real `nyv_live_sk_test_*` key + sample case data.
- [ ] **Notes for the reviewer**: explain the legal-tech context, link to the
      v6 SDK API reference, mention the disclaimer string is shown on the
      home screen.
- [ ] **In-app disclaimer** visible on every screen ("Information only — not
      legal advice"). Use `t('disclaimerLegalNotLawyer', lang)` from
      `@nyayavigya/nyayamitra-sdk` — already wired in the sample.

## C. Google Play specifics

- [ ] **Package name** registered in Play Console.
- [ ] **App content questionnaire** completed:
      - Target age: 18+ (legal app)
      - Ads: NONE
      - In-app purchases: NONE (Nyayamitra) / per-tier subscription (NSP)
      - Data safety: Personal info, financial info (lawyer fees), App activity.
        All data is encrypted in transit; users can request deletion via the
        in-app **Data → Delete account** flow.
- [ ] **Content rating**: Mature 17+ via the IARC questionnaire.
- [ ] **Target API level** ≥ 34 (Android 14).
- [ ] `POST_NOTIFICATIONS` declared and runtime-requested before
      `registerForHITLPushNotifications`.
- [ ] `READ_MEDIA_IMAGES` (no longer `READ_EXTERNAL_STORAGE`) for Android 13+.
- [ ] Play Integrity API enabled — gate `setApiKey()` on a successful integrity
      check to prevent rooted-device key extraction.
- [ ] **Privacy policy URL** in Play Console.
- [ ] **Pre-launch report**: zero crashes, zero ANRs across the 12 reference
      devices (Pixel 6/7/8/Fold, Galaxy S22/S23/A14, OnePlus 11, Mi 13, Vivo X90,
      Samsung Tab S9).
- [ ] Bundle uploaded as `.aab`, signed with the upload key.
- [ ] Internal testing track: minimum 14 testers for 7 days (Play policy).

## D. Legal / regulatory

- [ ] **DPDPA 2023 compliance** (India): privacy policy mentions Significant
      Data Fiduciary obligations, DPO contact, grievance officer.
- [ ] **Bar Council of India** disclaimer present everywhere advice is shown.
      The app is a legal-information tool, not a lawyer.
- [ ] **Audit log retention**: 7 years per the Indian Evidence Act, 2023.
- [ ] **HITL escalation flow** tested end-to-end on the staging environment.

## E. Final pre-submission smoke test (device)

1. Fresh install. Permissions all denied initially.
2. Sign in → permissions prompt → grant camera + push.
3. Save key → kill app → reopen → still signed in.
4. CHAT → ask a Hindi question → reply received.
5. CLASSIFY (Nyayamitra) or DOC (NSP) → upload sample → results back.
6. Toggle airplane mode → send a message → "Saved offline" message shown.
7. Reconnect → flush queue → message delivered.
8. Trigger a HITL approval from the staging console → push arrives.
9. Sign out → API key removed from secure storage (verify via dev menu).

## F. Post-launch

- [ ] Monitor Sentry for first-week crash-free rate ≥ 99.5 %.
- [ ] Monitor `nyv_webhook_delivery_failures_total` — alert if > 1 % over 1h.
- [ ] Schedule a v1.0.x patch review at Day 14 to triage user feedback.
