# Partner SDK Release — Ecosystem Integration Pack (2026-05)

> **Audience:** Nyayasiddhi ecosystem platform teams (NSP, NSPM, NSI, NSA, NSM, NYM, JRX) and Nyayavigya ops.
> **Posture:** Dev-live sandbox — not paid production. Policy window through 2026-06-30 per `replit.md`.
> **Canonical API:** `nyayavigya-platform-312/docs/canonical/04-sdk-and-api-canonical-2026-05-07.md`
> **Troubleshooting:** `nyayavigya-platform-312/docs/canonical/04c-sdk-troubleshooting-2026-05-11.md`

---

## 1. Two environments

| Environment | API base | Console | Who runs smoke |
|-------------|----------|---------|----------------|
| **EC2 (partner handoff)** | `https://api.nyayasiddhi.online` | `https://console.nyayasiddhi.online/console/…` | Ops before each handoff |
| **Cursor / local** | `http://127.0.0.1:5000` | `http://127.0.0.1:3004/console/…` | Engineers during integration |

```bash
cd nyayavigya-platform-312

# Local infra (optional)
npm run infra:local:up
# merge nyayavigya-platform-312/.env.local.example → .env

# Local gateway + console (two terminals)
npm run dev
bash scripts/nv-start-console.sh

# Partner smoke
npm run partner:smoke:local    # http://127.0.0.1:5000
npm run partner:smoke:ec2     # https://api.nyayasiddhi.online
```

---

## 2. What partners receive (zip contents)

| Asset | Path in repo |
|-------|----------------|
| SDK tarballs (v5.0.0) | `nyayavigya-platform-312/sdk-dist/v5.0.0/*.tgz` + `SHA256SUMS` |
| API canonical | `docs/canonical/04-sdk-and-api-canonical-2026-05-07.md` |
| Error / retry guide | `docs/canonical/04c-sdk-troubleshooting-2026-05-11.md` |
| Web quickstart | `examples/nsp-web-quickstart/` |
| OpenAPI (live) | `GET https://api.nyayasiddhi.online/api/nv/docs` |
| This pack | `documents/working/PARTNER-SDK-RELEASE-2026-05.md` |
| **All-platform integration guide** | `documents/working/ECOSYSTEM-SDK-INTEGRATION-GUIDE-2026-07.md` |
| Keys | **Out of band only** (Bitwarden / 1Password) — see `NSP-API-KEYS-HANDOVER.md` |

### Install (server-side Node 22+)

```bash
mkdir -p vendor
cp sdk-dist/v5.0.0/*.tgz vendor/
shasum -a 256 -c sdk-dist/v5.0.0/SHA256SUMS   # from repo root of tarballs
npm install ./vendor/nyayavigya-types-5.0.0.tgz \
            ./vendor/nyayavigya-client-sdk-5.0.0.tgz
```

| Platform SKU | Recommended packages |
|--------------|---------------------|
| NSP | `types` + `client-sdk` |
| NSPM | `types` + `client-sdk-react-native` |
| NSI, NSM, JRX | `types` + `client-sdk` or `enterprise-sdk` |
| NSA | `types` + `client-sdk` (read-heavy; no `documents:write` when granular scopes restored) |
| NYM | `types` + `nyayamitra-sdk` |

---

## 3. Auth & base URL (mandatory)

```http
X-API-Key: nyv_live_sk_<your-platform-key>
Content-Type: application/json
```

Fallback (supported): `Authorization: Bearer nyv_live_sk_…`

**Do not** use deprecated headers: `X-NV-SDK-Key`, `X-SDK-Key`, `X-Platform-Key`.

**Base URL:** `https://api.nyayasiddhi.online` (EC2) or `http://127.0.0.1:5000` (local).

Browser apps: **never** ship the raw key to the client. Proxy via your backend (see `examples/nsp-web-quickstart/src/app/api/nyv-proxy/`).

---

## 4. Minimum API smoke (per platform)

Script: `nyayavigya-platform-312/scripts/nv-partner-smoke.sh`

| Step | Method | Path | Auth |
|------|--------|------|------|
| 1 | GET | `/api/nv/health` | none |
| 2 | GET | `/api/nv/gateway/health` | X-API-Key |
| 3 | GET | `/api/nv/v1/sdk/llm/catalog` | X-API-Key |
| 4 | GET | `/api/nv/gateway/agents` | X-API-Key |
| 5 | POST | `/api/nv/gateway/research/query` | X-API-Key (LLM) |
| 6 | GET | `/api/nv/knowledge/plane/health` | X-API-Key (NYS) |
| 7 | POST | `/api/nv/knowledge/search` | X-API-Key (NYS / `nys_global`) |
| 8 | GET | `/api/nv/legal-work/tasks` | X-API-Key |
| 9 | POST | `/api/nv/orchestrate` | X-API-Key (BNS golden + RAG) |

**Shared keys (integration):** `NYV_SDK_SHARED_KEYS=1` or `source .local/secrets/ecosystem-shared-integration.env` so all SKUs use one key until production rotation.

Env vars (gateway / your `.env`):

`NYV_SDK_KEY_NSP`, `NYV_SDK_KEY_NSPM`, `NYV_SDK_KEY_NSI`, `NYV_SDK_KEY_NSA`, `NYV_SDK_KEY_NSM`, `NYV_SDK_KEY_NYM`, `NYV_SDK_KEY_JRX`

