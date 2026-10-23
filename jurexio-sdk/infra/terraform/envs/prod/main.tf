# =============================================================================
# Nyayavigya — production environment
#
# Cost target: ~$200/mo  (see infra/terraform/README.md "Cost guardrails")
# Apply order is enforced by Terraform's dependency graph; you do NOT need to
# run modules individually.
# =============================================================================

locals {
  prefix = "nyv-prod"

  tags = {
    Project    = "Nyayavigya"
    Env        = "prod"
    ManagedBy  = "terraform"
    Owner      = "nyayavigya-platform"
    CostCenter = "engineering"
    Repo       = "nyayasiddhi/nyayavigya-platform-312"
  }
}

module "vpc" {
  source       = "../../modules/vpc"
  name         = "${local.prefix}-vpc"
  cidr         = "10.50.0.0/16"
  az_count     = 3
  nat_strategy = "single"   # cheaper; bump to per_az once cross-AZ NAT cost noticed
  tags         = local.tags
}

module "ecr" {
  source = "../../modules/ecr"
  tags   = local.tags
}

module "secrets" {
  source = "../../modules/secrets"
  env    = "prod"
  tags   = local.tags
}

module "ec2_host" {
  source              = "../../modules/ec2_host"
  name                = "${local.prefix}-app"
  vpc_id              = module.vpc.vpc_id
  subnet_id           = module.vpc.private_subnet_ids[0]
  instance_type       = var.ec2_instance_type
  ssh_key_name        = var.ssh_key_name
  alb_sg_id           = module.alb.alb_sg_id
  extra_ingress_cidrs = var.operator_ssh_cidrs
  secrets_arn_pattern = module.secrets.all_arns_pattern
  ecr_repo_arns       = values(module.ecr.repository_arns)
  tags                = local.tags
}

module "rds" {
  source                = "../../modules/rds"
  name                  = "${local.prefix}-pg"
  vpc_id                = module.vpc.vpc_id
  isolated_subnet_ids   = module.vpc.isolated_subnet_ids
  client_sg_ids         = [module.ec2_host.host_sg_id]
  instance_class        = var.db_instance_class
  allocated_storage_gb  = var.db_allocated_storage_gb
  max_storage_gb        = var.db_max_storage_gb
  multi_az              = var.db_multi_az
  backup_retention_days = var.db_backup_retention_days
  create_read_replica   = var.create_rds_replica
  tags                  = local.tags
}

module "elasticache" {
  source              = "../../modules/elasticache"
  name                = "${local.prefix}-redis"
  vpc_id              = module.vpc.vpc_id
  isolated_subnet_ids = module.vpc.isolated_subnet_ids
  client_sg_ids       = [module.ec2_host.host_sg_id]
  node_type           = var.redis_node_type
  replica_count       = var.redis_replica_count
  tags                = local.tags
}

# ─────────────────────────────────────────────────────────────────────────────
# Route 53 hosted zone for var.domain is OWNED BY envs/dev-edge.
# Do NOT re-create it here (would race two Terraform states for the same
# zone). When this prod env is eventually applied, it will:
#   1. Look up the existing zone via the data source below.
#   2. Add its prod-specific A/ALIAS records pointing at THIS env's prod ALB
#      (using a domain prefix or a sub-zone — not the apex, which dev-edge
#      currently controls). Wire those records inside the route53 module if
#      you split it; for now the module call is intentionally absent.
# Migration path if/when prod becomes the sole authority:
#   - Phase 1: terraform state mv 'module.route53' from envs/dev-edge into
#     envs/prod state, then remove from dev-edge.
#   - Phase 2: re-introduce `module "route53"` here pointing at the moved
#     zone.
# Until then, prod cannot manage zone records and the apex remains under
# dev-edge.
# ─────────────────────────────────────────────────────────────────────────────
data "aws_route53_zone" "this" {
  name         = var.domain
  private_zone = false
}

module "acm" {
  source     = "../../modules/acm"
  domain     = var.domain
  zone_id    = data.aws_route53_zone.this.zone_id
  extra_sans = []
  tags       = local.tags
}

module "alb" {
  source            = "../../modules/alb"
  name              = "${local.prefix}-alb"
  vpc_id            = module.vpc.vpc_id
  public_subnet_ids = module.vpc.public_subnet_ids
  certificate_arn   = module.acm.certificate_arn
  tags              = local.tags
}

