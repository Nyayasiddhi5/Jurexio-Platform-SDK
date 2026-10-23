# =============================================================================
# ECR module — creates the 7 platform image repositories with a uniform
# lifecycle policy that:
#   • keeps the LAST 10 untagged images (rolling window for in-flight builds)
#   • keeps every image tagged `prod`, `staging`, or `latest` forever
#   • keeps every image whose tag matches `v*` (release tags) forever
# =============================================================================

terraform {
  required_providers { aws = { source = "hashicorp/aws", version = "~> 5.60" } }
}

variable "name_prefix" {
  type = string
  default = "nyv-"
}
variable "repos"       {
  type    = set(string)
  default = ["gateway", "console", "nym-app", "nsp-app", "nsi-app", "nsa-app", "nsm-app"]
}
variable "tags"        {
  type = map(string)
  default = {}
}
resource "aws_ecr_repository" "this" {
  for_each             = var.repos
  name                 = "${var.name_prefix}${each.key}"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "AES256"
  }

  tags = merge(var.tags, { Name = "${var.name_prefix}${each.key}" })
}

resource "aws_ecr_lifecycle_policy" "this" {
  for_each   = aws_ecr_repository.this
  repository = each.value.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Keep prod / staging / latest forever"
        selection = {
          tagStatus     = "tagged"
          tagPrefixList = ["prod", "staging", "latest"]
          countType     = "imageCountMoreThan"
          countNumber   = 9999
        }
        action = { type = "expire" }
      },
      {
        rulePriority = 2
        description  = "Keep release tags v* forever"
        selection = {
          tagStatus     = "tagged"
          tagPrefixList = ["v"]
          countType     = "imageCountMoreThan"
          countNumber   = 9999
        }
        action = { type = "expire" }
      },
      {
        rulePriority = 3
        description  = "Expire untagged images > 10"
        selection = {
          tagStatus   = "untagged"
          countType   = "imageCountMoreThan"
          countNumber = 10
        }
        action = { type = "expire" }
      }
    ]
  })
}

output "repository_urls" {
  value = { for k, r in aws_ecr_repository.this : k => r.repository_url }
}

output "repository_arns" {
  value = { for k, r in aws_ecr_repository.this : k => r.arn }
}
