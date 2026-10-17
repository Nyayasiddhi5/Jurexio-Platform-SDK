---
status: live
version: 3.1.2 (platform code) / 5.0.0 (SDK suite — public/consumer-facing)
supersedes: PRE-GA-STATUS-2026-04-25.md
ga_target: 2026-05-03 (pulled in from 2026-05-15)
last_updated: 2026-05-01T16:00Z
---

# Pre-GA status — 2026-05-03 cut

> **Use this file, not `PRE-GA-STATUS-2026-04-25.md`**, for the May-3 ship.
> The April-25 doc is preserved for the original baseline; this one tracks
> everything that has flipped or remains open since.

## 1. Where we are right now

| Surface                                    | State            | Evidence |
|--------------------------------------------|------------------|----------|
| EC2 dev gateway (`i-0df71e5ea1df8f588`)    | **healthy v5.0.0** | `CURRENT_DEPLOY = 2026-05-02T0946Z-replit-ssm-a558dbab`, sha `a558dbab` (verified 2026-05-02T1011Z; supersedes `2026-05-01T07:50Z-pre-ga-may3-fixes`) |
| Audit chain (NS-010)                       | **strict-OK**    | post-deploy verification 2026-05-01T08:15Z |
| All 6 SDK tarballs in S3 at v5.0.0         | **shipped**      | `s3://nyayavigya-sdk-devapp/sdk/{client-sdk,client-sdk-react-native,nyayamitra-sdk,types,react-hooks,enterprise-sdk}/5.0.0.tgz` |
| §11 caveats 5, 7, 8, 9, 10                 | **RESOLVED**     | `SDK-DEV-EC2-ACCESS-2026-05-01.md` §11 |
| Per-platform hand-off                      | **landed**       | `SDK-RELEASE-2026-05-03.md` (NYM/NSP/NSI/NSA/NSM) |
| Platform keys provisioned (canonical path) | **4/5 active; NSM pending** | NYM/NSP/NSI/NSA canonical keys remain valid from 2026-05-01 mint at `/opt/nyayavigya/secrets/platform-keys-2026-05-01.txt`; NSM blocked pending canonical-path mint (see `NYV-OPS-RUNBOOK.md` §5.4 + §8.2 C1). Demo-only legacy-table mint of 2026-05-02 at `/opt/Nyayavigya/secrets/sdk-keys-2026-05-02.txt` (root 600, 8 keys for NYM/NSP/NSI/NSA × {live,test}) authenticates against `/provision/*` only, not `/gateway/*`. |

## 2. Pending for May 3 — Replit side

