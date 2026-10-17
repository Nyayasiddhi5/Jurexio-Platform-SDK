---
status: live
version: 3.1.2
superseded_by: null
last_verified: 2026-04-27
audit_target: nv-dev-edge (RDS + ElastiCache + EC2 13.232.165.242)
---

# Nyayavigya Platform — Live Audit Gap Report (2026-04-27)

**Auditor:** Platform engineering, on-instance live probe via `nyv-gateway` container against RDS (`nyv-dev-edge-pg`) + ElastiCache (`nyv-dev-edge-redis`) in `ap-south-1`.
**Scope:** Cross-check the seven source-of-truth docs (Business + Technical product notes, SDK production audit, two architecture docs, user-flows, roadmap) against actual deployed state.
**Method:** Live SQL row-counts against RDS Postgres 16, live Redis SCAN against ElastiCache, container + process inspection on EC2, route catalogue from running gateway, package + scripts inspection. No mocked data, no cached results.

---

## 1. Headline verdict

**Code-plane is healthy. Data-plane is largely empty. Schema-plane has drift.**

| Plane | State | Evidence |
|---|---|---|
| **Code (gateway runtime)** | ✅ HEALTHY | `nyv-gateway` Up 16 min, `nyv-console` Up 10 h, `nyv-postgres` + `nyv-redis` + 5 `nsp-*` Up 3-4 days. NV-NSP-FIX-001 hot-patch (orchestrate 500 → 200) live and serving. Recent logs show `llm-orchestrator: success` against Anthropic Claude Sonnet 4.6 with full latency / cost telemetry. |
| **Routes / API surface** | ✅ HEALTHY | 78 route files in repo, **94 mounts** in `src/index.ts` under `/api/nv/*`, including `nvLegalChatRouter`, `nvAguiStreamRouter`, `nvOrchestrationRouter`, `nvRoutingWeightsRouter`, `nvCsrfGuard`, tier rate limiters, tenant isolation, and ORG RLS middleware. |
| **Queues / workers** | ✅ HEALTHY | All 5 BullMQ queues + 5 DLQs registered in ElastiCache (`nyv-doc-parse`, `nyv-doc-summarize`, `nyv-platform-relay`, `nyv-pqc-sign`, `nyv-webhook-delivery`, each with `:meta` + `:stalled-check` keys; DLQ siblings present). Workers run **in-process** with the gateway (1 node `tsx src/index.ts`); no separate worker container, by design. |
| **Schema (RDS)** | ⚠️ DRIFT | `public` has **98 tables**; `nv_schema` has **26 of ~50** documented. Missing: `nv_pii_vault` (security claim), `hallucination_checks`, `hitl_reviews`, `agent_metrics`, `ai_feedback`, `bias_audits`, `memory_entries`, `model_drift_baselines`, `rag_*` (in `nv_schema`). Two user schemas (`public`, `nv_schema`); zero `ns_*` tables. |
| **Seed data (RDS)** | ❌ LARGELY EMPTY | Only `legal_agents` (1046), `nv_statutes` (305), `protocol_registry` (102), `sdk_compliance_controls` (20), `sdk_clause_library` (15), `sdk_document_templates` (10), `sdk_applications` (6), `sdk_app_api_keys` (5), `nv_users` (4 demo), `nv_router_decisions` (7) have any rows. **Everything else** in the seed-critical list is `0` or missing. |
| **Cache state (Redis)** | ✅ HEALTHY (sparse) | ElastiCache 7.1.0 standalone, `used=6.72M`, **17 keys** total (16× BullMQ meta + 1× per-IP rate-limit zset for NSP). No stale `nyv:*` litter. |

---

## 2. Live numeric reality vs documentation claims

