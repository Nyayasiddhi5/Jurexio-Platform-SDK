---
status: canonical
version: 3.1.2
supersedes:
  - NYV-ARCHITECTURE-312.md
  - NYV-ARCHITECTURE-v6.md
last_verified: 2026-04-27
merged_at: 2026-05-01
merge_reason: NYV-NS-007 — eliminate doc-fragmentation between 312 and v6 trees
---

# Nyayavigya Platform 3.1.2 — Canonical System Architecture

> **Status:** WORK-IN-PROGRESS (live audit 2026-04-27). Live audit against
> `nv-dev-edge` RDS + ElastiCache + EC2 (`13.232.165.242`) on 2026-04-27 confirmed core wiring (gateway healthy, Redis 7.1 ElastiCache + 5 BullMQ queues w/DLQs registered, 1046 agents in `legal_agents`, NSP /orchestrate live), but surfaced material seed + schema gaps (missing `nv_pii_vault`, empty `nv_audit_logs` / `nv_rag_chunks` / `rag_namespaces` / `nv_organizations`, `nv_schema` 26 of ~50 expected tables). Treat counts in this doc as **target architecture**, not a deployment receipt. Reality snapshot: [`NYV-LIVE-AUDIT-GAP-REPORT-2026-04-27.md`](../NYV-LIVE-AUDIT-GAP-REPORT-2026-04-27.md).

> **Document reference:** NYV-ARCH-CANONICAL-001
> **Supersedes:** `NYV-ARCHITECTURE-312.md`, `NYV-ARCHITECTURE-v6.md`,
> `NYV-AWS-DEPLOYMENT-PLAN-10M.md`, `NYV-AWS-ONE-CLICK-DEPLOYMENT-v5.md`.

---

## 1. One-paragraph overview

Nyayavigya 3.1.2 is a single-tenant-per-API-key SaaS gateway that fronts five
ecosystem partner platforms (NyayaMitra, NYS-PRO, NYS-INS, NYS-ACE, NYS-MIN)
and exposes an SDK that those platforms (plus future external customers)
embed. All AI inference, governance, audit, billing, and tenant management
happens inside the gateway. Partner apps are thin frontends that hold an SDK
API key and proxy user-facing calls to the gateway.

## 2. Topology

```
                        ┌─────────────────────────────┐
                        │    BigRock NS  ─►  Route53   │
                        │ nyayasiddhi.online (zone)    │
                        └────────────┬─────────────────┘
                                     │  (alias records)
                                     ▼
                        ┌─────────────────────────────┐
       ACM cert ──────► │  AWS WAF  (count → block)   │
                        │  AWS ALB (TLS 1.2+, HSTS)   │
                        └────────────┬─────────────────┘
                                     │ HTTP :80 only
                                     ▼
                        ┌─────────────────────────────┐
                        │   EC2 t3.large (Ubuntu 24)  │
                        │   ┌──────────────────────┐  │
                        │   │ Caddy (host-routing) │  │
                        │   ├──────────┬───────────┤  │
                        │   │ gateway-a│ gateway-b │  │   docker-compose
                        │   ├──────────┴───────────┤  │   ecosystem.yml
                        │   │ console              │  │
                        │   ├──────────────────────┤  │
                        │   │ nym  nsp  nsi  nsa  nsm │
                        │   └──────────────────────┘  │
                        └────────┬────────────┬────────┘
                                 │            │
                  ┌──────────────▼──┐  ┌──────▼──────────┐
                  │ RDS Postgres 16 │  │ ElastiCache 7   │
                  │ multi-AZ, PITR  │  │ primary+replica │
                  └─────────────────┘  └─────────────────┘
                                 │
                  ┌──────────────▼──┐
                  │ Secrets Manager │  ←  scripts/secrets-sync.sh
                  └─────────────────┘
                                 │
                  ┌──────────────▼──┐
                  │ CloudWatch logs │  ←  awslogs driver per container
                  │ + alarms + dash │
                  └─────────────────┘
                                 │
                  ┌──────────────▼──┐
                  │     Sentry      │  ←  per-tenant DSN tag
                  └─────────────────┘
```

## 3. Microservices

| Service | Code | Port | Role |
|---------|------|------|------|
| API Gateway | NYV-SVC-GATEWAY | 5000 | Auth, routing, rate limits, agent execute |
| Orchestration | NYV-SVC-ORCH | 3001 | Agent jobs, BMAD, A2A, HITL |
| SDK Backend | NYV-SVC-SDK | 4000 | SDK app management |
| SDK Console | NYV-SVC-CONSOLE | 3004 | React dashboard |

## 4. Network

| Tier | CIDR (prod) | What lives there |
|---|---|---|
| public | 10.50.0/24, .1/24, .2/24 | ALB, NAT GW |
| private | 10.50.10/24, .11/24, .12/24 | EC2 application host |
| isolated | 10.50.20/24, .21/24, .22/24 | RDS, ElastiCache (no internet egress) |

