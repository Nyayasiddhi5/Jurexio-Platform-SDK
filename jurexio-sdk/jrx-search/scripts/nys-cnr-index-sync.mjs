#!/usr/bin/env node
/**
 * Daily CNR index sync — judgments delta (SC/HC + AP/TG district) +
 * parquet_case_details → RDS.
 *
 * District scope: Andhra Pradesh (state=2) + Telangana (state=29) only,
 * via ingest-rds delta → indian-district-court-judgments Open Data.
 *
 * On worker:
 *   node /opt/nyv/api/nys-cnr-index-sync.mjs
 *
 * Schedule example: cron(30 17 * * ? *) UTC (~23:00 IST)
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

const API = process.env.NYS_API_DIR || "/opt/nyv/api";

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: API,
      env: process.env,
      stdio: "inherit",
    });
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(" ")} exited ${code}`)),
    );
  });
}

function pick(name) {
  if (existsSync(`${API}/${name}.mjs`)) return `${name}.mjs`;
  if (existsSync(`${API}/${name}.js`)) return `${name}.js`;
  return null;
}

async function main() {
  console.log("[cnr-sync] start", new Date().toISOString());
  const ingest = pick("ingest-rds");
  if (ingest) {
    console.log("[cnr-sync] judgments delta");
    await run("node", [ingest, "delta"]);
  } else {
    console.warn("[cnr-sync] ingest-rds missing — skip judgments delta");
  }

  const details = pick("ingest-cnr-case-details");
  if (details) {
    console.log("[cnr-sync] case_details partitions");
    // 0 = all pending partitions; set NYS_CNR_DETAILS_LIMIT to cap per run
    const limit = process.env.NYS_CNR_DETAILS_LIMIT || "50";
    await run("node", [details, limit]);
  } else {
    console.warn("[cnr-sync] ingest-cnr-case-details missing — skip");
  }
  console.log("[cnr-sync] done", new Date().toISOString());
}

main().catch((err) => {
  console.error("[cnr-sync] FAILED", err);
  process.exit(1);
});