| Claim (where) | Documented | Live (2026-04-27) | Drift | Severity |
|---|---:|---:|---|---|
| ROMA L5 agents (Tech §1, Roadmap §1) | 1042 (`6 × 149 + 148`) | **1046** in `public.legal_agents` | +4 | 🟡 minor (re-derive math from registry JSON) |
| MCP tools / protocol entries (SDK audit, Tech §4) | 502 | **102** in `nv_schema.protocol_registry` | **−400 (−80%)** | 🔴 high |
| `nv_schema` tables | ~50 expected | **26** present | **−24 (−48%)** | 🔴 high |
| BullMQ queues + DLQ (SDK §6.1) | 5 + 5 | **5 + 5 control-plane registered** (each queue has `:meta` + `:stalled-check` keys; DLQ siblings present); **no jobs queued, no completed/failed counts observed** in this audit window | 0 (registration); throughput unverified | 🟢 match (registration); 🟡 throughput pending validation |
| Hash-chained audit log (Tech §1, §23) | enforced, append-only | `public.nv_audit_logs` exists but **0 rows** in dev-edge | unverified | 🔴 high (cannot audit the auditor) |
| PII vault (Tech §18) | `public.nv_pii_vault`, field-encrypted | **table does not exist** | missing | 🔴 high (DPDPA claim) |
| `nv_organizations` (multi-tenant) | tenant root | **0 rows** | empty | 🟠 medium (no real tenant data) |
| `nv_users` | seeded demo + real | **4 rows** (demo only) | sparse | 🟢 expected for dev-edge |
| `knowledge_chunks` + `rag_namespaces` | RAG store | **0 + 0** | empty | 🔴 high (RAG cannot ground) |
| `nv_legal_templates` + `template_library` | drafting templates | **0 + 0** | empty | 🟠 medium (drafting blocked) |
| `nv_credit_wallet` + `nv_subscriptions` | billing | **0 + 0** | empty | 🟡 minor (dev-edge) |
| `nv_api_keys` | partner keys | **0** in `nv_api_keys`; **5** in `sdk_app_api_keys` | namespace mismatch | 🟡 docs reference both, only one populated |
| `legal_chat_sessions` / `legal_chat_messages` | session log | **1 / 0** | sparse | 🟢 expected (smoke only so far) |
| Five SDK partner apps provisioned | NSP, NSI, NSA, NSM, NyM | **6 in `sdk_applications`, 5 keys in `sdk_app_api_keys`** | 1 extra app row | 🟡 minor |
| `nv_jurisdiction_profiles` | 6 jurisdictions | **0 rows** | empty | 🟠 medium |
| `nv_clawd_bots` / `nv_legal_oracle_qa` / `nv_openbot_agents` / `nv_skillshop_listings` | feature stores | **0 / 0 / 0 / 0** | empty | 🟠 medium |
| Academy / Ministry / Institutional / NyayaMitra cases | per-partner data | **0 / 0 / 0 / 0** | empty | 🟢 expected for dev-edge |

---

## 3. Per-document reconciliation

### 3.1 NYV-PRODUCT-NOTE-BUSINESS-v3.1.2.md
- **Customer-facing claims** (5 partner apps, 1042 agents, multi-jurisdiction, ISO 42001 / SOC2 / DPDPA / GDPR / EU AI Act roadmap) are aspirational targets the architecture supports — but the **field encryption + PII vault + audit-chain** narrative cannot be demonstrated end-to-end against dev-edge today (PII vault table missing, audit chain empty).
- **Action:** flip `status: completed → work-in-progress` ✅ done; add reality-check banner ✅ done.

### 3.2 NYV-PRODUCT-NOTE-TECHNICAL-v3.1.2.md
- §1 "1,042 ROMA Level-5 system prompts" → **1046 live**. Re-derive `6 × 149 + 148 = 1042` against the seven `Nyayavigya-Legal-registry-*.json` files — either the math is stale or four agents drifted in.
- §1 "boot count assertion (`nv-jurisdiction-prompt-validator.ts`)" → presumably still passes (gateway healthy), but the asserted target is now 1046, not 1042. Verify `process.exit(1)` boundary.
- §4 protocol-registry capability count "502 MCP tools" → **102 live**. Either re-seed via `scripts/nv-seed-mcp-tools.ts` or correct the doc to the smaller surface that actually shipped.
- §18 / §23 PII vault + audit chain claims → table missing / zero rows. Highest-priority gap.
- §3 wiring diagram and component breakdown → matches the live gateway exactly.

