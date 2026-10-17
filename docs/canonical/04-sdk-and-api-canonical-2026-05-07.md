# 04 — SDK & API Canonical (cross-platform) — 2026-05-07

> **What changed (Session-12, 2026-05-10).** Added §§ 11–13b covering the
> `/api/nv5/orch/*`, `/api/nv5/multimodal/*`, `/api/nv5/voice/*`,
> `/api/nv5/workflows/*`, and `/api/nv5/doc-ai/*` Batch A–C namespaces in
> the same request/response/auth/flag table format used by §§ 14–17.
> Together with §§ 14 (gov), 15 (legal-pipeline), 16 (compliance), 17
> (internal) the doc now enumerates **every wired Batch A–J mount**.
> Companion: `11-agentic-architecture-2026-05-10.md` walks one
> end-to-end safety-ring trace per batch.

**Status:** AUTHORITATIVE. Supersedes
- `docs/v3.1.2/SDK-ENDPOINTS-CANONICAL-2026-05-06.md`
- `docs/v3.1.2/SDK-ENDPOINTS-CANONICAL-2026-05-05.md`
- `docs/v3.1.2/NYV-SDK-API-INTEGRATION-GUIDE-2026-05-04.md`
- `docs/v3.1.2/SDK-PLATFORM-{NSP,NSPM,NSI,NSA,NSM,NYM,JRX}.md`
- All other dated SDK/API docs.

Old docs to be moved to `archive/sdk-api-pre-2026-05-07/` per T5 step 1.
Until that move executes (deferred to a maintenance task), this doc takes
precedence wherever it disagrees.

**Source of truth precedence (highest → lowest):**
1. `sdk_app_api_keys.scopes` row in DB (per replit.md "SDK key scopes" gotcha).
2. This doc.
3. The archived per-platform specs.

---

## 1. The 7 Nyayasiddhi ecosystem platforms

| Code | Product                          | Audience                  | DB scopes (verified 2026-05-07T16:25Z, Neon live query) |
|------|----------------------------------|---------------------------|---------------------------------------------------------|
| NSP  | Nyayasiddhi Professional™        | Law firms                 | `agents:read`, `agents:execute`, `documents:read`, `documents:write`, `research:read`, `usage:read` |
| NSPM | Nyayasiddhi Professional Mobile™ | Law-firm mobile           | `agents:read`, `agents:execute`, `documents:read`, `documents:write`, `research:read`, `usage:read`, `voice:read`, `voice:execute` |
| NSI  | Nyayasiddhi Institutional™       | Enterprise legal depts    | `*` (wildcard)                                          |
| NSM  | Nyayasiddhi Ministry™            | Government agencies       | `*` (wildcard)                                          |
| NSA  | Nyayasiddhi Academy™             | Legal-education orgs      | `agents:read`, `agents:execute`, `documents:read`, `research:read`, `translate:write`, `usage:read` (**NO `documents:write`** — by design, NSA is read-only on documents per the academic-corpus model) |
| NYM  | Nyayamitra™ Citizen App          | Citizens / consumer aid   | `agents:read`, `agents:execute`, `documents:read`, `documents:write`, `translate:write`, `consumer_intake:write`, `usage:read` (**NO `research:read`** — citizens go through consumer-intake, not raw research) |
| JRX  | JurisX™                          | Cross-jurisdiction tools  | `*` (wildcard)                                          |

> **🔁 task-150 (2026-05-11) — Demo SDK-key bundle refresh.** A single one-shot script `scripts/nv-refresh-demo-sdk-bundle.ts` (npm: `npm run seed:sdk-bundle`) now mints fresh raw keys for all 7 platforms, upserts them into `public.sdk_app_api_keys` with the granular scopes above (NYM picked up `usage:read` so `/usage`, `/cache/stats`, `/guardrails/stats` all return 200), deactivates prior active keys for the same app (rotation, never delete), and emits a single canonical bundle handout to `.local/run/sdk-bundle-demo-<env>-<ts>.{json,txt}` (mode 0600). This supersedes the legacy split workflow (`nv-seed-sdk-keys.ts` → `nv-issue-extra-sdk-keys.ts` → `nv-mirror-sdk-keys-to-canonical.ts` via `.local/secrets-pending.json`); keep the legacy chain only for historical reference. **Stale file**: `/opt/Nyayavigya/secrets/sdk-keys-2026-05-02.txt` on EC2 lists key prefixes (`…3fa6`, `…b747`) that were never seeded on RDS — treat as ARCHIVED and prefer the bundle file. EC2 execution path: `docker exec nyv-gateway sh -c 'cd /app && NYV_PLATFORM_ENV=production npx tsx /app/scripts/nv-refresh-demo-sdk-bundle.ts'`, then copy plain-text keys into AWS SSM `/nyv/prod/NYV_SDK_KEY_<PLAT>` (SecureString) and `/opt/Nyayavigya/secrets/.env.production`, then `rm` the stale txt file in the same SSM session.

> **⚠️ DB SCOPE STATE — re-verified 2026-05-09T11:30Z (`NYV-SDK-SCOPE-DRIFT-001`):** The Replit Postgres `sdk_app_api_keys.scopes` column currently shows **`["*"]` wildcard for ALL 7 platform keys**, not the granular scopes in the table above. Per the `replit.md` "SDK key scopes" gotcha, **DB wins over any spec/doc**. Therefore today every key passes every scope check (NYM `/research/query`, NSA `/docs-pipeline/parse`, etc.) all return 200. The granular table above is the **intended target state** documented for security posture, not the live state. To bring DB and doc back into agreement, run: `UPDATE sdk_app_api_keys SET scopes = '<granular>'::jsonb WHERE name LIKE '<plat>%';` per platform — see Appendix Z.6 for the practical implication for downstream integrators.

**Note on NSA + NYM (Q1 closed 2026-05-07T16:25Z, superseded by drift note above):** the granular scopes were the originally provisioned values. NSA is intended **read-only on documents** (no `documents:write`); NYM intended docs read+write but **no `research:read`**. The wildcard state is operationally permissive — restore granular grants before any external production audit.

## 2. Auth model

| Surface                  | Header                       | Purpose                                |
|--------------------------|------------------------------|----------------------------------------|
| `/api/nv/sdk/*`          | `X-API-Key: nyv_*`           | Per-platform SDK key (DB scope-gated)  |
| `/api/nv/gateway/*`      | `X-API-Key: nyv_*`           | Per-platform SDK key (DB scope-gated)  |
| `/api/nv/orchestrate`    | `Authorization: Bearer <JWT>`| Console / first-party UI               |
| `/api/nv/admin/*`        | `Authorization: Bearer <JWT>`| Admin console                          |
| _internal east-west_     | `X-NV-API-Key: <key>`        | Inter-service traffic ONLY (nv-inter-service-auth) |
| Public health/voice info | _none_                       | Open                                   |

**Canonical (NV-AUTH-HEADER-001, CI-enforced 2026-05-10):** every SDK auth path uses `extractSdkApiKey` from `src/middleware/nv-sdk-auth-header.ts`. Accepted: `X-API-Key: <key>` primary, `Authorization: Bearer <key>` fallback. No other header names (`X-NV-SDK-Key`, `X-SDK-Key`, `X-NYV-Key`, `X-Platform-Key`) are accepted; introducing one fails `npm run guardrail:auth-header`.

## 3. The safety ring (NV-ARCH-001) every SDK call traverses

```
tenant isolation → guardrails → Queen orchestration (multi-agent)
  OR callNyayavigya (single-agent)
→ agent allocation (BM25 over 1042 agents × 6 jurisdictions × 22 patterns × 107 swarms)
→ 22-section Parlant prompt
→ 5-tier memory + multi-tier RAG (statute / case / template / private) + GraphRAG
→ CoT / ReAct / ToT reasoning
→ NV-ROUTER-001 (intelligent-router/orchestrateLLM) for cost-optimal LLM pick
→ response engineering
→ hallucination + citation + safety + HITL gate
→ audit hash chain
→ streaming
```

`NV-LLM-001` keeps `realLLMService.executeRequest` to a single ring with a
7-file whitelist (see `replit.md`). Bypass = CI fail.

## 4. Endpoint families (verified Replit-dev 2026-05-07)

Source: `scripts/nv-smoke-all-platforms.ts` ledger
`audit/smoke-all-platforms-2026-05-07T09-42-09-175Z.json`
(102 PASS / 0 FAIL / 0 SKIP, 84 of 102 captured an envelope).

### 4.1 Public (no auth)

| Method | Path                       | Purpose                       |
|--------|----------------------------|-------------------------------|
| GET    | `/health`                  | Process liveness              |
| GET    | `/api/nv/health`           | API health                    |
| GET    | `/api/nv/health/full`      | Deep health (200 OR 503)      |
| GET    | `/api/nv/voice/info`       | Sarvam voice availability     |

### 4.2 Provision / validate

| Method | Path                                    | Auth      | Notes                          |
|--------|-----------------------------------------|-----------|--------------------------------|
| POST   | `/api/nv/sdk/provision/validate`        | body key  | NYV-PROV-VAL-DEFENSIVE-001     |
| POST   | `/api/nv/sdk/provision/health`          | X-API-Key | per-key health                 |

### 4.3 Gateway — common SDK-key surface (all 7 platforms)

| Method | Path                                       | Scope            |
|--------|--------------------------------------------|------------------|
| GET    | `/api/nv/gateway/health`                   | any valid key    |
| GET    | `/api/nv/gateway/agents`                   | any valid key    |
| GET    | `/api/nv/gateway/translate/languages`      | any valid key    |
| POST   | `/api/nv/gateway/translate`                | any valid key    |
| GET    | `/api/nv/gateway/usage`                    | any valid key    |
| GET    | `/api/nv/sdk/multimodal/multimodal/capabilities` | any valid key |
| POST   | `/api/nv/gateway/research/query`           | `research:read` (NSP/NSPM/NSI/NSM/NSA/JRX) — NYM 403 |

### 4.4 Document AI (`docs:*` or `documents:read` scope)

