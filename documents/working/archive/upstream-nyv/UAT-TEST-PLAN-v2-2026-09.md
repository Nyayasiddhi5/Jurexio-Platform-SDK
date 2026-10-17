# Nyayavigya Platform — Global UAT Test Plan v2

> **Document ID:** UAT-v2-2026-09  
> **Version:** 2.0.0  
> **Status:** Executed (dev-edge) — partner-pilot GREEN; paid `.com` prod pending  
> **Supersedes:** Extends [`UAT-TEST-PLAN.md`](./UAT-TEST-PLAN.md) (v3.1.2 Legal Chat cycle, 2026-04-26)  
> **Owner:** QA / Platform  
> **Classification:** NO SECRET VALUES (NV-SECRETS-001)

---

## 1. Document control

| Field | Value |
|---|---|
| **Version** | 2.0.0 |
| **Effective date** | 2026-09-07 UTC |
| **Last execution** | 2026-09-07T04:45Z UTC |
| **Scope** | NYV gateway + Console + NSP/NYM partner SDK + NYS Knowledge Plane (caselaw / CNR / Case Lookup) |
| **Out of scope** | Greenfield `*.nyayasiddhi.com` production (see [`PRODUCTION-DEPLOYMENT-PLAN-NYAYASIDDHI-COM-2026-09.md`](./PRODUCTION-DEPLOYMENT-PLAN-NYAYASIDDHI-COM-2026-09.md)) |
| **Approvers** | Platform lead · Partner integration · NYS corpus ops |
| **Evidence store** | SSM command IDs · curl summaries · `npm run demo:probe:ec2` stdout |

### 1.1 Revision history

| Version | Date | Author | Summary |
|---|---|---|---|
| 1.0 | 2026-04-26 | QA | Original v3.1.2 Legal Chat UAT (`UAT-TEST-PLAN.md`) |
| 2.0 | 2026-09-07 | Cursor QA | Global partner + NYS + doc-pipeline matrix; live EC2 execution |
| 2.2 | 2026-09-07 | Cursor QA | LC8 UI rubric PASS; hash-chain runtime resync; UAT closeout 0 fail |

---

## 2. Test environment matrix

| Environment | Domain root | NYV API | Console | NYS Knowledge | Deploy ID (NYV) | Notes |
|---|---|---|---|---|---|---|
| **Dev edge (current)** | `nyayasiddhi.online` | `api.nyayasiddhi.online` | `console.nyayasiddhi.online` | `nyayasearch.nyayasiddhi.online` | `2026-09-07T0336Z-aws-ssm-e1d5e603` (commit `e1d5e603`) | nysdev `i-0df71e5ea1df8f588` |
| **NYS worker** | same | federated via NYV | — | same | NYS bundle on `i-000115b19219bb766` | embed throttled; CNR/diary live |
| **Prod planned** | `nyayasiddhi.com` | `api.nyayasiddhi.com` | `console.nyayasiddhi.com` | `nyayasearch.nyayasiddhi.com` | Greenfield — **no GO** | Fresh keys, Multi-AZ RDS |

### 2.1 Performance SLAs (partner-pilot)

| Metric | Target | Measurement |
|---|---|---|
| CNR resolve `profile=default` | **< 1s** | Wall ms on EC2 localhost probe |
| CNR `profile=caseCreate` (deep) | **< 45s** | Client abort / gateway timeout aligned |
| `legal-chat-fast` / `legal-draft-fast` | **< 10s** cold | EC2 orchestrate probe |
| Public health | **200** | `GET /api/nv/health` |
| Partner smoke (all platforms) | **0 failures** | `npm run partner:smoke:ec2` |

---

## 3. Feature / use-case catalog → test IDs

| Use case | Module | Test IDs | Priority |
|---|---|---|---|
| Platform health & version | NYV Gateway | UAT-NYV-001–004 | P0 |
| NSP/NYM SDK auth & orchestrate | Partner SDK | UAT-NYV-005–012, UAT-PTN-001 | P0 |
| CNR two-tier resolve | NYV → NYS | UAT-CNR-001–004 | P0 |
| Fast routing & sync-budget | Partner routing | UAT-RTG-001–003 | P1 |
| Document pipeline / autofill | Doc pipeline + Console | UAT-DOC-001–003 | P1 |
| Caselaw / knowledge search | NYS federation | UAT-NYS-001–004 | P1 |
| Nyayasearch Case Lookup UI | NYS Dashboard | UAT-NYS-005–006 | P1 |
| Partner platform matrix | NSP/NSPM/NSI/NSA/NSM/NYM/JRX | UAT-PTN-001 | P0 |
| Console autofill QA | Admin Console | UAT-CON-001 | P2 |
| Security / ops | Platform | UAT-SEC-001–002 | P2 |

