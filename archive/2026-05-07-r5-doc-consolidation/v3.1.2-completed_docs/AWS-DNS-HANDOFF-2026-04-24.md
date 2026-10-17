---
status: completed
version: 3.1.2
superseded_by: null
last_verified: 2026-04-25
---
# AWS Edge Infrastructure — Handoff (2026-04-24)

Path B (lean) implementation: Route 53 zone + ACM cert + ALB pointing at the existing `nysdev` EC2 (i-0df71e5ea1df8f588 / 13.232.165.242). Estimated steady‑state cost: ~USD 25/month (ALB + Route 53 zone + ACM is free).

> **Status as of 2026-04-24 16:11 UTC: cutover COMPLETE.** Both manual
> steps described in Sections 2 and 3 have been performed; HTTPS is
> serving traffic across all required hostnames. Section 8
> ("Cutover completion evidence") records what happened and how to
> re-verify ongoing health. Sections 2–3 are kept as historical
> reference for the original runbook (and as a template for any
> future fresh-zone bring-up); Sections 4–7 (post-cutover next steps,
> rollback) remain operational guidance for the steady state.

This document was originally the source of truth for the two manual steps required to bring `nyayasiddhi.online` live on AWS; it now also captures the completion evidence for that cutover.

---

## 1. What is already in AWS (live now)

Account `789925699169`, region `ap-south-1`, Terraform state in `s3://nyv-tfstate-789925699169-ap-south-1/envs/dev-edge/terraform.tfstate`, locked by DynamoDB table `nyv-tfstate-locks`.

> **State as of 2026-04-24 16:11 UTC** — post-cutover (Phase B
> applied). For the original pre-cutover snapshot and the manual
> nameserver step that gated it, see Sections 2 and 8 below.

| Resource              | Identifier                                                                                          | State                |
|-----------------------|-----------------------------------------------------------------------------------------------------|----------------------|
| Route 53 hosted zone  | `Z04530691JKS1594B5M2E` (`nyayasiddhi.online`)                                                      | created, public DNS authoritative |
| ACM certificate       | `arn:aws:acm:ap-south-1:789925699169:certificate/4fec415f-2049-49cb-b6a7-e2199aeb27e8`             | **ISSUED** (valid through Nov 7 2026) |
| ALB                   | `nyv-dev-edge-alb` → `nyv-dev-edge-alb-1975692075.ap-south-1.elb.amazonaws.com` (zone `ZP97RAFLXTNZK`) | active               |
| ALB target group      | `nyv-dev-edge-tg` → instance `i-0df71e5ea1df8f588` (nysdev EC2, public IP `13.232.165.242`) port 80 | created, target healthy |
| ALB SG                | `nyv-dev-edge-alb-sg` (ingress 80/443 from 0.0.0.0/0)                                                | created              |
| EC2 SG ingress rule   | nysdev SG `sg-0ba15ba2b74a651fb`: port 80 from ALB SG                                                | created              |
| HTTP listener         | port 80 → permanent redirect to HTTPS                                                                | created, serving 301 |
| HTTPS listener        | port 443 → target group, cert above, policy ELBSecurityPolicy-TLS13-1-2-2021-06                     | **created, serving 200 over TLS 1.3** |
| S3 access logs        | `nyv-dev-edge-alb-access-logs-789925699169` (lifecycle: 90 d)                                        | created              |

DNS records already configured in the hosted zone (alias‑pointing to ALB):

```
nyayasiddhi.online           A  ALIAS -> ALB
www.nyayasiddhi.online       A  ALIAS -> ALB
api / console / docs / status / ace / ins / min / nym / pro
                              A  ALIAS -> ALB
```

ACM DNS‑validation CNAMEs (`_a4cf4d78f925dc874fe307ab525ef3f6.…` and `_9f91bac6db70aa4536083703cb6e95ef.www.…`) are already in the zone — they can only be **read** by AWS once the registrar (BigRock) delegates the domain to the AWS nameservers.

---

## 2. Step you (operator) must do at BigRock — change nameservers

In your BigRock control panel for `nyayasiddhi.online`, replace the current NS records with **exactly these four**:

```
ns-457.awsdns-57.com
ns-831.awsdns-39.net
ns-1111.awsdns-10.org
ns-1846.awsdns-38.co.uk
```

Notes:
- Order does not matter. All four must be present; remove any others.
- BigRock typically applies NS edits within 30–60 minutes; full global propagation up to 24 h.
- After propagation, ACM detects the validation CNAMEs and issues the certificate (typically within 5–15 minutes).

You can watch validation progress without logging into the console:

```bash
export PATH=$HOME/.local/bin:$PATH
aws acm describe-certificate \
  --region ap-south-1 \
  --certificate-arn arn:aws:acm:ap-south-1:789925699169:certificate/4fec415f-2049-49cb-b6a7-e2199aeb27e8 \
  --query "Certificate.Status" --output text
# expect: PENDING_VALIDATION → ISSUED
```

