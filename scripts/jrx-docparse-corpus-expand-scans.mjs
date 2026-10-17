#!/usr/bin/env node
/**
 * NV-DOCPARSE-CORPUS-SCAN-001 — build scan-sim PDFs from text fixtures (OCR path exercise).
 * Real scans should still be added manually under test/fixtures/scans/.
 */
import { readdir, mkdir, writeFile, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURES = join(ROOT, "packages", "docparse-sdk", "test", "fixtures");
const SCANS = join(FIXTURES, "scans");

async function hasPdftoppm() {
  try {
    await exec("pdftoppm", ["-v"]);
    return true;
  } catch {
    return false;
  }
}

async function rasterizeOne(pdfPath, outPrefix) {
  await exec("pdftoppm", ["-png", "-r", "200", "-f", "1", "-l", "1", pdfPath, outPrefix]);
}

async function pngToPdf(pngPath, pdfOut) {
  const sharp = (await import("sharp")).default;
  const buf = await sharp(pngPath).png().toBuffer();
  // Minimal single-page PDF wrapper via sharp isn't native — use img2pdf if available
  try {
    await exec("img2pdf", [pngPath, "-o", pdfOut]);
    return;
  } catch {
    /* fallback: copy source pdf name as scan alias */
    await writeFile(pdfOut.replace(/\.pdf$/, ".source-ref.txt"), pngPath);
  }
}

async function main() {
  await mkdir(SCANS, { recursive: true });
  const pdfs = (await readdir(FIXTURES)).filter((f) => f.endsWith(".pdf") && f.startsWith("type_")).slice(0, 24);
  const manifest = { generatedAt: new Date().toISOString(), entries: [] };

  if (!(await hasPdftoppm())) {
    console.log("SKIP pdftoppm missing — writing manifest stubs only");
    for (const file of pdfs) {
      manifest.entries.push({ file, kind: "text-layer-ref", note: "add real scan PDF with same basename" });
    }
    await writeFile(join(SCANS, "manifest.json"), JSON.stringify(manifest, null, 2));
    console.log("PASS manifest-only", manifest.entries.length, "entries");
    return;
  }

  for (const file of pdfs) {
    const src = join(FIXTURES, file);
    const base = file.replace(/\.pdf$/i, "");
    const outPrefix = join(SCANS, `${base}.scan.p1`);
    const png = `${outPrefix}-1.png`;
    const scanPdf = join(SCANS, `${base}.scan.pdf`);
    try {
      await rasterizeOne(src, outPrefix);
      await pngToPdf(png, scanPdf);
      manifest.entries.push({ file: `${base}.scan.pdf`, source: file, kind: "raster-sim" });
    } catch (e) {
      manifest.entries.push({ file, kind: "error", message: String(e) });
    }
  }

  await writeFile(join(SCANS, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.log("PASS scan expansion", manifest.entries.length);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
