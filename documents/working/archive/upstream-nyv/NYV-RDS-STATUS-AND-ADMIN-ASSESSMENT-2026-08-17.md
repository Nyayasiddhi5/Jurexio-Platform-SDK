# RDS status + admin credential assessment (2026-08-17)

> **Scope:** answers to (1) RDS access cross-check, (2) how the application on EC2 is
> working against RDS, and (5) the repercussions of setting a new master password.
> **Nothing was rotated, created or modified.** Read-only investigation, per
> **NV-NO-KEY-ROTATION-DEV-001** and your standing instruction.
> **Evidence:** AWS `describe-db-instances`; SSM `rds-status-report`, `admin-fallback-check`.

---

## 1. RDS inventory (from AWS, not from config)

| instance | status | class | Multi-AZ | master user | storage | backups | encrypted | public |
|---|---|---|---|---|---|---|---|---|
| **`nyv-dev-edge-pg`** ← the app DB | **available** | `db.r7g.large` | **true** | `nyvadmin` | 20 GB | 7 d | yes | no |
| `nyv-caselaw-pg` (NYS corpus) | backing-up | `db.r6g.large` | false | `nyv_admin` | 324 GB | 7 d | yes | no |
| `nsp-prod-pg` (NSP's own) | available | `db.t3.small` | false | `nsp_admin` | 20 GB | 14 d | yes | no |

All three are private (`public: false`), encrypted, and reachable only from inside the
VPC — which is why every probe has to run through SSM on the EC2 host.

Note the three **different master usernames**. `nyvadmin` (no underscore) is the app DB;
`nyv_admin` (underscore) is the caselaw DB. That naming collision is a plausible origin
of the stale password: a value for one may have been stored as the other.

---

## 2. Is the platform actually working against RDS? **Yes — fully.**

The application does **not** use the admin credential for serving. It uses `nv_app`, and
that role is healthy:

| signal | value | reading |
|---|---|---|
| App role query | `nv_app`, PostgreSQL 16.13 | connected |
| DB size | 221 MB | live |
| Committed transactions | **22,283,927** | heavily used |
| Rollbacks | 155,877 (0.7 %) | normal |
| **Buffer cache hit ratio** | **100.00 %** | excellent — effectively all reads from memory |
| Blocks read from disk | 20,663 vs 455 M hits | negligible I/O |
| Connection errors in 2 h | **0** | no pool exhaustion, no refusals |
| `permission denied` in 2 h | **0** | grants are correct |
| Tables in `nv_schema` | 112 | schema present |

Recent write volume confirms it is serving, not merely connected:
`nv_iso_control_evidence` 5,377,799 writes · `legal_agents` 105,492 · `nv_statutes` 81,001
· `ai_activity` 42,399 · `sdk_usage_metering` 32,995 · `sdk_api_request_logs` 22,556.

`nv_app` grants on `memory_entries`: `SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER`
— i.e. **every runtime operation works**. Memory read/write, RAG, metering, audit are all
unaffected.

### What the missing admin credential actually costs

Roles present: `nv_app`, `nym_app`, `nyvadmin` (createdb, not superuser), `rdsadmin`
(superuser, AWS-managed). `nv_app` is a member of **nothing** and:

| capability | `nv_app` |
|---|---|
| `USAGE` on `nv_schema` | **yes** |
| `CREATE` in `nv_schema` | **no** |
| `CREATE` in `public` | **no** |
| Tables owned | **0 of 112** (111 owned by `nyvadmin`) |
| `memory_entries` owner | **`nyvadmin`** |

So `nv_app` cannot run `ALTER TABLE`. **This is the whole blast radius: DDL only.**

Three code paths reference `DATABASE_URL_ADMIN`, and I checked each rather than assuming:

| path | behaviour without admin | verified |
|---|---|---|
| `db/nv-auth-db.ts` | `buildAdminUrl()` returns `null` → warns, **falls back to the runtime pool** | login endpoint reachable (403 CSRF, i.e. the stack ran) |
| `db/nv-ensure-schema.ts` | logs a hint and **continues** — its header states "response path must never block" | 0 ensure-schema errors |
| `nv-legal-intelligence-feed-service.ts` | would throw only if tables were missing; they exist | **feed returns HTTP 200, 14,056 bytes** |

**Conclusion: the broken admin credential is dormant, not a live defect.** It blocks
exactly one thing — applying the `value_tsv` migration (`NV-MEM-RECALL-INDEX-001`) — and
that migration is itself an optimisation for a **latent** problem (~62k rows/user; the
table holds 1,637). The code already degrades to the old query via `hasTsvColumn()`, and
live logs confirm 0 `value_tsv` errors and 0 recall failures.

### One genuine, unrelated defect this surfaced

Two live warnings, every boot:

```
selectRows failed | SELECT channel_id, org_id, config FROM nv_schema.nv_openbot_channels … 
  error: column "org_id" does not exist
selectRows failed | SELECT rule_id, org_id, rule FROM nv_schema.nv_openbot_routes …
  error: column "org_id" does not exist
```

Real schema drift: the code expects `org_id` on two `nv_openbot_*` tables that do not have
it. It is fail-soft (`warn`, not `error`), so OpenBot channel/route config silently reads
as empty. **Also needs DDL, so also blocked on admin.** Not in scope for NSP/NYM AI tasks,
but it should not stay hidden.

---

## 5. Repercussions of setting a new master password

You asked what breaks. Being precise, because the answer is better than it looks.

### What a master-password reset does NOT touch

- **`nv_app` and `nym_app` passwords are unchanged.** They are separate roles with their
  own credentials. Resetting the `nyvadmin` master password does not alter them.
- **Therefore the application keeps serving.** Every runtime query uses `DATABASE_URL`
  (`nv_app`), which is untouched. No restart, no reconnect, no downtime.
- **NSP is not affected at all.** NSP has its own database (`nsp-prod-pg`, master
  `nsp_admin`). It reaches NYV over HTTPS with an API key, never over Postgres. NYM the
  same. **No partner platform holds a `nyvadmin` credential.**
- **NYS/caselaw is a different instance** (`nyv-caselaw-pg`, master `nyv_admin`) and is
  not involved.

### What it does touch

| effect | detail |
|---|---|
| **Brief RDS state change** | `modify-db-instance --master-user-password` applies immediately; the instance shows `modifying` for seconds. **No reboot, no failover** for a password-only change. Multi-AZ makes it safer, not riskier. |
| Anything else using `nyvadmin` | Only our own migration/ops scripts. Worth grepping the ops tooling first. |
| `.env.production` on EC2 | Needs the new value for future migrations. It is currently stale anyway, so this repairs rather than breaks it. |
| Audit trail | Per AGENTS.md §3 the rotation must be logged in `Project-Tracker.md` with a generation timestamp (never the value). |

### The honest risk assessment

**Low, and lower than leaving it broken.** The credential is *already* non-functional, so
there is no working state to lose. The realistic failure mode is not the reset itself but
**an ops script somewhere holding the old value and starting to fail** — and since the old
value already fails, that cannot regress either.

**The one thing I would not do:** reset it while treating it as "just unblocking my
migration". The two `nv_openbot_*` columns are also blocked, and there may be more drift.
If we do this, we should apply all pending DDL in one window with the tracker updated once.

### My recommendation

**Do not reset it yet**, for three reasons:

1. Nothing is broken for users or partners today. The blocked migration addresses a
   problem that begins at ~62,000 rows per user; we are at 1,637 rows **total**.
2. You have said repeatedly that we stay in development mode with credentials frozen until
   staging. This is exactly that case, and I do not want to be the reason that rule bends.
3. There may be a working copy we have not found. Two candidates were tested and both
   failed, but the `nyvadmin` / `nyv_admin` naming collision suggests the real value may be
   filed under the caselaw DB's name, or in Bitwarden/1Password outside this workspace.

**Cheapest next step, zero risk:** check your password manager for a `nyvadmin` entry for
`nyv-dev-edge-pg`. If you paste it into `.local/secrets/` I will apply the two pending
DDL changes and verify, with no rotation at all.

**If you prefer the reset**, I need an explicit GO naming the credential, and I will:
apply it via `aws rds modify-db-instance`, update the EC2 envfile (chmod 600, backup
first — with a **diff check**, which I got wrong earlier today), apply both pending
migrations, verify `nv_app` reads and the gateway health, and log the generation timestamp
in the tracker with no value anywhere.

---

## Summary

| Question | Answer |
|---|---|
| RDS access | `nv_app` **works**; `nyvadmin` master password is **stale in both stored copies** and matches nothing |
| RDS status | `nyv-dev-edge-pg` **available, Multi-AZ, encrypted, private**, 7-day backups |
| App working against RDS | **Yes, fully.** 22.3 M commits, **100 % cache hit**, 0 connection errors, 0 permission errors |
| Impact of the broken admin | **DDL only.** All three admin-consuming paths fall back; feed returns 200 |
| Blocked by it | `value_tsv` memory index (latent) + `nv_openbot_*` `org_id` drift (fail-soft) |
| Password reset repercussions | **App keeps serving; NSP/NYM unaffected** (different DB, HTTPS + API key). Seconds of `modifying`, no reboot/failover |
| Recommendation | **Do not reset.** Look for the real value first — no rotation needed |