# Attachment lives at the env level to avoid an alb<->ec2_host cycle.
resource "aws_lb_target_group_attachment" "edge" {
  target_group_arn = module.alb.tg_arn
  target_id        = module.ec2_host.instance_id
  port             = 80
}

module "waf" {
  source     = "../../modules/waf"
  name       = "${local.prefix}-waf"
  alb_arn    = module.alb.alb_arn
  rate_limit = 2000
  action     = var.waf_action
  tags       = local.tags
}

module "cloudwatch" {
  source           = "../../modules/cloudwatch"
  env              = "prod"
  alb_arn_suffix   = module.alb.alb_arn_suffix
  rds_instance_id  = module.rds.instance_id
  redis_id         = "${local.prefix}-redis"
  alarm_email      = var.alarm_email
  tags             = local.tags
}

# Per-partner IAM roles for the 5 ecosystem deployers
locals {
  partners = ["nym", "nsp", "nsi", "nsa", "nsm"]
  # Container port each partner app listens on. Used both for the per-partner
  # ALB target groups and (today) by Caddy when it host-routes inside the box.
  partner_ports = {
    nym = 5101
    nsp = 5102
    nsi = 5103
    nsa = 5104
    nsm = 5105
  }
}

# Per-partner ALB target groups. Initially these have no listener rules wired
# in — the shared Caddy edge still does Host-based routing inside the box. The
# TGs exist so that:
#   1. Partner deploy roles can RegisterTargets / DeregisterTargets against
#      ONLY their own TG, not the shared edge TG (least-privilege).
#   2. When a partner is ready to migrate off the shared edge, the operator
#      adds an ALB listener rule pointing at the partner's TG and disables the
#      Caddy host block — no IAM change required.
resource "aws_lb_target_group" "partner" {
  for_each    = toset(local.partners)
  name        = "${local.prefix}-${each.key}-tg"
  port        = local.partner_ports[each.key]
  protocol    = "HTTP"
  vpc_id      = module.vpc.vpc_id
  target_type = "instance"

  health_check {
    enabled             = true
    path                = "/health"
    matcher             = "200"
    interval            = 30
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }

  tags = merge(local.tags, { Partner = each.key })

  lifecycle {
    create_before_destroy = true
  }
}

module "iam_partner" {
  for_each       = toset(local.partners)
  source         = "../../modules/iam_partner"
  partner_id     = each.key
  env            = "prod"
  ecr_repo_arns  = [module.ecr.repository_arns["${each.key}-app"]]
  # Prod is OIDC-ONLY. The variable validation in variables.tf already enforces
  # that partner_github_repos contains every partner; the iam_partner module
  # has a second precondition that fails when env="prod" and trusted_user_arn
  # is non-null. Belt + suspenders.
  github_repo      = var.partner_github_repos[each.key]
  trusted_user_arn = null
  # Each partner's role can register / deregister targets ONLY in its own TG.
  # Cross-partner mutation is impossible because the policy is ARN-scoped.
  tg_arns          = [aws_lb_target_group.partner[each.key].arn]
  tags             = local.tags
}

# ── Outputs ──────────────────────────────────────────────────────────────────
output "alb_dns"             { value = module.alb.alb_dns }
output "alb_zone_id"         { value = module.alb.alb_zone_id }
output "ec2_public_ip"       { value = module.ec2_host.public_ip }
output "rds_endpoint"        {
  value = module.rds.endpoint
  sensitive = true
}
output "rds_secret_arn"      { value = module.rds.secret_arn }
output "redis_endpoint"      {
  value = module.elasticache.primary_endpoint
  sensitive = true
}
output "redis_secret_arn"    { value = module.elasticache.secret_arn }
output "ecr_urls"            { value = module.ecr.repository_urls }
output "ecr_arns"            { value = module.ecr.repository_arns }
# Route 53 outputs reflect the zone OWNED BY envs/dev-edge — see the comment
# block above the data.aws_route53_zone.this lookup. The nameservers list is
# read live from the existing zone for convenience.
output "route53_nameservers" { value = data.aws_route53_zone.this.name_servers }
output "route53_zone_id"     { value = data.aws_route53_zone.this.zone_id }
output "acm_certificate_arn" { value = module.acm.certificate_arn }
output "waf_action"          { value = module.waf.current_action }
output "partner_role_arns"   { value = { for p, m in module.iam_partner : p => m.role_arn } }
output "partner_tg_arns"     { value = { for p, t in aws_lb_target_group.partner : p => t.arn } }
