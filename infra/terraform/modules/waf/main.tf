# =============================================================================
# WAFv2 module — Common Rule Set + Bad Inputs + per-IP rate limit.
# Action defaults to COUNT (observation-only) so we can collect a baseline
# before flipping to BLOCK.  Per the production readiness checklist, the
# operator runs >= 1 week in count mode then sets `action = "block"`.
# =============================================================================

terraform {
  required_providers { aws = { source = "hashicorp/aws", version = "~> 5.60" } }
}

variable "name"             { type = string }
variable "alb_arn"          { type = string }
variable "rate_limit"       {
  type = number
  default = 2000
}
variable "action"           {
  type = string
  default = "count"
  description = "count | block"
}
variable "enable_bot_control" {
  type        = bool
  default     = false
  description = "Enable AWSManagedRulesBotControlRuleSet (~$10/mo + $1/M reqs). Off by default to respect the $120-180/mo budget; flip to true after the public launch."
}
variable "tags"             {
  type = map(string)
  default = {}
}
locals {
  rule_action = var.action == "block" ? "block" : "count"
}

resource "aws_wafv2_web_acl" "this" {
  name        = var.name
  scope       = "REGIONAL"
  description = "Web ACL for ${var.name}"

  default_action {
    allow {}
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "${var.name}-overall"
    sampled_requests_enabled   = true
  }

  rule {
    name     = "AWS-AWSManagedRulesCommonRuleSet"
    priority = 10
    override_action {
      dynamic "count" {
        for_each = local.rule_action == "count" ? [1] : []
        content {}
      }
      dynamic "none" {
        for_each = local.rule_action == "block" ? [1] : []
        content {}
      }
    }
    statement {
      managed_rule_group_statement {
        vendor_name = "AWS"
        name        = "AWSManagedRulesCommonRuleSet"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.name}-common"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "AWS-AWSManagedRulesKnownBadInputsRuleSet"
    priority = 20
    override_action {
      dynamic "count" {
        for_each = local.rule_action == "count" ? [1] : []
        content {}
      }
      dynamic "none" {
        for_each = local.rule_action == "block" ? [1] : []
        content {}
      }
    }
    statement {
      managed_rule_group_statement {
        vendor_name = "AWS"
        name        = "AWSManagedRulesKnownBadInputsRuleSet"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.name}-bad-inputs"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "AWS-AWSManagedRulesAmazonIpReputationList"
    priority = 25
    override_action {
      dynamic "count" {
        for_each = local.rule_action == "count" ? [1] : []
        content {}
      }
      dynamic "none" {
        for_each = local.rule_action == "block" ? [1] : []
        content {}
      }
    }
    statement {
      managed_rule_group_statement {
        vendor_name = "AWS"
        name        = "AWSManagedRulesAmazonIpReputationList"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.name}-ip-rep"
      sampled_requests_enabled   = true
    }
  }

  dynamic "rule" {

    for_each = var.enable_bot_control ? [1] : []
    content {
      name     = "AWS-AWSManagedRulesBotControlRuleSet"
      priority = 28
      override_action {
        dynamic "count" {
          for_each = local.rule_action == "count" ? [1] : []
          content {}
        }
        dynamic "none" {
          for_each = local.rule_action == "block" ? [1] : []
          content {}
        }
      }
      statement {
        managed_rule_group_statement {
          vendor_name = "AWS"
          name        = "AWSManagedRulesBotControlRuleSet"
          managed_rule_group_configs {
            aws_managed_rules_bot_control_rule_set {
              inspection_level = "COMMON"
            }
          }
        }
      }
      visibility_config {
        cloudwatch_metrics_enabled = true
        metric_name                = "${var.name}-bot"
        sampled_requests_enabled   = true
      }
    }
  }

  rule {
    name     = "PerIpRateLimit"
    priority = 30
    action {
      dynamic "count" {
        for_each = local.rule_action == "count" ? [1] : []
        content {}
      }
      dynamic "block" {
        for_each = local.rule_action == "block" ? [1] : []
        content {}
      }
    }
    statement {
      rate_based_statement {
        limit              = var.rate_limit
        aggregate_key_type = "IP"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.name}-rate"
      sampled_requests_enabled   = true
    }
  }

  tags = var.tags
}

resource "aws_wafv2_web_acl_association" "this" {
  resource_arn = var.alb_arn
  web_acl_arn  = aws_wafv2_web_acl.this.arn
}

output "web_acl_arn" { value = aws_wafv2_web_acl.this.arn }
output "current_action" { value = local.rule_action }
