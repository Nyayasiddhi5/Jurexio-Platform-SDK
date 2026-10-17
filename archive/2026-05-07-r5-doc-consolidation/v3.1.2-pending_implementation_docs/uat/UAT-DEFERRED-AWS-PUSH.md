---
status: pending
version: 3.2
superseded_by: null
last_verified: 2026-04-25
---
# Nyayavigya UAT v3.2 — DEFERRED to post-AWS-push verification

**Status:** UAT execution paused at user request to first push code to AWS dev environment and verify there before running concurrent-session UAT at scale.

**Date deferred:** 2026-04-25
**Last full local UAT run:** 2026-04-25 07:09–07:15 UTC
**Last result:** 181 / 223 pass = **81.2%** on real LLM (Anthropic claude-opus-4-6)
**Artifacts:**
- `docs/v3.1.2/pending_implementation_docs/uat/results.json` — machine-readable per-scenario results
- `docs/v3.1.2/pending_implementation_docs/uat/NYV-UAT-v3.2-COMPREHENSIVE.md` — full per-scenario record
- `docs/v3.1.2/pending_implementation_docs/uat/NYV-UAT-v3.2-SUMMARY.md` — auto-generated overall + per-category roll-up

---

## Why we paused

The user wants to:
1. Push the current code to AWS dev environment.
2. Smoke-test it personally on AWS.
3. Then re-run the 223-scenario UAT pack at scale with concurrent sessions on AWS infrastructure (not the dev container).

Running 223 LLM-backed scenarios at concurrency=6 already tripped the
upstream Anthropic circuit breaker once near the end of the local run
("All providers failed. Original error: Breaker is open"). AWS infra with
proper provider-pool sizing and rate-limit headroom is the right place
for a stress-grade re-run.

---

## How to re-run the same UAT pack on AWS dev

### 1. Prerequisites on the AWS host

```bash
# Database migrations (idempotent; safe to re-run)
DATABASE_URL=<aws_db_url> npx tsx scripts/nv-migrate.ts

# Demo users (super_admin + 5 role users; password: <operator-managed>)
DATABASE_URL=<aws_db_url> npx tsx scripts/nv-seed-users.ts

# SDK applications + per-platform live/test keys (rotates each run)
DATABASE_URL=<aws_db_url> npx tsx scripts/nv-provision-ecosystem.ts \
  --rotate --print-raw-keys
# COPY the printed keys IMMEDIATELY into the AWS Secrets Manager / .env;
# they are NOT shown again.
```

### 2. Required env vars

| Var | Value | Notes |
|---|---|---|
| `NV_UAT_EMAIL` | `admin@nyayavigya.in` | seeded super-admin |
| `NV_UAT_PASSWORD` | `<operator-managed>` | seeded demo password (override per-env) |
| `NV_UAT_LAWYER_EMAIL` | `dev@demo.nyayavigya.in` | role: developer |
| `NV_UAT_CITIZEN_EMAIL` | `user@demo.nyayavigya.in` | role: user |
| `NV_UAT_COUNSEL_EMAIL` | `manager@demo.nyayavigya.in` | role: manager |
| `NV_UAT_PARALEGAL_EMAIL` | `analyst@demo.nyayavigya.in` | role: analyst |
| `NV_UAT_SDK_KEY_NSP_WEB` | `nyv_live_sk_nsp_…` | NYS-Pro live key |
| `NV_UAT_SDK_KEY_NSP_MOBILE` | `nyv_live_sk_nsp_…` | same key, mobile variant |
| `NV_UAT_SDK_KEY_NYM_MOBILE` | `nyv_live_sk_nym_…` | Nyayamitra live key |
| `NV_API_KEY` | `nyv_live_sk_nsp_…` | inter-secret + SDK fallback |
| `NYV_UAT_BASE` | `https://<aws-dev-host>` | gateway base URL |

### 3. Run the pack

```bash
cd nyayavigya-platform-312
npx tsx scripts/nv-run-uat.ts --mode=run --concurrency=6
# concurrency=6 is the sweet spot at our current LLM rate-limits;
# bump to --concurrency=12 only after raising Anthropic burst quota.
```

### 4. Optional: filter / limit during smoke

```bash
# Only run jurisdiction tests (35 scenarios, ~3 min)
npx tsx scripts/nv-run-uat.ts --mode=run --filter=jurisdiction

# Only first 20 scenarios (smoke check)
npx tsx scripts/nv-run-uat.ts --mode=run --limit=20
```

---

## What the runner does (multi-user / multi-SDK execution)

The reviewer's v3.2 reject was rooted in single-user / single-SDK execution.
The runner now:

1. **Logs in as 5 distinct demo users** in parallel (super-admin, lawyer-pro,
   citizen-mitra, enterprise-counsel, paralegal). Each scenario's
   `userRole` field selects which JWT to attach — so authorization layers
   are exercised distinctly, not collapsed onto one super-admin token.

