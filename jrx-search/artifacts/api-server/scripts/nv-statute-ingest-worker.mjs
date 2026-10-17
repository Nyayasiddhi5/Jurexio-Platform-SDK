#!/usr/bin/env node
/**
 * Statute ingest worker orchestrator for NYS caselaw EC2 (/opt/nyv/api).
 *
 * Runs India Code (priority-first, resumable) then USC priority titles,
 * then kicks embed-statutes for NULL embeddings and ANALYZE.
 *
 * Usage:
 *   NODE_ENV=production node --env-file=/opt/nyv/api/.env /opt/nyv/api/nv-statute-ingest-worker.mjs
 *   MODE=usc-only|india-only|all (default all)
 */
import { spawn } from "node:child_process";
import { appendFileSync, existsSync } from "node:fs";

const API = process.env.NYS_API_DIR || "/opt/nyv/api";
const LOG = process.env.NYS_STATUTE_INGEST_LOG || "/opt/nyv/statute-ingest-worker.log";
const MODE = (process.env.MODE || "all").toLowerCase();

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  process.stdout.write(line);
  try {
    appendFileSync(LOG, line);
  } catch {
    /* ignore */
  }
}

function run(bin, args) {
  return new Promise((resolve, reject) => {
    log(`RUN ${bin} ${args.join(" ")}`);
    const child = spawn("node", ["--env-file=/opt/nyv/api/.env", bin, ...args], {
      cwd: API,
      env: { ...process.env, NODE_ENV: "production" },
      stdio: "inherit",
    });
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${bin} exited ${code}`)),
    );
  });
}

async function main() {
  log(`statute ingest worker start mode=${MODE}`);
  const india = `${API}/ingest-india-code.mjs`;
  const usc = `${API}/ingest-usc-titles.mjs`;
  const embed = `${API}/embed-statutes.mjs`;

  if (MODE === "all" || MODE === "india-only") {
    if (!existsSync(india)) throw new Error(`missing ${india}`);
    // Priority acts first (fast win), then continue pending/failed (resumable).
    await run(india, ["--priority-only", "--limit", "120"]);
    await run(india, ["--retry-failed", "--limit", "200"]);
  }

  if (MODE === "all" || MODE === "usc-only") {
    if (!existsSync(usc)) throw new Error(`missing ${usc}`);
    await run(usc, ["--titles", "priority", "--year", "2023"]);
  }

  if (existsSync(embed) && process.env.SKIP_EMBED !== "1") {
    log("kicking embed-statutes (NULL embeddings only — script is resumable)");
    // Detached via shell redirect — Node spawn does not accept stdio "append"
    // (ERR_INVALID_SYNC_FORK_INPUT). Numeric args: [maxRows] [batchSize].
    const child = spawn(
      "bash",
      [
        "-lc",
        `cd ${API} && NODE_ENV=production nice -n 10 node --env-file=/opt/nyv/api/.env ${embed} 50000 100 >> /opt/nyv/embed-statutes-null.log 2>&1`,
      ],
      {
        cwd: API,
        env: { ...process.env, NODE_ENV: "production" },
        detached: true,
        stdio: "ignore",
      },
    );
    child.unref();
    log(`embed-statutes pid=${child.pid}`);
  }

  log("statute ingest worker finished orchestration");
}

main().catch((err) => {
  log(`FAILED ${err}`);
  process.exit(1);
});