| Method | Path                                                | Open to                           |
|--------|-----------------------------------------------------|-----------------------------------|
| GET    | `/api/nv/sdk/docs-pipeline/clauses/library`         | NSP NSPM NSI NSM JRX NSA NYM      |
| GET    | `/api/nv/sdk/docs-pipeline/documents/templates`     | same set                          |
| POST   | `/api/nv/sdk/docs-pipeline/documents/intelligence`  | same set (200 or 400 on bad body) |

### 4.5 Enterprise research (wildcard scope)

| Method | Path                                             | Open to    |
|--------|--------------------------------------------------|------------|
| POST   | `/api/nv/sdk/enterprise/research/domain/legal`   | NSI NSM JRX (others 403) |

### 4.6 Negative-path enforcement (NYV-NS-012/013/015)

`401` on missing key / JWT for: `/api/nv/gateway/health`,
`/api/nv/gateway/agents`, `/api/nv/sdk/docs-pipeline/clauses/library`,
`/api/nv/orchestrate`, `/api/nv/admin/health/full`. Webhook secrets
intentionally validate as `valid:false` (200) on the validate endpoint, not
401, to avoid leaking the secret class.

### 4.7 Full surface count

`rg -c "router\.(get|post|put|delete|patch)" src/routes/` → **1110
endpoint registrations across 83 route files** (top: orchestration 93,
sdk-gateway 81, phase5 58, new-services 57, enterprise-admin 54). The
102-endpoint smoke covers every distinct SDK-facing family above plus
auth-negative cases. Routes not in the smoke are admin/console/internal
governance — they are JWT-only and exercised by the console UI.

## 5. Response envelope (captured, not guessed)

Smoke `T4` extension in `scripts/nv-smoke-all-platforms.ts` now captures
the JSON envelope on every 2xx and writes it to the audit ledger. Fields
recognised: `success`, `requestId`, `model`, `tokens.{input,output,prompt,completion,total}`,
`latency_ms`, `qualityScore`, `auditHash`, `compliance`. **Of 102 probes,
84 carried an envelope** (the other 18 were 401/403 negatives or empty
204-style replies).

Standard envelope shape (e.g. `/api/nv/gateway/translate`):

```json
{
  "success": true,
  "data": {
    "model": "...",
    "tokens": { "prompt": 0, "completion": 0, "total": 0 },
    "latency_ms": 0,
    "compliance": { "input_passed": true, "output_passed": true },
    "pii_redacted": true
  }
}
```

The `requestId` / `auditHash` / `qualityScore` fields are surfaced on the
deeper `executeWithFullSafetyRing` paths (chat, summarize, intelligence)
when the full Queen ring runs end-to-end. A separate auth-bearing probe
exercising those paths is parked under `T4` follow-up — the existing
ledger proves the safety ring is reachable per platform; the deep-trace
sample is captured in §6.

## 6. Trace evidence per platform

For each of the 7 platforms the smoke ledger
(`audit/smoke-all-platforms-2026-05-07T09-42-09-175Z.json`) shows:

- `provision/validate` 200 → key live in DB
- `gateway/health` 200 → tenantIsolation + apiKey middleware passed
- `gateway/agents` 200 → registry served (1042-agent corpus reachable)
- `gateway/translate` 200 with envelope → full LLM round-trip succeeded
- `gateway/research/query` 200/403 → scope gate enforced exactly per §1
- `docs-pipeline/*` 200/403 → docs scope gate enforced exactly per §1
- `enterprise/research` 200/403 → wildcard scope gate enforced

Every platform: 13/13 PASS, every gate matches DB scopes. No platform
has any unexpected 4xx/5xx.

## 7. What is NOT in this doc

- Internal `/api/nv/admin/*` and `/api/nv/orchestrate` JWT-bearing
  console routes (covered by Console RBAC doc).
- Raw OpenAPI spec — generated separately under `docs/openapi/` and
  re-derived from the route registry.
- Deprecated v2 / pre-3.1.2 endpoints — see `archive/sdk-api-pre-2026-05-07/`.

## 8. Smoke / regression contract

Any regression in §4 fails CI. Run locally:

```bash
NYV_GATEWAY=http://localhost:5000 npx tsx scripts/nv-smoke-all-platforms.ts
```

A passing run writes `audit/smoke-all-platforms-<UTC>.json` with the full
envelope per probe. CI / deployment pipelines must require exit code `0`
before promoting code.

---

# Appendix — Per-platform agentic-flow walkthroughs (T5 Q4=mega-doc, 2026-05-07)

> Per Q4 (NV-DOC-001 mega-doc convention), the 7 platform appendices live as anchored sections inside this canonical doc. Each appendix shows: (a) the platform's DB scope grant, (b) the headline endpoints it actually exercises, (c) the agentic flow per call (NV-ARCH-001 ring), (d) live verification status as of 2026-05-07.

## Appendix A — NSP (Nyayasiddhi Professional™)

- **Audience**: law firms (lawyer/partner workstation).
- **DB scopes** (verified 2026-05-07T16:25Z, Neon live query): `agents:read`, `agents:execute`, `documents:read`, `documents:write`, `research:read`, `usage:read`. (Same row as §1; appendix matches table.)
- **Headline endpoints**:
  - `POST /api/nv/sdk/docs-pipeline/documents/parse` — single-file parse to JSON.
  - `POST /api/nv/sdk/docs-pipeline/documents/intelligence` — Queen-orchestrated multi-agent legal analysis (REAL LLM).
  - `POST /api/nv/sdk/docs-pipeline/clauses/suggest` — drafting helper.
  - `POST /api/nv/sdk/docs-pipeline/documents/summarize` — brief / detailed summaries.
  - `POST /api/nv/sdk/docs-pipeline/documents/compliance-check` — NV-AUDIT-F7-EXT path.
  - `POST /api/nv/gateway/research/query` — agentic legal research.
  - `POST /api/nv/gateway/translate` — Sarvam mayura:v1 in/out (verified 2026-05-07T16:17Z, OK 194ms).
- **Agentic flow** (every doc-intelligence call): tenant isolation → guardrails → Queen orchestrator → BM25 agent allocation (1042 × 6jur × 22 patterns) → 22-section Parlant prompt → 5-tier memory + multi-tier RAG (statute/case/template/private) + GraphRAG → CoT/ReAct reasoning → NV-ROUTER-001 (`orchestrateLLM`) → response engineering → hallucination + citation + safety + HITL → audit hash chain → streaming.
- **Live status**: 13/13 PASS in baseline ledger; deep-flow probe F1–F8 OK with real LLM round-trips.

## Appendix B — NSPM (Nyayasiddhi Professional Mobile™)

- **Audience**: law-firm mobile users (lawyers in the field; voice-first capture).
- **DB scopes** (verified 2026-05-07T16:25Z, Neon live query): `agents:read`, `agents:execute`, `documents:read`, `documents:write`, `research:read`, `usage:read`, `voice:read`, `voice:execute` (super-set of NSP — adds the two voice scopes for mobile dictation).
- **Headline endpoints**: full docs-pipeline + research surface (same as NSP), plus voice capture / TTS endpoints gated by `voice:*`.
- **Agentic flow**: identical NV-ARCH-001 ring; voice-input requests additionally go through Sarvam STT before the wrapper sees text.
- **Live status**: 13/13 PASS; F2 doc-intelligence OK 20.3s on Replit dev.

## Appendix C — NSI (Nyayasiddhi Institutional™)

- **Audience**: enterprise legal departments.
- **DB scopes**: `*` (wildcard) — all SDK endpoints reachable.
- **Headline endpoints**: full docs-pipeline + research + `/api/nv/sdk/enterprise/research/domain/legal` + `/api/nv/sdk/enterprise/contracts/*` + `/api/nv/sdk/enterprise/compliance/*`.
- **Agentic flow**: same NV-ARCH-001 ring. Enterprise-domain endpoints additionally engage `enterprise-research-agent` swarm topology (multi-jurisdictional fan-out + RRF fusion reranking).
- **Live status**: 13/13 PASS; F9 enterprise/research/legal OK on Replit dev.
- **Known flake**: 1 NSI `/research/query` LLM timeout in baseline (non-deterministic).

## Appendix D — NSA (Nyayasiddhi Academy™)

- **Audience**: legal-education institutions.
- **DB scopes** (verified 2026-05-07T16:25Z, Neon live query): `agents:read`, `agents:execute`, `documents:read`, `research:read`, `translate:write`, `usage:read`. **NO `documents:write`** — NSA is read-only on documents per the academic-corpus model (students/faculty consume the corpus; they do not upload back into it via this SDK).
- **Headline endpoints**: docs-pipeline `documents/parse` is **DENIED 403** by design (requires `documents:write`); `documents/intelligence` (read), `documents/embeddings` (read), `research/query` (read), `translate` (write), `agents/execute` (where allowed by `allowedAgents`) — all OK.
- **Agentic flow**: identical NV-ARCH-001 ring; NSA jurisdiction defaults to `IN` for the registry lookup.
- **Live status**: scope-gated DENY on `/documents/parse` is the expected (DB-truth) behavior — see 04b §F1. Other endpoints PASS on Replit dev. **EC2 NSA** scope row in `mirror-pg.ts` SCOPES map should be set to the 6 scopes above (no `documents:write`) so EC2 mirrors Replit dev exactly — see doc 07 §5.

## Appendix E — NSM (Nyayasiddhi Ministry™)

