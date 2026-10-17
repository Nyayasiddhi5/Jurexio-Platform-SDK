/**
 * Rasterisation and pre-OCR image preparation.
 *
 * ON DESKEW — the important thing in this file.
 *
 * sharp cannot deskew. This was verified against sharp 0.35.4 directly: the
 * string "deskew" does not appear anywhere in the package. `rotate(angle)`
 * rotates by an angle YOU supply; `autoOrient()` only reads EXIF orientation;
 * `affine()` applies a matrix YOU supply. libvips has no deskew operation either.
 * There is no hidden option — the capability does not exist.
 *
 * So the angle has to come from somewhere. Three options were considered:
 *
 *  1. Add OpenCV (@techstark/opencv-js) and run a Hough transform or minAreaRect.
 *     Accurate to a fraction of a degree, but adds a ~10MB WASM build and a
 *     meaningful cold-start cost to every ingest worker.
 *  2. Implement a projection-profile estimator in TypeScript. Cheap, no new
 *     dependency, accurate to about half a degree — which is enough, because
 *     Tesseract itself tolerates a degree or two.
 *  3. Skip deskew and let Tesseract cope.
 *
 * We do 2 as the default and expose the angle so 1 can be swapped in later. We do
 * not do 3: line grouping, not recognition, is what skew breaks. A page skewed
 * 1.5° over 500pt of width drifts 13pt vertically from left margin to right,
 * which is more than a line height — so words from adjacent lines interleave and
 * a two-column cause title merges into nonsense.
 */

import { spawn } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface RasterPage {
  pageNo: number;
  imagePath: string;
  widthPx: number;
  heightPx: number;
  dpi: number;
}

export interface RasterOptions {
  dpi?: number;
  firstPage?: number;
  lastPage?: number;
  /** Grey is smaller and faster and Tesseract binarises anyway. */
  grey?: boolean;
  timeoutMs?: number;
}

function exec(cmd: string, args: string[], timeoutMs: number): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args);
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stderr.on("data", (d) => { stderr += String(d); });
    child.on("error", () => { clearTimeout(timer); resolve({ code: -1, stderr }); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ code: code ?? -1, stderr }); });
  });
}

/**
 * Rasterise a PDF with pdftoppm (Poppler).
 *
 * Note on licensing: node-poppler itself is MIT, but the Poppler BINARIES it
 * wraps are GPL-2.0/GPL-3.0. That is fine here because we invoke them as a
 * separate process rather than linking them, which is the standard arrangement —
 * but it must be recorded in the SBOM and the binaries must not be statically
 * linked into any distributed artefact.
 */
export async function rasterisePdf(
  pdfPath: string,
  opts: RasterOptions = {},
): Promise<{ pages: RasterPage[]; tmpDir: string }> {
  const dpi = opts.dpi ?? 300;
  const dir = await mkdtemp(join(tmpdir(), "nyv-raster-"));
  const prefix = join(dir, "pg");

  const args = ["-r", String(dpi), "-png"];
  if (opts.grey) args.push("-gray");
  if (opts.firstPage) args.push("-f", String(opts.firstPage));
  if (opts.lastPage) args.push("-l", String(opts.lastPage));
  args.push(pdfPath, prefix);

  const r = await exec("pdftoppm", args, opts.timeoutMs ?? 120_000);
  if (r.code !== 0) {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
    throw new Error(`pdftoppm failed (exit ${r.code}): ${r.stderr.slice(0, 400)}`);
  }

  const files = (await readdir(dir))
    .filter((f) => f.endsWith(".png"))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  const pages: RasterPage[] = [];
  for (const f of files) {
    const m = /pg-?(\d+)\.png$/.exec(f);
    const pageNo = m ? Number(m[1]) : pages.length + 1;
    const path = join(dir, f);
    const dim = await pngDimensions(path);
    pages.push({ pageNo, imagePath: path, widthPx: dim.w, heightPx: dim.h, dpi });
  }
  return { pages, tmpDir: dir };
}

/** Read PNG dimensions from the IHDR chunk. No dependency needed. */
async function pngDimensions(path: string): Promise<{ w: number; h: number }> {
  const { open } = await import("node:fs/promises");
  const fh = await open(path, "r");
  try {
    const buf = Buffer.alloc(24);
    await fh.read(buf, 0, 24, 0);
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  } finally {
    await fh.close();
  }
}

// ---------------------------------------------------------------------------
// Skew estimation
// ---------------------------------------------------------------------------

