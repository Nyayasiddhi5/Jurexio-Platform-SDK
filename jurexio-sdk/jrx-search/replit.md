# NYS Agentic AI

An AI legal agent that performs real New York State legal work — drafting, analysis, review, and research — drawn from a professional legal-work benchmark (Harvey's Legal Agent Benchmark), then grades its own output against each task's professional rubric using an AI judge.

## User preferences

- **Living docs (always keep updated):** `docs/NYS-Knowledgesearch-Product-Note.md` (feature status), `docs/CHANGELOG.md` (every merged task/change), `docs/PROJECT-TRACKER.md` (execution plan, use cases, architecture, components, testing/UAT). Update all three whenever features land.
- **EC2 ship gate:** every feature must pass the end-to-end testing/UAT checklist in `docs/PROJECT-TRACKER.md` §4 (typecheck, unit/regression suites, API curl e2e, UI e2e, UAT, prod smoke) before shipping to production.
- **Brand:** always follow the Nyayasiddhi brand guidelines.
- **AI provider policy:** prefer Claude; when Claude is unavailable, use the available Bedrock models (Nova Pro generation, Titan v2 embeddings) for all LLM tasks — never fail solely because Claude is unreachable.
- **Ecosystem:** this platform is the legal-intelligence layer of the Nyayavigya Platform / Agentic AI SDK — all NYV orchestration, agents, RAG, memory, and CoT use it for legal tasks in every jurisdiction (US + India first); it shares NYV infrastructure and will adopt the NYV dashboard once developed. Keep this architecture in mind for all design decisions.
- **Quality bar:** global-standards, scalable architecture/code (10K users at initial production launch → 1M later, with proper testing per PROJECT-TRACKER §6.2); RAG and search must use current global-best algorithms (hybrid FTS+vector, RRF, reranking) aiming to beat Harvey and other global legal AI providers; performance tasks to be planned after all roadmap features reach 100%.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server
- `pnpm --filter @workspace/api-server run seed` — seed the DB with curated benchmark tasks (idempotent; clears + reloads `data/seed-tasks.json`)
- `pnpm --filter @workspace/api-server run seed:caselaw [startYear] [endYear]` — seed real Indian SC judgment metadata from the AWS Open Data parquet bucket (default 2015–2025; idempotent per year range; creates the FTS GIN index)
- `pnpm --filter @workspace/api-server run seed:templates` — seed the template library (70 templates/checklists, IN 47 + US 23, 17 categories; delete-all-then-insert from `data/seed-templates.json`)
- `pnpm --filter @workspace/api-server run seed:statutes` — seed the core statutes corpus (full BNS 358 + BNSS 531 + BSA 170 + official IPC→BNS mapping (521 IPC rows) + full CrPC 1973 (510 rows) + Indian Evidence Act 1872 (181 rows, both with official BNSS/BSA mappings) + 8 USC provisions = 2,279 rows; NCRB Sankalan + devgan.in bare acts; idempotent)
- `pnpm --filter @workspace/api-server run seed:constitution` — seed the Constitution of India (COI, 477 rows: 395 articles incl. lettered inserts + 12 schedules + preamble; idempotent)
- `pnpm --filter @workspace/api-server run ingest:indiacode` — ingest all central Acts from indiacode.nic.in (~846 acts; resumable via `statute_ingest_progress` table, `--retry-failed` baked in; browser UA + degraded-page health probe + circuit breaker; full corpus = 37,107 rows across 832 act codes); `ingest:indiacode-pdf` ingests the 19 PDF-only acts (Income-tax 1961, Wealth-tax 1957, Gift-tax 1958 + 16 pre-1900 acts; unpdf extract + OCR fallback, arrangement/body-scan parser, full-act row for unstructured old acts) — total corpus 38,138 rows / 851 act codes
- `pnpm --filter @workspace/api-server run embed:statutes` — batch-embed the statutes corpus into `statutes.embedding vector(1024)` (resumable keyset by id; self-provisions pgvector column; HNSW + ANALYZE on completion; Titan v2 when `AI_PROVIDER=bedrock`, hash-embed in dev)
- `pnpm --filter @workspace/api-server run ingest:indiacode:refresh` — delta refresh: ingest only acts new to `statute_ingest_progress` (+ previously failed); stamps `statutes.updated_at`; logs the exact prod-sync command on completion (monthly cadence)
- `pnpm --filter @workspace/api-server run export:statutes-delta -- --since <ISO>` then `cd scripts && node sync-statutes-delta.mjs /tmp/statutes-delta.jsonl` — one-command prod delta sync (JSONL export → content-addressed S3 → md5-verified SSM run of the loader on the worker)
- `pnpm --filter @workspace/api-server run embed:corpus` — batch-embed the caselaw corpus into `embedding vector(1024)` (resumable; Bedrock Titan v2 when `AI_PROVIDER=bedrock`, deterministic hash-embed in dev; creates HNSW index)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL`, `AI_INTEGRATIONS_ANTHROPIC_BASE_URL`, `AI_INTEGRATIONS_ANTHROPIC_API_KEY`

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React + Vite + wouter (artifact `nys-agentic-ai`, previewPath `/`)
- API: Express 5 (artifact `api-server`, mounted at `/api`)
- DB: PostgreSQL + Drizzle ORM
- AI: Anthropic (claude-sonnet-4-6) via Replit AI integration proxy in dev; AWS Bedrock (Converse API, `AI_PROVIDER=bedrock`, model via `ANTHROPIC_MODEL`, currently Nova Pro) in production on EC2
- Validation: Zod, `drizzle-zod`; API codegen: Orval (from OpenAPI spec)

## Where things live

- API contract (source of truth): `lib/api-spec/openapi.yaml` → generates hooks (`lib/api-client-react`) and Zod (`lib/api-zod`)
- DB schema: `lib/db/src/schema/{legalTasks,runs}.ts`
- Agent logic (perform work + AI grading): `artifacts/api-server/src/lib/agent.ts`
- Category slug → display name: `artifacts/api-server/src/lib/categories.ts`
- Routes: `artifacts/api-server/src/routes/{catalog,runs,dashboard}.ts`
- Seed data: `artifacts/api-server/data/seed-tasks.json` (144 curated tasks, 24 practice areas)
- Caselaw plane: `lib/db/src/schema/caselaw.ts` (corpus table), `artifacts/api-server/src/lib/caselaw.ts` (IN Postgres FTS + live US CourtListener v4 proxy + authority retrieval), routes in `artifacts/api-server/src/routes/caselaw.ts`, seeder `artifacts/api-server/src/seed-caselaw.ts`
- Typed SDK: `lib/nyv-sdk` (`@workspace/nyv-sdk`) — `NyayavigyaClient` with `caselaw`, `statutes`, `retrieval`, and `agenticWork` modules
- Statutes corpus (India): 38,138 rows / 851 act codes in dev + prod — COI 477 (seeder `src/seed-constitution.ts`, data `data/seed-constitution.json`) + core codes (BNS/BNSS/BSA/IPC/CrPC/IEA/USC via `seed:statutes`) + ~824 central Acts ingested from indiacode.nic.in (`src/ingest-india-code.ts`, resumable via `statute_ingest_progress`) + 19 PDF-only acts via `src/ingest-india-code-pdf.ts` (parser `src/lib/pdfActParser.ts`, shared helpers `src/lib/indiaCode.ts`); act metadata columns (`act_name,act_year,act_no,ministry,department,practice_area,provision_type,enactment_date,source_act_id`) on `statutes`; act-level browse `GET /statutes/acts`; prod loader `src/load-statutes-appdb.ts` (JSONL via S3+SSM — export JSONL with a Node pg script, never `psql \copy` which mangles escapes)
- Retrieval plane: `artifacts/api-server/src/lib/{citations,embeddings,similarCases,statutes,retrievalRouter}.ts`; routes `src/routes/{statutes,retrieval}.ts` + `GET /caselaw/documents/:id/similar`; statutes schema `lib/db/src/schema/statutes.ts`; seed `data/seed-statutes.json`; UI pages `Statutes.tsx`, `IpcBnsCompare.tsx` (Old→New comparator: IPC→BNS via `/statutes/compare/ipc-bns`, CrPC→BNSS + IEA→BSA reverse lookup via `/statutes/compare/old-new`) (+ similar-cases expander on CaselawSearch)
- Caselaw UI: `artifacts/nys-agentic-ai/src/pages/{CaselawSearch,CitationCheck}.tsx`; RunDetail shows grounding authorities
- Frontend pages: `artifacts/nys-agentic-ai/src/pages/`

## Architecture decisions

- `POST /runs` is synchronous — the agent generates the full work product in-request (20-90s). The frontend shows an "agent working" state and navigates to the run on completion.
- Evaluation is a separate step (`POST /runs/{id}/evaluate`): an AI judge grades output per-criterion (pass/fail + rationale); score = passCount/totalCount × 100.
- `legal_tasks.criteria` is copied onto each `run` at creation time, so grading is stable even if the task catalog changes later.
- **Jurisdiction segregation (Task #73)**: `legal_tasks.jurisdiction` (`IN`/`US`/`GLOBAL`, default GLOBAL; seed tagged 54 US + 90 GLOBAL) and nullable `runs.jurisdiction`. Additive `jurisdiction` query param on `/tasks`, `/categories`, `/dashboard/summary` — task rule = selected jurisdiction + GLOBAL; dashboard run stats exact-match (legacy null runs excluded from scoped views); unknown values → 400. Frontend surfaces all follow the sidebar selector; reserved jurisdictions (GCC/UK/EU/SG) render coming-soon cards with zero fetches; Archive Search and the Old↔New comparator are IN-only. Prod `setup-appdb.ts` carries the DDL (idempotent ALTERs) — prod deploy still pending.
- The agent never fabricates pinpoint case/statute citations (prompt-enforced); it reasons about referenced data-room documents by type since their contents aren't attached.
- Agent grounding: before drafting, `POST /runs` retrieves up to 5 real authorities (live CourtListener search) and passes them to the prompt as citable verified cases; they're stored on `runs.authorities`. Grounding failure logs a warning and proceeds (never blocks a run).
- Retrieval-first router (`POST /retrieve`): deterministic answer planner — citation extraction (regex, no LLM) → statute/section lookup → IPC↔BNS comparison → caselaw FTS; only flags `llmRequired` for generative asks. `POST /runs` uses it to ground drafts with real statute text (failure logs a warning, never blocks). Every routing decision is logged.
- Similar cases: pgvector cosine KNN over `judgments.embedding` (1024-dim) when embedded; explicit FTS fallback otherwise (`method` field says which). Dev embeddings are deterministic hash vectors; production uses Bedrock Titan v2.
- Statute search is hybrid (Task #95): FTS + pgvector cosine KNN fused via RRF (k=60) with a provider-aware distance cutoff (0.8 Titan / 0.5 dev hash — the hash embedder's md5 collisions make unrelated rows look ~0.45 similar); response `method` = `hybrid_rrf` | `fts`; vector failure or unembedded corpus degrades to labeled FTS, never blocks. Prod embedder runs detached on the worker (`/opt/nyv/embed-statutes.log`).
- Caselaw search: IN = local corpus via Postgres FTS (`websearch_to_tsquery` + `ts_rank` over the same expression as the `caselaw_fts_idx` GIN index); US = live CourtListener v4 (optional `COURTLISTENER_API_TOKEN`); upstream failure returns an explicit 502 — no silent fallback.
- **Production domain**: `https://nyayasearch.nyayasiddhi.online` serves the dashboard (static build of `nys-agentic-ai`, `STATIC_DIR`) + `/api` from the EC2 worker via the shared edge ALB (`nyv-dev-edge-alb`, host rule priority 160, TG `nyv-search-tg`:8080, wildcard ACM cert + Route53 alias in zone nyayasiddhi.online — same namespace pattern as console.nyayasiddhi.online).
- **Superadmin auth**: production only (`AUTH_REQUIRED=1`); HMAC session cookie (SESSION_SECRET), creds in worker `.env` (`SUPERADMIN_USERNAME/PASSWORD`); `/api/auth/{login,logout,me}`; dev has no auth (passthrough). Frontend `AuthGate` gates the app on `/api/auth/me`.
- **AWS caselaw plane (production)**: full IN corpus (SC 1950–2025 + all 25 High Courts 1950–2026) lives in AWS RDS Postgres `nyv-caselaw-pg` (ap-south-1, private, pgvector + pg_trgm, `judgments` table with weighted generated tsvector). The API runs on EC2 `nyv-caselaw-worker` (i-000115b19219bb766) at `http://13.233.102.83:8080/api` as systemd service `nyv-api` with `CASELAW_BACKEND=rds`. RDS is reachable ONLY from the worker SG; Replit dev uses the local 43k SC corpus (`CASELAW_BACKEND` unset). RDS creds come from the RDS-managed Secrets Manager secret at runtime (`src/lib/rdsPool.ts`) — no password stored anywhere.
- **Production app DB**: `legal_tasks`/`runs` live in a separate `nyvapp` database on the same RDS instance (role `nyvapp`, password only in worker `.env` DATABASE_URL, verify-full TLS). Provisioned + seeded by `src/setup-appdb.ts` (bundled, run on worker; idempotent). Dev uses the Replit Postgres via DATABASE_URL as before.
- **Production AI**: Replit AI proxy is dev-only (localhost:1106, unreachable from EC2). The integrations lib switches to a Bedrock Converse shim when `AI_PROVIDER=bedrock` (region `BEDROCK_REGION`, IAM role `nyv-caselaw-worker-role` has `nyv-bedrock-invoke` inline policy). Claude models on Bedrock are blocked until the account's Anthropic use-case form is submitted; production runs on `us.amazon.nova-pro-v1:0` until then — switch `ANTHROPIC_MODEL` to `us.anthropic.claude-sonnet-4-5-20250929-v1:0` after approval.
- **Production platform features (deployed)**: MCP server (`/api/mcp`, Bearer `MCP_TOKEN` from worker `.env`, mounts before cookie authGuard), `/api/openapi.json` (behind superadmin session; spec at `/opt/nyv/api/openapi.yaml` via `OPENAPI_SPEC_PATH`), templates + api_usage tables in nyvapp (DDL in `setup-appdb.ts`, templates seeded via bundled `seed-templates.mjs` reading `/opt/nyv/data/seed-templates.json`), usage analytics dashboard. Frontend static: build `nys-agentic-ai` with `PORT=<any> BASE_PATH=/`, tar the **`dist/public/`** contents (`tar czf /tmp/public.tgz .`), then ship via `upload-deploy.mjs --frontend --deploy --no-api` (content-addressed `public-<md5>.tgz` in the manifest, md5-verified download, staged extract + index.html sanity check, atomic swap of `/opt/nyv/api/public`). New `@aws-sdk/*` imports (e.g. client-athena) must be npm-installed in `/opt/nyv/api` after redeploy. Worker `.env` values are unquoted — never shell-source it (DATABASE_URL contains `&`); grep keys out instead.
- **Ingestion**: `src/ingest-rds.ts` (bundled via esbuild, run on the worker: `/opt/nyv/ingest.log`) streams public AWS Open Data parquet (SC + HC + district AP/TG only, state codes 2/29 from `indian-district-court-judgments`) into RDS; resumable via `ingest_progress` table; dedupe via md5 hash unique index. Modes: `sc|hc|dc|all|delta|delta-sc|delta-hc|delta-dc`. Daily freshness: `nys-cnr-index-sync.mjs` → `ingest-rds delta`. Manage via SSM RunCommand (AWS creds in vault). Redeploy API: `node build.mjs` → `cd scripts && node upload-deploy.mjs --deploy` (content-addressed keys `releases/<name>-<md5>.mjs` + manifest.json, worker downloads hashed key, md5-verifies, atomic mv, restarts nyv-api, health-checks; fails loudly on mismatch — never blindly copy the mutable `api/index.mjs` key). Worker script copies (`/opt/nyv/api/{ingest-rds,embed-corpus,audit-coverage}.mjs`): `upload-deploy.mjs --scripts` installs them from the manifest's hashed keys with md5 verification (`--no-api --scripts` reuses the current manifest). AWS-SDK packages are esbuild externals — they're npm-installed in `/opt/nyv/api` on the worker.
- Full-PDF sources (owned buckets): `your-supreme-court-data-bucket` (SC PDFs under `data/tar/year=YYYY/english|regional/`, us-east-1), `ns-highcourt-data-bucket` / `ns-indian-highcourt-judgements-2` (HC PDFs), `usa-caselaw` (Harvard CAP + CourtListener bulk, ap-south-1).
- **Athena document search (production, live)**: Glue DB `nyv_docs` (ap-south-1) with `sc_meta_src` (external table over public `s3://indian-supreme-court-judgments/metadata/parquet/`) and `judgments_meta` (43.5k rows, CTAS parquet at `s3://usa-caselaw/athena/judgments_meta/`, `s3_path` points at owned SC PDF keys). Worker env: `ATHENA_DATABASE=nyv_docs`, `ATHENA_TABLE=judgments_meta`, `ATHENA_OUTPUT_S3=s3://usa-caselaw/athena/results/`, `ATHENA_REGION=ap-south-1`, `ATHENA_WORKGROUP=nyv-docs`. Queries run in the dedicated `nyv-docs` workgroup (enforced `BytesScannedCutoffPerQuery` 5 GB + enforced result location, so AWS kills runaway scans server-side); S3 lifecycle rule `expire-athena-results` expires `athena/results/` objects after 7 days. Worker role has inline policy `nyv-athena-query` (Athena/Glue read + usa-caselaw rw). `@aws-sdk/client-athena` must be npm-installed in `/opt/nyv/api` (esbuild external). Rebuild the table with `scripts/athena-run.mjs` helpers. Endpoints: `GET /api/athena/status`, `POST /api/athena/search` (`archive: sc|hc|all`), `GET /api/athena/document` (presigned 5-min PDF URL, owned-bucket allowlist; needs `@aws-sdk/s3-request-presigner` npm-installed in `/opt/nyv/api`), `POST /api/athena/extract` (PDF→text, 25 MB cap, OCR fallback, cached in `archive_extracts`) — auth-gated in prod. Frontend Archive Search page at `/archive`. HC estate: `judgments_meta_hc` (20.4M rows, all 25 HCs, CTAS parquet at `s3://usa-caselaw/athena/judgments_meta_hc/`; `s3_path` targets `ns-highcourt-data-bucket` with automatic sibling fallback to `ns-indian-highcourt-judgements-2` at HeadObject time); worker env `ATHENA_TABLE_HC=judgments_meta_hc`. Archive docs feed chat (`from-archive` attach) and runs (`archiveReferences` on `/runs/stream`). US buckets not yet in a table.

## Product

Attorneys browse a benchmark task library (filter by practice area, work type, search), open a task to see its instructions/deliverables/rubric, then run the AI agent (from a task or a fully custom instruction). The agent produces a formatted work product; the user can grade it against the rubric and review activity on a dashboard.

## Gotchas

- Do not change the OpenAPI `info.title` — it controls generated filenames.
- After editing `lib/api-spec/openapi.yaml`, run codegen before typechecking dependents.
- Anthropic calls omit temperature/top_p/top_k (integration proxy default).
- Never use `console.log` in server code — use `req.log` / `logger`.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
