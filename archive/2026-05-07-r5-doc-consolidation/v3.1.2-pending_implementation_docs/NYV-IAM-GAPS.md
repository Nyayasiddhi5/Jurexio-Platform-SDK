---
status: pending
version: 3.1.2
superseded_by: null
last_verified: 2026-04-25
---
# IAM gaps — module-level review

This document is hand-maintained from a manual simulation of every IAM
policy attached by the Terraform modules. Re-run the review after every
material policy change. The "gap" column lists known weaknesses the operator
should be aware of even if the policy ships as-is.

## EC2 host instance role (`<env>-app-host`)

Source: `infra/terraform/modules/ec2_host/main.tf` → `aws_iam_role_policy.host`.

| Statement | Actions | Resources | Gap |
|---|---|---|---|
| ReadSecrets | secretsmanager:GetSecretValue, DescribeSecret | `nyayavigya/<env>/*` | None — scoped to env. Cross-env read is impossible. |
| WriteLogs | logs:CreateLogGroup, CreateLogStream, PutLogEvents, DescribeLogStreams | `/aws/nyayavigya/*` | **Gap:** the resource glob is `/aws/nyayavigya/*` (covers all envs). Acceptable because each EC2 host writes to its own env's log groups in practice (group name baked into the awslogs driver), but tighten to `/aws/nyayavigya/<env>/*` if you ever co-locate envs on one host. |
| EcrAuth | ecr:GetAuthorizationToken | `*` | Required by AWS — there is no resource-level scoping for `GetAuthorizationToken`. |
| Elbv2DescribeEverywhere | elasticloadbalancing:DescribeTargetGroups, DescribeTargetHealth, DescribeListeners, DescribeRules | `*` | Required by AWS — Describe* APIs do not support resource-level conditions. Read-only metadata only. |
| Elbv2RegisterTargetsScoped | elasticloadbalancing:RegisterTargets, DeregisterTargets | `var.tg_arns` | **Empty by default** in `envs/prod` because the platform uses the shared-Caddy edge model (one ALB target group → Caddy → per-partner Host-routed upstreams). Granting any partner Register/Deregister on the *shared* TG would be a privilege escalation: any partner could deregister the edge container and take down every other partner. The list is wired up so a partner with its own ALB TG (future per-partner edge) can be granted scoped access without policy churn. |
| EcrPullScoped | ecr:BatchCheckLayerAvailability, GetDownloadUrlForLayer, BatchGetImage | configured ECR repo ARNs (`var.ecr_repo_arns`) | None when ARNs are passed. **Gap:** falls back to `*` if `var.ecr_repo_arns` is empty. The prod env passes them; the staging env passes the prod env's ARNs (so staging can pull prod images for promotion drills). |
| SsmCore | ssm/ssmmessages/ec2messages | `*` | Required by AWS for Session Manager. |

## Per-partner deploy role (`nyv-<env>-<partner>-deploy`)

Source: `infra/terraform/modules/iam_partner/main.tf`.

| Statement | Actions | Resources | Gap |
|---|---|---|---|
| EcrReadEverywhere | ecr:GetAuthorizationToken | `*` | Required (see above). |
| EcrPushPullScoped | ecr:* push/pull verbs | partner's ECR repo ARNs | None — scoped per partner. |
| SecretsReadScoped | secretsmanager:GetSecretValue, DescribeSecret, ListSecretVersionIds | `arn:aws:secretsmanager:*:*:secret:nyayavigya/<env>/<partner>/*` | None. |
| CloudWatchLogsWriteScoped | logs:CreateLogGroup, CreateLogStream, PutLogEvents, DescribeLogStreams | `arn:aws:logs:*:*:log-group:/aws/nyayavigya/<env>/<partner>*` | None. |
| Trust policy | sts:AssumeRole / AssumeRoleWithWebIdentity | IAM user OR GitHub OIDC `repo:<org>/<repo>:*` | **Gap:** `:*` allows any GitHub branch to assume the role. To tighten, change the StringLike condition to `repo:<org>/<repo>:ref:refs/heads/main` (only main branch can deploy to prod). |

