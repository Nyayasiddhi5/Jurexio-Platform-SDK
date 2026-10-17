---
status: pending
version: 3.1.2
last_verified: 2026-05-07
---

## Provenance — merged-task → follow-ups coverage

This table proves every merged-task body in the project history was
checked. "Source" = `git --no-optional-locks log --all --grep='Follow-ups proposed:'`
plus a manual scan of every merge commit subject for the prefix
`Task #` or the phrase `follow-up` / `defer`. Reviewed on **2026-05-07**.

Distinct merged task-IDs found in `git log --all --grep='Task #'` at this
re-verification: **#1, #6, #11, #13, #17, #27, #28, #29, #30, #31, #32,
#33, #34, #36, #37, #38, #39, #43, #61, #64, #66, #67, #69, #87, #88,
#89, #90, #91** (28 distinct).

| Merged task ID | Commit (short SHA) | Follow-ups proposed in body? | Captured below as |
|---|---|---|---|
| #66 | `56290ce` / `4fa29a3` | Yes — named #76, #77, #78 | filed under `4. Caching & Performance` |
| #67 | `9d32f74` / `a6d7472` | Yes — named #79, #80, #81 | filed under `4. Caching & Performance` |
| #87 | `6daa43f` / `d28acea` / `e73f729` / `d7ef7e0` | No `Follow-ups proposed:` line; subject = doc reorg | n/a — nothing to file |
| #88 | `7fea97d` / `a471c31` / `d72f455` / `22a936e` | No (this *is* the consolidation doc) | n/a — meta task; doc itself is the deliverable |
| #89 | `3c66456` | No `Follow-ups proposed:` line; CEO/investor product note | n/a — nothing to file |
| #90 | `578810b` / `59bb236` | "no follow-ups proposed" stated explicitly; assignment is its own roadmap | n/a — nothing to file |
| #91 | `004ecee` / `75346bc` / `3e9c168` | No new `#N` references; uses TBD markers tied to existing follow-ups | n/a — already filed |
| #30 | `89cfb43` / `e4fb2f0` / `3246cb6` / `6b8a752` | "Bug clusters surfaced (filed as follow-ups)" — covered by #48, #49 already in §6 | n/a — already filed |
| #37 | `a7c9aee` | "filed as a follow-up" → #62 (already in §5) | n/a — already filed |
| #64 | `f901289` / `26c6957` / `63cfbf9` | Cites out-of-scope #84 (already archived) | n/a — already filed/archived |
| All other merged Task IDs above | scanned commit subject + body | None named `Follow-ups proposed:` | n/a — nothing new to file |
| #82, #83, #84 | cancelled in `Drafts` queue post-doc-creation | n/a — never merged | listed in §Archived |
| Current re-verification pass (2026-05-07, commit `39a1d84`) | n/a — `proposeFollowUpTasks` blocked per system note (already called once for the parent Task #88 consolidation); this revision is a verification refresh, not a new consolidation | n/a — header `last_verified` bumped to 2026-05-07; no new themes opened |

If a future merge introduces `Follow-ups proposed: #N, #M` and either
`#N` or `#M` is not present in the project task queue when this doc is
re-verified, add it under the matching theme below with the ref
`unfiled` (no project task ref) until one is created.

# Nyayavigya Platform — Agent-Suggested Follow-Ups (Consolidated)

This document collects every follow-up task that prior task agents proposed
across the merged work in this project. It exists so a human reviewer can scan
the backlog in one place and decide **keep / cancel / now-vs-later**, instead
of hunting through individual merge commit bodies and the project task queue.

**Source of truth:** the project task queue (34 tasks currently in `Drafts`
state — internally `PROPOSED`; `Drafts` is the user-facing display name for
the same state — down from 37 at the time the brief for this doc was
written; Tasks #82, #83, and #84 were cancelled in the interim and now
appear in the **Archived** section below) plus `git log --all --grep='Follow-ups proposed'`
against the merged task commits. Every entry below traces back to one of
those two sources — no follow-ups were invented for this doc.

The git-log scan returned exactly 3 commits matching `Follow-ups proposed:`
(against Tasks #66 and #67), and every follow-up named in their bodies
(#76, #77, #78, #79, #80, #81) is already represented as a `Drafts` project
task — so this doc has no `unfiled` entries today. If a future merge adds a
`Follow-ups proposed:` line that names a `#N` not already in the project
queue, the maintainer should add it under the matching theme below with the
ref shown as `unfiled` (no project task ref) until one is created.

**Priority labels (P0–P3) are suggestions by the doc author, not binding
decisions.** A reviewer should adjust them before any of these enter sprint
planning. The shorthand:

- **P0 — blocker.** Something visibly broken or unsafe in production today.
- **P1 — next quarter.** Promised behaviour that isn't backed by a test, or a
  shipped feature that needs a turn-on / scale-up step.
- **P2 — nice to have.** Quality-of-life, dashboard polish, opt-in tooling.
- **P3 — archive candidate.** Probably overtaken by later work; review before
  closing.

**Reading the entries.** Each bullet shows: `[task-ref]` — title (source:
merged Task #N, priority: Px), then a short "why this was proposed" line. If
the original commit body did not explicitly cite a source task, the source is
shown as `inferred Task #N` based on subject-matter overlap.

---

## 1. Security & Compliance

The platform shipped row-level security (Task #29), the audit hash chain
(#29 / #43), and the AWS WAF (#18) in observation mode. These follow-ups close
the loop between "feature exists" and "feature actually enforces in
production."

- **[#19]** — Flip the firewall from observation to enforcement after the
  7-day review (source: inferred Task #18, priority: **P1**)
  The dev-edge WAF is in count-only mode so we can review false positives
  before blocking real traffic. After ~7 days an operator must tune rules and
  flip it to `block`. Until that happens the firewall is a dashboard, not a
  defence.
- **[#20]** — Send firewall alerts to a real inbox or chat channel (source:
  inferred Task #18, priority: **P1**)
  The WAF has a CloudWatch dashboard but no alarm destination, so a sudden
  burst is invisible until someone opens the console. Wire up SNS → email or
  Slack so on-call hears about it.
- **[#41]** — Drop legacy plaintext columns once encrypted backfill is verified
  (source: inferred Task #29, priority: **P1**)
  Field-level encryption (Task #29) writes to new ciphertext columns while the
  legacy plaintext columns still exist for backfill verification. Once a fleet
  comparison shows 100% parity, the plaintext columns must be dropped or they
  remain a compliance liability.
- **[#42]** — Provision a non-superuser app role so RLS actually filters in
  production (source: inferred Task #29, priority: **P0**)
  Migration 0004 enables `FORCE ROW LEVEL SECURITY`, but PostgreSQL exempts
  `SUPERUSER` and `BYPASSRLS` roles entirely. The pooled prod role is currently
  superuser, so RLS is a no-op there even though the test suite passes against
  a non-superuser test connection. Provisioning a dedicated `nyv_app` role and
  pointing the app at it is what makes RLS real.

## 2. Observability & Telemetry

Sentry tracing landed in Task #39. These follow-ups extend coverage and cut
noise so dashboards remain useful at production traffic.

- **[#40]** — Cut log noise when traffic is high by making span logging
  optional (source: Task #28, priority: **P2**)
  The JSONL span logger from Task #28 emits one line per span, which at >100
  rps drowns the rest of the gateway logs. Add a sampling rate or env-flag to
  silence span logs when Sentry is the primary sink.
- **[#53]** — Send backend errors to Sentry, not just frontend crashes
  (source: Task #39, priority: **P1**)
  The Sentry tracer captures spans, but uncaught backend exceptions still only
  hit the JSON logger. Wire Sentry's error reporter into the gateway error
  middleware so server-side crashes show up alongside the React ones.
- **[#54]** — Tag Sentry traces with the tenant/organization so per-customer
  filtering works (source: Task #39, priority: **P1**)
  Spans currently carry `orchestrationId` and `jurisdiction` but not `orgId` /
  `tenantId`. Without that tag, debugging a single enterprise customer's
  failure means trawling the whole trace stream.
- **[#55]** — Track how often the audit chain falls back to single-pod mode
  (source: inferred Task #43, priority: **P2**)
  The Redis distributed lock (Task #43) degrades to in-process locking when
  Redis is unreachable. There's no metric for how often that happens, so a
  silent multi-pod degradation could go unnoticed for days.
- **[#60]** — Stop crashing observability dashboards on the orchestration
  scoreboard (source: inferred Task #69, priority: **P0**)
  The orchestration scoreboard endpoint throws when certain agent rows are
  missing fields, taking the dashboard down with a 500 instead of rendering
  partial data.
- **[#65]** — Show cache savings on the orchestration dashboard (source: Task
  #38, priority: **P2**)
  Task #38 wired the prompt cache and Task #66 added admin clears. Operators
  still can't see cache hit-rate or token-cost-saved per agent on the existing
  dashboard. Surfacing it would justify the cache and reveal cold spots.

## 3. SDK & Partner Integration

The 3 SDK variants reached GA in Task #31, with publish automation in Task
#45. These follow-ups make the published artifacts actually usable by an
external partner without help from the platform team.

- **[#51]** — Publish the shared types package alongside the GA SDKs (source:
  inferred Task #31, priority: **P1**)
  The 3 SDK variants depend on a shared internal `@nyv/types` package that
  isn't published, so a partner who installs the public SDK gets unresolved
  type imports.
- **[#52]** — Verify a published SDK actually installs and runs end-to-end
  after release (source: inferred Task #31 / #45, priority: **P1**)
  The npm publish pipeline (Task #45) succeeds, but no automated check pulls
  the published artifact into a clean container, runs the quickstart, and
  asserts the gateway responds. A broken publish would only be discovered by a
  partner.
- **[#57]** — Make the SDK installable so partners can actually use the
  quickstarts (source: inferred Task #31, priority: **P0**)
  Companion to #52: the quickstart `npm install @nyayavigya/sdk` currently
  fails for partners because the package is private or the tag isn't pushed.
- **[#59]** — Make the web quickstart actually run from the README's
  instructions (source: inferred Task #31, priority: **P0**)
  Following the public README produces an example that crashes on the first
  request — env var names drifted, a route was renamed, or a peer dep is
  missing. New evaluators bounce off in <5 minutes.

## 4. Caching & Performance

Tasks #38, #66, and #67 built the per-agent prompt cache, admin invalidation,
and Redis-backed restart persistence. These follow-ups turn it on, fan out
clears, and prove it works.

- **[#68]** — Persist agent performance signals across restarts (source:
  inferred Task #33, priority: **P2**)
  The smart-router (Task #33) keeps per-agent latency / success-rate signals
  in process memory. Every restart resets them, so the router has to relearn
  for the first ~100 requests after every deploy.
- **[#76]** — Show ops a one-click button to clear stale cached answers from
  the admin console (source: Task #66, priority: **P2**)
  Task #66 added the backend endpoints and CLI but no UI. Ops must memorise
  the gateway URL, the `cache:admin` scope, and the JSON payload — or shell
  into a pod. A button removes the friction.
- **[#77]** — Show admins a list of recent cache clears for compliance review
  (source: Task #66, priority: **P2**)
  Cache invalidations are written to the audit hash chain, but there's no
  view onto them. Compliance reviewers can't easily ask "did anyone clear
  the IPC-rape agent cache last week?".
- **[#78]** — Make cache clears reach every running server, not just one
  (source: Task #66, priority: **P1**)
  An admin clear today only invalidates the in-process cache of the receiving
  pod. The other pods keep serving the stale answer until their own TTL
  fires. A Redis pub/sub fanout fixes this.
- **[#79]** — Turn the shared prompt cache on in staging and production
  (source: Task #67, priority: **P1**)
  Task #67 made the cache restart-survivable behind `LMCACHE_SHARED_BACKEND=
  redis` but the flag is off everywhere. Staging is the obvious next step.
- **[#80]** — Keep popular cached answers alive by refreshing their TTL on
  each hit (source: Task #67, priority: **P2**)
  Today every cached answer expires 24h after first write regardless of how
  often it's hit. Sliding-window TTL would keep the always-asked questions
  permanently warm and only evict actual cold spots.
- **[#81]** — Prove the shared cache works end-to-end against a real Redis
  (source: Task #67, priority: **P1**)
  The current test suite stubs the Redis backend. A real-Redis integration
  test (Testcontainers or staging Redis) is needed before #79 can flip the
  flag in prod with confidence.

## 5. Streaming & Orchestration Internals

Tasks #36, #37, #61, and #64 hardened the streaming layer (per-request
emitters, AsyncLocalStorage span context, typed orchestration ID, no-cross-
tenant guarantees). These follow-ups extend the same rigor to the rest of
the streaming surface.

- **[#62]** — Add a regression test that the orchestration ID is stamped on
  every streaming event (source: inferred Task #36 / #37, priority: **P1**)
  Task #37 made `orchestrationId` a typed field. There's a test that no
  events leak between tenants but no positive test that *every* event in a
  stream actually carries the ID.
- **[#63]** — Catch event cross-leaks in other streaming endpoints, not just
  AG-UI (source: Task #36 / #27, priority: **P1**)
  The cross-tenant streaming regression (Task #36) only exercises the AG-UI
  endpoint. The other streaming routes (SSE for agent thoughts, WebSocket
  voice channel) deserve the same guarantee.
- **[#71]** — Show users why an answer was held back or flagged for review
  (source: Task #34, priority: **P1**)
  When the safety layer (Task #34) blocks a response, the SDK currently
  returns a generic "your request was held for review." End-users see a
  stuck spinner with no actionable explanation.
- **[#72]** — Replace the safety verdict with the platform's grounded
  hallucination detector (source: inferred Task #34, priority: **P2**)
  The safety layer's hallucination check is heuristic. The grounded detector
  built later in #34's neighbourhood is more accurate but has not been
  swapped in.

## 6. Operational Tooling

Quality-of-life fixes for the platform-engineering team itself — broken dev
ergonomics that block other tasks.

- **[#48]** — Fix broken compliance forms that crash with raw database errors
  (source: inferred Task #30, priority: **P0**)
  UAT v3.2 found four DPDPA endpoints (data-subject request, consent record,
  incident report, evidence chain) crash with HTTP 500 and leak raw
  PostgreSQL parser errors. A fifth coerces a missing tenant ID to the
  string `"NaN"`. These are the highest-visibility production bugs in the
  current backlog.
- **[#49]** — Seed a working API key in dev so voice and rate-limit tests can
  actually run (source: inferred Task #30, priority: **P1**)
  The dev environment ships without a usable API key, so any test or smoke
  script that authenticates as a partner has to mint one manually first.
- **[#50]** — Auto-tag and changelog releases so cutting a release is one
  command (source: inferred Task #45, priority: **P2**)
  Cutting a release today is "edit CHANGELOG, bump versions, tag, push" by
  hand. A `release-please`-style workflow would remove the human step.

## 7. Testing & Regression Coverage

Tests for behaviour that already shipped but isn't yet protected by CI.

- **[#35]** — Add load tests proving each tier's concurrency limits hold
  (source: inferred Task #28, priority: **P2**)
  The tier-based concurrency caps (Task #28) are config — there's no load
  test that 100 concurrent free-tier requests get throttled while 100
  enterprise-tier requests don't.
- **[#56]** — Run the audit chain test against a real Redis to prove pod
  coordination end-to-end (source: inferred Task #43, priority: **P1**)
  Companion to #55: today's audit-chain test mocks the Redis lock. A real-
  Redis test would catch ordering bugs the mock can't see.
- **[#73]** — End-to-end test: a deliberately-unsafe LLM response is blocked
  at the HTTP layer in production (source: Task #34, priority: **P1**)
  The safety unit tests assert the verdict is `block`. Nothing currently
  asserts the gateway's HTTP response is also a 4xx and the unsafe content
  never reaches the wire.
- **[#85]** — Lock in trace-tree integrity with an end-to-end test (source:
  Task #61, priority: **P2**)
  Task #61's AsyncLocalStorage span auto-parenting is covered by unit tests
  but no end-to-end test runs a real `QueenOrchestrator.orchestrate()` and
  asserts every emitted span (`queen.rag`, `queen.decompose`, …) attaches
  to the right parent.
- **[#86]** — Fix the streaming test mock so lifecycle event coverage is
  verified again (source: inferred Task #37 / #64, priority: **P2**)
  The streaming test mock fell behind the real emitter shape, so the
  lifecycle event assertions are silently passing on no-ops. The mock needs
  to be rewritten before the assertions mean anything.

## 8. Routing & Cost

- **[#70]** — Tune the smart router with real-traffic A/B comparison (source:
  inferred Task #69 / #33, priority: **P2**)
  The router weights dashboard (Task #69) shows what the router would pick.
  An A/B harness that runs both old and new weight schemes against shadow
  traffic would let ops actually tune them with data.

---

## Archived (cancelled) follow-ups

These tasks were proposed and then cancelled. Each line includes a one-line
note on why, when discoverable from the task description or the cancellation
context.

- **[#2]** — Add a paid LLM key (OpenAI/Anthropic) so Mitra agents stay
  reliable under load. *Superseded by OpenRouter integration.*
- **[#3]** — Show the 3 Nyayamitra agents in the public agents list.
  *Subsumed into Task #32 (services-catalog wire-up).*
- **[#4]** — Fix the noisy DB write warnings during orchestration (missing
  tables). *Resolved as part of Task #47's planned table restoration; #47
  itself was later cancelled in favour of inline migrations in #29.*
- **[#5]** — Replit foundation fixes + live AI UAT execution + bug-fix loop.
  *Replaced by the much larger Task #30 (Comprehensive 200+ scenario UAT).*
- **[#7]** — Comprehensive AI Testing UAT document (200+ cases). *Superseded
  by Task #30, which executes the UAT rather than just documenting it.*
- **[#8]** — Move Redis credentials out of secret-typo zone with a managed
  Replit Redis. *Replaced by Task #17 (move Postgres + Redis to managed AWS).*
- **[#9]** — Mark unconfigured LLM providers as `no-key` instead of
  `degraded`. *Cosmetic; OpenRouter keys now cover the previously
  unconfigured providers.*
- **[#10]** — Tighten Vite client tsconfig and consolidate path-alias config.
  *Resolved during the Task #6 single-tree consolidation.*
- **[#12]** — Turn on the security firewall enforcement after one week.
  *Replaced by the more specific #19 (same intent, current firewall).*
- **[#14]** — Confirm cross-tenant safety check is blocking after staging
  redeploy. *Subsumed into Task #36's regression test.*
- **[#15]** — Make sure cross-tenant 403s show up in dashboards and alerts.
  *Folded into #20 (firewall alerts) and #54 (Sentry tenant tagging).*
- **[#21]** — Pre-create the RDS DR snapshot before the maintenance window.
  *Maintenance window passed; snapshot taken inline.*
- **[#22]** — Promote managed datastores into the prod env too. *Done as
  part of Task #11's DNS-cutover-to-prod work.*
- **[#23]** — Send Postgres + Redis health alerts to the team. *Out of
  scope; CloudWatch alarms tracked separately by infra.*
- **[#24]** — Stop traffic surges from overloading the platform. *Replaced
  by Task #28's circuit-breakers + tier limits.*
- **[#25]** — Get alerted before users notice an outage. *Folded into the
  Sentry rollout (Task #39 + #53).*
- **[#26]** — Document and automate cert + DNS rotation so nothing silently
  expires. *Out of scope; tracked by infra runbook.*
- **[#46]** — Build official sample apps in the App Store and Play Store.
  *Premature; the SDK isn't even partner-installable yet (#57).*
- **[#47]** — Restore the missing tables that break HITL queues, memory
  recall, and audit logs. *Resolved inline by Task #29's migrations.*
- **[#58]** — Stop shipping a broken voice flow — wire the SDK to the real
  gateway route. *Resolved during Task #31's SDK GA work.*
- **[#74]** — Auto-refresh the routing weights dashboard. *Cancelled in
  favour of focusing on the underlying router (#70).*
- **[#75]** — Show recent routing decisions next to the live weights.
  *Same: rolled into #70's A/B harness.*
- **[#82]** — Fix telemetry crash when reporting orchestration token totals.
  *Fixed inline in a Task #39 follow-up commit.*
- **[#83]** — Add a stress test proving concurrent orchestrations cannot
  leak events. *Replaced by Task #36's regression test.*
- **[#84]** — Stop other event consumers from depending on the singleton
  orchestrator. *Resolved by Task #64 (per-request emitters).*

---

## How this doc is maintained

When a future task merges, any `Follow-ups proposed:` line in its commit
body should be appended here under the right theme as a new bullet. The
script `scripts/nv-doc-reorganize.ts` does **not** automate this — the
follow-up extraction is a deliberate human step so the agent suggestion is
read and triaged, not silently filed.

Quick recipe for the next agent:

1. `git log --all --grep='Follow-ups proposed' --pretty=format:'%h%n%B%n---'`
   to dump every follow-up-bearing commit.
2. For each `Follow-ups proposed: …` line, check whether each `#N`
   reference already appears in this doc. If it does, no action needed.
3. If `#N` is new, look up its current state in the project task queue.
   If it's `Drafts` (PROPOSED) or later, add a bullet under the matching
   theme using the format: `**[#N]** — Title (source: Task #M, priority:
   Px) <one-paragraph why>`.
4. If a previously-`Drafts` task has been cancelled, move its bullet to
   the **Archived (cancelled)** section with a one-line cancellation
   reason.
5. Bump `last_verified` in the YAML header to the current date.

The companion roadmap doc (Task #90) and business / technical product notes
(#89, #91) are downstream consumers of this list — keep this one accurate
and they stay accurate too.

---

## Appendix: provenance for this revision

Originally generated on **2026-04-30** by Task #88. Re-verified on
**2026-05-07** against the latest git log of this repository. The
re-verification scan added the explicit per-task rows for #87, #88, #89,
#90, #91, #30, #37, #64 to the Provenance table above so that *every*
merged task with `Task #` in its subject is accounted for, not just the
two that name `Follow-ups proposed:` literally. No new theme bullets
were opened — every actionable follow-up cited in any merged task body
already appears under §1–§8 above.

Reproduce via:

```bash
# 1. Dump every task with its description (uses the project_tasks tooling).
#    Re-run this to see whether the PROPOSED ("Drafts") count has shifted.
listProjectTasks({ includeDescription: true })

# 2. Mine merge commit bodies for "Follow-ups proposed:" lines.
git --no-optional-locks log --all --grep='Follow-ups proposed' \
  --pretty=format:'%h%n%s%n%b%n---'

# 3. Mine ALL merged Task # subjects (broader sweep, used for the
#    expanded Provenance table on 2026-05-07).
git --no-optional-locks log --all --grep='Task #' \
  --pretty=format:'%h%n%s%n%b%n---'
```

When you next refresh this doc, re-run all three commands, diff against
the sections above, and bump `last_verified` in the YAML header to
today's date.
