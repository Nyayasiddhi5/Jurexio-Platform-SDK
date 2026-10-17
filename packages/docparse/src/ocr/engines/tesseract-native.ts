/**
 * Native Tesseract 5 adapter — the production default.
 *
 * Why native and not tesseract.js: for a 300 DPI A4 page of Devanagari, the
 * native binary with `tessdata_best` is several times faster than the WASM build
 * and materially more accurate, and it is the only route with broad Indic
 * coverage at all. Paddle's current generation (PP-OCRv6) has NO Indic models;
 * only three PP-OCRv5 script models exist (Devanagari, Tamil, Telugu) and
 * Bengali has none in any generation. So for eight of the ten Indian scripts we
 * care about, Tesseract is not the fallback — it is the only option.
 *
 * We drive it via TSV output rather than the C API because:
 *  - TSV gives per-word bounding boxes and confidences, which is exactly what
 *    the provenance model needs and what hOCR makes us parse XML for;
 *  - a child process can be killed on timeout, which an in-process native
 *    binding cannot. A single malformed scan must not wedge the ingest worker.
 */

import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { OcrEngine, OcrRequest, OcrResult } from "./types.js";
import { pixelsToPoints } from "./types.js";
import type { ScriptCode, Word } from "../../types.js";
import { TESS_LANGS, detectScript } from "../../grammar/script.js";

export interface TesseractNativeOptions {
  binary?: string;
  tessdataPrefix?: string;
  /** Page segmentation mode. 3 = fully automatic, the right default for a page
   *  of court text. 6 (single uniform block) is better for a cropped field. */
  psm?: number;
  /** OCR engine mode. 1 = LSTM only, which is what the Indic models are. */
  oem?: number;
  /**
   * OpenMP thread cap. Defaults to 1 — see the note on `env` below, which
   * records the measurement behind that default.
   */
  ompThreadLimit?: number;
}

function run(
  cmd: string,
  args: string[],
  timeoutMs: number,
  env?: Record<string, string>,
): Promise<{ code: number; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { env: { ...process.env, ...env } });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout.on("data", (d) => { stdout += String(d); });
    child.stderr.on("data", (d) => { stderr += String(d); });
    child.on("error", () => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr, timedOut });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr, timedOut });
    });
  });
}

/**
 * Detect page skew and orientation using Tesseract's own OSD (`--psm 0`).
 *
 * This exists because sharp has NO deskew capability — verified against the
 * package: there is no `deskew` anywhere in it, `rotate()` takes an angle you
 * supply, and `autoOrient()` only reads EXIF. libvips has no deskew operation
 * either. So the angle has to come from somewhere, and Tesseract already
 * computes it. Using OSD avoids adding an OpenCV build to the image just to run
 * a Hough transform.
 */
export async function detectOrientation(
  imagePath: string,
  opts: TesseractNativeOptions = {},
  timeoutMs = 8000,
): Promise<{ rotateDeg: number; skewDeg: number; confidence: number } | null> {
  const bin = opts.binary ?? "tesseract";
  const env = {
    OMP_THREAD_LIMIT: String(opts.ompThreadLimit ?? 1),
    ...(opts.tessdataPrefix ? { TESSDATA_PREFIX: opts.tessdataPrefix } : {}),
  };
  const r = await run(bin, [imagePath, "stdout", "--psm", "0", "-l", "osd"], timeoutMs, env);
  if (r.code !== 0 || r.timedOut) return null;
  const rotate = /Rotate:\s*(-?\d+(?:\.\d+)?)/.exec(r.stdout);
  const skew = /Script confidence:\s*(-?\d+(?:\.\d+)?)/.exec(r.stdout);
  const oriConf = /Orientation confidence:\s*(-?\d+(?:\.\d+)?)/.exec(r.stdout);
  if (!rotate) return null;
  return {
    rotateDeg: Number(rotate[1]),
    skewDeg: 0, // OSD reports 90-degree rotation, not fine skew
    confidence: oriConf ? Number(oriConf[1]) : skew ? Number(skew[1]) : 0,
  };
}

/**
 * Detect the page's SCRIPT from the pixels, before recognition.
 *
 * This exists because the obvious alternative does not work. The first version of
 * the pipeline recognised each page in Latin, looked at the resulting text, and
 * re-routed if the text turned out to be Devanagari or Tamil. That fails in
 * exactly the case it is needed: a Latin model reading a Devanagari page returns
 * garbled LATIN characters, so the script detector sees Latin, agrees with the
 * initial guess, and never re-routes. Measured on the fixture set: a Hindi order
 * and a Tamil order both stayed on the English model and never reached the
 * numeric-arbitration path that recovers their dates.
 *
 * Tesseract's OSD mode already solves this properly — it classifies the script
 * from glyph shapes without needing a language model. Measured on the same
 * degraded fixtures: Devanagari, Tamil and Latin all identified correctly.
 *
 * The reported script confidence is often low (0.29 for the Devanagari page) even
 * when the answer is right, so it is returned for logging rather than used as a
 * gate — refusing a correct answer because the engine is modest about it would
 * put us back where we started.
 */
