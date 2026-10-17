#!/usr/bin/env node
/**
 * Weekly India corpus refresh — run via SSM cron / EventBridge on caselaw worker.
 *
 * 1) RDS judgment delta: re-open current+previous year Open Data partitions
 *    (`node ingest-rds.mjs delta`) so new SC/HC + AP/TG district parquet
 *    rows land in RDS.
 * 2) Optional: kick embed-corpus (SC scope) if coverage SLO still critical.
 *
 * Usage (on worker, with .env sourced):
 *   node /opt/nyv/api/weekly-india-refresh.mjs
 *
 * From laptop:
 *   cd NYS-Agentic-AI/scripts && node ssm-run.mjs 'bash -lc "set -a; source /opt/nyv/api/.env; set +a; node /opt/nyv/api/weekly-india-refresh.mjs"'
 *
 * Schedule (example EventBridge → SSM): cron(0 18 ? * SUN *) Asia/Kolkata off-peak.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

const API = process.env.NYS_API_DIR || "/opt/nyv/api";
const LOG = process.env.NYS_WEEKLY_LOG || "/opt/nyv/weekly-india-refresh.log";

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

async function main() {
  const ingest = existsSync(`${API}/ingest-rds.mjs`)
    ? "ingest-rds.mjs"
    : existsSync(`${API}/ingest-rds.js`)
      ? "ingest-rds.js"
      : null;
  if (!ingest) {
    console.error("ingest-rds not found under", API);
    process.exit(1);
  }
  console.log("[weekly] delta ingest starting", new Date().toISOString());
  await run("node", [ingest, "delta"]);
  console.log("[weekly] delta ingest complete");

  const cnrDetails = existsSync(`${API}/ingest-cnr-case-details.mjs`)
    ? "ingest-cnr-case-details.mjs"
    : existsSync(`${API}/nys-cnr-index-sync.mjs`)
      ? "nys-cnr-index-sync.mjs"
      : null;
  if (cnrDetails && process.env.NYS_WEEKLY_CNR_DETAILS !== "0") {
    console.log("[weekly] CNR case_details / index sync");
    try {
      await run("node", [cnrDetails, process.env.NYS_CNR_DETAILS_LIMIT || "100"]);
    } catch (err) {
      console.warn("[weekly] CNR details sync non-fatal:", err);
    }
  }

  // Soft kick: if embed binary present, append a SC batch (resumable; non-fatal).
  const embed = existsSync(`${API}/embed-corpus.mjs`) ? "embed-corpus.mjs" : null;
  if (embed && process.env.NYS_WEEKLY_EMBED !== "0") {
    console.log("[weekly] starting background SC embed batch (max 50000)");
    spawn("node", [embed, "50000", "100", "sc"], {
      cwd: API,
      env: process.env,
      detached: true,
      stdio: ["ignore", "append", "append"],
    }).unref();
  }
  console.log("[weekly] done — log:", LOG);
}

main().catch((err) => {
  console.error("[weekly] FAILED", err);
  process.exit(1);
});
