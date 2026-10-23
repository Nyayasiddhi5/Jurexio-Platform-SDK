# =============================================================================
# CloudWatch module — log groups + 5 P1 alarms + 1 dashboard.
# =============================================================================

terraform {
  required_providers { aws = { source = "hashicorp/aws", version = "~> 5.60" } }
}

variable "env"               { type = string }
variable "alb_arn_suffix"    { type = string }
variable "rds_instance_id"   { type = string }
variable "redis_id"          { type = string }
variable "alarm_email"       {
  type = string
  default = null
}
variable "tags"              {
  type = map(string)
  default = {}
}
locals {
  log_groups = [
    "gateway",
    "console",
    "caddy",
    "nym",
    "nsp",
    "nsi",
    "nsa",
    "nsm",
  ]
}

resource "aws_cloudwatch_log_group" "this" {
  for_each          = toset(local.log_groups)
  name              = "/aws/nyayavigya/${var.env}/${each.key}"
  retention_in_days = 30
  tags              = var.tags
}

resource "aws_sns_topic" "alarms" {
  name = "nyayavigya-${var.env}-alarms"
  tags = var.tags
}

resource "aws_sns_topic_subscription" "email" {
  count     = var.alarm_email == null ? 0 : 1
  topic_arn = aws_sns_topic.alarms.arn
  protocol  = "email"
  endpoint  = var.alarm_email
}

# ── P1 alarms ────────────────────────────────────────────────────────────────
resource "aws_cloudwatch_metric_alarm" "alb_5xx" {
  alarm_name          = "nyv-${var.env}-alb-5xx"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "HTTPCode_ELB_5XX_Count"
  namespace           = "AWS/ApplicationELB"
  period              = 60
  statistic           = "Sum"
  threshold           = 10
  alarm_description   = "ALB returned > 10 5xx in 1 minute, twice in a row"
  alarm_actions       = [aws_sns_topic.alarms.arn]
  ok_actions          = [aws_sns_topic.alarms.arn]
  treat_missing_data  = "notBreaching"
  dimensions = {
    LoadBalancer = var.alb_arn_suffix
  }
  tags = var.tags
}

resource "aws_cloudwatch_metric_alarm" "alb_target_5xx" {
  alarm_name          = "nyv-${var.env}-target-5xx"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "HTTPCode_Target_5XX_Count"
  namespace           = "AWS/ApplicationELB"
  period              = 60
  statistic           = "Sum"
  threshold           = 20
  alarm_actions       = [aws_sns_topic.alarms.arn]
  ok_actions          = [aws_sns_topic.alarms.arn]
  dimensions = { LoadBalancer = var.alb_arn_suffix }
  tags = var.tags
}

resource "aws_cloudwatch_metric_alarm" "rds_cpu" {
  alarm_name          = "nyv-${var.env}-rds-cpu"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 5
  metric_name         = "CPUUtilization"
  namespace           = "AWS/RDS"
  period              = 60
  statistic           = "Average"
  threshold           = 80
  alarm_description   = "RDS CPU > 80% for 5 minutes"
  alarm_actions       = [aws_sns_topic.alarms.arn]
  ok_actions          = [aws_sns_topic.alarms.arn]
  dimensions = { DBInstanceIdentifier = var.rds_instance_id }
  tags = var.tags
}

resource "aws_cloudwatch_metric_alarm" "rds_storage" {
  alarm_name          = "nyv-${var.env}-rds-storage-low"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 1
  metric_name         = "FreeStorageSpace"
  namespace           = "AWS/RDS"
  period              = 300
  statistic           = "Average"
  threshold           = 5 * 1024 * 1024 * 1024   # < 5 GB free
  alarm_actions       = [aws_sns_topic.alarms.arn]
  dimensions = { DBInstanceIdentifier = var.rds_instance_id }
  tags = var.tags
}

resource "aws_cloudwatch_metric_alarm" "redis_cpu" {
  alarm_name          = "nyv-${var.env}-redis-cpu"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 5
  metric_name         = "EngineCPUUtilization"
  namespace           = "AWS/ElastiCache"
  period              = 60
  statistic           = "Average"
  threshold           = 75
  alarm_actions       = [aws_sns_topic.alarms.arn]
  dimensions = { ReplicationGroupId = var.redis_id }
  tags = var.tags
}

# ── Dashboard ────────────────────────────────────────────────────────────────
resource "aws_cloudwatch_dashboard" "this" {
  dashboard_name = "Nyayavigya-${var.env}"

  dashboard_body = jsonencode({
    widgets = [
      {
        type   = "metric"
        x      = 0, y = 0, width = 12, height = 6
        properties = {
          title  = "ALB requests + 5xx"
          metrics = [
            ["AWS/ApplicationELB", "RequestCount",        "LoadBalancer", var.alb_arn_suffix],
            ["AWS/ApplicationELB", "HTTPCode_ELB_5XX_Count",   "LoadBalancer", var.alb_arn_suffix],
            ["AWS/ApplicationELB", "HTTPCode_Target_5XX_Count","LoadBalancer", var.alb_arn_suffix],
          ]
          period = 60
          stat   = "Sum"
          region = "ap-south-1"
        }
      },
      {
        type   = "metric"
        x      = 12, y = 0, width = 12, height = 6
        properties = {
          title   = "ALB target latency p95"
          metrics = [["AWS/ApplicationELB", "TargetResponseTime", "LoadBalancer", var.alb_arn_suffix, { stat = "p95" }]]
          period  = 60
          region  = "ap-south-1"
        }
      },
      {
        type   = "metric"
        x      = 0, y = 6, width = 12, height = 6
        properties = {
          title  = "RDS CPU + connections"
          metrics = [
            ["AWS/RDS", "CPUUtilization", "DBInstanceIdentifier", var.rds_instance_id],
            ["AWS/RDS", "DatabaseConnections", "DBInstanceIdentifier", var.rds_instance_id, { yAxis = "right" }],
          ]
          period = 60
          stat   = "Average"
          region = "ap-south-1"
        }
      },
      {
        type   = "metric"
        x      = 12, y = 6, width = 12, height = 6
        properties = {
          title   = "Redis CPU + bytes used"
          metrics = [
            ["AWS/ElastiCache", "EngineCPUUtilization", "ReplicationGroupId", var.redis_id],
            ["AWS/ElastiCache", "BytesUsedForCache",   "ReplicationGroupId", var.redis_id, { yAxis = "right" }],
          ]
          period = 60
          stat   = "Average"
          region = "ap-south-1"
        }
      }
    ]
  })
}

output "log_group_arns"  { value = { for k, lg in aws_cloudwatch_log_group.this : k => lg.arn } }
output "log_group_names" { value = { for k, lg in aws_cloudwatch_log_group.this : k => lg.name } }
output "alarms_topic_arn"{ value = aws_sns_topic.alarms.arn }
