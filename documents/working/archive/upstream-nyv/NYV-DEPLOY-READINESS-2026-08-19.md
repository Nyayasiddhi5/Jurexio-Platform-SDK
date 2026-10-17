# NYV Deploy Readiness — 2026-08-19

> ## UPDATE 2026-08-19T19:45Z — **verdict flipped to GO on the guardrail chain**
>
> Both conditions in §7 are now cleared and `npm run guardrail` **exits 0 with all 17 gates running
> to completion**, reaching the final gate `guardrail:never-break`. Reproduced across two consecutive
> full runs. See **§8** for the per-table classification and the controls; §§1–7 below are retained
> as the record of the state *before* this update and are no longer current where they say otherwise.
>
> - **§2 blocker (`tracker-fresh`)** — cleared. The one authorised doc was committed **alone** as
>   `a4fe761` (`1 file changed, 61 insertions(+)`); gate exits 0.
> - **§5.2 blocker (`schema-drift` 18/35)** — cleared. **9 of the 18 were a real gate false
>   positive**, fixed in the gate; the other 9 were genuine and fixed additively in TS. The true
>   warning count is **96**, not 35 and not 15. **No `--warn-only`, no new allow-list entry, no new
>   deferral, and no architect decision outstanding.**
> - **Non-blockers re-confirmed, unfixed:** console 8 failures (subjects untouched, one provably
>   stale), server types 25/19, client types 134. **No baseline file was refreshed.**

**Original verdict (superseded): NOT-GO** for a single coordinated deploy.
Two specific, unrelated conditions remain (§7). Nothing here is rounded up to green.

- **Tree:** `nyayavigya-platform-312`, branch `main`, HEAD `661ddee`
- **Scope:** cleared the two known non-code blockers; audited the full guardrail chain
- **Did not:** deploy, commit, push, or run any stash/reset/checkout/clean
- **Owner ledger:** `Project-Tracker.md` `2026-08-19T19:27:25Z`; `CHANGELOG.md` `[Unreleased]` → Tooling → `NV-DEPLOY-READINESS-AUDIT-001`

Every figure below is from a command run against this tree. Inferences are labelled as such.

---

## 1. How far the chain gets

`npm run guardrail` is `&&`-joined across 17 invocations (16 distinct gates). Measured end to end:

> **It aborts at step 8, `guardrail:schema-drift`.**

The brief expected the chain to reach step 11 (`tracker-fresh`). It does not, and `32759c4`'s
claim that the "chain now advances from step 1 to step 9" is **not reproducible** at this HEAD.

| # | Gate | Result |
|---|---|---|
| 1 | `guardrail:server-types` | PASS — 25 errors / 19 signatures |
| 2 | `guardrail:client-types` | PASS — 134 signatures |
| 3 | `detect-hardcoded` | PASS |
| 4 | `guardrail:auth-header` | PASS |
| 5 | `guardrail:script-db` | PASS |
| 6 | `guardrail:api-contract` | PASS |
| 7 | `guardrail:flat-registry` | PASS |
| **8** | **`guardrail:schema-drift`** | **FAIL — 18 violations / 35 warnings → chain stops** |
| 9 | `guardrail:no-placeholder` | PASS (run individually) — debt 75 unchanged |
| 10 | `guardrail:unreachable-threshold:enforce` | PASS (run individually) |
| **11** | **`guardrail:tracker-fresh`** | **FAIL (run individually) — see §2** |
| 12 | `guardrail:console-live-data` | PASS (run individually) |
| 13 | `guardrail:message-catalog` | PASS (run individually) — legacy backlog 1,199 |
| 14 | `guardrail:intent-mesh` | PASS (run individually) — 46 leaves, 160 bindings |
| 15 | `guardrail:cascade-ids` | PASS (run individually) — 42 ids, 2,593 ladders |
| 16 | `guardrail:orch-stage` | PASS (run individually) — 6/6 |
| 17 | `guardrail:never-break` | PASS (run individually) |

**Per-gate exit codes: 15 of 16 exit `0`; only `tracker-fresh` exits `1`.**

> **Instrument correction.** A first pass piped each gate through `| tail -18`, which reports the
> *pipe's* exit status, not the gate's — every gate falsely read `exit=0`, including the one that
> fails. Re-run without the pipe. This is the same class of error the brief warns about: the
> instrument was wrong, not the platform.

