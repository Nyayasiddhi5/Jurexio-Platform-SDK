# Docker bake — Nyayavigya Gateway v5.0.0-dev

**Status**: BUILD-READY (T-DLR-08)
**Image tag target**: `nyayavigya-platform-312-gateway:v5.0.0-dev`
**Dockerfile**: `Dockerfile` (multi-stage: base → deps → builder → production)

---

## Why this is a doc, not a baked image

The Replit container that hosts this workspace ships the docker CLI (27.5.1)
but no docker daemon — bakes fail with `Cannot connect to the Docker daemon`.
The artefact you are reading is the next best thing: an audited, ready-to-run
build command plus a checklist of the source-tree fixes the resulting image
will carry.

## Bake command (run from any host with a docker daemon)

```bash
cd nyayavigya-platform-312

# Local bake (≈ 4–6 min on M1, 8–10 min on x86)
docker build \
  -f Dockerfile \
  -t nyayavigya-platform-312-gateway:v5.0.0-dev \
  --build-arg NODE_ENV=production \
  .

# Sanity smoke
docker run --rm -p 5000:5000 \
  -e DATABASE_URL="$DATABASE_URL" \
  -e NV_API_KEY="$NV_API_KEY" \
  -e NYV_JWT_SECRET="$NYV_JWT_SECRET" \
  nyayavigya-platform-312-gateway:v5.0.0-dev &
sleep 30
curl -fsS http://localhost:5000/api/nv/health | jq .status
docker kill $(docker ps -q --filter ancestor=nyayavigya-platform-312-gateway:v5.0.0-dev)
```

## Push to ECR (when promoting to EC2 dev)

```bash
ECR_REGISTRY=<account>.dkr.ecr.ap-south-1.amazonaws.com
aws ecr get-login-password --region ap-south-1 \
  | docker login --username AWS --password-stdin $ECR_REGISTRY

docker tag  nyayavigya-platform-312-gateway:v5.0.0-dev \
            $ECR_REGISTRY/nyayavigya-platform-312-gateway:v5.0.0-dev
docker push $ECR_REGISTRY/nyayavigya-platform-312-gateway:v5.0.0-dev
```

`scripts/deploy-replit-direct.sh --use-ecr --ecr-push` performs both steps and
then SSHes into the EC2 dev box to pull + restart the compose stack.

## Source-tree fixes the image will carry (audited as of this commit)

| Fix ID | Path | Verified by |
| ------ | ---- | ----------- |
| NV-NSP-FIX-002 | `src/routes/nv-orchestration-routes.ts` (audit-wire reformat) | `git log --oneline src/routes/nv-orchestration-routes.ts` |
| NV-NSP-FIX-003 | `src/services/nv-grounding-gate.ts` (citation verifier hot-path) | `git log --oneline src/services/nv-grounding-gate.ts` |
| NV-NSP-FIX-005 | `src/services/nv-iron-ledger.ts` (recordHash chain) | `git log --oneline src/services/nv-iron-ledger.ts` |
| NV-NSP-FIX-006 | `examples/nsp-web-quickstart/src/app/api/nyv-proxy/[...path]/route.ts` (strip content-encoding) | this PR |
| T-DLR-12 pages | `client/src/pages/orchestration/{RouterDecisionsPage,LineagePage}.tsx` | `npx vite build` clean |
| T-DLR-02 seeders | `scripts/_pg-pool.ts` + 10 refactored seeders | `npx tsc --noEmit` clean |
| T-DLR-11 reseed | `scripts/nv-reseed-protocol-registry.ts` (102 caps applied) | manual run logs |
| T-DLR-10 doc | `docs/MCP-Reconciliation-v5.0.0.md` | this PR |

Because `Dockerfile` uses `COPY . .` in the `builder` stage, every file under
the workspace tree at bake-time is captured — there is no allow-list to
maintain. `npm run build` runs the same `vite build` that we verified locally
and emits the new orchestration-page chunks (`RouterDecisionsPage-*.js`,
`LineagePage-*.js`).

## Image contents (post-bake expectation)

- `/app/dist/`         — server transpile + `dist/public/` vite assets (incl. new pages)
- `/app/src/`          — TS sources for tsx runtime
- `/app/scripts/`      — refactored seeders + reseed script
- `/app/server/`, `/app/shared/`, `/app/k8s/` — unchanged structural copies
- Entrypoint: `node --import tsx src/index.ts`
- Healthcheck: `wget http://localhost:5000/api/nv/health`

## Operator handoff

If you only have ECR access (no local docker), trigger a CodeBuild project
pointed at this commit and tag the output `v5.0.0-dev`. The Dockerfile is
self-contained — no out-of-tree assets.
