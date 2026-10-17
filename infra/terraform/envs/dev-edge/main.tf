## =============================================================================
## Nyayavigya — dev-edge env
##
## Slim "edge" stack that wraps the EXISTING nysdev EC2 (i-0df71e5ea1df8f588,
## default VPC, public IP 13.232.165.242) with three things:
##   1. Route 53 hosted zone for nyayasiddhi.online
##   2. ACM cert (DNS-validated against that zone) covering apex + www + *.<domain>
##   3. ALB in the default VPC that fronts the existing instance on :80 (Caddy)
##
## Cost target: ~$25/mo
##   - Route 53 zone:      $0.50/mo + $0.40 per million queries
##   - ALB:                ~$20/mo + data
##   - ACM:                free
##   - S3 access logs:     pennies
##
## What this env does NOT create by default:
##   - VPC, NAT gateway, EC2, ECR, WAF, CloudWatch alarms, IAM partner roles,
##     partner target groups. Those live in envs/prod and envs/staging and
##     remain ready-to-apply when the project is sized up.
##
## Optional add-on (Task #17):
##   - RDS Postgres + ElastiCache Redis can be turned on in this same env by
##     setting `enable_managed_datastores = true`. They get provisioned in the
##     default VPC alongside nysdev, with SG ingress restricted to nysdev only.
##     See variables.tf for the cost numbers and cutover steps.
## =============================================================================

locals {
  prefix = "nyv-dev-edge"

  tags = {
    Project    = "Nyayavigya"
    Env        = "dev-edge"
    ManagedBy  = "terraform"
    Owner      = "nyayavigya-platform"
    CostCenter = "engineering"
    Repo       = "nyayasiddhi/nyayavigya-platform-312"
  }
}

# ── Default VPC + public subnets ─────────────────────────────────────────────
data "aws_vpc" "default" {
  default = true
}

data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
  filter {
    name   = "default-for-az"
    values = ["true"]
  }
}

data "aws_instance" "nysdev" {
  instance_id = var.nysdev_instance_id
}

# ── Route 53 zone + ACM cert (uses existing modules) ─────────────────────────
module "route53" {
  source           = "../../modules/route53"
  domain           = var.domain
  prod_alb_dns     = aws_lb.edge.dns_name
  prod_alb_zone_id = aws_lb.edge.zone_id
  tags             = local.tags
}

module "acm" {
  source               = "../../modules/acm"
  domain               = var.domain
  zone_id              = module.route53.zone_id
  extra_sans           = []
  validate_certificate = var.enable_https_listener # Phase B gate; see variables.tf
  tags                 = local.tags
}

# ── ALB (inline, in the default VPC, targets nysdev directly) ────────────────
resource "aws_security_group" "alb" {
  name        = "${local.prefix}-alb"
  description = "ALB ingress for ${local.prefix}"
  vpc_id      = data.aws_vpc.default.id

  ingress {
    description = "HTTP redirect"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "HTTPS"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.tags, { Name = "${local.prefix}-alb-sg" })
}

# Allow the new ALB SG to reach the existing nysdev SG on :80 (Caddy).
# This is purely additive — existing nysdev SG rules are untouched.
resource "aws_security_group_rule" "nysdev_from_alb" {
  type                     = "ingress"
  from_port                = 80
  to_port                  = 80
  protocol                 = "tcp"
  source_security_group_id = aws_security_group.alb.id
  security_group_id        = var.nysdev_security_group_id
  description              = "ALB ${local.prefix} to nysdev port 80 Caddy"
}

resource "aws_s3_bucket" "alb_logs" {
  bucket        = "${local.prefix}-alb-access-logs-${var.aws_account_id}"
  force_destroy = false
  tags          = local.tags
}

resource "aws_s3_bucket_lifecycle_configuration" "alb_logs" {
  bucket = aws_s3_bucket.alb_logs.id
  rule {
    id     = "expire"
    status = "Enabled"
    filter {}
    expiration { days = 90 }
  }
}

# ALB requires the AWS-owned account for ap-south-1 (718504428378) to PutObject
# into the access-logs bucket. Region-specific list:
# https://docs.aws.amazon.com/elasticloadbalancing/latest/application/enable-access-logging.html
resource "aws_s3_bucket_policy" "alb_logs" {
  bucket = aws_s3_bucket.alb_logs.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { AWS = "arn:aws:iam::718504428378:root" }
      Action    = "s3:PutObject"
      Resource  = "${aws_s3_bucket.alb_logs.arn}/*"
    }]
  })
}

resource "aws_lb" "edge" {
  name                       = "${local.prefix}-alb"
  load_balancer_type         = "application"
  subnets                    = data.aws_subnets.default.ids
  security_groups            = [aws_security_group.alb.id]
  drop_invalid_header_fields = true
  enable_deletion_protection = false
  idle_timeout               = 600

  access_logs {
    bucket  = aws_s3_bucket.alb_logs.id
    prefix  = local.prefix
    enabled = true
  }

  tags = merge(local.tags, { Name = "${local.prefix}-alb" })

  depends_on = [aws_s3_bucket_policy.alb_logs]
}