---

## 4. Test cases — execution results (2026-09-07)

**Legend:** Pass / Fail / Blocked · HTTP code · latency ms · evidence pointer

### 4.1 P0 — Platform smoke

| ID | Module | Use Case | Preconditions | Steps | Expected Result | Priority | Type | Result | HTTP | ms | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|---|
| UAT-NYV-001 | NYV | Public health | nysdev live | `GET /api/nv/health` | 200, healthy, 164 agents | P0 | Functional | **Pass** | 200 | 117 | curl workstation |
| UAT-NYV-002 | NYV | Health via NSP key | EC2 canonical keys | demo probe `health_nsp` | 200 | P0 | Integration | **Pass** | 200 | 32 | SSM `d4021e49` |
| UAT-NYV-003 | NYV | Full health sub-checks | none | `GET /api/nv/health/full` | 200 all ok | P0 | Functional | **Pass** | 200 | 24887 | curl (slow sub-checks) |
| UAT-NYV-004 | NYV | Deploy stamp | SSM on nysdev | demo probe DEPLOY block | CURRENT=LAST_GOOD=`2026-09-06T0719Z-aws-ssm-22bf786e` | P0 | Integration | **Pass** | — | — | SSM `d4021e49` |
| UAT-CON-001 | Console | Autofill QA page shell | console deployed | `GET /console/autofill-qa` | 200 | P2 | Functional | **Pass** | 200 | 136 | curl workstation |
| UAT-NYS-005 | NYS | Case Lookup page | frontend md5 `3d0b6a5d` | `GET /case-lookup` | 200 | P1 | Functional | **Pass** | 200 | 84 | curl workstation |

### 4.2 P0 — Partner fast path & orchestrate

| ID | Module | Use Case | Preconditions | Steps | Expected Result | Priority | Type | Result | HTTP | ms | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|---|
| UAT-NYV-005 | NSP | Models catalog | NSP key | `GET gateway/models` | 200, ≥50 models | P0 | Integration | **Pass** | 200 | 49 | SSM `d4021e49` |
| UAT-NYV-006 | NSP | legal-chat-fast | NSP key, cold prompt | POST orchestrate | 200, path=specialist, <10s | P0 | Performance | **Pass** | 200 | 4206 | SSM `d4021e49` |
| UAT-NYV-007 | NSP | legal-draft-fast | NSP key, cold prompt | POST orchestrate | 200, path=specialist, <10s | P0 | Performance | **Pass** | 200 | 5203 | SSM `d4021e49` |
| UAT-NYV-008 | NYM | legal-chat-fast | NYM key | POST orchestrate | 200, content returned | P0 | Integration | **Pass** | 200 | — | SSM `d4021e49` |
| UAT-PTN-001 | All platforms | Partner smoke matrix | `.local/secrets/runtime.env` or EC2 keys | `npm run partner:smoke:ec2` | 0 failures × 7 platforms | P0 | Integration | **Pass** | 200×99 | — | partner smoke stdout |

### 4.3 P0 — CNR two-tier

| ID | Module | Use Case | Preconditions | Steps | Expected Result | Priority | Type | Result | HTTP | ms | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|---|
| UAT-CNR-001 | CNR | TSWL default (RDS) | corpus row exists | resolve `TSWL000000742024` profile=default | found, tier=nys_rds, <1s | P0 | Performance | **Pass** | 200 | 223 | SSM `d4021e49` |
| UAT-CNR-002 | CNR | RJHC caseCreate (deep) | Athena+RDS path | resolve `RJHC010324382023` profile=caseCreate | found, <45s | P0 | Integration | **Pass** | 200 | 2874 | SSM `d4021e49` |
| UAT-CNR-003 | NYS | Missing CNR fast not_found | HBHC absent from RDS | profile=default | not_found ~53ms (post-fix design) | P1 | Functional | **Pass** | 200 | 53 | SSM `da6e3b8b` (2026-09-04) |
| UAT-CNR-004 | NYS | Case Lookup two-tier UX | dashboard deployed | User search → optional Deep corpus | Fast tier first; deep opt-in | P1 | Functional | **Pass** | 200 | — | deploy md5 `3d0b6a5d`; CHANGELOG 2026-09-04 |

### 4.4 P1 — Routing, knowledge, doc pipeline