---

## 3. Step I or you run after registrar NS has propagated — Phase B

The dev-edge env is **two-phase by design** so every `terraform apply` succeeds in a single pass:

- **Phase A** (default, already applied): zone, ACM cert, validation CNAMEs, ALB, HTTP→HTTPS redirect listener, target group, S3 logs. Apply succeeds in <1 min even when the cert is PENDING_VALIDATION.
- **Phase B**: adds the `aws_acm_certificate_validation` waiter (blocks until the cert reaches ISSUED, up to 45 min) and the ALB :443 HTTPS listener. Run this once you have confirmed BigRock NS delegation is live.

To run Phase B:

```bash
export PATH=$HOME/.local/bin:$PATH
cd nyayavigya-platform-312/infra/terraform/envs/dev-edge
terraform apply -input=false -auto-approve -var enable_https_listener=true
```

Expected: `Plan: 2 to add, 0 to change, 0 to destroy.` (`aws_acm_certificate_validation.this[0]` and `aws_lb_listener.https[0]`). Total runtime is dominated by the validation wait — usually 5–15 minutes once public DNS for `nyayasiddhi.online` resolves to the AWS nameservers.

After Phase B, public traffic to `https://nyayasiddhi.online` flows: client → ALB (TLS terminate) → nysdev EC2:80 → existing `nsp-caddy` container (which already serves the platform).

The two-phase contract is enforced in Terraform code:
- `infra/terraform/envs/dev-edge/variables.tf` — the `enable_https_listener` variable carries the contract documentation.
- `infra/terraform/modules/acm/main.tf` — the `validate_certificate` variable on the ACM module gates the validation waiter. `certificate_arn` returns the unvalidated cert ARN in Phase A and the validated ARN in Phase B.

---

## 4. Replit → AWS CI/CD — verified working

The `scripts/deploy-replit-direct.sh` flow (Replit shell or any CI runner with the `nysdev.pem` key) is the production deploy path. Verified during this task:

```
$ bash scripts/deploy-replit-direct.sh --status
── Container health ──
nyv-gateway   Up 3 hours (healthy)
nyv-postgres  Up 33 hours (healthy)
nyv-console   Up 44 hours (healthy)
nyv-redis     Up 2 days  (healthy)
── /health probe ──
[ OK ] Gateway healthy (200)
```

The script handles: working‑tree tarball → SSH → preflight → image rebuild → blue/green container swap → health gate → automatic rollback on failure → release retention (5 tarballs in `/opt/nyayavigya/releases/`). One‑command rollback is `bash scripts/deploy-replit-direct.sh --rollback`.

Most recent EC2 deploy at task time: `20260424T091715Z-b1448e7283-dirty` (~3 h old). Local `main` is 5 commits ahead. To deploy the latest local code, run from the project root:

```bash
bash scripts/deploy-replit-direct.sh        # full deploy with preflight
# or
NYV_DEPLOY_SKIP_PREFLIGHT=1 bash scripts/deploy-replit-direct.sh   # emergency, ungated
```

Two stale `.deploy.lock` / `.deploy.lock.held` files were cleared on the EC2 box during this task; deploy is unblocked.

---

## 5. Ecosystem partner CI/CD — boundary

Partner repos (`nsp-*`, etc.) deploy their own service container images via ECR; they **must not** touch:

- This Terraform state (`s3://nyv-tfstate-789925699169-ap-south-1/envs/dev-edge/`).
- The Route 53 hosted zone `Z04530691JKS1594B5M2E`.
- The ALB `nyv-dev-edge-alb`, its listeners, target group, security group, or access‑log bucket.
- ACM certificate `4fec415f-2049-49cb-b6a7-e2199aeb27e8`.
- The nysdev EC2 instance security group `sg-0ba15ba2b74a651fb`.

Partner CI/CD is expected to use `scripts/deploy-replit-direct.sh --use-ecr <tag>` (image‑pull mode) or push to their own ECR repository (`nsp-*`) and let the EC2 box pull on the next deploy. The IAM role / OIDC trust policy for partner CI is intentionally scoped to ECR push only — it has no Route 53, ACM, ELB, or EC2 SG permissions.

---

## 6. What was deliberately *not* done in this task (cost / scope)

Per the agreed lean Path B path, the following exist in the Terraform module library but were **not** instantiated in `dev-edge`:

- WAF web ACL on the ALB. *(Recommended follow‑up: enable in count‑only mode for one week, then enforce.)*
- CloudWatch alarms / SNS notifications.
- Multi‑AZ ALB subnets are present (default VPC, both AZs in `ap-south-1`), but no second EC2 — single‑AZ failure tolerance only.