# Permissive matcher (200,404) because Caddy routes by Host header. The ALB
# health check sends the target IP as Host, which Caddy treats as an unknown
# site and answers 404 — that still proves Caddy is up. A 200 means /health
# was routed to the gateway. Either is healthy enough for a dev edge.
resource "aws_lb_target_group" "edge" {
  name        = "${local.prefix}-tg"
  port        = 80
  protocol    = "HTTP"
  vpc_id      = data.aws_vpc.default.id
  target_type = "instance"

  health_check {
    enabled             = true
    healthy_threshold   = 2
    unhealthy_threshold = 3
    interval            = 30
    timeout             = 5
    path                = "/health"
    matcher             = "200,404"
  }

  deregistration_delay = 30
  tags                 = merge(local.tags, { Name = "${local.prefix}-tg" })

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_lb_target_group_attachment" "nysdev" {
  target_group_arn = aws_lb_target_group.edge.arn
  target_id        = data.aws_instance.nysdev.id
  port             = 80
}

resource "aws_lb_listener" "http_redirect" {
  load_balancer_arn = aws_lb.edge.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = "redirect"
    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }
}

# HTTPS listener is gated on Phase B because module.acm.certificate_arn only
# resolves to a USABLE (validated) ARN when var.enable_https_listener is true.
# Creating this listener prematurely would fail at apply time with a 4xx from
# the ELB API: "certificate is not ISSUED".
resource "aws_lb_listener" "https" {
  count             = var.enable_https_listener ? 1 : 0
  load_balancer_arn = aws_lb.edge.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = module.acm.certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.edge.arn
  }
}

# ── WAF ──────────────────────────────────────────────────────────────────────
# AWS-managed rule groups + per-IP rate limit, attached to the edge ALB.
# Defaults to COUNT mode (observation only) so we can baseline real traffic
# for >= 7 days and tune false positives BEFORE flipping var.waf_action to
# "block". See the variable comment block in variables.tf for the contract.
module "waf" {
  source     = "../../modules/waf"
  name       = "${local.prefix}-waf"
  alb_arn    = aws_lb.edge.arn
  rate_limit = var.waf_rate_limit
  action     = var.waf_action
  tags       = local.tags
}

# Lightweight WAF dashboard — surfaces blocked vs counted requests per rule
# group so the count-mode review is a one-page operator task. We do not use
# modules/cloudwatch here because dev-edge has no RDS / Redis / SNS targets;
# all of that lives in envs/staging and envs/prod.
resource "aws_cloudwatch_dashboard" "waf" {
  dashboard_name = "Nyayavigya-${local.prefix}-waf"

  dashboard_body = jsonencode({
    widgets = [
      {
        type = "metric"
        x    = 0, y = 0, width = 12, height = 6
        properties = {
          title = "WAF — total Allowed vs Blocked vs Counted"
          metrics = [
            ["AWS/WAFV2", "AllowedRequests", "WebACL", "${local.prefix}-waf", "Region", var.aws_region, "Rule", "ALL"],
            ["AWS/WAFV2", "BlockedRequests", "WebACL", "${local.prefix}-waf", "Region", var.aws_region, "Rule", "ALL"],
            ["AWS/WAFV2", "CountedRequests", "WebACL", "${local.prefix}-waf", "Region", var.aws_region, "Rule", "ALL"],
          ]
          period  = 300
          stat    = "Sum"
          region  = var.aws_region
          view    = "timeSeries"
          stacked = false
        }
      },
      {
        type = "metric"
        x    = 12, y = 0, width = 12, height = 6
        properties = {
          title = "Common Rule Set — would-block (CountedRequests)"
          metrics = [
            ["AWS/WAFV2", "CountedRequests", "WebACL", "${local.prefix}-waf", "Region", var.aws_region, "Rule", "AWS-AWSManagedRulesCommonRuleSet"],
            ["AWS/WAFV2", "BlockedRequests", "WebACL", "${local.prefix}-waf", "Region", var.aws_region, "Rule", "AWS-AWSManagedRulesCommonRuleSet"],
          ]
          period = 300
          stat   = "Sum"
          region = var.aws_region
        }
      },
      {
        type = "metric"
        x    = 0, y = 6, width = 12, height = 6
        properties = {
          title = "Known Bad Inputs — would-block (CountedRequests)"
          metrics = [
            ["AWS/WAFV2", "CountedRequests", "WebACL", "${local.prefix}-waf", "Region", var.aws_region, "Rule", "AWS-AWSManagedRulesKnownBadInputsRuleSet"],
            ["AWS/WAFV2", "BlockedRequests", "WebACL", "${local.prefix}-waf", "Region", var.aws_region, "Rule", "AWS-AWSManagedRulesKnownBadInputsRuleSet"],
          ]
          period = 300
          stat   = "Sum"
          region = var.aws_region
        }
      },
      {
        type = "metric"
        x    = 12, y = 6, width = 12, height = 6
        properties = {
          title = "Amazon IP Reputation — would-block (CountedRequests)"
          metrics = [
            ["AWS/WAFV2", "CountedRequests", "WebACL", "${local.prefix}-waf", "Region", var.aws_region, "Rule", "AWS-AWSManagedRulesAmazonIpReputationList"],
            ["AWS/WAFV2", "BlockedRequests", "WebACL", "${local.prefix}-waf", "Region", var.aws_region, "Rule", "AWS-AWSManagedRulesAmazonIpReputationList"],
          ]
          period = 300
          stat   = "Sum"
          region = var.aws_region
        }
      },
      {
        type = "metric"
        x    = 0, y = 12, width = 24, height = 6
        properties = {
          title = "Per-IP rate limit — would-block (CountedRequests) vs Blocked"
          metrics = [
            ["AWS/WAFV2", "CountedRequests", "WebACL", "${local.prefix}-waf", "Region", var.aws_region, "Rule", "PerIpRateLimit"],
            ["AWS/WAFV2", "BlockedRequests", "WebACL", "${local.prefix}-waf", "Region", var.aws_region, "Rule", "PerIpRateLimit"],
          ]
          period = 300
          stat   = "Sum"
          region = var.aws_region
        }
      }
    ]
  })
}

