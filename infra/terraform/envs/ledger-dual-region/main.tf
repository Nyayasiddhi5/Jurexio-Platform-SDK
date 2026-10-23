terraform {
  required_version = ">= 1.5.0"
}

# Sprint 1 skeleton — wire modules/rds per region after VPC + subnet groups exist.
# Example (commented):
#
# module "ledger_in" {
#   source = "../../modules/rds"
#   providers = { aws = aws.ap_south_1 }
#   ...
# }
#
# module "ledger_us" {
#   source = "../../modules/rds"
#   providers = { aws = aws.us_east_1 }
#   ...
# }

output "synthetic_only_guard" {
  value       = var.synthetic_only
  description = "Gateway ingest remains synthetic until operator sets false after dual-stack smoke"
}

output "planned_regions" {
  value = [var.primary_region, var.secondary_region]
}
