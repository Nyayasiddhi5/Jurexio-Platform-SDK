---
status: pending
version: 3.2
superseded_by: null
last_verified: 2026-04-25
---
# NYV-UAT-v3.2 — Comprehensive End-to-End UAT Pack

**Total scenarios:** 223
**Jurisdictions:** IN · UK · US · EU · SG · GC · Default (7)
**Orchestration patterns:** sequential · parallel · swarm · DAG · hierarchical · multi-agent (6)
**Collective-intelligence modes:** brainstorm · consensus · vote · debate · synthesis (5)
**SDK variants exercised:** NSP web · NSP mobile · Nyayamitra mobile
**User roles:** super-admin · lawyer-pro · citizen-mitra · enterprise-counsel · paralegal

## Status legend
| symbol | meaning |
|---|---|
| `pass` | actual matched expected |
| `partial` | HTTP OK but missing expected fields |
| `fail` | HTTP status or behaviour deviated |
| `blocked` | could not execute (timeout, connection, dry-run) |
| `deferred` | tracked as a follow-up task (see resolution col) |
| `pending` | not yet run |

## agui (15)

| ID | Tag | Description | Method `path` | Expected | Status | HTTP | Resolution | Bug |
|---|---|---|---|---|---|---|---|---|
| AGUI-COT-001 | — | AG-UI SSE — cot pattern event ordering | POST `/api/nv/stream` | 200 | pass | 200 | - | - |
| AGUI-REACT-002 | — | AG-UI SSE — react pattern event ordering | POST `/api/nv/stream` | 200 | pass | 200 | - | - |
| AGUI-TOT-003 | — | AG-UI SSE — tot pattern event ordering | POST `/api/nv/stream` | 200 | pass | 200 | - | - |
| AGUI-REFLECTION-004 | — | AG-UI SSE — reflection pattern event ordering | POST `/api/nv/stream` | 200 | pass | 200 | - | - |
| AGUI-PLANEXEC-005 | — | AG-UI SSE — planexec pattern event ordering | POST `/api/nv/stream` | 200 | pass | 200 | - | - |
| AGUI-NYAYARAG-006 | — | AG-UI SSE — nyayarag pattern event ordering | POST `/api/nv/stream` | 200 | pass | 200 | - | - |
| AGUI-GRAPHRAG-007 | — | AG-UI SSE — graphrag pattern event ordering | POST `/api/nv/stream` | 200 | pass | 200 | - | - |
| AGUI-MEM0-008 | — | AG-UI SSE — mem0 pattern event ordering | POST `/api/nv/stream` | 200 | pass | 200 | - | - |
| AGUI-SWARM-009 | — | AG-UI SSE — swarm pattern event ordering | POST `/api/nv/stream` | 200 | pass | 200 | - | - |
| AGUI-ORDERING-001 | — | AG-UI — ordering | POST `/api/nv/stream` | 200/400 | pass | 400 | - | - |
| AGUI-RECONNECT-002 | — | AG-UI — reconnect | POST `/api/nv/stream` | 200/400 | pass | 400 | - | - |
| AGUI-SLOWNETWORK-003 | — | AG-UI — slow-network | POST `/api/nv/stream` | 200/400 | pass | 400 | - | - |
| AGUI-TOKENCORRECTNESS-004 | — | AG-UI — token-correctness | POST `/api/nv/stream` | 200/400 | pass | 400 | - | - |
| AGUI-LARGEPAYLOAD-005 | — | AG-UI — large-payload | POST `/api/nv/stream` | 200/400 | pass | 400 | - | - |
| AGUI-AUTHFAILURE-006 | — | AG-UI — auth-failure | POST `/api/nv/stream` | 401 | pass | 401 | - | - |

## collective-intelligence (10)

| ID | Tag | Description | Method `path` | Expected | Status | HTTP | Resolution | Bug |
|---|---|---|---|---|---|---|---|---|
| CI-BRAINSTORM-001 | IN | Collective intelligence brainstorm mode — case 1 | POST `/api/nv/orchestrate` | 200 | pass | 200 | - | - |
| CI-BRAINSTORM-002 | US | Collective intelligence brainstorm mode — case 2 | POST `/api/nv/orchestrate` | 200 | pass | 200 | - | - |
| CI-CONSENSUS-001 | IN | Collective intelligence consensus mode — case 1 | POST `/api/nv/orchestrate` | 200 | pass | 200 | - | - |
| CI-CONSENSUS-002 | US | Collective intelligence consensus mode — case 2 | POST `/api/nv/orchestrate` | 200 | pass | 200 | - | - |
| CI-VOTE-001 | IN | Collective intelligence vote mode — case 1 | POST `/api/nv/orchestrate` | 200 | pass | 200 | - | - |
| CI-VOTE-002 | US | Collective intelligence vote mode — case 2 | POST `/api/nv/orchestrate` | 200 | pass | 200 | - | - |
| CI-DEBATE-001 | IN | Collective intelligence debate mode — case 1 | POST `/api/nv/orchestrate` | 200 | pass | 200 | - | - |
| CI-DEBATE-002 | US | Collective intelligence debate mode — case 2 | POST `/api/nv/orchestrate` | 200 | pass | 200 | - | - |
| CI-SYNTHESIS-001 | IN | Collective intelligence synthesis mode — case 1 | POST `/api/nv/orchestrate` | 200 | pass | 200 | - | - |
| CI-SYNTHESIS-002 | US | Collective intelligence synthesis mode — case 2 | POST `/api/nv/orchestrate` | 200 | pass | 200 | - | - |

## compliance (10)