| ID | Item                                                                                              | Owner | Severity |
|----|---------------------------------------------------------------------------------------------------|-------|----------|
| R1 | `packages/react-hooks/package.json` peer-dep mismatch (`@testing-library/react@^14` peer = React 18, devDep = React 19) → ERESOLVE under npm ≥ 10. Bump `@testing-library/react` to `^16.x`. (§11 #1) | platform | medium |
| R2 | `Project-Tracker.md` §5 entry for 2026-05-01 + §1 fact refresh (deploy markers, agent-count drift). | platform | low |
| R3 | Two new v5.0.0 product notes — business + technical — replacing the v3.1.2 notes in `completed_docs/`. | platform | high (this turn) |
| R4 | Replace docs reference to `pnpm deploy` (SSH path) with `scripts/deploy-replit-ssm.sh` in `NYV-CICD-REPLIT.md`. | platform | low |
| R5 | Document the SDK build matrix as `pnpm --filter <pkg> build && pnpm pack` in the consumer install guide (the old `build-all-sdks.sh` is archived). | platform | low |

## 3. Pending for May 3 — EC2 side

| ID | Item                                                                                              | Owner | Severity |
|----|---------------------------------------------------------------------------------------------------|-------|----------|
| E1 | §11 #6 — legacy `nv_api_keys` / `nv_sdk_applications` divergence. **PARTIALLY RESOLVED 2026-05-02:** `Deprecation: true`, `Sunset: Sat, 01 Aug 2026 00:00:00 GMT`, `Warning: 299 …`, `Link: …; rel="deprecation"`, `X-NYV-Deprecated-Surface: legacy-sdk-keys`, `X-NYV-Sunset-Version: v3.2` headers now emitted on every response from `POST /api/nv/sdk/provision`, `POST /api/nv/sdk/provision/validate`, and `POST /api/nv/sdk/provision/create-app` (the three routes that read or write the legacy tables). Implementation: `src/middleware/legacy-deprecation-header.ts` + `LEGACY_SDK_KEYS_DEPRECATION` factory; v3.2 drop migration staged at `archive/v3.2-prep/0008_drop_legacy_sdk_tables.sql` (NOT in live migration dir). **Still pending for full resolution:** EC2 deploy of the middleware (next deploy window) + consumer migration to `nv_sdk_keys`. No OpenAPI deprecation tag because the platform does not currently ship an OpenAPI spec file — headers + middleware constant are the source of truth instead. | platform | medium |
| E2 | `scripts/nv-start-dev.sh` health-poll loop curls `/api/nv/gateway/health` without a Bearer → 401 → false-fail. Either curl `/health` (unauthenticated) or include the SRE Bearer. (Today's deploy required manual marker promotion.) | platform | low |
| E3 | Agent-count drift — Project-Tracker §1 says target is `1042` but live RDS shows `1046`. Re-derive math vs registry JSON and decide whether to update the validator boundary or re-seed. | platform | medium |
| E4 | One smoke that timed out today — `POST /agents/:id/execute` and `POST /sdk/enterprise/research/domain/legal` both ran past 45s. Rerun against all 5 platform keys with a 90s window to confirm end-to-end LLM path is alive. | platform | high |
| E5 | Verify all `drizzle/` 0000-0006 SQL files are `applied` on EC2 RDS (the deploy didn't add any new migrations, but a sanity SELECT against `drizzle.__drizzle_migrations` is worth the 30 seconds). | platform | low |

## 4. Replit ↔ AWS CI/CD — current reality

The doc `NYV-CICD-REPLIT.md` describes a **`pnpm deploy` → rsync over SSH** path
that requires an EC2 SSH key in Replit Secrets. **This Replit container does
not have that key**, so the documented path has not actually worked from Replit.
What we used today, and what should be used until Bitbucket/GitLab takes over,
is **`scripts/deploy-replit-ssm.sh`** (newly added 2026-05-01):

```
Replit edit
   │
   ▼
pnpm tsc --noEmit            (optional, NYV_DEPLOY_TYPECHECK=1)
   │
   ▼
tar working tree → /tmp/nyv-<id>-<sha>.tgz       (script step 1)
   │
   ▼
aws s3 cp → s3://nyayavigya-sdk-devapp/deploys/<id>-<sha>.tgz   (step 2)
   │
   ▼
aws ssm send-command  (base64-inline shell)       (step 3)
   │
   ▼
EC2: download → extract → docker compose build --pull gateway
        → up -d --force-recreate gateway → poll /health
        → write CURRENT_DEPLOY + LAST_GOOD_DEPLOY
        → append to /opt/nyayavigya/deploys.log
   │
   ▼
SSM stream back to Replit + append .local/replit-deploys.log    (step 4)
```

**No Replit ↔ EC2 syncing happens automatically.** Each Replit edit is a
manual `bash scripts/deploy-replit-ssm.sh` invocation. The 7 GitHub Actions
workflows under `.github/workflows/` are wired correctly but only fire from
a real GitHub repo — they're idle until source migrates off Replit.

When source moves to Bitbucket or GitLab the bridge is straightforward:

1. The `production.yml` / `staging.yml` workflows already do build + tarball
   + deploy via SSH on a self-hosted runner.
2. Migrate the SSM/base64 shell from `deploy-replit-ssm.sh` into a reusable
   composite action so the Bitbucket/GitLab pipeline uses the **same** EC2
   apply step and the deploy semantics don't fork.
3. Retire `deploy-replit-ssm.sh` from main once source has fully cut over;
   keep it under `archive/` as a break-glass for direct-from-laptop deploys.

## 5. Database / RAG / seed sync — Replit → EC2

**Forward-only schema migrations.** `drizzle/` holds 7 ordered SQL files
(0000–0006). The deploy pipeline runs `pnpm drizzle:push` inside the new
release directory between extract and docker-restart. Drizzle records
applied migrations in `drizzle.__drizzle_migrations` so reruns are no-ops.
**Rule**: every migration is additive — add the new column / table, deploy,
backfill in a separate idempotent script, then a later release drops the old
column. This way previous releases keep working against the newer schema and
rollback is just `docker compose up -d --force-recreate` against the prior
release directory.

**Idempotent seeders.** 13 files under `scripts/nv-seed-*.ts`:

| Seeder                                | What it touches                                |
|---------------------------------------|------------------------------------------------|
| `nv-seed-agents.ts`                   | `legal_agents`, agent registry per jurisdiction |
| `nv-seed-jurisdictions.ts`            | `jurisdictions`                                |
| `nv-seed-statutes.ts`                 | `statutes`, `statute_sections`                 |
| `nv-seed-llm-providers.ts`            | `llm_providers`, `llm_models`                  |
| `nv-seed-mcp-tools.ts`                | `mcp_tools`                                    |
| `nv-seed-models.ts`                   | `models`                                       |
| `nv-seed-organizations.ts`            | `organizations` (demo tenants)                 |
| `nv-seed-rag-and-audit.ts`            | `rag_documents`, `audit_log` (test fixtures)   |
| `nv-seed-sdk-apps.ts`                 | `sdk_applications`                             |
| `nv-seed-sdk-keys.ts`                 | `sdk_api_keys`                                 |
| `nv-seed-ecosystem-demos.ts`          | demo tenants for NYM/NSP/NSI/NSA/NSM           |
| `nv-seed-feature-flags.ts`            | `feature_flags`                                |
| `nv-seed-all.ts`                      | runs every seeder above in order               |

All seeders are idempotent (`ON CONFLICT DO UPDATE`). Run on EC2 after a
release that adds new seed data:

```bash
aws ssm send-command \
  --region ap-south-1 --instance-ids i-0df71e5ea1df8f588 \
  --document-name AWS-RunShellScript \
  --parameters 'commands=["cd /opt/nyayavigya/repo/$(cat /opt/nyayavigya/CURRENT_DEPLOY)/nyayavigya-platform-312 && pnpm tsx scripts/nv-seed-<which>.ts"]'
```

**RAG embeddings.** `scripts/nv-rag-backfill-embeddings.ts` reads from
`rag_documents`, computes embeddings via OpenAI, writes to the `pgvector`
column. Resumable from last checkpoint; safe to interrupt.

**Cache invalidation.** `scripts/nv-cache-invalidate.ts` flushes ElastiCache
keys after schema migrations.

**The order that does not disrupt EC2 dev:**

```
1. drizzle migrate    (additive only — no DROP / RENAME)
2. seed (only the seeder for the new data)
3. cache invalidate
4. (optional) nv-rag-backfill-embeddings.ts
```

## 6. What's been moved out of the live tree

`archive/2026-05-01-pre-may3-cleanup/`:

- `scripts/deploy-replit-direct.sh` — SSH-based, never worked from Replit.
- `scripts/build-all-sdks.sh` — wrong package list + `--silent` masking bugs.
- `scripts/nv-publish-sdk-tarballs.ts` — wrong package list + wrong default bucket.
- `Project-Tracker-Nyayavigya-SDK-312.md` — self-marked SUPERSEDED on line 1.

See `archive/2026-05-01-pre-may3-cleanup/README.md` for restore instructions.

## 7. Documents that still apply unchanged

These are current and authoritative — do not move to archive:

- `docs/v3.1.2/SDK-DEV-EC2-ACCESS-2026-05-01.md` (live status, §11 just updated)
- `docs/v3.1.2/SDK-RELEASE-2026-05-03.md` (today's per-platform hand-off)
- `docs/v3.1.2/completed_docs/architecture/NYV-ARCHITECTURE-CANONICAL.md`
- `docs/v3.1.2/completed_docs/agents/NYV-AGENT-CATALOG.md`
- `docs/v3.1.2/completed_docs/NYV-SDK-v5-MASTER-INTEGRATION-GUIDE.md`
- `docs/v3.1.2/completed_docs/NYV-SDK-v5-INTEGRATION-GUIDE.md`
- `docs/v3.1.2/completed_docs/NYV-SDK-v5-API-REFERENCE.md`
- `docs/v3.1.2/completed_docs/NYV-CICD-REPLIT.md` (needs the SSM-path note from §4 above merged in — R4 above)
- `Project-Tracker.md` (canonical, append-only)
- `Roadmap.md`
