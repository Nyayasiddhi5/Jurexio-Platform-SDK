# SME Legal Chat — Runbook (Task #156)

Stand-alone Subject Matter Expert workspace at **`/sme`** that exercises
the full Nyayavigya stack (PII → Queen → 22 agents → multi-tier RAG →
safety → audit) on real legal prompts and rates every run via a
5-criteria GRPO rubric. CAM / maker-checker is **forced ON** for every
SME session regardless of the global `NYV_F_GOV_MAKER_CHECKER` flag.

## Surfaces

| Path | Purpose |
|---|---|
| `/sme/login` | Focused SME sign-in (shares JWT with main console) |
| `/sme` | Workspace: chat (left), workflow (right), rubric modal |
| `POST /api/nv/legal-chat/send` | If caller's backend role is `sme` (or Superadmin with `mode=sme`), forces CAM, recalls mem0, post-stores on completion. Client-controlled `mode`/`smeContext` flags alone CANNOT escalate into SME-only paths. |
| `POST /api/nv/legal-chat/feedback` | Persists rubric → also enqueues GRPO Redis stream + EMA bump + mem0 reinforce |

Frontend entry-point branching lives in `client/src/main.tsx` — paths
starting with `/sme` mount `<SmeApp/>` (its own `Router base="/sme"`,
lean providers); everything else mounts the existing `<App/>` with
`Router base="/console"`.

## Provisioning a new SME

```sql
-- 1. Mark a user as SME (the role itself grants legal-chat access).
UPDATE nv_users SET role = 'sme' WHERE email = 'sme1@example.com';

-- 2. (Optional) Narrow scope via allocation. Absent allocation = global scope.
INSERT INTO sme_allocations (sme_user_id, allocated_by_user_id, scope, active)
VALUES (
  (SELECT id FROM nv_users WHERE email = 'sme1@example.com'),
  (SELECT id FROM nv_users WHERE role IN ('superadmin','super_admin') LIMIT 1),
  '{"jurisdictions":["IN","UK"],"practiceAreas":["data_protection"]}'::jsonb,
  TRUE
);
```

The Superadmin can also use the existing UI at `/console/legal-chat` →
SME allocations tab (which calls `POST /api/nv/legal-chat/sme-allocations`).

## What forced-ON means (CAM / maker-checker)

`maybeRunMakerCheckerLoop()` in `src/orchestration/nv-queen-orchestrator.ts`
checks `request.metadata.forceMakerChecker` BEFORE the
`govMakerChecker` env flag. SME runs set `forceMakerChecker: true` in
the `/send` route (file: `src/routes/nv-legal-chat-routes.ts`,
guarded by `isSmeRun`). Default-OFF semantics for the rest of the
platform are preserved byte-for-byte.

## The 6th memory tier (mem0)

SME runs sit ALONGSIDE the platform's 5-tier memory architecture
(working / episodic / semantic / procedural / GraphRAG) by adding a
sixth, **preference-only** tier scoped per SME (`sme:<userId>:<JUR>`):

- Pre-send: `recallSmePreferences()` pulls top-k matches and surfaces
  them via `metadata.smePreferenceContext`. Emits a `memory_injection`
  timeline event so the right-hand WorkflowPane shows the hit count.
- Post-send: `storeSmeInteraction()` persists `(prompt, response,
  model, jurisdiction, taskKind, citations)` into the SME's namespace.
- On feedback: `applyRubricToMem0()` reinforces (avg ≥ 0.7) or forgets
  (avg < 0.4) the matching entries.

File: `src/services/sme/sme-mem0-hooks.ts`. Singleton store, in-process,
distinct from the platform's main memory tiers. NEVER throws — the
SME run completes regardless of mem0 health.

## sessionId contract (mem0 + GRPO)

Every `/send` and `/feedback` call from Console Legal Chat **must** carry a
stable `sessionId` so:

- Queen memory recall uses `metadata.sessionId` (see
  `nv-queen-orchestrator.ts` memSessionId normalization).
- Assistant messages persist to `legal_chat_messages` for rubric join.
- `enqueueGrpoSignals()` can resolve jurisdiction/taskKind from the session row.

Verify after deploy:

```bash
# 1. Create session + send with sessionId (Console legal-chat or /sme)
# 2. Confirm timeline shows session_persisted → ok (not skipped)
# 3. POST /feedback with same sessionId → feedbackId returned
# 4. Redis (optional): XLEN nyv:grpo:training increased
redis-cli -u "$NYV_REDIS_TCP_URL" XLEN nyv:grpo:training
# 5. Postgres: nv_grpo_preference_pairs row for orchestration_id
```

Registry catalog: `GET /api/nv/legal-chat/agents?jurisdiction=IN` must return
`registryVersion: 5.1.0`, `totalAgents: 164`.

## GRPO training queue (Redis + Postgres)

Every rubric write (`POST /feedback`) triggers `enqueueGrpoSignals()`
(in `src/routes/nv-legal-chat-routes.ts`) which:

1. Joins the rubric with the orchestration's stored prompt/response/model.
2. Inserts a row into `nv_grpo_preference_pairs` (durable record).
3. `XADD nyv:grpo:training` on Redis (best-effort; `MAXLEN ~ 50000`).
4. `HSET nyv:grpo:prefs:{JUR}:{taskKind}:{model}` with the EMA
   (α=0.2) for the next router tie-breaker.
5. Reinforces / forgets matching mem0 entries.

File: `src/services/sme/sme-grpo-redis-queue.ts`. Redis is OPTIONAL;
when `resolveRedisTcpUrl()` returns disabled the module no-ops with one
warn line. Postgres remains the source of truth.

## Router EMA tie-breaker

