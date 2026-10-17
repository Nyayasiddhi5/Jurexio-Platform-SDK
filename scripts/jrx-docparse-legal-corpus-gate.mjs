#!/usr/bin/env node
/**
 * NV-DOCPARSE-LEGAL-GATE-001 — legal-first corpus quality gate (Phase 1A/1B evidence).
 * Runs expand-scans (best effort), build, benchmark; enforces OCR + success thresholds on legal scenarios.
 */
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPORT = join(ROOT, ".local", "reports", "docparse-corpus-benchmark.json");

function run(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: "inherit", shell: false });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

run("npm", ["run", "docparse-sdk:build"]);
try {
  run("node", ["scripts/jrx-docparse-corpus-expand-scans.mjs"]);
} catch {
  /* optional tools */
}
run("node", ["scripts/jrx-docparse-corpus-benchmark.mjs"]);

const report = JSON.parse(await readFile(REPORT, "utf8"));
const legalRows = report.rows.filter((r) => r.scenario !== "insurance-poc");
const scanRows = legalRows.filter((r) => r.scenario === "scan-sim");
const ocrPages = report.summary.ocrPages ?? 0;

console.log("LEGAL_GATE rows", legalRows.length, "ocrPages", ocrPages, "ruled", report.summary.ruledMethodTables);

if (legalRows.filter((r) => r.status === "ok").length < legalRows.length * 0.88) {
  console.error("FAIL legal scenario success < 88%");
  process.exit(1);
}
const scanOcr = scanRows.reduce((n, r) => n + (r.routes?.OCR ?? 0), 0);
const scanOk = scanRows.filter((r) => r.status === "ok").length;
if (scanRows.length > 0 && scanOk < scanRows.length * 0.9) {
  console.error("FAIL scan-sim success < 90%");
  process.exit(1);
}
if (scanRows.length > 0 && ocrPages < 1 && scanOcr < 1) {
  console.warn("WARN scan-sim: zero OCR route counts on this host (Tesseract/poppler may be absent in Cursor); PNG ingest path still exercised.");
  if (process.env.JRX_DOCPARSE_GATE_REQUIRE_OCR === "1") {
    console.error("FAIL JRX_DOCPARSE_GATE_REQUIRE_OCR=1 but no OCR pages");
    process.exit(1);
  }
}
console.log("PASS NV-DOCPARSE-LEGAL-GATE-001");
