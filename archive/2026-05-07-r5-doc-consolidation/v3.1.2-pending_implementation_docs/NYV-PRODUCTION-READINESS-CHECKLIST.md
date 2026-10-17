---
status: pending
version: 3.1.2
superseded_by: null
last_verified: 2026-04-25
---
# Production readiness checklist

> Definition of "100% ready": every box on this checklist can be ticked. The
> Replit codebase is ready today; the AWS account and DNS provider have
> open boxes that require explicit operator action (and money).

> **Pre-GA deployment policy (effective 2026-04-25):**
> - **CI/CD path:** Replit→EC2 only (`pnpm deploy`,
>   `pnpm deploy:promote <tag>`, `pnpm deploy:rollback`). Bitbucket Pipelines
>   stay archived; no GitHub Actions added pre-GA.
> - **Terraform scope:** `envs/dev-edge` only — already applied and live.
>   `envs/staging/` and `envs/prod/` remain authored-but-not-applied until
>   v3.1.2 reaches GA on May 15. The platform runs on the existing
>   `nysdev` EC2 host and will continue to do so for the entire pre-GA
>   stretch.
> - **DNS:** BigRock → Route53 cutover **completed 2026-04-25**. 11 prod
>   hostnames return HTTP 200 over valid TLS (see §"DNS / TLS" below).

## Code & deploy automation — DONE

- [x] Single Replit→EC2 deploy script (`pnpm deploy`)
- [x] Promote staging→prod (`pnpm deploy:promote <tag>`) zero-downtime
- [x] Rollback (`pnpm deploy:rollback`)
- [x] Preflight (`pnpm preflight`) gates: typecheck, lint, vitest, secret-scan,
      dep-audit, env-coverage, **staging smoke** (`/health` + `/api/health` +
      `/api/nv/healthz` against `NYV_STAGING_BASE_URL`) — **mandatory by default**
      in `deploy-replit-direct.sh`; bypass only via `NYV_DEPLOY_SKIP_PREFLIGHT=1`
      (logged as UNGATED)
- [x] Bootstrap script for a fresh EC2 host (`scripts/bootstrap-fresh-ec2.sh`)
- [x] Bootstrap script for the whole ecosystem (`scripts/ecosystem-up.sh`)
- [x] Compose files for prod ecosystem + staging mirror
- [x] Caddy edge config with security headers + per-host routing for 14 subdomains
      + apex/www→console 301 redirect + per-IP rate-limit (rate_limit_strict /
      rate_limit_loose) baked into `nyv-caddy:2.8-ratelimit` via
      `infra/caddy/Dockerfile`
