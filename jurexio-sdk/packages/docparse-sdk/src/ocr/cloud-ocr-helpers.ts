/**
 * Cloud OCR fallback — synthesise word geometry from plain text when local engines fail.
 */
import { readFile } from "node:fs/promises";
import type { ScriptCode, Word } from "../types.js";
import type { CloudOcrProvider } from "./cloud-ocr-types.js";
import type { RoutedOcrResult } from "./router.js";

const CLOUD_CONF_FLOOR = 0.38;

export function wordsFromPlainTextOcr(
  text: string,
  pageWidthPt: number,
  pageHeightPt: number,
  meanConf: number,
  provider: string,
): Word[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];
  const lineH = pageHeightPt / Math.max(lines.length, 1);
  const words: Word[] = [];
  let y = 0;
  for (const line of lines) {
    const parts = line.split(/\s+/).filter(Boolean);
    const cellW = pageWidthPt / Math.max(parts.length, 1);
    let x = 0;
    for (const part of parts) {
      words.push({
        text: part,
        bbox: { x, y, w: cellW, h: lineH * 0.75 },
        conf: meanConf,
        script: "Latn" as ScriptCode,
        source: "OCR",
        engine: `cloud:${provider}`,
      });
      x += cellW;
    }
    y += lineH;
  }
  return words;
}

export async function tryCloudOcrForRasterPage(
  cloud: CloudOcrProvider,
  args: {
    documentId: string;
    pageNo: number;
    imagePath: string;
    fileName: string;
    pageWidthPt: number;
    pageHeightPt: number;
    prior: RoutedOcrResult;
  },
): Promise<RoutedOcrResult | null> {
  if (!(await cloud.available())) return null;
  const bytes = new Uint8Array(await readFile(args.imagePath));
  const hit = await cloud.recognizePage({
    documentId: args.documentId,
    pageNo: args.pageNo,
    bytes,
    fileName: args.fileName,
    mime: "image/png",
  });
  if (!hit?.text?.trim()) return null;
  const words = wordsFromPlainTextOcr(
    hit.text,
    args.pageWidthPt,
    args.pageHeightPt,
    hit.meanConf,
    hit.provider,
  );
  if (words.length === 0) return null;
  return {
    words,
    meanConf: hit.meanConf,
    passes: [
      ...args.prior.passes,
      { id: hit.provider, words: words.length, meanConf: hit.meanConf, ms: 0 },
    ],
    arbitration: args.prior.arbitration,
    numericConflicts: args.prior.numericConflicts,
    ms: args.prior.ms,
    notes: [...args.prior.notes, `cloud_ocr:${hit.provider}`],
    humanReviewRequired: hit.meanConf < CLOUD_CONF_FLOOR,
  };
}

export type { CloudOcrGateContext } from "./cloud-ocr-gate.js";
export { shouldAttemptCloudOcr, CLOUD_OCR_CONF_FLOOR } from "./cloud-ocr-gate.js";