---

## 2. Blocker 1 — `guardrail:tracker-fresh`: **content resolved and proven; needs one commit**

### Root cause (established, not assumed)

The gate wanted the canonical tracker to cover four already-committed commits:

| Commit | Subject |
|---|---|
| `d4253f9` | `fix(citator): never present an unresolved authority as identified` |
| `7759ac3` | `fix(citator): resolve authority identity from its own lookup, not the treatment set` |
| `7c5b1ff` | `fix(citator): query the corpus with distinctive tokens so identity can resolve` |
| `32759c4` | `fix(quality): unblock the guardrail chain, clear the 3 failing tests, ratchet tsc` |

Those sessions **did** document themselves — in `Project-Tracker.md` and `CHANGELOG.md` via
`eddb968` and `10009f8` — but **neither commit touched
`docs/canonical/10-tracker-changelog-2026-05-07.md`**:

```
git show --name-only 10009f8 | grep -c 'canonical/10-tracker'  → 0
git show --name-only 7a9f4c0 | grep -c 'canonical/10-tracker'  → 1   ← positive control
```

So the gate is **not buggy** and the commits do **not** belong to a prior session's block. This is
exactly the rot `NV-TRACKER-FRESH-001` exists to catch, and it caught it. The honest fix is to add
the blocks.

### What was written

`Session-53` (citator, 3 commits) and `Session-54` (guardrail unblock) appended to the canonical
tracker, following the established `Goal / Outcome / … / Files / Followups / Commit` format.

Sourced **exclusively** from the four committed commit messages and the committed ledger rows — no
invented rationale. Two ambiguities are recorded **in** the blocks rather than resolved silently:

1. **Out-of-order numbering, disclosed.** Both are chronologically *earlier* than the existing
   `Session-52` (tracker rows `04:15Z` and `12:20Z` vs `17:20Z`) but are numbered *after* it, because
   Session-52 is a **concurrent uncommitted** entry by the Athena agent and renumbering another
   agent's live block was the more dangerous edit. A numbering note appears in both blocks.
2. **A genuine source conflict, not smoothed over.** `7759ac3`'s message says Vodafone International
   Holdings "stays unresolved … the honest answer"; the later `Project-Tracker.md` row (post
   `7c5b1ff`, evidence SSM `nsp-citator-final-2`) says it resolves to **SC 2012** and the earlier
   probe was wrong. Per the repo's conflict rule the later entry with the evidence pointer wins; the
   commit message is flagged stale on that one point.

### Why it is still red, and proof that the fix works

The gate compares `git log -1` on the tracker against `git log -1` on
`src`/`client/src`/`drizzle`/`examples`/`scripts`/`packages` — **committed history on both sides**.
A working-tree edit cannot move it. Verified in a **throwaway `/tmp` clone** (no stash/reset — banned
in this tree after today's incident swept three agents' work):

| Step | Result |
|---|---|
| Negative control — clone at HEAD, no block | **exit 1**, "tracker is STALE" |
| Copy the edited doc in, commit **only** that file | **exit 0**, "tracker is fresh" |

Clone deleted; live tree never touched. **Blocker 1 is genuinely resolved in content and needs one
commit of one documentation file** — out of scope for this task, and the single cheapest item on the
NOT-GO list.

---

## 3. Blocker 2 — `@testing-library/dom`: **safe, installed, surgical**

**Genuinely absent** from `node_modules` *and* the lockfile, while `@testing-library/react@16.3.2`
declares peer `@testing-library/dom: ^10.0.0`. Confirmed by execution before changing anything:
**all 7** `tests/console/*.test.tsx` failed to *collect* — `Cannot find module
'@testing-library/dom'`, exit 1. Not a new-suite problem.

**Sequencing (per instruction).** Blocker 1 and the audit were done first. The install ran only after
confirming code files had gone quiet — in the preceding 4 minutes only docs were written, and
`nv-legal-chat-routes.ts` had been idle 26 minutes.

**`npm install --save-dev @testing-library/dom@^10.4.1`** — the newest release satisfying `^10.0.0`:

| Check | Result |
|---|---|
| Packages added / removed | **8 / 0** |
| Pre-existing versions re-versioned | **none** (lockfile shows 0 removed `node_modules/` entries) |
| `dependencies` | 131 → **131** |
| `devDependencies` | 21 → **22** (only `@testing-library/dom`) |
| `scripts` | 130 → **130** |
| Concurrent agent's 6 new script entries | **all present** (verified individually) |
| `tests/unit` re-run after install | **identical** — no regression |

