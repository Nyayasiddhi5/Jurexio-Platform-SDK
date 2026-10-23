# =============================================================================
# Route53 module — owns the hosted zone for nyayasiddhi.online and creates the
# 14 ALIAS records that point at the production + staging ALBs.
#
# After `terraform apply`, copy the four `nameservers` outputs into the BigRock
# control panel.  Until that's done, NS resolution still goes via BigRock and
# this module's records are inert.
# =============================================================================

terraform {
  required_providers { aws = { source = "hashicorp/aws", version = "~> 5.60" } }
}

variable "domain"             {
  type = string
  default = "nyayasiddhi.online"
}
variable "prod_alb_dns"       { type = string }
variable "prod_alb_zone_id"   { type = string }
# staging_alb_* are intentionally absent — the staging env creates its own
# staging-* records against this zone (read via terraform_remote_state) so
# that the staging ALB ID is known at plan time without a circular dep.
variable "tags"               {
  type = map(string)
  default = {}
}
resource "aws_route53_zone" "this" {
  name = var.domain
  tags = var.tags
}

# ── Production records (ALIAS to prod ALB) ──────────────────────────────────
locals {
  prod_subdomains = [
    "api",
    "console",
    "docs",
    "status",
    "pro",
    "nym",
    "ins",
    "ace",
    "min",
  ]
}

resource "aws_route53_record" "prod" {
  for_each = toset(local.prod_subdomains)
  zone_id  = aws_route53_zone.this.zone_id
  name     = "${each.key}.${var.domain}"
  type     = "A"
  alias {
    name                   = var.prod_alb_dns
    zone_id                = var.prod_alb_zone_id
    evaluate_target_health = true
  }
}

# Apex + www → ALIAS to the prod ALB. The ACM cert already covers apex,
# www, and *.<domain>, so HTTPS works at every name. Caddy on EC2 has a
# host-matched route for the apex (and www) that 301-redirects to
# https://console.<domain>. No S3, no CloudFront, no extra cost.
resource "aws_route53_record" "apex" {
  zone_id = aws_route53_zone.this.zone_id
  name    = var.domain
  type    = "A"
  alias {
    name                   = var.prod_alb_dns
    zone_id                = var.prod_alb_zone_id
    evaluate_target_health = true
  }
}

resource "aws_route53_record" "www" {
  zone_id = aws_route53_zone.this.zone_id
  name    = "www.${var.domain}"
  type    = "A"
  alias {
    name                   = var.prod_alb_dns
    zone_id                = var.prod_alb_zone_id
    evaluate_target_health = true
  }
}

output "zone_id"     { value = aws_route53_zone.this.zone_id }
output "nameservers" { value = aws_route53_zone.this.name_servers }
