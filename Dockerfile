FROM node:22-alpine AS base
WORKDIR /app
RUN apk add --no-cache python3 make g++ bash git aws-cli && corepack enable

FROM base AS deps
COPY package.json package-lock.json ./
# file:packages/* symlinks need package roots present at install time.
COPY packages/docparse/package.json packages/docparse/package-lock.json packages/docparse/
COPY packages/docparse-sdk/package.json packages/docparse-sdk/package-lock.json packages/docparse-sdk/
# Use install (not ci) — lockfile is missing optional platform shims
# (msgpackr-extract native binaries) that npm ci refuses to backfill.
RUN npm install --legacy-peer-deps --no-audit --no-fund

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# .dockerignore strips **/dist — compile workspace packages before gateway boot (tsx imports @nyv/docparse*).
RUN npm run docparse:build && npm run docparse-sdk:build
# Backend (TS → dist/) + frontend (vite → dist/public/) via nv-build-production.sh
RUN npm run build || npx tsc --project tsconfig.json --outDir dist --skipLibCheck

FROM base AS production
ENV NODE_ENV=production
ENV NYV_PLATFORM_VERSION=5.1.0
ENV NYV_SDK_VERSION=5.1.1
WORKDIR /app

COPY package.json package-lock.json ./
# Built dist/ for file: workspace deps (see builder docparse*:build).
COPY --from=builder /app/packages/docparse ./packages/docparse
COPY --from=builder /app/packages/docparse-sdk ./packages/docparse-sdk
# --include=dev is required because NODE_ENV=production above causes npm to
# silently skip devDependencies (we need tsx, which is a devDep, at runtime).
RUN npm install --legacy-peer-deps --include=dev --no-audit --no-fund && npm cache clean --force

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src ./src
COPY --from=builder /app/server ./server
COPY --from=builder /app/shared ./shared
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/k8s ./k8s
# NYV-OPS-DOCKERFILE-CONFIG-001 (2026-04-30): config/agent-registries/*.json
# is required by JurisdictionPromptResolver — startup hard-fails without
# all 7 jurisdiction registries (IN, UK, US, EU, GC, SG, Default). The
# previous image silently ran on stale config baked into the older layer;
# a fresh rebuild now correctly fails fast unless this directory is in
# the production stage.
COPY --from=builder /app/config ./config
# task-365 (2026-05-13): RDS root CA bundle for verify-full TLS to AWS RDS.
# nv-pg-ssl.ts hard-fails at boot if /app/certs/rds-global-bundle.pem is
# missing (unless NYV_PG_SSL_VERIFY=false). The .dockerignore negation
# `!certs/rds-global-bundle.pem` ensures the file survives `COPY . .` in
# the builder; this line carries it into the runtime image.
COPY --from=builder /app/certs ./certs
# NYV-OPENAPI-SHIP-001 (2026-06-03): the generated OpenAPI spec (full ~1.3k path
# set) is read at runtime by nv-openapi-routes/nv-swagger-routes from
# process.cwd()/docs/openapi. Without this the docs surface falls back to the
# 7-path curated stub. Ship only the openapi subdir (not all of docs/).
COPY --from=builder /app/docs/openapi ./docs/openapi

COPY tsconfig.json ./
COPY drizzle.config.ts ./

RUN mkdir -p /app/logs /app/uploads /tmp && chown -R 1001:1001 /app /tmp

USER 1001

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:5000/api/nv/health || exit 1

# Run via tsx (matches dev) — Node's --experimental-strip-types doesn't resolve .js→.ts
#
# NV-HEAP-LIMIT-CONTRADICTION-001 (2026-08-16): the heap size is deliberately NOT
# set here. This CMD previously passed `--max-old-space-size=3584`, and an explicit
# CLI flag OVERRIDES `NODE_OPTIONS`, so the compose file's carefully-reasoned
# `--max-old-space-size=1536` (sized to stay under `mem_limit: 2g`) never applied.
# Verified live: the running process reported 3584 while the cgroup capped the
# container at 2 GB — V8 would happily grow past the limit and be OOM-killed by the
# kernel instead of GCing, which is the opposite of the intent documented in
# docker-compose.aws-dev.yml. Leaving it unset lets NODE_OPTIONS win, so the heap
# ceiling is declared exactly once, next to the container memory limit it must
# respect. If you need a different ceiling, change it in the compose file.
CMD ["node", "--enable-source-maps", "--import", "tsx", "src/index.ts"]
