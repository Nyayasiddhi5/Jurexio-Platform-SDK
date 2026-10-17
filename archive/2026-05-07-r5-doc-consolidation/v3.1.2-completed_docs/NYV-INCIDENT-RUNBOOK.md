---
status: completed
version: 3.1.2
superseded_by: null
last_verified: 2026-04-25
---
# Incident runbook

For every alert listed in `NYV-OBSERVABILITY.md`, this doc tells the
on-call operator what to do.

## Triage decision tree (≤ 60 seconds)

1. Open the CloudWatch dashboard `Nyayavigya-prod`.
2. Check Sentry inbox for errors in the last 15 min.
3. Check Caddy access log tail for the suspicious host.
4. Pick the matching playbook below.

## Playbook: ALB 5xx alarm

**Symptom**: `nyv-prod-alb-5xx` fires.

1. SSH to EC2 host, check container health:
   ```bash
   docker ps --format 'table {{.Names}}\t{{.Status}}'
   ```
2. If a gateway is unhealthy:
   ```bash
   docker logs --tail 200 nyv-gateway-a
   ```
3. If both gateways look fine, check WAF metrics in CloudWatch — a sudden
   surge of `block` decisions means a (real or false-positive) attack.
4. If the cause is a recent deploy, **roll back**:
   ```bash
   pnpm deploy:rollback
   ```
5. Post in #ops with: alarm name, root cause hypothesis, action taken.

## Playbook: target 5xx alarm

**Symptom**: `nyv-prod-target-5xx` fires (the gateway itself returned 5xx).

1. Open Sentry → filter `environment:prod` → look at the top 3 errors of the
   last hour.
2. If a single error class dominates → likely a code bug → roll back.
3. If errors are spread across many classes → likely a downstream issue:
   - DB unreachable → check `nyv-prod-rds-cpu` and RDS console events
   - Upstream LLM provider 5xx → check provider status page
4. Document the call in `/opt/nyayavigya/logs/incidents.log`.

## Playbook: RDS CPU > 80%

1. Look at `pg_stat_statements`:
   ```bash
   docker exec -it nyv-gateway-a node -e "
     const c = await (await import('pg')).Client({connectionString:process.env.DATABASE_URL});
     await c.connect();
     const r = await c.query(\"SELECT round(total_exec_time::numeric,1) AS t, calls, query FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT 10\");
     console.table(r.rows);
   "
   ```
2. If a single tenant is responsible (look at `tenant` tags in CloudWatch),
   investigate possible runaway agent loop.
3. If CPU stays > 80% for > 30 min, scale RDS:
   ```bash
   cd infra/terraform/envs/prod
   # bump instance_class to db.t4g.large in main.tf, then:
   terraform apply
   ```
   Note: instance resize causes a 1-2 minute failover (multi-AZ makes this
   transparent).

## Playbook: RDS storage low

1. Check what's growing:
   ```sql
   SELECT relname, pg_size_pretty(pg_total_relation_size(oid)) AS size
   FROM pg_class WHERE relkind='r' ORDER BY pg_total_relation_size(oid) DESC LIMIT 20;
   ```
2. Most common culprits: `nyv_mem0.memory`, `audit_log`, `chat_messages`.
3. Run the appropriate retention job:
   ```sql
   DELETE FROM nyv_mem0.memory WHERE expires_at IS NOT NULL AND expires_at < now();
   DELETE FROM audit_log WHERE created_at < now() - interval '180 days';
   ```
4. If still low, increase `max_allocated_storage_gb` in
   `infra/terraform/modules/rds/main.tf` and `terraform apply`. RDS auto-grows
   storage without downtime.

## Playbook: Redis CPU high

1. Check the slow log:
   ```bash
   docker exec -it nyv-gateway-a node -e "
     const r = require('ioredis');
     const c = new r(process.env.REDIS_URL);
     console.log(await c.slowlog('GET', 50));
     process.exit(0);
   "
   ```
2. If a particular key pattern is hot, check whether you can move it to
   in-memory LRU on the gateway side (most cache invariants don't need
   Redis cross-replica consistency).
3. Bump `cache.t4g.small` → `cache.t4g.medium` in
   `infra/terraform/modules/elasticache/main.tf` and `terraform apply`.

## Playbook: Gateway crash loop after deploy

1. Look at the auto-rollback line in `deploy-replit-direct.sh` output. If it
   ran, you are already on the previous release.
2. If it did not run (rare; means swap succeeded but health continued to
   degrade after several minutes):
   ```bash
   pnpm deploy:rollback
   ```
3. Triage with `docker logs --tail 500 nyv-gateway-a`.

## Routine: deployed-host cleanup

Once a quarter, free disk on the EC2 host:

```bash
ssh ubuntu@13.232.165.242 '
  set -e
  echo "BEFORE:"; df -h / /opt
  docker image prune -af
  docker container prune -f
  docker volume prune -f
  sudo journalctl --vacuum-time=7d
  ls /opt/nyayavigya/releases | sort | head -n -5 | xargs -I{} rm -rf /opt/nyayavigya/releases/{}
  echo "AFTER:"; df -h / /opt
' | tee /tmp/host-cleanup-$(date +%Y%m%d).log

# Append the before/after to the archive
cp /tmp/host-cleanup-*.log archive/2026-04-cleanup/host-cleanup/
```

## Routine: weekly checklist

- [ ] Glance at the dashboard — any flat or runaway lines?
- [ ] Open Sentry → triage anything Unresolved > 7 days
- [ ] `aws rds describe-db-snapshots --db-instance-identifier nyv-prod-pg --max-items 3` — confirm last snapshot is < 24h
- [ ] Glance at WAF Sampled Requests in CloudWatch — anything odd?
- [ ] `pnpm audit --prod --audit-level=high` — any new advisories?

## Edge port conflict (`:80` already allocated)

**Symptom.** `docker compose up` for the staging or prod stack fails with:

```
Error response from daemon: driver failed programming external connectivity
on endpoint nyv-caddy-staging: bind for 0.0.0.0:80 failed: port is already
allocated
```

**Root cause.** Both `docker-compose.ecosystem.yml` (prod Caddy) and
`docker-compose.staging.yml` (staging Caddy) publish container port 80 on
host port 80. Only one of them can hold `:80` on the same EC2 host at any
moment. This is intentional: prod and staging are designed to live on
**separate** EC2 hosts, each behind its own ALB target group.

**Resolution paths (pick one):**

1. **Recommended — separate EC2 hosts.** Provision a second EC2 from
   `infra/terraform/envs/staging/` and point the staging ALB target group
   at it. Production stays untouched on `13.232.165.242`.
2. **Time-multiplex (DR drill only).** `docker compose -f
   docker-compose.ecosystem.yml down && docker compose -f
   docker-compose.staging.yml up -d`. Reverse to switch back.
3. **Port-remap staging (short-lived experiments).** Override the
   `caddy-staging` ports to `["8080:80"]` and re-target the staging ALB
   target group at host port 8080. Document the override in the change
   log because the ALB plan in Terraform does not yet model alternate
   ports.

The supported topology in `NYV-PRODUCTION-READINESS-CHECKLIST.md` is
option (1). Options (2) and (3) are escape hatches for emergencies.
