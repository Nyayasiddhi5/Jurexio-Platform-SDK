# 08 — Optimization Pass O1 + O2 + O6 (config-only)

**Status**: ✅ APPLIED 2026-05-08 (NV-OPT-2026-05-08).
**Constraint guardrails respected**: NV-ARCH-001 safety ring untouched · NV-LLM-001 single-router rule untouched · NV-NAMING-001 no new files for existing concepts (this is a NEW concept — optimization pass) · NV-SECRETS-001 no new env-var aliases · API request/response envelopes frozen · live user flows preserved.

---

## O1 — Token optimization (env-driven, zero code logic change)

All RAG / CoT / context knobs live in `src/config/nyv-master-config.ts` as
env-overridable defaults (`NYV_RAG`, `NYV_LLM`). Tuning = setting an env
var; no code edit, no API change, no safety-ring change.

### Recommended tier defaults (apply per environment)

| Tier | `NYV_RAG_TOP_K` | `NYV_RAG_RERANK_TOP_K` | `NYV_RAG_MIN_SIMILARITY` | `NYV_RAG_MAX_CONTEXT_TOKENS` | Notes |
|---|---|---|---|---|---|
| Citizen (NYM) | **5** | 3 | 0.74 | 6 000 | Short answers, mobile bandwidth |
| Pro / Mobile (NSP, NSPM) | 8 | 5 | 0.72 | 10 000 | Lawyer workflows |
| Institutional / Ministry / Academy (NSI/NSM/NSA) | 12 | 6 | 0.70 | 16 000 | Long-form research |
| Enterprise (JRX) | 12 | 8 | 0.68 | 20 000 | Multi-doc consolidation |

These are the **recommended starting points**. Per-tenant override is
always possible via the request body (`req.topK`, `req.minSimilarity`,
`req.maxContextTokens`) — already supported in
`src/services/rag/nyv-rag-pipeline-enhanced.ts:404-407`.

### Token telemetry (already in envelope)

Each response already returns `tokens.input`, `tokens.output`,
`tokens.total`, `qualityScore`, `auditHash` (`src/services/nv-client.ts:1167`,
`:186`). The Console will surface these via O5 (UI-only, pending). No
new fields, no envelope change.

### CoT depth gating

`chain-of-thought-service.ts` already accepts `maxDepth` per call (line
399, 411, 455-458). Production policy:

| Pattern complexity | `maxDepth` | Branching |
|---|---|---|
| Simple lookup (P01–P05) | 2 | 2 |
| Standard reasoning (P06–P14) | 3 | 3 |
| Multi-hop / appellate (P15–P22) | 4 | 3 |

Caller passes the recommended depth via the existing param. No new code.

---

## O2 — LLM orchestration (config-only)

Cascade order is locked in `src/config/nyv-allowed-providers.ts`:
6 ACTIVE providers (anthropic, openai, google, openrouter, sarvam,
bedrock) + AgentZero (priority 99) as the always-on 7th step.

### Re-tune procedure (config-only)

1. Read 7-day audit-hash ledger:
   ```sql
   SELECT provider, pattern_id, jurisdiction,
          count(*) FILTER (WHERE success) AS ok,
          count(*) FILTER (WHERE NOT success) AS fail,
          avg(latency_ms) AS p_avg,
          percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms) AS p95,
          sum(tokens_in + tokens_out) AS tokens
     FROM nv_schema.audit_hash_chain
    WHERE created_at > now() - interval '7 days'
    GROUP BY 1,2,3
    ORDER BY 4 DESC;
   ```
2. Compute composite score per (provider × pattern × jurisdiction):
   `score = 0.5*success_rate − 0.3*norm_p95 − 0.2*norm_cost`
3. Re-order `PROVIDER_MODEL_CATALOG` entries in
   `src/config/nyv-allowed-providers.ts` (a config-only file, not a
   service rewrite). Re-deploy.

This procedure is non-disruptive — `realLLMService.executeRequest`'s
last step `return orchestrateLLM(req)` is unchanged; only the order of
the cascade list is.

### Lockdown still enforced

NV-LLM-001 ripgrep `realLLMService\.executeRequest|new RealLLMService\(`
still resolves only to the 7 whitelisted call sites listed in
`replit.md`. AgentZero auto-fires as the 7th step.

---

## O6 — OCR / multilingual / multimodal verification (additive)

`scripts/nv-smoke-all-platforms.ts` extended with a new
**Section 6b** (7 probes × 7 platforms = 49 additional checks):

| Probe | Path | Expectation |
|---|---|---|
| O6.OCR `ocr/process` | `POST /api/nv/sdk/ocr/process` | 200 \| 4xx graceful |
| O6.ML `translate/batch` | `POST /api/nv/gateway/translate/batch` | 200 \| 400 |
| O6.ML `translate/detect` | `POST /api/nv/gateway/translate/detect-language` | 200 \| 400 |
| O6.MM `multimodal/vision` | `POST /api/nv/sdk/multimodal/multimodal/vision/analyze` | 200 \| 4xx graceful |
| O6.MM `multimodal/rag` | `POST /api/nv/sdk/multimodal/multimodal/rag/query` | 200 \| 400 |
| O6.MM `multimodal/avatar` | `POST /api/nv/sdk/multimodal/multimodal/avatar/create-session` | 200 \| 4xx graceful |
| O6.SR `gateway/usage trace` | `GET /api/nv/gateway/usage?detail=ring` | 200 (proves ring traversal) |

