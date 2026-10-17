/**
 * One-command prod sync for a statutes delta (export → S3 → SSM loader).
 *
 * Usage (after a refresh ingest + export on dev):
 *   pnpm --filter @workspace/api-server run export:statutes-delta -- --since <ISO>
 *   cd scripts && node sync-statutes-delta.mjs /tmp/statutes-delta.jsonl
 *
 * Steps (all md5-verified, fail-loud — mirrors upload-deploy.mjs):
 *   1. esbuild the api-server (produces dist/load-statutes-appdb.mjs).
 *   2. Upload the JSONL delta + the loader to S3 under content-addressed keys.
 *   3. SSM on the EC2 worker: verified download of both, run the loader with
 *      DATABASE_URL grepped from /opt/nyv/api/.env (never shell-sourced —
 *      values are unquoted and contain '&').
 */
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { readFile, access } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { run } from "./ssm-run.mjs";

const BUCKET = "nyv-sdk-distribution";
const PREFIX = "caselaw-worker/api";
const s3 = new S3Client({ region: "ap-south-1" });
const md5 = (buf) => createHash("md5").update(buf).digest("hex");

const jsonlPath = process.argv[2];
if (!jsonlPath) {
  console.error("usage: node sync-statutes-delta.mjs <statutes-delta.jsonl>");
  process.exit(1);
}
await access(jsonlPath).catch(() => {
  console.error(`delta file not found: ${jsonlPath} (run export:statutes-delta first)`);
  process.exit(1);
});

console.log("building api-server bundle (for load-statutes-appdb.mjs)…");
execSync("node ../artifacts/api-server/build.mjs", { stdio: "inherit" });

async function uploadContentAddressed(localPath, baseName) {
  const Body = await readFile(localPath);
  const hash = md5(Body);
  const dot = baseName.lastIndexOf(".");
  const key = `${PREFIX}/releases/${baseName.slice(0, dot)}-${hash}${baseName.slice(dot)}`;
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET, Key: key, Body,
    ContentMD5: Buffer.from(hash, "hex").toString("base64"),
  }));
  console.log("uploaded", key, Body.length);
  return { key, md5: hash };
}

const loader = await uploadContentAddressed(
  "../artifacts/api-server/dist/load-statutes-appdb.mjs",
  "load-statutes-appdb.mjs",
);
const delta = await uploadContentAddressed(jsonlPath, "statutes-delta.jsonl");

const fetchVerified = (f, label, tmpl, varName) => [
  `${varName}=$(mktemp ${tmpl})`,
  `aws s3 cp s3://${BUCKET}/${f.key} "$${varName}" --quiet`,
  `GOT=$(md5sum "$${varName}" | cut -d" " -f1)`,
  `if [ "$GOT" != "${f.md5}" ]; then echo "SYNC FAILED: md5 mismatch for ${label}"; rm -f "$${varName}"; exit 1; fi`,
];

const cmd = [
  `set -e`,
  ...fetchVerified(loader, "loader", "/tmp/load-statutes-XXXXXX.mjs", "LOADER"),
  ...fetchVerified(delta, "delta jsonl", "/tmp/statutes-delta-XXXXXX.jsonl", "DELTA"),
  // Worker .env values are unquoted (DATABASE_URL contains '&') — grep, never source.
  `DBURL=$(grep '^DATABASE_URL=' /opt/nyv/api/.env | cut -d= -f2-)`,
  `if [ -z "$DBURL" ]; then echo "SYNC FAILED: no DATABASE_URL in worker .env"; exit 1; fi`,
  `cd /opt/nyv/api`,
  `DATABASE_URL="$DBURL" node "$LOADER" "$DELTA"`,
  `rm -f "$LOADER" "$DELTA"`,
  `echo "STATUTES DELTA SYNCED (loader md5=${loader.md5}, delta md5=${delta.md5})"`,
].join(" && ");

console.log("running loader on worker via SSM (md5-verified)…");
const status = await run([cmd], 570);
if (status !== "Success") {
  console.error("STATUTES DELTA SYNC FAILED with status", status);
  process.exit(1);
}
console.log("statutes delta synced to prod nyvapp DB");
