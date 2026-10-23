# =============================================================================
# ACM module — issues *.nyayasiddhi.online (SAN: apex + www + every staging-*),
# DNS-validated against the Route53 zone created by the route53 module.
# =============================================================================

terraform {
  required_providers { aws = { source = "hashicorp/aws", version = "~> 5.60" } }
}

variable "domain"      {
  type = string
  default = "nyayasiddhi.online"
}
variable "zone_id"     { type = string }
variable "extra_sans"  {
  type = list(string)
  default = []
}
variable "tags"        {
  type = map(string)
  default = {}
}
variable "validate_certificate" {
  type        = bool
  default     = true
  description = "When true, the apply blocks on aws_acm_certificate_validation (cert must reach ISSUED). Set to false to provision the cert + DNS validation records WITHOUT waiting — useful for the very first apply when registrar nameservers have not been delegated yet. After delegation, re-apply with this set to true to bind the validated cert ARN to downstream resources (e.g., an ALB HTTPS listener)."
}

resource "aws_acm_certificate" "this" {
  domain_name       = var.domain
  validation_method = "DNS"
  subject_alternative_names = concat(
    [
      "*.${var.domain}",
      "www.${var.domain}",
    ],
    var.extra_sans,
  )
  lifecycle { create_before_destroy = true }
  tags = var.tags
}

resource "aws_route53_record" "validation" {
  for_each = {
    for dvo in aws_acm_certificate.this.domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  }

  zone_id = var.zone_id
  name    = each.value.name
  type    = each.value.type
  records = [each.value.record]
  ttl     = 60
  # Apex and *.<domain> SANs both share the same resource_record_name. The
  # for_each map (keyed by domain_name) produces multiple entries that try to
  # write the SAME CNAME — without allow_overwrite the second resource fails
  # with "Tried to create resource record set ... but it already exists".
  allow_overwrite = true
}

resource "aws_acm_certificate_validation" "this" {
  count                   = var.validate_certificate ? 1 : 0
  certificate_arn         = aws_acm_certificate.this.arn
  validation_record_fqdns = [for r in aws_route53_record.validation : r.fqdn]

  timeouts {
    create = "45m"
  }
}

# certificate_arn:
#   - When validate_certificate = true (default): returns the ARN only after
#     ACM has issued the cert. Safe to wire directly into an ALB HTTPS listener.
#   - When validate_certificate = false: returns the ARN of the unvalidated cert.
#     Downstream HTTPS listeners must be conditionally created (e.g. a count gate
#     in the env), otherwise apply will fail because the cert isn't ISSUED yet.
output "certificate_arn" {
  value = var.validate_certificate ? aws_acm_certificate_validation.this[0].certificate_arn : aws_acm_certificate.this.arn
}

output "is_validated" {
  value       = var.validate_certificate
  description = "True iff this apply waited for ACM to ISSUE the certificate. Use as a guard for HTTPS listener creation."
}