Added transitively: `@types/aria-query`, `dom-accessibility-api`, `lz-string`, `pretty-format` (+3
nested). No broad `npm update` was run.

### Console suites now

**7 of 7 collect** (was 0 of 7). **4 files pass, 3 fail — 31 passed / 8 failed of 39.**

| Suite | Result |
|---|---|
| `roma-l5-admin` · `ocr-extraction` · `digital-twin-creator` · `model-drift-monitor` | PASS |
| `console-dashboard-roles` | 1 of 7 failed |
| `agent-registry-tier-cards` | 3 of 3 failed |
| `platform-v5` | 4 of 25 failed |

**All 8 failures attributed as pre-existing staleness** — not the install, not concurrent-agent churn.
Evidence, by file-level diff:

- Every subject under test — `client/src/pages/AgentRegistry.tsx`, `client/src/App.tsx`,
  `client/src/pages/platform-v5/*`, `client/src/pages/console-dashboard.tsx` — is **unmodified in the
  working tree** (`git status --porcelain` empty for all).
- Each was last committed **2026-07-23 → 2026-08-17**, all before today's sprint.
- The three failing test files have not been touched since the **initial snapshot** (`0a2d437`).
- One is provably stale, not merely suspect: the drift guard parses `roleHomeMap` out of `App.tsx`,
  and that identifier **no longer exists there** — `grep -c roleHomeMap` → **0**, against a positive
  control of **1** for `export default`. `data-testid="tier-count-*"` *does* exist in
  `AgentRegistry.tsx:543`, so those three are an assertion/render-shape drift, not a missing element.

**Left failing and undeleted**, per scope. Deleting a red test to improve a count is how a guard
becomes decorative — a failure mode this repo has already paid for today.

---

## 4. `tests/unit` — fully green

```
Test Files  98 passed | 1 skipped (99)
     Tests  1429 passed | 3 skipped (1432)      exit 0
```

**0 failures.** Re-run after the peer install with identical numbers.

**Blocker 3 attribution.** The brief expected **1 failing test** and **1 new server type error** from
in-flight `ragStep0` work in `src/routes/nv-legal-chat-routes.ts`. Both were **already resolved by
their owning agent** before measurement: `guardrail:server-types` passes at baseline, and the suite
is green. That file was **not touched** by this task. The 3 skips are pre-existing (2 in
`security/rls.test.ts`, 1 in `security/nv-firm-clause-tenant-isolation.test.ts`).

---

## 5. Baselines and schema drift

### 5.1 No baseline was refreshed — nothing is hidden

| File | Working tree | Staged | Value |
|---|---|---|---|
| `.tsc-server-baseline.txt` | **clean** | nothing | 19 signatures |
| `.tsc-server-ceiling.txt` | **clean** | nothing | 25 errors |
| `client/.tsc-baseline.txt` | **clean** | nothing | 139 lines (last changed `0a2d437`, 2026-07-23) |

- `guardrail:server-types` → `no NEW server type errors (backlog: 25 errors / 19 signatures)` — **matches the brief exactly.**
- `guardrail:client-types` → `no NEW client type errors (baseline backlog: 134 signatures)` — **matches the brief's 134.**

> **Clarification so this is never mistaken for tampering.** The client baseline *file* holds **139**
> lines while the gate prints **134**. These are different quantities: the gate prints the count
> *currently measured*, and the file is an unchanged superset (untouched since the initial commit, so
> 5 signatures have since been fixed). The `139` is not a widened baseline.

Both gates were invoked **exactly as the chain does** (`npm run guardrail:server-types`, which is
`bash scripts/nv-server-type-check.sh` → `npx tsc --noEmit`, default config). No `-p tsconfig.server.json`.

### 5.2 `guardrail:schema-drift` — **18 violations / 35 warnings** (this is what stops the chain)

**The fresh-DB fix holds.** `[drift] ✓ all migrations applied cleanly`, and:

```
grep -c 'MIGRATION FAILS ON FRESH DB'  → 0      ← the target
grep -c 'EXTRA DB TABLE'               → 10     ← positive control (proves the grep works)
```

