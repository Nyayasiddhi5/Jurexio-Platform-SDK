---
status: COMPLETED
completed_at: 2026-05-06 (Session 7)
moved_to_completed_at: 2026-05-06T19:00Z
follow_up_doc: docs/v5.0.0/GO-LIVE-STATUS-2026-05-06.md
---

# AI Cohesiveness Test Plan

**Document:** `AI-COHESIVENESS-TEST-PLAN-2026-05-06.md`
**Version:** v5.0.1
**Last reviewed:** 2026-05-06
**Owner:** AI/ML platform team (Stream D — T013)
**Status:** active

---

## 1. Purpose

This plan defines the cross-cutting tests that prove the Nyayavigya AI
stack behaves as a **single coherent system** across:

- 5 SDK platform variants (NYM, NSP, NSI, NSA, NSM) plus the RAG-AUDIT
  enterprise surface
- 6 jurisdictions (IN, UK, US, EU, GC, SG)
- 22 ROMA-L5 orchestration patterns
- 148+ specialist legal agents
- 7 modules (orchestration, RAG, document intel, voice, automateAI, HITL,
  audit-chain) and the intelligent SLM-vs-LLM router

Cohesiveness ≠ unit correctness. The unit suites already prove individual
agents/routes work. This plan proves the *connections between them* hold
under realistic load and adversarial conditions.

---

## 2. Cohesiveness axes (what we are actually testing)

| # | Axis | One-line claim | Acceptance signal |
|---|---|---|---|
| C1 | **Pattern conformance** | Every pattern advertised in `nv-sdk-variants.ts` has a complete L5 descriptor | `tests/conformance/roma-l5-patterns.test.ts` green |
| C2 | **Routing cohesion** | The intelligent router picks SLM for short/cheap, LLM for long/complex, sovereign LLM for `government` tier — same decision regardless of jurisdiction | `tests/integration/slm-vs-llm-routing.test.ts` green |
| C3 | **PII fallback safety** | Falling back from primary to fallback LLM never leaks raw PAN/Aadhaar | `tests/integration/pii-redaction-fallback.test.ts` green |
| C4 | **Steady-state load** | NSP-Web sustains 100 concurrent VUs for 60 s with p95 < 2 s and ≥ 95% success | `tests/load/k6-100-concurrent-nsp.js` green |
| C5 | **Audit-chain continuity** | Every L5 orchestration writes a hash-chained `nv_audit_logs` row whose `prevHash` matches the previous row's `recordHash` | `scripts/nv-audit-chain-repair.sh --dry-run` reports `chain_intact=true` |
| C6 | **Scope contract** | RAG-AUDIT routes 403 without `enterprise:research` / `enterprise:assets` | `tests/integration/share-grant-enforcement.test.ts` + targeted RAG-AUDIT smoke |
| C7 | **Sovereign isolation** | NSM rejects any non-IN jurisdiction with `400 jurisdiction_not_permitted_for_app` | NSM smoke matrix T3 |
| C8 | **Doc-vs-runtime drift** | Every endpoint named in any `SDK-PLATFORM-*.md` exists in `SDK-ENDPOINTS-CANONICAL-2026-05-06.md` (or is explicitly flagged as planned) | manual diff during release sign-off |

---

## 3. Test inventory (what runs, where, and when)

| Test | File | Trigger | Owner |
|---|---|---|---|
| ROMA-L5 22-pattern conformance | `tests/conformance/roma-l5-patterns.test.ts` | every PR (vitest) | AI platform |
| SLM-vs-LLM routing | `tests/integration/slm-vs-llm-routing.test.ts` | every PR (vitest) | Routing team |
| PII redaction fallback | `tests/integration/pii-redaction-fallback.test.ts` | every PR (vitest) | Compliance |
| 100-VU k6 load (NSP) | `tests/load/k6-100-concurrent-nsp.js` | nightly + pre-release | SRE |
| Audit-chain repair (dry-run) | `scripts/nv-audit-chain-repair.sh --dry-run` | nightly | Audit team |
| RAG-AUDIT scope smoke | manual / postman collection | pre-release | Enterprise |
| NSM jurisdiction-lock smoke | manual / postman collection | pre-release | Sovereign-deploy team |
| SDK endpoint canonical diff | `SDK-ENDPOINTS-CANONICAL-2026-05-06.md` review | pre-release | Docs lead |

---

## 4. Pass/fail thresholds (release-gate)

A release **MAY NOT** ship to `production` unless **ALL** of:

1. `npx vitest run tests/conformance tests/integration` exits 0.
2. `k6 run --vus 100 --duration 60s tests/load/k6-100-concurrent-nsp.js`
   reports `thresholds_passed:true` in its summary block.
3. The audit-chain dry-run reports zero broken segments.
4. The release notes call out any new endpoints + their reflection in
   `SDK-ENDPOINTS-CANONICAL-2026-05-06.md`.

Soft gates (warn but don't block):

- p95 latency > 1.5 s but ≤ 2 s — file an SRE follow-up.
- ≥ 1 SLM/LLM routing decision flips relative to the prior release —
  routing team owner must approve.

---

## 5. Smoke harness wiring

CI pipeline (in order):

```
1. pnpm i --frozen-lockfile
2. npx vitest run tests/unit
3. npx vitest run tests/conformance
4. npx vitest run tests/integration
5. (nightly only) k6 run --vus 100 --duration 60s tests/load/k6-100-concurrent-nsp.js
6. (nightly only) bash scripts/nv-audit-chain-repair.sh --dry-run
```

Local quick-check (≤ 30 s):

```
npx vitest run tests/conformance tests/integration/pii-redaction-fallback.test.ts
k6 run --vus 1 --duration 5s tests/load/k6-100-concurrent-nsp.js
```

---

## 6. Cross-references

- Variant configs: `src/config/nv-sdk-variants.ts`
- Pattern allocator: `src/orchestration/nv-queen-orchestrator.ts`,
  `src/engine/roma-l5-optimizer.ts`
- RAG-AUDIT scope-checks: `src/routes/nv-sdk-enterprise-routes.ts`
- SDK platform docs: `docs/v3.1.2/SDK-PLATFORM-{NYM,NSP-WEB,NSI,NSA,NSM,JRX,RAG-AUDIT}.md`
- Canonical endpoint map: `docs/v3.1.2/SDK-ENDPOINTS-CANONICAL-2026-05-06.md`
- Session plan: `.local/session_plan.md` (T013 row)

---

## 7. Open items

- E2E sovereign-deployment cohesiveness in air-gapped mode is not yet
  automated — runbook §11 walk-through remains the canonical proof.
- A k6 variant against NSI (`enterprise` tier, 600 rpm) is staged but not
  yet wired into nightly — tracked separately.
- An adversarial prompt-injection cohesiveness suite (jailbreak attempts
  must hit HITL escalation, never bypass it) is in design — owner: Safety.