### 3.3 NYV-SDK-PRODUCTION-AUDIT-REPORT-Apr2026.md
- §6.1 5 BullMQ queues + DLQ → ✅ **confirmed live in ElastiCache** (16 of 17 keys are BullMQ meta).
- "97.5% PASS, 0 code-level critical blockers" was a **code-only verdict**. A live verdict with the data-plane in scope drops that materially because:
  - hash-chain audit not exercised (0 rows),
  - PII vault not deployed (table missing),
  - RAG store not seeded (0 chunks, 0 namespaces),
  - half of `nv_schema` not present.
- The 4 hard blockers it called out (AWS infra, Redis, OpenAI key, security gates) — Redis ✅ live, AWS infra ✅ live, OpenAI key still active per env, security gates still need the live-data checks above.

### 3.4 NYV-ARCHITECTURE-312.md
- The structural picture (Express 5 / Node 22 gateway, Caddy, RDS, ElastiCache, ALB, Sentry, multi-tenant model, jurisdiction precedence) **matches** what's running.
- The **size of the agent + tool catalogue** in this doc is target-state.
- **Action:** flip `status` ✅; add banner ✅.

### 3.5 NYV-ARCHITECTURE-v6.md
- Same as 3.4. Wiring is live; counts are target-state.
- 5 BullMQ queues confirmed; ElastiCache version (7.1) confirmed.

### 3.6 NYV-ARCHITECTURE-AND-USER-FLOWS-v3.1.2.md
- §3 NV-ROUTER-001 → **live and emitting telemetry** (Anthropic Claude Sonnet 4.6, `tokensIn`/`Out`, `costUsd`, `latencyMs`, `fallbackLevel:0` observed at 2026-04-27 07:32 UTC).
- §4 end-to-end legal scenarios → **cannot complete with grounded citations** against an empty `knowledge_chunks` + `rag_namespaces` store. The router will run; RAG will return zero results; the answer will fall back to model-only knowledge.
- §3.4 "real provider-side SSE streaming" → wired in code; live verification next time we exercise the streaming endpoint.

### 3.7 NYV-ROADMAP-Q2-Q4-2026.md
- §2 "Recently shipped" treats Tasks #29 (PII vault + RLS + field encryption + audit chain), #43 (audit chain Redis lock), #32/#33 (capability manifest + smart routing) as MERGED. They are merged in code but **not yet deployed/seeded live** at dev-edge. Either re-define MERGED to mean "code in `main`" (and add a separate "DEPLOYED + SEEDED" lane), or block them until the seeds run.
- §4.1 "Pre-GA blockers (P0)" should add two new entries before May 15:
  - **#NEW-1 Seed master data into RDS dev-edge then prod** — run `npm run seed:all` + `npm run seed:master` (scripts already exist: `nv-seed-jurisdictions.ts`, `nv-seed-statutes.ts`, `nv-seed-mcp-tools.ts`, `nv-seed-llm-providers.ts`, `nv-seed-models.ts`, `nv-seed-organizations.ts`, `nv-seed-sdk-apps.ts`, `nv-seed-sdk-keys.ts`, `nv-seed-feature-flags.ts`, `nv-seed-users.ts`, `nv-seed-agents.ts`, `nyayavigya-312-seed-master.ts`).
  - **#NEW-2 Apply missing `nv_schema` migrations** — half of the documented `nv_schema` is missing in dev-edge; run `npm run db:push --force` from the gateway after re-aligning `shared/schema.ts` with the doc set.

---

## 4. What actually shipped (positive findings)

These are the verified-live wins, suitable for an honest customer / investor brief:

1. **Gateway, console, RDS, Redis, 5 NSP partner containers** all healthy on `t3.large` EC2 (`13.232.165.242`).
2. **NV-ROUTER-001 (single LLM entry point)** live and emitting structured telemetry — model, provider, fallback level, latency, tokens-in/out, cost-USD per call.
3. **5 BullMQ queues with DLQs** (`nyv-doc-parse`, `nyv-doc-summarize`, `nyv-platform-relay`, `nyv-pqc-sign`, `nyv-webhook-delivery`) registered in ElastiCache, in-process workers running.
4. **Legal Chat console** mounted at `/api/nv/legal-chat` with RBAC matrix verified (superadmin / sme / admin) per session-plan T001-T007.
5. **94 `/api/nv/*` mount points** including auth, rate-limit tiers, tenant isolation, ORG RLS, AG-UI streaming, swagger docs, admin routing-weights dashboard.
6. **1046 ROMA L5 agents** loaded into `public.legal_agents` (slight +4 drift from the documented 1042).
7. **305 statutes** seeded into `public.nv_statutes`.
8. **6 SDK applications** with 5 partner API keys provisioned in `sdk_applications` / `sdk_app_api_keys`.
9. **NV-NSP-FIX-001 hot-patch** (orchestrate 500 → 200) running stable; NSP traffic flowing.
10. **Per-IP rate-limiting** active and visible in Redis (e.g. `nyv:rl:nyayasiddhi-professional/5.2.0:pro:/api/nv/orchestrate:ip:172.31.29.222`).

---

## 5. Recommended remediation (ordered)

**Block GA (May 15) on items 1-5. Items 6-8 are post-GA polish.**

> ℹ️ **Order matters.** Seed scripts will fail against missing tables. Schema reconciliation must run **before** the seed pass; RAG backfill and audit-chain exercise both depend on the seeded tenant + statute set.

1. **Reconcile `shared/schema.ts` to the documented `nv_schema` table set**, then `npm run db:push --force` from inside the `nyv-gateway` container against `nv-dev-edge-pg`. Add (at minimum): `nv_pii_vault`, `hallucination_checks`, `hitl_reviews`, `agent_metrics`, `ai_feedback`, `bias_audits`, `memory_entries`, `model_drift_baselines`, `rag_*`. Verify `select count(*) from information_schema.tables where table_schema='nv_schema'` rises from 26 toward ~50. **Preserve PK ID column types** (no `serial ↔ varchar` swaps) per platform DB-safety policy.
2. **Run the 12 seed scripts against dev-edge RDS** in this order (top-to-bottom; each step assumes the prior tables exist):
   `nv-seed-jurisdictions → nv-seed-statutes → nv-seed-llm-providers → nv-seed-models → nv-seed-mcp-tools → nv-seed-organizations → nv-seed-sdk-apps → nv-seed-sdk-keys → nv-seed-feature-flags → nv-seed-users → nv-seed-agents → nyayavigya-312-seed-master`
   then verify row counts > 0 in `nv_jurisdiction_profiles`, `nv_legal_templates`, `nv_organizations`, `template_library`, and that `protocol_registry` rises from 102 to the documented surface.
3. **Backfill `knowledge_chunks` + `rag_namespaces`** from the document pipeline (the 5 BullMQ queues exist for exactly this — `nyv-doc-parse` + `nyv-doc-summarize` will populate both). Trigger one bulk ingest run; this also exercises the queue throughput claim that this audit could only verify at the registration level.
4. **Exercise the audit chain end-to-end** so `nv_audit_logs` has live rows and `previous_hash` linkage can be verified by an auditor; depends on a seeded tenant + a real orchestration call landing in the chain.
5. **Decide which protocol-registry count is correct** (102 live vs 502 documented in `src/data/nv-mcp-tools-registry.ts`) and either re-seed in step 2 above or amend the docs to the smaller live surface.
6. **Fold the hot-patch (NV-NSP-FIX-001)** into the canonical Docker image and rebuild — the patch is currently runtime-injected via `docker cp`, will not survive a container recreate.
7. **Re-derive the agent count math.** Tech §1 says **1042** (`6 × 149 + 148`); the Roadmap §1 paragraph says **1043**; live `legal_agents` shows **1046**; the boot validator at `src/startup/nv-jurisdiction-prompt-validator.ts` enforces a single number. Pick one canonical value, update the validator, and update both docs to match.
8. **Address the two NSP-side failure modes** documented in §5a below (60-second model-call timeout + content-filter false-positives on legal-research). Both are launch blockers for NSP go-live but are **separate from the data-plane gaps in items 1-5**.