2. **Routes SDK-key scenarios through 3 distinct SDK variants**
   (nsp-web, nsp-mobile, nyayamitra-mobile). Each variant has its own
   `NV_UAT_SDK_KEY_*` env. The gateway access log records the variant via
   the `X-SDK-Variant` request header.

3. **Skips scenarios with missing keys instead of failing them**
   (`status: "skipped"` with explicit reason; excluded from the pass-rate
   denominator). This prevents conflating "test infra not bound" with
   "code defect".

4. **No env-setup → deferred relabeling.** Fails stay fails until the
   underlying code is fixed. The `resolution` overlay only documents the
   planned remediation owner; it does not change the visible status.

5. **Orchestrate scenarios get a 120 s timeout floor** (was 30 s). The
   upstream LLM regularly returns at 40–60 s on cold routes, so 30 s was
   producing false `blocked` failures.

---

## Last run breakdown (2026-04-25, local dev container)

### Overall

| status | count | pct of executed |
|---|---|---|
| pass    | 181 | 81.2% |
| fail    |  42 | 18.8% |
| blocked |   0 | 0.0% |
| skipped |   0 | _(none — all SDK keys bound)_ |

### Per-category

| category | total | pass | fail | pass% | notes |
|---|---|---|---|---|---|
| agui | 15 | 15 | 0 | 100% | ✓ |
| collective-intelligence | 10 | 10 | 0 | 100% | ✓ |
| failure-modes | 10 | 10 | 0 | 100% | ✓ |
| gate-bias | 4 | 4 | 0 | 100% | ✓ |
| gate-citation | 6 | 6 | 0 | 100% | ✓ |
| gate-hallucination | 4 | 4 | 0 | 100% | ✓ |
| jurisdiction | **35** | **35** | **0** | **100%** | All 7 jurisdictions × 5 verticals — real LLM responses |
| ocr | 15 | 15 | 0 | 100% | ✓ |
| pattern | 18 | 18 | 0 | 100% | All 6 orchestration patterns |
| rag | 20 | 20 | 0 | 100% | ✓ |
| compliance | 10 | 8 | 2 | 80% | DPDPA evidence chain edge cases |
| memory | 15 | 11 | 4 | 73% | L4/L5 promotion on cold runs |
| hitl | 10 | 7 | 3 | 70% | Decision routing for low-confidence cases |
| sdk-gateway | 25 | 18 | 7 | 72% | Some platform-bound checks need AWS-side config |
| gate-hitl-route | 6 | 0 | 6 | 0% | HITL routing config gap (single root cause) |
| multi-language | 10 | 0 | 10 | 0% | Translation module not wired in dev container |
| voice | 10 | 0 | 10 | 0% | STT/TTS provider keys not bound in dev container |

### Known root causes for 42 fails (3 clusters → fix once each)

1. **multi-language (10) + voice (10) = 20 fails**: dev container is missing
   the translation module config and STT/TTS provider keys. AWS dev should
   have these bound; expect both categories to flip to ~100% post-AWS.
2. **gate-hitl-route (6)**: HITL decision-router needs a routing-rules row
   per jurisdiction. Tracked in follow-up #48.
3. **sdk-gateway (7) + memory (4) + hitl (3) + compliance (2) = 16 fails**:
   long-tail bugs already triaged in `docs/v3.1.2/pending_implementation_docs/uat/resolutions.json`.

If clusters 1 + 2 alone clear on AWS (which they should — they're env-only),
expected AWS pass rate jumps to **(181 + 26) / 223 = 92.8%**, with the
remaining 16 being real code-side fixes that this task documented but did
not attempt to chase further.

---

## Confirming end-to-end orchestration on AWS

A single sanity probe to confirm the **request → real LLM → agent → Queen
orchestration → response** chain on AWS dev:

```bash
JWT=$(curl -s -X POST $NYV_UAT_BASE/api/nv/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@nyayavigya.in","password":"<operator-managed>"}' \
  | jq -r .token)

curl -s -X POST $NYV_UAT_BASE/api/nv/orchestrate \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  --max-time 90 \
  -d '{
    "prompt":"A landlord in Mumbai gave 24-hour eviction notice for non-payment of one month rent. Tenant has paid promptly for 3 years. What protections does the tenant have under the Maharashtra Rent Control Act?",
    "userId":"admin",
    "jurisdiction":"IN",
    "agentKey":"in-tenancy-001",
    "orchestrationMode":"queen-v2"
  }' | jq '{model, provider, agent, orchestrationMode, tokens, latencyMs, confidence, response_first_200: (.response // "" | .[0:200])}'
```

Expected (verified locally on this exact code at 07:00–07:15 UTC):
- `model`: `claude-opus-4-6`
- `provider`: `anthropic`
- `tokens`: 950–980
- `latencyMs`: 35,000–60,000
- `confidence`: ~0.82
- Body: structured legal analysis with 5-step CoT, bias score 0.00.
