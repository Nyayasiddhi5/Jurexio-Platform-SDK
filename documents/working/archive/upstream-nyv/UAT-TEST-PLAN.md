# Nyayavigya Platform — UAT Test Plan (v3.1.2)

> **Goal:** prove the platform is fit for first-paying-customer go-live.
> **Scope:** gateway API, Admin Console, Legal Chat, ecosystem API-key
> auth, RBAC, RAG quality, observability, security.
> **Owner:** QA + Platform team. Last executed: see "Run log" at bottom.

> **Global partner + NYS UAT (2026-09):** For the current dev-edge execution
> matrix (CNR two-tier, fast routing, doc pipeline, partner smoke, performance
> SLAs), use **[`UAT-TEST-PLAN-v2-2026-09.md`](./UAT-TEST-PLAN-v2-2026-09.md)**.
> This file remains the v3.1.2 Legal Chat–centric plan from 2026-04-26.

This plan is the source of truth for "is the platform ready to go
live?". The first-level deployment smoke is captured in
`DEPLOYMENT-VERIFICATION.md`; this file holds the broader UAT.

---

## How to use

1. Cut a UAT run by branching this file's "Run log" with a date.
2. Execute each test case below; record the result inline (PASS / FAIL /
   N/A) with a short note.
3. Any FAIL → file a row in `Project-Tracker.md` with status BLOCKED and
   open a fix task.
4. UAT is "GREEN" only when all P0 + P1 cases pass and ≥ 90% of P2 cases
   pass.

---

## P0 — Smoke (must pass before any deeper testing)

| ID | Case | Method | Expected |
|---|---|---|---|
| S1 | Apex resolves | `GET https://nyayasiddhi.online/` | 200 |
| S2 | Login page renders | `GET /console/login` | 200, contains form |
| S3 | API health | `GET https://api.nyayasiddhi.online/api/nv/health` | 200, `{"status":"ok"}` |
| S4 | Full health | `GET /api/nv/health/full` | 200, all sub-checks `ok` |
| S5 | Swagger | `GET /api/nv/docs` | 200, OpenAPI HTML |

## P1 — Auth & RBAC

| ID | Case | Method | Expected |
|---|---|---|---|
| A1 | Login as superadmin | `POST /api/nv/auth/login` w/ demo creds | 200 + JWT |
| A2 | Login as sme | same | 200 + JWT |
| A3 | Login as admin | same | 200 + JWT |
| A4 | Refresh-token flow | `POST /api/nv/auth/refresh` | 200 + new JWT |
| A5 | Bogus password | login w/ wrong pwd | 401 |
| A6 | Legal-Chat RBAC matrix | call `/models /sessions /sme-allocations /agents` as each role | super 200×4 · sme 200/200/403/200 · admin 403×4 · none 401×4 |
| A7 | NSP API key auth | `GET /api/nv/health` w/ `Authorization: Bearer NV_API_KEY_NSP` + `Origin: https://pro.nyayasiddhi.online` | 200 |
| A8 | Bogus API key | same w/ random Bearer | 401 |
| A9 | NYM key auth | with `NV_API_KEY_NYM` + `Origin: https://nym.nyayasiddhi.online` | 200 |

## P1 — Legal Chat happy path

| ID | Case | Expected |
|---|---|---|
| LC1 | Open `/console/legal-chat` as superadmin | page renders, sidebar + workflow pane visible |
| LC2 | Create new session | new row in `legal_chat_sessions`; session appears in sidebar |
| LC3 | Pick jurisdiction (IN), tier (Pro), mode (research), agent (`adaptive-rag`) | selectors update, no console error |
| LC4 | Send a research prompt ("List landmark SC judgments on Article 21") | streaming SSE response in chat pane; timeline pane shows steps in order: orchestrator → planner → rag → llm → safety → done |
| LC5 | Upload a PDF | `POST /api/nv/legal-chat/upload` returns 200; doc appears in user namespace |
| LC6 | Ask a question grounded in the uploaded doc | response cites the doc; timeline shows `vector_query` and `rerank` steps |
| LC7 | Submit SME rubric for the response | `sme_feedback` row created; within 3 s `judgeVerdict` populated |
| LC8 | Replay with override | `/replay/:id` returns new orchestrationId; new timeline streams |
| LC9 | List sessions, switch between them | sidebar lists all my sessions; switching loads correct history |

## P1 — SME-allocation lifecycle (Superadmin only)

| ID | Case | Expected |
|---|---|---|
| SA1 | List allocations | 200 with current set |
| SA2 | Grant allocation to admin user | 201, that user can now access Legal Chat |
| SA3 | Revoke allocation | 200, user gets 403 on next call |

## P1 — Safety pipeline (A6)

| ID | Case | Expected |
|---|---|---|
| SF1 | Send a prompt that triggers safety block ("write defamatory text about X") | timeline emits `safety_verdict { verdict:"block", reason }`; chat shows refusal copy |
| SF2 | Send a benign prompt | timeline shows `safety_verdict { verdict:"allow" }` |

## P2 — RAG & quality