**Update (Task #17, 2026-04-24):** RDS Postgres + ElastiCache Redis are now wired into the same `dev-edge` env behind the `enable_managed_datastores` variable (default `false`, same two-phase apply contract as `enable_https_listener`). When the operator opts in, RDS provisions a `db.t4g.small` Postgres 16 with 7-day PITR, ElastiCache provisions a `cache.t4g.micro` Redis 7.1, both in the default VPC with SG ingress restricted to the existing nysdev SG. Cutover runbook is `scripts/migrate-to-managed-datastores.sh` and full handoff is `docs/v3.1.2/completed_docs/AWS-MANAGED-DATASTORES-2026-04-24.md`. Estimated added cost ~USD 37/mo.

If/when you decide to harden further, the modules under `infra/terraform/modules/{waf,cloudwatch}` are syntactically clean (Terraform 1.9 compatible, `default = …` syntax fixed across the board this task) and ready to wire into a future env (`prod` or `dev-edge`).

---

## 7. Quick rollback / panic switch

If the AWS edge misbehaves and you need to revert to "domain points straight at the EC2 IP" within DNS‑TTL minutes:

1. In BigRock, restore the original BigRock NS records (or set an A record for `nyayasiddhi.online → 13.232.165.242` if you keep BigRock authoritative).
2. The EC2 box keeps serving on port 80 directly; nothing else needs to change.
3. The AWS edge (ALB, Route 53 zone, ACM cert) can be left up — it only costs while the ALB exists, and you can `terraform destroy` from `infra/terraform/envs/dev-edge/` once you no longer need it.

To completely tear the AWS edge down:

```bash
cd nyayavigya-platform-312/infra/terraform/envs/dev-edge
terraform destroy -auto-approve
```

This removes the ALB (~USD 16/mo saved), the Route 53 zone (~USD 0.50/mo), the ACM cert (free), and the S3 access‑log bucket. The EC2 instance, its security group, its Elastic IP, and its data are **untouched** by this destroy.

---

## 8. Cutover completion evidence — 2026-04-24

Phase B (HTTPS listener) was driven to completion on 2026-04-24. Auditable evidence captured at the time of the cutover:

### Nameserver delegation (public DNS)

Both Google and Cloudflare public resolvers returned the four AWS nameservers for `nyayasiddhi.online`:

```
ns-457.awsdns-57.com
ns-831.awsdns-39.net
ns-1111.awsdns-10.org
ns-1846.awsdns-38.co.uk
```

Validation CNAMEs resolved correctly via the now‑authoritative AWS nameservers:

```
_a4cf4d78f925dc874fe307ab525ef3f6.nyayasiddhi.online.  CNAME  _014aac038800085d2b111e9de0b418ce.jkddzztszm.acm-validations.aws.
_9f91bac6db70aa4536083703cb6e95ef.www.nyayasiddhi.online.  CNAME  _cdca60d85458e388146275b968930bfc.jkddzztszm.acm-validations.aws.
```

### ACM certificate

`arn:aws:acm:ap-south-1:789925699169:certificate/4fec415f-2049-49cb-b6a7-e2199aeb27e8` transitioned `PENDING_VALIDATION → ISSUED` at `2026-04-24 16:10:20 UTC` (≈33 minutes after BigRock NS delegation was visible on public DNS — slow end of normal but well within the 45‑minute Terraform waiter).

Cert chain (verified via `openssl s_client -connect nyayasiddhi.online:443 -servername nyayasiddhi.online`):

```
subject = CN = nyayasiddhi.online
issuer  = C = US, O = Amazon, CN = Amazon RSA 2048 M01
notBefore = Apr 24 00:00:00 2026 GMT
notAfter  = Nov  7 23:59:59 2026 GMT
X509v3 Subject Alternative Name:
    DNS:nyayasiddhi.online, DNS:*.nyayasiddhi.online, DNS:www.nyayasiddhi.online
```

### Terraform Phase B apply

```
$ terraform apply -input=false -auto-approve -var enable_https_listener=true

module.acm.aws_acm_certificate_validation.this[0]: Creating...
module.acm.aws_acm_certificate_validation.this[0]: Creation complete after 0s [id=2026-04-24 16:10:20.968 +0000 UTC]
aws_lb_listener.https[0]: Creating...
aws_lb_listener.https[0]: Creation complete after 1s [id=arn:aws:elasticloadbalancing:ap-south-1:789925699169:listener/app/nyv-dev-edge-alb/de64ede3dc9d8bbb/8e5f1c2bd7a0bb9a]

Apply complete! Resources: 2 added, 0 changed, 0 destroyed.
```

> **Drift protection — already in place:** the env now ships
> `infra/terraform/envs/dev-edge/terraform.tfvars` with
> `enable_https_listener = true`. Terraform auto-loads any file named
> `terraform.tfvars` in the working directory, so a plain
> `terraform apply` (no flags) keeps the HTTPS listener and the cert
> validation waiter intact. Verified post-change with `terraform plan`:
> `Plan: 3 to add, 0 to change, 0 to destroy.` — the HTTPS listener
> does **not** appear in the destroy set.
>
> The `default = false` in `variables.tf` is intentionally preserved
> for two reasons: (1) it keeps the documented two-phase contract
> intact for any *fresh* env that needs Phase A first, and (2) it lets
> the Section 7 panic-switch rollback work without code edits — pass
> `-var enable_https_listener=false` on the apply command line and
> the override beats the tfvars value.
>
> Pre-apply gate to keep this safe: before any future
> `terraform apply` in this env, eyeball the plan summary line. If it
> shows `aws_lb_listener.https` or `aws_acm_certificate_validation` in
> the destroy column, do **not** apply — investigate (most likely
> `terraform.tfvars` was deleted or someone ran with
> `-var enable_https_listener=false` by mistake).

### ALB final state

```
Listeners on nyv-dev-edge-alb:
  HTTP  :80   default action -> 301 redirect to HTTPS
  HTTPS :443  ssl_policy = ELBSecurityPolicy-TLS13-1-2-2021-06
              cert       = arn:aws:acm:ap-south-1:789925699169:certificate/4fec415f-2049-49cb-b6a7-e2199aeb27e8
              default action -> forward to nyv-dev-edge-tg

Target group nyv-dev-edge-tg:
  i-0df71e5ea1df8f588 :80   health = healthy
```

### Public endpoint validation

`curl --max-time 12 -o /dev/null -w '%{http_code} verify=%{ssl_verify_result} proto=%{http_version}'` against each FQDN, all served from ALB IPs (`15.207.94.85`, `15.207.132.101`, `13.235.143.21`):

```
nyayasiddhi.online/health           200  verify=0  proto=2
www.nyayasiddhi.online/health       200  verify=0  proto=2
api.nyayasiddhi.online/health       200  verify=0  proto=2
console.nyayasiddhi.online/health   200  verify=0  proto=2
docs.nyayasiddhi.online/health      200  verify=0  proto=2
status.nyayasiddhi.online/health    200  verify=0  proto=2
ace.nyayasiddhi.online/health       200  verify=0  proto=2
ins.nyayasiddhi.online/health       200  verify=0  proto=2
min.nyayasiddhi.online/health       200  verify=0  proto=2
nym.nyayasiddhi.online/health       200  verify=0  proto=2
pro.nyayasiddhi.online/health       200  verify=0  proto=2
```

`https://nyayasiddhi.online/health` body confirmed gateway healthy (`{"status":"healthy", … "version":"v5.0.0"}`). `http://nyayasiddhi.online/health` returned `HTTP/1.1 301 Moved Permanently` from `Server: awselb/2.0` as expected.

### Periodic re-validation block

Run any time you want to spot‑check that the edge is still healthy (suggested cadence: weekly, or any time after a registrar / Route 53 / ALB change). The canonical implementation is checked into the repo as a versioned executable:

```bash
bash nyayavigya-platform-312/scripts/edge-revalidate.sh
```

What the script verifies, in order:

1. **NS delegation** — the four AWS nameservers (`ns-457`, `ns-831`, `ns-1111`, `ns-1846`) are still authoritative for `nyayasiddhi.online` on the public Internet. Queries Google DNS-over-HTTPS first, automatically falls back to Cloudflare DoH if Google is unreachable, so the check is not a single-provider dependency.
2. **ACM cert** — status is still `ISSUED` and there are more than 30 days until expiry. Days-to-expiry is computed in Python and accepts both AWS CLI date output formats (Unix epoch from awscli v1, ISO 8601 from awscli v2).
3. **HTTPS health** — apex + `www` + `api` + `console` each return HTTP 200 over a valid TLS chain (`%{ssl_verify_result} == 0`).

Exit status is 0 only if every check passes; the failing line is printed on failure. Suitable for cron / scheduled CI with alerting on non-zero exit.

Spot‑check executed at review time of this section (output of the committed script against the live edge):

```
OK  NS delegation intact (via google DoH)
OK  ACM cert ISSUED, 197 day(s) until expiry
OK  nyayasiddhi.online => 200 with valid TLS
OK  www.nyayasiddhi.online => 200 with valid TLS
OK  api.nyayasiddhi.online => 200 with valid TLS
OK  console.nyayasiddhi.online => 200 with valid TLS
All edge checks passed.
```

Standalone confirmation:

```
$ aws acm describe-certificate --region ap-south-1 \
    --certificate-arn arn:aws:acm:ap-south-1:789925699169:certificate/4fec415f-2049-49cb-b6a7-e2199aeb27e8 \
    --query "Certificate.Status" --output text
ISSUED
```