**Zero `MIGRATION FAILS ON FRESH DB` violations remain** — today's two migration repairs
(`memory-recall-index`, `db-index-optimize`) did their job. Ironically, the migrations now applying
in full is what makes the older violations *visible*.

**Attribution: 100% committed state, no agent's uncommitted work.** The gate's inputs —
`shared/**`, `migrations/**`, `drizzle/**`, `drizzle.config.ts` — are **byte-identical to HEAD**
(`git status --porcelain` empty; positive control: `src/` is dirty). The gate stands up a
**throwaway embedded Postgres**, so it has no external DB state to vary on, and it reproduced
**18/35 twice** across consecutive runs.

| Category | Count | Attribution |
|---|---|---|
| `TYPE MISMATCH` — `nv_schema.nv_matter_vaults` (6 cols, PgText vs varchar) | 6 | pre-existing; migration dates to `0a2d437` (2026-07-14 file) |
| `NOT NULL MISMATCH` — same table (`created_at`, `updated_at`) | 2 | pre-existing, same origin |
| `EXTRA DB TABLE` | 10 | 9 pre-existing (July migrations `2026-07-05-nv-drift-b-telemetry.sql`, `2026-07-31-r-schema-b-residual.sql`, `2026-07-02-nv-digital-twins-persistence.sql`); **1 from `32759c4`** — see below |

**The one non-July item, and why it is likely a gate false positive (hypothesis, clearly labelled).**
`EXTRA DB TABLE: nv_schema.memory_entries` comes from `2026-08-17-memory-recall-index.sql`, the
migration `32759c4` repaired today. But `nvMemoryEntries` **is** declared — in
`shared/nv-governance-schema.ts`, which is the very file the same gate defers as `R-SCHEMA-B`
(`[drift] deferring R-SCHEMA-B files: shared/nv-governance-schema.ts`). Deferring the file removes
its table declarations from the comparison set while the migration still creates the table, so a
correctly-declared table reads as undeclared. **Hypothesis** — inferred from the gate's own log plus
the declaration site; not confirmed by patching the gate.

**Warnings: 35, not the 15 the brief expected** — 30 `R-SCHEMA-B` `nv_schema.*` deferrals + 5
encrypted-column deferrals. All warnings; none block.

---

## 6. Deploy-safety features — **all intact**

| Item | Result |
|---|---|
| `scripts/nv-verify-ingress.sh` exists | **yes** (executable, 15,044 B) |
| `--self-test` | **ALL PASS**, true exit `0` — 3/3 scenarios incl. the gateway-200/ingress-502 signature of today's outage and `ingress=000` |
| `name: nyayavigya-platform-312_nyv-net` | **present**, `docker-compose.aws-dev.yml:177` |
| Four pinned volumes | **present** — `_pgdata` (186), `_redisdata` (188), `_gateway-uploads` (190), `_gateway-logs` (192) |
| `stop_grace_period: 30s` | **present**, line 83 |
| `NYV_AUTO_RAG_EXTRAS_DEADLINE_MS=8000` | **present**, line 46 |

`scripts/deploy-aws-ssm.sh` and `scripts/nv-verify-ingress.sh` were **read-only** here (owned by
another agent).

### Tree sanity — no accidental loss

| Check | Result |
|---|---|
| `git stash list` | **empty (0 entries)** |
| Stray worktrees | none (only `main`) |
| Baseline files | all clean (§5.1) |
| Other agents' signature edits | intact — 47 modified + 50 untracked paths present; the concurrent `package.json` script additions and the uncommitted `Session-52` tracker block all survived this task's edits |
| Files changed by this task | `docs/canonical/10-tracker-changelog-2026-05-07.md`, `package.json`, `package-lock.json`, `Project-Tracker.md`, `CHANGELOG.md` — and nothing else |

---

## 7. Verdict — **NOT-GO**, with two specific conditions

The chain **cannot pass** in its current state. Not because of the quality sprint — every gate
touching the sprint's work is green, and `tests/unit` is 1,429/0 — but because of two independent
pre-existing items:

### Must land before a coordinated deploy

1. **Commit the canonical tracker doc.** `guardrail:tracker-fresh` reads committed history only.
   Content is written and **proven** to flip the gate (§2). One commit of one file. *Cheapest item
   on this list; nothing else blocks it.*

