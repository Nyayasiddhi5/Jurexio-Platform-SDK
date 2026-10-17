---
status: live
version: 5.0.1
audience: ML engineers, SRE, cost-control, integration partners
last_updated: 2026-05-11 (Session-15 v13 — Phase 6 doc closure)
authority: NV-DOC-001 — dedicated canonical for LLM provider + routing model
expands: `05-config-directories-2026-05-07.md` § Provider lockdown (kept for env-name reference) and `00-README.md` § Provider lockdown
---

# Nyayavigya Platform — LLM Routing & Provider Catalogue (Dedicated Canonical)

> **The single screen-source for: which providers are wired, which models are catalogue-active, how the router picks one model per request, how fallback chains work, and the exact recipe for activating a 7th provider.**

---

## 1 — Active provider matrix (verified 2026-05-11)

| # | Provider | Code | Models in catalogue | Auth env | Status | Notes |
|---|---|---|---|---|---|---|
| 1 | Anthropic | `anthropic` | 12 (Claude 4.x family + 3.x legacy) | `ANTHROPIC_API_KEY` | ✅ active | primary for legal reasoning |
| 2 | OpenAI | `openai` | 18 (GPT-5.x, o-series) | `OPENAI_API_KEY` | ✅ active | primary for synthesis |
| 3 | Google | `google` | 11 (Gemini 2.5, 1.5 fallback) | `GOOGLE_API_KEY` / Vertex creds | ✅ active | strong long-context |
| 4 | OpenRouter | `openrouter` | 36 (multiplex incl. Claude/GPT/Gemini at higher cost) | `OPENROUTER_API_KEY` | ✅ active | safety-net + frontier coverage |
| 5 | Sarvam | `sarvam` | 7 (Indic SLM + ASR + TTS) | `SARVAM_API_KEY` | ✅ active | **carve-out for 22 Indic languages** |
| 6 | AWS Bedrock | `bedrock` | 14 (Titan + Nova + bedrock-Anthropic) | `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` | ✅ active | sovereign + IN-region |
| 7 | Groq | `groq` | (catalogue ready, key absent) | `GROQ_API_KEY` | 🟡 silent-skip | speed tier — activate when key set |
| 8 | Perplexity | `perplexity` | (catalogue ready, key absent) | `PERPLEXITY_API_KEY` | 🟡 silent-skip | research / citations tier |
| 9 | xAI (Grok) | `xai` | (catalogue ready, key absent) | `XAI_API_KEY` | 🟡 silent-skip | |
| 10 | DeepSeek | `deepseek` | (catalogue ready, key absent) | `DEEPSEEK_API_KEY` | 🟡 silent-skip | |
| 11 | Mistral | `mistral` | (catalogue ready, key absent) | `MISTRAL_API_KEY` | 🟡 silent-skip | EU-resident option |
| 12 | Cohere | `cohere` | (catalogue ready, key absent) | `COHERE_API_KEY` | 🟡 silent-skip | embeddings-strong |
| 13 | AgentZero (sovereign) | `agentzero` | (1, internal) | platform-local | ✅ active | sovereign / on-prem fallback |

**Total catalogue rows live in `nv_models_catalogue`: 113.**

---

## 2 — Provider lockdown — activation recipe

To activate a new provider end-to-end (e.g. Groq):

```bash
# 1. Set the env var (Replit Secrets or EC2 systemd env file)
export GROQ_API_KEY=<key>

# 2. Re-seed the model catalogue
npx tsx scripts/nv-seed-models.ts --provider=groq

# 3. Flip is_active for the provider rows in nv_models_catalogue
psql "$NYV_DATABASE_URL" -c \
  "UPDATE nv_models_catalogue SET is_active = TRUE WHERE provider = 'groq';"

# 4. Restart gateway
bash scripts/nv-start-dev.sh   # dev
bash scripts/deploy-replit-ssm.sh  # prod
```

Verification:

```bash
curl "$NYV_DEV_URL/api/nv/observability/router-stats" \
  | jq '.health[] | select(.provider == "groq")'
```

If the provider row appears with `status: "ok"`, the router is now eligible to pick a Groq model whenever the selection function ranks it top.

---

## 3 — Selection algorithm (deterministic, NOT LLM-driven)

Every LLM emission terminates at `intelligent-router/orchestrateLLM`. The selection function `pickModel(req, ctx)` evaluates each catalogue model with the following score (lower = better):

```
score(model) =  α · cost_per_1k(model)             // budget
              + β · latency_p50_ms(model) / 100     // speed
              + γ · (1 − jurisdiction_fit(model))   // legal accuracy
              + δ · (1 − provider_health_now)       // ops risk
              + ε · (1 − recent_success_rate)       // quality drift
              + carve_outs                          // hard rules
```

Default weights (tunable per `NYV_F_ROUTER_WEIGHTS_*`):

| Symbol | Default | Meaning |
|---|---|---|
| α | 0.40 | cost dominance — prevents runaway spend |
| β | 0.15 | latency factor — biases toward fast responses |
| γ | 0.30 | jurisdiction fit — IN agents prefer Sarvam/IN-tuned, EU prefers Mistral when active |
| δ | 0.10 | provider health — shifts away from a degrading vendor |
| ε | 0.05 | quality drift — captures regressions caught by `nv-drift-monitor` |

### Carve-outs (hard rules, override the score)