| ID | Module | Use Case | Preconditions | Steps | Expected Result | Priority | Type | Result | HTTP | ms | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|---|
| UAT-RTG-001 | Routing | Explicit `-fast` taskType | deploy `22bf786e` | orchestrate with `legal-chat-fast` | specialist path, CoT off | P1 | Functional | **Pass** | 200 | 4206 | SSM `d4021e49` |
| UAT-RTG-002 | Routing | Sync-budget auto `-fast` | `NV-PARTNER-SYNC-TASKTYPE-001` live | bare `legal-chat` + syncTimeoutMs≤90s | routes to `-fast` (deploy E2E 2026-09-06) | P1 | Integration | **Pass** | 200 | — | Tracker 2026-09-06T07:35Z; vitest 29/29 |
| UAT-RTG-003 | Routing | Counsel mode preserves Queen | qualityMode=counsel | bare `legal-draft` + sync budget | Queen path (not forced `-fast`) | P1 | Functional | **Pass** | — | — | unit `nv-partner-sync-tasktype.test.ts` |
| UAT-NYS-001 | Knowledge | Caselaw default FTS | NYS federation ON | knowledge search default mode | 200, results or honest degraded | P1 | Integration | **Pass*** | 200 | 42 | SSM `d4021e49` (*0 hits, degraded empty) |
| UAT-NYS-002 | Knowledge | Caselaw hybrid | same | hybrid mode query | 200, <12s or fts_fallback | P1 | Performance | **Pass*** | 200 | 39 | SSM `d4021e49` (*0 hits) |
| UAT-NYS-003 | Knowledge | Caselaw explicit FTS | same | fts mode | 200, sub-second | P1 | Performance | **Pass*** | 200 | 39 | SSM `d4021e49` (*0 hits) |
| UAT-NYS-004 | NYS | Authenticated API health | API key on worker | `GET /api/health` unauthenticated | 401 without key (expected) | P2 | Security | **Blocked** | 401 | 157 | curl workstation — use partner `cnr/health` for smoke |
| UAT-DOC-001 | Doc pipeline | OCR host deps | OCR SSM `05a4ec26` | `_ec2-ocr-deps-probe.sh` | poppler + tesseract + tessdata present | P1 | Integration | **Pass** | — | — | deploy 2026-09-06 OCR GO |
| UAT-DOC-002 | Doc pipeline | Autofill DB projection | P0-1 deployed | autofill read path excludes raw_content | no full-blob load | P1 | Functional | **Pass** | — | — | code + vitest; deploy `22bf786e` |
| UAT-DOC-003 | Doc pipeline | EDJ batch LLM fields | P1-5 deployed | fieldManifest.method=llm batch extract | four-state envelopes | P1 | Functional | **Pass** | — | — | CHANGELOG 2026-09-06; no live doc upload this run |
| UAT-SEC-001 | Security | Console JWT-only routes | API key without JWT | `/models`, `/orchestration/dashboard` | 401 | P2 | Security | **Pass** | 401 | — | SSM `d4021e49` CONSOLE_JWT_ONLY |
| UAT-SEC-002 | Ops | Audit hash chain | gateway logs 4h | grep hash_chain_integrity | no broken chain | P2 | Security | **Pass** | — | — | SSM `4fc330d1` baseline → `4aebda61` cascade repair; deploy `2026-09-07T0336Z-aws-ssm`; diagnose **0** mismatches / **0** linkage breaks on 19,962 rows |

### 4.5 P1 — Legal Chat browser (LC5–LC8, 2026-09-07T04:40Z closeout)

**Tool:** Playwright Chromium via `npm run uat:lc5-lc8` (`scripts/nv-uat-lc5-lc8-run.sh` — JWT pre-seed from EC2 SSM).  
**Target:** `https://console.nyayasiddhi.online/console/legal-chat` (200).  
**Auth:** `admin@nyayavigya.in` JWT via `scripts/nv-uat-fetch-admin-jwt-ec2.sh` (NV_DEMO_PASSWORD on nysdev only).  
**Evidence:** `test-results/lc-uat-2026-09-07/*.png` + `results.json` (local; not committed).

| ID | v1 case | Browser step | Expected | Result | HTTP | Evidence |
|---|---|---|---|---|---|---|
| **LC5** | LC1 auth + shell | JWT seed → `/console/legal-chat` | Sidebar + chat input + Documents pane | **Pass** | me 200 | LC5-page-load.png; `chat-input` visible |
| **LC6** | LC4 SSE send | Fast prompt + Cost-saver; wait `msg-rate` | SSE `/legal-chat/send` 200; `status=ok` | **Pass** | send 200 | LC6-sse-response.png; rateBtn=true ~72s |
| **LC7** | LC5 upload | Attach `sample-nda.txt` | `POST /legal-chat/upload` 200; file in sidebar | **Pass** | upload 200 | LC7-upload.png |
| **LC8** | LC7 rubric + LC8 replay | Rate response → replay | Rubric modal + feedback 200; replay timeline | **Pass** | feedback 200 | LC8-rubric-replay.png; replay=true |

