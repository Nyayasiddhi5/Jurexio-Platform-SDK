#!/usr/bin/env node
/**
 * Create Athena external table over DC (AP/TG) judgment metadata parquet.
 *
 *   node athena-dc-case-details-ctas.mjs
 *
 * Worker env: ATHENA_TABLE_DC_CASE_DETAILS=judgments_meta_dc_case_details
 */
import {
  AthenaClient,
  StartQueryExecutionCommand,
  GetQueryExecutionCommand,
} from "@aws-sdk/client-athena";

const REGION = process.env.ATHENA_REGION || "ap-south-1";
const DATABASE = process.env.ATHENA_DATABASE || "nyv_docs";
const TABLE = process.env.ATHENA_TABLE_DC_CASE_DETAILS || "judgments_meta_dc_case_details";
const OUTPUT = process.env.ATHENA_OUTPUT_S3 || "s3://usa-caselaw/athena/results/";
const WORKGROUP = process.env.ATHENA_WORKGROUP || "nyv-docs";
const BUCKET = "indian-district-court-judgments";

const DDL = `
CREATE EXTERNAL TABLE IF NOT EXISTS ${DATABASE}.${TABLE} (
  cnr string,
  cino string,
  title string,
  court string,
  state string,
  year string,
  case_type string,
  case_no string,
  petitioner string,
  respondent string,
  decision_date string,
  disposal_nature string,
  description string
)
STORED AS PARQUET
LOCATION 's3://${BUCKET}/metadata/parquet/'
TBLPROPERTIES ('parquet.compress'='SNAPPY')
`;

async function wait(client, qid) {
  for (let i = 0; i < 60; i++) {
    const r = await client.send(
      new GetQueryExecutionCommand({ QueryExecutionId: qid }),
    );
    const state = r.QueryExecution?.Status?.State;
    if (state === "SUCCEEDED") return;
    if (state === "FAILED" || state === "CANCELLED") {
      throw new Error(r.QueryExecution?.Status?.StateChangeReason ?? state);
    }
    await new Promise((res) => setTimeout(res, 2000));
  }
  throw new Error("timeout");
}

async function main() {
  const client = new AthenaClient({ region: REGION });
  const start = await client.send(
    new StartQueryExecutionCommand({
      QueryString: DDL,
      QueryExecutionContext: { Database: DATABASE },
      ResultConfiguration: { OutputLocation: OUTPUT },
      WorkGroup: WORKGROUP,
    }),
  );
  const qid = start.QueryExecutionId;
  if (!qid) throw new Error("no QueryExecutionId");
  await wait(client, qid);
  console.log("OK", DATABASE, TABLE, "over", `s3://${BUCKET}/metadata/parquet/`);
}

main().catch((e) => {
  console.error("FAILED", e);
  process.exit(1);
});
