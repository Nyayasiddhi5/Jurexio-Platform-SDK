# Roadmap Document (Q2 2026 → 10M MAU)

> **Active items index** (added 2026-04-29 — newest first):
>
> | Ref | Title | Status | Owner | Tracked at |
> |---|---|---|---|---|
> | **R-GBEST-LEGAL** | Global-best Legal AI OS engineering (W0–W4 + residuals) | **DONE 2026-07-31** | Platform | `documents/working/NYV-GLOBAL-BEST-LEGAL-AI-OS-GAPS-PLAN-2026-07.md`; deploy `2026-07-31T0424Z` |
> | **R-MULTI-DOMAIN** | Multi-domain substrate (non-legal verticals) | **DONE 2026-07-31** (legal GA; others scaffold) | Platform | `/api/nv/domains`; GAPS plan § Multi-domain |
> | **R-NEURAL-NDCG** | Neural rerank continuous quality gate | **DONE 2026-07-31** (local CE in CI; live Cohere/Voyage optional) | Platform | CI `rag-ndcg`; `nv-local-cross-encoder-server.ts` |
> | **R-SCHEMA-B** | Bulk missing `nv_schema.*` on prod RDS | **DONE 2026-04-29** (~94 tables) | Platform | Tracker 2026-04-29 R-SCHEMA-B-DEPLOY |
> | **R-SCHEMA-B-RESIDUAL** | 4 undeclared tables (bipa/biometric/twins/rag_coverage_audit) | **CODE DONE** — RDS apply **OPS** (needs master/`GRANT CREATE ON SCHEMA nv_schema`) | Platform | `migrations/2026-07-31-r-schema-b-residual.sql` |
> | R-SCHEMA-A | Drizzle parity for 26 untracked `nv_schema` tables | DONE 2026-04-29 | Platform | `shared/nv-schema-tables.ts`; `Project-Tracker.md` 2026-04-29 |
>
> ---
>
> ### PARKED (not engineering-closable without external parties)
>
> | Item | Why parked |
> |---|---|
> | SOC2 Type II certified | Auditor engagement |
> | DocuSign / iManage OAuth | Partner credentials |
> | GRPO weight trainer | GPU training consumer |
> | Caselaw embed 100% | Continuous OPS backfill |
> | Multimodal avatar GA | Product flags + providers |

## R-SCHEMA-B — Provision missing `nv_schema.*` and `ns_*` tables on prod RDS

> **Status update 2026-07-31:** Bulk provision **DONE 2026-04-29** (prod
> `nv_schema` 28→94+). The narrative below is historical. Remaining
> engineering residual: **4 tables** in
> `migrations/2026-07-31-r-schema-b-residual.sql` + Drizzle in
> `shared/nv-governance-schema.ts`. Live RDS CREATE is **OPS-blocked** —
> gateway role `nv_app` has `has_schema_privilege(..., CREATE)=false`
> (SSM probe 2026-07-31). Apply as schema owner / rotate master secret,
> then `GRANT CREATE ON SCHEMA nv_schema TO nv_app` if app-owned DDL is desired.

**Why this was the next-priority schema item (historical).** Source code
referenced 80+ unique `nv_schema.*` tables; only 28 existed on prod before
the 2026-04-29 deploy. The ~50 missing included RAG corpus tables,
safety / quality observability, HITL, GRPO, legal graph, agent governance,
billing, and domain-specific tables. Silent `.catch(() => {})` drops were
the original pain.

**Done looks like.**

1. Each missing table has a Drizzle declaration in
   `shared/nv-schema-tables.ts` with column shapes reverse-engineered
   from its source-code call sites (ripgrep
   `nv_schema.<table>` for inserts/selects, infer columns from object
   keys passed to `.values({...})` and from select projections).
2. `npm run db:push --force` applied to prod RDS in a single
   maintenance window; a fresh `drizzle-kit introspect` run shows zero
   drift after.
