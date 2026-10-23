# =============================================================================
# Bootstrap — creates the S3 state bucket and DynamoDB lock table that the
# rest of the IaC uses as its remote backend. Run this ONCE per AWS account.
#
# Cost: ~$0.10/mo (S3 versioning + a tiny DynamoDB on-demand table).
# =============================================================================

terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.60"
    }
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project    = "Nyayavigya"
      Env        = "shared"
      ManagedBy  = "terraform"
      Owner      = "nyayavigya-platform"
      CostCenter = "engineering"
      Repo       = "nyayasiddhi/nyayavigya-platform-312"
    }
  }
}

variable "aws_region" {
  type    = string
  default = "ap-south-1"
}

variable "aws_account_id" {
  type    = string
  default = "789925699169"
}

locals {
  state_bucket_name = "nyv-tfstate-${var.aws_account_id}-${var.aws_region}"
  lock_table_name   = "nyv-tfstate-locks"
}

# ── S3 state bucket (versioned, encrypted, no public access) ────────────────
resource "aws_s3_bucket" "state" {
  bucket = local.state_bucket_name
}

resource "aws_s3_bucket_versioning" "state" {
  bucket = aws_s3_bucket.state.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "state" {
  bucket = aws_s3_bucket.state.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "state" {
  bucket                  = aws_s3_bucket.state.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "state" {
  bucket = aws_s3_bucket.state.id

  rule {
    id     = "noncurrent-cleanup"
    status = "Enabled"

    filter {}

    noncurrent_version_expiration {
      noncurrent_days = 365
    }
    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}

# ── DynamoDB lock table (on-demand, billing-mode PAY_PER_REQUEST) ───────────
resource "aws_dynamodb_table" "locks" {
  name         = local.lock_table_name
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "LockID"

  attribute {
    name = "LockID"
    type = "S"
  }

  point_in_time_recovery {
    enabled = true
  }
}

output "state_bucket"     { value = aws_s3_bucket.state.id }
output "lock_table"       { value = aws_dynamodb_table.locks.id }
output "backend_snippet"  {
  value = <<-EOT
    Place this `backend "s3"` block at the top of every env's `backend.tf`:

    terraform {
      backend "s3" {
        bucket         = "${aws_s3_bucket.state.id}"
        key            = "envs/<ENV>/terraform.tfstate"
        region         = "${var.aws_region}"
        dynamodb_table = "${aws_dynamodb_table.locks.id}"
        encrypt        = true
      }
    }
  EOT
}
