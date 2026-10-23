# =============================================================================
# RDS module — Postgres 16, multi-AZ, PITR enabled, optional read replica.
# =============================================================================

terraform {
  required_providers { aws = { source = "hashicorp/aws", version = "~> 5.60" } }
}

variable "name"                  { type = string }
variable "vpc_id"                { type = string }
variable "isolated_subnet_ids"   { type = list(string) }
variable "client_sg_ids"         {
  type = list(string)
  default = []
  description = "SG IDs allowed to connect on 5432"
}
variable "instance_class"        {
  type = string
  default = "db.t4g.medium"
}
variable "allocated_storage_gb"  {
  type = number
  default = 100
}
variable "max_storage_gb"        {
  type = number
  default = 500
}
variable "multi_az"              {
  type = bool
  default = true
}
variable "backup_retention_days" {
  type = number
  default = 14
}
variable "create_read_replica"   {
  type = bool
  default = false
}
variable "deletion_protection"   {
  type = bool
  default = true
}
variable "tags"                  {
  type = map(string)
  default = {}
}
resource "aws_db_subnet_group" "this" {
  name       = "${var.name}-subnets"
  subnet_ids = var.isolated_subnet_ids
  tags       = merge(var.tags, { Name = "${var.name}-subnets" })
}

resource "aws_security_group" "rds" {
  name        = "${var.name}-rds"
  description = "RDS ${var.name} ingress on 5432"
  vpc_id      = var.vpc_id

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(var.tags, { Name = "${var.name}-rds-sg" })
}

resource "aws_security_group_rule" "rds_ingress" {
  for_each                 = toset(var.client_sg_ids)
  type                     = "ingress"
  from_port                = 5432
  to_port                  = 5432
  protocol                 = "tcp"
  source_security_group_id = each.key
  security_group_id        = aws_security_group.rds.id
  description              = "From client SG ${each.key}"
}

resource "random_password" "master" {
  length           = 32
  override_special = "!#$%&*()-_=+[]{}<>:?"
}

resource "aws_secretsmanager_secret" "rds_master" {
  name = "${var.name}/rds/master"
  tags = var.tags
}

resource "aws_secretsmanager_secret_version" "rds_master" {
  secret_id     = aws_secretsmanager_secret.rds_master.id
  secret_string = jsonencode({
    username = "nyvadmin"
    password = random_password.master.result
    host     = aws_db_instance.this.address
    port     = 5432
    dbname   = "nyayavigya"
  })
}

resource "aws_db_parameter_group" "this" {
  name   = "${var.name}-pg16"
  family = "postgres16"

  parameter {
    name  = "log_min_duration_statement"
    value = "500"          # log queries >500ms
  }

  parameter {
    name  = "shared_preload_libraries"
    value = "pg_stat_statements"
    apply_method = "pending-reboot"
  }

  tags = var.tags
}

resource "aws_db_instance" "this" {
  identifier              = var.name
  engine                  = "postgres"
  engine_version          = "16.6"
  instance_class          = var.instance_class
  allocated_storage       = var.allocated_storage_gb
  max_allocated_storage   = var.max_storage_gb
  storage_type            = "gp3"
  storage_encrypted       = true
  multi_az                = var.multi_az
  username                = "nyvadmin"
  password                = random_password.master.result
  db_name                 = "nyayavigya"
  port                    = 5432
  vpc_security_group_ids  = [aws_security_group.rds.id]
  db_subnet_group_name    = aws_db_subnet_group.this.name
  parameter_group_name    = aws_db_parameter_group.this.name
  backup_retention_period = var.backup_retention_days
  backup_window           = "18:00-18:30"     # 23:30-00:00 IST
  maintenance_window      = "sun:18:30-sun:19:30"
  deletion_protection     = var.deletion_protection
  skip_final_snapshot     = false
  final_snapshot_identifier = "${var.name}-final-${formatdate("YYYYMMDDhhmmss", timestamp())}"
  copy_tags_to_snapshot   = true
  performance_insights_enabled = true
  performance_insights_retention_period = 7
  enabled_cloudwatch_logs_exports = ["postgresql", "upgrade"]
  auto_minor_version_upgrade = true
  apply_immediately          = false

  lifecycle {
    ignore_changes = [final_snapshot_identifier, password]
  }

  tags = merge(var.tags, { Name = var.name })
}

resource "aws_db_instance" "replica" {
  count               = var.create_read_replica ? 1 : 0
  identifier          = "${var.name}-replica"
  replicate_source_db = aws_db_instance.this.identifier
  instance_class      = var.instance_class
  vpc_security_group_ids = [aws_security_group.rds.id]
  publicly_accessible = false
  storage_encrypted   = true
  performance_insights_enabled = true
  deletion_protection = false
  skip_final_snapshot = true

  tags = merge(var.tags, { Name = "${var.name}-replica" })
}

output "endpoint"          { value = aws_db_instance.this.endpoint }
output "address"           { value = aws_db_instance.this.address }
output "instance_id" {
  value       = aws_db_instance.this.identifier
  description = "DBInstanceIdentifier for CloudWatch dimensions."
}
output "secret_arn"        { value = aws_secretsmanager_secret.rds_master.arn }
output "sg_id"             { value = aws_security_group.rds.id }
output "replica_endpoint"  { value = try(aws_db_instance.replica[0].endpoint, null) }
