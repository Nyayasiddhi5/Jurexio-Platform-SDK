# NSP Team Release Package & Handoff — 2026-05-12

> **One-page entry point for the NSP integration team.** All links resolve to docs already in the repo.
> SDK keys are referenced **by environment-variable name only** — never copy the live secret into a doc.

## TL;DR

The Nyayavigya gateway is **ready for NSP integration testing** against the EC2 prod-dev sandbox at `https://api.nyayasiddhi.online`. Rate limits are lifted to "internal" tier for the testing window (canonical 12 § 2). Production cutover is gated on the 10-item checklist in `docs/canonical/13-prod-cutover-plan-2026-05-12.md`. **GO verdict: GREEN for dev/UAT integration; NO-GO for customer-facing production traffic until the cutover plan clears.**

---

## 1. Live URLs

| Surface | URL | Notes |
|---|---|---|
| **API gateway (canonical)** | `https://api.nyayasiddhi.online` | All `/api/nv/*` mounts |
| **Console (web)** | `https://console.nyayasiddhi.online` | RBAC + AI-ops + SDK key mgmt |
| **NYM citizen surface** | `https://nym.nyayasiddhi.online` | Same gateway, NYM-scoped key |
| **Wildcard** | `*.nyayasiddhi.online` | Resolves via wildcard A → ALB → gateway. NSP team can override with a host-specific record when their dedicated EC2 is ready. |
| Replit dev gateway (internal) | port 5000 via the `NYV Gateway` workflow | Used for pre-prod regression |
| Replit dev console (internal) | port 3004 via the `NYV Console` workflow | UI dev iteration |

Verbatim probes (2026-05-11T06:08Z, see EC2-INTEGRATION-STATUS § B):
```
https://nyayasiddhi.online/             → 200
https://www.nyayasiddhi.online/         → 200
https://console.nyayasiddhi.online/     → 200
https://api.nyayasiddhi.online/         → 200
https://nym.nyayasiddhi.online/         → 200
```

---

## 2. SDK keys (7) — env-var names only

| Platform | Env var | Tier (dev) | Tier (prod-target) | Integration guide |
|---|---|---|---|---|
| NSP — Nyayasiddhi Professional (web) | `NYV_SDK_KEY_NSP` | internal | pro | [`docs/integration-guides/nsp-web.md`](./nsp-web.md) |
| NSPM — NSP Mobile | `NYV_SDK_KEY_NSPM` | internal | pro | [`docs/integration-guides/nsp-mobile.md`](./nsp-mobile.md) |
| NYM — Nyayamitra (citizens) | `NYV_SDK_KEY_NYM` | internal | citizen | [`docs/integration-guides/nym.md`](./nym.md) |
| NSI — Nyayasiddhi Institutional | `NYV_SDK_KEY_NSI` | internal | enterprise | [`docs/integration-guides/nsi.md`](./nsi.md) |
| NSA — Nyayasiddhi Academy | `NYV_SDK_KEY_NSA` | internal | plus | [`docs/integration-guides/nsa.md`](./nsa.md) |
| NSM — Nyayasiddhi Ministry | `NYV_SDK_KEY_NSM` | internal | government | [`docs/integration-guides/nsm.md`](./nsm.md) |
| JRX — Jurix (judicial) | `NYV_SDK_KEY_JRX` | internal | enterprise | [`docs/integration-guides/jrx.md`](./jrx.md) |

Canonical auth header — **`X-API-Key`** with `Authorization: Bearer <key>` fallback (NV-AUTH-HEADER-001). East-west `X-NV-API-Key` is reserved for inter-service auth — partners do not use it.

The 7 plain-text key values live in:
- Replit Secrets (this workspace) — already wired into the workflows
- `/opt/Nyayavigya/secrets/.env.production` on EC2 (not shipped via the deploy tarball — overlaid post-extract by `scripts/deploy-replit-ssm.sh`)

Retrieve a partner key only via the Console (`/sdk-key-management` page, requires admin JWT) or by reading the Replit/EC2 secrets file directly with appropriate access. Never paste a key value into chat, ticket, doc, or commit message.

A separate **demo console password** is pinned across 9 demo accounts for the dev/UAT testing window (see `EC2-INTEGRATION-STATUS.md` § F/G — value lives in `/opt/Nyayavigya/secrets/.env.production` on EC2, not in this doc). Do not rotate until end-to-end demo testing is signed off.

