# Wrapper for terraform commands with a cost guard before any apply.

ENV ?= prod

.PHONY: init plan apply destroy fmt validate cost-warn

init:
	terraform init

fmt:
	terraform fmt -recursive ../..

validate:
	terraform validate

plan: validate
	terraform plan -out tfplan -input=false

cost-warn:
	@echo ""
	@echo "════════════════════════════════════════════════════════════════════"
	@echo "  ⚠️  About to APPLY changes to AWS account 789925699169 ($(ENV))"
	@echo "  This stack costs ~\$$200/mo when running."
	@echo "  Run 'terraform plan' first if you have not."
	@echo "  Press Ctrl-C to abort, or Enter to continue."
	@echo "════════════════════════════════════════════════════════════════════"
	@read _confirm

apply: cost-warn
	terraform apply -auto-approve tfplan

destroy:
	@echo "⚠️  About to DESTROY the entire $(ENV) stack. Type the env name to continue:"
	@read confirm && [ "$$confirm" = "$(ENV)" ] || (echo "aborted"; exit 1)
	terraform destroy