Smoke total moves from **102 → 151 cases**. Re-run nightly.

---

## P1 #6 — MCP tools re-seed (502 vs prior 10)

`scripts/nv-seed-mcp-tools.ts` rewritten 2026-05-08 to import from the
canonical `src/data/nv-mcp-tools-registry.ts` (502 entries across 26
categories × 6 jurisdictions). Replaces the prior 10-row hardcoded list.
Idempotent via `ON CONFLICT (tool_id) DO UPDATE`. Run on Replit dev DB
+ EC2 RDS.

---

## What is NOT changed (by design)

- 22-section Parlant prompt structure
- Response envelope shape (`{ success, requestId, data, metadata }`)
- Safety-ring traversal order (NV-ARCH-001)
- Single-router rule (NV-LLM-001) — no new whitelisted call sites
- Routes / paths / verbs (frozen)
- Per-key SDK scopes (already wide-open via NV-OPEN-TESTING-2026-05-08)
- Console scope (no productivity creep)

---

## Follow-on (deferred — explicit GO required)

- **O3** Agent flow tuning (BM25 score floor + topology fan-out)
- **O4** Console UI (virtualized lists + projection + 60s catalog cache)
- **O5** Frontend chat (skeletons + retry-with-backoff + qualityScore/auditHash badge)

These are queued with the same guardrails. Will land in the next pass
once O1+O2+O6 telemetry stabilises.

---

## Final smoke result — 2026-05-08T12:06Z

**151 / 151 PASS / 0 FAIL / 0 SKIP** vs `https://api.nyayasiddhi.online`
(EC2 i-0df71e5ea1df8f588, image `:proxyfix-20260507T042014Z`).

Per-platform: PUBLIC 11/11, NSP 20/20, NSPM 20/20, NSI 20/20, NSM 20/20,
NSA 20/20, NYM 20/20, JRX 20/20.

Audit ledger: `audit/smoke-all-platforms-2026-05-08T12-06-13-140Z.json`.

### Test-harness adjustments (smoke-only, zero production impact)

Three issues exposed by the wider O6 probe set, all fixed in
`scripts/nv-smoke-all-platforms.ts`:

1. **OCR path correction** — `/api/nv/sdk/ocr/process` (returned 401
   `AUTH_TOKEN_MISSING`) → `/api/nv/gateway/ocr/process`. The OCR
   handler is mounted under `sdkGatewayRoutes` at `/api/nv/gateway`,
   not under the SDK-key middleware path used by other multimodal
   routes. Smoke now hits the correct URL.
2. **Per-IP rate-limit pacing** — sections 1-6 burn through the 120/
   min `authenticatedRateLimit` window (NYV-RATE-002, keyed on IP
   when no JWT). Added a 65 s pause before the new Section 6b O6
   probes so the window resets. Production limits unchanged.
3. **Per-probe `timeoutMs` knob** — slow LLM-backed probes
   (`gateway/research/query`, `multimodal/vision`, `multimodal/rag`)
   were hitting the hard-coded 30 s `AbortSignal.timeout` before the
   server completed real GraphRAG / Sarvam multimodal calls. Added
   `timeoutMs?: number` to the `probe()` arg type, default 30 000 ms,
   bumped to 60 000 ms on the three slow probes. Real latencies in
   the run: research/query 8-45 s, multimodal/rag 39-54 s, multimodal/
   vision <100 ms (returns 400 fast-path on bad URL — graceful).

### MCP catalog parity confirmed

- Registry now has **502 unique `id`s** after architect-flagged
  fix: the duplicate `indic_ocr` (one document-pipeline variant
  + one language-routing variant) was renamed to
  `indic_ocr_language` for the language-category entry. Both
  variants now seed cleanly.
- Replit dev DB `public.nv_mcp_tools`: **502 rows / 26 categories**
  after reseed (legacy dev entries reconciled — registry is now
  source of truth).
- EC2 RDS `public.nv_mcp_tools`: table created via DDL through the
  same SSM session, then seeded from `s3://nsp-deploy-artifacts-
  789925699169-ap-south-1/tmp/nv-mcp-seed.sql.gz` →
  **502 rows / 26 categories**. Full parity with Replit dev.
- Bucket access lesson: the EC2 instance role can read
  `nsp-deploy-artifacts-789925699169-ap-south-1` (PRE clean-deploy/)
  but NOT `nyv-dev-edge-alb-access-logs-…` — use the deploy bucket
  for any future SSM-side downloads.

### O1 / O2 / O6 status

- **O1** RAG/CoT env knobs documented above — code already reads
  them; toggle via Replit Secrets + EC2 `.env.production` when ready.
- **O2** Cascade re-tune procedure documented; no code change.
- **O6** Smoke probes live and passing (49 added cases × 7 platforms +
  7 PUBLIC = 151 total, up from 102 baseline).

