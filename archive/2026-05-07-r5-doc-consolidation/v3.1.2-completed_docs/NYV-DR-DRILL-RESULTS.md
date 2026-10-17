---
status: completed
version: 3.1.2
superseded_by: null
last_verified: 2026-04-25
---
# Disaster recovery drill — results

> **Status**: Drill #0 (paper / table-top) executed 2026-04-23 against the
> Terraform plan and the documented runbooks (no live AWS spend yet).
> Drills #1–#4 are scheduled to run within 14 days of the first
> `terraform apply` in production. The append-only history table at the
> bottom is the source of truth for evidence.

## Why we drill

Backups you have never restored are not backups; runbooks you have never
exercised are fiction. Quarterly drills convert hope into evidence.

## Drill #0 — paper exercise (executed 2026-04-23)

**Goal**: Walk through every drill step-by-step against the actual scripts
and Terraform modules that ship in this repo. Surfaces broken commands,
missing IAM, or runbook drift before money is spent.

**Procedure**:
1. Read `NYV-RDS-MIGRATION-RUNBOOK.md` line-by-line; verify every CLI
   invocation against the modules in `infra/terraform/`.
2. Trace each step through `iam_partner` and `ec2_host` policies — every
   action must already be granted.
3. Run `terraform validate` in `envs/prod` and `envs/staging`.
4. Run `bash -n` over every script in `scripts/`.
5. Confirm `bootstrap-fresh-ec2.sh` writes a `bootstrap-report-*.log` and
   prints a structured summary at the end.

**Result**:
- Date: 2026-04-23
- Operator: platform-eng (paper)
- Findings:
  - ✅ All Terraform module references resolve; no missing variables.
  - ✅ All shell scripts pass `bash -n`.
  - ✅ Bootstrap report path + format matches what the readiness checklist
    promises.
  - ⚠ Drill #4 (region loss) requires `envs/prod-dr/` which is not yet
    written — tracked as a follow-up task.
- Outcome: PASS for #0; #1–#4 ready to execute against live infra.

## Drill #1 — RDS PITR restore

**Goal**: Verify we can restore the database to a point in time within 90
minutes, and that the application can be cut over to the restored copy.

**Procedure**:
1. Pick a point-in-time `T` (e.g. 30 min ago).
2. `aws rds restore-db-instance-to-point-in-time --source-db-instance-identifier nyv-prod-pg --target-db-instance-identifier nyv-pitr-drill --restore-time $T`
3. Wait for the new instance to become available (typical: 12–22 min on
   `db.t4g.medium`; AWS docs cite p99 ≤ 30 min).
4. Snapshot the schema diff vs current prod (should be zero unless schema
   migrations happened after `T`).
5. Optionally cut staging over to the restored DB and run the smoke suite.
6. Delete the restored instance.

**Predicted timings (from AWS docs + DB size)**:
- Time-to-available: 18 min ± 6 min
- Schema diff: < 1 min
- Smoke suite: 4 min
- Total RTO: ~25 min ; RPO: ≤ 5 min (PITR window)

**Last live result** _(fill in after first drill execution)_:
- Date: ____________
- Restore-to time: ____________
- Time-to-available: ____________ min  (target: < 30 min)
- Smoke suite: PASS / FAIL
- Notes:

## Drill #2 — EC2 host loss + reprovision

**Goal**: Verify we can replace the application host within 60 minutes
without losing data and with no manual config beyond running the existing
Terraform + bootstrap scripts.

**Procedure**:
1. In the AWS console, stop (don't terminate) the app instance during a
   low-traffic window.
2. Note the EIP — it stays attached to the stopped instance.
3. Mark the alarm as "in drill" so you don't page on-call.
4. From your workstation:
   ```bash
   cd infra/terraform/envs/prod
   terraform taint module.ec2_host.aws_instance.this
   terraform apply
   ```
5. Once the new instance is up:
   ```bash
   bash scripts/bootstrap-fresh-ec2.sh prod
   ```
6. Smoke test: `curl https://api.nyayasiddhi.online/health`.
7. Restart the original instance to be safe; verify only one is in the ALB
   target group.

**Predicted timings**:
- terraform taint + apply: 4–6 min
- cloud-init + bootstrap: 7–10 min (image pulls dominate)
- Health 200: ~15 min total RTO
- Data loss: 0 (RDS + Redis are external; logs ship to CloudWatch in real time)

**Last live result** _(fill in after first drill execution)_:
- Date: ____________
- Time from `terraform apply` to `/health` 200: ____________ min
- Notes:

## Drill #3 — Secrets Manager value rotation + roll back

**Goal**: Verify that we can rotate a critical secret (e.g. `jwt_secret`)
and roll back within 5 minutes if something breaks.

**Procedure**:
1. Note the current `AWSCURRENT` version id of `nyayavigya/staging/gateway/jwt_secret`.
2. `aws secretsmanager put-secret-value --secret-id nyayavigya/staging/gateway/jwt_secret --secret-string "$(openssl rand -hex 32)"`
3. Restart `nyv-gateway-staging`.
4. Verify a fresh login works (old JWTs become invalid; that's expected).
5. Use `update-secret-version-stage` to roll the version pointer back.
6. Restart `nyv-gateway-staging`.
7. Verify a token issued before step 2 still works.

**Predicted timing**: < 4 min end-to-end on staging.

**Last live result** _(fill in after first drill execution)_:
- Date: ____________
- End-to-end time: ____________ min
- Notes:

## Drill #4 — Region loss (paper drill)

**Goal**: Establish a written, time-bounded plan for ap-south-1 outage.

**Status**: Not yet attempted. Documented as a known gap in
`NYV-PRODUCTION-READINESS-CHECKLIST.md`. Becomes mandatory after the
first 3 months of production traffic.

**Plan outline (untested)**:
1. Trigger Route 53 health-check-driven failover to a CloudFront error page.
2. Bring up `infra/terraform/envs/prod-dr/` (a yet-to-be-written replica in
   `ap-south-2`) using the cross-region replicated RDS snapshot and
   replicated Secrets Manager values.
3. Update the Route53 records to point at the DR ALB.
4. Estimated RTO: 4 hours. Estimated RPO: 5 minutes (RDS PITR).

## Append-only history

| Date       | Drill | Operator      | Result | RTO   | RPO   | Notes |
|------------|-------|---------------|--------|-------|-------|---------------------------------------|
| 2026-04-23 | #0    | platform-eng  | PASS   | n/a   | n/a   | paper drill; no AWS spend; #4 follow-up tracked |
| _pending_  | #1    | _name_        | _PASS/FAIL_ | _min_ | _min_ | first live PITR restore               |
| _pending_  | #2    | _name_        | _PASS/FAIL_ | _min_ | _min_ | EC2 reprovision via taint + bootstrap |
| _pending_  | #3    | _name_        | _PASS/FAIL_ | _min_ | _min_ | secret rotation + rollback            |
| _pending_  | #4    | _name_        | _PASS/FAIL_ | _min_ | _min_ | cross-region failover                 |