- [x] Tenant isolation middleware + automated 403 vitest test (11 cases).
      Dual-mounted: app-level on `/api/nv/*` after JWT `optionalAuth` for
      JWT-authenticated paths, AND inside every SDK sub-router immediately
      after `sdkGatewayAuth` so that cross-tenant claims on /api/nv/sdk/*,
      /api/nv/gateway/*, and /api/nv/v1/sdk/* are also rejected. Enforcement
      gated behind `NYV_TENANT_ENFORCE=1` (set in `docker-compose.staging.yml`
      and `docker-compose.ecosystem.yml`). Optional `strict` mode rejects
      unauthenticated SDK requests with 401.
- [x] ECR-mode deploy variants (`pnpm deploy --use-ecr` and `--ecr-push`)

> **Removed in 2026-04 — `--hot` flag.** Removed because the compose files do
> not bind-mount source, so a hot restart could not apply code changes. Use
> `pnpm deploy` (the default full deploy is fast enough) or partner CI's
> `--use-ecr` path. The historical note below is preserved for context.
>
> **Historical note: the prior `--hot` path performed an
> env-only `docker compose restart` of the gateway replicas; it does **not**
> ship new application code on its own. Use the default code+restart path for
> any code change. The `--hot` flag will be promoted to a true rsync-then-restart
> path in a follow-up; until then it is intentionally undocumented in the
> partner-facing PARTNER-DEPLOY-GUIDE.md.

## Infrastructure as code — DONE

- [x] Terraform bootstrap (S3 state + DynamoDB lock)
- [x] VPC module (3-AZ public/private/isolated + 1 NAT GW + S3 endpoint)
- [x] Route53 module (zone + 9 prod + 6 staging ALIAS records;
      apex + www ALIAS to ALB → Caddy 301-redirects to console)
- [x] ACM module (DNS-validated wildcard cert covering apex + www + *.<domain>)
- [x] ALB module (TLS 1.3, drop-invalid-headers, access-logs to S3)
- [x] WAF module (Common + Bad-Inputs + AmazonIpReputationList + per-IP rate,
      count-by-default; optional BotControl behind `enable_bot_control` flag)
- [x] ECR module (7 repos + lifecycle policy)
- [x] RDS module (Postgres 16, multi-AZ, PITR, optional read replica)
- [x] ElastiCache module (Redis 7.1, primary + replica, AUTH-token)
- [x] Secrets module (12 placeholder secrets per env)
- [x] CloudWatch module (8 log groups + 5 alarms + 1 dashboard + SNS)
- [x] Per-partner IAM module (5 roles, ECR + Secrets + CloudWatch + ELBv2
      target-group register/deregister scoped; trust validation errors out
      when neither `github_repo` nor `trusted_user_arn` is configured;
      `prod` env defaults to OIDC trust)
- [x] EC2 host module (Ubuntu 24.04, IMDSv2-only, instance role,
      SSM-only ingress by default — `extra_ingress_cidrs = []`)
- [x] Bootstrap script does host hardening (sshd / ufw / fail2ban /
      unattended-upgrades), EBS data-disk mount + fstab, idempotent
      compose up, in-container `db:push`, structured `bootstrap-report-*.log`
- [x] envs/prod/ + envs/staging/ wired with backend.tf + variables + Makefile
- [x] Tag policy enforced via `default_tags` in every provider

## Documentation — DONE

- [x] ARCHITECTURE-v6
- [x] CICD-REPLIT
- [x] DNS-AND-EDGE
- [x] PLATFORM-GOVERNANCE
- [x] PARTNER-DEPLOY-GUIDE
- [x] RDS-MIGRATION-RUNBOOK
- [x] REDIS-MEM0-SETUP
- [x] SECRETS-MANAGEMENT
- [x] OBSERVABILITY
- [x] INCIDENT-RUNBOOK
- [x] DR-DRILL-RESULTS (template, results pending each quarterly drill)
- [x] PRODUCTION-READINESS-CHECKLIST (this doc)
- [x] IAM-GAPS (auto-generated from terraform module simulation)
- [x] SECRETS-CLEANUP (auto-generated from grep)

## OPEN — operator actions (require AWS account + money + scheduled outage windows)

### Money / spend

- [x] **One-off**: `cd infra/terraform/bootstrap && terraform apply`
       (state bucket `nyv-tfstate-789925699169-ap-south-1` + lock table; live)
- [x] **One-off**: `cd infra/terraform/envs/dev-edge && terraform apply`
       (single-server stack — ALB + Route53 + ACM + EC2 + WAF in count
       mode; live and authoritative for `nyayasiddhi.online`)
- [ ] **DEFERRED until post-GA**: `cd infra/terraform/envs/staging && terraform apply`
       (~$50/mo recurring; not applied per pre-GA policy above)
- [ ] **DEFERRED until post-GA**: `cd infra/terraform/envs/prod && terraform apply`
       (~$200/mo recurring; not applied per pre-GA policy above)
- [ ] Set `alarm_email` in `terraform.tfvars` and confirm the SNS subscription email

### DNS / TLS — **DONE 2026-04-25**

- [x] BigRock NS records swapped to the four AWS nameservers
      (`ns-457`, `ns-831`, `ns-1111`, `ns-1846`). Public resolution
      confirmed via Google + Cloudflare DoH on 2026-04-24 and re-confirmed
      via live `curl` on 2026-04-25.
- [x] ACM cert (`*.nyayasiddhi.online` + apex + www) validated green.
- [x] Smoke probe: 11 hostnames (`nyayasiddhi.online`, `www`, `api`,
      `console`, `docs`, `status`, `pro`, `nym`, `ins`, `ace`, `min`) all
      return `/health` → 200 with `ssl_verify_result == 0`. Live gateway
      `/api/nv/health/full` reports `database: healthy`, `redis: healthy
      (ioredis_tcp)`, `llm: healthy`, version `v3.1.2`, uptime > 24h.
- [ ] Run SSL Labs on `api.nyayasiddhi.online` — target A or A+ (open).
- [x] Apex serves HTTP 200 from `nginx/1.27.5` — this is the intended
      AWS WAF / firewall front layer that sits in front of Caddy on the
      existing EC2 host. Confirmed by operator 2026-04-25: the firewall
      stays, the existing host (and its IP) stays, no apex redirect
      change required.

### Data plane

- [ ] Run `bash scripts/secrets-sync.sh prod .env.prod` (then verify and
      delete the local `.env.prod` per `NYV-SECRETS-CLEANUP.md`)
- [ ] Run the RDS migration runbook (`NYV-RDS-MIGRATION-RUNBOOK.md`)
- [ ] Run `bash scripts/bootstrap-fresh-ec2.sh prod` on the new EC2 host
- [ ] Verify `https://api.nyayasiddhi.online/health` returns 200

### Hardening

- [ ] Observe WAF in count mode for ≥ 1 week; review `Sampled Requests`
      for false positives
- [ ] Flip `waf_action = "block"` in `terraform.tfvars` and `terraform apply`
- [ ] Optional: enable RDS read replica (`create_rds_replica = true`) once
      read traffic justifies the +$27/mo
- [ ] Optional: set `nat_strategy = "per_az"` once cross-AZ NAT bandwidth
      becomes noticeable

### DR drills

- [x] Drill #0 (paper / table-top) executed 2026-04-23 — see
      `NYV-DR-DRILL-RESULTS.md` history table
- [ ] Run Drill #1 (RDS PITR) and append to `NYV-DR-DRILL-RESULTS.md`
- [ ] Run Drill #2 (EC2 reprovision) and append
- [ ] Run Drill #3 (secret rotation + rollback) and append
- [x] Drill #4 (region-loss) plan documented; live execution deferred to
      after the first 3 months of production traffic

### Cleanup of legacy paths

- [x] Repo-side cleanup executed 2026-04-24 — evidence in
      `archive/2026-04-cleanup/host-cleanup/repo-cleanup-snapshot-2026-04-24.txt`
      and `secrets-audit-2026-04-24.txt` (zero leaked keys, zero committed
      private keys)
- [ ] After successful operation for ≥ 30 days, delete the BigRock-side
      Bitbucket→EC2 webhook (if any) and the corresponding Bitbucket
      pipeline (we already archived the YAML)
- [ ] Delete unused Replit secrets per `NYV-SECRETS-CLEANUP.md`
- [ ] Run host cleanup on `13.232.165.242` (`NYV-INCIDENT-RUNBOOK.md` →
      "deployed-host cleanup") and append disk-usage diff to
      `archive/2026-04-cleanup/host-cleanup/`

## Sign-off

When every box above is ticked, the operator initials and dates here:

| Role | Name | Date |
|---|---|---|
| Platform owner | ____________ | ____________ |
| Security reviewer | ____________ | ____________ |
| Operations lead | ____________ | ____________ |
