# OmniRoute Security + DPA Review — Nyayavigya Platform

> **Status:** Draft for legal/ops review.   
> **Date:** 2026-07-25   
> **Owner:** Cursor Agent / CTO-AI architect   
> **Scope:** Evaluation of OmniRoute (`diegosouzapw/OmniRoute`) as a last-mile LLM gateway for the Nyayavigya (NYV) LLM orchestration.

---

## 1. Purpose and scope

OmniRoute is integrated into NYV as a **last-mile fallback/cost-saver**, never as the core routing engine. It is invoked only after NYV’s own provider cascade (Bedrock, Gemini, direct frontier, OpenRouter) has failed or when NYV explicitly routes a low-cost, non-critical request to it. This document records the security, privacy, and compliance assessment required before any production PII-classified content is routed through OmniRoute.

## 2. Integration posture (NYV retains control)

| Control | NYV behavior | Evidence |
|---|---|---|
| Routing authority | NYV `intelligent-router` still ranks providers, builds sequences, and selects models. OmniRoute aliases are last-resort before `agentzero`. | `src/services/intelligent-router/default-sequences.ts` |
| Fallback | If OmniRoute fails, the cascade continues to the next candidate and ultimately `AgentZero`. | `src/services/intelligent-router/llm-orchestrator.ts` |
| Gate | OmniRoute is only reachable when `OMNIROUTE_API_KEY` is configured; `NYV_OMNIROUTE_ENABLED=false` disables it explicitly. | `src/services/intelligent-router/model-catalog.ts` |
| Platform filter | `NYV_OMNIROUTE_ALLOWED_PLATFORMS` restricts which ecosystem tenants can include OmniRoute in their cascade. | `src/config/nv-llm-routing-policy.ts` |
| Sensitivity floor | `sensitivity: 'critical'` is blocked from OmniRoute at the adapter level; PII/tokenization must be applied upstream by NYV. | `src/services/intelligent-router/nv-omni-route-provider.ts` |
| Audit | Every OmniRoute request logs alias, budget, upstream model, tokens, cost, and platform tag. | `src/services/intelligent-router/nv-omni-route-provider.ts` |
| Cost control | `X-OmniRoute-Budget` header and `maxCostUsd` per request cap spend. | `src/services/intelligent-router/nv-omni-route-provider.ts` |

## 3. Data classification and PII handling

- **Allowed for OmniRoute:** Content classified as `low`, `medium`, or `high` sensitivity **after** NYV PII detection/tokenization has been applied. This typically includes sanitized legal research questions, generic statute lookups, contract clause summaries, and jurisdiction-neutral drafting prompts.
- **Blocked from OmniRoute:** `critical` sensitivity content and any prompt that has not passed NYV PII/tokenization.
- **Requirement:** Before production use, the DPDPA/SOC2 data flow review must confirm that the categories above align with Nyayavigya’s data classification policy and that tokenization is irreversible and auditable.

## 4. Sub-processor / DPA checklist

| Item | Status | Notes |
|---|---|---|
| Vendor entity and location | **PENDING** | OmniRoute is an open-source project (`diegosouzapw/OmniRoute`). Legal must confirm whether production traffic is processed by OmniRoute-hosted infrastructure or self-hosted, and the jurisdiction of that infrastructure. |
| DPA / data processing agreement | **PENDING** | If OmniRoute is used as a hosted service, a signed DPA covering India DPDPA 2023, GDPR, and any customer jurisdiction is required. |
| Sub-processor notification | **PENDING** | Add OmniRoute to the NYV sub-processor list in customer contracts and the public trust page once approved. |
| Encryption in transit | **NEEDS VERIFICATION** | All calls must use TLS 1.2+. The default `OMNIROUTE_BASE_URL=https://api.omniroute.ai/v1` must be verified for TLS posture. |
| Encryption at rest | **PENDING** | Verify OmniRoute does not persist prompts or outputs beyond ephemeral caching needed for the request. |
| Retention / deletion | **PENDING** | Confirm zero or minimal retention of prompt/response data; align with NYV retention schedule. |
| SOC2 / ISO 42001 evidence | **PENDING** | Request compliance artifacts from OmniRoute maintainers or, if self-hosted, map controls to NYV’s own SOC2/ISO 42001 evidence. |
| AI Act / high-risk AI | **PENDING** | Legal use cases may be high-risk under EU AI Act. Document that NYV is the provider of the high-risk system and OmniRoute is a sub-processor for raw LLM compute only. |

## 5. Operational safeguards

1. **Production enablement:** On any environment where `OMNIROUTE_API_KEY` is set, OmniRoute will be included in the fallback cascade. Operators must intentionally set `NYV_OMNIROUTE_ENABLED=false` to keep it out.
2. **Rate limiting and quotas:** Add a per-tenant OmniRoute cost/usage budget after the first 30 days of usage data.
3. **Monitoring:** Alert on `provider='omniroute'` usage spikes, latency, cost per request, and upstream model distribution.
4. **Incident response:** If OmniRoute leaks data or experiences a security incident, disable it globally by unsetting `OMNIROUTE_API_KEY` or setting `NYV_OMNIROUTE_ENABLED=false`, then rotate the API key.
5. **Key handling:** `OMNIROUTE_API_KEY` must be stored in `.local/secrets/` or AWS Secrets Manager, never in the repository or deploy tarball.

## 6. Recommended go/no-go gates

- **GO for non-prod smoke testing:** Enable with a test key, limited platform allowlist, and synthetic data only.
- **GO for production legal-content routing:** Only after DPA is signed, PII/tokenization pipeline is verified end-to-end, SOC2/ISO 42001 evidence is reviewed, and the first 2 weeks of non-prod metrics show stable cost/latency.
- **NO-GO for critical-sensitivity data:** Permanently blocked by code policy; do not override.

## 7. Action items

1. Legal/ops: Confirm OmniRoute hosted vs. self-hosted model and obtain DPA/compliance artifacts.
2. Security: Verify TLS, data retention, and logging behavior of the OmniRoute endpoint.
3. Engineering: Run non-prod partner smoke set with OmniRoute enabled and capture provider distribution + cost.
4. Engineering: Add per-tenant cost cap and rate-limit bucket after initial usage data.
5. PM/Sales: Update sub-processor list and customer-facing trust documentation once DPA is signed.

---

**Tracker:** `2026-07-25T05:15:00Z` (OmniRoute integration) and follow-up session `2026-07-25T06:30:00Z`.
