# Platform Admin Ops SOP — NYV + NYS (2026-09-16)

> **Audience:** Platform operators, super-admins, Cursor agents.  
> **Secrets rule (NV-SECRETS-001):** Key **names** and paths only — never values in docs or chat.  
> **Cross-ref:** [`PLATFORM-OPS-SOP-NYV-NYS-2026-09.md`](./PLATFORM-OPS-SOP-NYV-NYS-2026-09.md) (deploy, logs, probes).

---

## 1. NYV admin user levels (Console RBAC)

**Canonical model:** `nyayavigya-platform-312/src/services/rbac/rbac-service.ts`  
**Client hierarchy:** `client/src/lib/rbac-registry.ts` (`ROLE_HIERARCHY`)

| Role | Tier | Scope | Typical home |
|------|------|-------|--------------|
| `super_admin` | 2 (global) | Full platform — agents, models, LLM creds, all orgs | `/console/superadmin/overview` |
| `admin` | 2 (global) | Near-super_admin; Command Centre | `/console/superadmin/overview` |
| `platform_admin` | 1 (platform-scoped) | ONE platform's orgs, users, SDK keys, rate limits | Platform-scoped admin (increment-1) |
| `enterprise_admin` | Org ecosystem | Multi-org enterprise admin | `/enterprise/admin` |
| `org_admin` | Single org | Org users, cases, billing | `/org-admin` |
| `manager` | Team | Cases, documents, orchestration execute | Role home via `nv-role-home.ts` |
| `operator` | Day-to-day | Cases, documents, agents read/execute | — |
| `analyst` | Read/analytics | Read-only cases, audit logs | — |
| `developer` | Integration | API keys, SDK, orchestration | `/sdk-hub` |
| `user` | End user | Own cases/documents only | Legal Chat / matter UI |
| `sme` | Isolated | GRPO rubric only — **no** `/console/*` access | `/sme` shell |

**Login paths:**

- Console (admin): `https://console.nyayasiddhi.online/console/login`
- LegalChat (SME/end-user): `/legalchat/login` — redirects `super_admin` to Console

**Verify RBAC:** Console → `/rbac-console` (minRole `manager`) → `GET /api/nv/rbac/roles` lists all roles including `platform_admin`.

---

## 2. NYS admin levels (caselaw worker)

**Separate product** — `NYS-Agentic-AI/` on `nyv-caselaw-worker` (`i-000115b19219bb766`).

| Level | Mechanism | Notes |
|-------|-----------|-------|
| **Superadmin session** | HMAC cookie via `/api/auth/login` | `AUTH_REQUIRED=1` on worker; creds in `/opt/nyv/api/.env` as `SUPERADMIN_USERNAME` / `SUPERADMIN_PASSWORD` (names only — values on host) |
| **Dev passthrough** | No auth when `AUTH_REQUIRED=0` | Replit/local only |
| **Machine auth** | `X-API-Key` via `NYS_SDK_API_KEYS` | NYV gateway federation uses `NYS_KNOWLEDGE_API_KEY` — never forwards partner NYV keys |

**Dashboard:** `https://nyayasearch.nyayasiddhi.online` — usage analytics, templates (nyvapp DB), OpenAPI spec behind superadmin session.

---

## 3. RDS — connection env names & roles

| Env var | Host | Role |
|---------|------|------|
| `NYV_DATABASE_URL` | nysdev gateway | Primary app DB (read/write via app pool + RLS) |
| `DATABASE_URL` | Alias | Drizzle/legacy alias of `NYV_DATABASE_URL` |
| `NYV_DATABASE_URL_ADMIN` | Scripts only | Admin DDL/migrations — **never** in gateway runtime |
| `DATABASE_URL` (NYS worker) | nyv-caselaw-worker | Caselaw corpus + embed tables |
| NYS `nyvapp` role | Same RDS instance | Separate DB for NYS dashboard `legal_tasks` / `runs` |

**Instance:** `nyv-dev-edge-pg` (PostgreSQL 16.6, ap-south-1).

**Read-only patterns:** Analytics/reporting should use read replicas or scoped DB users — app runtime uses the primary URL with RLS (`app.current_org_id`). No `case_api_ro` role name in current NYV tree; NYS case-api uses `NYS_CASE_API_KEY` + HTTP API, not direct partner RDS access.

**Verify from Console:** Super-Admin Overview → platform health widgets; DB errors surface in gateway logs (`docker logs nyv-gateway` on nysdev).

---

## 4. RAG / knowledge plane

| Env var | Purpose |
|---------|---------|
| `NYV_F_NYS_KNOWLEDGE_PLANE=1` | Enable NYV → NYS federation |
| `NYS_KNOWLEDGE_BASE_URL` | e.g. `https://nyayasearch.nyayasiddhi.online/api` |
| `NYS_KNOWLEDGE_API_KEY` | Machine key (must match worker `NYS_SDK_API_KEYS`) |
| `NYV_F_CASE_API_CNR=1` | CNR resolve via case-api |
| `NYS_CASE_API_BASE_URL` | Case-api HTTP base |
| `NYS_CASE_API_KEY` | AWS SM `nyaya/case_api/http-api-keys` (name only) |

**NYV knowledge routes:** `/api/nv/knowledge/*` — `dualSdkOrJwt` (partner `X-API-Key` or JWT).

**Verify from Console / API tester:**

- Console → `/sdk-hub?tab=testing` — preset **CNR Resolve**, **Legal Feed**
- `GET /api/nv/knowledge/caselaw/search?q=...&mode=hybrid`
- Orchestrate: `taskType: statute-research` / `caselaw-research`

