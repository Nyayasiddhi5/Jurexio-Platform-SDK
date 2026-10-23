variable "project" {
  type        = string
  description = "Jurexio project tag"
  default     = "jurexio-ledger"
}

variable "primary_region" {
  type        = string
  description = "India Ledger home region"
  default     = "ap-south-1"
}

variable "secondary_region" {
  type        = string
  description = "US Ledger home region"
  default     = "us-east-1"
}

variable "synthetic_only" {
  type        = bool
  description = "When true, stacks are provisioned but gateway blocks non-synthetic ingest (C-07)"
  default     = true
}

variable "db_instance_class" {
  type        = string
  description = "RDS instance class per regional Ledger DB"
  default     = "db.t4g.medium"
}
