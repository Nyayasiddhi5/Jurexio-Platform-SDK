ENV ?= staging
.PHONY: init plan apply destroy fmt validate

init:
	terraform init
fmt:
	terraform fmt -recursive ../..
validate:
	terraform validate
plan: validate
	terraform plan -out tfplan -input=false
apply:
	@echo "⚠️  staging apply will spend ~\$$50/mo. Press Enter to continue."
	@read _
	terraform apply -auto-approve tfplan
destroy:
	@echo "Type 'staging' to confirm destroy:"
	@read confirm && [ "$$confirm" = "staging" ] || (echo "aborted"; exit 1)
	terraform destroy
