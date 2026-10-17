import type { Page } from "../types.js";
import type { TableOptions } from "./tables.js";
import { detectTables } from "./tables.js";
import {
  detectRuledTablesFromImage,
  detectRuledTablesFromTextLayout,
  mergeTableDetections,
} from "./ruled-lines.js";

export async function detectPageTables(
  page: Page,
  options: TableOptions & { rasterImagePath?: string } = {},
): Promise<Page["tables"]> {
  const projection = detectTables(page, options);
  const ruledText =
    page.route === "TEXT_LAYER" && projection.length === 0
      ? detectRuledTablesFromTextLayout(page, options)
      : [];
  let merged = mergeTableDetections(projection, ruledText);
  if (page.route !== "OCR" || !options.rasterImagePath) {
    return merged;
  }
  try {
    const ruled = await detectRuledTablesFromImage(page, options.rasterImagePath, options);
    return mergeTableDetections(merged, ruled);
  } catch {
    return projection;
  }
}