2. **Resolve or explicitly classify `schema-drift`'s 18 violations.** This is the real blocker: the
   chain dies at **step 8**, so gates 9–17 never run under `npm run guardrail` regardless of item 1.
   Three sub-items:
   - 8 `nv_schema.nv_matter_vaults` mismatches (6 type, 2 NOT NULL) — an additive migration, or
     correct the TS declaration.
   - 9 pre-existing `EXTRA DB TABLE` entries from July migrations — declare in `shared/**`, or move
     to `ALLOWED_UNDECLARED` **with justification**, which the gate explicitly offers.
   - 1 `memory_entries` entry that is likely a gate false positive (§5.2) — decide whether an
     `R-SCHEMA-B`-deferred schema file should still contribute its *table* declarations. If yes, this
     is a one-line gate fix, not a schema change.

   **Note:** using `--warn-only` would move the chain forward but would **not** make the tree
   deploy-ready, and is not recommended as the resolution.

### Explicitly not blockers

- The **8 failing console tests** (§3) — pre-existing staleness in subjects untouched for weeks, in a
  suite outside `npm run guardrail`. Should be fixed, but need not gate this deploy.
- The **25-error / 19-signature** server type backlog and **134** client signatures — both at
  baseline, both ratcheted, neither refreshed.
- **Blocker 3** (`ragStep0`) — already resolved by its owning agent; not a live failure.

### Owner note

The one thing this report cannot do is commit. Both remaining conditions need a decision by whoever
owns the coordinated deploy: item 1 is mechanical; item 2 needs a judgement call on whether the July
`EXTRA DB TABLE` entries are classified or fixed.

---

*Evidence: `npm run guardrail` (full chain, aborts step 8); each gate individually with unpiped exit
codes; `npx vitest run tests/unit` (1429/0/3, exit 0); `npx vitest run tests/console` (31/8 of 39,
7/7 collect, was 0/7); `bash scripts/nv-check-schema-drift.sh` ×2 (18/35 both, migrations clean);
`bash scripts/nv-verify-ingress.sh --self-test` (exit 0); tracker gate proven in a throwaway clone
(negative exit 1 → positive exit 0); `git diff --quiet` on all three baseline files; `git stash list`
empty.*

---

## 8. UPDATE 2026-08-19T19:45Z — both blockers cleared, chain green

`NV-DRIFT-DEFER-SCAN-001`. This section supersedes §5.2 and §7.

### 8.1 The gate had a real false-positive bug

`loadSchemaFilesFromDrizzleConfig()` applied the `R-SCHEMA-B` deferral by **filtering
`shared/nv-governance-schema.ts` out of the returned file list**, so the file was never parsed.
That is defensible for the *forward* checks the deferral exists for, but the same comparison also
runs **inverse** checks — `EXTRA DB TABLE … not declared in any TS schema export` — against a
declaration set the gate had truncated by its own choice. So it reported tables as undeclared
precisely because it had chosen not to read where they were declared.

**How it was proven** (hypothesis → finding). A probe scanned the config's schema files twice — the
gate's 6-file list and the full 7-file list — and diffed the declared qualified-table sets. Its own
controls passed first: `public.nv_users` and `nv_schema.nv_matter_vaults` DECLARED in both,
`nv_schema.zzz_no_such_table` in neither. An earlier version of this probe reported a **failed
positive control**, which was the *instrument* being wrong (`public.users` does not exist; the table
is `public.nv_users`) — the boring explanation, fixed before anything was believed.

**The fix is to the gate, not the schema.** Deferred files are now always parsed; each table spec
carries a `deferred` flag and forward findings from a deferred declaration are routed to `warnings`.
Adding duplicate declarations to satisfy the broken scan was rejected: it would have created a second
source of truth for 9 tables that already have one (**NV-NO-DUPLICATE-001**).

### 8.2 Per-table classification of all 18 violations

Note the composition differs from the brief: **10** were `EXTRA DB TABLE`, not 18 — the other 8 were
`nv_matter_vaults` type/NOT-NULL mismatches.

