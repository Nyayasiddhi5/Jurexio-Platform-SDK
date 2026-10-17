# Jurexio Platform — MANDATORY SESSION GUARDRAILS

**Purpose:** The permanent, non-negotiable contract that every session (Replit Agent main, task agent, human contributor) MUST follow **before** writing a single line of code, creating a session plan, proposing tasks, or marking work complete.

> **This file MUST be read in full at the start of every new session.** It is referenced from `replit.md` "Session-start protocol" and from every project task description. Failure to follow these guardrails is treated as a code-review-blocking defect — the same severity as a NV-* guardrail violation.

---

## 0. Why this file exists

In Session-15 (2026-05-11), the agent wrongly reported many shipped, wired features (May-2026 model catalog, AgentZero, GRPO, CAM framework, voice/multimodal/i18n packages, mem0, AGUI streaming) as "missing" or "not wired" because the audit was **shallow** — it looked at one or two folders, then concluded. The user's correction:

> *"Always make a guardrail to audit the folders services/, server/, shared/, packages/ subtrees and the per-feature directories, database schemas, config, agent registries, product notes, architecture notes, algorithm and user flows documents, project folder structure, project config structure, replit infrastructure, ec2 infrastructure for any status update or audit update or even before starting any code or any new features."*

This file encodes that mandate so it cannot be skipped again.

---

## 1. Mandatory pre-session reads (THE 7)

Before ANY of: creating `.local/session_plan.md`, calling `proposeFollowUpTasks`, editing source code, restarting workflows, or touching DB/config — load these **in this order**:

| # | Path | Why | Min depth |
|---|---|---|---|
| 1 | `replit.md` | Project overview, hard architectural guardrails (NV-ARCH-001 .. NV-API-CONTRACT-001), gotchas, current operational truth | full file |
| 2 | `guardrails.md` (this file) | Session protocol + features registry pointer | full file |
| 3 | `FEATURES-REGISTRY.md` | Master named-feature list w/ status — **the single source of truth for "is feature X built / wired"** | full file (or grep for the feature you're about to touch) |
| 4 | `CHANGELOG.md` | Most recent session's `[Unreleased]` section + last shipped release | head 200 + grep for area |
| 5 | `projecttracker.md` AND `Project-Tracker.md` | Phase status, current workstream | head 100 each |
| 6 | `docs/canonical/00-README.md` | Canonical doc index, full guardrail registry, gotchas archive, provider lockdown recipe, NV-LLM-001 whitelist | full file |
| 7 | `docs/canonical/04-sdk-and-api-canonical-2026-05-07.md` + `04c-sdk-troubleshooting-2026-05-11.md` | The **frozen** API surface + every recent endpoint addition | full both |

**One-shot command** (preferred): `bash scripts/jrx-session-preflight.sh` — prints all 7 in a session-start brief, plus drift since last snapshot.

---

> **NV-VALIDATE-THE-PROBE-001 (2026-08-17).** A corollary that keeps getting
> learned the expensive way: **before a probe's output is treated as evidence
> about the system, the probe itself must be proven to run.** Every probe needs a
> positive control — a pattern or file that MUST match — in the same invocation.
> If the control does not report, the probe is broken and its findings say nothing
> about the system.
>
> And: **an impossible result means a broken instrument, not a broken system.**
> `grep -c` returned empty while auditing whether the deployed container carried
> this session's fixes. `grep -c` cannot return empty — it prints a count or
> errors — so the only supported conclusion was "the command never executed"
> (`$(…)` had expanded in the outer shell, not inside the container, because it
> was nested in a double-quoted JSON string). Instead the empty output was read as
> `0` and reported as "production is missing every fix". Re-running it with the
> command substitution removed showed all four markers present.
>
> Checklist before reporting any probe result:
> 1. Did a positive control match? If not, stop — fix the probe.
> 2. Is the output *shape* possible for the command run? Empty where a number is
>    guaranteed, `0` where a header should print, `Success` with no stdout — all
>    mean the instrument failed.
> 3. Prefer the boring explanation (my command was wrong) over the alarming one
>    (the platform is broken). The boring one is far more often true.

## 2. Mandatory triple-pass audit (BEFORE any "missing" / "not wired" verdict)

> **NV-EXECUTE-BEFORE-CLAIM-001 (2026-08-17, learned the hard way).** The triple
> pass below is necessary but **not sufficient**. Reading source — even carefully,
> even across all three passes — is still inference. No defect may be reported,
> and no fix may be designed, until the behaviour has been **executed and
> observed**: a runtime probe, a unit test, a live request, or a log line from the
> actual running path.
>
> Three false verdicts in one session came from reasoning over grep/read output
> rather than running the code:
>
> | Claimed from reading | Actual, once executed |
> |---|---|
> | `JRX_SPECIALIST_PROMPT_COMPILER=1` is the biggest quality lever | A no-op for all 164 XML agents — the gate tests for a section the assembler always embeds |
> | `nvGatewayRouter` is unmounted, a wiring defect | Superseded dead code; `sdkGatewayRoutes` serves a near-superset; the unique paths have no caller and no contract |
> | Quality is not measured at all | A full harness with per-jurisdiction release gates, LLM judge and 6-jurisdiction golden set already existed |
>
> The one finding from that session that survived — 7 of 9 `jrx-legal-tools`
> capabilities unreachable — came from a runtime probe, and it also **changed the
> fix**: reading suggested renaming method names, while executing revealed the
> arguments were wrong too, so a rename alone would have converted hard failures
> into silent wrong answers.
>
> **Rule:** grep and read to form a hypothesis; execute to earn a claim. Prefer
> writing a throwaway probe script over one more round of reading. If a claim
> cannot be reproduced by running something, it is a hypothesis and must be
> labelled as one.

A single grep is **not enough**. Before claiming any feature is missing, broken, or not wired, you MUST do all three passes — in parallel where possible:

### Pass 1 — Source tree (15 subtrees)

```
src/services/         (29 sub-dirs incl. intelligent-router, llm-providers,
                       memory, rag, sdk, document-pipeline, jurisdiction-agents,
                       enterprise-platform, digital-twin, skills, e-filing,
                       white-label, rbac, contract-lifecycle, regulatory-monitor,
                       llm-priority-manager, clawdbot, openbot, automateai,
                       twindesk, jrx-legal-tools, intelligence, testing, security,
                       compliance, microservice-contracts, queue, orchestration,
                       persistence, multi-org)
src/orchestration/    (queen orchestrator, NS LRM core v9, wire-chain, lifecycle)
src/packages/         (analytics, i18n, multimodal, protocols, security, tools,
                       voice, workflows — all metadata barrels)
src/routes/           (~95 route files, incl. nv5/{doc-ai,compliance,gov,
                       legal-pipeline,multimodal,voice,workflows,internal})
src/middleware/       (safety ring chain, sdk-auth-header, dual-auth,
                       inter-service-auth, api-versioning)
src/agents/, src/api/, src/capabilities/, src/chat/, src/config/, src/core/,
src/data/, src/database/, src/db/, src/engine/, src/execution/, src/gateway/,
src/guardrails/, src/india-first/, src/integrations/, src/rest/, src/schemas/,
src/startup/, src/storage/, src/system-prompts/, src/systems/, src/types/,
src/utils/
client/src/             (121 page files, 151 routes — the React 19 console)
packages/               (root-level: client-sdk, jurexio-citizen-sdk,
                         client-sdk-react-native, enterprise-sdk)
config/                 (agent-registries × 7 jurisdictions, llm/, integrations/,
                         platforms/, security/, storage/, agents/, cache/,
                         memory/, rate-limits/, jrx-master-config.json)
docs/canonical/         (the 19 active canonical docs — 00..11 + EC2-* + 04c)
docs/audit/             (feature-inventory, feature-matrix-and-status,
                         feature-wiring-matrix.csv, console-cpo-audit,
                         verification-appendix, jrx-orphan-{allowlist,
                         disposition,budget})
```

### Pass 2 — DB + config + registries

| Source | Tool | What to check |
|---|---|---|
| Postgres (199 tables across `public` + `nv_schema`) | `psql "$JRX_DATABASE_URL" -c "\dt nv_schema.*"` and `\dt public.*` | Is the feature's table present? Is `nv_llm_providers.is_active` correct? Is `nv_agents` count = 1,299? |
| Redis (Upstash dev / ElastiCache prod) | `redis-cli -u "$JRX_REDIS_TCP_URL" --tls --insecure ping` | Cache layer reachable? |
| Agent registries (7 JSON files) | `wc -l config/agent-registries/Jurexio-Legal-registry-*.json` | All 7 jurisdictions present? Flat registry rebuild fresh? (`npm run guardrail:flat-registry`) |
| Feature flags | `rg "JRX_F_" src/config/jrx-feature-flags.ts` | Is the gate ON or OFF? |
| Env / secrets | List `available_secrets` from system + `cat .env.example` | What's set vs unset? Never print values. |

### Pass 3 — Wiring + product/architecture docs

| Source | Tool | What to verify |
|---|---|---|
| Wiring audit (BFS reachability from `src/index.ts`) | `npm run audit:wiring && cat docs/audit/jrx-wiring-audit.json \| jq '.summary'` | WIRED / USED-INTERNAL / ORPHAN counts; orphan budget at `docs/audit/jrx-orphan-budget.json` |
| Orphan disposition | `head -40 docs/audit/jrx-orphan-disposition.md` | Per-orphan WIRE-ROUTE / WIRE-CHAIN / WIRE-INTERNAL / MERGE-DUPLICATE / KEEP-BARREL / KEEP-CLI / KEEP-CONTRACT / KEEP-DYNAMIC-IMPORT / REVIEW-* classification |
| Product Notes (3 files, root) | `ls -la Full-Final-Jurexio-ProductNote-*.md` | 312-April2026 (205 KB), BUSINESS (44 KB), TECHNICAL (65 KB) — grep before claiming a product feature doesn't exist |
| Roadmap | `head -100 Roadmap.md` | What's planned vs shipped |
| Architecture | `docs/canonical/03-architecture-slim-2026-05-11.md` + `11-agentic-architecture-2026-05-10.md` | Two-tier AI, 22 patterns, 1,299 agents, safety ring |
| EC2 / infra | `docs/canonical/EC2-INTEGRATION-STATUS.md` + `EC2-PUSH-RUNBOOK-2026-05-08.md` | What's behind on prod-dev, per-deploy network bridge gotcha |
| Replit infra | `replit.md` § "Run & Operate" + `.replit` workflows | Gateway port 5000, Console port 3004, JRX_* secrets |

**Verdict rule:** A feature is "missing" only if **all three passes** confirm absence. If any pass finds it (even if mis-named or in a different subtree), the verdict is "found, possibly mis-located/mis-wired" — NOT "missing".

---

## 3. Mandatory before-write reads (per file family)

When the upcoming change touches a file family, also read these:

| If you're touching… | Read first |
|---|---|
| Any LLM-emitting code | `docs/canonical/05-llm-dedicated-2026-05-11.md` + NV-LLM-001 whitelist in `docs/canonical/00-README.md` |
| Any auth middleware | `src/middleware/jrx-sdk-auth-header.ts` + NV-AUTH-HEADER-001 in `replit.md` |
| Any standalone script under `scripts/` | `scripts/_pg-pool.ts` + NV-DB-SCRIPT-001 in `replit.md` |
| Any new HTTP route | NV-API-CONTRACT-001 in `replit.md` + run `npm run guardrail:api-contract` after |
| Any agent registry edit | NV-AGENT-REGISTRY-FRESH-001 gotcha + `npm run build:flat-registry` after |
| Any new file under `src/{services,orchestration,routes,middleware,config}/` | NV-NAMING-001: `rg -l '<concept>' src/` first; edit existing if found |
| Any service file you're "completing" | NV-WIRING-001: it's NOT done until imported by `src/routes/`, `src/index.ts`, `jrx-queen-orchestrator.ts`, `jrx-client.ts`, or another wired service |
| Any markdown doc | NV-DOC-001: only `replit.md`, `README.md`, `docs/canonical/{01..11}-*.md` are active; everything else → `archive/` or `docs/audit/` |
| Any vendor wrapper (Sarvam, OpenRouter, Bedrock, etc) | NV-CONTRACT-001: pre-flight grep for method/route/schema names; vendor 404 = `curl` probe vendor base URL |
| Any test failure | NV-OWNERSHIP-001: reproduce with `curl`/`psql`/`redis-cli`, trace to ONE owning component, fix in our layer |
| Any Redis URL | `src/utils/redis-tcp-url.ts` + NV-SECRETS-001 (canonical names: `JRX_REDIS_TCP_URL` write, `JRX_REDIS_READ_URL` read) |

---

## 4. The 11 hard architectural guardrails (CI-enforced)

These already exist in `replit.md` § Hard architectural guardrails. **This file does not redefine them — it points to them and adds the session-start enforcement layer above.**

1. **NV-ARCH-001** — No-bypass safety ring (every LLM request traverses tenant → guardrails → Queen → agents → 22-section Parlant → 5-tier memory → multi-tier RAG → GraphRAG → CoT/ReAct/ToT → router → response engineering → hallucination + citation + safety + HITL → audit hash chain → streaming)
2. **NV-LLM-001** — Single-router rule (7-file whitelist for `realLLMService.executeRequest`)
3. **NV-NAMING-001** — Pre-flight grep before creating any new file under `src/{services,orchestration,routes,middleware,config}/`
4. **NV-WIRING-001** — Service NOT complete until imported by a wired consumer
5. **NV-DOC-001** — Active markdown limited to `replit.md` + `README.md` + `docs/canonical/{01..11}-*.md` + this file + `FEATURES-REGISTRY.md`
6. **NV-SECRETS-001** — One canonical name per secret; consumers go through resolver helpers
7. **NV-CONTRACT-001** — Method/route/schema/env/vendor names require pre-flight grep
8. **NV-OWNERSHIP-001** — Test failures must be reproduced + traced + fixed in our layer
9. **NV-AUTH-HEADER-001** — `X-API-Key` (with `Authorization: Bearer` fallback) only; east-west uses `X-NV-API-Key`
10. **NV-DB-SCRIPT-001** — Standalone scripts use `makePgSql()` from `scripts/_pg-pool.ts`
11. **NV-API-CONTRACT-001** — Frozen v5 API surface; additions OK, removals/method-changes fail CI
12. **NV-WIRING-BUDGET-001** — Effective orphan budget at `docs/audit/jrx-orphan-budget.json` = 1; CI fails if grown
13. **NV-AGENT-REGISTRY-FRESH-001** — Per-jurisdiction edit + `npm run build:flat-registry` + commit merged file
14. **NV-MESH-001** — Catalog / factory / registry **≠** Queen-schedulable until: (a) capability leaf exists in `capability-manifest.ts`, (b) at least one `INTENT_CAPABILITY_MAP` alias, (c) `analyzePrompt` hint when user-facing keywords exist, (d) agent `tools`/`mcpToolsAllowed` pass through `jrx-agent-tool-bridge`. **Never re-implement a leaf that already has a factory.** Run `npm run guardrail:intent-mesh` (wired into `npm run guardrail`).
15. **NV-FEATURE-FULL-001** — Before planning or implementing ANY new feature: classify JRX/NYS/BOTH; run `session:preflight`; triple-pass audit (source + DB/registries + wiring from `src/index.ts`); read FEATURES-REGISTRY; design DB + memory + RAG + cache + jobs + INTENT/capability/analyzePrompt + NV-LLM-001 path + SDK SemVer **before** writing code. Done only when `npm run guardrail` + live smoke pass.
16. **NV-NO-DUPLICATE-001** — Never build a parallel pipeline for an existing business job. Pick one SSoT service; redirect/alias other HTTP/SDK/Queen entry points to it; document deprecations.
17. **NV-NO-STUB-001** — Never ship stubs/skeletons for new or “completed” features. Forbidden: hardcoded empty success without `reason`, fake gazette IDs, capability factories that cannot resolve exports. Ascertain STUB only after reading service body + DB writes + Queen factory + SDK path (not a single grep). FEATURES-REGISTRY “WIRED” ≠ LIVE.

Run all CI guardrails locally with: `npm run guardrail` (chains them).

---

## 5. The "rock solid, never break" partner SDK rules

For any change to `/api/nv/v1/sdk/**` or any partner-facing surface:

1. **Additive only** — Frozen contract per NV-API-CONTRACT-001. New routes get new paths.
2. **`X-API-Key` only** for partner auth (fallback `Authorization: Bearer`). NV-AUTH-HEADER-001.
3. **Live verify with curl before claiming "done"** — 200 with valid key, 401 without. No exceptions.
4. **Document in `docs/canonical/04c-sdk-troubleshooting-2026-05-11.md`** — every endpoint, headers, examples, error envelope shape. NV-DOC-001 compliant.
5. **No silent fallbacks** — partners must see explicit failures (NvResponse envelope already exposes `model`, `latencyMs`, `source`, `orchestration`, `requestId`, `citations`, `ragContext`, `usedFallback`).
6. **Cross-mount when serving both UI and partners** — keep the same payload shape; mount under `/api/nyayavigya/...` (JWT) AND `/api/nv/v1/sdk/...` (X-API-Key). See CAM dashboard pattern in v15.

---

## 6. Session protocol — the 6-step opening every session must perform

```
Step 1. Read all 7 mandatory pre-session docs (§1)
Step 2. Run `bash scripts/jrx-session-preflight.sh` for the consolidated brief
Step 3. Run the triple-pass audit (§2) for any folder you're about to touch
Step 4. Cross-check the named feature against FEATURES-REGISTRY.md
Step 5. Identify the relevant NV-* guardrails from §4 and the per-family rules from §3
Step 6. Only then create `.local/session_plan.md` (if scope warrants) or start coding
```

**For project-task planning (Plan mode):** the same 6 steps apply BEFORE writing the task plan file at `.local/tasks/`.

---

## 7. The "honest correction" protocol

When mid-session evidence contradicts an earlier verdict:

1. **State the correction explicitly** — "Earlier I said X is missing; the triple-pass found it at <path>; here is the actual status."
2. **Update FEATURES-REGISTRY.md immediately** — don't let stale audit data persist.
3. **Append to CHANGELOG.md `[Unreleased]`** with a `### Corrected` heading.
4. **Reduce scope honestly** — if 3 of 5 planned tasks turn out to be already-done, ship the 2 real ones and mark the 3 as "verified already-shipped (no-op)".

This was the v15 lesson; encoding it here so it's not re-learned.

---

## 8. Maintenance of this file

- Update when a new NV-* guardrail is added to `replit.md`.
- Update when a new mandatory pre-session doc is identified.
- Update when the triple-pass coverage changes (new top-level dir, new package, new audit doc).
- Maintainer: Replit Agent (autonomous, gated on user approval for substantive changes).
- Last updated: **2026-08-02 — NV-FEATURE-FULL-001 / NV-NO-DUPLICATE-001 / NV-NO-STUB-001.**