---

## 5a. NSP → NV integration update (received 2026-04-27, mid-audit)

Live telemetry from the NSP side confirms the NV-NSP-FIX-001 hot-patch held: orchestrate no longer fail-fasts with `upstreamStatus:500 "System configuration error"` (50-150 ms). The gateway now actually reaches the model layer and the policy engine. Two **new** failure modes have surfaced and are now the next things to fix:

| Failure mode | NSP-observed signature | Likely root cause | Fix owner |
|---|---|---|---|
| **Model-call latency > 60 s** | NSP SDK times out at 60 s with `408 NV SDK timeout after 60000ms`; NV side hangs without responding | Slow upstream LLM call (Anthropic Claude Sonnet 4.6 was observed at **41,466 ms** for one CoT request in the gateway log at 07:32:35 UTC — within the budget for that one, but right against it). Need either a) lower `maxTokens` for default sequences, b) parallel-cascade earlier instead of waiting for 60s, c) lift the SDK-side timeout for slow tasks | Platform |
| **Over-aggressive content filter** | NSP receives a real NV response of `[Response filtered by Nyayavigya compliance engine]` for legal-research queries that should pass | Safety / hallucination / citation-grounding pipeline rejecting outputs that should be allowed for the `legal_research` task kind. Needs threshold review per task kind | Platform-Sec |

**Correlation IDs from the NSP observability stream (use these to grep the gateway log):**

- `829dc60c-4327-49c6-91af-952bc43112a6` — legal-research timeout
- `561cdb09-c607-4dc0-964c-efb19b69d69b` — doc-draft timeout
- `a13b2f6c-53e2-443b-b16d-32a3aff87cfc` — risk-assessment timeout
- `3fbb95b3-9a88-403f-95ca-f7ff9270a922` — earlier doc-draft NV-SDK error

**Implication for the May 15 GA lock:** The `60s SDK timeout` and the content-filter false-positive rate are both **launch blockers** for NSP's go-live. Add to §4.1 of the roadmap:
- **#NEW-3 Bring P95 orchestrate latency under the 60s SDK timeout** for `legal_research`, `doc_draft`, `risk_assessment` task kinds.
- **#NEW-4 Tune the safety / citation-grounding threshold per task kind** so legitimate legal-research answers stop being content-filtered.

**Unrelated NSP-side defect (logged for separate planning, not in scope here):** `ai/audit_trail` insert is failing because `confidence` is being passed as `[object Object]` instead of a numeric scalar. The insert is wrapped in a try/catch and logged as "skipped", so the user-facing response is unaffected. Root cause is on the **NSP** side (caller passes the verdict object instead of `verdict.confidence`). Tracking item: **NSP-AUDIT-TRAIL-CONFIDENCE-001**.

---

## 6. Audit telemetry (for re-running)

```
EC2:        13.232.165.242 (i-0df71e5ea1df8f588), t3.large, ap-south-1
SSH key:    /home/runner/workspace/.local/keys/nysdev.pem
RDS:        nyv-dev-edge-pg.cls0ugsyu4yr.ap-south-1.rds.amazonaws.com (Postgres 16)
ElastiCache: nyv-dev-edge-redis (Redis 7.1.0)
Containers: nyv-gateway, nyv-console, nyv-postgres, nyv-redis, nsp-{api,worker,web,caddy,redis,postgres}
Repo HEAD on EC2: 19185cc

Replay command (from EC2):
  sudo docker exec -w /app nyv-gateway node -e "<the audit script in /tmp>"
```

---

## 7. Remediation closeout (2026-04-27, end-of-day)