- **Audience**: government agencies.
- **DB scopes**: `*` (wildcard).
- **Headline endpoints**: full docs-pipeline + research + enterprise/* (gov-grade compliance frameworks: GDPR, DPDP-Act, GLBA, HIPAA via `/api/nv/sdk/enterprise/compliance/*`).
- **Agentic flow**: NV-ARCH-001 ring with HITL gate **forced ON** for any output flagged confidential by the safety classifier.
- **Live status**: 13/13 PASS.

## Appendix F — NYM (Nyayamitra™)

- **Audience**: citizens / consumer legal aid.
- **DB scopes** (Q1=DB-wins, 2026-05-07 confirmed): `documents:read`, `documents:write`, `translate:write`, `consumer_intake:write`, `agents:read`, `agents:execute`, `usage:read`. **No `research:read`** — citizens go through the consumer-intake funnel, not the raw research surface.
- **Headline endpoints**: `/api/nv/sdk/docs-pipeline/documents/parse|intelligence|summarize|compliance-check|clauses/suggest`, `/api/nv/gateway/translate`, `/api/nv/sdk/consumer-intake/*`.
- **Agentic flow**: NV-ARCH-001 ring with PII vault forced ON (citizen data is always confidential class). Translate is the most-exercised path (Sarvam mayura:v1, sub-second).
- **Live status**: 13/13 PASS. F8 research/query correctly DENY 403 (matches DB scope grant).
- **Known fix landed 2026-05-07**: NYV-AUDIT-F7-EXT — `clauses/suggest` and `compliance-check` SQL syntax bug (Drizzle WHERE on non-existent columns). Fix in `src/services/nv-document-pipeline-service.ts`.
- **EC2 NYM** has scope-drift fails in `mirror-pg.ts` — same fix as NSA (doc 07 §5).

## Appendix G — JRX (Jurix™)

- **Audience**: cross-jurisdiction legal-tech tools (multi-country corpus).
- **DB scopes**: `*` (wildcard).
- **Headline endpoints**: full docs-pipeline + research + enterprise/research/legal across 6 jurisdictions (IN, UK, US, GC, EU, SG, Default).
- **Agentic flow**: NV-ARCH-001 ring with the agent-allocation step preferring jurisdiction-specific SLMs per query (Indian Contract Act → IN registry; GDPR → EU registry; etc.).
- **Live status**: 13/13 PASS; F2 doc-intelligence OK 12.1s with REAL LLM round-trip; F9 enterprise/research/legal OK; F10 translate OK 0.6s.

---

## How to re-verify any appendix

```bash
# Per-platform smoke (replace PLAT with NSP/NSPM/NSI/NSA/NSM/NYM/JRX):
npx tsx scripts/nv-smoke-all-platforms.ts --platform PLAT

# Deep-flow + REAL LLM probe:
npx tsx scripts/nv-smoke-deep-ai-flows.ts --platform PLAT
```

Both write `audit/*.json` ledgers with full envelopes per call.

---

# Appendix Z — Integration quick-start for downstream platforms (NSP / NYM / NSPM / NSI / NSA / NSM / JRX) — 2026-05-09

> Hand this section to the engineer integrating Nyayavigya from any downstream client. **Every example uses the live EC2 prod-dev gateway** — paste `curl` commands as-is and you will get real LLM responses. Verified end-to-end against EC2 in this session: GETs sub-150 ms; `/documents/analyze` returns 200 in 55–71 s with full safety ring, real LLM, PII redaction.

## Z.1 Base URL + auth (one line each)

| Surface | Base URL | Auth header |
|---|---|---|
| Direct gateway | `https://api.nyayasiddhi.online` | `X-API-Key: <NYV_SDK_KEY_*>` |
| Via console proxy | `https://console.nyayasiddhi.online` | `X-API-Key: <NYV_SDK_KEY_*>` |
| Per-platform DNS (wildcard, NV-DNS-001) | `https://nsp.nyayasiddhi.online` / `nspm.` / `nym.` / `jrx.` / `nsi.` / `nsa.` / `nsm.` / `sdk.` | `X-API-Key: <NYV_SDK_KEY_*>` |

All three resolve to the same ALB → gateway. Keys are the `NYV_SDK_KEY_*` Replit secrets (one per platform). NSP/JRX teams that later stand up dedicated EC2 can override their host-specific record without touching downstream client code.

## Z.2 Universal smoke (paste-and-run, takes ~2 s)

```bash
KEY="<your NYV_SDK_KEY_*>"
BASE=https://api.nyayasiddhi.online

curl -sS -H "X-API-Key: $KEY" $BASE/api/nv/gateway/health   | jq .
curl -sS -H "X-API-Key: $KEY" $BASE/api/nv/gateway/info     | jq .data.platform
curl -sS -H "X-API-Key: $KEY" $BASE/api/nv/gateway/agents   | jq '.data | {total, app: .appName}'
curl -sS -H "X-API-Key: $KEY" $BASE/api/nv/gateway/usage    | jq .data
```

If all four return `{"success":true,...}` you have a live key + working gateway + DB-backed agent registry + N7 sync.

## Z.3 The 9 universal AI tasks (work for every platform with `documents:read`)

> **Live request bodies** — these are the exact contracts in the EC2 source. **Bad field names produce 400** (e.g. `text` instead of `content` on `/documents/analyze`). Always use the names below.

```bash
# 1. Summarize a document
curl -X POST $BASE/api/nv/gateway/documents/summarize \
  -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"content":"<your document text>","detailLevel":"executive","focusAreas":["risk","obligations"],"maxWords":200}'

# 2. Analyze a document (entities + clauses + risk + compliance)
curl -X POST $BASE/api/nv/gateway/documents/analyze \
  -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"content":"<your document text>","type":"contract","jurisdiction":"IN"}'

# 3. Extract legal entities (parties, dates, statutes, courts)
curl -X POST $BASE/api/nv/gateway/documents/extract-entities \
  -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"content":"<your document text>"}'

# 4. Reason step-by-step (Chain of Thought)
curl -X POST $BASE/api/nv/gateway/sampling/chain-of-thought \
  -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"prompt":"<your legal question>","jurisdiction":"IN"}'

# 5. Translate legal text (Sarvam, 22 Indian languages + en)
curl -X POST $BASE/api/nv/gateway/translate \
  -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"text":"<source text>","sourceLanguage":"en","targetLanguage":"hi"}'

# 6. Batch translate
curl -X POST $BASE/api/nv/gateway/translate/batch \
  -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"texts":["clause 1","clause 2"],"sourceLanguage":"en","targetLanguage":"hi"}'

# 7. Available languages (good for a UI dropdown)
curl -H "X-API-Key: $KEY" $BASE/api/nv/gateway/translate/languages | jq .

# 8. List agents available to your scope
curl -H "X-API-Key: $KEY" $BASE/api/nv/gateway/agents | jq '.data.agents[].id'

# 9. Your usage / quota
curl -H "X-API-Key: $KEY" $BASE/api/nv/gateway/usage | jq .
```

## Z.4 Response envelope (what every 2xx returns)

```json
{
  "success": true,
  "data": {
    "model": "anthropic/claude-3-5-sonnet OR openai/... OR sarvam/mayura:v1 (router-picked)",
    "tokens": { "prompt": 0, "completion": 0, "total": 0 },
    "latency_ms": 0,
    "compliance": { "input_passed": true, "output_passed": true },
    "pii_redacted": true,
    "<task-specific payload>": { }
  }
}
```

Deep-ring routes (`analyze`, `chain-of-thought`, `intelligence`) additionally surface `requestId`, `auditHash`, `qualityScore`.

## Z.5 Error contracts (so your client can handle them cleanly)

| HTTP | Body | What it means |
|---|---|---|
| 400 | `{success:false,error:"Missing required field: <name>"}` | Wrong/absent field name in body — see Z.3 contracts |
| 401 | `{success:false,error:"Unauthorized"}` | Missing/invalid `X-API-Key` |
| 403 | `{success:false,error:"Insufficient scope. Required: <scope>"}` | Your platform key lacks the scope — check §1 table |
| 429 | `{success:false,error:"Rate limit exceeded"}` | Back off (Retry-After header set) |
| 504 | `<html>504 Gateway Time-out</html>` | Request exceeded 180 s — retry shorter input |

## Z.6 Per-platform AI-task availability (live verified 2026-05-09T11:30Z against EC2)

> **DB ground truth (re-checked 2026-05-09 against `sdk_app_api_keys.scopes`):** all 7 platform keys currently hold wildcard `["*"]` scope. Per the `replit.md` SDK-key-scopes gotcha, **DB wins over any doc/spec**. The §1 per-platform scope table in this doc is **drift** vs current DB and will be reconciled in a follow-up — until then, every platform key passes every scope check at the gateway.
>
> Practical effect for integrators today: any of the 7 SDK keys can call any of the gateway routes below; the `Insufficient scope` 403 path is **not currently triggered for any platform**, even though the route handlers still enforce it. If/when DB scopes are tightened back to the §1 table, `/research/query` will start returning 403 for NYM, `/docs-pipeline/parse` will start returning 403 for NSA, etc. — write your client to handle 403 correctly even if you don't see it today.

| Task | NSP | NSPM | NSI | NSA | NSM | NYM | JRX |
|---|---|---|---|---|---|---|---|
| `/health` `/info` `/agents` `/usage` (read) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `/documents/summarize` (`documents:read`) | ✅ 48 s live | ✅ | ✅ | ✅ | ✅ | ✅ 57 s live | ✅ |
| `/documents/analyze` (`documents:read`) | ✅ 55 s live | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `/documents/extract-entities` (`documents:read`) | ✅ 31 s live | ✅ | ✅ | ✅ | ✅ | ✅ 31 s live | ✅ |
| `/sampling/chain-of-thought` | ✅ 0.1 s live | ✅ | ✅ | ✅ | ✅ | ✅ 0.1 s live | ✅ |
| `/translate` (Sarvam) | ✅ 0.4 s live | ✅ | ✅ | ✅ | ✅ | ✅ 0.1 s live | ✅ |
| `/research/query` (`research:read`) — **DB-current**: open via wildcard | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ 12 s live (will be 403 when §1 scopes are reapplied) | ✅ |
| `/api/nv/sdk/docs-pipeline/documents/parse` (`documents:write`) | ✅ | ✅ | ✅ | ✅ (will be 403 when §1 scopes are reapplied) | ✅ | ✅ | ✅ |
| `/api/nv/sdk/enterprise/research/domain/legal` (wildcard scope) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

**Negative tests verified live 2026-05-09T11:30Z**: invalid `X-API-Key` → `401`; missing key → `401`. Auth gate is enforced even though scope gate is currently de-facto open via wildcard.

## Z.7 Recommended client retry / timeout policy

- Read endpoints (`/info`, `/health`, `/agents`, `/usage`, `/cache/stats`, `/guardrails/stats`): timeout 5 s, retry up to 2× with 250 ms backoff.
- Translate / chain-of-thought / extract-entities: timeout 30 s, retry once on 5xx only.
- Heavy LLM (`summarize`, `analyze`, `intelligence`): timeout **180 s** (matches the gateway nginx + ALB budget per `NV-EC2-NGINX-001`); do **not** auto-retry — these calls are billed and idempotency is per-`requestId`.
- All paths: respect `Retry-After` on 429.

## Z.8 What a downstream test plan looks like (10 minutes total)

1. Hit Z.2 universal smoke. Expect 4 × 200.
2. Run Z.3 #1 (summarize) with a 1-paragraph contract. Expect 200 in <30 s.
3. Run Z.3 #5 (translate) en→hi. Expect 200 in <2 s.
4. Run Z.3 #4 (chain-of-thought) with one legal question. Expect 200 in <15 s.
5. Run Z.3 #2 (analyze) with a short MSA paragraph. Expect 200 in <90 s, body contains structured analysis + `[REDACTED_*]` markers (proves PII vault).
6. Send a request with a deliberately wrong key → expect 401 (proves auth gate).
7. Send a request from NYM to `/research/query` → expect 403 (proves scope gate matches DB).

If steps 1-6 all pass and step 7 returns 403, your integration is correctly wired into the full NV-ARCH-001 safety ring.

---

## § 11 — Session-10 Batch A: Orchestration primitives (`/api/nv5/orch/*`)

Added 2026-05-10 (Session-10). Wires 7 previously-orphan AI orchestration
files (`knowledge-base-system`, `context-engineering-service`,
`advanced-multimodal-rag`, `nyv-integration-plugin-manager`,
`roma-l5-engine`, `bm25-agent-selector`, `nv-protocol-registry-manifest`)
as **read-only metadata + deterministic-compute** sub-routers. Each
sub-router is mounted under `/api/nv5/orch/<concept>/*` behind its own
feature flag. **Default flag posture: all OFF → entire namespace
returns 404.** Routes are SDK-authenticated (no JWT bypass).
Provider-emitting paths (knowledge-base `/search`, multimodal-rag
`/query`, roma `/governance/run`, context `/enhance`) are deliberately
NOT exposed — those remain reachable only from canonical pipelines per
NV-LLM-001.

### 11.1 Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET  | `/api/nv5/orch/kb/health`                 | Knowledge-base service liveness |
| POST | `/api/nv5/orch/kb/create`                 | Create a (metadata-only) KB record |
| GET  | `/api/nv5/orch/context/health`            | Context-engineering service liveness |
| GET  | `/api/nv5/orch/multimodal-rag/health`     | Multimodal-RAG service liveness |
| POST | `/api/nv5/orch/multimodal-rag/kb/create`  | Create a multimodal KB record (metadata only) |
| GET  | `/api/nv5/orch/plugins/health`            | Plugin manager liveness |
| GET  | `/api/nv5/orch/plugins/status-report`     | Per-plugin status (registered / loaded / errored) |
| GET  | `/api/nv5/orch/plugins/audit-log`         | Plugin lifecycle audit log |
| GET  | `/api/nv5/orch/plugins/global-stats`      | Aggregate plugin metrics |
| GET  | `/api/nv5/orch/roma/health`               | ROMA-L5 engine liveness |
| POST | `/api/nv5/orch/roma/outcome/track`        | Append a ROMA outcome row (deterministic) |
| GET  | `/api/nv5/orch/roma/audit-trail`          | ROMA-L5 governance audit trail |
| GET  | `/api/nv5/orch/roma/performance-store`    | Per-pattern performance store |
| POST | `/api/nv5/orch/agent-select/load`         | Load / refresh BM25 index for a jurisdiction |
| POST | `/api/nv5/orch/agent-select/select`       | BM25 agent shortlist (no LLM call) |
| GET  | `/api/nv5/orch/agent-select/health`       | Agent-selector liveness |
| GET  | `/api/nv5/orch/protocols/health`          | Protocol-registry manifest liveness |

### 11.2 Feature flag matrix

| Flag | Default | Mounts |
|---|---|---|
| `NYV_F_AI_ORCH_KB`             | `0` | `/api/nv5/orch/kb/*` |
| `NYV_F_AI_ORCH_CONTEXT`        | `0` | `/api/nv5/orch/context/*` |
| `NYV_F_AI_ORCH_MULTIMODAL_RAG` | `0` | `/api/nv5/orch/multimodal-rag/*` |
| `NYV_F_AI_ORCH_PLUGINS`        | `0` | `/api/nv5/orch/plugins/*` |
| `NYV_F_AI_ORCH_ROMA`           | `0` | `/api/nv5/orch/roma/*` |
| `NYV_F_AI_ORCH_AGENT_SELECT`   | `0` | `/api/nv5/orch/agent-select/*` |
| `NYV_F_AI_ORCH_PROTOCOLS`      | `0` | `/api/nv5/orch/protocols/*` |

### 11.3 Curl example

```bash
# BM25 shortlist for an Indian Contract Act question (no LLM call).
# NOTE: the BM25 selector is body-only — `query` (string, required) +
# `topK` (number, optional, default 5). Jurisdiction-scoping is performed
# upstream by `/load` (the agent set loaded into the index decides scope).
curl -s -X POST -H "X-API-Key: $NYV_SDK_KEY_NSI" -H 'content-type: application/json' \
  -d '{"query":"Section 73 damages computation","topK":5}' \
  http://localhost:5000/api/nv5/orch/agent-select/select
```

### 11.4 Safety-ring side-channel

When the same caller follows up with the actual question via canonical
`/api/nv/orchestrate`, `bm25-agent-selector` runs as step 4 of the safety
ring (NV-ARCH-001). The nv5 admin route lets ops verify the shortlist
deterministically before spending an LLM call. See doc 11 § A for the
full trace.

---

## § 12 — Session-10 Batch B: Multimodal admin surface (`/api/nv5/multimodal/*`)

Added 2026-05-10 (Session-10). Wires 5 previously-orphan multimodal
service files (`unity-avatar`, `chatdollkit-avatar`, `enhanced-multimodal`,
`advanced-3d-immersive`, `avatar-3d-system`). Heavy paths
(`/vision/analyze`, `/3d/generate`, `/avatar/create-session`) **delegate**
to the canonical `nv-sdk-multimodal-voice-routes` router via
`delegateTo()` (`src/routes/nv5/_auth.ts`) — the canonical chain runs the
full safety ring per NV-LLM-001 / NV-ARCH-001. **Default flag posture:
all OFF → entire namespace returns 404.**

### 12.1 Endpoints

| Method | Path | Delegates to (canonical) |
|---|---|---|
| GET  | `/api/nv5/multimodal/avatar-unity/health`     | — (local) |
| POST | `/api/nv5/multimodal/avatar-unity/session`    | `/multimodal/avatar/create-session` |
| GET  | `/api/nv5/multimodal/avatar-chatdoll/health`  | — (local) |
| POST | `/api/nv5/multimodal/avatar-chatdoll/session` | `/multimodal/avatar/create-session` |
| GET  | `/api/nv5/multimodal/rag-adv/health`         | — (local) |
| GET  | `/api/nv5/multimodal/rag-adv/capabilities`   | `/multimodal/capabilities` |
| POST | `/api/nv5/multimodal/rag-adv/vision/analyze` | `/multimodal/vision/analyze` |
| POST | `/api/nv5/multimodal/rag-adv/rag/query`      | `/multimodal/rag/query` |
| GET  | `/api/nv5/multimodal/3d-immersive/health`     | — (local) |
| POST | `/api/nv5/multimodal/3d-immersive/generate`   | `/multimodal/3d/generate` |
| GET  | `/api/nv5/multimodal/avatar-3d/health`        | — (local) |
| POST | `/api/nv5/multimodal/avatar-3d/session`       | `/multimodal/avatar/create-session` |
| POST | `/api/nv5/multimodal/avatar-3d/3d/generate`   | `/multimodal/3d/generate` |

### 12.2 Feature flag matrix

| Flag | Default | Mounts |
|---|---|---|
| `NYV_F_MULTIMODAL_AVATAR_UNITY`     | `0` | `/api/nv5/multimodal/avatar-unity/*` |
| `NYV_F_MULTIMODAL_AVATAR_CHATDOLL`  | `0` | `/api/nv5/multimodal/avatar-chatdoll/*` |
| `NYV_F_MULTIMODAL_RAG_ADV`          | `0` | `/api/nv5/multimodal/rag-adv/*` |
| `NYV_F_MULTIMODAL_3D_IMMERSIVE`     | `0` | `/api/nv5/multimodal/3d-immersive/*` |
| `NYV_F_MULTIMODAL_AVATAR_3D`        | `0` | `/api/nv5/multimodal/avatar-3d/*` |

### 12.3 Auth note

`requireSdkKey` (= `sdkGatewayAuth`) — DB-backed key verification + scope
check + tenant binding. NV-AUTH-HEADER-001 honored: `X-API-Key` primary,
`Authorization: Bearer` fallback.

---

## § 13 — Session-10 Batch B: Voice admin surface (`/api/nv5/voice/*`)

Added 2026-05-10. Wires 3 previously-orphan voice service files
(`realtime-voice-streaming`, `voice-synthesis-engine`,
`nyv-voice-service-enhanced`). Provider calls (TTS / STT) **delegate**
to the canonical `nv-voice-ws-routes` (Deepgram + Sarvam-22-Indic +
Whisper) via `delegateTo()`. **Default flag posture: all OFF → 404.**

### 13.1 Endpoints

| Method | Path | Delegates to (canonical) |
|---|---|---|
| GET  | `/api/nv5/voice/streaming/health`                       | — (local) |
| GET  | `/api/nv5/voice/streaming/metrics`                      | — (local) |
| GET  | `/api/nv5/voice/streaming/cost-report`                  | — (local) |
| GET  | `/api/nv5/voice/streaming/provider/:type/:costMode`     | — (local) |
| POST | `/api/nv5/voice/streaming/start`                        | `/voice/stream/start` |
| POST | `/api/nv5/voice/streaming/stop`                         | `/voice/stream/stop` |
| GET  | `/api/nv5/voice/synthesis/health`                       | — (local) |
| GET  | `/api/nv5/voice/synthesis/voices`                       | — (local) |
| GET  | `/api/nv5/voice/synthesis/provider/:id`                 | — (local) |
| POST | `/api/nv5/voice/synthesis/synthesize`                   | `/synthesize` |
| GET  | `/api/nv5/voice/enhanced/health`                        | — (local) |
| POST | `/api/nv5/voice/enhanced/synthesize`                    | `/synthesize` |
| POST | `/api/nv5/voice/enhanced/transcribe`                    | `/transcribe` |

### 13.2 Feature flag matrix

| Flag | Default | Mounts |
|---|---|---|
| `NYV_F_VOICE_STREAM_RT` | `0` | `/api/nv5/voice/streaming/*` |
| `NYV_F_VOICE_SYNTH`     | `0` | `/api/nv5/voice/synthesis/*` |
| `NYV_F_VOICE_ENHANCED`  | `0` | `/api/nv5/voice/enhanced/*` |

### 13.3 Auth note

The canonical `nv-voice-ws-routes` chain auths via `requireSdkOrJwt`,
so the `/api/nv5/voice/*` surface inherits SDK-OR-JWT semantics by
design (voice clients sometimes hand off from initial SDK handshake to
session JWT). To enforce strict-SDK-only on a future nv5 voice route,
layer `requireSdkKey` on the delegated handler.

---

## § 13a — Session-10 Batch C: Workflows admin surface (`/api/nv5/workflows/*`)

Added 2026-05-10. Wires 2 previously-orphan workflow engines
(`autonomous-continuous-execution-engine`, `continuous-execution-engine`).
Engines are import-loaded for wiring-audit reachability but **do not
start their background loops** until an SDK request POSTs to
`/start`. There is no env-based boot-start path. **Default flag posture:
all OFF → 404.**

### 13a.1 Endpoints

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/nv5/workflows/start`             | Start a workflow run (engine picked from body) |
| GET  | `/api/nv5/workflows/:id`               | Workflow run state + progress |
| POST | `/api/nv5/workflows/:id/cancel`        | Cancel a running workflow |
| GET  | `/api/nv5/workflows/autonomous/health` | Autonomous-engine liveness |
| GET  | `/api/nv5/workflows/autonomous/status` | Autonomous-engine status snapshot |
| POST | `/api/nv5/workflows/autonomous/start`  | Start autonomous engine |
| POST | `/api/nv5/workflows/autonomous/stop`   | Stop autonomous engine |
| GET  | `/api/nv5/workflows/autonomous/agents` | List autonomous-agent fleet |
| GET  | `/api/nv5/workflows/autonomous/conflicts` | Conflict log (autonomous) |
| GET  | `/api/nv5/workflows/autonomous/healing` | Self-heal events (autonomous) |
| POST | `/api/nv5/workflows/autonomous/tasks`  | Submit a task to autonomous fleet |
| POST | `/api/nv5/workflows/autonomous/agents/:id/pause`  | Pause one autonomous agent |
| POST | `/api/nv5/workflows/autonomous/agents/:id/resume` | Resume one autonomous agent |
| GET  | `/api/nv5/workflows/continuous/health`  | Continuous-engine liveness |
| GET  | `/api/nv5/workflows/continuous/status`  | Continuous-engine status |
| GET  | `/api/nv5/workflows/continuous/metrics` | Continuous-engine metrics |
| POST | `/api/nv5/workflows/continuous/start`   | Start continuous engine |
| POST | `/api/nv5/workflows/continuous/stop`    | Stop continuous engine |
| POST | `/api/nv5/workflows/continuous/tasks`   | Submit a task to continuous engine |
| GET  | `/api/nv5/workflows/continuous/tasks/:id` | Task state |
| POST | `/api/nv5/workflows/continuous/tasks/:id/cancel` | Cancel a task |

### 13a.2 Feature flag matrix

| Flag | Default | Mounts |
|---|---|---|
| `NYV_F_WORKFLOW_AUTONOMOUS` | `0` | `/api/nv5/workflows/autonomous/*` + canonical `/start` shim |
| `NYV_F_WORKFLOW_CONTINUOUS` | `0` | `/api/nv5/workflows/continuous/*` + canonical `/start` shim |

### 13a.3 Auth note

`requireSdkKeyStrict` rejects JWT-bypass before delegating to
`sdkGatewayAuth` — workflow lifecycle requires contractual SDK-key
semantics (per task-100.md step 5, see `_auth.ts`). Each fan-out task
re-enters the safety ring at `nv-queen-orchestrator`; workflow engines
are clients of the ring, not bypasses. See doc 11 § C for the trace.

---

## § 13b — Session-10 Batch C: Doc-AI admin surface (`/api/nv5/doc-ai/*`)

Added 2026-05-10. Wires `nv-document-converter-service`. **Pure
deterministic conversion** — no LLM emission. **Default flag posture:
flag OFF → 404.**

### 13b.1 Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET  | `/api/nv5/doc-ai/convert/health`        | Converter liveness |
| GET  | `/api/nv5/doc-ai/convert/supported`     | Supported source/target MIME pairs |
| POST | `/api/nv5/doc-ai/convert/jobs`          | Submit a conversion job (multer file ≤ 1 GB) |
| GET  | `/api/nv5/doc-ai/convert/jobs/:id`      | Job status |
| GET  | `/api/nv5/doc-ai/convert/jobs/:id/result` | Download conversion result |

### 13b.2 Feature flag matrix

| Flag | Default | Mounts |
|---|---|---|
| `NYV_F_DOC_AI_CONVERT` | `0` | `/api/nv5/doc-ai/convert/*` |

### 13b.3 Storage notes

Result lands in object storage at `tenants/<orgId>/conversions/<jobId>/`.
Same canonical key path on `s3` and `replit` storage backends per the
adapter at `src/services/storage/nv-object-storage.ts`.

---

## Section 14 — `/api/nv5/*` additive admin surface (Session-10, 2026-05-10)

> **Why a separate v5 mount?** The frozen `/api/nv/*` surface is locked at 1,223 ops by `NV-API-CONTRACT-001`. New cross-cutting admin services land at `/api/nv5/*` so they are additive (never +/− against the baseline). All `/api/nv5/*` routes are flag-gated and default OFF — Batch C and D ship dark.

### 14.1 Mounts in production today

| Mount | Sub-mounts | Auth | Default | Wired in |
|---|---|---|---|---|
| `/api/nv5/orch/*` | agent-select, context, kb, multimodal-rag, plugins, protocols, roma | `X-API-Key` (any valid key) | ON | Batch A/B (Session-10) |
| `/api/nv5/multimodal/*` | vision, voice-stream, … | `X-API-Key` | OFF | Batch B |
| `/api/nv5/voice/*` | stream, providers | `X-API-Key` | OFF | Batch B |
| `/api/nv5/workflows/*` | autonomous, continuous (lazy /start) | `X-API-Key` (admin) | OFF | Batch C |
| `/api/nv5/doc-ai/*` | doc-converter, parse | `X-API-Key` | OFF | Batch C |
| `/api/nv5/gov/*` | maker-checker, security-monitor, cost-optimizer, concurrency, org-ratelimit | `X-API-Key` + admin scope | OFF | **Batch D (2026-05-10)** |

### 14.2 `/api/nv5/gov/*` — Governance admin surface (Batch D)

**Purpose:** read-only operator visibility plus one documented cache-invalidate write for the 5 cross-cutting governance services wired into the request chain in Batch D.

**Auth contract:**
- Header: `X-API-Key: nyv_*` (canonical) — `Authorization: Bearer <key>` is also accepted EXCEPT when the value parses as a JWT (`xxx.yyy.zzz` base64url triplet), which is rejected with `401 BEARER_NOT_SDK_KEY` to prevent admin-route bypass via user JWT.
- Required scope: `admin` (or wildcard `*` / `all`).
- Each route additionally requires its own `NYV_F_GOV_*` feature flag = `1`. Flag OFF → `404` (route literally not mounted).

**Error envelopes (consistent across all 5 sub-routers):**

```json
{ "success": false, "data": null, "error": { "code": "BEARER_NOT_SDK_KEY", "message": "admin governance routes require an SDK API key, not a JWT" } }
```
```json
{ "success": false, "data": null, "error": { "code": "INSUFFICIENT_SCOPE", "message": "missing required scope: admin", "required": "admin", "have": ["agents:read","agents:execute","..."] } }
```
```json
{ "success": false, "error": "review not found: req_xyz" }
```

#### 14.2.1 Maker-Checker HITL queue

| Method | Path | Returns |
|---|---|---|
| GET | `/api/nv5/gov/maker-checker/queue?priority=urgent\|high\|medium\|low` | summary list of pending human reviews |
| GET | `/api/nv5/gov/maker-checker/queue/:requestId` | full review iteration history |

**Request:**
```bash
curl -H "X-API-Key: nyv_admin_***" \
  https://api.nyayasiddhi.online/api/nv5/gov/maker-checker/queue?priority=urgent
```

**Response (200):**
```json
{
  "success": true,
  "count": 2,
  "reviews": [
    {
      "requestId": "req_2026_05_10_a1b2",
      "sessionId": "sess_x9y8",
      "priority": "urgent",
      "reason": "low_confidence_jurisdiction_overlay",
      "iterations": 3,
      "createdAt": 1715337600000,
      "deadline": 1715341200000
    },
    { "requestId": "req_2026_05_10_c3d4", "sessionId": "sess_w7v6", "priority": "urgent", "reason": "citation_unverifiable", "iterations": 2, "createdAt": 1715338000000, "deadline": 1715341600000 }
  ]
}
```

**Mutation surface NOT exposed.** `submitHumanDecision` continues to flow through the existing HITL pipeline at `/api/nv/hitl/*` and the console `/decision-cards` page.

#### 14.2.2 Security monitor status

| Method | Path |
|---|---|
| GET | `/api/nv5/gov/security-monitor/status` |

**Response (200):**
```json
{
  "success": true,
  "service": "nv-security-monitor",
  "middlewareLoaded": true,
  "mountedGlobally": true,
  "thresholds": {
    "maxExecDepth": 12,
    "attackWindowMs": 3600000,
    "attackThreshold": 5
  }
}
```

The middleware itself is mounted on `/api/nv/*` when EITHER `NYV_F_SECURITY_MONITOR=1` OR the new `NYV_F_GOV_SECURITY_MON=1` is set (OR-aliased, by design — closes the unique-flag-without-mount gap that would otherwise make the new flag a no-op).

#### 14.2.3 Cost optimizer status

| Method | Path |
|---|---|
| GET | `/api/nv5/gov/cost-optimizer/status` |

**Response (200):**
```json
{
  "success": true,
  "service": "nv-cost-optimization-suite",
  "promptCacheStats": { "size": 142, "hits": 8124, "misses": 991, "hitRate": "89.1%" },
  "globalUsage": { "tokensIn": 12_400_000, "tokensOut": 3_200_000, "estimatedUsd": "184.20" },
  "topUsers": [ { "userId": "u_1", "tokens": 412_000, "usd": "6.18" } ]
}
```

**Orchestrator integration (active when `NYV_F_GOV_COST_OPT=1`):**
- Pre-LLM dispatch in `nv-queen-orchestrator.ts` (synthesis path): `checkTokenBudget(userId, 4096)` — if `allowed:false`, throws `[gov:cost-opt] token budget exceeded` BEFORE the provider hit.
- Post-LLM: `deductTokens(userId, in+out, model)` records actual usage.
- **Failure posture:** fail-OPEN on infrastructure errors (advisory, dev/UAT). Tighten to fail-CLOSED before broader prod rollout.

#### 14.2.4 Concurrency governor snapshot

| Method | Path |
|---|---|
| GET | `/api/nv5/gov/concurrency/snapshot` |

**Response (200):**
```json
{
  "success": true,
  "capturedAt": "2026-05-10T13:42:18.221Z",
  "tenants": [
    { "tenantId": "org_acme", "inFlight": 4, "queued": 1, "limit": 8 },
    { "tenantId": "default",  "inFlight": 0, "queued": 0, "limit": 8 }
  ],
  "providers": [
    { "providerId": "anthropic", "inFlight": 2, "queued": 0, "limit": 16 },
    { "providerId": "openai",    "inFlight": 1, "queued": 0, "limit": 16 }
  ],
  "summary": { "activeTenants": 2, "activeProviders": 2, "totalInFlight": 4, "totalQueued": 1 }
}
```

**Orchestrator integration (active when `NYV_F_GOV_CONCURRENCY=1`):** `realLLMService.executeRequest(...)` is wrapped in `withTenantSlot(tenantId, fn)` so concurrent in-flight LLM calls per tenant are bounded; excess is queued.

#### 14.2.5 Org rate limiter

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/nv5/gov/org-ratelimit/check/:orgId/:userId` | live decision (read) |
| POST | `/api/nv5/gov/org-ratelimit/cache/:orgId/invalidate` | flush cached `ai_rate_limit` lookup (documented exception to read-only gov surface) |

**Request:**
```bash
curl -H "X-API-Key: nyv_admin_***" \
  https://api.nyayasiddhi.online/api/nv5/gov/org-ratelimit/check/org_acme/user_42
```

**Response (200) — allowed:**
```json
{
  "success": true,
  "allowed": true,
  "remaining": 47,
  "limit": 60,
  "resetAt": 1715341260000,
  "windowMs": 60000
}
```

**Response (200) — limited:**
```json
{
  "success": true,
  "allowed": false,
  "remaining": 0,
  "limit": 60,
  "resetAt": 1715341260000,
  "retryAfterMs": 24000,
  "reason": "per_minute_cap_exceeded"
}
```

**Middleware mount (active when `NYV_F_GOV_ORG_RATELIMIT=1`):** `orgRateLimiter.middleware()` is mounted on `/api/nv/*` AFTER the existing tenant-isolation layer and BEFORE business-route handlers. Attaches `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` to responses; short-circuits with `429` + `Retry-After` on exceeded.

### 14.3 Feature flag matrix

| Flag | Default | Effect when `1` |
|---|---|---|
| `NYV_F_GOV_MAKER_CHECKER` | `0` | Mounts `/api/nv5/gov/maker-checker/*` + adds static reachability edge from queen orchestrator to `makerCheckerService` |
| `NYV_F_GOV_SECURITY_MON` | `0` | Mounts `/api/nv5/gov/security-monitor/*` + (OR-aliased with `NYV_F_SECURITY_MONITOR`) mounts `securityMonitorMiddleware` on `/api/nv/*` |
| `NYV_F_GOV_COST_OPT` | `0` | Mounts `/api/nv5/gov/cost-optimizer/*` + activates pre/post LLM dispatch hooks in queen orchestrator |
| `NYV_F_GOV_CONCURRENCY` | `0` | Mounts `/api/nv5/gov/concurrency/*` + wraps queen orchestrator synthesis dispatch in `withTenantSlot` |
| `NYV_F_GOV_ORG_RATELIMIT` | `0` | Mounts `/api/nv5/gov/org-ratelimit/*` + mounts rate-limit middleware on `/api/nv/*` |

### 14.4 Console UI

`/superadmin/governance` (super_admin only) renders all 5 panels with auto-refresh, a JWT-rejection hint, a flag-OFF hint, and an org-ratelimit prober + cache-invalidate button. Source: `client/src/pages/superadmin-governance.tsx`. Registered in `rbac-registry.ts` under `category:'admin'` as `governance-surface`.

---

## § 15 — Session-11 Batch E: Legal-pipeline admin surface (`/api/nv5/legal-pipeline/*`)

Added 2026-05-10 (Session-11). Wires 5 previously-orphan RAG services as
read-only / deterministic admin endpoints. **Default flag posture: all OFF
→ entire namespace returns 404.** All routes require: SDK API key (no JWT),
`admin` scope. Provider-emitting paths (LLM summarization, embedding API
calls, cross-encoder reranking) are deliberately NOT exposed here; they
remain reachable only through the canonical RAG pipeline traversed by
`realLLMService.executeRequest` (NV-LLM-001 / NV-ARCH-001).

### 15.1 Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET  | `/api/nv5/legal-pipeline/chunker/capabilities`     | List chunkTypes + defaults |
| POST | `/api/nv5/legal-pipeline/chunker/preview`          | Deterministic chunking preview (≤50k chars) |
| GET  | `/api/nv5/legal-pipeline/embedding/capabilities`   | List Indic languages supported |
| GET  | `/api/nv5/legal-pipeline/embedding/models`         | List embedding model catalog |
| GET  | `/api/nv5/legal-pipeline/reranker/capabilities`    | List algorithms + defaults |
| POST | `/api/nv5/legal-pipeline/reranker/rrf-fuse`        | Pure RRF fusion (≤10 lists) |
| GET  | `/api/nv5/legal-pipeline/summarizer/capabilities`  | Summarization levels + audiences |
| GET  | `/api/nv5/legal-pipeline/readability/capabilities` | Metrics + target ranges |
| POST | `/api/nv5/legal-pipeline/readability/score`        | Flesch-Kincaid scoring (≤100k chars) |

### 15.2 Curl examples

```bash
# capabilities (flag-ON, admin scope)
curl -s -H "X-API-Key: $NYV_SDK_KEY_NSP" \
  https://localhost:5000/api/nv5/legal-pipeline/chunker/capabilities

# deterministic preview (no LLM call)
curl -s -X POST -H "X-API-Key: $NYV_SDK_KEY_NSP" -H 'content-type: application/json' \
  -d '{"text":"This Agreement is made on...","mimeType":"text/plain"}' \
  https://localhost:5000/api/nv5/legal-pipeline/chunker/preview

# RRF fusion of two ranked lists
curl -s -X POST -H "X-API-Key: $NYV_SDK_KEY_NSP" -H 'content-type: application/json' \
  -d '{"k":60,"lists":[{"items":[{"id":"a","score":1}],"weight":1},{"items":[{"id":"b","score":1}],"weight":1}]}' \
  https://localhost:5000/api/nv5/legal-pipeline/reranker/rrf-fuse

# readability scoring
curl -s -X POST -H "X-API-Key: $NYV_SDK_KEY_NSP" -H 'content-type: application/json' \
  -d '{"text":"The party of the first part hereby agrees..."}' \
  https://localhost:5000/api/nv5/legal-pipeline/readability/score
```

### 15.3 Feature flag matrix

| Flag | Default | Effect when `1` |
|---|---|---|
| `NYV_F_LEGAL_PIPELINE_CHUNKER`     | `0` | Mounts `/api/nv5/legal-pipeline/chunker/*` |
| `NYV_F_LEGAL_PIPELINE_EMBEDDING`   | `0` | Mounts `/api/nv5/legal-pipeline/embedding/*` |
| `NYV_F_LEGAL_PIPELINE_RERANKER`    | `0` | Mounts `/api/nv5/legal-pipeline/reranker/*` |
| `NYV_F_LEGAL_PIPELINE_SUMMARIZER`  | `0` | Mounts `/api/nv5/legal-pipeline/summarizer/*` |
| `NYV_F_LEGAL_PIPELINE_READABILITY` | `0` | Mounts `/api/nv5/legal-pipeline/readability/*` |

### 15.4 Error envelopes

Same as § 14 (`BEARER_NOT_SDK_KEY` 401, `INSUFFICIENT_SCOPE` 403, `NOT_FOUND`
404 for flag-OFF, `BAD_REQUEST` 400 for input validation).

---

## § 16 — Session-11 Batch F: Compliance + crypto admin surface (`/api/nv5/compliance/*`)

Added 2026-05-10 (Session-11). Wires 3 previously-orphan compliance/crypto
services. **Default flag posture: all OFF → entire namespace returns 404.**
All routes require: SDK API key, `admin` scope. NV-LLM-001 / NV-ARCH-001:
no LLM-emitting endpoints.

### 16.1 Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET  | `/api/nv5/compliance/eu-ai-act/capabilities`              | List Article 9–15 doc generators |
| GET  | `/api/nv5/compliance/eu-ai-act/report`                    | Full EU AI Act compliance report |
| GET  | `/api/nv5/compliance/eu-ai-act/agent/:agentId/risk-management` | Article 9 doc per agent |
| GET  | `/api/nv5/compliance/eu-ai-act/agent/:agentId/bias-audit` | Article 15 bias audit per agent |
| GET  | `/api/nv5/compliance/pqc/capabilities`                    | List PQC primitives + operations |
| GET  | `/api/nv5/compliance/pqc/ready`                           | OQS / WASM init readiness probe |
| POST | `/api/nv5/compliance/pqc/kem-keygen`                      | Generate ML-KEM (Kyber) keypair |
| POST | `/api/nv5/compliance/pqc/dsa-keygen`                      | Generate ML-DSA (Dilithium) keypair |
| GET  | `/api/nv5/compliance/federated-privacy/capabilities`      | List FL capabilities + states |
| GET  | `/api/nv5/compliance/federated-privacy/sessions`          | List FL sessions (filter by clientId/status) |
| GET  | `/api/nv5/compliance/federated-privacy/sessions/:id`      | Get one FL session |
| POST | `/api/nv5/compliance/federated-privacy/dp-noise`          | Differential-privacy Laplace noise probe |

### 16.2 Feature flag matrix

| Flag | Default | Effect when `1` |
|---|---|---|
| `NYV_F_COMPLIANCE_EU_AI_ACT`           | `0` | Mounts `/api/nv5/compliance/eu-ai-act/*` |
| `NYV_F_COMPLIANCE_PQC`                 | `0` | Mounts `/api/nv5/compliance/pqc/*` |
| `NYV_F_COMPLIANCE_FEDERATED_PRIVACY`   | `0` | Mounts `/api/nv5/compliance/federated-privacy/*` |

### 16.3 Architecture notes

- **EU-AI-Act** generators are pure data lookups against agent registries +
  jurisdictional rule tables — no LLM calls, no external API calls.
- **PQC** keygen ops are deterministic crypto (OQS-native or WASM fallback,
  picked by `nvPqcService.detectMode()`). Full hybrid sign/verify remains
  reachable only from audit-chain commit + signed-response code paths.
- **Federated-privacy** session lifecycle mutations
  (`initializeFederatedSession`, `submitGradients`, `aggregateGradients`)
  are deliberately NOT exposed — those bind to a coordinated training run,
  not to ad-hoc admin requests. Only listings + DP-noise probe are surfaced.

---

## §17 — Session-11 Batches G + H + I + J: `/api/nv5/internal/*` (2026-05-10)

Consolidated admin namespace wiring 14 previously-orphan internal services
behind a **single namespace flag** `NYV_F_INTERNAL_SURFACE` (default OFF).
With the flag OFF the entire `/api/nv5/internal/*` namespace returns 404 —
preserving byte-for-byte v5 behaviour. The barrel is mounted unconditionally
so the BFS wiring auditor sees static-import edges to every wired service.

**Provenance.** Each route file imports its underlying service via static
ES-module import. NV-LLM-001 / NV-ARCH-001: zero LLM-emitting endpoints —
all routing, escalation, audit-chain, hallucination, and jurisdiction logic
remains reachable only from canonical pipelines (queen-orchestrator,
realLLMService.executeRequest, adaptive-RAG, audit-chain commit).

| Route | Auth | Purpose |
|---|---|---|
| `GET /api/nv5/internal/capabilities` | SDK + admin scope | List of 17 wired services with category + LLM/HTTP flags. |
| **Batch G — routing/cascade** | | |
| `GET /api/nv5/internal/model-cascade/capabilities` | SDK + admin | Cascade tier + user-tier metadata. |
| `GET /api/nv5/internal/slm-router/availability/:jurisdiction` | SDK + admin | SLM availability for IN/UK/US/GC/EU/SG/Default. |
| `GET /api/nv5/internal/cost-aware-router/capabilities` | SDK + admin | Complexity-tier classifier metadata (nano/micro/macro/expert). |
| **Batch H — document pipeline** | | |
| `GET /api/nv5/internal/esign/capabilities` | SDK + admin | eSign adapter operations. |
| `GET /api/nv5/internal/esign/session/:sessionId` | SDK + admin | Read a signing session by id. |
| `GET /api/nv5/internal/ocr/capabilities` | SDK + admin | GOT-OCR doc types + qualities. |
| `GET /api/nv5/internal/pdfa/capabilities` | SDK + admin | PDF/A profiles. |
| `GET /api/nv5/internal/watermark/capabilities` | SDK + admin | Watermark types/positions. |
| **Batch I — quality / audit / jurisdiction** | | |
| `GET /api/nv5/internal/hallucination/capabilities` | SDK + admin | Hallucination check types. |
| `GET /api/nv5/internal/escalation/capabilities` | SDK + admin | HITL/admin escalation targets. |
| `GET /api/nv5/internal/event-sourcing/capabilities` | SDK + admin | Event-sourcing adapter info. |
| `GET /api/nv5/internal/jurisdiction-overlay/capabilities` | SDK + admin | Active jurisdictions list. |
| `GET /api/nv5/internal/audit-chain/capabilities` | SDK + admin | Hash-chain verifier ops. |
| **Batch J — adapters / case-mgmt / platform** | | |
| `GET /api/nv5/internal/case-update/capabilities` | SDK + admin | Case-update event types. |
| `GET /api/nv5/internal/azentzero/health` | SDK + admin | Azentzero adapter health probe. |
| `GET /api/nv5/internal/agentzero/capabilities` | SDK + admin | Agentzero circuit-breaker features. |
| `GET /api/nv5/internal/feature-flags/capabilities` | SDK + admin | DB-backed runtime flag-store metadata. |
| `GET /api/nv5/internal/orchestration-facade/capabilities` | SDK + admin | Orchestration-facade metadata only. |

**Files.**
- Barrel: `src/routes/nv5/internal/index.ts`
- Mount: `src/index.ts` line ~685, `app.use('/api/nv5/internal', nv5InternalRouter)`
- Flag: `src/config/nv-feature-flags.ts` → `internalSurface: 'NYV_F_INTERNAL_SURFACE'`

**Auth helpers.** `requireSdkKeyOnly` + `requireScope('admin')` from `src/routes/nv5/_auth.ts`. NV-AUTH-HEADER-001: only `X-API-Key` (or `Authorization: Bearer`).

**Wiring outcome.** Effective orphan count dropped **24 → 1** (raw 26 / allowlisted 25). Budget tightened to `{"max":1}` and CI-enforced via `npm run guardrail:no-new-orphans`.

**Allowlist additions (Session-11 G–J).** `enterprise-platform/index`, `multi-org/index`, `packages/multimodal/index`, `packages/voice/index` (KEEP-DYNAMIC-IMPORT — reached via `await import()` in `services/index.ts` lazy SDK loader), `services/rag/index`, `services/redis-client` (KEEP-BARREL — pure re-export seams), `services/llm-providers/provider-registry` (KEEP-DYNAMIC-IMPORT — pre-existing broken import to missing `google-provider.ts`; tracked NV-FOLLOWUP-PROVIDER-REGISTRY-2026-05-10).

**Archived dead stubs (Session-11 G–J).** `src/packages/protocols/llm-routing-engine.ts` → `archive/2026-05-10-dead-stubs/llm-routing-engine.ts.archived` (8-LOC placeholder; production routing flows through `realLLMService.executeRequest` → `orchestrateLLM` per NV-LLM-001).

**Smoke.**
```bash
curl -sS -o /dev/null -w '%{http_code}\n' \
  -H "X-API-Key: $NYV_SDK_KEY_NSP" \
  http://127.0.0.1:5000/api/nv5/internal/capabilities
# → 404 (flag NYV_F_INTERNAL_SURFACE OFF, default)
```

**Guardrail summary (post-G–J).**
- `auth-header` ✓
- `script-db` ✓
- `api-contract` ✓ — 1223/1223 ops, +0 added / -0 removed
- `no-new-orphans` ✓ — 1 / budget 1 (tightened)

---

## 18. Multi-tenant sub-org model (Task #343, 2026-05-13)

The SDK gateway resolves TWO identities on every call:

| Identity              | Source                              | Where it lands                                |
|-----------------------|-------------------------------------|-----------------------------------------------|
| **Platform**          | `X-API-Key` → `sdk_applications`    | `req.sdkContext.platformId` / `applicationId` |
| **Customer org**      | `X-Customer-Org-Id` header (opaque, platform-asserted, ≤128 chars of `[A-Za-z0-9._:@-]`) | `req.sdkContext.customerOrgId` (auto-provisioned in `nv_customer_organizations`) |
| **Customer-org name** | `X-Customer-Org-Name` (optional)    | `req.sdkContext.customerOrgName`              |
| **Customer user**     | `X-Customer-User-Id` (optional)     | `req.sdkContext.customerUserId`               |
| **Customer email**    | `X-Customer-User-Email` (optional)  | `req.sdkContext.customerUserEmail`            |

### Backwards-compat

If `X-Customer-Org-Id` is absent the gateway resolves to the platform's
**synthetic default** customer org with id `platform_id × 1_000_000`
(seeded by `drizzle/0012_customer_organizations.sql`). Legacy callers
keep working unchanged.

### New endpoints (additive — `5.0.x`, not a major bump)

| Method | Path                                     | Description                                              |
|--------|------------------------------------------|----------------------------------------------------------|
| POST   | `/api/nv/sdk/customer-orgs`              | Idempotent upsert of a customer org. Body: `{ external_ref, display_name?, jurisdiction?, tier?, data_residency?, status?, rate_limit_per_minute?, daily_token_budget?, monthly_token_budget?, allowed_agents?, metadata? }`. `tier` is now strict-validated against `CUSTOMER_ORG_TIERS` (`standard`, `trial`, `professional`, `business`, `enterprise`) — unknown tier → HTTP 400. |
| GET    | `/api/nv/sdk/customer-orgs`              | List the calling platform's customer orgs.               |
| GET    | `/api/nv/sdk/customer-orgs/:id/usage`    | Per-customer-org usage rollup (tokens / cost / requests).|
| GET    | `/api/nv/sdk/customer-orgs/:id/usage/daily` | Day-by-day series for chart rendering (1-90 days).    |
| GET    | `/api/nv/sdk/customer-orgs/:id/limits`   | **(NEW, billing-tiers)** Effective limits for ONE firm = `min(platform tier, customer-org tier+overrides)` per dimension, plus today's usage. |
| GET    | `/api/nv/sdk/platform/limits`            | **(NEW, billing-tiers)** Calling platform's own Tier-0 allotment from Nyayavigya (rate / token budgets / allowed agents+scopes) + today's usage. |
| GET    | `/api/nv/sdk/platform/tiers`             | **(NEW, billing-tiers)** Catalog of named platform AND customer-org tiers (so partner UIs can render a tier picker without hard-coding our matrix). |

All accept the canonical `X-API-Key` header (NV-AUTH-HEADER-001). The
`:id/*` routes 404 if the customer org doesn't belong to the calling
platform — there is no cross-platform read path.

### Two-tier billing model (drizzle/0016_billing_tiers.sql)

Two independent tier dimensions are enforced at min():

| Tier | Stored on | Resolved against | Catalog |
|------|-----------|------------------|---------|
| **Tier 0** — Platform ↔ Nyayavigya  | `sdk_applications.platform_tier` | `PLATFORM_TIERS`     | `standard, starter, growth, scale, enterprise` |
| **Tier 2** — Customer-org ↔ Platform | `nv_customer_organizations.tier` (+ optional per-row overrides on `rate_limit_per_minute`, `daily_token_budget`, `monthly_token_budget`, `allowed_agents`) | `CUSTOMER_ORG_TIERS` | `standard, trial, professional, business, enterprise` |

Effective enforcement at the gateway = `min(platform tier limit,
customer-org tier+override limit)` on every numeric dimension; allowed
agents/scopes are **intersected** (with `[]`/`['*']` meaning "inherit").
See `src/services/nv-billing-tier-service.ts:computeEffectiveLimits`.

Catalogs live in `src/config/nv-billing-tiers.ts`. A future task can
move them into a `nv_billing_tiers` table without touching consumers
(only the tier-name → `BillingTierLimits` contract matters).

### NSP code sample

```ts
// Platform code (NSP) asserting the firm currently using the SDK:
await fetch('https://api.nyayasiddhi.online/api/nv/orchestrate', {
  method: 'POST',
  headers: {
    'X-API-Key':              process.env.NYV_SDK_KEY_NSP,
    'X-Customer-Org-Id':      'sharma-co',                 // firm code
    'X-Customer-Org-Name':    'Sharma & Co Law Firm',      // first-call only
    'X-Customer-User-Email':  'ananya@sharma.in',
    'Content-Type':           'application/json',
  },
  body: JSON.stringify({ /* … */ }),
});
```

### Console RBAC layers

1. `super_admin` — Nyayavigya staff, sees everything.
2. `platform_admin` — partner-platform staff, scoped to one `platform_id`.
3. `customer_org_admin` — admin user inside one customer org.
4. `customer_user` — regular end-user inside one customer org.

The classifier + scope helpers live in
`src/services/rbac/nv-customer-org-rbac.ts`. Apply `scopeForIdentity()`
to any tenant-scoped query as defence-in-depth alongside DB-side RLS.

### Audit identity chain

Every gateway request log now stamps the full chain (in
`sdk_api_request_logs.metadata` and the dedicated `customer_org_id`
column added by 0012):

```
platform=NSP customer_org=Sharma&Co user=ananya@sharma.in
```

### E2E

`scripts/nv-customer-org-isolation-e2e.mjs` exercises the full path:
two upserts, list-only-mine, usage-only-mine, cross-platform 404,
legacy-default still authenticates.

### Per-route audit table — tenant scoping (Task #353, 2026-05-13)

The platform's defence-in-depth posture is: **every tenant-scoped
SELECT/UPDATE/DELETE under `src/routes/**` and `src/services/**` AND-s
in the (`platform_id`, `customer_org_id`) filter for non-platform-admin
callers**, derived via `getRbacIdentityFromRequest(req)` +
`customerOrgScopeSql(...)` from
`src/services/rbac/nv-customer-org-rbac.ts`. Layer rules — uniformly
enforced across the routes below:

- `super_admin` → no extra filter (cross-tenant visibility);
- `platform_admin` → scoped to its `platform_id` (org-only is fine,
  since the platform owns every customer org under it);
- `customer_org_admin` / `customer_user` → **fail-closed**. The query
  AND-s `customer_org_id = $N` when present, and emits `1 = 0` (or its
  drizzle equivalent `FALSE`) when the caller arrives without a
  resolvable `customerOrgId`. This is the explicit defence against the
  "shared platform key" exposure: a JWT reviewer who omits
  `X-Customer-Org-Id` (and whose JWT lacks a customer-org claim) sees
  nothing rather than falling back to org-only scoping.

Routes audited:

| Route                                   | File                                       | platform col      | customer col       | How scoped                                                            |
|-----------------------------------------|--------------------------------------------|-------------------|--------------------|-----------------------------------------------------------------------|
| `GET    /api/nv/sdk/customer-orgs`      | `src/routes/nv-customer-orgs-routes.ts`    | `platform_id`     | `id`               | Already filters by `platform_id = sdkContext.platformId`              |
| `GET    /api/nv/sdk/customer-orgs/:id`  | `src/routes/nv-customer-orgs-routes.ts`    | `platform_id`     | `id`               | 404 when `id` doesn't belong to caller's `platform_id`                |
| `GET    /api/nv/sdk/customer-orgs/:id/usage` | `src/routes/nv-customer-orgs-routes.ts`| `platform_id`     | `customer_org_id`  | Per-org rollup over `sdk_usage_metering`; cross-platform 404         |
| `GET    /api/nv/cam/reviews`            | `src/routes/nv-cam-routes.ts`              | `org_id` (text)   | `customer_org_id`  | **NEW** — `customerOrgScopeSql({ platformIsText: true })`             |
| `POST   /api/nv/cam/reviews/:id/{approve,reject,assign}` | `src/routes/nv-cam-routes.ts` | `org_id` (text) | `customer_org_id` | **NEW** — `assertCamRowAccess()` write-path guard (404 on cross-tenant) |
| `GET    /api/nv/my-approvals`           | `src/routes/nv-my-approvals-routes.ts`     | `q.org_id`        | `q.customer_org_id`| **NEW** — `AND q.customer_org_id = $N` when caller asserts one        |
| `POST   /api/nv/my-approvals/:rid/decision` | `src/routes/nv-my-approvals-routes.ts` | `q.org_id`        | `q.customer_org_id`| **NEW** — row lookup selects `customer_org_id`; pre-existing org/role auth runs, then a tenant guard 404s when caller's `customer_org_id` ≠ the row's. SDK-only callers stay listing-only (403). `super_admin` bypasses. |
| `GET    /api/nv/compliance/{dpdpa,eu-ai-act,grpo}` | `src/routes/nv-compliance-aggregators.ts` | `org_id` (text) | `customer_org_id` | **NEW** — `complianceOrgFilter()` returns `mode='tenant+customer_org'` when caller asserts customer_org_id; DPDPA opts out (view over a non-tenant-tagged source) |
| `GET    /api/nv/compliance/policy-enforcement` | `src/routes/nv-compliance-aggregators.ts` | `org_id` (text on `nv_cam_actions`; integer on `nv_policy_violations`; `metadata->>'orgId'` on `nv_audit_logs`) | `customer_org_id` (cam_actions only) | **NEW** — `camCustomerOrgClause` AND-ed onto the cam-derived counters in tenant mode (fail-closed for customer_org_admin / customer_user without `customerOrgId`). violations + audit-log clauses unchanged (those tables don't carry `customer_org_id`) |
| `GET    /api/nv/policies`               | `src/routes/nv-policies-routes.ts`         | `p.org_id`        | n/a (no col)       | Per-org policies. Aggregate JOINs onto `nv_policy_violations` already org-scoped via `listAggOrgClause()` |
| `GET    /api/nv/policies/:id` (cam_events JOIN) | `src/routes/nv-policies-routes.ts` | `org_id` (text)   | `customer_org_id`  | **NEW** — `customerOrgClause` AND-ed onto `cam_actions` JOIN          |
| `POST   /api/nv/orchestrate` (writes to `sdk_workflow_executions`) | `src/middleware/nv-sdk-tracking-middleware.ts` | `application_id` | `customer_org_id` | tracker writes both columns; reads via `customer-orgs/:id/usage` filter both |

Helpers (single source of truth):

```ts
// src/services/rbac/nv-customer-org-rbac.ts
export function getRbacIdentityFromRequest(req: Request): RbacIdentity;
export function customerOrgScopeSql(
  id: RbacIdentity,
  cols: { platformCol: SQL; customerCol: SQL; platformIsText?: boolean },
): SQL;
```

JWT callers carry `platform_id` on `req.user.orgId` and pick up
`customer_org_id` from `X-Customer-Org-Id` via
`bridgeJwtOrgToSdkContext` (mounted by every JWT-auth tenant route).

Acceptance: extended `scripts/nv-customer-org-isolation-e2e.mjs` runs
the (a) usage / (b) HITL inbox / (c) CAM review-queue cross-leak probe
with two customer orgs (sharma-co, lex-llp) under one platform key.
A passing run prints `0 fail` for the new "no rows tagged
customer_org_id = B" assertions.