export async function detectScriptOSD(
  imagePath: string,
  opts: TesseractNativeOptions = {},
  timeoutMs = 10_000,
): Promise<{ script: ScriptCode; scriptName: string; confidence: number; rotateDeg: number } | null> {
  const bin = opts.binary ?? "tesseract";
  const env = {
    OMP_THREAD_LIMIT: String(opts.ompThreadLimit ?? 1),
    ...(opts.tessdataPrefix ? { TESSDATA_PREFIX: opts.tessdataPrefix } : {}),
  };
  const r = await run(bin, [imagePath, "stdout", "--psm", "0", "-l", "osd"], timeoutMs, env);
  if (r.code !== 0 || r.timedOut) return null;

  // OSD writes to stdout on success; some builds write to stderr.
  const out = r.stdout.length > 0 ? r.stdout : r.stderr;
  const scriptM = /Script:\s*([A-Za-z_]+)/.exec(out);
  if (!scriptM) return null;
  const confM = /Script confidence:\s*(-?\d+(?:\.\d+)?)/.exec(out);
  const rotM = /Rotate:\s*(-?\d+(?:\.\d+)?)/.exec(out);

  const name = scriptM[1]!;
  const map: Record<string, ScriptCode> = {
    Latin: "Latn", Devanagari: "Deva", Bengali: "Beng", Tamil: "Taml",
    Telugu: "Telu", Kannada: "Knda", Malayalam: "Mlym", Gujarati: "Gujr",
    Gurmukhi: "Guru", Oriya: "Orya", Arabic: "Arab",
  };
  return {
    script: map[name] ?? "Zzzz",
    scriptName: name,
    confidence: confM ? Number(confM[1]) : 0,
    rotateDeg: rotM ? Number(rotM[1]) : 0,
  };
}

interface TsvRow {
  level: number;
  page: number;
  block: number;
  para: number;
  line: number;
  word: number;
  left: number;
  top: number;
  width: number;
  height: number;
  conf: number;
  text: string;
}

/**
 * Parse Tesseract TSV.
 *
 * Two details that are easy to get wrong and both matter:
 *  - conf is -1 for structural rows (page/block/para/line). Those are not words
 *    and must be dropped, or the mean confidence is dragged to nonsense.
 *  - the text column can legitimately contain a tab-free empty string for a
 *    recognised-but-blank word. Splitting on tab with a fixed field count is
 *    correct; splitting on whitespace is not, because Indic text contains spaces.
 */
export function parseTsv(tsv: string): TsvRow[] {
  const lines = tsv.split(/\r?\n/);
  const out: TsvRow[] = [];
  for (const raw of lines) {
    if (raw.length === 0) continue;
    const f = raw.split("\t");
    if (f.length < 12) continue;
    if (f[0] === "level") continue; // header
    const level = Number(f[0]);
    const conf = Number(f[10]);
    if (level !== 5) continue;      // 5 = word
    if (!Number.isFinite(conf) || conf < 0) continue;
    const text = f.slice(11).join("\t");
    if (text.trim().length === 0) continue;
    out.push({
      level,
      page: Number(f[1]), block: Number(f[2]), para: Number(f[3]),
      line: Number(f[4]), word: Number(f[5]),
      left: Number(f[6]), top: Number(f[7]),
      width: Number(f[8]), height: Number(f[9]),
      conf, text,
    });
  }
  return out;
}

export class TesseractNativeEngine implements OcrEngine {
  readonly id = "tesseract-native";
  readonly scripts: ScriptCode[] = [
    "Latn", "Deva", "Beng", "Taml", "Telu", "Knda", "Mlym", "Gujr", "Guru", "Orya", "Arab",
  ];

  private cachedAvailable: boolean | null = null;
  private cachedLangs: Set<string> | null = null;

  constructor(private readonly opts: TesseractNativeOptions = {}) {}

