import type { BBox, ScriptCode, Word } from "../../types.js";

export interface OcrRequest {
  /** Path to a rasterised page image on disk (PNG or TIFF). */
  imagePath: string;
  script: ScriptCode;
  /** DPI the image was rendered at, needed to map pixels back to PDF points. */
  dpi: number;
  /** Page dimensions in PDF points, for coordinate mapping. */
  pageWidthPt: number;
  pageHeightPt: number;
  timeoutMs: number;
  /** Restrict recognition to this region, in image pixels. */
  region?: BBox;
}

export interface OcrResult {
  words: Word[];
  /** Mean word confidence, 0..1. */
  meanConf: number;
  engine: string;
  /** Skew angle the engine reported or that was applied, degrees. */
  deskewDeg: number;
  /** Wall-clock milliseconds. */
  ms: number;
  /** Non-fatal problems worth reporting. */
  notes: string[];
}

export interface OcrEngine {
  readonly id: string;
  /** Scripts this engine can actually read. Claims here are load-bearing —
   *  routing trusts them, so an engine must not claim a script it guesses at. */
  readonly scripts: ScriptCode[];
  /** Cheap check for whether the engine is installed and usable right now. */
  available(): Promise<boolean>;
  recognise(req: OcrRequest): Promise<OcrResult>;
}

/** Map an OCR pixel box back into PDF-point space. */
export function pixelsToPoints(
  box: BBox,
  dpi: number,
): BBox {
  const k = 72 / dpi;
  return { x: box.x * k, y: box.y * k, w: box.w * k, h: box.h * k };
}
