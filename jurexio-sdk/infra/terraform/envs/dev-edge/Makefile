.PHONY: init plan apply outputs nameservers waf-dashboard waf-block destroy

init:
	terraform init -input=false

plan:
	terraform plan -input=false

apply:
	terraform apply -input=false -auto-approve

outputs:
	terraform output

nameservers:
	@terraform output -json route53_nameservers | jq -r '.[]'

# Print the direct CloudWatch dashboard URL for the WAF count-vs-block view.
waf-dashboard:
	@terraform output -raw waf_dashboard_url

# Flip the WAF from observation-only (count) to enforcement (block). Run this
# only after >= 7 days on the dashboard with no untuned false positives.
waf-block:
	terraform apply -input=false -auto-approve -var 'waf_action=block'

destroy:
	terraform destroy -input=false