1. **Indic-language input → Sarvam.** Any request whose detected language ∈ {hi, ta, te, kn, ml, mr, gu, bn, pa, or, as, ur, sa, ne, si, …22 total} routes to Sarvam first; Sarvam-failure falls back to Anthropic with `system: indic-translation-prelude`.
2. **Indian sovereignty mode** (`NYV_F_SOVEREIGN_IN=on`) → Bedrock + AgentZero only. No data egress to US/EU providers.
3. **Long context > 200k tokens** → Gemini-2.5-pro or Claude-4.x with 200k context window. GPT-5.x and Sarvam are excluded (smaller context).
4. **Tool-use required** → providers without function-calling support (Sarvam SLMs) are excluded.
5. **Hash-chain audit replay** → uses the exact provider+model recorded in the original audit row, regardless of current ranking.

---

## 4 — Fallback chains (deterministic)

When the chosen model returns 5xx / 429 / timeout / safety-block, the router walks a deterministic chain:

| Tier | Primary chain | Used when |
|---|---|---|
| Frontier reasoning | `anthropic.claude-4.5-opus` → `openai.gpt-5.x-pro` → `google.gemini-2.5-pro` → `openrouter.anthropic/claude-4.5-opus` | complex CoT / ToT planning |
| Synthesis | `anthropic.claude-4.5-sonnet` → `openai.gpt-5.x` → `google.gemini-2.5-flash` | response engineering |
| Indic | `sarvam.indic-llm-v2` → `anthropic.claude-4.5-sonnet` (with translation prelude) | non-EN inputs |
| Cheap | `google.gemini-2.5-flash` → `openai.gpt-5.x-nano` → `anthropic.claude-4.5-haiku` | classification, routing meta-decisions |
| Sovereign | `agentzero.local` → `bedrock.titan-large-v3` → `bedrock.anthropic.claude-4.5-sonnet` | `NYV_F_SOVEREIGN_IN=on` |

Chain exhaustion → 503 to caller with `error.code = LLM_PROVIDER_EXHAUSTED` and the full attempted chain in `error.attempts[]`.

---

## 5 — Cost-aware router (`cost-aware-router`)

Wired Session-11 G. Tracks rolling per-org / per-key spend in Redis with a 1-hour bucket and a 24-hour bucket. When `monthly_cap_usd` (per `nv_organizations.llm_routing.monthly_cap_usd`) projects to be exceeded:

1. **Soft-throttle** at 80% — biases the score toward the cheap chain.
2. **Hard-cap** at 100% — returns 402 Payment Required unless `NYV_F_ALLOW_OVERAGE=on` (super_admin override) is set.
3. **Audit** — every cap-influenced decision appends to `nv_billing_activity_log` for the customer-visible monthly bill.

Console surface: `/cost-optimizer` (Session-12 v4 build).

---

## 6 — Provider health (`nv-provider-health`)

Every provider invocation populates a sliding window in `nv_provider_health_window`:

```sql
{provider, model, ok_count_5m, err_count_5m, p50_ms_5m, p95_ms_5m, last_seen_at}
```

`/api/nv/observability/router-stats` returns the per-model `health[]` array consumed by:
- The cost-optimizer dashboard (`/cost-optimizer`)
- The provider-failover dashboard (`/superadmin/provider-failover` — Session-15 v11)

Health states:
- **ok** — `err_rate_5m < 5%` AND `p95_ms_5m < 8000`
- **degraded** — `5% ≤ err_rate_5m < 25%` OR `8000 ≤ p95_ms_5m < 30000`
- **down** — `err_rate_5m ≥ 25%` OR `p95_ms_5m ≥ 30000`

The `down` state forces the router to skip the model in selection until the next 5-minute window.

---

## 7 — Per-org LLM routing override

Per `nv_organizations.llm_routing` JSONB column:

```json
{
  "primary":         "anthropic.claude-4.5-sonnet",
  "fallback":        "openai.gpt-5.x",
  "budget_mode":     "balanced",        // strict | balanced | unconstrained
  "monthly_cap_usd": 5000
}
```

The router treats `primary` as a `+0` score bonus and `fallback` as `+5` (so it ranks ahead of equivalents but doesn't override carve-outs). `budget_mode = strict` doubles the α weight; `unconstrained` halves it (super_admin only).

Edited via `/org-platform-settings` page (existing).

---

## 8 — Drift monitoring & quality regression

`services/nv-drift-monitor.ts` runs an hourly job that:
1. Samples 50 recent prompts per agent.
2. Re-runs them through each candidate provider.
3. Scores against the original response (cosine + ROUGE-L + legal-citation overlap).
4. If any provider drops > 8% on the rolling 7-day median, surfaces an alert in `/agent-activity` and reduces the ε term in the score for that provider.

Console: `/agent-activity` (existing).

---

## 9 — What's NOT done in the LLM layer

- **No fine-tuning.** All adaptation is via prompts + RAG + agent registry. (GRPO is a *reinforcement-learning style feedback* loop on agent selection, not on model weights — see `/orchestration/grpo` Session-15 v12.)
- **No on-the-fly model deployment.** Adding a new SLM still requires a code change in `src/services/llm-providers/*` + `provider-registry`.
- **No streaming-token cost prediction.** Cost is finalised at response close, not predicted up-front. Soft-throttle is reactive, not predictive.

---

*End of LLM dedicated canonical. Companion: `05-config-directories-2026-05-07.md` for env-var matrix; `00-README.md § Provider lockdown` for legacy activation recipe.*