3. The orchestrate route's outer `catch` (NV-NSP-FIX-001) stops logging
   `42P01` for the silently-dropped writes; CloudWatch shows zero
   missing-relation events for 24 h.
4. `documents/working/PLATFORM-STATUS.md` snapshot updated; new row in
   `Project-Tracker.md` and entry under `[Unreleased]` in
   `CHANGELOG.md`.

**Out of scope.**

- Backfilling historical rows (the missing windows are accepted as
  permanent gaps; we will not invent metrics from logs).
- Schema design changes for the existing 28 tables (Drift-A is closed
  byte-for-byte against prod).
- Restructuring the orchestrate route's silent `.catch` to fail loud
  (separate hardening task — until R-SCHEMA-B lands, fail-loud would
  break orchestrate calls).

**Steps.**

1. Build the column-by-column reverse-engineering map. For each
   missing table, ripgrep its insert / update / select call sites in
   `src/`, capture the property names + typeof inferred from
   surrounding code, and produce a column spec (name, PG type,
   nullability, default if obvious).
2. Add Drizzle declarations to `shared/nv-schema-tables.ts` (continue
   the file's structure; preserve PK-type rule — varchar(36) for new
   tables since prod has no rows yet to constrain us, except where the
   call site uses an integer id explicitly).
3. Decide PK strategy per table: serial when call sites read the id
   back as a number after insert; varchar(36) `gen_random_uuid()::text`
   when ids are passed in by app code; text when the natural key is
   external (e.g. session id).
4. Apply via `npm run db:push --force` in a maintenance window scoped
   to a low-traffic hour (RDS is single-AZ — there is no warm read
   replica to fail over to during DDL).
5. Verify via the introspect script committed at
   `scripts/introspect.cjs` that the table list now matches the
   source-code reference set.
6. Sweep CloudWatch for residual `42P01` lines for 24 h; close the
   item if zero.

**Risks.**

- Reverse-engineered column shapes will inevitably under-specify (no
  call site exercises every column). Mitigation: flag every
  reverse-engineered column with a `// inferred 2026-04-29` comment so
  the next maintainer knows what is high-confidence vs. inferred.
- A full `db:push --force` against prod can touch unrelated drift
  across the 6 schema files (schema + nv-schema-tables + nyayamitra +
  3 nyayasiddhi). Mitigation: run `drizzle-kit generate` first,
  inspect the SQL diff, and apply only the targeted CREATE TABLE /
  CREATE INDEX subset via a hand-pruned SQL file if needed.

---

## What & Why

The project has 24 MERGED tasks, 2 IN_PROGRESS, 1 IMPLEMENTED, and 37 PROPOSED tasks plus several
"future production-scale" items mentioned in `NYV-PROJECT-STATUS-Apr2026.md` and replit.md. There
is no single roadmap doc that says "here is what shipped, what is in flight, and what is on deck
by quarter, plus the path to 10M MAU." Product head and CEO need this to communicate timelines and
to prioritise pending work.

Produce one roadmap document at `docs/v3.1.2/pending_implementation_docs/NYV-ROADMAP-Q2-Q4-2026.md`
that consolidates all current and pending work into a milestone view.

## Done looks like