# ── Optional managed datastores (Task #17) ──────────────────────────────────
# Same VPC as nysdev (default VPC). The modules' `client_sg_ids` parameter
# attaches an ingress rule on the new SG sourced from the existing nysdev SG —
# so nothing else in the VPC (or outside it) can reach Postgres/Redis. Both
# resources are kept off the public internet by default (publicly_accessible
# is false on RDS; ElastiCache has no public-access concept). The two-phase
# variable contract means `terraform apply` is a no-op until an operator
# explicitly flips `enable_managed_datastores = true`.
module "rds" {
  count  = var.enable_managed_datastores ? 1 : 0
  source = "../../modules/rds"

  name                  = "${local.prefix}-pg"
  vpc_id                = data.aws_vpc.default.id
  isolated_subnet_ids   = data.aws_subnets.default.ids
  client_sg_ids         = [var.nysdev_security_group_id]
  instance_class        = var.rds_instance_class
  allocated_storage_gb  = var.rds_allocated_storage_gb
  max_storage_gb        = var.rds_max_storage_gb
  multi_az              = false
  backup_retention_days = var.rds_backup_retention_days
  create_read_replica   = false
  deletion_protection   = false # dev — we want clean teardown
  tags                  = local.tags
}

module "elasticache" {
  count  = var.enable_managed_datastores ? 1 : 0
  source = "../../modules/elasticache"

  name                = "${local.prefix}-redis"
  vpc_id              = data.aws_vpc.default.id
  isolated_subnet_ids = data.aws_subnets.default.ids
  client_sg_ids       = [var.nysdev_security_group_id]
  node_type           = var.redis_node_type
  replica_count       = 0
  tags                = local.tags
}

# ── Outputs ──────────────────────────────────────────────────────────────────
output "route53_zone_id" { value = module.route53.zone_id }
output "route53_nameservers" {
  value       = module.route53.nameservers
  description = "Replace BigRock NS records for nyayasiddhi.online with these four values."
}
output "acm_certificate_arn" { value = module.acm.certificate_arn }
output "alb_dns" { value = aws_lb.edge.dns_name }
output "alb_zone_id" { value = aws_lb.edge.zone_id }
output "alb_arn" { value = aws_lb.edge.arn }
output "alb_target_instance" { value = data.aws_instance.nysdev.id }
output "alb_target_public_ip" { value = data.aws_instance.nysdev.public_ip }
output "waf_web_acl_arn" { value = module.waf.web_acl_arn }
output "waf_action" { value = module.waf.current_action }
output "waf_dashboard_url" {
  value       = "https://${var.aws_region}.console.aws.amazon.com/cloudwatch/home?region=${var.aws_region}#dashboards:name=${aws_cloudwatch_dashboard.waf.dashboard_name}"
  description = "Direct link to the WAF count-vs-block CloudWatch dashboard."
}

# Managed datastores — null when enable_managed_datastores=false. Use:
#   terraform output -json datastores | jq
# from inside `infra/terraform/envs/dev-edge/` to read endpoints + secret ARNs
# during the cutover (see scripts/migrate-to-managed-datastores.sh).
output "datastores" {
  description = "RDS + ElastiCache endpoints and Secrets Manager ARNs (Task #17)."
  sensitive   = true
  value = {
    enabled = var.enable_managed_datastores
    rds = var.enable_managed_datastores ? {
      endpoint    = module.rds[0].endpoint
      address     = module.rds[0].address
      instance_id = module.rds[0].instance_id
      secret_arn  = module.rds[0].secret_arn
      sg_id       = module.rds[0].sg_id
    } : null
    redis = var.enable_managed_datastores ? {
      primary_endpoint = module.elasticache[0].primary_endpoint
      reader_endpoint  = module.elasticache[0].reader_endpoint
      secret_arn       = module.elasticache[0].secret_arn
      sg_id            = module.elasticache[0].sg_id
    } : null
  }
}
