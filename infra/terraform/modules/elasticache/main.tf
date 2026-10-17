# =============================================================================
# ElastiCache Redis module — primary + replica (Multi-AZ on by default for prod;
# the staging env passes `replica_count = 0` to save cost).
# =============================================================================

terraform {
  required_providers { aws = { source = "hashicorp/aws", version = "~> 5.60" } }
}

variable "name"                { type = string }
variable "vpc_id"              { type = string }
variable "isolated_subnet_ids" { type = list(string) }
variable "client_sg_ids"       {
  type = list(string)
  default = []
}
variable "node_type"           {
  type = string
  default = "cache.t4g.small"
}
variable "replica_count"       {
  type = number
  default = 1
}
variable "tags"                {
  type = map(string)
  default = {}
}
resource "aws_elasticache_subnet_group" "this" {
  name       = "${var.name}-subnets"
  subnet_ids = var.isolated_subnet_ids
  tags       = var.tags
}

resource "aws_security_group" "redis" {
  name        = "${var.name}-redis"
  description = "Redis ${var.name} ingress on 6379"
  vpc_id      = var.vpc_id

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(var.tags, { Name = "${var.name}-redis-sg" })
}

resource "aws_security_group_rule" "redis_ingress" {
  for_each                 = toset(var.client_sg_ids)
  type                     = "ingress"
  from_port                = 6379
  to_port                  = 6379
  protocol                 = "tcp"
  source_security_group_id = each.key
  security_group_id        = aws_security_group.redis.id
  description              = "From client SG ${each.key}"
}

resource "random_password" "auth" {
  length           = 40
  special          = false
}

resource "aws_secretsmanager_secret" "auth" {
  name = "${var.name}/redis/auth"
  tags = var.tags
}

resource "aws_secretsmanager_secret_version" "auth" {
  secret_id     = aws_secretsmanager_secret.auth.id
  secret_string = jsonencode({
    auth_token = random_password.auth.result
    host       = aws_elasticache_replication_group.this.primary_endpoint_address
    port       = 6379
  })
}

resource "aws_elasticache_replication_group" "this" {
  replication_group_id        = var.name
  description                 = "Nyayavigya Redis ${var.name}"
  engine                      = "redis"
  engine_version              = "7.1"
  node_type                   = var.node_type
  num_cache_clusters          = 1 + var.replica_count
  parameter_group_name        = "default.redis7"
  port                        = 6379
  subnet_group_name           = aws_elasticache_subnet_group.this.name
  security_group_ids          = [aws_security_group.redis.id]
  automatic_failover_enabled  = var.replica_count > 0
  multi_az_enabled            = var.replica_count > 0
  at_rest_encryption_enabled  = true
  transit_encryption_enabled  = true
  auth_token                  = random_password.auth.result
  snapshot_retention_limit    = 7
  snapshot_window             = "18:30-19:30"   # 00:00-01:00 IST
  maintenance_window          = "sun:19:30-sun:20:30"
  apply_immediately           = false

  tags = merge(var.tags, { Name = var.name })
}

output "primary_endpoint" { value = aws_elasticache_replication_group.this.primary_endpoint_address }
output "reader_endpoint"  { value = aws_elasticache_replication_group.this.reader_endpoint_address }
output "secret_arn"       { value = aws_secretsmanager_secret.auth.arn }
output "sg_id"            { value = aws_security_group.redis.id }