/**
 * Estimate skew by projection profile variance.
 *
 * The idea: for a page of horizontal text lines, the row-wise ink histogram has
 * sharp peaks (lines) and deep troughs (interline gaps). Rotating the page away
 * from true flattens those peaks. So we score a set of candidate angles by the
 * variance of the row histogram and take the maximum. Variance is the right
 * objective — it is maximised exactly when ink is concentrated into few rows.
 *
 * Coarse-to-fine: a 1° sweep over ±5°, then a 0.1° sweep around the winner. That
 * is 11 + 20 = 31 evaluations rather than 101, and on a downsampled image each
 * evaluation is cheap.
 *
 * Accepts a raw greyscale bitmap so it has no image-decoding dependency; the
 * caller supplies pixels.
 */
export function estimateSkewDegrees(
  grey: Uint8Array,
  width: number,
  height: number,
  opts: { maxDeg?: number; threshold?: number } = {},
): number {
  const maxDeg = opts.maxDeg ?? 5;
  const threshold = opts.threshold ?? 160; // below this is "ink"

  // Downsample to at most ~800px on the long side. Skew is a global property;
  // full resolution buys nothing and costs a lot.
  const step = Math.max(1, Math.floor(Math.max(width, height) / 800));
  const sw = Math.floor(width / step);
  const sh = Math.floor(height / step);
  if (sw < 20 || sh < 20) return 0;

  const ink = new Uint8Array(sw * sh);
  let inkCount = 0;
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const v = grey[(y * step) * width + (x * step)] ?? 255;
      const isInk = v < threshold ? 1 : 0;
      ink[y * sw + x] = isInk;
      inkCount += isInk;
    }
  }
  // A page with almost no ink (blank, or a full-page photo) gives a meaningless
  // profile. Refuse rather than return a random angle.
  //
  // The threshold was 0.5% and that was too strict: a sparse page — a short
  // order, a covering letter, a Tamil order of ten lines — has under 0.5% ink
  // coverage yet is perfectly estimable, and returning 0 there left a genuinely
  // skewed page unrotated. Measured on the fixture set, 0.15% admits the sparse
  // pages while still rejecting blanks and photographs.
  if (inkCount < sw * sh * 0.0015) return 0;

  const score = (deg: number): number => {
    const rad = (deg * Math.PI) / 180;
    const tan = Math.tan(rad);
    const rows = new Float64Array(sh);
    const cx = sw / 2;
    for (let y = 0; y < sh; y++) {
      for (let x = 0; x < sw; x++) {
        if (ink[y * sw + x] === 0) continue;
        // Shear vertically by the candidate angle, which is equivalent to
        // rotating for the small angles we care about and far cheaper.
        const ry = Math.round(y + (x - cx) * tan);
        if (ry >= 0 && ry < sh) rows[ry]! += 1;
      }
    }
    let mean = 0;
    for (let i = 0; i < sh; i++) mean += rows[i]!;
    mean /= sh;
    let variance = 0;
    for (let i = 0; i < sh; i++) {
      const d = rows[i]! - mean;
      variance += d * d;
    }
    return variance / sh;
  };

  let best = 0;
  let bestScore = -1;
  for (let d = -maxDeg; d <= maxDeg; d += 1) {
    const s = score(d);
    if (s > bestScore) { bestScore = s; best = d; }
  }
  let fine = best;
  for (let d = best - 1; d <= best + 1; d += 0.1) {
    const s = score(d);
    if (s > bestScore) { bestScore = s; fine = d; }
  }
  return Math.round(fine * 10) / 10;
}

/**
 * Apply a rotation with sharp, if sharp is installed.
 *
 * Deliberately separate from estimation: estimation is pure and testable, and a
 * deployment without sharp can still estimate the angle and pass it to Tesseract
 * rather than rotating pixels.
 */
export async function deskewImage(
  inputPath: string,
  outputPath: string,
  degrees: number,
): Promise<boolean> {
  if (Math.abs(degrees) < 0.15) return false; // not worth a resample
  try {
    const sharpMod = await import("sharp");
    const sharp = (sharpMod as any).default ?? sharpMod;
    await sharp(inputPath)
      // Negative because our estimator returns the angle the text IS at, and we
      // need to rotate back by that amount.
      .rotate(-degrees, { background: { r: 255, g: 255, b: 255 } })
      .toFile(outputPath);
    return true;
  } catch {
    return false;
  }
}

/** Load a PNG/JPEG as raw greyscale via sharp, for the skew estimator. */
export async function loadGrey(
  path: string,
): Promise<{ data: Uint8Array; width: number; height: number } | null> {
  try {
    const sharpMod = await import("sharp");
    const sharp = (sharpMod as any).default ?? sharpMod;
    const { data, info } = await sharp(path).greyscale().raw().toBuffer({ resolveWithObject: true });
    return { data: new Uint8Array(data), width: info.width, height: info.height };
  } catch {
    return null;
  }
}
