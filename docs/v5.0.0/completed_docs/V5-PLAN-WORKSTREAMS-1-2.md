---
status: COMPLETED
completed_at: 2026-05-06 (Session 7)
moved_to_completed_at: 2026-05-06T19:00Z
follow_up_doc: docs/v5.0.0/GO-LIVE-STATUS-2026-05-06.md
---

# V5 READINESS — Detailed Implementation Plans for Workstreams #1 & #2
**Filed:** 2026-05-06 · **Owner:** Platform team
**Companion to:** `V5-READINESS-PLAN-2026-05-06.md`

These two workstreams are each multi-day and were intentionally **not** shipped
in the 2026-05-06 session because partial implementations would silently break
correctness guarantees (privacy ε-budget for #1; "did the agent actually run?"
for #2). This doc gives a future session enough detail to execute mechanically.

---

## WORKSTREAM #1 — In-Memory → DB Persistence (5 services, 12 tables)

### Why P0
`src/services/security/nv-federated-privacy-service.ts` keeps **federated
sessions and gradient stores in module-level `Map<>`s** (`sessions`,
`gradientStore` at lines ~43-44). Any process restart wipes the differential-
privacy ε-budget — a participant who already exhausted their privacy budget can
silently re-submit gradients after a restart and **the noise calibration is
wrong**. This is a privacy-guarantee bug, not a UX nuisance.

The four bot/automation services (`clawdbot`, `openbot`, `automateai`,
`twindesk`) keep bot configs, conversations, channel routes, and workflow
executions in `Map<>`s too — survives the same fate, but the failure mode is
"customer thinks their bot is gone after a deploy" rather than a privacy
breach.

### Files & current state
| Service | File | In-memory state (line) |
|---|---|---|
| federated-privacy | `src/services/security/nv-federated-privacy-service.ts` | `sessions = new Map<…>()` (~L43), `gradientStore = new Map<…>()` (~L44) |
| clawdbot | `src/services/clawdbot/clawdbot-service.ts` | `botRegistry`, `conversationStore` (L144-145) |
| openbot | `src/services/openbot/openbot-service.ts` | `channelRegistry`, `routingRules`, `messageInbox` (L150-152) |
| automateai | `src/services/automateai/automateai-service.ts` | workflow defs + executions (≈L80) |
| twindesk | `src/services/twindesk/twindesk-service.ts` | desk sessions + agent assignments |

### 12 new drizzle tables (canonical schema = `nv_schema`)
```
1.  nv_fed_sessions          (sessionId PK, clientId, modelType, status, participantCount, epsilon_consumed NUMERIC, epsilon_budget NUMERIC, created_at)
2.  nv_fed_gradients         (id PK, sessionId FK, gradient_vec JSONB, noise_added BOOL, submitted_at)
3.  nv_fed_aggregated_models (sessionId FK, gradients JSONB, participantCount, completedAt)
4.  nv_clawdbot_bots         (botId PK, orgId, name, channels JSONB, jurisdiction, persona JSONB, status, created_at, updated_at)
5.  nv_clawdbot_conversations (id PK, botId FK, channel, user_handle, transcript JSONB, escalation_status, created_at)
6.  nv_openbot_channels      (channelId PK, orgId, channel_type, credentials_encrypted BYTEA, status, created_at)
7.  nv_openbot_routes        (id PK, orgId, source_channel, target_bot, conditions JSONB)
8.  nv_openbot_inbox         (id PK, channelId FK, message JSONB, processed BOOL, received_at)
9.  nv_automateai_workflows  (workflowId PK, orgId, name, definition JSONB, version, active BOOL, created_at)
10. nv_automateai_runs       (runId PK, workflowId FK, status, input JSONB, output JSONB, started_at, completed_at)
11. nv_twindesk_sessions     (sessionId PK, orgId, owner_user_id, twin_config JSONB, status, last_active)
12. nv_twindesk_assignments  (id PK, sessionId FK, agent_id, role, assigned_at)
```
Each table gets `(orgId, created_at DESC)` index for tenant-scoped listing.
`nv_fed_sessions` gets a partial index on `WHERE status = 'collecting'` for
the active-session list. `nv_fed_gradients` should be **append-only** (no
UPDATE / DELETE) — enforced via row-level trigger.

### Implementation pattern (per service)
1. Add table to `shared/schema.ts` (Drizzle).
2. Run `npm run db:push` — verify with `psql \d nv_schema.<table>`.
3. **Hydrate on boot:** in service module's `init()`, `SELECT * FROM <table>
   WHERE status NOT IN ('archived','completed')` and re-populate the `Map<>`.
4. **Write-through:** every `Map.set()` call followed by an INSERT/UPSERT
   (use `INSERT ... ON CONFLICT (id) DO UPDATE`); every `Map.delete()` →
   soft-delete (`UPDATE … SET status='archived'`).
5. **Idempotent op IDs:** every mutation accepts a client-supplied
   `idempotencyKey`; the ON CONFLICT key is `(orgId, idempotency_key)`.
6. Keep the in-memory `Map<>` as a **read cache** — every read goes to the
   Map, miss → fetch from DB → backfill Map.
7. Add a `/health/persistence` endpoint per service that returns
   `{ ramEntries, dbEntries, lagSeconds }` so we can monitor cache drift.

### Federated-privacy specifics (do NOT skip)
- Add `epsilon_consumed NUMERIC NOT NULL DEFAULT 0` and
  `epsilon_budget NUMERIC NOT NULL` columns to `nv_fed_sessions`.
- `submitGradients()` must `UPDATE nv_fed_sessions SET epsilon_consumed
  = epsilon_consumed + $delta WHERE sessionId = $1 AND epsilon_consumed +
  $delta <= epsilon_budget` and **reject if rowcount = 0** (over-budget).
- The check must run inside a `SERIALIZABLE` transaction with the gradient
  insert — anything weaker allows two concurrent gradient submissions to
  each see budget remaining.

### Acceptance
- `pkill -9 node && systemctl restart nyv-gateway` → all 5 services list
  the same entries they had before the kill (verify with curl probes
  embedded in `scripts/test-persistence-survives-restart.sh`).
- 100 concurrent gradient submissions against a session with budget = 1.0
  result in **at most** the number of submissions whose summed ε ≤ 1.0
  being accepted (load test in `scripts/test-fed-privacy-budget.ts`).

### Estimated effort: 3 working days (1 day federated-privacy, 2 days bots
× 4, plus review)

---

## WORKSTREAM #2 — RAG Cross-Cutting Verification (29 categories × 7 jurisdictions = 203 cells)

### Why
There are **5 RAG pipelines** wired into the platform
(`rag-service.ts`, `self-rag-service.ts`, `corrective-rag-service.ts`,
`adaptive-rag-service.ts`, `nyv-graphrag-legal-service.ts` plus the
`advanced-multimodal-rag.ts` for non-text inputs). It is currently **unknown**
which pipelines actually have indexed corpus for which (category × jurisdiction)
cell. The 1042-agent registry assumes coverage everywhere, but a routing call
into "Saudi Tax Disputes" might silently hit an empty index and the agent
hallucinates.

### Cells to verify (29 × 7 = 203)
**Categories** (29): contracts · NDAs · employment · IP-trademark · IP-patent ·
IP-copyright · property-conveyancing · property-leases · litigation-civil ·
litigation-criminal · litigation-commercial · arbitration · M&A · corporate-
governance · securities · banking-finance · tax-direct · tax-indirect-GST/VAT ·
competition-antitrust · data-protection-DPDPA/GDPR · cyber-security ·
environment · labor-industrial · family-personal · succession-estate ·
constitutional · administrative · regulatory-FDI · ADR/mediation.
**Jurisdictions** (7): IN · UK · US · GCC · EU · SG · DEFAULT.

### Audit script — `scripts/rag/audit-coverage-203.ts`
Pseudocode:
```ts
for category in CATEGORIES:
  for jur in JURISDICTIONS:
    const fixture = await loadFixtureQuery(category, jur);   // canned legal Q
    const result = await ragService.query({ query: fixture.q, jurisdiction: jur, category });
    record({
      category, jur,
      sourcesReturned: result.sources.length,
      avgSimilarity: mean(result.sources.map(s => s.score)),
      pipelineUsed: result.pipeline,           // 'graphrag' | 'self-rag' | …
      groundedAnswer: await llmJudge.isGrounded(fixture.q, result.answer, result.sources),
      latencyMs: result.latencyMs,
    });
emit JSONL → docs/v5.0.0/rag-coverage-2026-XX-XX.jsonl
emit aggregate dashboard JSON consumed by client/src/pages/rag-coverage-dashboard.tsx
```

### Required new bits
- `client/src/pages/rag-coverage-dashboard.tsx` — 29×7 heatmap
  (red = 0 sources, yellow = sources but ungrounded, green = grounded)
  reads `/api/nv/admin/rag/coverage` (GET) which serves the latest JSONL
  rolled up.
- `src/routes/nv-rag-audit-routes.ts` — POST `/run` to kick the audit
  (super_admin), GET `/coverage` to return last result.
- `scripts/rag/fixtures/<jur>/<category>.json` — 203 fixture queries.
  Expected expert effort to build these is ~2 hours total (one
  representative legal Q per cell).
- `scripts/rag/backfill-empty-cells.ts` — for any RED cell, dispatch a
  scrape job (using **Workstream #3** web scraper) against the
  jurisdiction-appropriate allowlist source and re-ingest into GraphRAG.

### Acceptance
- After first run: heatmap has zero RED cells with no ingest path; every
  RED cell either has a backfill job queued or a documented "no public
  source" exception.
- CI: `npm run rag:audit` fails the build if any GREEN cell regresses to
  YELLOW/RED on a future commit.

### Estimated effort: 2 working days (0.5 day fixtures + 1 day audit
runner + dashboard + 0.5 day backfill wiring)

---

## ROLLOUT ORDER (recommended)

1. **Workstream #3 (web scraper)** — DONE 2026-05-06. Ingestion path
   exists, so #2's backfill mechanism has somewhere to push to.
2. **Workstream #2 (RAG audit)** — gives us a coverage map. Now we
   know what's empty and what's not.
3. **Workstream #1 (in-memory → DB)** — schema design + federated-privacy
   first (P0), bots second. Has zero coupling to #2 / #3 so it can run
   in parallel with either if a second engineer is available.

---

## OUT OF SCOPE FOR THESE WORKSTREAMS

- Per-toggle hot-reload via event-bus for feature flags (current flags
  re-read on each call — works correctly, just not zero-overhead).
- Duplicate-route consolidation (21 alias pairs in `App.tsx`). Cosmetic.
- Sidebar redesign (`AdminSidebar.tsx` ~50-item flat list). UX issue,
  not a correctness bug; the new Enterprise Console already provides a
  parallel IA at `/console/enterprise-dashboard`.