### Trust-policy defaults (envs/prod, envs/staging)

The `iam_partner` module accepts both an OIDC trust (`github_repo`) and a
legacy IAM-user trust (`trusted_user_arn`). The env wiring picks OIDC
**whenever a partner is listed in `partner_github_repos` in tfvars**:

```hcl
github_repo      = lookup(var.partner_github_repos, each.key, null)
trusted_user_arn = lookup(var.partner_github_repos, each.key, null) == null
                     ? var.fallback_iam_user_arn : null   # STAGING-ONLY now (removed from prod 2026-04)
```

Operator action to enforce **OIDC-only trust** (recommended for prod):

1. List every partner in `partner_github_repos` in
   `infra/terraform/envs/prod/terraform.tfvars`.
2. **PROD: completed 2026-04** — `fallback_iam_user_arn` removed entirely
   from `envs/prod/`; the iam_partner module precondition now refuses to
   plan when `env="prod"` and `trusted_user_arn != null`. Staging may
   still use the fallback during partner CI bring-up.
3. Set `fallback_iam_user_arn = null` (or leave unset) on staging so any partner that
   is somehow missing from the OIDC map causes terraform to plan a role
   with **no trust at all** rather than silently fall back to the developer
   IAM user.
3. After `terraform apply`, delete the access keys on the developer IAM
   user — the OIDC trust does not need them.

## ALB access-logs S3 bucket

Source: `infra/terraform/modules/alb/main.tf` → `aws_s3_bucket_policy.alb_logs`.

| Statement | Allows | Gap |
|---|---|---|
| Allow ALB service principal to PutObject | account `718504428378` (ELB service in ap-south-1) | None — this is the AWS-published service principal for ap-south-1. Hard-coded; if you ever copy this module to a different region, swap to the regional service principal. |

## RDS master credentials secret

Source: `infra/terraform/modules/rds/main.tf` → `aws_secretsmanager_secret.rds_master`.

| Reader | Allowed via |
|---|---|
| EC2 host instance role | `ReadSecrets` on `nyayavigya/<env>/*` (the secret name `<env>-app-pg/rds/master` does NOT match the prefix; **gap below**) |

**Known gap**: the RDS master secret is named `<env>-app-pg/rds/master`,
which is OUTSIDE the `nyayavigya/<env>/*` prefix that the EC2 host role
permits reading. As a result the gateway cannot read the RDS master
credentials directly. This is intentional — the gateway connects to RDS
using a non-master user via `DATABASE_URL`, which lives at
`nyayavigya/<env>/gateway/database_url`. The master credentials are for
break-glass use by the human operator only.

To tighten further, attach an explicit "Deny" statement on the EC2 instance
role for the master secret:

```hcl
{
  Sid      = "DenyMasterRds"
  Effect   = "Deny"
  Action   = ["secretsmanager:*"]
  Resource = "arn:aws:secretsmanager:*:*:secret:*-pg/rds/master*"
}
```

(Not added by default — the implicit deny via the prefix mismatch is already
sufficient.)

## Bootstrap state bucket

Source: `infra/terraform/bootstrap/main.tf`.

| Setting | Value | Gap |
|---|---|---|
| BlockPublicAcls / BlockPublicPolicy / IgnorePublicAcls / RestrictPublicBuckets | true × 4 | None |
| SSE | AES-256 (S3-managed) | **Possible gap:** if your compliance posture requires KMS-CMK, switch to `aws:kms` and wire a key. AES-256 is FIPS 140-2 compliant. |
| Versioning | Enabled | None |
| Lifecycle: noncurrent-cleanup | 365d | None |

## Account-wide gaps (beyond the modules)

- **No CloudTrail trail in this Terraform.** The AWS account has the
  default management-event trail. If you need data-event auditing on the
  ALB access-logs bucket or Secrets Manager, add an `aws_cloudtrail`
  resource (deferred — costs grow with API call volume).
- **No GuardDuty / Config / Security Hub.** Out of scope for the budget.
  Re-evaluate at quarterly review.
- **No SCP / Organizations.** Single-account setup. Consider AWS Organizations
  once a second account (e.g. for CI runners) is created.
