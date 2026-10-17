---
status: work-in-progress
version: 3.1.2
superseded_by: null
last_verified: 2026-04-27
prior_status: pending
---

# Nyayavigya Platform — Roadmap Q2–Q4 2026

> ⚠️ **Status: WORK-IN-PROGRESS (live audit 2026-04-27).** A live audit on 2026-04-27 against `nv-dev-edge` RDS + ElastiCache + EC2 (`13.232.165.242`) found that several items the §2 "Recently shipped" table marks **MERGED** are merged in code but **not yet deployed/seeded live**: #29 (PII vault — `nv_pii_vault` table missing), #43 (audit chain — `nv_audit_logs` empty, no rows to verify), #32/#33 (capability manifest + smart routing — only 7 rows in `nv_router_decisions`), and the May-15 GA blocker list in §4.1 should add **(a) seed master data into RDS** and **(b) run `npm run seed:all` + `seed:master` against dev-edge** before the launch lock holds. The five BullMQ queues (#27 / SDK §6.1) **are** registered ✓. Reality snapshot + a re-prioritised Q2 checklist: [`NYV-LIVE-AUDIT-GAP-REPORT-2026-04-27.md`](../NYV-LIVE-AUDIT-GAP-REPORT-2026-04-27.md).

**Audience:** Product head, CEO, engineering leads, partner-platform owners.
**Purpose:** One place to see what shipped recently, what is in flight this
sprint, and what is on deck by quarter through the path to 10M MAU.

> **This is a planning view; quarter assignments are author suggestions
> unless a task description fixes a date.** The only date this document
> treats as a commitment is the **GA launch on May 15, 2026** (locked, lifted
> verbatim from `completed_docs/NYV-PROJECT-STATUS-Apr2026.md` §1). Every
> other quarter slot is a suggestion based on the priority labels in
> [`NYV-AGENT-SUGGESTED-FOLLOWUPS.md`](./NYV-AGENT-SUGGESTED-FOLLOWUPS.md)
> and on technical dependencies the author could see in the merge history.
> Reviewers should re-confirm before sprint planning.

> **What this doc is not.** It does not reassign quarters in the project task
> queue, produce point estimates / burn-down charts, or write customer-facing
> release-notes copy. It also does not duplicate
> `NYV-AGENT-SUGGESTED-FOLLOWUPS.md` — for the "why this is on the roadmap"
> rationale of any individual proposed task, follow the link in the table.

---

## 1. Where we are today

Nyayavigya Platform 3.1.2 is the standalone Legal AI SDK gateway behind the
Nyayasiddhi ecosystem (5 partner apps: Nyayamitra, NSP, NSI, NSA, NSM —
all PROVISIONED with separated live + test SDK keys, see `replit.md` §"SDK
Ecosystem Provisioning Status"). The gateway runs on Node 22 / Express 5,
the console on React 19 / Vite 7, with 1,042 ROMA L5 22-section system
prompts across 7 jurisdiction registries and 22 agentic patterns. Production
GA is **locked for May 15, 2026** in `ap-south-1` (Mumbai), targeting an
initial 120M reachable users. The 3 SDK variants (NSP web, NSP mobile,
Nyayamitra mobile) reached GA in Task #31; the AWS dev edge stack (ALB +
WAF + Route53 + RDS + ElastiCache) is live on the `dev-edge` Terraform
workspace per `completed_docs/AWS-DNS-HANDOFF-2026-04-24.md` and
`completed_docs/AWS-MANAGED-DATASTORES-2026-04-24.md`. The platform has 32
MERGED tasks, 0 IN_PROGRESS, 0 PENDING, 34 PROPOSED, and 28 CANCELLED in
the queue today; the recently shipped table below summarises the 32 MERGED
ones in a single view.

---

## 2. Recently shipped (last ~30 days)

32 MERGED tasks grouped by theme. One row per task; "Outcome" is the
one-line summary lifted from the task title or the merge commit. Source for
all entries: project task queue.

### Foundation & deployment

