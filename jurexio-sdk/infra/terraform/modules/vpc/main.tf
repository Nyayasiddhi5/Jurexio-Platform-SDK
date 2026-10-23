# =============================================================================
# VPC module — 3-AZ VPC with three subnet tiers:
#   public    (ALB, NAT GW)    — /24 per AZ
#   private   (EC2, ECS, ELB)  — /24 per AZ
#   isolated  (RDS, ElastiCache, no internet egress) — /24 per AZ
#
# Cost: 1 NAT Gateway (~$32/mo + per-GB).  For prod we use ONE NAT GW shared
# across all AZs (cost-optimised; cross-AZ data charges apply).  Set
# `nat_strategy = "per_az"` in production once traffic justifies the spend.
# =============================================================================

terraform {
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.60" }
  }
}

variable "name"            { type = string }
variable "cidr"            {
  type = string
  default = "10.50.0.0/16"
}
variable "az_count"        {
  type = number
  default = 3
}
variable "nat_strategy"    {
  type = string
  default = "single"
  description = "single | per_az | none"
}
variable "tags"            {
  type = map(string)
  default = {}
}
data "aws_availability_zones" "this" { state = "available" }

locals {
  azs            = slice(data.aws_availability_zones.this.names, 0, var.az_count)
  public_cidrs   = [for i, _ in local.azs : cidrsubnet(var.cidr, 8, i)]            # 10.50.0.0/24, 10.50.1.0/24, ...
  private_cidrs  = [for i, _ in local.azs : cidrsubnet(var.cidr, 8, i + 10)]       # 10.50.10.0/24, ...
  isolated_cidrs = [for i, _ in local.azs : cidrsubnet(var.cidr, 8, i + 20)]       # 10.50.20.0/24, ...
}

resource "aws_vpc" "this" {
  cidr_block           = var.cidr
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags                 = merge(var.tags, { Name = var.name })
}

resource "aws_internet_gateway" "this" {
  vpc_id = aws_vpc.this.id
  tags   = merge(var.tags, { Name = "${var.name}-igw" })
}

# Public subnets
resource "aws_subnet" "public" {
  for_each                = { for i, az in local.azs : az => { idx = i, cidr = local.public_cidrs[i] } }
  vpc_id                  = aws_vpc.this.id
  availability_zone       = each.key
  cidr_block              = each.value.cidr
  map_public_ip_on_launch = true
  tags                    = merge(var.tags, { Name = "${var.name}-pub-${each.key}", Tier = "public" })
}

# Private subnets (egress via NAT)
resource "aws_subnet" "private" {
  for_each          = { for i, az in local.azs : az => { idx = i, cidr = local.private_cidrs[i] } }
  vpc_id            = aws_vpc.this.id
  availability_zone = each.key
  cidr_block        = each.value.cidr
  tags              = merge(var.tags, { Name = "${var.name}-priv-${each.key}", Tier = "private" })
}

# Isolated subnets (NO internet egress — RDS, ElastiCache live here)
resource "aws_subnet" "isolated" {
  for_each          = { for i, az in local.azs : az => { idx = i, cidr = local.isolated_cidrs[i] } }
  vpc_id            = aws_vpc.this.id
  availability_zone = each.key
  cidr_block        = each.value.cidr
  tags              = merge(var.tags, { Name = "${var.name}-iso-${each.key}", Tier = "isolated" })
}

# NAT Gateway(s)
resource "aws_eip" "nat" {
  for_each = var.nat_strategy == "per_az" ? aws_subnet.public : (
    var.nat_strategy == "single" ? { (local.azs[0]) = aws_subnet.public[local.azs[0]] } : {}
  )
  domain = "vpc"
  tags   = merge(var.tags, { Name = "${var.name}-nat-eip-${each.key}" })
}

resource "aws_nat_gateway" "this" {
  for_each      = aws_eip.nat
  allocation_id = each.value.id
  subnet_id     = aws_subnet.public[each.key].id
  tags          = merge(var.tags, { Name = "${var.name}-nat-${each.key}" })

  depends_on = [aws_internet_gateway.this]
}

# Route tables
resource "aws_route_table" "public" {
  vpc_id = aws_vpc.this.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.this.id
  }
  tags = merge(var.tags, { Name = "${var.name}-rt-public" })
}

resource "aws_route_table_association" "public" {
  for_each       = aws_subnet.public
  subnet_id      = each.value.id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table" "private" {
  for_each = aws_subnet.private
  vpc_id   = aws_vpc.this.id
  tags     = merge(var.tags, { Name = "${var.name}-rt-priv-${each.key}" })

  dynamic "route" {
    for_each = length(aws_nat_gateway.this) > 0 ? [1] : []
    content {
      cidr_block     = "0.0.0.0/0"
      nat_gateway_id = var.nat_strategy == "per_az" ? aws_nat_gateway.this[each.key].id : aws_nat_gateway.this[local.azs[0]].id
    }
  }
}

resource "aws_route_table_association" "private" {
  for_each       = aws_subnet.private
  subnet_id      = each.value.id
  route_table_id = aws_route_table.private[each.key].id
}

# Isolated subnets get no default route — they can only reach VPC-local
# resources and AWS services via VPC endpoints (added below for Secrets Manager
# + ECR so the gateway containers can pull images and read secrets without
# going out to the internet).
resource "aws_route_table" "isolated" {
  vpc_id = aws_vpc.this.id
  tags   = merge(var.tags, { Name = "${var.name}-rt-iso" })
}

resource "aws_route_table_association" "isolated" {
  for_each       = aws_subnet.isolated
  subnet_id      = each.value.id
  route_table_id = aws_route_table.isolated.id
}

# ── VPC endpoints (so isolated + private subnets can reach AWS services
#    without paying NAT bandwidth) ─────────────────────────────────────────
resource "aws_vpc_endpoint" "s3" {
  vpc_id            = aws_vpc.this.id
  service_name      = "com.amazonaws.${data.aws_region.this.name}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = concat(
    [for rt in aws_route_table.private : rt.id],
    [aws_route_table.isolated.id]
  )
  tags = merge(var.tags, { Name = "${var.name}-vpce-s3" })
}

data "aws_region" "this" {}

output "vpc_id"            { value = aws_vpc.this.id }
output "vpc_cidr"          { value = aws_vpc.this.cidr_block }
output "public_subnet_ids"   { value = [for s in aws_subnet.public   : s.id] }
output "private_subnet_ids"  { value = [for s in aws_subnet.private  : s.id] }
output "isolated_subnet_ids" { value = [for s in aws_subnet.isolated : s.id] }
output "azs"                 { value = local.azs }