Staging mirrors the same layout under `10.51.0.0/16`. There is exactly one
NAT Gateway in the cost-optimised default; flip `nat_strategy = "per_az"` once
cross-AZ NAT bandwidth is noticeable.

VPC endpoints (gateway type) are configured for S3 so that ECR layer pulls
and SecretsManager reads do not traverse the NAT.

## 5. Compute

| Service | Image | Mem reservation | Replicas |
|---|---|---|---|
| `nyv-gateway` | gateway:latest | 1.5 GiB (limit 3 GiB) | 2 |
| `nyv-console` | console:latest | — | 1 |
| `nyv-{nym,nsp,nsi,nsa,nsm}-app` | partner images | — | 1 each |
| `nyv-caddy` | caddy:2-alpine | — | 1 |

Two gateway replicas allow `promote-staging-to-prod.sh` to perform a rolling
restart. Replica `a` runs queue workers (`NYV_QUEUE_WORKERS=on`); replica `b`
does not (`off`) so the BullMQ queue is single-consumer.

## 6. Data plane

- **Postgres 16.3** on `db.t4g.medium`, multi-AZ, gp3, encrypted.
  Backups: 14d retention, daily window 18:00 UTC.
  PITR: enabled (granular to 5 min).
- **Redis 7.1** on `cache.t4g.small` with one replica, multi-AZ, in-transit +
  at-rest encryption, AUTH token in Secrets Manager.
- Mem0 stores its embeddings + episodic memory in a `nyv_mem0` schema on the
  same RDS instance. Vector embeddings use `pgvector` (installed in the
  parameter group).
- **ECR** holds 7 image repos under prefix `nyv-*`. Lifecycle keeps
  `prod`/`staging`/`latest`/`v*` forever; expires untagged > 10.

### 6.1 Database — 30 nv_* tables (target)

**Core infrastructure**
- `nv_users`, `nv_organizations`, `nv_sessions`, `nv_auth_tokens`,
  `nv_feature_flags`, `nv_system_configs`

**Agent management**
- `nv_agents`, `nv_agent_configs`, `nv_agent_performance`,
  `nv_agent_personas`, `nv_roma_levels`

**SDK management** (post-NYV-NS-002 unification, 2026-05-01)
- `sdk_applications` *(canonical, integer id)* + `sdk_app_api_keys`
- `nv_sdk_applications` + `nv_api_keys` *(legacy UUID schema, deprecated; backfilled by drizzle/0006)*
- `nyv_sdk_legacy_id_map` *(UUID → integer mapping, NYV-NS-002)*
- `nv_sdk_usage_metrics`

**LLM and models**
- `nv_llm_providers`, `nv_model_catalog`, `nv_token_metrics`

**Orchestration**
- `nv_orchestration_jobs`, `nv_dag_jobs`, `nv_job_queue`, `nv_hitl_queue`,
  `nv_hitl_decisions`, `nv_bmad_clusters`, `nv_grpo_runs`

**Knowledge and documents**
- `nv_documents`, `nv_rag_documents`, `nv_rag_chunks`, `rag_namespaces`

**Memory and context**
- `nv_memory_entries`, `nv_chat_sessions`

**Tools and security**
- `nv_mcp_tools`, `nv_mcp_tool_calls`, `nv_audit_logs` *(hash-chain, NYV-NS-010 boot self-test)*, `nv_pii_vault`

**Operational**
- `nv_jurisdiction_configs`, `nv_workspace_projects`, `nv_voice_sessions`

## 7. Edge

- ALB terminates TLS 1.3 with a wildcard ACM cert.
- WAF: `AWSManagedRulesCommonRuleSet` + `KnownBadInputsRuleSet` + per-IP
  rate limit of 2000 req/5min. **Default action: count.** Operator flips
  to `block` after ≥ 1 week of clean baselines.
- ALB → EC2 :80 → Caddy host-router → container :PORT.
- Caddy emits HSTS, CSP, X-Frame-Options, Permissions-Policy, X-Content-Type-Options
  on every response.
- Express layer: `helmet` with `crossOriginResourcePolicy: 'cross-origin'`
  (NYV-LHF-A3, 2026-05-01) so partner apps can embed gateway-hosted assets.

## 8. CI/CD

Replit is the single source of truth. The deploy path is:

1. Operator presses "Deploy" in Replit → runs `bash scripts/deploy-replit-direct.sh`
   (or the convenience wrappers `scripts/deploy-dev.sh` / `scripts/deploy-prod.sh`,
   added 2026-05-01 under NYV-OPS-DEPLOY-MODE-001).
2. Preflight (typecheck warning-mode under NYV-OPS-DEPLOY-TSC-001, secret-scan,
   `pnpm preflight` when `NYV_DEPLOY_FULL_PREFLIGHT=1`) gates the deploy.
