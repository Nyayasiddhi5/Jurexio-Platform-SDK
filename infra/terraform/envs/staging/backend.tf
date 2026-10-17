terraform {
  required_version = ">= 1.6.0"

  backend "s3" {
    bucket         = "nyv-tfstate-789925699169-ap-south-1"
    key            = "envs/staging/terraform.tfstate"
    region         = "ap-south-1"
    dynamodb_table = "nyv-tfstate-locks"
    encrypt        = true
  }

  required_providers {
    aws    = { source = "hashicorp/aws",    version = "~> 5.60" }
    random = { source = "hashicorp/random", version = "~> 3.6"  }
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project    = "Nyayavigya"
      Env        = "staging"
      ManagedBy  = "terraform"
      Owner      = "nyayavigya-platform"
      CostCenter = "engineering"
      Repo       = "nyayasiddhi/nyayavigya-platform-312"
    }
  }

  allowed_account_ids = [var.aws_account_id]
}