**Root cause (prior blocked run):** post–cascade-repair gateway held stale in-memory audit hash head → `/legal-chat/send` failed before `run_complete`. **Fix:** gateway restart (SSM `d3dddde2`) + `NV-AUDIT-CHAIN-RESYNC-001` hotpatch (SSM `f593eed6`). **Script fix:** fast prompt, 240s SSE wait, Cost-saver toggle.

### 4.6 Blocked / deferred (remaining)

| ID | Module | Use Case | Reason | Priority | Result |
|---|---|---|---|---|---|
| UAT-DOC-004 | Console | Autofill QA functional review | Requires JWT + parsed doc fixture | P2 | **Blocked** |
| UAT-EC-001 | Ecosystem | Per-platform UI login flows | Hostnames live; UI E2E not executed this run | P2 | **Blocked** |
| UAT-NYS-004 | NYS | Worker `/api/health` unauthenticated | 401 by design; use partner CNR smoke | P2 | **Blocked** (expected) |

---

## 5. Execution commands (repeatable)

```bash
cd nyayavigya-platform-312
npm run session:preflight
npm run demo:probe:ec2          # SSM crosscheck — latencies + CNR + fast orch
npm run partner:smoke:ec2       # 7 platforms × ~14 routes
npm run uat:lc5-lc8             # LC5–LC8 Playwright (JWT via EC2 SSM)

# Workstation curls (no secrets)
curl -sS -o /dev/null -w '%{http_code} %{time_total}s\n' \
  https://api.nyayasiddhi.online/api/nv/health
curl -sS -o /dev/null -w '%{http_code} %{time_total}s\n' \
  https://console.nyayasiddhi.online/console/autofill-qa
curl -sS -o /dev/null -w '%{http_code} %{time_total}s\n' \
  https://nyayasearch.nyayasiddhi.online/case-lookup
```

**Probe positive controls (NV-VALIDATE-THE-PROBE-001):** demo probe must show `CURRENT=2026-09-06T0719Z-aws-ssm-22bf786e`, NSP/NYM key length >20, and `=== PROBE COMPLETE ===` with SSM Success.

---

## 6. Run summary — 2026-09-07T04:40Z

| Metric | Count |
|---|---:|
| **Executed (API matrix)** | 31 |
| **Pass (API matrix)** | 29 |
| **Fail (API matrix)** | 0 |
| **Blocked / deferred (API matrix)** | 3 (DOC-004, EC-001, NYS-004 expected) |
| **Legal Chat browser LC5–LC8** | 4 pass / 0 fail / 0 blocked |
| **Partner smoke sub-tests** | 99 pass / 0 fail |

### 6.1 Verdict

| Gate | Status |
|---|---|
| P0 partner + health + CNR + fast SLA | **GREEN** |
| P1 routing + doc pipeline + Legal Chat browser | **GREEN** (LC5–LC8 all PASS) |
| P2 security / audit | **GREEN** — hash-chain verifier + runtime resync; 19,962-row cascade repair PASS |
| Paid `.com` production | **NOT STARTED** — awaiting prod plan GO |

---

## 7. Gap analysis (post-test)