3. A tarball of the working tree is built and rsynced to EC2.
4. Atomic symlink swap → migrator → graceful container restart.
5. Outcome is recorded in `/opt/nyayavigya/CURRENT_DEPLOY` and
   `/opt/nyayavigya/LAST_GOOD_DEPLOY`.

For zero-downtime promotion of an image already validated in staging, use
`scripts/promote-staging-to-prod.sh <staging-tag>` — it re-tags the ECR image
and rolls gateway-b then gateway-a.

## 9. Secrets

Single source of truth: **AWS Secrets Manager** under prefix
`nyayavigya/<env>/<service>/<key>`. The container entrypoint
(`scripts/secrets-entrypoint.sh`) resolves them at boot. Local `.env` files
are dev-only and explicitly excluded from production tarballs. No demo
password lives in code; rotation goes through `scripts/nv-rotate-demo-password.ts`
(NYV-NS-003 / NYV-SECURITY-DOC-CREDS-001, 2026-05-01).

## 10. Observability

- **CloudWatch Logs:** 8 log groups under `/aws/nyayavigya/<env>/<svc>`,
  30-day retention.
- **CloudWatch Alarms (P1):** ALB 5xx > 10/min, target 5xx > 20/min, RDS CPU
  > 80%, RDS free storage < 5 GB, Redis CPU > 75%.
- **CloudWatch Dashboard:** `Nyayavigya-prod` shows ALB requests, target
  latency p95, RDS CPU + connections, Redis CPU + bytes used.
- **Sentry:** every release is tagged with the deploy id; tenant id is
  attached as a Sentry tag for all errors.

## 11. AI Protocols

| Protocol | Spec | Role |
|----------|------|------|
| A2A | Google A2A | Agent-to-Agent collaboration bus |
| MCP | Anthropic MCP | Model Context Protocol (tools) |
| ROMA | NYV custom | L1-L4 meta-agent promotion |
| AG-UI | CopilotKit | Agent-UI streaming |
| Parlant | Parlant | 7-template conversation journeys |
| BMAD | NYV custom | Multi-agent cluster orchestration |
| OpenAgent | OpenAgent | Cross-framework interop |

## 12. Security architecture

- JWT access tokens (24h) + refresh tokens (30d).
- JWT rotation monitor (auto-rotates on compromise; `nv-jwt-rotation-monitor`).
- Per-platform rate limiting (Solo: 100, Plus: 300, Pro: 1000, Enterprise:
  unlimited req/min).
- PII vault with AES-256 encryption (`nv_pii_vault` table).
- Guardrail enforcement on all AI responses.
- Hallucination detection on legal outputs.
- Audit log for all sensitive actions, hash-chained (NYV-NS-010 boot
  self-test asserts integrity on every cold start).
- Per-app prompt-injection screen + PII redactor in `nv-sdk-gateway` middleware.

## 13. Tenancy + governance

- One database per tenant is overkill for our scale; we use **schema-per-major-
  tenant + row-level filtering** keyed on `organization_id`.
- The `nv-tenant-isolation` middleware enforces that every claimed tenant
  matches the authenticated tenant (vitest-covered, returns 403).
- Per-partner IAM roles scope ECR push, Secrets read, and CloudWatch write
  to the partner's namespace only.

## 14. Disaster recovery

| Failure | Detection | Recovery |
|---|---|---|
| Gateway crash loop | ALB target 5xx alarm | `bash scripts/deploy-prod.sh --rollback` |
| RDS AZ failure | Multi-AZ failover transparent | Automated, ≤ 90s |
| RDS data loss | PITR restore | `aws rds restore-db-instance-to-point-in-time …` |
| EC2 instance loss | EIP + Terraform | Re-run `terraform apply` then `bash scripts/bootstrap-fresh-ec2.sh prod` |
| Region loss | Manual | Re-run terraform in `ap-south-2` (untested; documented as a known gap in DR-DRILL-RESULTS) |

## 15. Out of scope (vendor-locked-in alternatives we explicitly rejected)

| Dropped | Why |
|---|---|
| Bitbucket pipelines | Replit is now the single CI/CD origin |
| Razorpay | Billing pipe deferred to v6.1 |
| SendGrid | AWS SES once we need transactional email |
| Cloudflare | ALB + WAF already covers us; one less vendor to manage |

## 16. Cross-references

- Developer onramp + module catalogue + sprint roadmap:
  [`NYV-TECH-SPEC-MASTER.md`](./NYV-TECH-SPEC-MASTER.md) §14
- Live audit gap report:
  [`../NYV-LIVE-AUDIT-GAP-REPORT-2026-04-27.md`](../NYV-LIVE-AUDIT-GAP-REPORT-2026-04-27.md)
- SDK lockdown rationale: `Project-Tracker.md` §1
