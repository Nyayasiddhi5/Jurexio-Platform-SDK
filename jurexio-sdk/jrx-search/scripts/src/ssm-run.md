# ssm-run helper

`scripts/ssm-run.mjs` runs a shell command on the EC2 caselaw worker (`i-000115b19219bb766`, ap-south-1) via SSM RunCommand and polls for output.

Usage: `cd scripts && node ssm-run.mjs '<shell command>' [timeoutSeconds]`

Common operations:
- Ingest progress: `node ssm-run.mjs 'tail -5 /opt/nyv/ingest.log'`
- Ingest (re)start: `node ssm-run.mjs 'cd /opt/nyv && nohup env NODE_ENV=production node ingest-rds.js all 1950 2026 > ingest.log 2>&1 & echo started'`
- API status: `node ssm-run.mjs 'systemctl is-active nyv-api && curl -s localhost:8080/api/caselaw/stats'`
- API deploy (preferred, atomic + md5-verified): `node upload-deploy.mjs --deploy` — uploads content-addressed releases + manifest, then downloads the hashed key on the worker, verifies md5, atomically swaps `/opt/nyv/api/index.mjs`, restarts nyv-api, and health-checks. Fails loudly on mismatch (never silently overwritten by another release).

Gotchas: no heredocs inside SSM commands (use printf); `--quiet` not `-q` for aws cli; NODE_ENV=production required for bundled node scripts (pino-pretty).

Deploy uploads: `cd scripts && node upload-deploy.mjs` uploads `artifacts/api-server/dist/{index,embed-corpus,ingest-rds,audit-coverage}.mjs` as content-addressed keys (`caselaw-worker/api/releases/<name>-<md5>.mjs`) plus `caselaw-worker/api/manifest.json` (per-file md5; merged with the existing remote manifest so partial uploads never drop entries), then read-back-verifies the manifest. Build first (`node build.mjs` in api-server).

Flags (composable):
- `--deploy` — atomic API deploy (SSM download hashed key → md5 verify → mv `/opt/nyv/api/index.mjs` → restart nyv-api → health check; exits 1 on any failure). If combined with `--frontend`, also deploys the frontend.
- `--frontend[=path]` — upload the frontend static tarball (default `/tmp/public.tgz`; build with Vite then `cd dist/public && tar czf /tmp/public.tgz .`) content-addressed as `public.tgz` in the manifest. With `--deploy`: verified download → extract to staging dir → sanity-check `index.html` → atomic swap of `/opt/nyv/api/public` (old kept at `public.old`).
- `--scripts` — install worker script copies (`/opt/nyv/api/{ingest-rds,embed-corpus,audit-coverage}.mjs`) from the manifest's hashed keys with md5 verification. Never copy the mutable `caselaw-worker/api/*.mjs` keys manually.
- `--no-api` — skip the API bundle upload (e.g. frontend-only release, or `--no-api --scripts` to (re)install scripts from the current manifest without uploading).

Every download is md5-verified against the manifest before install; any mismatch fails loudly (exit 1) — nothing unverified is ever installed.
