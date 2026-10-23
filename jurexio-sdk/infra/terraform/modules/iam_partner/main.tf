# =============================================================================
# iam_partner — per-partner IAM role + scoped policy.
#
# Each partner gets:
#   • their own ECR repo namespace        (push/pull)
#   • their own Secrets Manager prefix    (read-only)
#   • their own CloudWatch log group prefix (write)
# Cross-partner access is impossible: every IAM action is scoped by ARN
# globbing on the partner's namespace.
#
# The trust policy supports either:
#   • A long-lived IAM user (legacy)        -> trusted_user_arn
#   • A GitHub Actions OIDC role (preferred) -> github_repo
# =============================================================================

terraform {
  required_providers { aws = { source = "hashicorp/aws", version = "~> 5.60" } }
}

variable "partner_id"      {
  type = string
  description = "nym | nsp | nsi | nsa | nsm"
}
variable "env"             { type = string }
variable "ecr_repo_arns"   { type = list(string) }
variable "tg_arns" {
  type        = list(string)
  default     = []
  description = "Partner's ALB target-group ARNs the role can register/deregister against."
}
variable "trusted_user_arn" {
  type        = string
  default     = null
  description = "DEPRECATED — long-lived IAM user trust. Prefer github_repo (OIDC). Module errors when both are unset."
}
variable "github_repo" {
  type        = string
  default     = null
  description = "owner/repo for GitHub OIDC trust (e.g. nyayasiddhi/nyayamitra). Preferred over trusted_user_arn."
}
variable "github_oidc_arn" {
  type = string
  default = "arn:aws:iam::789925699169:oidc-provider/token.actions.githubusercontent.com"
}
variable "tags"            {
  type = map(string)
  default = {}
}
# Hard validation:
#   1. At least one trust mechanism must be configured. An empty trust policy
#      is silently a no-op (assumable only by the AWS account root) which is
#      exactly the misconfiguration we want to refuse.
#   2. PROD environments forbid the long-lived IAM-user trust entirely. Only
#      GitHub OIDC is allowed. Staging may still use trusted_user_arn during
#      partner CI bring-up.
resource "terraform_data" "trust_check" {
  lifecycle {
    precondition {
      condition     = var.trusted_user_arn != null || var.github_repo != null
      error_message = "iam_partner module: at least one of github_repo (preferred) or trusted_user_arn must be set."
    }
    precondition {
      condition     = var.env != "prod" || var.trusted_user_arn == null
      error_message = "iam_partner module: trusted_user_arn (long-lived IAM user trust) is FORBIDDEN when env=\"prod\". Configure github_repo for OIDC trust instead."
    }
    precondition {
      condition     = var.env != "prod" || var.github_repo != null
      error_message = "iam_partner module: github_repo (OIDC trust) is REQUIRED when env=\"prod\". Set partner_github_repos[\"<partner>\"] in terraform.tfvars."
    }
  }
}

locals {
  role_name      = "nyv-${var.env}-${var.partner_id}-deploy"
  secret_pattern = "arn:aws:secretsmanager:*:*:secret:nyayavigya/${var.env}/${var.partner_id}/*"
  log_pattern    = "arn:aws:logs:*:*:log-group:/aws/nyayavigya/${var.env}/${var.partner_id}*"
}

data "aws_iam_policy_document" "trust" {
  dynamic "statement" {
    for_each = var.trusted_user_arn == null ? [] : [1]
    content {
      effect    = "Allow"
      actions   = ["sts:AssumeRole"]
      principals {
        type        = "AWS"
        identifiers = [var.trusted_user_arn]
      }
    }
  }

  dynamic "statement" {
    for_each = var.github_repo == null ? [] : [1]
    content {
      effect  = "Allow"
      actions = ["sts:AssumeRoleWithWebIdentity"]
      principals {
        type        = "Federated"
        identifiers = [var.github_oidc_arn]
      }
      condition {
        test     = "StringEquals"
        variable = "token.actions.githubusercontent.com:aud"
        values   = ["sts.amazonaws.com"]
      }
      condition {
        test     = "StringLike"
        variable = "token.actions.githubusercontent.com:sub"
        values   = ["repo:${var.github_repo}:*"]
      }
    }
  }
}

resource "aws_iam_role" "this" {
  name               = local.role_name
  assume_role_policy = data.aws_iam_policy_document.trust.json
  tags               = merge(var.tags, { Partner = var.partner_id })
}

data "aws_iam_policy_document" "this" {
  statement {
    sid     = "EcrReadEverywhere"
    effect  = "Allow"
    actions = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }

  statement {
    sid     = "EcrPushPullScoped"
    effect  = "Allow"
    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:CompleteLayerUpload",
      "ecr:GetDownloadUrlForLayer",
      "ecr:InitiateLayerUpload",
      "ecr:PutImage",
      "ecr:UploadLayerPart",
      "ecr:BatchGetImage",
      "ecr:DescribeImages",
      "ecr:ListImages",
    ]
    resources = var.ecr_repo_arns
  }

  statement {
    sid     = "SecretsReadScoped"
    effect  = "Allow"
    actions = [
      "secretsmanager:GetSecretValue",
      "secretsmanager:DescribeSecret",
      "secretsmanager:ListSecretVersionIds",
    ]
    resources = [local.secret_pattern]
  }

  statement {
    sid     = "CloudWatchLogsWriteScoped"
    effect  = "Allow"
    actions = [
      "logs:CreateLogGroup",
      "logs:CreateLogStream",
      "logs:PutLogEvents",
      "logs:DescribeLogStreams",
    ]
    resources = [local.log_pattern]
  }

  # Read-everywhere ELBv2 metadata is required because Describe* APIs do not
  # support resource-level conditions in IAM. Mutating actions (Register /
  # Deregister) ARE scoped to the partner's own target-group ARNs.
  statement {
    sid       = "Elbv2DescribeEverywhere"
    effect    = "Allow"
    actions   = [
      "elasticloadbalancing:DescribeTargetGroups",
      "elasticloadbalancing:DescribeTargetHealth",
      "elasticloadbalancing:DescribeListeners",
      "elasticloadbalancing:DescribeRules",
    ]
    resources = ["*"]
  }

  dynamic "statement" {
    for_each = length(var.tg_arns) == 0 ? [] : [1]
    content {
      sid       = "Elbv2RegisterTargetsScoped"
      effect    = "Allow"
      actions   = [
        "elasticloadbalancing:RegisterTargets",
        "elasticloadbalancing:DeregisterTargets",
      ]
      resources = var.tg_arns
    }
  }
}

resource "aws_iam_policy" "this" {
  name   = local.role_name
  policy = data.aws_iam_policy_document.this.json
  tags   = merge(var.tags, { Partner = var.partner_id })
}

resource "aws_iam_role_policy_attachment" "this" {
  role       = aws_iam_role.this.name
  policy_arn = aws_iam_policy.this.arn
}

output "role_arn"        { value = aws_iam_role.this.arn }
output "role_name"       { value = aws_iam_role.this.name }
output "secret_pattern"  { value = local.secret_pattern }
output "log_pattern"     { value = local.log_pattern }