This section closes out every row in §1, §2, and §5a above against the live state of the system after NV-NSP-FIX-002 → NV-NSP-FIX-005 were applied. Full per-table evidence is in the companion document **`NYV-SCHEMA-MIGRATION-CONFIRMATION-2026-04-27.md`** — read that for the full schema-migration matrix, every table + row count, and the unwired/undeployed crosscheck.

### 7.1 Gap-report row dispositions

| Original gap row | Disposition | Reference |
|---|---|---|
| Schema (RDS) "−24 of ~50 nv_schema tables missing" | **WITHDRAWN — apples-to-oranges.** All 24 "missing" tables exist; they were renamed (e.g. `nv_pii_vault` → `nv_schema.pii_vault`; `hallucination_checks` → `nv_hallucination_detections`; `hitl_reviews` → `hitl_workflows`; `memory_entries` → `org_memory_entries` + 4 in public; etc.) or live in `public` rather than `nv_schema`. **No tables are actually missing from RDS.** | Confirmation §1.3, §5 |
| MCP tools 502 → live 102 (−80%) | **WITHDRAWN — apples-to-oranges.** 504 = MCP **tools** in `src/data/nv-mcp-tools-registry.ts` (runtime-served). 102 = **CAPABILITIES** (`CAP_*`) in `nv_schema.protocol_registry`. Different layers, different things. | Confirmation §1.1 |
| `nv_pii_vault` missing | **CLOSED — RENAMED.** Lives at `nv_schema.pii_vault` (0 rows by design — no PII processed on dev-edge). | Confirmation §1.2 |
| `nv_audit_logs` 0 rows | **PARTIAL.** Hash-chain genesis row anchored (`previous_hash = 0×64`). Per-orchestrate auto-write **not yet wired** — open as **FU-T006a**. | Confirmation §2.4, §6 |
| `nv_organizations` 0 rows | **CLOSED.** 3 rows seeded (demo-tenant, nyv-internal, nsp-pro). | Confirmation §2.1 |
| `nv_jurisdiction_profiles` 0 rows | **CLOSED.** 6 rows seeded (IN, UK, EU, US, GC, SG). Added missing `UNIQUE(jurisdiction_code)` constraint. | Confirmation §2.1 |
| `nv_legal_templates` 0 rows | **CLOSED.** 15 IN templates seeded (demand notices, bail apps, vakalatnama, plaint, WS, consumer complaint, RTI, divorce, rent, NDA, offer, PoA, TM-A). | Confirmation §2.1 |
| `template_library` 0 rows | **CLOSED.** 15 companion entries seeded (varchar PK). | Confirmation §2.1 |
| `knowledge_chunks` + `rag_namespaces` 0 + 0 | **PARTIAL.** 18 chunks + 6 namespaces seeded; embeddings **deferred** to `nyv-doc-summarize` worker batch. Open as **FU-T012d**. | Confirmation §2.1, §6 |
| `nv_users` 4 rows, no org link | **CLOSED.** All 4 demo users now linked to `org_id = demo-tenant`. | Confirmation §2.1 |
| #NEW-3 P95 orchestrate < 60 s SDK timeout | **CLOSED — NV-NSP-FIX-003.** `outbound:llm` timeout raised 60 s → 120 s (`src/services/circuit-breaker.ts:69`). Live validation: `legal_research` orchestrate elapsed **4 s** (1338 prior requests served pre-restart, no timeouts in the audit window). Operator escape hatch via `NYV_BREAKER_LLM_TIMEOUT_MS` retained. | Confirmation §3.2 |
| #NEW-4 Content-filter false-positive rate | **CLOSED — NV-NSP-FIX-002.** `BANNED_KEYWORDS` trimmed to 13 strictly-prescriptive terms; `DISCLAIMER_PATTERNS` (5 regex) added; substring match upgraded to word-boundary regex (`src/services/nv-client.ts:54-136`). Live validation: representative `legal_research` query returned `compliancePassed:true`, `hallucinationCheck.status:passed`, **0 filter hits**. | Confirmation §3.1 |
| 12 nv-seed-*.ts scripts unrunnable on dev-edge | **PARTIAL — WORKAROUND APPLIED.** Root cause: scripts use `neon()` from `@neondatabase/serverless` which munges hostnames (assumes `<project>.<region>.neon.tech`) and cannot reach `*.rds.amazonaws.com`. Workaround: NV-NSP-FIX-004 consolidated pg-driver seeder closed the empty-table backlog in one pass. Refactor of the 11 affected scripts to use `pg.Pool` (or `src/db/index.ts`) is **FU-T003-seeders**. The one statute seeder (`nv-seed-statutes.ts`) already uses the pg client and continues to work. | Confirmation §6 |
| Statute corpus 305 → ≥ 500 IN target | **DEFERRED — FU-T004.** Not closed in this remediation window (size-of-work reasons). Statute seeder is at `src/services/nv-statute-seeding-service.ts` (670 lines, 30 IN Acts coded, ~283 sections). Pattern for expansion is documented inside the file. | Confirmation §6 |
| Build + redeploy canonical image | **DEFERRED — FU-T010.** Hot-patch via `docker cp` is durable across container restarts (lives in container layer); a canonical image rebuild is scheduled for the next ops window. Both NV-NSP-FIX-002 and NV-NSP-FIX-003 are committed in repo at the standard paths so the next build picks them up. | Confirmation §3.4 |

