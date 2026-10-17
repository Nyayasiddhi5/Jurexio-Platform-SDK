variable "aws_region"       {
  type = string
  default = "ap-south-1"
}
variable "aws_account_id"   {
  type = string
  default = "789925699169"
}
variable "domain"           {
  type = string
  default = "nyayasiddhi.online"
}
variable "ssh_key_name" {
  type        = string
  description = "Name of the EC2 keypair created via the AWS console (one-time)."
  default     = "nysdev"
}

variable "operator_ssh_cidrs" {
  type        = list(string)
  description = "CIDRs allowed to SSH to the application host."
  default     = []
}

variable "alarm_email" {
  type        = string
  description = "Email subscribed to the SNS alarms topic. Leave null to skip."
  default     = null
}

variable "create_rds_replica" {
  type    = bool
  default = false
}

# ── Cost-down overrides ──────────────────────────────────────────────────────
# Defaults preserve the original prod-grade sizing. Override in
# terraform.tfvars to run prod at dev-grade cost while keeping the same
# topology. Bump these values back up (or remove from tfvars) when traffic
# justifies prod-grade hardware.
variable "ec2_instance_type" {
  type        = string
  default     = "t3.large"
  description = "EC2 host instance type. dev-grade: t3.medium (~$30/mo)."
}

variable "db_instance_class" {
  type        = string
  default     = "db.t4g.medium"
  description = "RDS instance class. dev-grade: db.t4g.micro (~$13/mo)."
}

variable "db_multi_az" {
  type        = bool
  default     = true
  description = "RDS multi-AZ. Set false for dev-grade single-AZ (saves ~$15/mo + halves storage cost)."
}

variable "db_allocated_storage_gb" {
  type        = number
  default     = 100
  description = "RDS initial storage. dev-grade: 20 GB."
}

variable "db_max_storage_gb" {
  type        = number
  default     = 500
  description = "RDS storage autoscaling cap."
}

variable "db_backup_retention_days" {
  type        = number
  default     = 14
  description = "RDS PITR retention. dev-grade: 7 days."
}

variable "redis_node_type" {
  type        = string
  default     = "cache.t4g.small"
  description = "ElastiCache Redis node type. dev-grade: cache.t4g.micro (~$11/mo)."
}

variable "redis_replica_count" {
  type        = number
  default     = 1
  description = "Number of Redis replicas. dev-grade: 0 (no replica, no Multi-AZ)."
}

variable "waf_action" {
  type        = string
  default     = "count"
  description = "count (default; observe for >= 1 week) | block"
}

# ── Partner IAM trust ────────────────────────────────────────────────────────
# Production REQUIRES GitHub OIDC trust for every partner. The IAM-user
# fallback that staging permits is FORBIDDEN here — see iam_partner module
# precondition. Configure all 5 partners in terraform.tfvars:
#
#   partner_github_repos = {
#     nym = "nyayasiddhi/nyayamitra"
#     nsp = "nyayasiddhi/nyayasiddhi-pro"
#     nsi = "nyayasiddhi/nyayasiddhi-ins"
#     nsa = "nyayasiddhi/nyayasiddhi-ace"
#     nsm = "nyayasiddhi/nyayasiddhi-min"
#   }
#
# `terraform plan` will fail loudly if any partner is missing.
variable "partner_github_repos" {
  type        = map(string)
  default     = {}
  description = "partner_id -> GitHub owner/repo for OIDC trust (REQUIRED for every partner in prod)"

  validation {
    condition     = alltrue([for p in ["nym", "nsp", "nsi", "nsa", "nsm"] : contains(keys(var.partner_github_repos), p)])
    error_message = "partner_github_repos must contain a GitHub OIDC repo for every partner: nym, nsp, nsi, nsa, nsm. IAM-user fallback is forbidden in prod."
  }
}