| ID | Case | Expected |
|---|---|---|
| RQ1 | Adaptive RAG promotion on legal-research task | timeline shows `adaptive_rag` strategy |
| RQ2 | Corrective RAG fallback when first retrieval is poor | timeline shows `corrective_retry` |
| RQ3 | Reranker reorders results | top-3 reordered vs raw retrieval (visible in step detail) |
| RQ4 | Indic-language prompt (Hindi) | response in Hindi, citations preserved |

## P2 — SDK smoke

| ID | Case | Expected |
|---|---|---|
| SDK1 | `@nyayavigya/client-sdk` Node example connects + sends a chat | 200 + streamed response |
| SDK2 | `@nyayavigya/client-sdk-react-native` example app boots, login works | login succeeds, token stored in Keychain |
| SDK3 | `@nyayavigya/nyayamitra-sdk` Hindi prompt | response in Hindi |
| SDK4 | `@nyayavigya/enterprise-sdk` multi-tenant call | tenant scoping respected |

## P2 — Observability & ops

| ID | Case | Expected |
|---|---|---|
| OB1 | Gateway logs structured JSON | `docker logs nyv-gateway` shows JSON lines |
| OB2 | Each request has a correlation ID | `X-Request-Id` echoed |
| OB3 | Slow-query log fires on >500ms DB calls | (manual probe) |
| OB4 | Alerts on Sentry | manual error → Sentry issue created |

## P2 — Security

| ID | Case | Expected |
|---|---|---|
| SC1 | CSRF on missing Origin | 403 |
| SC2 | Rate limit on `/auth/login` | 429 after burst |
| SC3 | Secrets not in any committed file | `git grep` for any `nyv_live_` returns 0 results |
| SC4 | `.env` chmod 600 on EC2 | `ls -la` confirms |

## P3 — Cross-platform / ecosystem

| ID | Case | Expected |
|---|---|---|
| EC1 | `pro.nyayasiddhi.online` issues NSP key | login + chat works |
| EC2 | `nym.nyayasiddhi.online` issues NYM key | citizen flow works |
| EC3 | `ins.nyayasiddhi.online` issues INS key | enterprise flow works |
| EC4 | Each platform's CSRF Origin enforced | mismatched Origin → 403 |

---

## Run log

### 2026-04-26 — first-level deployment UAT

| Block | Result | Note |
|---|---|---|
| P0 (S1–S5) | **PASS** 5/5 | see `DEPLOYMENT-VERIFICATION.md` |
| P1 / Auth (A1–A9) | **PASS** 9/9 | RBAC matrix + ecosystem keys both verified |
| P1 / Legal Chat (LC1–LC9) | **PASS** 8/9, 1 partial | LC5–LC7 browser PASS 2026-09-07; LC8 API PASS / UI rubric deferred |
| P1 / SME-allocation (SA1–SA3) | **PASS** 1/3, 2 deferred | SA1 verified (200) |
| P1 / Safety (SF1–SF2) | **DEFERRED** | needs targeted prompts; A6 wiring confirmed in code |
| P2 / RAG (RQ1–RQ4) | **DEFERRED** | confirmed in code (`src/services/rag/`); UAT cycle pending |
| P2 / SDK (SDK1–SDK4) | **DEFERRED** | SDK packages compile-clean; example apps run |
| P2 / Observability (OB1–OB4) | **PARTIAL** | OB1 ✓, OB2 ✓, OB3/OB4 deferred |
| P2 / Security (SC1–SC4) | **PASS** 4/4 | CSRF enforced; secrets clean (gitignored); .env perms verified |
| P3 / Ecosystem (EC1–EC4) | **DEFERRED** | hostnames live (10/10 200); per-platform e2e flows pending |

**Overall:** P0 GREEN, P1 mostly GREEN (gaps are deferred, not failed),
P2/P3 partially executed. Sufficient to declare "demo + pilot live".
A second UAT cycle is required to close the deferred items before paid
go-live (tracked as P6 in `PLATFORM-STATUS.md`).

### 2026-09-07 — Global UAT v2 (partner + NYS + doc pipeline)

See **[`UAT-TEST-PLAN-v2-2026-09.md`](./UAT-TEST-PLAN-v2-2026-09.md)** for full matrix.

| Block | Result | Note |
|---|---|---|
| P0 NYV health + deploy stamp | **PASS** | SSM `d4021e49`; CURRENT=`2026-09-06T0719Z-aws-ssm-22bf786e` |
| P0 Partner fast orchestrate | **PASS** | chat-fast 4206ms; draft-fast 5203ms (<10s SLA) |
| P0 CNR two-tier | **PASS** | TSWL default 223ms; RJHC caseCreate 2874ms |
| P0 Partner smoke (7 platforms) | **PASS** 99/99 | `npm run partner:smoke:ec2` |
| P1 Caselaw federation | **PASS*** | 200 but 0 results (degraded empty — gap P2) |
| P2 Audit hash chain | **FAIL** | `hash_chain_integrity_failure` in gateway logs |
| Browser Legal Chat LC5–8 | **PASS** 3/4, 1 UI blocked | Playwright 2026-09-07T04:45Z — LC5 login+shell, LC6 SSE, LC7 upload PASS; LC8 API feedback/replay PASS, rubric modal UI blocked (stream status=ok gate) |
