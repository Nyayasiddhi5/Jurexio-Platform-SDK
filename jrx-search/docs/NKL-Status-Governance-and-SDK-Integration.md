# NKL — Feature Status, API Governance & Nyayavigya SDK Integration Plan

**Date:** July 8, 2026
**Live endpoint:** `https://nyayasearch.nyayasiddhi.online` (dashboard + `/api`)

---

## 1. What is LIVE today

### Infrastructure (production, AWS ap-south-1)
| Item | Status |
|---|---|
| RDS Postgres `nyv-caselaw-pg` (private, pgvector + pg_trgm, weighted FTS) | ✅ Live |
| EC2 worker `nyv-caselaw-worker` running `nyv-api` (systemd, auto-restart) | ✅ Live |
| `nyayasearch.nyayasiddhi.online` → edge ALB (host rule @160, TG `nyv-search-tg`) → worker :8080 — same namespace pattern as `console.nyayasiddhi.online` | ✅ Live, HTTPS via wildcard ACM cert |
| Full-corpus ingest (SC 1950–2025 + all HC 1950–2026) | 🔄 Running — **6.77M+ docs loaded** (SC complete; HC in later years); resumable, zero file failures |
| RDS security: not publicly accessible, worker-SG-only, Secrets Manager creds, TLS w/ CA verification, 25s statement timeout | ✅ Done |
| Superadmin auth (session cookie, HMAC-signed, 12h TTL, constant-time compare) protecting all `/api` + dashboard in production | ✅ Live |

### Product features (verified working)
| Feature | IN | US |
|---|---|---|
| Caselaw search (SC + HC court-type filter, year/court filters) | ✅ RDS FTS (5.3M+) | ✅ Live CourtListener v4 |
| Judgment detail (incl. HC metadata: case type, bench, CNR, PDF link) | ✅ | ✅ |
| Citation verification | ✅ vs full RDS corpus | ✅ vs CourtListener |
| Agentic legal work (benchmark library — 144 tasks, 24 practice areas; custom instructions; drafting, analysis, review, research) | ✅ | ✅ |
| Grounded drafting (retrieves up to 5 real authorities pre-draft; stored on run) | ✅ | ✅ |
| AI rubric grading (per-criterion pass/fail judge) | ✅ | ✅ |
| Dashboard, run history, activity stats | ✅ | ✅ |
| Typed SDK `@workspace/nyv-sdk` (`caselaw` + `agenticWork` modules) | ✅ | ✅ |

## 2. Pending / not yet built (vs NKL Product Note roadmap)

| Phase | Item | Priority |
|---|---|---|
| P1 | **API keys + per-key metering/rate limits** (superadmin session ≠ machine auth; blocking external SDK consumption) | 🔴 Next |
| P1 | Versioned `/nkl/v1/*` namespace + frozen published OpenAPI | 🔴 Next |
| P1 | SSE streaming for answer/draft | 🟡 |
| P2 | Citation extraction (Bluebook/SCC/AIR/neutral parsers) + draft grounding verdict | 🔴 High-trust feature |
| P3 | Embeddings + pgvector similarity ("paste facts → similar precedents") — **pgvector column already provisioned in RDS**, needs embedding backfill | 🟡 |
| P3 | Hybrid FTS+vector retrieval for RAG | 🟡 |
| P4 | Statutes corpora: India Code (BNS/BNSS/BSA + acts), US Code; section suggestion; IPC→BNS diff comparator | 🟡 |
| P5 | Templates library + guided fill; filing checklists; format validation | 🟡 |
| P6 | Judge/court analytics, `advise` composite endpoint, proactive suggestions | ⚪ |
| P7 | NYV MCP tool registration + eval harness in CI | 🟡 |
| — | Full-PDF text extraction from owned buckets (SC tars, HC PDFs, `usa-caselaw` CAP/CL bulk) → full-text RAG | 🟡 Large data job |
| — | Upload-a-document research (match against corpus, extract statutes/citations, suggest drafting) | 🟡 Depends on P2/P3 |
| — | Post-ingest: re-run `rds-maintenance.js` (ANALYZE + timings) once ingest completes | 🔴 Quick |

## 3. API governance, security, audit & compliance design

**Auth layers (planned P1):**
1. Human: superadmin session (live today); later multi-user RBAC (admin / analyst / readonly).
2. Machine: `X-NKL-Key` API keys — hashed at rest (SHA-256), per-key scopes (`caselaw.read`, `draft.write`, `admin`), per-key rate limits (token bucket) and monthly quotas, key rotation + revocation endpoints.

**Audit:** append-only `api_audit` table (key id, route, params hash, status, latency, ip) + structured pino logs shipped to CloudWatch; every AI answer/draft stores its retrieved authorities (already done for runs) for provenance.

**Compliance posture:** data is public court records (no PII beyond what courts publish); DPDP-aligned handling for uploaded user documents (encrypt at rest via S3 SSE, retention policy, delete API); AI outputs carry citations + "verify before filing" disclaimer; no verdict-prediction claims (analytics stay descriptive).

**Governance:** OpenAPI is the contract source of truth; versioned `/nkl/v1`; breaking changes only via `/v2`; typed error contract `{ error, kind, provider }` everywhere; benchmark scorecard (P7) published per release.

## 4. Nyayavigya SDK integration architecture (recommended)

```
NSP / Nyayamitra / NYS-INS / NYS-ACE / NYS-MIN
        │ (user requests)
        ▼
Nyayavigya SDK v6 agents ──► @nyayasiddhi/knowledge-sdk (typed client, generated from NKL OpenAPI)
        │                        │  X-NKL-Key (scoped per platform)
        │                        ▼
        │              https://nyayasearch.nyayasiddhi.online/nkl/v1/*
        │                (ALB → EC2 nyv-api → RDS 5M+ corpus / CourtListener live)
        └── MCP tool registration: caselaw.search, caselaw.get, citations.verify,
            draft.generate, answer.rag, insights.judgment, advise.composite
```