| Task ref | Title | Outcome |
|---|---|---|
| #1 | AWS Deployment + SDK Release + API Documentation Plan | Initial AWS / SDK / docs plan that everything else descends from. |
| #6 | Replit→EC2 CI/CD + 100% production-ready infra | Single-tree repo, Terraform-managed AWS, multi-platform governance, observability + DR docs. |
| #11 | Apply the AWS infrastructure and switch DNS to production | Two-phase Terraform apply executed; DNS pointed at AWS. |
| #16 | Finish DNS cutover and turn on HTTPS for nyayasiddhi.online | TLS 1.3 wildcard ACM cert live; ALB → EC2 :80 path complete. |
| #17 | Move Postgres and Redis off the single EC2 box to managed AWS services | RDS Postgres 16 (multi-AZ, 7-day PITR) + ElastiCache Redis 7.1 with TLS. |

### Security & compliance

| Task ref | Title | Outcome |
|---|---|---|
| #13 | Wire and turn on the cross-tenant safety check in the live gateway | `nv-tenant-isolation` middleware mounted at app + every SDK sub-router; `NYV_TENANT_ENFORCE` flag. |
| #18 | Turn on the AWS firewall in front of the platform | AWS WAF deployed in **count (observation)** mode in front of ALB. |
| #29 | Security & compliance hardening (PII vault → Redis, RLS, field encryption, audit hash chain) | DPDPA-aligned PII vault, native PG row-level security migration, field-level encryption, append-only audit chain. |
| #36 | Add a regression test that proves users never see another user's events | Cross-tenant event leak regression on AG-UI streaming endpoint. |
| #43 | Add a Redis-based distributed lock so audit chain holds across pods | Audit chain hash continuity across multi-pod deployments. |

### AI quality, orchestration & streaming

| Task ref | Title | Outcome |
|---|---|---|
| #27 | Make AI answers real, on-demand, and streamed live | Synthesis fix + memory + cache + AG-UI streaming + format/language + ReAct/ToT/Parlant patterns. |
| #32 | Wire memory, intelligence, nyaya-tools, skills, RAG into a single agentic decomposition + parallel execution path | Capability manifest as single source of truth for orchestration. |
| #33 | Make orchestration smarter at picking the right specialist | Smart routing with live success rate / P95 latency / concurrency / per-jurisdiction outcomes. |
| #34 | Wire real safety checks (hallucination, bias, PII) into every answer | Safety layer in middleware; failures throw in production. |
| #37 | Make the orchestration ID a typed field instead of an untyped property | Typed `orchestrationId` end-to-end through streaming events. |
| #61 | Make the orchestration root span auto-attach without callers carrying it on the request | AsyncLocalStorage span auto-parenting. |
| #64 | Stop relying on a shared global emitter for per-request streaming events | Per-request emitters; no cross-request leak surface. |
| #69 | Show live routing weights in the admin dashboard | Admin HTML view of composite scores / saturation / degradation flags. |

### Caching & performance

| Task ref | Title | Outcome |
|---|---|---|
| #38 | Wire the prompt cache into agent calls so repeat questions are faster and cheaper | LM cache wired into `callAgentInner` with hot/warm/cold tiers. |
| #66 | Let admins clear stale cached answers when laws or templates change | `cache:admin` endpoints + CLI + audit-logged invalidation. |
| #67 | Make the prompt cache survive server restarts | Optional Redis-backed shared cache backend; opt-in via `LMCACHE_SHARED_BACKEND=redis`. |

### Observability

| Task ref | Title | Outcome |
|---|---|---|
| #28 | Operational reliability: silence Redis log spam, wire circuit breakers, add live observability dashboards | Tier-based concurrency limits, circuit breakers, JSONL span logger. |
| #39 | Send platform traces to Sentry instead of JSON log files | Sentry tracer integrated; release tagging in place. |

### SDK & partner integration

| Task ref | Title | Outcome |
|---|---|---|
| #31 | Finalize the 3 SDK variants for GA (NSP web, NSP mobile, Nyayamitra mobile) | npm publish + working examples + API key + webhooks. |
| #44 | Test the new SDKs end-to-end against a live staging gateway | Live staging integration test pass for the GA SDK trio. |
| #45 | Set up automated package publishing to npm for the GA release | Publish pipeline operational. |

### Quality (UAT)

