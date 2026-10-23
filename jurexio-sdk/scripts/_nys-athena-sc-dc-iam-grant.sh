#!/usr/bin/env bash
# Grant caselaw-worker IAM glue:CreateTable (nyv_docs) + DC parquet S3 read.
# Run from workstation: cd Jurexio-Platform-SDK && bash scripts/_nys-athena-sc-dc-iam-grant.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
source scripts/jrx-source-dev-deploy-env.sh

ACCOUNT="${JRX_AWS_ACCOUNT_ID:-789925699169}"
REGION="${JRX_AWS_REGION:-ap-south-1}"
ROLE=jrx-caselaw-worker-role

aws iam put-role-policy --role-name "$ROLE" --policy-name jrx-athena-query --policy-document "$(cat <<JSON
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "athena:StartQueryExecution",
        "athena:GetQueryExecution",
        "athena:GetQueryResults",
        "athena:StopQueryExecution",
        "athena:GetWorkGroup"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "glue:GetDatabase",
        "glue:GetDatabases",
        "glue:GetTable",
        "glue:GetTables",
        "glue:GetPartition",
        "glue:GetPartitions",
        "glue:CreateTable",
        "glue:UpdateTable"
      ],
      "Resource": [
        "arn:aws:glue:${REGION}:${ACCOUNT}:catalog",
        "arn:aws:glue:${REGION}:${ACCOUNT}:database/nyv_docs",
        "arn:aws:glue:${REGION}:${ACCOUNT}:table/nyv_docs/*"
      ]
    },
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:ListBucket",
        "s3:PutObject",
        "s3:GetBucketLocation",
        "s3:AbortMultipartUpload",
        "s3:ListMultipartUploadParts"
      ],
      "Resource": [
        "arn:aws:s3:::usa-caselaw",
        "arn:aws:s3:::usa-caselaw/*"
      ]
    }
  ]
}
JSON
)"

aws iam put-role-policy --role-name "$ROLE" --policy-name jrx-caselaw-worker-inline --policy-document "$(cat <<'JSON'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:ListBucket"],
      "Resource": [
        "arn:aws:s3:::indian-high-court-judgments",
        "arn:aws:s3:::indian-high-court-judgments/*",
        "arn:aws:s3:::indian-supreme-court-judgments",
        "arn:aws:s3:::indian-supreme-court-judgments/*",
        "arn:aws:s3:::indian-district-court-judgments",
        "arn:aws:s3:::indian-district-court-judgments/*",
        "arn:aws:s3:::jrx-sdk-distribution",
        "arn:aws:s3:::jrx-sdk-distribution/*",
        "arn:aws:s3:::ns-highcourt-data-bucket",
        "arn:aws:s3:::ns-highcourt-data-bucket/*",
        "arn:aws:s3:::your-supreme-court-data-bucket",
        "arn:aws:s3:::your-supreme-court-data-bucket/*",
        "arn:aws:s3:::ns-indian-highcourt-judgements-2",
        "arn:aws:s3:::ns-indian-highcourt-judgements-2/*"
      ]
    },
    {
      "Effect": "Allow",
      "Action": ["secretsmanager:GetSecretValue"],
      "Resource": "*",
      "Condition": { "StringLike": { "secretsmanager:SecretId": "*rds*" } }
    },
    {
      "Effect": "Allow",
      "Action": ["rds:DescribeDBInstances"],
      "Resource": "*"
    }
  ]
}
JSON
)"

echo "OK: updated ${ROLE} policies jrx-athena-query + jrx-caselaw-worker-inline"
