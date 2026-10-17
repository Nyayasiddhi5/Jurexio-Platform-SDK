# Nyayavigya Terraform IaC

All AWS infrastructure for the Nyayavigya platform is defined here. The repo is the single source of truth — every `terraform apply` is reviewed, planned, and version-controlled.

## Layout

```
infra/terraform/
├── bootstrap/        # one-shot: S3 state bucket + DynamoDB lock table
├── modules/          # reusable building blocks
│   ├── vpc/             3-AZ VPC with public + private + isolated-db subnets
│   ├── route53/         hosted zone for nyayasiddhi.online + record sets
│   ├── acm/             ACM certificate (DNS validation, *.nyayasiddhi.online)
│   ├── alb/             Application Load Balancer + listeners + target groups
│   ├── waf/             WAFv2 web ACL (Common + Bad-Inputs + rate-limit)
│   ├── ecr/             ECR repos for the 7 platform images + lifecycle policy
│   ├── rds/             RDS Postgres 16 multi-AZ with PITR + read replica
│   ├── elasticache/     ElastiCache Redis 7.x with primary + replica
│   ├── secrets/         AWS Secrets Manager secrets for the platform
│   ├── cloudwatch/      log groups + alarms + dashboards
│   ├── iam_partner/     per-partner IAM role + scoped policy + OIDC trust
│   └── ec2_host/        application EC2 host (t3.large/m5.large) + EIP
└── envs/
    ├── prod/            us reads modules; produces production stack
    └── staging/         smaller-footprint mirror (single-AZ, no replicas)
```

## First-time bootstrap (run ONCE per AWS account)

```bash
cd infra/terraform/bootstrap
terraform init
terraform apply
# → creates s3://nyv-tfstate-789925699169-ap-south-1 and DynamoDB table nyv-tfstate-locks
```

After the bootstrap completes, the prod/staging envs use the S3 backend defined in `envs/{env}/backend.tf`.

## Standard workflow (per env)

```bash
cd infra/terraform/envs/prod   # or envs/staging
terraform init                 # only needed once per workstation
make plan                      # shows the diff vs live AWS
make apply                     # ⚠️  spends real money — needs operator approval
make destroy                   # ⚠️  tears it all down
```

The Makefile wraps these with `-var-file=terraform.tfvars` and a guard that prints estimated monthly cost before any apply.

## Tag policy (enforced via default_tags + module-level merge)

Every resource carries:

| Tag | Value |
|---|---|
| `Project` | `Nyayavigya` |
| `Env` | `prod` or `staging` |
| `ManagedBy` | `terraform` |
| `Owner` | `nyayavigya-platform` |
| `CostCenter` | `engineering` |
| `Repo` | `nyayasiddhi/nyayavigya-platform-312` |

## Cost guardrails (target ≤ ₹15,000 / ~$180 per month)

| Resource | Tier | Approx. monthly |
|---|---|---|
| EC2 application host | t3.large | $61 |
| RDS Postgres | db.t4g.medium multi-AZ | $54 |
| ElastiCache Redis | cache.t4g.small + replica | $24 |
| ALB | 1 × | $16 |
| NAT Gateway | 1 × (single-AZ, with cost note) | $32 |
| Route53 hosted zone | 1 × | $0.50 |
| WAF | Common + Bad-Inputs + rate | $5 |
| Secrets Manager | 12 secrets | $4.80 |
| CloudWatch | logs + 5 alarms + 1 dashboard | $5 |
| ECR | 7 repos × ~1 GB | $0.70 |
| **TOTAL** | | **~$203/mo** |

Staging adds ~$50/mo (small EC2, single-AZ RDS, no Redis replica).

To stay under $180/mo for prod-only:
- Drop the read replica on RDS until a real read-heavy workload appears (-$27)
- Use a NAT instance instead of a NAT Gateway (-$28)

Both options are commented in `envs/prod/main.tf`.

## What this IaC does NOT do

- It does NOT change your BigRock nameservers. After the Route53 hosted zone is created, the operator has to copy the four `ns-*.awsdns-*` nameservers into the BigRock control panel manually. See `docs/v3.1.2/completed_docs/NYV-DNS-AND-EDGE.md`.
- It does NOT create Razorpay / SendGrid / Cloudflare / Bitbucket integrations — those vendors are explicitly out of scope for Task #6.
- It does NOT bootstrap the application database schema. After `terraform apply` finishes, run `bash scripts/bootstrap-fresh-ec2.sh` and then `pnpm db:push` from inside the gateway container.