| Task ref | Title | Outcome |
|---|---|---|
| #30 | Comprehensive 200+ scenario UAT across 7 jurisdictions, 6 patterns + bug-fix loop | Full v3.1.2 UAT pass; deferred items captured separately. |

### Documentation

| Task ref | Title | Outcome |
|---|---|---|
| #87 | Consolidate the 40+ existing docs into versioned completed/pending/superseded buckets | `docs/v3.1.2/INDEX.md` + YAML headers + reorganization script. |
| #88 | Compile every agent-proposed follow-up into one consolidated planning doc | [`NYV-AGENT-SUGGESTED-FOLLOWUPS.md`](./NYV-AGENT-SUGGESTED-FOLLOWUPS.md). |
| #89 | Write the business product note for CEO / investors / enterprise pitches | [`NYV-PRODUCT-NOTE-BUSINESS-v3.1.2.md`](../completed_docs/NYV-PRODUCT-NOTE-BUSINESS-v3.1.2.md). |
| #90 | Build the Q2-Q4 2026 roadmap doc consolidating shipped, in-flight, and planned work | This file (`NYV-ROADMAP-Q2-Q4-2026.md`). |
| #91 | Write the technical product note for engineering, SRE, and partner integration teams | [`NYV-PRODUCT-NOTE-TECHNICAL-v3.1.2.md`](../completed_docs/NYV-PRODUCT-NOTE-TECHNICAL-v3.1.2.md). |

---

## 3. In flight (this sprint)

