---
status: completed
version: 3.1.2
superseded_by: null
last_verified: 2026-04-25
---
# Replit → EC2 CI/CD

> Supersedes `NYV-REPLIT-MASTER-EXECUTION-PLAN.md`, `ONE-CLICK-DEPLOY.md`, `NYV-MULTI-REPLIT-CICD-PLAN.md`.

Replit is the single source of truth. Bitbucket is retired (the pipeline file
is archived under `archive/2026-04-cleanup/bitbucket/`).

## Deploy paths (in order of preference)

| Path | Use when | Command |
|---|---|---|
| **ECR**  | Partner-built image (CI built+pushed) | `pnpm deploy --use-ecr <tag>` |
| **Full** | Anything else | `pnpm deploy` |
| **Promote** | Staging image is golden, want to roll to prod | `pnpm deploy:promote <staging-tag>` |
| **Rollback** | The last deploy is broken | `pnpm deploy:rollback` |

All scripts live under `scripts/`; pnpm aliases are in `package.json`.

## What `pnpm deploy` actually does

```
1. Acquire a lockfile (/tmp/nyv-deploy.lock) — one deploy at a time.
2. preflight():
     - check uncommitted changes
     - secret-scan (regex; gitleaks if installed)
     - if NYV_DEPLOY_FULL_PREFLIGHT=1, run scripts/preflight.sh too
     - if NYV_DEPLOY_TYPECHECK=1, run pnpm type-check
3. build_tarball():
     - tar the working tree minus .git, node_modules, dist, archive, .local, …
     - record a deploy id (UTC timestamp + 7-char SHA)
4. ship():
     - rsync over SSH to /opt/nyayavigya/incoming/<id>/
     - extract to /opt/nyayavigya/releases/<id>/
     - run pnpm install --prod inside the release
5. migrator (drizzle push, in-container):
     - run db migrations from the new release directory
6. swap():
     - atomic symlink swap: /opt/nyayavigya/repo/nyayavigya-platform-312 -> releases/<id>
7. restart():
     - graceful: docker compose restart with health-poll
8. mark_success():
     - write CURRENT_DEPLOY and LAST_GOOD_DEPLOY
     - prune /opt/nyayavigya/releases to NYV_DEPLOY_KEEP (default 5)
9. release lock.
```

If any step fails after `swap()`, the script auto-rolls back to the previous
release directory and restores the previous symlink before exiting non-zero.

## What `pnpm deploy:promote` does

Re-tags an already-built ECR image (`staging` or any specific
`staging-<sha>` tag) as `prod` + `latest` + a fresh `prod-<UTC>` immutable tag,
then performs a true zero-downtime rolling restart on EC2: gateway-b first,
wait for `/health`, then gateway-a. Console + ecosystem app containers are
left untouched.

This is the recommended path once the staging environment is up and running.

## What `pnpm deploy:rollback` does

Calls `deploy-replit-direct.sh --rollback`. That script:

1. Reads `LAST_GOOD_DEPLOY`.
2. Re-points the symlink at `releases/<previous>`.
3. Restarts the gateway containers.
4. Polls `/health`.

If the previous release is also broken, repeat — `LAST_GOOD_DEPLOY` is updated
on every successful deploy, so each invocation walks back one step.

## Required env (one-time setup)

| Variable | Where set | Default |
|---|---|---|
| `NYV_DEPLOY_HOST` | Replit Secrets | `13.232.165.242` |
| `NYV_DEPLOY_USER` | Replit Secrets | `ubuntu` |
| `NYV_DEPLOY_SSH_KEY` | committed (chmod 600) | `.local/keys/nysdev.pem` |
| `NYV_DEPLOY_REMOTE_DIR` | optional override | `/opt/nyayavigya/repo/nyayavigya-platform-312` |
| `NYV_DEPLOY_COMPOSE` | optional override | `docker-compose.ecosystem.yml` |

Once the dedicated `deploy@` IAM user exists, swap `nysdev.pem` for
`.local/keys/nyv_to_ec2` and rotate the EC2 authorized_keys.

## Migration from Bitbucket

The Bitbucket pipeline was retired on 2026-04-24. The archived `bitbucket-pipelines.yml`
remains under `archive/2026-04-cleanup/bitbucket/` for audit only — do not
re-enable it; Replit and Bitbucket would race on the same EC2 host.

If you ever need to add a second CI/CD origin (e.g. GitHub Actions for a
nightly build), give it its own EC2 host or use the "promote-only" pattern:
build the image in CI, push to ECR, then run `promote-staging-to-prod.sh`
from Replit so there is still exactly one writer to the prod EC2 host.
