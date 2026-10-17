# NYV + NYS — Agent operating map (read this FIRST)

> **Purpose.** One file that answers the questions an agent otherwise re-discovers by
> probing production: what runs where, which DB, which credential, which path, and how to
> verify. Written 2026-08-18 after burning hours (and the architect's tokens) re-learning
> facts that were already written down in `docs/canonical/`.
>
> **This file is a pointer + distilled index, not a replacement.** Where it disagrees with
> `docs/canonical/`, the canonical doc wins.

---

## 0. Read order at session start

| # | File | What it settles |
|---|---|---|
| 1 | `replit.md` | project overview, run commands, current operational truth |
| 2 | `guardrails.md` (root) | the 13 NV-* hard guardrails, short form |
| 3 | `AGENT-GOTCHAS.md` (root) | **the traps** — long-form NV-* + historical fix recipes |
| 4 | `nyayavigya-platform-312/FEATURES-REGISTRY.md` | is feature X built / wired / live |
| 5 | `docs/canonical/00-README.md` | canonical index, NV-LLM-001 whitelist, provider lockdown |
| 6 | `docs/canonical/INFRA-MAP-2026-05-14.md` | **hosts, DBs, ports, secret names, IAM** |
| 7 | `docs/canonical/EC2-DEVOPS-SOP-2026-05-14.md` | deploy + ops runbook |

One-shot: `cd nyayavigya-platform-312 && npm run session:preflight`

**Do not probe production for anything answered above.** Probe to verify a hypothesis or
to confirm a fix — not to learn the architecture.

---

## 1. The two products, the two hosts

NYS is **part of NYV**, not a separate project. It is deployed to its own EC2 box purely to
isolate corpus and document-processing load.

| | **NYV** (gateway + console) | **NYS** (NyayaSearch) |
|---|---|---|
| tree | `nyayavigya-platform-312/` (this workspace) | `~/Desktop/nyayavigya-platform-5.0.0/NYS-Agentic-AI/` — a git **submodule of a different checkout** |
| EC2 | `i-0df71e5ea1df8f588` (nysdev) | `i-000115b19219bb766` (nyv-caselaw-worker) |
| runtime | **Docker** — container `nyv-gateway` (:5000 internal), `console` nginx (:80/:443) | **systemd** — `nyv-api.service` on **:8080**. *No docker, no psql on this host.* |
| public URL | `api.nyayasiddhi.online`, `console.nyayasiddhi.online` | `nyayasearch.nyayasiddhi.online` |
| app dir | `/opt/Nyayavigya` | `/opt/nyv/api` (has `node_modules`, incl. `pg`) |
| secrets | `/opt/Nyayavigya/secrets/.env.production` | `/opt/nyv/api/.env` |
| API prefix | `/api/nv/...` | **`/api/...`** (e.g. `/api/caselaw/search`). Bare `/caselaw/search` returns the **dashboard HTML**, not JSON. |
| auth env | `NYV_SDK_KEY_NSP` etc. | **`NYS_SDK_API_KEYS`** (may be a list — take the first token) |

**NYS also serves a dashboard** (SPA) from the same port, which is why an unprefixed path
returns HTML with HTTP 200. A 200 is not proof you hit the API.

### NYS embed services (systemd)

`nyv-caselaw-embed-loop@{0,1,2}` (3 HC shards) + `nyv-caselaw-embed-dc` (district court).
Loop script `/opt/nyv/api/nv-caselaw-embed-loop.sh`, worker `/opt/nyv/api/embed-corpus.mjs`.
Host is small: **4 vCPU / 7 GB**.

---

## 2. Databases — there are TWO, and they are different

This is the single most expensive thing I got wrong: I probed `DATABASE_URL` for the
`judgments` table and concluded "relation does not exist".

| DB | instance id | used by | how credentials are obtained |
|---|---|---|---|
| **Platform** | `nyv-dev-edge-pg` | NYV gateway | env: `DATABASE_URL` / `NYV_DATABASE_URL` (role `nv_app`), `DATABASE_URL_ADMIN` (role `nyvadmin`, DDL only) |
| **Caselaw** | `nyv-caselaw-pg` | NYS API + embed jobs | **NOT an env var.** Built at runtime in `artifacts/api-server/src/lib/rdsPool.ts`: `DescribeDBInstances` → `MasterUserSecret.SecretArn` → Secrets Manager → `{username,password}`. DB name `nyv_caselaw`. |

So on the NYS host, `DATABASE_URL` is **not** the caselaw DB. To query `judgments`,
replicate the `rdsPool.ts` flow (RDS describe → Secrets Manager) using
`/opt/nyv/api/node_modules`.

Other facts worth not re-deriving:
- `nyvadmin` owns all **112** tables in `nv_schema`; `nv_app` owns **0** and has `CREATE=false`.
  A runtime `ALTER TABLE ... IF NOT EXISTS` in service code **fails silently forever**.
- RDS master password charset must be **alphanumeric only** — `:` `/` `@` `?` `#` break
  `postgresql://user:pass@host` parsing and look like a wrong password.
- Verifying DB auth: **never grep output for the username** — the failure string
  `password authentication failed for user "nyvadmin"` contains it. Assert a literal
  sentinel (`SELECT 5150;`) **and** `rc=0`.

---

## 3. Deploy and remote execution

```bash
# NYV deploy (~11 minutes — batch changes, do not deploy per-fix)
cd nyayavigya-platform-312
bash -c 'source scripts/nv-source-dev-deploy-env.sh && bash scripts/deploy-aws-ssm.sh --note "..."'
# -> deploy id like 2026-08-18T1010Z-aws-ssm, prints sha + SSM cmd id

# run a one-off script on a host via SSM
bash scripts/nv-ec2-ssm-run.sh <local-script> "<comment>"                       # NYV host (default)
NYV_EC2_INSTANCE_ID=i-000115b19219bb766 bash scripts/nv-ec2-ssm-run.sh ...      # NYS host
```

`scripts/nv-source-dev-deploy-env.sh` supplies AWS creds + `NYV_EC2_INSTANCE_ID`; it must
be sourced **inside the same shell** as the deploy (`bash -c '...'`), not a prior call.

- **SSM runs `/bin/sh`** — invoke bash scripts explicitly with `bash`.
- Deploy is **~11 min**. Two deploys in a row for related fixes is a process failure.
- EC2 deploy + destructive migrations are **GO-gated** by the user.
- **Deploy has no drain/readiness gate** → a request landing in the recreate window gets a
  **502**. This caused NSP task 387 (created 124 ms after container start). Still open.

### Long SSM commands

`get-command-invocation` returns `InProgress` for slow scripts. **Do not sit in a polling
loop** — start it, then hand control back to the user with the command id and ask to be
pinged, or check once later. Polling burns the user's tokens for nothing.

---

## 4. Verification discipline (the rules that keep being re-learned)

**NV-EXECUTE-BEFORE-CLAIM-001** — never report a defect or design a fix from grep alone.
**NV-VALIDATE-THE-PROBE-001** — every probe carries a positive control that MUST match.

Real instrument failures from this session, all of which *looked* like platform defects:

| symptom | truth |
|---|---|
| `2ms http=200` from NYS | hit the **SPA HTML**, not the API — wrong prefix |
| `key_len=0` then 401s | probe had no key; would have read as "auth broken" |
| "docker: command not found" | NYS is **systemd**, not docker |
| `relation "judgments" does not exist` | **wrong database** (see §2) |
| caselaw "10.5 s" | a **cold** call; warm is 0.31–0.37 s. Reported as a P0, withdrawn. |
| test flagged a 3rd `ANY()` offender | it matched **my own comment** quoting the broken form |

Corollaries:
- **Measure warm and cold.** One cold sample is not a latency finding.
- **Prefer the boring explanation** — "my command was wrong" over "the platform is broken".
- An impossible output shape (empty from `grep -c`, `Success` with no stdout) means the
  *instrument* failed.

---

## 5. Known live traps in code

- **Drizzle + `ANY()`** — `sql\`... ANY(${jsArray})\`` expands to a parameter **list**
  `ANY(($1,$2,…))`, which Postgres rejects: *"op ANY/ALL (array) requires array on right
  side"*. Use `ANY(string_to_array(${csv}, ',')::uuid[])`. It compiles, so only runtime
  shows it — and if the query is fire-and-forget behind a non-fatal warn, it ships.
  Guarded by `tests/unit/nv-sql-any-array-cast.test.ts`.
- **OpenAPI generator scrapes `.get('…')`** — a Map lookup like `fieldByKey.get('x')` is
  registered as a phantom `GET .../x` route in the frozen contract. Assign the key to a
  local const first.
- **`applyPartnerPromptAlias` only folds `content` into `prompt` when `prompt` is absent**
  (`PARTNER_PROMPT_KEYS` in `src/utils/nv-partner-platform.ts`). A partner sending an
  instruction in `prompt` **and** a document in `content` leaves `prompt` short — read
  `content` explicitly, or pick the longest candidate.
- **Console is served from a built bundle** (NV-CLIENT-BUILD-001) — edits under
  `client/src/` are invisible until `npx vite build` + gateway restart. Source ≠ served.
- **Tests that assert inline source text** break on legitimate refactors. Prefer asserting
  behaviour, or assert *delegation* + test the shared helper's real output.
- **`nv_schema.rag_documents` vs `public.rag_documents`** — name collision, real ambiguity.

---

## 6. Baselines (a change is clean if it does not move these)

| check | baseline |
|---|---|
| `npx tsc --noEmit` | **39** errors |
| `npx vitest run tests/unit` | **3 failing** (`nv-case-management-routes.ts` missing → 2 in `security/rls.test.ts`, 1 in `nv-ecosystem-document-job.test.ts`) |
| OpenAPI operations | **1,607** (was 1,609 before 2 generator phantoms were removed) |
| placeholder debt | 75 |
| effective orphans | 0 |

`npm run guardrail` runs `type-check` **first**, and the 39 baseline errors make it exit
non-zero — so the later guardrails never run. Run the relevant ones individually:
`guardrail:api-contract`, `no-placeholder`, `intent-mesh`, `cascade-ids`, `orch-stage`,
`never-break`, `flat-registry`, `tracker-fresh`.

---

## 7. Every non-trivial change must update

1. `Project-Tracker.md` → Change log row (UTC timestamp, status, owner, area, summary, **evidence pointer**)
2. `CHANGELOG.md` → `[Unreleased]`
3. `docs/canonical/10-tracker-changelog-*.md` → session entry (else `guardrail:tracker-fresh` fails)
4. SDK surface change → bump `packages/<sdk>/package.json` + its CHANGELOG

Rules: **NV-DOC-001** no new top-level `.md`; never edit `documents/completed/`;
**NV-NAMING-001** grep before creating any file under `src/`, prefix `nv-`;
**NV-SECRETS-001** never echo a secret value.

---

## 8. Ask the architect

The user built this over 18 months and knows it better than any audit. When a fact is
load-bearing and not in the canonical docs — which host, which DB, whether a subsystem is
meant to be live — **ask**, rather than spending a probe round-trip and their tokens.