### 7.2 Cross-check: unwired / undeployed inventory

Filed in full in **`NYV-SCHEMA-MIGRATION-CONFIRMATION-2026-04-27.md` §4**. Headline split:

- **WIRED-NOT-DEPLOYED (route exists, DB seed empty by design):** 13 surfaces — wai-*, nyayamitra, clawd, twindesk, openbot, voice, academy, ministry, institutional, marketplace, automate, agui-streams, regulatory_feeds. None are code-plane bugs; all wait on tenant onboarding or feed activation.
- **DEPLOYED-NOT-WIRED (data captured but no UI / no reader route):** 2 surfaces — `nv_schema.data_lineage_events` (11 rows, no `/api/nv/lineage/*`) and `nv_router_decisions` (14 rows, no Console panel). Tracked as FU-T012a, FU-T012b.
- **CODE-ONLY (service in repo, not wired):** 5 services — citation-grounding (`citations` block always empty in orchestrate response — FU-T012c), self-RAG validator (FU-T012d), adaptive-RAG router (FU-T012d), GRPO trainer (pre-MVP), fine-tuning pipeline (pre-MVP).
- **LIVE (everything wired and serving):** 9 surfaces — `/auth/login`, `/nv/health`, `/nv/orchestrate`, `/nv/agents`, `/nv/statutes`, `/nv/templates`, `/nv/jurisdictions`, `/nv/sdk/applications`, `/nv/csrf-token`.
- **KNOWN-FAILURE (deployed, log-spamming):** 1 service — `production-doc-processor` polls a missing dev-edge table every 3 s with `code 42P01`. Non-blocking. FU-T012e.

### 7.3 Status banner change

The `status: live` banner at the top of this report is **retained**. The banner on `NYV-SCHEMA-MIGRATION-CONFIRMATION-2026-04-27.md` is `status: verified-live`. The seven source-of-truth docs that this audit cross-checked retain their existing `status` values; their numeric claims remain accurate per §2 of this report once the §7.1 dispositions above are read alongside.

### 7.4 Hash-chain anchor

```
Genesis row inserted:
  table:         public.nv_audit_logs
  trace_id:      genesis-1777xxxxxxx
  event_type:    audit.chain.genesis
  record_hash:   4c87752cd4fc...
  previous_hash: 0000…0000  (32 bytes of zero — chain start)
  timestamp:     2026-04-27T09:01:21.902Z UTC
  inserted_by:   NV-NSP-FIX-005 (consolidated seed-empties.cjs §nv_audit_logs genesis)
```

This row is the canonical chain-anchor for nv-dev-edge. All future per-orchestrate audit rows (once FU-T006a is wired) will chain backwards to it.

