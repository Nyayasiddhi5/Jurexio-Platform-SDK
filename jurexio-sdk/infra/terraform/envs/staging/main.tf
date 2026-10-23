# =============================================================================
# Nyayavigya — staging environment
#
# Smaller footprint than prod:
#   • single-AZ RDS (no multi_az)
#   • no read replica
#   • no Redis replica
#   • t3.medium EC2
#   • shares the same Route53 zone as prod (records added under staging-*)
#   • shares the same ACM cert (the prod cert SANs already cover *.nyayasiddhi.online)
#
# Cost target: ~$50/mo
# =============================================================================

data "terraform_remote_state" "prod" {
  backend = "s3"
  config = {
    bucket = "nyv-tfstate-789925699169-ap-south-1"
    key    = "envs/prod/terraform.tfstate"
    region = "ap-south-1"
  }
}

locals {
  prefix = "nyv-stg"
  tags = {
    Project    = "Nyayavigya"
    Env        = "staging"
    ManagedBy  = "terraform"
    Owner      = "nyayavigya-platform"
    CostCenter = "engineering"
    Repo       = "nyayasiddhi/nyayavigya-platform-312"
  }
}

module "vpc" {
  source       = "../../modules/vpc"
  name         = "${local.prefix}-vpc"
  cidr         = "10.51.0.0/16"
  az_count     = 2
  nat_strategy = "single"
  tags         = local.tags
}

module "secrets" {
  source = "../../modules/secrets"
  env    = "staging"
  tags   = local.tags
}

module "ec2_host" {
  source              = "../../modules/ec2_host"
  name                = "${local.prefix}-app"
  vpc_id              = module.vpc.vpc_id
  subnet_id           = module.vpc.private_subnet_ids[0]
  instance_type       = "t3.medium"
  ssh_key_name        = var.ssh_key_name
  alb_sg_id           = module.alb.alb_sg_id
  extra_ingress_cidrs = var.operator_ssh_cidrs
  secrets_arn_pattern = module.secrets.all_arns_pattern
  ecr_repo_arns       = values(try(data.terraform_remote_state.prod.outputs.ecr_arns, {}))
  tags                = local.tags
}

module "rds" {
  source                = "../../modules/rds"
  name                  = "${local.prefix}-pg"
  vpc_id                = module.vpc.vpc_id
  isolated_subnet_ids   = module.vpc.isolated_subnet_ids
  client_sg_ids         = [module.ec2_host.host_sg_id]
  instance_class        = "db.t4g.small"
  multi_az              = false
  backup_retention_days = 7
  create_read_replica   = false
  deletion_protection   = false
  tags                  = local.tags
}

module "elasticache" {
  source              = "../../modules/elasticache"
  name                = "${local.prefix}-redis"
  vpc_id              = module.vpc.vpc_id
  isolated_subnet_ids = module.vpc.isolated_subnet_ids
  client_sg_ids       = [module.ec2_host.host_sg_id]
  node_type           = "cache.t4g.micro"
  replica_count       = 0
  tags                = local.tags
}

module "alb" {
  source            = "../../modules/alb"
  name              = "${local.prefix}-alb"
  vpc_id            = module.vpc.vpc_id
  public_subnet_ids = module.vpc.public_subnet_ids
  certificate_arn   = data.terraform_remote_state.prod.outputs.acm_certificate_arn
  tags              = local.tags
}

resource "aws_lb_target_group_attachment" "edge" {
  target_group_arn = module.alb.tg_arn
  target_id        = module.ec2_host.instance_id
  port             = 80
}

module "waf" {
  source     = "../../modules/waf"
  name       = "${local.prefix}-waf"
  alb_arn    = module.alb.alb_arn
  rate_limit = 1000
  action     = "count"          # staging always count — never block
  tags       = local.tags
}

module "cloudwatch" {
  source           = "../../modules/cloudwatch"
  env              = "staging"
  alb_arn_suffix   = module.alb.alb_arn_suffix
  rds_instance_id  = module.rds.instance_id
  redis_id         = "${local.prefix}-redis"
  alarm_email      = var.alarm_email
  tags             = local.tags
}

# Staging Route53 records — created in this env (not the prod env) so the
# staging ALB ID is known at plan time. Uses the shared zone created by the
# prod env (read via remote_state above).
locals {
  staging_subdomains = [
    "staging",
    "staging-pro",
    "staging-nym",
    "staging-ins",
    "staging-ace",
    "staging-min",
  ]
}

resource "aws_route53_record" "staging" {
  for_each = toset(local.staging_subdomains)
  zone_id  = data.terraform_remote_state.prod.outputs.route53_zone_id
  name     = "${each.key}.nyayasiddhi.online"
  type     = "A"
  alias {
    name                   = module.alb.alb_dns
    zone_id                = module.alb.alb_zone_id
    evaluate_target_health = true
  }
}

output "alb_dns"          { value = module.alb.alb_dns }
output "alb_zone_id"      { value = module.alb.alb_zone_id }
output "ec2_public_ip"    { value = module.ec2_host.public_ip }
output "rds_endpoint"     {
  value = module.rds.endpoint
  sensitive = true
}
output "redis_endpoint"   {
  value = module.elasticache.primary_endpoint
  sensitive = true
}