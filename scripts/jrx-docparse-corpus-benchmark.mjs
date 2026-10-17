#!/usr/bin/env node
/**
 * NV-DOCPARSE-CORPUS-BENCH-001 — Phase 1A harness.
 * Runs @nyv/docparse-sdk over fixture PDFs with synthetic scenario expansion (≥200 runs).
 * Output: .local/reports/docparse-corpus-benchmark.json (no secrets).
 */
import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURES = join(ROOT, "packages", "docparse-sdk", "test", "fixtures");
const SCANS_DIR = join(FIXTURES, "scans");
const REPORT_DIR = join(ROOT, ".local", "reports");
const REPORT_PATH = join(REPORT_DIR, "docparse-corpus-benchmark.json");

const SCENARIOS = [
  { id: "text-layer", maxPages: 2 },
  { id: "scan-sim", maxPages: 1 },
  { id: "gov-ext", maxPages: 2, domainPackId: "legal-in-gov" },
  { id: "insurance-poc", maxPages: 1, domainPackId: "insurance-fnol" },
];

async function loadRun() {
  const entry = join(ROOT, "packages", "docparse-sdk", "dist", "index.js");
  const mod = await import(pathToFileURL(entry).href);
  return mod.run;
}

async function main() {
  let pdfs = (await readdir(FIXTURES)).filter((f) => f.endsWith(".pdf")).sort();
  let scanRaster = [];
  try {
    const scans = (await readdir(SCANS_DIR)).filter((f) => f.endsWith(".pdf"));
    scanRaster = (await readdir(SCANS_DIR)).filter((f) => f.endsWith(".png"));
    pdfs = [...pdfs, ...scans.map((f) => `scans/${f}`)];
  } catch {
    /* no scans dir yet */
  }
  if (pdfs.length < 10) {
    console.error("FAIL: expected ≥10 PDF fixtures, got", pdfs.length);
    process.exit(1);
  }

  const run = await loadRun();
  const manifest = [];
  for (const file of pdfs) {
    for (const scenario of SCENARIOS) {
      if (scenario.id === "scan-sim") continue;
      manifest.push({ file, ...scenario });
    }
  }
  for (const png of scanRaster) {
    manifest.push({ file: `scans/${png}`, id: "scan-sim", maxPages: 1 });
  }
  if (scanRaster.length === 0) {
    for (const file of pdfs.filter((f) => f.startsWith("scans/"))) {
      manifest.push({ file, id: "scan-sim", maxPages: 1 });
    }
  }

  const startedAt = new Date().toISOString();
  const rows = [];
  let ocrPages = 0;
  let textPages = 0;
  let tableCount = 0;
  let ruledTables = 0;

  for (let i = 0; i < manifest.length; i++) {
    const m = manifest[i];
    const bytes = await readFile(join(FIXTURES, m.file));
    const t0 = performance.now();
    let status = "ok";
    let docType = "";
    let routes = { TEXT: 0, OCR: 0 };
    let tables = 0;
    let ruled = 0;
    let errMsg = "";
    try {
      const result = await run(
        [{ bytes: new Uint8Array(bytes), fileName: m.file }],
        {
          batchId: `bench_${i}`,
          actor: "nv:corpus-benchmark",
          maxPagesPerDoc: m.maxPages,
          ...(m.domainPackId ? { domainPackId: m.domainPackId } : {}),
        },
      );
      docType = result.documents[0]?.classification?.code ?? "";
      for (const doc of result.documents) {
        for (const page of doc.pages ?? []) {
          routes[page.route] = (routes[page.route] ?? 0) + 1;
          if (page.route === "OCR") ocrPages++;
          else textPages++;
          for (const t of page.tables ?? []) {
            tables++;
            if (t.method === "RULED") ruled++;
          }
        }
      }
      tableCount += tables;
      ruledTables += ruled;
    } catch (e) {
      status = "error";
      errMsg = e instanceof Error ? e.message : String(e);
    }
    const ms = Math.round(performance.now() - t0);
    rows.push({
      index: i,
      file: m.file,
      scenario: m.id,
      status,
      ms,
      docType,
      routes,
      tables,
      ruledTables: ruled,
      ...(errMsg ? { error: errMsg.slice(0, 120) } : {}),
    });
    if ((i + 1) % 25 === 0) {
      process.stdout.write(`progress ${i + 1}/${manifest.length}\n`);
    }
  }

  const ok = rows.filter((r) => r.status === "ok").length;
  const report = {
    harness: "NV-DOCPARSE-CORPUS-BENCH-001",
    startedAt,
    finishedAt: new Date().toISOString(),
    uniqueFixtures: pdfs.length,
    runCount: manifest.length,
    scenariosPerFixture: SCENARIOS.length,
    summary: {
      ok,
      errors: rows.length - ok,
      ocrPages,
      textPages,
      tablesDetected: tableCount,
      ruledMethodTables: ruledTables,
      p50Ms: percentile(rows.map((r) => r.ms), 50),
      p95Ms: percentile(rows.map((r) => r.ms), 95),
    },
    rows,
  };

  await mkdir(REPORT_DIR, { recursive: true });
  await writeFile(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log("PASS corpus benchmark", report.summary);
  console.log("report", REPORT_PATH);
  if (manifest.length < 200) {
    console.error("FAIL: runCount < 200 (contract for Phase 1A)");
    process.exit(1);
  }
  if (ok < manifest.length * 0.85) {
    console.error("FAIL: success rate below 85%");
    process.exit(1);
  }
}

function percentile(nums, p) {
  const s = [...nums].sort((a, b) => a - b);
  if (s.length === 0) return 0;
  const idx = Math.min(s.length - 1, Math.floor((p / 100) * s.length));
  return s[idx];
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
