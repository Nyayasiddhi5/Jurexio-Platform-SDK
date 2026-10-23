# =============================================================================
# Secrets module — pre-creates the AWS Secrets Manager entries the platform
# expects.  Values default to empty strings; the operator fills them in via
# `bash scripts/secrets-sync.sh` (which reads `.env.<env>` and writes to SM).
# =============================================================================

terraform {
  required_providers { aws = { source = "hashicorp/aws", version = "~> 5.60" } }
}

variable "env"   {
  type = string
  description = "prod | staging"
}
variable "tags"  {
  type = map(string)
  default = {}
}
locals {
  prefix = "nyayavigya/${var.env}"

  # Per-service secrets that must exist before the gateway boots.
  # Add-only.  Removing from this list does NOT delete the SM entry — Terraform
  # leaves orphaned secrets alone so you don't accidentally lose history.
  gateway_keys = [
    "jwt_secret",
    "jwt_refresh_secret",
    "openrouter_api_key",
    "openai_api_key",
    "anthropic_api_key",
    "google_ai_api_key",
    "groq_api_key",
    "perplexity_api_key",
    "sarvam_api_key",
    "elevenlabs_api_key",
    "sentry_dsn",
    "session_secret",
  ]

  partner_keys = [
    "nym/sdk_api_key",
    "nsp/sdk_api_key",
    "nsi/sdk_api_key",
    "nsa/sdk_api_key",
    "nsm/sdk_api_key",
  ]

  all_keys = concat(
    [for k in local.gateway_keys : "gateway/${k}"],
    local.partner_keys,
  )
}

resource "aws_secretsmanager_secret" "this" {
  for_each = toset(local.all_keys)

  name        = "${local.prefix}/${each.key}"
  description = "Nyayavigya ${var.env} — ${each.key}"
  tags        = merge(var.tags, { SecretGroup = split("/", each.key)[0] })

  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret_version" "placeholder" {
  for_each      = aws_secretsmanager_secret.this
  secret_id     = each.value.id
  secret_string = "PLACEHOLDER_NOT_YET_SET"

  lifecycle {
    # Once the operator (or scripts/secrets-sync.sh) writes a real value,
    # do not overwrite it on subsequent terraform applies.
    ignore_changes = [secret_string]
  }
}

output "secret_arns" {
  value = { for k, s in aws_secretsmanager_secret.this : k => s.arn }
}

output "all_arns_pattern" {
  value       = "arn:aws:secretsmanager:*:*:secret:${local.prefix}/*"
  description = "Glob pattern matching every secret managed here — use in IAM policies."
}