---

## 5. S3 buckets (names from env examples — no credentials)

| Env var | Example bucket | Use |
|---------|----------------|-----|
| `AWS_S3_BUCKET` | `nyayavigya-prod-documents` | NYV document storage |
| `NYV_DEPLOY_BUCKET` | Deploy tarball staging (SSM deploy) | Release artifacts |
| `ATHENA_OUTPUT_S3` (NYS) | `s3://usa-caselaw/athena/results/` | Athena query results |
| SC parquet (NYS) | `s3://indian-supreme-court-judgments/metadata/parquet/` | External table source |

**Region:** `AWS_REGION=ap-south-1` (NYV), `ATHENA_REGION=ap-south-1` (NYS).

---

## 6. Athena tier (CNR resolve)

Documented in [`CNR-NYS-ATHENA-OPTIMIZATION-2026-09-02.md`](./CNR-NYS-ATHENA-OPTIMIZATION-2026-09-02.md):

- **Default profile:** RDS → case_details → FTS (≤8s wall); skips Athena on default.
- **`options.profile=caseCreate`:** Enables Athena parquet tier when RDS misses (RJHC probes).
- **Budget:** `NYS_ATHENA_QUERY_BUDGET_MS` (default 12000ms per query).
- **Glue DB:** `nyv_docs`; workgroup `nyv-docs`.

NYV gateway: `POST /api/nv/v1/sdk/cnr/resolve` proxies to NYS cascade.

---

## 7. Security keys — names + storage (no values)

| Key / secret name | Storage |
|-------------------|---------|
| `NYV_SDK_KEY_{NSP,NSPM,NSI,NSA,NSM,NYM,JRX}` | EC2 `/opt/Nyayavigya/secrets/.env.production` + Postgres `sdk_app_api_keys` |
| `JWT_SECRET` / session signing | EC2 canonical env |
| `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `SARVAM_API_KEY` | EC2 canonical env |
| `NYV_REDIS_TCP_URL` | EC2 canonical env |
| `NYS_KNOWLEDGE_API_KEY` | EC2 canonical env (NYV) + NYS worker env |
| `NYS_CASE_API_KEY` | AWS Secrets Manager `nyaya/case_api/http-api-keys` |
| `NYS_SDK_API_KEYS` | NYS worker `/opt/nyv/api/.env` |
| `SUPERADMIN_USERNAME` / `SUPERADMIN_PASSWORD` | NYS worker env |
| `SESSION_SECRET` | NYS worker env |
| `MCP_TOKEN` | NYS worker env |
| Deploy creds | `product Documents/env.production` (SSM only) |

**SSM:** Deploy uses `NYV_EC2_INSTANCE_ID` + SSM send-command — not for SDK key fetch during demo.

---

## 8. Dashboard creation flows

### NYV Console admin

| Task | UI route | Min role |
|------|----------|----------|
| Super-Admin Command Centre | `/console/superadmin/overview` | `super_admin` |
| Platform registry | `/console/superadmin/platform-registry` | `super_admin` |
| Agent registry | `/console/agent-registry` | `manager`+ |
| SDK key management | `/sdk-hub?tab=keys` | `developer`+ (generate: admin/platform_admin) |
| SDK onboarding new app | `/sdk-hub?tab=onboarding` | `developer`+ |
| RBAC console | `/rbac-console` | `manager`+ |
| User management | `/enterprise/admin` or org admin dashboards | `enterprise_admin` / `org_admin` |
| Compliance / API keys audit | `/console/superadmin/compliance` | `super_admin` |

### NYS dashboard

| Task | Path |
|------|------|
| Login | `/` → AuthGate → superadmin login |
| Usage analytics | Dashboard home (post-login) |
| Templates | Seeded via `setup-appdb.ts` + `seed-templates.mjs` |
| OpenAPI | `/api/openapi.json` (superadmin session) |

---

## 9. Verify user management, RDS, RAG from admin UI

| Check | How |
|-------|-----|
| **Users** | Console → Enterprise Admin → Users list; or `/rbac-console` access-check dropdown |
| **RDS health** | Super-Admin Overview metrics; gateway `/api/nv/health` (200); no 5xx on Console load |
| **RAG / caselaw** | SDK Hub → Testing tab → caselaw search preset; or orchestrate `caselaw-research` with `enableRAG: true` |
| **CNR / diary** | SDK Hub → CNR Resolve preset; `npm run demo:probe:ec2` |
| **SDK keys** | SDK Hub → Keys tab → status shows active key count (no raw values) |

**Workstation probes (authoritative for partners):**

```bash
cd nyayavigya-platform-312
source scripts/nv-source-dev-deploy-env.sh
npm run demo:probe:ec2
npm run partner:smoke:ec2
bash scripts/nv-nsp-task-diary-probe-ec2.sh
```

---

## 10. Related docs

- [`PLATFORM-OPS-SOP-NYV-NYS-2026-09.md`](./PLATFORM-OPS-SOP-NYV-NYS-2026-09.md)
- [`NSP-JRX-API-KEY-OPS-SOP-2026-09-16.md`](./NSP-JRX-API-KEY-OPS-SOP-2026-09-16.md)
- [`DUAL-PROJECT-OPS-NYV-NYS-2026-07.md`](./DUAL-PROJECT-OPS-NYV-NYS-2026-07.md)
- [`NYAYAVIGYA-TWO-TIER-ADMIN-DESIGN-2026-06.md`](./NYAYAVIGYA-TWO-TIER-ADMIN-DESIGN-2026-06.md)