Full matrix (140 cases): `node scripts/nv-sdk-platform-e2e.mjs` with `NV_BASE_URL` set.

**EC2 rate limits:** Production edge does **not** honor `NV_E2E_BYPASS`. Run smokes sequentially; expect 429 if you parallelize heavily.

---

## 5. Console — ops management (not full product tour)

SPA base path: **`/console`**. Always use prefixed URLs.

| Demo step | URL | Role (min) |
|-----------|-----|------------|
| SDK overview | `/console/sdk-hub?tab=overview` | user |
| Download builds | `/console/sdk-hub?tab=downloads` | developer |
| Issue / rotate keys | `/console/sdk-hub?tab=keys` | org_admin |
| Platform onboarding | `/console/sdk-hub?tab=onboarding` | developer |
| API playground | `/console/sdk-hub?tab=playground` | developer |
| Customer law firms | `/console/customer-orgs` | per `CUSTOMER_ORGS_MIN_ROLE` |
| Platform registry | `/console/platform-management` | org_admin+ |
| Super-orgs (enterprise) | `/console/superadmin/super-orgs` | super_admin |

**Out of scope for partner week:** stub pages (“Coming in next release”), Universal Chat stub mode, GRPO 16-line stub, superagent/* placeholders.

Demo login (hosted): see root `README.md` — rotate before external auditors if needed.

---

## 6. Ops checklist before handoff

### EC2

- [ ] `curl -s https://api.nyayasiddhi.online/api/nv/health` → 200
- [ ] `npm run partner:smoke:ec2` → all platforms PASS (keys in ops `.env` or exported)
- [ ] Keys minted / rotated: `nv-refresh-demo-sdk-bundle.ts` on gateway container (see `04-sdk` § task-150)
- [ ] Post-deploy: if edge 502, reconnect gateway bridge + `docker compose restart console` (`EC2-INTEGRATION-STATUS.md`)
- [ ] Tracker row + secure key delivery to each platform lead

### Cursor local

- [ ] `npm run infra:local:up` (optional)
- [ ] `.env` has DB, Redis, JWT, PII key, seven `NYV_SDK_KEY_*`, one LLM provider key
- [ ] `npm run dev` + console on 3004
- [ ] `npm run partner:smoke:local` → PASS
- [ ] `npm run e2e` (console shell routes) optional

### Cursor dev deploy to EC2

- From `nyayavigya-platform-312/`: `npm run dev:deploy:ec2`
- Wrapper path: `nyayavigya-platform-312/scripts/nv-dev-deploy-ec2.sh`
- Env loader path: `nyayavigya-platform-312/scripts/nv-source-dev-deploy-env.sh`
- AWS deploy credentials are read quietly from `product Documents/env.production`; no values are printed
- Optional SDK key auto-load uses `.local/secrets/deploy-bundle.env` first, then `.local/secrets/runtime.env` if you extract the deploy bundle env once
- If `aws` is missing locally: `brew install awscli`
- Rotate keys before any production use

---

## 7. Support & errors

- Every error returns `requestId` — include in support tickets (`04c` §3).
- Retry: ≤3 attempts, exponential backoff, honour `Retry-After` on 429.
- 4xx = fix request; 5xx = retry with backoff.

---

## 8. Key rotation on EC2 (ops only)

```bash
# On EC2 gateway container (requires deploy access + explicit user GO)
docker exec nyv-gateway sh -c 'cd /app && NYV_PLATFORM_ENV=production npx tsx /app/scripts/nv-refresh-demo-sdk-bundle.ts'
```

Copy new values from `.local/run/sdk-bundle-demo-*.txt` (mode 0600) into SSM / `.env.production` — **never** commit. Log timestamp in `Project-Tracker.md`.

---

## 9. Orchestration timeouts & AdaptiveRouter (2026-07-30)

Partners must set **`orchestrateTimeoutMs ≥ 540000`** (9 minutes) for hierarchical / multi-agent Queen calls. Edge ALB is **600s**.

| Path | When | Client tip |
|---|---|---|
| `specialist` | lean / simple | Default 60s SDK timeout OK |
| `doc-pipeline` | OCR / parse / compare | Prefer sync; long OCR may need 120s+ |
| `queen` | research / multi-agent modes | Use `orchestrateTimeoutMs: 540000` |

Response fields to assert in UAT: `routing.path`, `qualityEnvelope`, `osDepth`.

Full matrix: `documents/working/NYV-PRODUCTION-READINESS-TIMEOUTS-HA-SOC2-2026-07.md`

*Tracker: 2026-07-30T05:15:00Z*

---

## 10. Queen provisional → gated replace contract (2026-07-30)

Stream (`nyv.orchestrate.stream` / `/api/nv/v1/sdk/orchestrate/stream`):

| Phase | Flags | Client action |
|---|---|---|
| Provisional | `provisional: true` | Paint for latency UX only |
| Gated | `provisional: false`, `gated: true` | **Replace** UI buffer (do not append onto provisional) |
| Final | `synthesis_final` / `run_completed` | Authoritative result |

`@nyayavigya/client-sdk@5.0.6` `NyvStreamReader` resets accumulation on the first gated event. Hand-rolled clients must match. Gateway ops: `NYV_QUEEN_SUPPRESS_PROVISIONAL=1` skips provisional tokens.

*Tracker: 2026-07-30T18:30:00Z*

---

*Tracker: 2026-05-25T14:00:00Z — Partner SDK release pack authored.*