| # | Violation | Classification | Evidence |
|---|---|---|---|
| 1–6 | `TYPE MISMATCH nv_schema.nv_matter_vaults.{vault_id, organization_id, user_id, jurisdiction, status, default_depth}` — Drizzle `PgText` vs DB `character varying` | **Genuine drift** | `migrations/2026-07-14-nv-matter-vaults.sql` L5-13 creates these `VARCHAR(64/128/16/32)`; `shared/nv-schema-tables.ts` declared all six as `text()`. TS corrected to `varchar` with the migration's exact lengths. |
| 7–8 | `NOT NULL MISMATCH (db stricter) nv_schema.nv_matter_vaults.{created_at, updated_at}` | **Genuine drift** | Migration L15-16: `TIMESTAMPTZ NOT NULL DEFAULT NOW()`; TS declared `.defaultNow()` without `.notNull()`. Added `.notNull()`. |
| 9 | `EXTRA DB TABLE nv_schema.nv_digital_twins` | **Gate false positive** | Declared `shared/nv-governance-schema.ts::nvDigitalTwins`. Probe: `GATE-BLIND`. |
| 10 | `EXTRA DB TABLE nv_schema.agent_metrics` | **Gate false positive** | Declared `…::nvAgentMetrics`. Probe: `GATE-BLIND`. |
| 11 | `EXTRA DB TABLE nv_schema.nv_agent_metrics` | **Gate false positive** | Declared `…::nvNvAgentMetrics`. Probe: `GATE-BLIND`. |
| 12 | `EXTRA DB TABLE nv_schema.hallucination_checks` | **Gate false positive** | Declared `…::nvHallucinationChecks`. Probe: `GATE-BLIND`. |
| 13 | `EXTRA DB TABLE nv_schema.ai_activity` | **Gate false positive** | Declared `…::nvAiActivity`. Probe: `GATE-BLIND`. |
| 14 | `EXTRA DB TABLE nv_schema.nv_bipa_consent_records` | **Gate false positive** | Declared `…::nvBipaConsentRecords`. Probe: `GATE-BLIND`. |
| 15 | `EXTRA DB TABLE nv_schema.nv_biometric_artefacts` | **Gate false positive** | Declared `…::nvBiometricArtefacts`. Probe: `GATE-BLIND`. |
| 16 | `EXTRA DB TABLE nv_schema.nv_rag_coverage_audit` | **Gate false positive** | Declared `…::nvRagCoverageAudit`. Probe: `GATE-BLIND`. |
| 17 | `EXTRA DB TABLE nv_schema.memory_entries` | **Gate false positive** (the one the prior pass flagged as probable — confirmed) | Declared `…::nvMemoryEntries`. Probe: `GATE-BLIND`. |
| 18 | `EXTRA DB TABLE nv_schema.nv_edj_access_denials` | **Genuine drift — no TS declaration existed** | Created by `migrations/2026-07-05-nv-drift-b-telemetry.sql` L87-97. Swept `src/ shared/ server/` for `nv_edj_access_denials`/`nvEdjAccessDenials` → **0 hits**; repo-wide sweep for `access_denials` → only that migration's own 3 lines. Declared as `nvEdjAccessDenials` mirroring the migration exactly. |

**Legitimately schema-less: none, and `ns_documents` needs no decision.** It is created by **no**
checked-in migration (`rg ns_documents migrations/ drizzle/` → 0 files), so it never exists on the
fresh DB the gate builds and was never among the 18. NYV's `UPDATE`-only relationship to the
partner-owned table is real, but it is not a drift violation and needs no allow-list entry.

**Zero tables were added to `ALLOWED_UNDECLARED`; zero new deferrals were created; `--warn-only` was
never used.** The violation count can now only shrink.

### 8.3 Proof the fix still catches genuine drift

Two negative controls applied together, then removed:

| Control | Expected | Observed |
|---|---|---|
| Throwaway migration creating `nv_schema.zzz_drift_control_undeclared` (declared nowhere) | still reported | `✗ EXTRA DB TABLE: nv_schema.zzz_drift_control_undeclared` |
| Bogus `zzz_control_missing_col` on non-deferred `nvEdjAccessDenials` | still reported | `✗ MISSING COLUMN: nv_schema.nv_edj_access_denials.zzz_control_missing_col` |

Gate **exit 1, 2 violations** with both in place — one of each genuine-drift category. Both controls
were then removed, the migrations directory re-verified clean, and the gate returned to exit 0.
The check was narrowed, not silenced.

### 8.4 The true warning count is 96

| Category | Before (6-file scan) | After (7-file scan) |
|---|---|---|
| `R-SCHEMA-B` table absent | 30 | 90 |
| Encrypted-column deferral | 5 | 5 |
| `EXTRA DB COLUMN` (deferred) — `memory_entries.value_tsv` | 0 | 1 |
| **Total** | **35** | **96** |