- One markdown doc with these sections:
  1. **Where we are today** — one paragraph summarising platform state (v3.1.2, GA target May 15
     2026, 5 ecosystem SDK apps live, etc.) sourced from `NYV-PROJECT-STATUS-Apr2026.md` and
     `replit.md`.
  2. **Recently shipped (last 30 days)** — table of MERGED tasks grouped by theme, one row each
     with task ref, title, and one-line outcome.
  3. **In flight (this sprint)** — IN_PROGRESS and IMPLEMENTED tasks (#30, #61, #64) with status
     and expected merge window.
  4. **Q2 2026 (May–Jun) — GA Launch** — milestone block listing PROPOSED tasks that must land
     before GA. Use the suggested-tasks doc's P0/P1 labels as a guide; explicitly call out
     dependencies.
  5. **Q3 2026 (Jul–Sep) — Hardening & Scale to 1M MAU** — milestone block for P1/P2 follow-ups
     (load tests #35, RLS app role #42, telemetry hardening, audit-chain at-scale verification
     #56, etc.).
  6. **Q4 2026 (Oct–Dec) — Path to 10M MAU** — milestone block for the items in the existing
     v6 architecture doc, AWS managed datastores rollout, EKS migration plan referenced in
     `NYV-AWS-ONE-CLICK-DEPLOYMENT-v5.md`, and any production-scale items from replit.md.
  7. **Risks & open questions** — short bulleted list (e.g. EKS migration not yet IaC'd, firewall
     still in observation mode pending #19, etc.) with the source doc reference for each.
- Every milestone block is a table with columns: Task ref, Title, Owner (Platform/Sec/SDK/DevOps/
  Frontend — pull from existing docs where stated), Acceptance signal, Dependencies.
- The doc explicitly states "this is a planning view; quarter assignments are author suggestions
  unless a task description fixes a date" so reviewers understand which dates are commitments.
- Doc lands in `docs/v3.1.2/pending_implementation_docs/` with the standard YAML header.
- `docs/v3.1.2/INDEX.md` is updated to include it.

## Out of scope

- Reassigning quarters in the project task queue (this doc is descriptive, not authoritative).
- Producing detailed estimates / story points / burn-down charts.
- Customer-facing release-notes copy (separate effort if needed).
- Rewriting the suggested-follow-ups doc (separate task — this one references it).

## Steps

1. **Pull all task data** — list MERGED, IN_PROGRESS, IMPLEMENTED, PROPOSED, and CANCELLED tasks
   with descriptions. Cancelled go in an appendix table.
2. **Theme & quarter assignment** — assign each non-cancelled task to one of the four sections
   (shipped / in flight / Q2 / Q3 / Q4). Use the priority labels from the suggested-tasks doc and
   the technical dependencies (e.g. firewall enforcement #19 depends on 7-day observation finishing,
   so Q2; EKS work depends on managed datastores being in prod, so Q3+).
3. **Mine source docs for production-scale items** — read `NYV-PROJECT-STATUS-Apr2026.md`,
   `NYV-ARCHITECTURE-v6.md`, `AWS-MANAGED-DATASTORES-2026-04-24.md`, `replit.md` for items not
   yet captured as project tasks (EKS migration, multi-region, etc.) and add them to the Q4
   block as "planned, no task ref yet" rows.
4. **Risks section** — pull from each merged task's "Follow-ups proposed" lines that are explicitly
   blockers, plus any IAM gaps from `NYV-IAM-GAPS.md`.
5. **YAML header + INDEX update** — standard header and INDEX entry.

## Architectural constraints

- Quarter assignments are *author suggestions*. The doc must say so up front so the CEO / product
  head do not treat them as commitments without re-confirming.
- Pull dates from existing docs (e.g. GA = May 15 2026 from `NYV-PROJECT-STATUS-Apr2026.md`); do
  not invent new dates.
- Cross-reference, do not duplicate, the suggested-tasks doc for "why this is on the roadmap".

## Relevant files

- `nyayavigya-platform-312/docs/v3.1.2/INDEX.md` (created by reorganization task)
- `nyayavigya-platform-312/docs/v3.1.2/pending_implementation_docs/NYV-AGENT-SUGGESTED-FOLLOWUPS.md`
  (created by suggested-tasks doc task)
- `nyayavigya-platform-312/docs/v3.1.2/completed_docs/NYV-PROJECT-STATUS-Apr2026.md` (post-reorg)
- `nyayavigya-platform-312/docs/v3.1.2/completed_docs/NYV-ARCHITECTURE-v6.md` (post-reorg)
- `nyayavigya-platform-312/docs/v3.1.2/completed_docs/AWS-MANAGED-DATASTORES-2026-04-24.md`
- `nyayavigya-platform-312/replit.md`