---

### 2.1 First-15-minutes smoke checklist (expected status codes)

Run these in order with your NSP env-var key. All should return the listed status; if any deviate, jump to § 7 "If it breaks".

| # | Command | Expected |
|---|---|---|
| 1 | `curl -o /dev/null -w '%{http_code}\n' https://api.nyayasiddhi.online/health` | `200` |
| 2 | `curl -o /dev/null -w '%{http_code}\n' -H "X-API-Key: $NYV_SDK_KEY_NSP" https://api.nyayasiddhi.online/api/nv/gateway/health` | `200` |
| 3 | `curl -o /dev/null -w '%{http_code}\n' -H "X-API-Key: $NYV_SDK_KEY_NSP" https://api.nyayasiddhi.online/api/nv/gateway/agents` | `200` (148 IN agents) |
| 4 | `curl -o /dev/null -w '%{http_code}\n' -H "X-API-Key: $NYV_SDK_KEY_NSP" https://api.nyayasiddhi.online/api/nv/gateway/practice-areas` | `200` |
| 5 | `curl -o /dev/null -w '%{http_code}\n' -X POST -H "X-API-Key: $NYV_SDK_KEY_NSP" -H "Content-Type: application/json" -d '{"tier":"professional","jurisdiction":"IN","taskKind":"research"}' https://api.nyayasiddhi.online/api/nv/v1/sdk/llm/router/explain` | `200` (no LLM call) |
| 6 | `curl -o /dev/null -w '%{http_code}\n' -X POST -H "X-API-Key: $NYV_SDK_KEY_NSP" -H "Content-Type: application/json" -d '{"task":"What is the doctrine of basic structure?","jurisdiction":"IN","tier":"professional"}' https://api.nyayasiddhi.online/api/nv/orchestrate` | `200` in 5–12 s (real LLM) |
| 7 | `curl -o /dev/null -w '%{http_code}\n' -H "X-API-Key: $NYV_SDK_KEY_NSP" https://api.nyayasiddhi.online/api/nv/gateway/usage` | `403` until cutover §8 expands key scopes — non-blocker for integration. |

If 1–6 are green you are integration-ready. Item 7 (403) is a known scope gap tracked in cutover-plan §8.

---

## 3. Postman + OpenAPI