- Each NKL endpoint is registered as an **MCP tool** in NYV's tool catalog so any of the 1,042 agents can call it on demand; tool schemas come straight from the OpenAPI spec (no drift).
- Per-platform API keys (NSP, NYM, INS, ACE, MIN) → per-consumer metering, rate limiting, audit trail.
- Error contract and streaming conventions match `/api/nv/*` guardrails; audit-hash of each response for traceability.
- Publish `@nyayasiddhi/knowledge-sdk` (rename/extend current `@workspace/nyv-sdk`) to the internal registry; distribute via the existing `nyv-sdk-distribution` bucket pipeline.

## 5. RDS performance (current numbers)

- ANALYZE run at 5.35M rows: ranked FTS 10–46ms typical; worst-case broad-term + filter query 23s **during heavy ingest I/O** — mitigated by 25s statement timeout; re-measure post-ingest.
- Table 9.2GB + FTS GIN 1.2GB + trigram 850MB on db.r6g.large (16GB RAM) — healthy; final size projected ~12–15GB (fits in page cache for hot paths).
- Post-ingest checklist: `node rds-maintenance.js` (ANALYZE + timing report), verify index usage, consider `work_mem=64MB` in parameter group, gp3 IOPS baseline is sufficient once ingest write load ends.
- Scale path: read replica for search traffic; pgvector HNSW index when embeddings land (P3).

## 6. Operations quick reference

- Redeploy API: `node build.mjs` → upload `dist/index.mjs` to `s3://nyv-sdk-distribution/caselaw-worker/api/` → SSM `systemctl restart nyv-api`
- Ingest monitor: `cd scripts && node ssm-run.mjs 'tail -3 /opt/nyv/ingest.log'`
- Maintenance: `node ssm-run.mjs 'cd /opt/nyv/api && NODE_ENV=production node rds-maintenance.js'`
- Superadmin creds: in worker `/opt/nyv/api/.env` (`SUPERADMIN_USERNAME`/`SUPERADMIN_PASSWORD`); rotate by editing + `systemctl restart nyv-api`

## 7. Platform surface additions (July 2026)

### SSE streaming
- `POST /api/runs/stream` and `POST /api/chat/conversations/:id/messages/stream` emit Server-Sent Events: `status` ({stage}), `delta` ({text}), then `done` (full JSON payload) or `error` ({error}).
- SDK v2 exposes `agenticWork.createRunStream(input)` and `chat.sendMessageStream(id, input)` as async generators of typed `StreamEvent`s.

### SDK v2 modules (`@workspace/nyv-sdk`)
- `caselaw`, `statutes`, `retrieval`, `agenticWork`, `chat` (existing) + new `templates` (list/get) and `intelligence` (`usage`, `advise`).
- Streaming helpers parse SSE natively via fetch — no EventSource dependency; works in Node 18+ and browsers.

### MCP server
- `POST /api/mcp` — minimal JSON-RPC 2.0 endpoint (initialize, tools/list, tools/call) exposing 7 tools: search_caselaw, get_judgment, verify_citation, search_statutes, compare_ipc_bns, retrieve, perform_legal_work.
- Auth: set `MCP_TOKEN` env → clients must send `Authorization: Bearer <token>`. Without `MCP_TOKEN` set (dev), the endpoint is open. Mounted before the superadmin auth guard so MCP clients don't need session cookies.
- Client config example:
  ```json
  { "mcpServers": { "nyayavigya": { "url": "https://nyayasearch.nyayasiddhi.online/api/mcp", "headers": { "Authorization": "Bearer <MCP_TOKEN>" } } } }
  ```

### Analytics & advisory
- Every API request is logged fire-and-forget to `api_usage` (feature, jurisdiction, latency, status). `GET /api/analytics/usage?days=N` aggregates totals/p95, by feature, jurisdiction, day, plus run scores over time; surfaced as dashboard widgets.
- `POST /api/advise` — grounded strategy advisory: runs the retrieval router + live authority search, then returns structured JSON (assessment, keyIssues, strategy, risks, recommendedActions, authorities, statutes, disclaimer).

### Templates & checklists
- `templates` table seeded via `pnpm --filter @workspace/api-server run seed:templates` (10 curated IN/US drafting templates + procedural checklists).
- `GET /api/templates?kind=&jurisdiction=&search=`, `GET /api/templates/:id`. Chat Draft mode accepts `templateId` — the template body is injected as a structural skeleton for the draft.

### API tester & OpenAPI
- `GET /api/openapi.json` serves the spec (parsed from `lib/api-spec/openapi.yaml`).
- Dashboard "API Tester" page: pick an endpoint from the live spec; path/query/body forms are generated from the OpenAPI schemas (required markers, enum selects, typed validation) with a raw-JSON fallback; send, view status/latency/response, copy as cURL.

### Athena (S3 judgment buckets)
- `GET /api/athena/status`, `POST /api/athena/search` (SELECT-only, scan-capped, 45s poll budget; the running query is cancelled via StopQueryExecution on budget/timeout breach). Returns 503 with guidance until `ATHENA_DATABASE`, `ATHENA_TABLE`, and `ATHENA_OUTPUT_S3` are set (plus AWS creds/role). Designed for the owned full-PDF buckets (`your-supreme-court-data-bucket`, `ns-highcourt-data-bucket`, `usa-caselaw`) once Glue tables are defined over them.
