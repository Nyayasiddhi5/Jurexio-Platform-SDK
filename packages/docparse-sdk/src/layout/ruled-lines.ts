/**
 * Ruled-line table detection for raster/OCR pages (Phase 1B).
 * Complements whitespace projection — gates RULED method when greyscale ruling is present.
 */
import type { Page, Table } from "../types.js";
import { loadGrey } from "../pipeline/raster.js";
import type { TableOptions } from "./tables.js";
import { detectTables } from "./tables.js";

export interface RuledLineDetectOptions {
  /** Min dark-pixel fraction in a row/col to count as a rule line. */
  lineThreshold?: number;
  minRows?: number;
  minCols?: number;
}

/**
 * Detect tables from horizontal/vertical ruling on a page image (PNG greyscale).
 * Falls back to empty when sharp unavailable or image unreadable.
 */
export async function detectRuledTablesFromImage(
  page: Page,
  imagePath: string,
  options: TableOptions & RuledLineDetectOptions = {},
): Promise<Table[]> {
  const minRows = options.minRows ?? 3;
  const minCols = options.minCols ?? 3;
  const lineThreshold = options.lineThreshold ?? 0.55;

  const grey = await loadGrey(imagePath);
  if (!grey || grey.width < 10 || grey.height < 10) return [];

  const { data, width, height } = grey;
  const rowDark = new Float32Array(height);
  const colDark = new Float32Array(width);
  for (let y = 0; y < height; y++) {
    let rs = 0;
    for (let x = 0; x < width; x++) {
      const v = data[y * width + x] ?? 255;
      if (v < 128) rs++;
    }
    rowDark[y] = rs / width;
  }
  for (let x = 0; x < width; x++) {
    let cs = 0;
    for (let y = 0; y < height; y++) {
      const v = data[y * width + x] ?? 255;
      if (v < 128) cs++;
    }
    colDark[x] = cs / height;
  }

  const hRules = peaks(rowDark, lineThreshold, 3);
  const vRules = peaks(colDark, lineThreshold, 3);
  if (hRules.length < minRows + 1 || vRules.length < minCols + 1) {
    return [];
  }

  return detectTables(page, { ...options, minRows, minCols })
    .filter((t) => t.conf >= 0.45)
    .map((t) => ({
      ...t,
      method: "RULED" as const,
      conf: Math.min(1, t.conf + 0.08),
    }))
    .slice(0, 4);
}

/**
 * Text-layer ruled grids — column-aligned lines (bank statements, cause lists).
 */
export function detectRuledTablesFromTextLayout(
  page: Page,
  options: TableOptions = {},
): Table[] {
  const minRows = options.minRows ?? 4;
  const minCols = options.minCols ?? 3;
  if (page.lines.length < minRows * 2) return [];
  const xs = page.lines.map((l) => l.bbox.x).sort((a, b) => a - b);
  const clusters: number[] = [];
  for (const x of xs) {
    const last = clusters[clusters.length - 1];
    if (last === undefined || Math.abs(x - last) > 12) clusters.push(x);
  }
  if (clusters.length < minCols) return [];
  return detectTables(page, { ...options, minRows, minCols })
    .filter((t) => t.rows >= minRows && t.cols >= minCols)
    .map((t) => ({
      ...t,
      method: "RULED" as const,
      conf: Math.min(1, t.conf + 0.05),
    }))
    .slice(0, 4);
}

function peaks(arr: Float32Array, threshold: number, minGap: number): number[] {
  const idx: number[] = [];
  for (let i = 0; i < arr.length; i++) {
    if (arr[i]! >= threshold) idx.push(i);
  }
  if (idx.length === 0) return [];
  const merged: number[] = [idx[0]!];
  for (let i = 1; i < idx.length; i++) {
    const prev = merged[merged.length - 1]!;
    if (idx[i]! - prev >= minGap) merged.push(idx[i]!);
  }
  return merged;
}

/** Merge projection + ruled tables; prefer higher confidence per overlapping bbox. */
export function mergeTableDetections(projection: Table[], ruled: Table[]): Table[] {
  const all = [...projection, ...ruled];
  all.sort((a, b) => b.conf - a.conf);
  const kept: Table[] = [];
  for (const t of all) {
    const dup = kept.some((k) => Math.abs(k.bbox.y - t.bbox.y) < 8 && Math.abs(k.bbox.x - t.bbox.x) < 8);
    if (!dup) kept.push(t);
  }
  return kept;
}
