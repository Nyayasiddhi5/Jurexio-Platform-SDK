#!/usr/bin/env bash
# Prints suggested EC2 create steps (dry-run by default). Does not create resources unless --apply GO.
set -euo pipefail
DRY=1
REGION="${JRX_AWS_REGION:-ap-south-1}"
while [ $# -gt 0 ]; do
  case "$1" in
    --apply) DRY=0; shift ;;
    *) shift ;;
  esac
done

echo "== JRX EC2 plan region=${REGION} =="
echo "Recommended smoke: t3.xlarge, Amazon Linux 2023, IAM role with AmazonSSMManagedInstanceCore + Bedrock invoke."
echo "Suggested name tag: jrx-enterprise-smoke"
echo ""
echo "Example (review VPC/subnet/SG before run):"
echo "  aws ec2 run-instances --region ${REGION} \\"
echo "    --image-id resolve:ssm:/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64 \\"
echo "    --instance-type t3.xlarge \\"
echo "    --iam-instance-profile Name=YOUR_JRX_SSM_BEDROCK_PROFILE \\"
echo "    --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=jrx-enterprise-smoke}]'"
if [ "$DRY" = "1" ]; then
  echo "(dry-run — no resources created)"
fi
