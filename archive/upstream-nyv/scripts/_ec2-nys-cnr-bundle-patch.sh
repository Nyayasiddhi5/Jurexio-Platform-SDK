#!/usr/bin/env bash
set -euo pipefail
IDX=/opt/nyv/api/index.mjs
BAK=$(ls -t /opt/nyv/api/index.mjs.bak-cnr-* 2>/dev/null | head -1 || true)
if [ -n "$BAK" ] && [ -f "$BAK" ]; then cp "$BAK" "$IDX"; echo "restored $BAK"; fi

node <<'NODE'
const fs = require("fs");
const path = "/opt/nyv/api/index.mjs";
let s = fs.readFileSync(path, "utf8");

s = s.replace(/Date\.now\(\) \+ 45e3/g, "Date.now() + 12e3");

const athenaOld = `if (!judgments.length) {
    sourcesTried.push("opendata_athena");`;
const athenaNew = `if (!judgments.length && wantCaseCreate) {
    sourcesTried.push("opendata_athena");`;
if (!s.includes(athenaOld)) { console.error("athena anchor missing"); process.exit(1); }
s = s.replace(athenaOld, athenaNew);

const ftsOld = `  const fuzzyLimit = Math.min(Math.max(opts.fuzzyLimit ?? 5, 1), 10);
  sourcesTried.push("nys_fts");
  const candidates = [];
  try {`;
const ftsNew = `  const fuzzyLimit = Math.min(Math.max(opts.fuzzyLimit ?? 5, 1), 10);
  const candidates = [];
  if (wantCaseCreate) {
  sourcesTried.push("nys_fts");
  try {`;
if (!s.includes(ftsOld)) { console.error("fts anchor missing"); process.exit(1); }
s = s.replace(ftsOld, ftsNew);

const closeOld = `  } catch (err) {
    logger.warn({ err: String(err) }, "cnr fuzzy search failed");
  }
  if (candidates.length) {`;
const closeNew = `  } catch (err) {
    logger.warn({ err: String(err) }, "cnr fuzzy search failed");
  }
  }
  if (candidates.length) {`;
if (!s.includes(closeOld)) { console.error("fts close anchor missing"); process.exit(1); }
s = s.replace(closeOld, closeNew);

fs.writeFileSync(path, s);
console.log("patched md5", require("crypto").createHash("md5").update(s).digest("hex"));
NODE

systemctl restart nyv-api.service
sleep 4
curl -sS -m 10 -o /dev/null -w "healthz http=%{http_code}\n" http://127.0.0.1:8080/healthz
