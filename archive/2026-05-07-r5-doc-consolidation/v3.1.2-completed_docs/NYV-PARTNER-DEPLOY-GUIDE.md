---
status: completed
version: 3.1.2
superseded_by: null
last_verified: 2026-04-25
---
# Partner deploy guide

For maintainers of one of the five partner platforms (NYM, NSP, NSI, NSA,
NSM). Read the overview docs first:
[ARCHITECTURE-v6](./NYV-ARCHITECTURE-v6.md) and
[PLATFORM-GOVERNANCE](./NYV-PLATFORM-GOVERNANCE.md).

## What you have access to

After Terraform apply, your partner role exists at:

```
arn:aws:iam::789925699169:role/nyv-prod-<your_partner>-deploy
```

It can:

| Action | Resource scope |
|---|---|
| `ecr:Push` / `ecr:Pull` | `nyv-<your_partner>-app` only |
| `secretsmanager:GetSecretValue` | `nyayavigya/prod/<your_partner>/*` only |
| `secretsmanager:GetSecretValue` | `nyayavigya/staging/<your_partner>/*` only |
| `logs:PutLogEvents` | `/aws/nyayavigya/{prod,staging}/<your_partner>*` only |

You CANNOT touch:
- Other partners' ECR repos or secrets
- The gateway, console, or any IAM resources
- The shared RDS / Redis / VPC

## How to assume the role

### Option A — IAM user (legacy)

```bash
aws sts assume-role \
  --role-arn arn:aws:iam::789925699169:role/nyv-prod-<partner>-deploy \
  --role-session-name partner-deploy
```

The trusted user is set in `infra/terraform/envs/prod/main.tf` →
`module "iam_partner"` → `trusted_user_arn`. Ask the platform owner to add
your IAM user.

### Option B — GitHub OIDC (preferred)

In your partner repo's GitHub Actions workflow:

```yaml
permissions:
  id-token: write
  contents: read

steps:
  - uses: aws-actions/configure-aws-credentials@v4
    with:
      role-to-assume: arn:aws:iam::789925699169:role/nyv-prod-<partner>-deploy
      aws-region: ap-south-1
```

Update `infra/terraform/envs/prod/main.tf` to set
`github_repo = "your-org/your-partner-repo"` on your `iam_partner` module
instance (replace `trusted_user_arn` with this).

## Build → push → deploy your partner image

```bash
# Build locally
docker build -t nyv-<partner>-app:dev .

# Login to ECR
aws ecr get-login-password --region ap-south-1 \
  | docker login --username AWS --password-stdin 789925699169.dkr.ecr.ap-south-1.amazonaws.com

# Tag + push as staging first
docker tag nyv-<partner>-app:dev \
  789925699169.dkr.ecr.ap-south-1.amazonaws.com/nyv-<partner>-app:staging-$(git rev-parse --short HEAD)
docker push  789925699169.dkr.ecr.ap-south-1.amazonaws.com/nyv-<partner>-app:staging-$(git rev-parse --short HEAD)
```

Then ask the platform owner to roll the new image:

```bash
ssh ubuntu@13.232.165.242 \
  "cd /opt/nyayavigya/repo/nyayavigya-platform-312 \
   && NYV_IMAGE_<partner>=…/nyv-<partner>-app:staging-<sha> \
      docker compose -f docker-compose.ecosystem.yml up -d --no-deps <partner>-app"
```

Once validated, promote staging → prod with:

```bash
pnpm deploy:promote staging-<sha>     # promotes nyv-gateway only — for partner promotion follow the same docker-compose recipe but with the prod tag
```

## Reading your partner's secrets

```bash
aws secretsmanager get-secret-value \
  --region ap-south-1 \
  --secret-id nyayavigya/prod/<partner>/sdk_api_key \
  --query SecretString --output text
```

Setting a secret (e.g. rotating your SDK key):

```bash
aws secretsmanager put-secret-value \
  --region ap-south-1 \
  --secret-id nyayavigya/prod/<partner>/sdk_api_key \
  --secret-string "$(uuidgen)"
```

The gateway reads the new value the next time the partner container restarts
(secrets are resolved at container start, not on every request, to keep the
hot path fast).

## Tenant id contract

Your container is bound to a single tenant id (your partner code, lowercased)
via `NYV_TENANT_ID`. The gateway's `nv-tenant-isolation` middleware enforces
that any user-supplied tenant id in a request body / query / header MATCHES
this binding. Cross-tenant attempts return HTTP 403.

If your partner has multiple sub-tenants (e.g. NYS-PRO serves multiple law
firms), your application is responsible for the inner mapping. The gateway
only sees `nsp` and trusts your in-app authorization.
