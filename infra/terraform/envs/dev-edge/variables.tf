variable "aws_region" {
  type    = string
  default = "ap-south-1"
}
variable "aws_account_id" {
  type    = string
  default = "789925699169"
}
variable "domain" {
  type    = string
  default = "nyayasiddhi.online"
}
# Existing dev EC2 (provisioned outside Terraform). The dev-edge env attaches
# this instance to the new ALB target group rather than spinning up a new host.
variable "nysdev_instance_id" {
  type    = string
  default = "i-0df71e5ea1df8f588"
}

variable "nysdev_security_group_id" {
  type        = string
  default     = "sg-0ba15ba2b74a651fb"
  description = "Existing nysdev SG (launch-wizard-1). Receives an ingress rule from the new ALB SG on :80."
}

# Two-phase apply gate. The whole point is to make `terraform apply` succeed
# in a single pass at every stage of the rollout, regardless of where DNS
# delegation is in its lifecycle.
#
#   Phase A — enable_https_listener = false  (DEFAULT, safe before NS switch)
#     Creates: Route 53 zone, ACM cert, validation CNAME records, ALB,
#              HTTP-to-HTTPS redirect listener, target group, S3 logs bucket.
#     Does NOT create: aws_acm_certificate_validation (the waiter) or the
#              HTTPS listener. So apply finishes in <1 minute even when the
#              cert is still PENDING_VALIDATION because the registrar hasn't
#              been delegated to AWS yet.
#     Output `route53_nameservers` lists the four AWS nameservers to set at
#              the registrar.
#
#   Phase B — enable_https_listener = true   (after NS delegation propagates)
#     Adds: aws_acm_certificate_validation (blocks until cert ISSUED, up to
#              45 min) and the ALB :443 HTTPS listener.
#     Apply completes the moment the cert is issued — typically within 5–15
#              minutes of the registrar update being visible to public DNS.
variable "enable_https_listener" {
  type        = bool
  default     = false
  description = "Phase B switch — flip to true once registrar nameservers point at the four AWS NS shown in the route53_nameservers output. See variable comment block above for the full two-phase apply contract."
}

# WAF rollout gate. The Web ACL itself is always created and associated with
# the edge ALB — there is no "WAF off" mode. Action governs only the rule
# verdicts:
#
#   "count"  (DEFAULT)
#     Managed rule groups + per-IP rate limit run in observation-only mode.
#     CloudWatch metrics record what WOULD have been blocked. Use the
#     Nyayavigya-dev-edge-waf dashboard to baseline real platform traffic for
#     >= 7 days and review false positives in WAF sampled requests.
#
#   "block"
#     Managed rule groups enforce (none override) and the per-IP rate-limit
#     rule blocks. Flip only after the count-mode review.
variable "waf_action" {
  type        = string
  default     = "count"
  description = "count (default; observe for >= 1 week) | block"

  validation {
    condition     = contains(["count", "block"], var.waf_action)
    error_message = "waf_action must be either \"count\" or \"block\"."
  }
}

variable "waf_rate_limit" {
  type        = number
  default     = 2000
  description = "Per-IP request limit (5-minute sliding window) for the rate-based rule."
}

# ─────────────────────────────────────────────────────────────────────────────
# Managed datastores (Task #17) — RDS Postgres + ElastiCache Redis in the same
# VPC as nysdev. Off by default so the existing dev-edge apply remains a 1-min
# no-op. When `true` this env adds:
#   • RDS Postgres 16 (db.t4g.small, single-AZ, gp3, 7-day backups, PITR on,
#     deletion_protection=false to keep dev cheap-to-teardown). ~USD 25/mo.
#   • ElastiCache Redis 7.1 (cache.t4g.micro, no replica). ~USD 12/mo.
#   • Two new SGs whose only ingress source is the existing nysdev SG.
#   • Two Secrets Manager entries holding the master credentials + endpoint.
#
# Cutover steps after the apply succeeds:
#   1. Read the new endpoints from `terraform output -json datastores`.
#   2. SSH to nysdev, run `bash scripts/migrate-to-managed-datastores.sh`
#      (pg_dump from the nyv-postgres container, psql restore into RDS,
#      Redis is a cache so it warms back up — no dump needed).
#   3. Update DATABASE_URL / NYV_REDIS_TCP_URL / REDIS_URL on the EC2 .env
#      and bounce the gateway containers; stop nyv-postgres + nyv-redis.
#
# See docs/v3.1.2/completed_docs/AWS-MANAGED-DATASTORES-2026-04-24.md for the full runbook.
# ─────────────────────────────────────────────────────────────────────────────
variable "enable_managed_datastores" {
  type        = bool
  default     = false
  description = "When true, provisions RDS Postgres + ElastiCache Redis in the default VPC and grants ingress to the nysdev SG. Off keeps the env at the ~USD 25/mo edge-only footprint."
}

variable "rds_instance_class" {
  type        = string
  default     = "db.t4g.small"
  description = "RDS instance class — db.t4g.small is the cost-down dev pick (~USD 25/mo)."
}

variable "rds_allocated_storage_gb" {
  type        = number
  default     = 20
  description = "Initial gp3 storage. autoscales up to rds_max_storage_gb."
}

variable "rds_max_storage_gb" {
  type    = number
  default = 100
}

variable "rds_backup_retention_days" {
  type        = number
  default     = 7
  description = "PITR window in days. 7 satisfies the dev backup requirement."
}

variable "redis_node_type" {
  type        = string
  default     = "cache.t4g.micro"
  description = "ElastiCache node type — cache.t4g.micro is ~USD 12/mo."
}