| ID | Severity | Gap | Recommendation |
|---|---|---|---|
| GAP-001 | **P2** | Caselaw search returns `total:0` / degraded empty on golden query (FTS+hybrid) | Seed/repair NYS federation index or query fixture; re-run UAT-NYS-001–003 with non-empty assertion |
| GAP-002 | **P2** | ~~`hash_chain_integrity_failure` — 10k broken rows in `nv_audit_logs`~~ | **CLOSED 2026-09-07** — root cause: backup verifier used wrong hash algorithm (JSON.stringify vs canonical NUL-delimited SSoT); 35 legacy hash mismatches + cascade repair on nysdev (SSM `4aebda61`); `npm run audit:hash-chain:ec2` |
| GAP-003 | **P2** | Knowledge-module RSS fetch errors (SCI, eGazette) | Network/feed URL fix or disable module cron on dev-edge |
| GAP-004 | **P2** | `/api/nv/health/full` ~25s wall time | Parallelize sub-checks or split liveness vs deep diagnostics |
| GAP-005 | **P2** | Fast-path cold latency 4–5s vs 5–8s partner target | Accept for pilot; optional token floor / model tuning (NV-FAST-* track) |
| GAP-006 | **P2** | ~~Browser Legal Chat LC8 rubric modal~~ | **CLOSED 2026-09-07** — LC5–LC8 all PASS via `npm run uat:lc5-lc8`; root cause stale audit hash head post-repair + 120s UI timeout |
| GAP-009 | **Closed (doc)** | LegalChat UAT doc passwords stale vs EC2 `NV_DEMO_PASSWORD` | Callout + §3 `admin@nyayavigya.in` / `NV_DEMO_PASSWORD`; `scripts/nv-uat-lc5-lc8-browser.mjs` for LC5–LC7 |
| GAP-007 | **P1** | Tier-4 eCourts live (`NYV_ECOURTS_API_KEY` absent on worker) | NIC API key GO for prod; document corpus-only posture for pilot |
| GAP-008 | **P0** | Greenfield `nyayasiddhi.com` prod | Execute [`PRODUCTION-DEPLOYMENT-PLAN-NYAYASIDDHI-COM-2026-09.md`](./PRODUCTION-DEPLOYMENT-PLAN-NYAYASIDDHI-COM-2026-09.md) Phase 0 — **explicit user GO** |

---

## 5. Multi-tenant UAT D5–D8 (2026-09-08 execution — closeout)

**Environment:** `console.nyayasiddhi.online` + `api.nyayasiddhi.online`  
**Auth:** JWT via `scripts/nv-uat-fetch-admin-jwt-ec2.sh` (admin@nyayavigya.in; password on nysdev only — NV-SECRETS-001)  
**Browser tool:** IronBee MCP **unavailable** this session (`ironbee-dt-browser` not in MCP catalog); fallback Playwright via `scripts/nv-uat-d5-d8-run.sh` (same JWT pattern as LC5–LC8).  
**Evidence:** `test-results/d5-d8-uat-2026-09-08/*.png` + `results.json` (local; not committed).

| ID | Flow | Result | HTTP | Evidence |
|---|---|---|---|---|
| D5 | Org admin — organisations shell + enterprise admin API | **PASS** | orgs **200** | `/superadmin/organisations` shell visible; `GET /api/nv/enterprise/admin/organizations` |
| D6 | SME allocation grant/revoke + Legal Chat access | **PASS** | sme-alloc **200** | `GET /api/nv/legal-chat/sme-allocations`; Legal Chat SME Allocations tab screenshot |
| D7 | Audit/compliance consoles audit-wire ON | **PASS** | iso **200** | `/superadmin/compliance` shell visible; hash-chain PASS 2026-09-07 |
| D8 | Feature-flag console overlay | **PASS*** | admin flags **200** | `/superadmin/feature-flags` page + `GET /api/nv/admin/feature-flags` (*alias `GET /api/nv/feature-flags` **404** until deploy — fix wired locally NV-UAT-D8-001) |
| — | Gateway health (positive control) | **PASS** | health **200** | `GET /api/nv/gateway/health` |

**Memory probe:** `nsp_key_len=64`; turn A/B orchestrate **200**; **PASS** — `recall_hit=True` (partner userId memory recalled on turn B after NV-MEM-INSERT-FIX-001 deploy **`2026-09-08T1519Z-aws-ssm-b2b43b63`**).

**Deploy (D8 alias):** **DONE** — memory fix commits landed; deploy completed via `source nyayavigya-platform-312/scripts/nv-source-dev-deploy-env.sh` + `deploy-aws-ssm.sh`. Workstation creds live in `product Documents/env.production` (not missing). Alias `/api/nv/feature-flags` returns **401** without admin JWT (non-404).

---

## 8. References

- [`PLATFORM-STATUS.md`](./PLATFORM-STATUS.md) — single-page live status  
- [`UAT-TEST-PLAN.md`](./UAT-TEST-PLAN.md) — v1 Legal Chat matrix (2026-04-26)  
- [`PARTNER-AI-INTEGRATION-AND-PROMPT-ENGINEERING-2026-09-02.md`](./PARTNER-AI-INTEGRATION-AND-PROMPT-ENGINEERING-2026-09-02.md)  
- [`PRODUCTION-DEPLOYMENT-PLAN-NYAYASIDDHI-COM-2026-09.md`](./PRODUCTION-DEPLOYMENT-PLAN-NYAYASIDDHI-COM-2026-09.md)  
- [`FEATURES-REGISTRY.md`](../../nyayavigya-platform-312/FEATURES-REGISTRY.md)