  private get binary(): string { return this.opts.binary ?? "tesseract"; }
  /**
   * Environment for every Tesseract invocation.
   *
   * `OMP_THREAD_LIMIT=1` is the single largest performance win in this pipeline
   * and it is counter-intuitive enough to justify the measurement inline.
   *
   * Tesseract 5 parallelises its LSTM recogniser with OpenMP. On the page sizes
   * and core counts we actually run on, that parallelisation COSTS time — the
   * synchronisation overhead exceeds the gain. Measured on a 2-core container,
   * 300 DPI A4:
   *
   *   English FIR page      default OpenMP  9987 ms   →  OMP_THREAD_LIMIT=1  2251 ms   (4.4x)
   *   Devanagari order page default OpenMP  2557 ms   →  OMP_THREAD_LIMIT=1  1034 ms   (2.5x)
   *
   * Ground-truth recall was IDENTICAL in both configurations (14/14 tokens on the
   * FIR, 8/8 numerics on the Devanagari order), so this is pure latency, not a
   * speed/accuracy trade.
   *
   * Throughput then comes from running PAGES concurrently instead, which scales
   * with cores: 4 pages serially took 20.9 s, the same 4 pages concurrently took
   * 7.4 s on the same 2 cores.
   *
   * Override by setting `ompThreadLimit` if a deployment has many idle cores and
   * measures a different result — but measure it, do not assume.
   */
  private get env(): Record<string, string> {
    return {
      OMP_THREAD_LIMIT: String(this.opts.ompThreadLimit ?? 1),
      ...(this.opts.tessdataPrefix ? { TESSDATA_PREFIX: this.opts.tessdataPrefix } : {}),
    };
  }

  async available(): Promise<boolean> {
    if (this.cachedAvailable !== null) return this.cachedAvailable;
    const r = await run(this.binary, ["--version"], 5000, this.env);
    this.cachedAvailable = r.code === 0;
    return this.cachedAvailable;
  }

  /** Which traineddata files are actually installed. Routing must not request a
   *  language the image does not have — Tesseract fails the whole page if so. */
  async installedLangs(): Promise<Set<string>> {
    if (this.cachedLangs) return this.cachedLangs;
    const r = await run(this.binary, ["--list-langs"], 5000, this.env);
    const set = new Set<string>();
    for (const line of r.stdout.split(/\r?\n/)) {
      const t = line.trim();
      if (t.length > 0 && !t.startsWith("List of")) set.add(t);
    }
    this.cachedLangs = set;
    return set;
  }

  /** Build the -l value, dropping languages that are not installed. */
  async langsFor(script: ScriptCode): Promise<string> {
    const wanted = (TESS_LANGS[script] ?? "eng").split("+");
    const have = await this.installedLangs();
    const usable = wanted.filter((l) => have.has(l));
    if (usable.length === 0) {
      // Fall back to the script-level model if the language models are absent.
      const scriptModel: Partial<Record<ScriptCode, string>> = {
        Deva: "Devanagari", Beng: "Bengali", Taml: "Tamil", Telu: "Telugu",
      };
      const sm = scriptModel[script];
      if (sm && have.has(sm)) return sm;
      return have.has("eng") ? "eng" : [...have][0] ?? "eng";
    }
    return usable.join("+");
  }

  async recognise(req: OcrRequest): Promise<OcrResult> {
    const t0 = performance.now();
    const notes: string[] = [];
    const langs = await this.langsFor(req.script);
    const dir = await mkdtemp(join(tmpdir(), "nyv-ocr-"));
    const base = join(dir, "out");

    try {
      const args = [
        req.imagePath, base,
        "-l", langs,
        "--psm", String(this.opts.psm ?? 3),
        "--oem", String(this.opts.oem ?? 1),
        "-c", "preserve_interword_spaces=1",
        "tsv",
      ];
      const r = await run(this.binary, args, req.timeoutMs, this.env);
      if (r.timedOut) {
        notes.push(`timeout after ${req.timeoutMs}ms`);
        return { words: [], meanConf: 0, engine: `${this.id}:${langs}`, deskewDeg: 0, ms: performance.now() - t0, notes };
      }
      if (r.code !== 0) {
        notes.push(`exit ${r.code}: ${r.stderr.slice(0, 300)}`);
        return { words: [], meanConf: 0, engine: `${this.id}:${langs}`, deskewDeg: 0, ms: performance.now() - t0, notes };
      }

      const tsv = await readFile(`${base}.tsv`, "utf8");
      const rows = parseTsv(tsv);
      const words: Word[] = rows.map((row) => {
        const px = { x: row.left, y: row.top, w: row.width, h: row.height };
        return {
          text: row.text,
          bbox: pixelsToPoints(px, req.dpi),
          conf: row.conf / 100,
          // Per-word script, not per-page. A cause title in English inside a
          // Devanagari order must be labelled Latin so downstream grammar
          // matching does not treat it as transliteration noise.
          script: detectScript(row.text),
          source: "OCR" as const,
          engine: `${this.id}:${langs}`,
        };
      });

      const meanConf = words.length === 0
        ? 0
        : words.reduce((a, w) => a + w.conf, 0) / words.length;

      return {
        words,
        meanConf,
        engine: `${this.id}:${langs}`,
        deskewDeg: 0,
        ms: performance.now() - t0,
        notes,
      };
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }
}