`pickSequence()` in `src/services/intelligent-router/intelligent-router.ts`
adds a bounded ±0.04 boost per `(jurisdiction, taskKind, model)` from
`getEmaBoostSync()`. Sync, in-process LRU (60 s TTL), async refresh —
the router NEVER blocks on Redis.

## Bootstrap

```bash
cd nyayavigya-platform-312
DATABASE_URL="$NYV_DATABASE_URL" npx tsx scripts/nv-sme-bootstrap.ts
```

Idempotent. Creates `nv_grpo_preference_pairs`, `sme_allocations` (if
absent), and adjusts the `nv_users` role CHECK constraint to include
`'sme'`. Other tables (`legal_chat_sessions`, `legal_chat_messages`,
`sme_feedback`) are assumed to already exist (they pre-date Task #156)
with `owner_user_id` / `varchar(36)` schemas.

## Smoke harness

```bash
cd nyayavigya-platform-312
NV_SMOKE_BASE=http://localhost:5000 \
NV_SMOKE_EMAIL=sme1@example.com NV_SMOKE_PASSWORD=... \
NV_SMOKE_JURISDICTIONS=IN,UK,US,EU,SG,GC,GLOBAL \
npx tsx scripts/nv-sme-smoke.ts
```

Exits non-zero on any phase fail. Verifies for each jurisdiction:
login → session → SSE send (asserting `memory_injection`,
`safety_verdict`, `audit_chain`, `run_complete` steps appear) → rubric
feedback (asserting `feedbackId` returned).

## Files added / changed

```
NEW  scripts/nv-sme-bootstrap.ts
NEW  scripts/nv-sme-smoke.ts
NEW  src/services/nv-sme/nv-sme-mem0-hooks.ts
NEW  src/services/nv-sme/nv-sme-grpo-redis-queue.ts
NEW  client/src/sme/SmeApp.tsx
NEW  client/src/sme/SmeLogin.tsx
NEW  client/src/sme/SmeWorkspace.tsx
NEW  docs/canonical/14-sme-legal-chat-runbook-2026-05-12.md  (this file)
EDIT src/orchestration/nv-queen-orchestrator.ts        — honor metadata.forceMakerChecker
EDIT src/middleware/legal-chat-rbac.ts                 — recognise role=sme
EDIT src/routes/nv-legal-chat-routes.ts                — wire mem0 + GRPO queue
EDIT src/services/intelligent-router/intelligent-router.ts — EMA tie-breaker
EDIT client/src/main.tsx                               — branch /sme entry
EDIT client/src/lib/rbac-registry.ts                   — add 'sme' role
EDIT client/src/pages/legal-chat.tsx                   — accept 'sme' admin
```

## Manual verification checklist (post-deploy)

After every deploy of the SME stack, walk through this in a browser:

1. Hit `/sme` unauthenticated → SmeLogin renders, no /console chrome leaks.
2. Issue a setup link from `/console` (Superadmin → SmeAllocations →
   "Issue credentials") for a fresh email; copy the surfaced URL.
3. Open the setup URL in an incognito window → set password → land on
   `/sme` workspace as the new SME (role=sme).
4. Send a prompt for each jurisdiction tab (IN/UK/US/EU/SG/GC/GLOBAL).
   For each run confirm the right-hand WorkflowPane:
     - Renders all 7 phases (Intake → Complete) with pending placeholders
       BEFORE the SSE stream lands.
     - Lights up `request_received → ... → run_complete` as events arrive.
     - Surfaces `maker_checker` as `ok` (CAM is forced ON for SME runs).
     - "Replay" button replays the captured timeline at ~80 ms/step
       (button label shows `Replaying N/Total…`).
     - "Raw event log" <details> contains every raw token event.
5. Submit the 5-criteria GRPO rubric → confirm 200 + `feedbackId` toast.
6. As Superadmin in another tab: refresh `/console` → confirm the SME
   user appears in SmeAllocations, the new feedback row exists in
   `sme_feedback`, and the GRPO Redis stream `nyv:grpo:training` and the
   prefs hash `nyv:grpo:prefs:{J}:{taskKind}:{model}` both grew.
7. Confirm `/console` is hard-blocked for role=sme (App.tsx redirect to
   `/sme`).

## Shipped components (status snapshot 2026-05-12)

- WorkflowPane v2 — SHIPPED. 15 steps live in the canonical grid;
  step **10 · `llm_stream_token` is DEFERRED** until the Queen
  synthesis path exposes per-chunk callbacks (it is removed from the
  grid + `LegalChatTimelineStep` union for now to avoid lying to SMEs
  with a perpetual "pending" placeholder; the slot will be reinstated
  once chunked synthesis is plumbed through). Replay supports both
  local SSE buffer and server-canonical buffer via
  `GET /timeline/:id?snapshot=1` (Bearer token). Collapsible raw
  event log preserved for debugging.
- Redis pub/sub multi-replica fan-out for the legal-chat event bus —
  SHIPPED, gated by `NYV_LEGAL_CHAT_BUS_REDIS=1` (silent in-process
  fallback when Redis is absent or env unset).
- Superadmin "Issue credentials" UI + `/sme-allocations/issue` +
  `/auth/sme-setup` chain — SHIPPED.
- Smoke harness — runs full E2E issuance via `SUPERADMIN_TOKEN` when no
  pre-provided `SME_TOKEN` is supplied; asserts session ownership,
  Redis stream Δ ≥ pass count, and presence of `nyv:grpo:prefs:*` keys.

## Known limitations / deferred

- Mem0 store is in-process. Multi-replica prod needs a Postgres-backed
  re-binding behind the same API.
- A CI guardrail script for the SME wiring (`scripts/nv-check-sme-wiring.sh`)
  is not yet added; rely on the smoke harness + manual checklist above.