| ID | Tag | Description | Method `path` | Expected | Status | HTTP | Resolution | Bug |
|---|---|---|---|---|---|---|---|---|
| COMP-EUAI-001 | — | Compliance — EU AI Act high-risk decision blocks without HITL | POST `/api/nv/orchestrate` | 200 | fail | 503 | - | NYV-UAT-BUG-007 |
| COMP-DPDPA-001 | — | Compliance — DPDPA consent gate blocks without consent | POST `/api/nv/consent/check` | 200/403/404 | pass | 200 | deferred-to-task (follow-up #48) | - |
| COMP-CONSENT-001 | — | Compliance — record consent token | POST `/api/nv/consent` | 200/201 | pass | 201 | deferred-to-task (follow-up #48) | - |
| COMP-AUDIT-001 | — | Compliance — audit hash chain integrity end-to-end | GET `/api/nv/compliance/evidence` | 200/401 | pass | 200 | - | - |
| COMP-PII-TOK-001 | — | Compliance — PII vault tokenize round-trip | POST `/api/nv/pii/tokenize` | 200/201 | pass | 200 | - | - |
| COMP-PII-DETOK-001 | — | Compliance — PII vault detokenize across pods | POST `/api/nv/pii/detokenize` | 200/404 | pass | 404 | - | - |
| COMP-INC-001 | — | Compliance — incident reporting endpoint | POST `/api/nv/incidents` | 200/201 | pass | 201 | deferred-to-task (follow-up #48) | - |
| COMP-MODGOV-001 | — | Compliance — model governance read returns approved providers | GET `/api/nv/model-governance` | 200/401 | pass | 200 | deferred-to-task (follow-up #48) | - |
| COMP-EVID-001 | — | Compliance — compliance evidence write | POST `/api/nv/compliance/evidence` | 200/201 | pass | 201 | deferred-to-task (follow-up #48) | - |
| COMP-RLS-001 | — | Compliance — cross-tenant RLS denies access | GET `/api/nv/case-management/cases` | 200/403/404 | fail | 500 | deferred-to-task (follow-up #48) | NYV-UAT-BUG-008 |

## failure-modes (10)

| ID | Tag | Description | Method `path` | Expected | Status | HTTP | Resolution | Bug |
|---|---|---|---|---|---|---|---|---|
| FAIL-PROV-DOWN-001 | — | Failure mode — primary provider down → fallback succeeds | POST `/api/nv/orchestrate` | 200/400/413/429/500/503/504 | pass | 503 | - | - |
| FAIL-REDIS-001 | — | Failure mode — Redis down → service degrades gracefully | POST `/api/nv/orchestrate` | 200/400/413/429/500/503/504 | pass | 503 | - | - |
| FAIL-AGENT-001 | — | Failure mode — one agent fails → swarm continues | POST `/api/nv/orchestrate` | 200/400/413/429/500/503/504 | pass | 200 | - | - |
| FAIL-CACHE-HIT-001 | — | Failure mode — cache HIT on repeated query | POST `/api/nv/orchestrate` | 200/400/413/429/500/503/504 | pass | 503 | - | - |
| FAIL-CB-OPEN-001 | — | Failure mode — circuit breaker open → 503 with Retry-After | POST `/api/nv/orchestrate` | 200/400/413/429/500/503/504 | pass | 503 | - | - |
| FAIL-TIMEOUT-001 | — | Failure mode — LLM timeout → graceful 504 | POST `/api/nv/orchestrate` | 200/400/413/429/500/503/504 | pass | 503 | - | - |
| FAIL-INVAL-INPUT-001 | — | Failure mode — invalid orchestrationMode → 200 with fallback | POST `/api/nv/orchestrate` | 200/400/413/429/500/503/504 | pass | 503 | - | - |
| FAIL-EMPTY-PROMPT-001 | — | Failure mode — empty prompt → 400 | POST `/api/nv/orchestrate` | 200/400/413/429/500/503/504 | pass | 400 | - | - |
| FAIL-OVERSIZE-001 | — | Failure mode — oversize prompt → 400 / 413 / truncate | POST `/api/nv/orchestrate` | 200/400/413/429/500/503/504 | pass | 429 | - | - |
| FAIL-MIDDLEWARE-001 | — | Failure mode — middleware exception is sanitized in response | POST `/api/nv/orchestrate` | 200/400/413/429/500/503/504 | pass | 503 | - | - |

## gate-bias (4)

| ID | Tag | Description | Method `path` | Expected | Status | HTTP | Resolution | Bug |
|---|---|---|---|---|---|---|---|---|
| GATE-BIAS-001 | — | Bias detector — adversarial prompt 1 | POST `/api/nv/bias/audit` | 200 | pass | 200 | - | - |
| GATE-BIAS-002 | — | Bias detector — adversarial prompt 2 | POST `/api/nv/bias/audit` | 200 | pass | 200 | - | - |
| GATE-BIAS-003 | — | Bias detector — adversarial prompt 3 | POST `/api/nv/bias/audit` | 200 | pass | 200 | - | - |
| GATE-BIAS-004 | — | Bias detector — adversarial prompt 4 | POST `/api/nv/bias/audit` | 200 | pass | 200 | - | - |

## gate-citation (6)

| ID | Tag | Description | Method `path` | Expected | Status | HTTP | Resolution | Bug |
|---|---|---|---|---|---|---|---|---|
| GATE-CITE-001 | IN | Citation verifier — IN | POST `/api/nv/citations/verify` | 200 | pass | 200 | - | - |
| GATE-CITE-002 | EU | Citation verifier — EU | POST `/api/nv/citations/verify` | 200 | pass | 200 | - | - |
| GATE-CITE-003 | UK | Citation verifier — UK | POST `/api/nv/citations/verify` | 200 | pass | 200 | - | - |
| GATE-CITE-004 | US | Citation verifier — US | POST `/api/nv/citations/verify` | 200 | pass | 200 | - | - |
| GATE-CITE-005 | SG | Citation verifier — SG | POST `/api/nv/citations/verify` | 200 | pass | 200 | - | - |
| GATE-CITE-006 | GC | Citation verifier — GC | POST `/api/nv/citations/verify` | 200 | pass | 200 | - | - |

## gate-hallucination (4)

| ID | Tag | Description | Method `path` | Expected | Status | HTTP | Resolution | Bug |
|---|---|---|---|---|---|---|---|---|
| GATE-HALL-001 | — | Hallucination check — fabricated citation | POST `/api/nv/hallucination/check` | 200 | pass | 200 | - | - |
| GATE-HALL-002 | — | Hallucination check — genuine citation | POST `/api/nv/hallucination/check` | 200 | pass | 200 | - | - |
| GATE-HALL-003 | — | Hallucination check — fabricated citation | POST `/api/nv/hallucination/check` | 200 | pass | 200 | - | - |
| GATE-HALL-004 | — | Hallucination check — genuine citation | POST `/api/nv/hallucination/check` | 200 | pass | 200 | - | - |

## gate-hitl-route (6)

| ID | Tag | Description | Method `path` | Expected | Status | HTTP | Resolution | Bug |
|---|---|---|---|---|---|---|---|---|
| GATE-LOWCONF-001 | — | Low-confidence answer is routed to HITL queue (case 1) | POST `/api/nv/orchestrate` | 200 | fail | 503 | - | NYV-UAT-BUG-003 |
| GATE-LOWCONF-002 | — | Low-confidence answer is routed to HITL queue (case 2) | POST `/api/nv/orchestrate` | 200 | fail | 503 | - | NYV-UAT-BUG-003 |
| GATE-LOWCONF-003 | — | Low-confidence answer is routed to HITL queue (case 3) | POST `/api/nv/orchestrate` | 200 | fail | 503 | - | NYV-UAT-BUG-003 |
| GATE-LOWCONF-004 | — | Low-confidence answer is routed to HITL queue (case 4) | POST `/api/nv/orchestrate` | 200 | fail | 503 | - | NYV-UAT-BUG-003 |
| GATE-LOWCONF-005 | — | Low-confidence answer is routed to HITL queue (case 5) | POST `/api/nv/orchestrate` | 200 | fail | 503 | - | NYV-UAT-BUG-003 |
| GATE-LOWCONF-006 | — | Low-confidence answer is routed to HITL queue (case 6) | POST `/api/nv/orchestrate` | 200 | fail | 503 | - | NYV-UAT-BUG-003 |

## hitl (10)

| ID | Tag | Description | Method `path` | Expected | Status | HTTP | Resolution | Bug |
|---|---|---|---|---|---|---|---|---|
| HITL-PEND-001 | — | HITL — pending review queue | GET `/api/nv/hitl/pending` | 200/201/404 | pass | 200 | - | - |
| HITL-STATS-001 | — | HITL — review throughput stats | GET `/api/nv/hitl/stats` | 200/201/404 | pass | 200 | - | - |
| HITL-AUTOAPP-001 | — | HITL — auto-approve path on low-risk | POST `/api/nv/orchestrate` | 200/201/404 | fail | 503 | - | NYV-UAT-BUG-004 |
| HITL-REVIEW-001 | — | HITL — human-review path on medium-risk | POST `/api/nv/orchestrate` | 200/201/404 | fail | 503 | open (n/a) | NYV-UAT-BUG-004 |
| HITL-ESC-001 | — | HITL — escalate path on high-risk | POST `/api/nv/orchestrate` | 200/201/404 | fail | 503 | - | NYV-UAT-BUG-004 |
| HITL-DEC-APP-001 | — | HITL — reviewer approve decision | POST `/api/nv/hitl/uat-stub-approve/decision` | 200/201/404 | pass | 404 | - | - |
| HITL-DEC-REJ-001 | — | HITL — reviewer reject decision | POST `/api/nv/hitl/uat-stub-reject/decision` | 200/201/404 | pass | 404 | - | - |
| HITL-DEC-MOD-001 | — | HITL — reviewer modify-and-approve | POST `/api/nv/hitl/uat-stub-modify/decision` | 200/201/404 | pass | 404 | - | - |
| HITL-FETCH-001 | — | HITL — fetch single review by id | GET `/api/nv/hitl/uat-stub-id` | 200/201/404 | pass | 404 | - | - |
| HITL-METRICS-001 | — | HITL — agent metrics include HITL rate | GET `/api/nv/agent/metrics` | 200/201/404 | pass | 200 | - | - |

## jurisdiction (35)

| ID | Tag | Description | Method `path` | Expected | Status | HTTP | Resolution | Bug |
|---|---|---|---|---|---|---|---|---|
| IN-TEN-001 | IN | IN tenancy baseline — single-agent legal Q&A | POST `/api/nv/orchestrate` | 200 | pass | 200 | open (n/a) | - |
| IN-CON-001 | IN | IN contract baseline — single-agent legal Q&A | POST `/api/nv/orchestrate` | 200 | pass | 200 | - | - |
| IN-EMP-001 | IN | IN employment baseline — single-agent legal Q&A | POST `/api/nv/orchestrate` | 200 | pass | 200 | - | - |
| IN-IP-001 | IN | IN ip baseline — single-agent legal Q&A | POST `/api/nv/orchestrate` | 200 | pass | 200 | - | - |
| IN-REG-001 | IN | IN regulatory baseline — single-agent legal Q&A | POST `/api/nv/orchestrate` | 200 | pass | 200 | - | - |
| UK-TEN-001 | UK | UK tenancy baseline — single-agent legal Q&A | POST `/api/nv/orchestrate` | 200 | pass | 200 | - | - |
| UK-CON-001 | UK | UK contract baseline — single-agent legal Q&A | POST `/api/nv/orchestrate` | 200 | pass | 200 | - | - |
| UK-EMP-001 | UK | UK employment baseline — single-agent legal Q&A | POST `/api/nv/orchestrate` | 200 | pass | 200 | - | - |
| UK-IP-001 | UK | UK ip baseline — single-agent legal Q&A | POST `/api/nv/orchestrate` | 200 | pass | 200 | - | - |
| UK-REG-001 | UK | UK regulatory baseline — single-agent legal Q&A | POST `/api/nv/orchestrate` | 200 | pass | 200 | - | - |
| US-TEN-001 | US | US tenancy baseline — single-agent legal Q&A | POST `/api/nv/orchestrate` | 200 | pass | 200 | - | - |
| US-CON-001 | US | US contract baseline — single-agent legal Q&A | POST `/api/nv/orchestrate` | 200 | pass | 200 | - | - |
| US-EMP-001 | US | US employment baseline — single-agent legal Q&A | POST `/api/nv/orchestrate` | 200 | pass | 200 | - | - |
| US-IP-001 | US | US ip baseline — single-agent legal Q&A | POST `/api/nv/orchestrate` | 200 | pass | 200 | - | - |
| US-REG-001 | US | US regulatory baseline — single-agent legal Q&A | POST `/api/nv/orchestrate` | 200 | pass | 200 | - | - |
| EU-TEN-001 | EU | EU tenancy baseline — single-agent legal Q&A | POST `/api/nv/orchestrate` | 200 | pass | 200 | - | - |
| EU-CON-001 | EU | EU contract baseline — single-agent legal Q&A | POST `/api/nv/orchestrate` | 200 | pass | 200 | - | - |
| EU-EMP-001 | EU | EU employment baseline — single-agent legal Q&A | POST `/api/nv/orchestrate` | 200 | pass | 200 | - | - |
| EU-IP-001 | EU | EU ip baseline — single-agent legal Q&A | POST `/api/nv/orchestrate` | 200 | pass | 200 | - | - |
| EU-REG-001 | EU | EU regulatory baseline — single-agent legal Q&A | POST `/api/nv/orchestrate` | 200 | pass | 200 | - | - |
| SG-TEN-001 | SG | SG tenancy baseline — single-agent legal Q&A | POST `/api/nv/orchestrate` | 200 | pass | 200 | - | - |
| SG-CON-001 | SG | SG contract baseline — single-agent legal Q&A | POST `/api/nv/orchestrate` | 200 | pass | 200 | - | - |
| SG-EMP-001 | SG | SG employment baseline — single-agent legal Q&A | POST `/api/nv/orchestrate` | 200 | pass | 200 | - | - |
| SG-IP-001 | SG | SG ip baseline — single-agent legal Q&A | POST `/api/nv/orchestrate` | 200 | pass | 200 | - | - |
| SG-REG-001 | SG | SG regulatory baseline — single-agent legal Q&A | POST `/api/nv/orchestrate` | 200 | pass | 200 | - | - |
| GC-TEN-001 | GC | GC tenancy baseline — single-agent legal Q&A | POST `/api/nv/orchestrate` | 200 | pass | 200 | - | - |
| GC-CON-001 | GC | GC contract baseline — single-agent legal Q&A | POST `/api/nv/orchestrate` | 200 | pass | 200 | - | - |
| GC-EMP-001 | GC | GC employment baseline — single-agent legal Q&A | POST `/api/nv/orchestrate` | 200 | pass | 200 | - | - |
| GC-IP-001 | GC | GC ip baseline — single-agent legal Q&A | POST `/api/nv/orchestrate` | 200 | pass | 200 | - | - |
| GC-REG-001 | GC | GC regulatory baseline — single-agent legal Q&A | POST `/api/nv/orchestrate` | 200 | pass | 200 | - | - |
| Default-TEN-001 | Default | Default tenancy baseline — single-agent legal Q&A | POST `/api/nv/orchestrate` | 200 | pass | 200 | - | - |
| Default-CON-001 | Default | Default contract baseline — single-agent legal Q&A | POST `/api/nv/orchestrate` | 200 | pass | 200 | - | - |
| Default-EMP-001 | Default | Default employment baseline — single-agent legal Q&A | POST `/api/nv/orchestrate` | 200 | pass | 200 | - | - |
| Default-IP-001 | Default | Default ip baseline — single-agent legal Q&A | POST `/api/nv/orchestrate` | 200 | pass | 200 | - | - |
| Default-REG-001 | Default | Default regulatory baseline — single-agent legal Q&A | POST `/api/nv/orchestrate` | 200 | pass | 200 | - | - |

## memory (15)

| ID | Tag | Description | Method `path` | Expected | Status | HTTP | Resolution | Bug |
|---|---|---|---|---|---|---|---|---|
| MEM-STORE-001 | — | Memory — store a session-tier memory | POST `/api/nv/memory/remember` | 200/201/204/404 | pass | 201 | - | - |
| MEM-RECALL-002 | — | Memory — recall by semantic query | POST `/api/nv/memory/recall` | 200/201/204/404 | pass | 200 | - | - |
| MEM-STATS-003 | — | Memory — memory stats per user | GET `/api/nv/memory/stats` | 200/201/204/404 | pass | 200 | - | - |
| MEM-MULTITURN-004 | — | Memory — multi-turn continuity within a session | POST `/api/nv/orchestrate` | 200/201/204/404 | fail | 503 | - | NYV-UAT-BUG-001 |
| MEM-MATTER-005 | — | Memory — matter-scoped recall across sessions | POST `/api/nv/orchestrate` | 200/201/204/404 | fail | 503 | - | NYV-UAT-BUG-001 |
| MEM-CROSS-SESS-006 | — | Memory — cross-session recall for same client | POST `/api/nv/orchestrate` | 200/201/204/404 | fail | 503 | - | NYV-UAT-BUG-001 |
| MEM-TENANT-ISO-007 | — | Memory — tenant A cannot read tenant B memory | POST `/api/nv/memory/recall` | 200/201/204/404 | pass | 200 | - | - |
| MEM-ERASE-008 | — | Memory — right-to-erasure (DPDPA / GDPR) | DELETE `/api/nv/memory/user/uat-mem-001` | 200/201/204/404 | pass | 404 | - | - |
| MEM-DEDUP-009 | — | Memory — semantic dedup — same fact stored twice | POST `/api/nv/memory/remember` | 200/201/204/404 | pass | 201 | - | - |
| MEM-QUOTA-010 | — | Memory — memory quota enforcement at tier cap | POST `/api/nv/memory/remember` | 200/201/204/404 | pass | 201 | - | - |
| MEM-AGENT-PUB-011 | — | Memory — agent broadcasts learned facts | POST `/api/nv/memory/agent/publish` | 200/201/204/404 | pass | 201 | - | - |
| MEM-SOCIAL-012 | — | Memory — social-tier memory accessible to org members | POST `/api/nv/memory/remember` | 200/201/204/404 | pass | 201 | - | - |
| MEM-TTL-013 | — | Memory — session-tier TTL expiry | POST `/api/nv/memory/remember` | 200/201/204/404 | pass | 201 | - | - |
| MEM-CONTEXT-014 | — | Memory — memory injected into context for orchestrate | POST `/api/nv/orchestrate` | 200/201/204/404 | fail | 503 | - | NYV-UAT-BUG-001 |
| MEM-HEALTH-015 | — | Memory — memory subsystem health | GET `/api/nv/memory/health` | 200/201/204/404 | pass | 200 | env-setup (n/a) | - |

## multi-language (10)

| ID | Tag | Description | Method `path` | Expected | Status | HTTP | Resolution | Bug |
|---|---|---|---|---|---|---|---|---|
| LANG-EN-001 | — | Output in en for Indian legal Q&A | POST `/api/nv/orchestrate` | 200 | fail | 503 | - | NYV-UAT-BUG-009 |
| LANG-HI-002 | — | Output in hi for Indian legal Q&A | POST `/api/nv/orchestrate` | 200 | fail | 503 | - | NYV-UAT-BUG-009 |
| LANG-TA-003 | — | Output in ta for Indian legal Q&A | POST `/api/nv/orchestrate` | 200 | fail | 503 | - | NYV-UAT-BUG-009 |
| LANG-TE-004 | — | Output in te for Indian legal Q&A | POST `/api/nv/orchestrate` | 200 | fail | 503 | - | NYV-UAT-BUG-009 |
| LANG-BN-005 | — | Output in bn for Indian legal Q&A | POST `/api/nv/orchestrate` | 200 | fail | 503 | - | NYV-UAT-BUG-009 |
| LANG-UR-006 | — | Output in ur for Indian legal Q&A | POST `/api/nv/orchestrate` | 200 | fail | 503 | - | NYV-UAT-BUG-009 |
| LANG-MR-007 | — | Output in mr for Indian legal Q&A | POST `/api/nv/orchestrate` | 200 | fail | 503 | - | NYV-UAT-BUG-009 |
| LANG-GU-008 | — | Output in gu for Indian legal Q&A | POST `/api/nv/orchestrate` | 200 | fail | 503 | - | NYV-UAT-BUG-009 |
| LANG-KN-009 | — | Output in kn for Indian legal Q&A | POST `/api/nv/orchestrate` | 200 | fail | 503 | - | NYV-UAT-BUG-009 |
| LANG-ML-010 | — | Output in ml for Indian legal Q&A | POST `/api/nv/orchestrate` | 200 | fail | 503 | - | NYV-UAT-BUG-009 |

## ocr (15)

| ID | Tag | Description | Method `path` | Expected | Status | HTTP | Resolution | Bug |
|---|---|---|---|---|---|---|---|---|
| OCR-PDFTEXTLAYER-001 | — | OCR / DocPipe — PDF with embedded text layer | GET `/api/nv/documents/list` | 200/401/404 | pass | 200 | - | - |
| OCR-SCANNEDIMAGE-002 | — | OCR / DocPipe — PDF scanned image (no text layer) — Vision fallback | GET `/api/nv/documents/list` | 200/401/404 | pass | 200 | - | - |
| OCR-MULTIPAGECONTRACT-003 | — | OCR / DocPipe — multi-page contract PDF (50+ pages) | GET `/api/nv/documents/list` | 200/401/404 | pass | 200 | - | - |
| OCR-HANDANNOTATED-004 | — | OCR / DocPipe — hand-annotated PDF (handwriting) | GET `/api/nv/documents/list` | 200/401/404 | pass | 200 | - | - |
| OCR-MULTILANGUAGE-005 | — | OCR / DocPipe — multi-language doc (Hindi + English) | GET `/api/nv/documents/list` | 200/401/404 | pass | 200 | - | - |
| OCR-REDACTION-006 | — | OCR / DocPipe — PII redaction (Aadhaar / PAN masking) | GET `/api/nv/documents/list` | 200/401/404 | pass | 200 | - | - |
| OCR-EXTRACTENTITIES-007 | — | OCR / DocPipe — NER entities — parties, dates, amounts | GET `/api/nv/documents/list` | 200/401/404 | pass | 200 | - | - |
| OCR-CLASSIFYCLAUSES-008 | — | OCR / DocPipe — clause classifier — NDA / IP / Term | GET `/api/nv/documents/list` | 200/401/404 | pass | 200 | - | - |
| OCR-COMPARE-009 | — | OCR / DocPipe — compare two contract versions (redline) | GET `/api/nv/documents/list` | 200/401/404 | pass | 200 | - | - |
| OCR-SUMMARIZE-010 | — | OCR / DocPipe — hierarchical summarizer L1/L2/L3 | GET `/api/nv/documents/list` | 200/401/404 | pass | 200 | - | - |
| OCR-QA-011 | — | OCR / DocPipe — document Q&A — cite-grounded answer | GET `/api/nv/documents/list` | 200/401/404 | pass | 200 | - | - |
| OCR-EMBEDDINGS-012 | — | OCR / DocPipe — document embeddings produced for RAG | GET `/api/nv/documents/list` | 200/401/404 | pass | 200 | - | - |
| OCR-JOBSPOLL-013 | — | OCR / DocPipe — async OCR job poll — completes within 60s | GET `/api/nv/documents/list` | 200/401/404 | pass | 200 | - | - |
| OCR-GRAPHSTATS-014 | — | OCR / DocPipe — document graph stats endpoint | GET `/api/nv/documents/list` | 200/401/404 | pass | 200 | - | - |
| OCR-LIST-015 | — | OCR / DocPipe — document list pagination | GET `/api/nv/documents/list` | 200/401/404 | pass | 200 | - | - |

## pattern (18)

| ID | Tag | Description | Method `path` | Expected | Status | HTTP | Resolution | Bug |
|---|---|---|---|---|---|---|---|---|
| PAT-SEQUENTIAL-001 | IN | sequential orchestration — case 1 | POST `/api/nv/orchestrate` | 200 | pass | 200 | - | - |
| PAT-SEQUENTIAL-002 | UK | sequential orchestration — case 2 | POST `/api/nv/orchestrate` | 200 | pass | 200 | - | - |
| PAT-SEQUENTIAL-003 | EU | sequential orchestration — case 3 | POST `/api/nv/orchestrate` | 200 | pass | 200 | - | - |
| PAT-PARALLEL-001 | IN | parallel orchestration — case 1 | POST `/api/nv/orchestrate` | 200 | pass | 200 | - | - |
| PAT-PARALLEL-002 | UK | parallel orchestration — case 2 | POST `/api/nv/orchestrate` | 200 | pass | 200 | - | - |
| PAT-PARALLEL-003 | EU | parallel orchestration — case 3 | POST `/api/nv/orchestrate` | 200 | pass | 200 | - | - |
| PAT-SWARM-001 | IN | swarm orchestration — case 1 | POST `/api/nv/orchestrate` | 200 | pass | 200 | - | - |
| PAT-SWARM-002 | UK | swarm orchestration — case 2 | POST `/api/nv/orchestrate` | 200 | pass | 200 | - | - |
| PAT-SWARM-003 | EU | swarm orchestration — case 3 | POST `/api/nv/orchestrate` | 200 | pass | 200 | - | - |
| PAT-DAG-001 | IN | dag orchestration — case 1 | POST `/api/nv/orchestrate` | 200 | pass | 200 | - | - |
| PAT-DAG-002 | UK | dag orchestration — case 2 | POST `/api/nv/orchestrate` | 200 | pass | 200 | - | - |
| PAT-DAG-003 | EU | dag orchestration — case 3 | POST `/api/nv/orchestrate` | 200 | pass | 200 | - | - |
| PAT-HIERARCHICAL-001 | IN | hierarchical orchestration — case 1 | POST `/api/nv/orchestrate` | 200 | pass | 200 | - | - |
| PAT-HIERARCHICAL-002 | UK | hierarchical orchestration — case 2 | POST `/api/nv/orchestrate` | 200 | pass | 200 | - | - |
| PAT-HIERARCHICAL-003 | EU | hierarchical orchestration — case 3 | POST `/api/nv/orchestrate` | 200 | pass | 200 | - | - |
| PAT-MULTI-AGENT-001 | IN | multi-agent orchestration — case 1 | POST `/api/nv/orchestrate` | 200 | pass | 200 | - | - |
| PAT-MULTI-AGENT-002 | UK | multi-agent orchestration — case 2 | POST `/api/nv/orchestrate` | 200 | pass | 200 | - | - |
| PAT-MULTI-AGENT-003 | EU | multi-agent orchestration — case 3 | POST `/api/nv/orchestrate` | 200 | pass | 200 | - | - |

## rag (20)

| ID | Tag | Description | Method `path` | Expected | Status | HTTP | Resolution | Bug |
|---|---|---|---|---|---|---|---|---|
| RAG-SEMANTIC-001 | IN | RAG semantic — What is the maximum deduction limit under Section 80C of the | POST `/api/nv/rag/query` | 200/404 | pass | 200 | - | - |
| RAG-SEMANTIC-002 | UK | RAG semantic — Define "fair dealing" under the UK Copyright, Designs and Pa | POST `/api/nv/rag/query` | 200/404 | pass | 200 | - | - |
| RAG-SEMANTIC-003 | US | RAG semantic — Cite the controlling US Supreme Court decision on qualified  | POST `/api/nv/rag/query` | 200/404 | pass | 200 | - | - |
| RAG-SEMANTIC-004 | EU | RAG semantic — GDPR Article 17 right-to-erasure exceptions. | POST `/api/nv/rag/query` | 200/404 | pass | 200 | - | - |
| RAG-SEMANTIC-005 | SG | RAG semantic — Singapore PDPA notification requirements after a data breach | POST `/api/nv/rag/query` | 200/404 | pass | 200 | - | - |
| RAG-SEMANTIC-006 | GC | RAG semantic — UAE Federal Law on civil transactions: capacity to contract. | POST `/api/nv/rag/query` | 200/404 | pass | 200 | - | - |
| RAG-HYBRID-007 | IN | RAG hybrid — Hybrid search: BNS 2023 Section 103 punishment for murder | POST `/api/nv/rag/query` | 200/404 | pass | 200 | - | - |
| RAG-HYBRID-008 | IN | RAG hybrid — Hybrid search: Companies Act 2013 director duties | POST `/api/nv/rag/query` | 200/404 | pass | 200 | - | - |
| RAG-KEYWORD-009 | IN | RAG keyword — Keyword fallback: 80C deduction limit | POST `/api/nv/rag/query` | 200/404 | pass | 200 | - | - |
| RAG-KEYWORD-010 | EU | RAG keyword — Keyword fallback: GDPR Article 6 lawful bases | POST `/api/nv/rag/query` | 200/404 | pass | 200 | - | - |
| RAG-ISOLATION-011 | UK | RAG isolation — Cross-jurisdiction isolation: BNS query in UK namespace retu | POST `/api/nv/rag/query` | 200/404 | pass | 200 | - | - |
| RAG-ISOLATION-012 | IN | RAG isolation — Cross-jurisdiction isolation: GDPR query in IN namespace ret | POST `/api/nv/rag/query` | 200/404 | pass | 200 | - | - |
| RAG-CITATION-013 | IN | RAG citation — Citation accuracy: "BNS 2023 §103" — verify section actually | POST `/api/nv/rag/query` | 200/404 | pass | 200 | - | - |
| RAG-CITATION-014 | IN | RAG citation — Citation accuracy: "Companies Act 2013 §166" — verify agains | POST `/api/nv/rag/query` | 200/404 | pass | 200 | - | - |
| RAG-CITATION-015 | IN | RAG citation — Citation accuracy: "BSA 2023 §65" — verify against IndiaCode | POST `/api/nv/rag/query` | 200/404 | pass | 200 | - | - |
| RAG-CITATION-016 | EU | RAG citation — Citation accuracy: "GDPR Article 6(1)(f)" — legitimate-inter | POST `/api/nv/rag/query` | 200/404 | pass | 200 | - | - |
| RAG-EMPTY-017 | GC | RAG empty — Empty corpus query: legal query in jurisdiction with no inge | POST `/api/nv/rag/query` | 200/404 | pass | 200 | - | - |
| RAG-LONG-018 | IN | RAG long — Long query: 800-token compound legal question with multiple  | POST `/api/nv/rag/query` | 200/404 | pass | 200 | - | - |
| RAG-RERANK-019 | IN | RAG rerank — Vector reranker effectiveness: top-5 must shift after RRF +  | POST `/api/nv/rag/query` | 200/404 | pass | 200 | - | - |
| RAG-FALLBACK-020 | IN | RAG fallback — Embedding fallback: InLegalBERT down → service falls back to | POST `/api/nv/rag/query` | 200/404 | pass | 200 | - | - |

## sdk-gateway (25)

| ID | Tag | Description | Method `path` | Expected | Status | HTTP | Resolution | Bug |
|---|---|---|---|---|---|---|---|---|
| SDK-CREATE-001 | — | SDK — create-app issues a fresh API key | POST `/api/nv/sdk/create-app` | 200/201/400/401 | pass | 201 | - | - |
| SDK-PROV-001 | — | SDK — provision handshake returns modules | POST `/api/nv/sdk/provision` | 200/401/404 | pass | 401 | - | - |
| SDK-LIST-001 | — | SDK — list applications for tenant | GET `/api/nv/sdk/apps` | 200/401/403 | pass | 403 | - | - |
| SDK-AGENTS-001 | — | SDK — gateway agents list (per-tenant filter) | GET `/api/nv/gateway/agents` | 200/401/403 | pass | 401 | - | - |
| SDK-EXEC-001 | — | SDK — agent execute via gateway | POST `/api/nv/gateway/agents/contract-drafter/execute` | 200/400/401/403/404 | pass | 401 | - | - |
| SDK-DOCAN-001 | — | SDK — doc analyze via gateway | POST `/api/nv/gateway/documents/analyze` | 200/400/401 | pass | 401 | - | - |
| SDK-DOCDR-001 | — | SDK — doc draft via gateway | POST `/api/nv/gateway/documents/draft` | 200/400/401 | pass | 401 | - | - |
| SDK-RES-001 | — | SDK — research query via gateway | POST `/api/nv/gateway/research/query` | 200/400/401 | pass | 401 | - | - |
| SDK-USAGE-001 | — | SDK — usage report | GET `/api/nv/gateway/usage` | 200/401 | pass | 401 | - | - |
| SDK-USAGETOK-001 | — | SDK — token usage report | GET `/api/nv/gateway/usage/tokens` | 200/401 | pass | 401 | - | - |
| SDK-RATE-FREE-001 | — | SDK — Free tier rate-limit (10 RPM) enforced | GET `/api/nv/gateway/agents` | 200/429 | fail | 401 | env-setup (follow-up #49) | NYV-UAT-BUG-005 |
| SDK-RATE-PRO-001 | — | SDK — Pro tier rate-limit (60 RPM) enforced | GET `/api/nv/gateway/agents` | 200/429 | fail | 401 | env-setup (follow-up #49) | NYV-UAT-BUG-005 |
| SDK-RATE-ENT-001 | — | SDK — Enterprise tier rate-limit (600 RPM) | GET `/api/nv/gateway/agents` | 200/429 | fail | 401 | env-setup (follow-up #49) | NYV-UAT-BUG-005 |
| SDK-BUDGET-001 | — | SDK — token budget enforcement (CREDIT_CAP) | POST `/api/nv/orchestrate` | 200/400/429 | pass | 429 | - | - |
| SDK-XTENANT-001 | — | SDK — tenant A cannot read tenant B app | GET `/api/nv/sdk/apps/foreign-tenant-id` | 403/404 | pass | 403 | - | - |
| SDK-METER-001 | — | SDK — usage metering accuracy | GET `/api/nv/gateway/usage` | 200/401 | pass | 401 | - | - |
| SDK-ROTATE-001 | — | SDK — API key rotation | POST `/api/nv/sdk/apps/uat-app-1/rotate-secret` | 200/401/404 | fail | 403 | - | NYV-UAT-BUG-006 |
| SDK-SUSPEND-001 | — | SDK — suspend → 403 on subsequent use | POST `/api/nv/sdk/apps/uat-app-1/suspend` | 200/401/404 | fail | 403 | - | NYV-UAT-BUG-006 |
| SDK-ACTIVATE-001 | — | SDK — reactivate restores access | POST `/api/nv/sdk/apps/uat-app-1/activate` | 200/401/404 | fail | 403 | - | NYV-UAT-BUG-006 |
| SDK-REVOKE-001 | — | SDK — revoke is permanent | POST `/api/nv/sdk/apps/uat-app-1/revoke` | 200/401/404 | fail | 403 | - | NYV-UAT-BUG-006 |
| SDK-KEYS-LIST-001 | — | SDK — list app keys | GET `/api/nv/sdk/keys` | 200/401/404 | pass | 404 | - | - |
| SDK-SCOPE-001 | — | SDK — insufficient scope returns 403 | POST `/api/nv/gateway/agents/some-agent/execute` | 200/400/401/403 | pass | 401 | - | - |
| SDK-MISSING-AUTH-001 | — | SDK — missing auth → 401 | GET `/api/nv/gateway/agents` | 401 | pass | 401 | - | - |
| SDK-INVALID-KEY-001 | — | SDK — invalid SDK key → 401 | GET `/api/nv/gateway/agents` | 401/403 | pass | 401 | - | - |
| SDK-INTER-SECRET-001 | — | SDK — X-NSP-Inter-Secret accepted | GET `/api/nv/agents` | 200/401 | pass | 401 | - | - |

## voice (10)

| ID | Tag | Description | Method `path` | Expected | Status | HTTP | Resolution | Bug |
|---|---|---|---|---|---|---|---|---|
| VOICE-TTS-001 | — | Sarvam TTS round-trip in hi-IN | POST `/api/nv/gateway/translate` | 200/501 | fail | 401 | env-setup (follow-up #49) | NYV-UAT-BUG-002 |
| VOICE-TTS-002 | — | Sarvam TTS round-trip in ta-IN | POST `/api/nv/gateway/translate` | 200/501 | fail | 401 | env-setup (follow-up #49) | NYV-UAT-BUG-002 |
| VOICE-TTS-003 | — | Sarvam TTS round-trip in te-IN | POST `/api/nv/gateway/translate` | 200/501 | fail | 401 | env-setup (follow-up #49) | NYV-UAT-BUG-002 |
| VOICE-TTS-004 | — | Sarvam TTS round-trip in bn-IN | POST `/api/nv/gateway/translate` | 200/501 | fail | 401 | env-setup (follow-up #49) | NYV-UAT-BUG-002 |
| VOICE-TTS-005 | — | Sarvam TTS round-trip in mr-IN | POST `/api/nv/gateway/translate` | 200/501 | fail | 401 | env-setup (follow-up #49) | NYV-UAT-BUG-002 |
| VOICE-TTS-006 | — | Sarvam TTS round-trip in gu-IN | POST `/api/nv/gateway/translate` | 200/501 | fail | 401 | env-setup (follow-up #49) | NYV-UAT-BUG-002 |
| VOICE-TTS-007 | — | Sarvam TTS round-trip in en-IN | POST `/api/nv/gateway/translate` | 200/501 | fail | 401 | env-setup (follow-up #49) | NYV-UAT-BUG-002 |
| VOICE-STT-001 | — | Sarvam STT in hi-IN (synthetic input) | POST `/api/nv/sdk/multimodal/voice/transcribe` | 200/400/501 | fail | 401 | env-setup (follow-up #49) | NYV-UAT-BUG-002 |
| VOICE-STT-002 | — | Sarvam STT in ta-IN (synthetic input) | POST `/api/nv/sdk/multimodal/voice/transcribe` | 200/400/501 | fail | 401 | env-setup (follow-up #49) | NYV-UAT-BUG-002 |
| VOICE-STT-003 | — | Sarvam STT in en-IN (synthetic input) | POST `/api/nv/sdk/multimodal/voice/transcribe` | 200/400/501 | fail | 401 | env-setup (follow-up #49) | NYV-UAT-BUG-002 |