Nothing currently in flight. The project task queue shows **0 IN_PROGRESS
and 0 PENDING** as of this verification. The three documentation tasks the
brief originally listed here (#89, #90, #91) have all merged and now appear
in §2 under "Documentation". The next batch of work to pick up is the Q2
pre-GA blocker list in §4.1.

---

## 4. Q2 2026 (May–Jun) — GA Launch (May 15)

P0/P1 items from `NYV-AGENT-SUGGESTED-FOLLOWUPS.md` that the author judges
must land before or immediately after GA. Ordered by theme. Owners come
from the `completed_docs/NYV-PROJECT-STATUS-Apr2026.md` §1 owner column
where the closest source task had one; otherwise inferred from the section
heading in the follow-ups doc.

### 4.1 Pre-GA blockers (P0)

| Task ref | Title | Owner | Acceptance signal | Dependencies |
|---|---|---|---|---|
| #42 | Provision a non-superuser app role so RLS actually filters in production | Platform-Sec | Prod app connects as `nyv_app` (non-superuser, non-`BYPASSRLS`); RLS test against pooled prod role passes. | #29 (RLS migration already merged) |
| #48 | Fix broken compliance forms that crash with raw database errors | Platform | All four DPDPA endpoints return structured error responses; tenant-ID coercion bug fixed; UAT v3.2 reruns clean. | #30 (UAT findings) |
| #57 | Make the SDK installable so partners can actually use the quickstarts | SDK | `npm install @nyayavigya/sdk` from a clean container resolves and imports. | #31, #45 |
| #59 | Make the web quickstart actually run from the README's instructions | SDK | A new evaluator can copy-paste the README and reach a successful gateway response in <5 min. | #57 |
| #60 | Stop crashing observability dashboards on the orchestration scoreboard | Platform | Scoreboard endpoint renders partial data instead of 500 on missing agent fields. | #69 |

### 4.2 Pre-GA follow-throughs (P1)

| Task ref | Title | Owner | Acceptance signal | Dependencies |
|---|---|---|---|---|
| #19 | Flip the firewall from observation to enforcement after the 7-day review | Platform-Sec | WAF default action = `block` after a tuned 7-day count-mode baseline. | #18 (7-day window) |
| #20 | Send firewall alerts to a real inbox or chat channel | Platform-Sec | SNS → email or Slack target wired to WAF / CloudWatch. | #18 |
| #41 | Drop legacy plaintext columns once encrypted backfill is verified | Platform-Sec | Fleet-wide ciphertext/plaintext parity check at 100%; migration drops the legacy columns. | #29 |
| #49 | Seed a working API key in dev so voice and rate-limit tests can actually run | Platform | Dev container ships with a usable key out of the box; voice + rate-limit tests pass without manual minting. | #30 |
| #51 | Publish the shared types package alongside the GA SDKs | SDK | `@nyv/types` resolves on `npm install` for an external partner; type-checks pass on the published SDK. | #31, #45 |
| #52 | Verify a published SDK actually installs and runs end-to-end after release | SDK | Post-publish CI step pulls the artefact into a clean container, runs the quickstart, asserts a 2xx from the gateway. | #45, #51 |
| #53 | Send backend errors to Sentry, not just frontend crashes | Platform | Gateway error middleware reports uncaught exceptions to Sentry alongside the frontend ones. | #39 |
| #54 | Tag Sentry traces with the tenant/organization so per-customer filtering works | Platform | All spans carry `orgId`/`tenantId` tags; Sentry per-customer filter returns the expected stream. | #39 |
| #62 | Add a regression test that the orchestration ID is stamped on every streaming event | Platform | New positive test asserts every emitted event in a stream carries `orchestrationId`. | #36, #37 |
| #63 | Catch event cross-leaks in other streaming endpoints, not just AG-UI | Platform | SSE (agent thoughts) + WebSocket (voice) get the same regression coverage as AG-UI. | #36 |
| #71 | Show users why an answer was held back or flagged for review | Platform | Safety blocks return an actionable explanation to the SDK / UI; no more stuck spinners. | #34 |
| #73 | End-to-end test: a deliberately-unsafe LLM response is blocked at the HTTP layer | QA | E2E test asserts the gateway HTTP response is 4xx and unsafe content never reaches the wire. | #34 |
| #78 | Make cache clears reach every running server, not just one | Platform | Redis pub/sub fanout invalidates all pods on a single admin clear. | #66 |
| #79 | Turn the shared prompt cache on in staging and production | Platform | `LMCACHE_SHARED_BACKEND=redis` enabled in staging then prod after #81 passes. | #67, #81 |
| #81 | Prove the shared cache works end-to-end against a real Redis | Platform / QA | Testcontainers- or staging-Redis-backed integration test passes for the full cache flow. | #67 |

---

## 5. Q3 2026 (Jul–Sep) — Hardening & Scale to 1M MAU

P1/P2 follow-ups that polish what shipped in Q2, prove behaviour at higher
load, and close residual telemetry / dashboard gaps. None are GA blockers.

| Task ref | Title | Owner | Acceptance signal | Dependencies |
|---|---|---|---|---|
| #35 | Add load tests proving each tier's concurrency limits hold | QA | Load harness shows free tier throttled at the configured cap while enterprise is not, at the documented rps. | #28 |
| #40 | Cut log noise when traffic is high by making span logging optional | Platform | Sampling rate or env flag controls span emission; gateway log volume drops to target at >100 rps. | #28, #39 |
| #50 | Auto-tag and changelog releases so cutting a release is one command | DevOps | A `release-please`-style workflow tags + changelog-bumps + opens the release PR. | #45 |
| #55 | Track how often the audit chain falls back to single-pod mode | Platform | New metric / alert fires when the Redis lock degrades to in-process locking. | #43 |
| #56 | Run the audit chain test against a real Redis to prove pod coordination end-to-end | QA | Real-Redis integration test replaces the mock and passes. | #43, #55 |
| #65 | Show cache savings on the orchestration dashboard | Frontend | Dashboard surfaces hit-rate + token-cost-saved per agent. | #38, #66, #69 |
| #68 | Persist agent performance signals across restarts | Platform | Smart-router signals survive process restart; "first 100 requests after deploy" warm-up gone. | #33 |
| #70 | Tune the smart router with real-traffic A/B comparison | Platform | A/B harness produces a comparable-traffic report between old and new weight schemes. | #33, #69 |
| #72 | Replace the safety verdict with the platform's grounded hallucination detector | Platform | Grounded detector swapped in behind the safety verdict; existing safety contract preserved. | #34 |
| #76 | Show ops a one-click button to clear stale cached answers from the admin console | Frontend | Admin console exposes the existing `cache:admin` endpoint behind a button; CLI no longer required. | #66 |
| #77 | Show admins a list of recent cache clears for compliance review | Frontend | Audit chain entries for cache invalidations are queryable from the admin console. | #66 |
| #80 | Keep popular cached answers alive by refreshing their TTL on each hit | Platform | Sliding-window TTL implemented; cold-spot eviction unchanged. | #67, #79 |
| #85 | Lock in trace-tree integrity with an end-to-end test | QA | E2E test runs a real `QueenOrchestrator.orchestrate()` and asserts every emitted span attaches to the right parent. | #61 |
| #86 | Fix the streaming test mock so lifecycle event coverage is verified again | QA | Streaming test mock matches the real emitter shape; lifecycle assertions are no longer no-ops. | #37, #64 |

### Production readiness items also targeted at Q3

These are not in the project task queue today; they come from the deferred
items in `completed_docs/NYV-PROJECT-STATUS-Apr2026.md` §4. Author
suggestion: bring them into the queue before the quarter starts.

| Task ref | Title | Owner | Acceptance signal | Dependencies |
|---|---|---|---|---|
| (no task ref yet — D1) | Migrate parse → summarize chain to BullMQ Flows for parent/child durability | Platform | Long-document chain failures retry as a flow rather than as independent jobs. | Post-GA per status doc |
| (no task ref yet — D2) | Consolidate 3 rate-limit middlewares into a single Lua script | Platform | Single Redis Lua script replaces the 3 middleware variants; behaviour parity test passes. | Post-GA per status doc |
| (no task ref yet — D3) | Move `POSTGRES_PASSWORD` + JWT secrets to AWS Secrets Manager (dev-EC2) | DevOps | Dev-EC2 reads secrets from SM at boot; no `.env` plaintext for these keys. | None |

---

## 6. Q4 2026 (Oct–Dec) — Path to 10M MAU

The GA stack (single EC2 + ALB + WAF + RDS multi-AZ + ElastiCache replica)
is sized for low-millions traffic. Scaling to 10M MAU requires the EKS
migration, multi-region readiness, and the long-deferred infra items from
the architecture v6 doc. None of these are project tasks today; the author
recommends opening them as planned work once Q3 hardening is in flight.

### 6.1 Production EKS migration

| Task ref | Title | Owner | Acceptance signal | Dependencies |
|---|---|---|---|---|
| (planned, no task ref yet) | Production EKS IaC under `infra/aws/eks/` | DevOps | Terraform / Helm chart that provisions the production EKS cluster end-to-end; replaces the single-EC2 host model. | D5 in `NYV-PROJECT-STATUS-Apr2026.md` §4; plan referenced in the now-archived `docs/NYV-AWS-ONE-CLICK-DEPLOYMENT-v5.md` |
| (planned, no task ref yet) | Cut over partner traffic from the Caddy host-router on EC2 to per-service EKS deployments | DevOps + Platform | All 7 services (`nyv-gateway` ×2, `nyv-console`, `nyv-{nym,nsp,nsi,nsa,nsm}-app`) run on EKS with rolling deploys. | EKS IaC above |
| (planned, no task ref yet) | Per-partner ALB target groups so `iam_partner` `Elbv2RegisterTargetsScoped` is no longer empty | DevOps + Platform-Sec | Each partner gets its own TG; Register/Deregister scoped per partner without privilege escalation. | EKS migration; see `pending_implementation_docs/NYV-IAM-GAPS.md` "EC2 host instance role" |

### 6.2 Multi-region readiness

| Task ref | Title | Owner | Acceptance signal | Dependencies |
|---|---|---|---|---|
| (planned, no task ref yet) | Provision the secondary region (`ap-south-2`) Terraform stack | DevOps | `terraform apply` produces a parity stack in `ap-south-2`; tested in DR drill. | EKS migration |
| (planned, no task ref yet) | Cross-region read replica for RDS Postgres + ElastiCache global datastore | Platform + DevOps | Replica lag <60s; documented failover runbook updated. | Secondary region stack |
| (planned, no task ref yet) | Region-loss DR drill (currently called out as untested) | DevOps + SRE | Drill executed and recorded in `completed_docs/NYV-DR-DRILL-RESULTS.md`; "Region loss → manual / untested" gap removed from `NYV-ARCHITECTURE-v6.md` §11. | Secondary region stack |

### 6.3 Production-scale follow-throughs

| Task ref | Title | Owner | Acceptance signal | Dependencies |
|---|---|---|---|---|
| (planned, no task ref yet) | Tighten `iam_partner` GitHub OIDC trust to `ref:refs/heads/main` for prod | Platform-Sec | OIDC trust StringLike no longer matches `:*`; only the main branch can assume the prod deploy role. | None — see `NYV-IAM-GAPS.md` "Per-partner deploy role" |
| (planned, no task ref yet) | Frontend `client/src/pages/*` `@/lib/*` resolve warnings cleanup | Frontend | Pre-existing alias resolve warnings cleared from the Vite build (D4 in status doc). | None |
| (planned, no task ref yet) | NAT-per-AZ flip once cross-AZ NAT bandwidth becomes noticeable | DevOps | `nat_strategy = "per_az"` set in Terraform; per-AZ NAT live in prod. | EKS migration (typically when cross-AZ traffic ramps) |

---

## 7. Risks & open questions

Each entry shows the source doc the risk was lifted from. None are new
findings; this is a consolidation.

- **Firewall is observe-only today.** The AWS WAF in front of the platform
  defaults to `count`, not `block`, until #19 lands.
  Source: `replit.md` §"Cross-tenant safety check turned on" (WAF posture
  context); `NYV-ARCHITECTURE-v6.md` §6.
- **RLS is enabled but not enforcing in production.** Migration 0004 sets
  `FORCE ROW LEVEL SECURITY`, but the pooled prod role is `SUPERUSER` and
  PostgreSQL exempts that from RLS. #42 is the fix.
  Source: `NYV-AGENT-SUGGESTED-FOLLOWUPS.md` §1.
- **Region loss recovery is documented as untested.** `ap-south-2` failover
  is described in the architecture doc but has never been drilled.
  Source: `NYV-ARCHITECTURE-v6.md` §11 "Region loss" row.
- **Production EKS IaC does not exist.** Status doc lists the EKS plan as
  "Plan ready, IaC TBD"; the originally-cited plan doc has since been
  archived under `archive/2026-04-cleanup/` per `replit.md`.
  Source: `NYV-PROJECT-STATUS-Apr2026.md` §1 + §4 (D5).
- **GitHub OIDC trust for partner deploy roles is too broad.**
  `iam_partner` accepts any branch (`repo:<org>/<repo>:*`) on the OIDC
  trust StringLike. Recommended tightening to `ref:refs/heads/main` for
  prod.
  Source: `pending_implementation_docs/NYV-IAM-GAPS.md` §"Per-partner deploy role".
- **`Elbv2RegisterTargetsScoped` is empty by default in `envs/prod`.**
  This is intentional under the shared-Caddy edge model — granting any
  partner Register/Deregister on the shared TG would let any partner
  deregister the edge container and take down every other partner. Removed
  by the per-partner ALB TG work in §6.1.
  Source: `NYV-IAM-GAPS.md` §"EC2 host instance role".
- **Shared prompt cache is off everywhere.** `LMCACHE_SHARED_BACKEND=redis`
  was shipped behind a flag in #67 but has not been turned on in staging
  or production yet.
  Source: `NYV-AGENT-SUGGESTED-FOLLOWUPS.md` §4 (#79); `replit.md`
  §"Prompt Cache Survives Restarts + Pods".
- **The audit-chain Redis lock is mocked in tests.** #43 ships the lock,
  but pod-coordination behaviour is asserted only against a stub backend.
  #56 closes this in Q3.
  Source: `NYV-AGENT-SUGGESTED-FOLLOWUPS.md` §7.
- **DPDPA compliance forms still leak DB errors.** UAT v3.2 found four
  endpoints crashing with raw PostgreSQL parser errors plus one coercing
  a missing tenant ID to the string `"NaN"`. #48 is the fix and is treated
  as a P0 GA blocker.
  Source: `NYV-AGENT-SUGGESTED-FOLLOWUPS.md` §6;
  `pending_implementation_docs/uat/NYV-UAT-v3.2-COMPREHENSIVE.md`.
- **Public SDK quickstart does not actually run.** New evaluators following
  the README hit a crash on the first request (#59) and `npm install`
  itself fails (#57). Both are P0 GA blockers since the SDK GA in #31 is
  meaningless without them.
  Source: `NYV-AGENT-SUGGESTED-FOLLOWUPS.md` §3.

---

## Appendix A. Cancelled tasks

For completeness, every task in the queue currently in `CANCELLED` state.
Cancellation reasons (when discoverable) live in
[`NYV-AGENT-SUGGESTED-FOLLOWUPS.md`](./NYV-AGENT-SUGGESTED-FOLLOWUPS.md)
§"Archived (cancelled) follow-ups"; not duplicated here.

| Task ref | Title |
|---|---|
| #2 | Add a paid LLM key (OpenAI/Anthropic) so Mitra agents stay reliable under load |
| #3 | Show the 3 Nyayamitra agents in the public agents list |
| #4 | Fix the noisy DB write warnings during orchestration (missing tables) |
| #5 | Replit foundation fixes + live AI UAT execution + bug-fix loop |
| #7 | Comprehensive AI Testing UAT document (200+ cases) covering all 14+ AI components |
| #8 | Move Redis credentials out of secret-typo zone with a managed Replit Redis |
| #9 | Mark unconfigured LLM providers as `no-key` instead of `degraded` |
| #10 | Tighten Vite client tsconfig and consolidate path-alias config |
| #12 | Turn on the security firewall enforcement after one week of monitoring |
| #14 | Confirm cross-tenant safety check is blocking after staging redeploy |
| #15 | Make sure cross-tenant 403s show up in dashboards and alerts |
| #21 | Pre-create the RDS DR snapshot before the maintenance window |
| #22 | Promote managed datastores into the prod env too |
| #23 | Send Postgres + Redis health alerts to the team |
| #24 | Stop traffic surges from overloading the platform |
| #25 | Get alerted before users notice an outage |
| #26 | Document and automate cert + DNS rotation so nothing silently expires |
| #46 | Build official sample apps in the App Store and Play Store |
| #47 | Restore the missing tables that break HITL queues, memory recall, and audit logs |
| #58 | Stop shipping a broken voice flow — wire the SDK to the real gateway route |
| #74 | Auto-refresh the routing weights dashboard so live changes show without a page reload |
| #75 | Show recent routing decisions next to the live weights so ops can confirm the math matches reality |
| #82 | Fix telemetry crash when reporting orchestration token totals |
| #83 | Add a stress test proving concurrent orchestrations cannot leak events |
| #84 | Stop other event consumers from depending on the singleton orchestrator |
| #92 | Live database column inventory for the technical product note |
| #93 | Wire Tree-of-Thought into SWARM |
| #94 | Prod-DR Terraform environment |

---

## Appendix B. Source docs

- [`completed_docs/NYV-PROJECT-STATUS-Apr2026.md`](../completed_docs/NYV-PROJECT-STATUS-Apr2026.md)
  — platform state, GA date, deferred items D1–D5.
- [`completed_docs/NYV-ARCHITECTURE-v6.md`](../completed_docs/NYV-ARCHITECTURE-v6.md)
  — current architecture, region-loss DR gap, EKS reference.
- [`completed_docs/AWS-MANAGED-DATASTORES-2026-04-24.md`](../completed_docs/AWS-MANAGED-DATASTORES-2026-04-24.md)
  — RDS + ElastiCache rollout (#17).
- [`completed_docs/AWS-DNS-HANDOFF-2026-04-24.md`](../completed_docs/AWS-DNS-HANDOFF-2026-04-24.md)
  — DNS, ALB, WAF, single-AZ EC2 posture.
- [`pending_implementation_docs/NYV-AGENT-SUGGESTED-FOLLOWUPS.md`](./NYV-AGENT-SUGGESTED-FOLLOWUPS.md)
  — full backlog with priority labels and per-task rationale.
- [`pending_implementation_docs/NYV-IAM-GAPS.md`](./NYV-IAM-GAPS.md)
  — module-level IAM gap review, source for §7 IAM risks.
- `replit.md` — operational notes, latest module-level changes, ecosystem
  partner provisioning state.