The brief's 15 and the readiness report's 35 were both measured against the truncated scan. Parsing
the deferred file makes its **69** table exports visible, which is where the 30 → 90 rise comes from.
**No warning was lost:** the before/after deferral lists were set-differenced (`comm -23`) → empty.

### 8.5 Chain result

`npm run guardrail` → **exit 0**, all **17** gates run to completion, final gate
`guardrail:never-break` "all shipped features intact". Reproduced on two consecutive runs
(113 s / 123 s). `guardrail:schema-drift` **0 violations / 96 warnings**, "✅ NO DRIFT".
`guardrail:tracker-fresh` exit 0 (`a4fe761`), captured at exit 1 "STALE" beforehand as the control.

**Tracker doc committed alone.** Staged set empty before; exactly one path after `git add`;
`git show --stat HEAD` = `1 file changed, 61 insertions(+)`; 121 other dirty paths from concurrent
agents untouched. No `git stash`/`reset`/`checkout`/`clean` at any point.

### 8.6 Non-blockers re-confirmed, and one intermediate test failure attributed

- **No baseline refreshed** — `.tsc-server-baseline.txt`, `.tsc-server-ceiling.txt`,
  `client/.tsc-baseline.txt` clean on both `git status --porcelain` and `git diff --stat` after all
  work. `server-types` **25 errors / 19 signatures**; `client-types` **134 signatures**;
  `no-placeholder` debt **75**. All unchanged.
- **`tests/unit` 1484 passed / 3 skipped / 0 failed, exit 0.** An intermediate run showed 4 failures;
  all 4 re-ran green in isolation (61/61, exit 0), and **3 of the 4 files are untracked (`??`) files
  being written by concurrent agents at that moment**. None references the changed files (`rg` for
  `nv-schema-tables` across `tests/` → 0 hits). Concurrent mid-write churn, not regression.
- **`tests/console` 8 failed / 31 passed of 39** — unfixed by scope. All three subjects clean against
  HEAD; the stale drift guard confirmed stale by control (`roleHomeMap` in `client/src/App.tsx` → **0**
  hits, control `export default` → 1). `tests/console` is not part of the guardrail chain.
- `shared/nv-schema-tables.ts` type-checked clean under `--strict` separately, because the chain's
  `tsconfig.json` covers only `src/**`. Instrument validated: an injected `number`→`string` default
  produced `TS2345`, exit 2.

### 8.7 Verdict — **GO on the guardrail chain**

The chain is green end to end and both §7 conditions are cleared. No architect decision is
outstanding — including the partner-owned-table policy, which turned out not to arise.

Conditions that remain, and are **not** guardrail-chain blockers:

1. **Two agents still have uncommitted work in this tree.** Nothing here is committed except the one
   authorised tracker doc; the drift-gate and schema fixes are **uncommitted working-tree changes**.
   They must be committed by whoever owns the coordinated deploy, and the chain re-run once the tree
   is quiet, because a green chain measured over other agents' in-flight edits is a snapshot.
2. **The 96 warnings are a real backlog, now fully visible.** `R-SCHEMA-B` catch-up migrations for 90
   `nv_schema` tables remain unlanded. That was true before this change and is unchanged by it, but
   the count is no longer understated by 61.
3. Console 8, server 25/19, client 134 — pre-existing, unrefreshed, out of chain.

*Evidence for §8: `npm run guardrail` ×2 (exit 0, 17/17 gates, final gate `never-break`);
`npm run guardrail:schema-drift` (exit 0, 0/96) and `-- --verbose` for the warning breakdown;
negative-control run (exit 1, 2 violations, one per category); two-scan declaration probe with 3
passing controls; `npm run guardrail:tracker-fresh` (exit 1 before → exit 0 after);
`git show --stat HEAD` (1 file, 61 insertions); `npx vitest run tests/unit` (1484/0/3, exit 0) and the
4-file isolation re-run (61/61, exit 0); `npx vitest run tests/console` (8/31 of 39);
`git status --porcelain` + `git diff --stat` on all three baseline files (clean); `tsc --strict` on
`shared/nv-schema-tables.ts` (exit 0) with positive control (`TS2345`, exit 2).*