| Asset | Path | Op count |
|---|---|---|
| Postman collection | `docs/postman/nyayavigya-v5.postman_collection.json` | matches OpenAPI |
| OpenAPI snapshot (frozen by NV-API-CONTRACT-001) | `docs/openapi/nyayavigya-v5.openapi.json` | 1242 ops (post Task #154) |

**Stable download URL** (Console-served, requires admin JWT — same as `/sdk-key-management`):
- Postman: `https://console.nyayasiddhi.online/downloads/postman/nyayavigya-v5.postman_collection.json`
- OpenAPI: `https://console.nyayasiddhi.online/downloads/openapi/nyayavigya-v5.openapi.json`

(If the Console download endpoints are not yet enabled in your environment, fall back to the repo paths above — they are the source of truth and are tagged at every cutover SHA.)

To import into Postman: File → Import → drag `nyayavigya-v5.postman_collection.json`. Set the collection-level variable `apiKey` to your NSP env var value and `baseUrl` to `https://api.nyayasiddhi.online`. Newman validation: `npx newman run docs/postman/nyayavigya-v5.postman_collection.json --env-var apiKey=$NYV_SDK_KEY_NSP --env-var baseUrl=https://api.nyayasiddhi.online --folder "Smoke"`.

Re-export procedure (after any additive route change):
```bash
npx tsx scripts/generate-openapi-spec.ts && npm run guardrail:api-contract
```
The contract guardrail allows additions; removals or method changes fail CI by design (would break SDK clients pinned to v5.0.0).

---

## 4. Integration guides (one per partner platform)

All seven guides follow the same § 5 "Comprehensive AI request/response" format with a working `curl`, the canonical `NvResponse` envelope, and a `router/explain` predict-call.

| Guide | Audience |
|---|---|
| [`nsp-web.md`](./nsp-web.md) | Browser-based law-firm workspace |
| [`nsp-mobile.md`](./nsp-mobile.md) | iOS/Android law-firm app |
| [`nym.md`](./nym.md) | Citizen-facing (Indic languages, plain-language Q&A) |
| [`nsi.md`](./nsi.md) | Enterprise / in-house counsel teams |
| [`nsa.md`](./nsa.md) | Law schools / coaching academies / CLE |
| [`nsm.md`](./nsm.md) | Government ministries / regulators (sovereign-only routing supported) |
| [`jrx.md`](./jrx.md) | Court tech / judicial registries (citation verification first-class) |

---

## 5. GO verdict (2026-05-12)

**GREEN for dev/UAT integration testing against `api.nyayasiddhi.online`.**

| Check | Status |
|---|---|
| Gateway healthy on EC2 prod-dev | ✅ deploy `2026-05-11T0436Z-replit-ssm-95d08687` |
| All 7 SDK keys auth | ✅ verified per EC2-INTEGRATION-STATUS § C |
| Rate limits lifted for ecosystem | ✅ canonical 12 § 2 |
| OpenAPI v5 frozen + Postman synced | ✅ NV-API-CONTRACT-001 |
| 7 integration guides shipped | ✅ § 4 above |
| Canonical SDK auth header uniform | ✅ NV-AUTH-HEADER-001 (CI-enforced) |
| Audit-chain UI + endpoint live | ✅ Console `/audit-chain` + `GET /api/nv/audit/chain` |

**NO-GO for production cutover until the 10-item plan in `docs/canonical/13-prod-cutover-plan-2026-05-12.md` clears.** Hard gates: deep-AI 70/70 UAT, EC2 catch-up redeploy of Task #154 routing fix, rate-limit revert, auth-lifetime tighten, SDK scope expansion, Postman+OpenAPI re-tag at the cutover SHA.

Realistic earliest cutover window: **4 working days from explicit user GO**, assuming OCR adapter, jurisdictional templates, and TS-errors cleanup are deferred.

---

## 6. Cutover checklist (summary — full version in canonical 13)

1. Revert rate-limit lift (`config/rate-limits/rate-limits.json` `_prod_tier` → `tier`).
2. Tighten auth lifetimes (24h/90d → 4h/30d in `SECURITY_CONFIG.session`).
3. Redeploy EC2 to ship Task #154 INDIC_LEGAL routing fix.
4. Run full UAT 70/70 at concurrency=4; gate at ≥95%.
5. Wire OCR adapter (`POST /api/nv5/doc-ai/ocr`).
6. Add UK/US/EU/GCC/SG document-template libraries.
7. Flip `NYV_F_GOV_MAKER_CHECKER=true`.
8. Expand SDK key scopes (`usage:read`, `cache:read`, `guardrails:read`).
9. Clean pre-existing TS errors (unblocks combined `npm run guardrail`).
10. Re-export Postman + OpenAPI at the cutover SHA; tag CHANGELOG.

Each item carries owner + ETA + verification command in the canonical doc.

---

## 7. "If it breaks" runbook

| Symptom | First check | Recovery |
|---|---|---|
| `https://api.nyayasiddhi.online/` returns 502 | `docker logs nyv-gateway --tail 60` (via SSM) | Re-attach gateway to legacy network: `docker network connect nyayavigya-platform-312_nyv-net nyv-gateway` (note the spelling — `nya...` not `naya...`). Persistence: `sudo bash /opt/nyayavigya/scripts/nv-bridge-systemd-install.sh`. Full timeline: canonical 09 Appendix D. |
| Auth returns 401 with valid key | Confirm header is `X-API-Key` (not `X-NV-API-Key` — that's east-west only) | Check `sdk_app_api_keys` row exists for the key prefix. The 2026-05-02 `…3fa6` / `…b747` keys do NOT exist on the live RDS — only the `…tUfo` and `…4fd3` rows (EC2-INTEGRATION-STATUS § D). |
| Auth returns 403 `Insufficient scope. Required: usage:read` | Check `sdk_app_api_keys.scopes` jsonb | Cutover §8 expands these scopes; until then `/usage`, `/cache/stats`, `/guardrails/stats` are 403 for the Practice-app key. |
| LLM call times out at 60s | nginx upstream timeout was 60s → bumped to 180s on 2026-05-09 (NV-EC2-NGINX-001) | If reverted: `aws elbv2 modify-load-balancer-attributes --load-balancer-arn <arn> --attributes Key=idle_timeout.timeout_seconds,Value=180` + nginx `proxy_read_timeout 180s` reload. |
| Refresh-token rotation 401s every legit refresh | Likely regression of NV-AUTH-FIX-2026-05-10 — `String(stored.user_id) !== String(userId)` and `FROM nv_users` (not `users`) | Re-apply patch in `src/middleware/nv-auth.ts:rotateRefreshToken`. 8-step NS-3 curl harness verifies. |
| `npm run guardrail` fails on `auth-header` | Someone introduced a new accepted SDK header outside the canonical file | Re-import `extractSdkApiKey` from `src/middleware/nv-sdk-auth-header.ts`; do NOT roll a local `extractApiKey()`. NV-AUTH-HEADER-001 is CI-enforced. |
| Standalone script writes silently dropped | `@neondatabase/serverless` HTTP driver returns `rowCount=0` against non-Neon hosts | Use `makePgSql()` from `scripts/_pg-pool.ts`. NV-DB-SCRIPT-001 is CI-enforced. |
| Need to roll back EC2 in <30s | See canonical 13 § "Rollback recipe" | `docker tag …:rollback-pre-cutover-<TS> …:latest && docker stop+rm nyv-gateway && docker compose up -d --no-deps gateway && docker network connect …` |

For anything else: `docs/canonical/04c-sdk-troubleshooting-2026-05-11.md` is the per-endpoint troubleshooting bible (395 lines).

---

## 8. Kickoff template (paste into email or Slack)

```
Subject: Nyayavigya gateway — NSP integration kickoff

Team,

The Nyayavigya unified API gateway is ready for NSP integration testing against the EC2 prod-dev sandbox at https://api.nyayasiddhi.online.

Quick start (5 min):
  1. Read: docs/integration-guides/nsp-handoff-2026-05-12.md (this doc)
  2. Read: docs/integration-guides/nsp-web.md (or your platform's guide from § 4)
  3. Import: docs/postman/nyayavigya-v5.postman_collection.json (set apiKey + baseUrl)
  4. Smoke: curl -H "X-API-Key: $NYV_SDK_KEY_NSP" https://api.nyayasiddhi.online/api/nv/gateway/health

Best-quality AI call template:
  curl -X POST https://api.nyayasiddhi.online/api/nv/orchestrate \
    -H "X-API-Key: $NYV_SDK_KEY_NSP" \
    -H "Content-Type: application/json" \
    -d '{ "task":"<your prompt>", "jurisdiction":"IN", "tier":"professional",
          "preferences":{ "requireReasoning":true, "requireCitations":true } }'

What you get during the testing window:
  - Unrestricted throughput (rate limits lifted to "internal" tier per canonical 12 § 2)
  - 6 LLM providers active in dev (anthropic / openai / google / openrouter / sarvam / bedrock); 7 more registered (silent-skip when key missing). Best-quality routing via cost-aware-router.
  - Full safety ring (PII redaction, hallucination check, citation check, audit chain)
  - 1242 OpenAPI operations, frozen by NV-API-CONTRACT-001 (additive only)

What's gated until production cutover:
  - Production rate limits will be re-applied
  - Auth-token lifetimes will tighten (24h/90d → 4h/30d)
  - 10-item cutover plan: docs/canonical/13-prod-cutover-plan-2026-05-12.md

If something breaks: § 7 of the handoff doc has the per-symptom runbook.

Owner: Nyayavigya Platform Team (rotating on-call — see `#nyv-platform-oncall` Slack topic for current name)
Slack channel: #nyv-integration-nsp (cross-posted to #nyv-platform-oncall for incidents)
Issue tracker: GitHub Issues on the `nyayavigya-platform-312` repo with label `nsp-integration` (replace with your org's tracker URL before forwarding if you re-route via Linear/Jira)

— Platform team
```

---

## 9. References

- Canonical platform status: `docs/canonical/12-platform-status-and-readiness-2026-05-11.md`
- Production cutover plan: `docs/canonical/13-prod-cutover-plan-2026-05-12.md`
- API + route table: `docs/canonical/04-sdk-and-api-canonical-2026-05-07.md`
- Troubleshooting: `docs/canonical/04c-sdk-troubleshooting-2026-05-11.md`
- UAT + compliance: `docs/canonical/09-uat-and-compliance-2026-05-08.md` (Appendix F = Task #154 INDIC_LEGAL routing fix)
- EC2 + DNS reality: `docs/canonical/EC2-INTEGRATION-STATUS.md`
- Deploy script: `scripts/deploy-replit-ssm.sh`
- Replit-side Session-15 entrypoint: `replit.md`
