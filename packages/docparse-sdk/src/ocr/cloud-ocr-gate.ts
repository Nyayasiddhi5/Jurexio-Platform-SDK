/**
 * Cloud OCR escalation policy — local-first, Textract/vision only on gaps.
 */
import type { CloudOcrProvider } from "./cloud-ocr-types.js";
import type { RoutedOcrResult } from "./router.js";

export const CLOUD_OCR_CONF_FLOOR = 0.38;

/** Heuristic cues that the page is a form/registration scan needing structured OCR. */
const REGISTRATION_FORM_CUE =
  /\b(registration|mee\s*seva|incorporation|certificate|gstin|cin|establishment|government\s+of)\b/i;

export interface CloudOcrGateContext {
  /** Glyphs on page after local OCR (non-whitespace). */
  glyphCount?: number;
  /** 0..1 garble estimate from OCR text. */
  garbleRate?: number;
  /** PDF text-layer image coverage when known (scan PDF). */
  imageCoverage?: number;
  /** True when text layer was untrusted sparse scan. */
  scannedPage?: boolean;
  /** Anchor + grammar candidates on this page (post-extract retry path). */
  anchorCandidateCount?: number;
}

export function shouldAttemptCloudOcr(
  cloud: CloudOcrProvider | undefined,
  local: RoutedOcrResult,
  ctx: CloudOcrGateContext = {},
): cloud is CloudOcrProvider {
  if (!cloud) return false;

  const glyphCount =
    ctx.glyphCount ??
    local.words.reduce((n, w) => n + w.text.replace(/\s/g, "").length, 0);

  if (local.words.length === 0) return true;
  if (local.meanConf < CLOUD_OCR_CONF_FLOOR) return true;
  if (local.humanReviewRequired) return true;

  if (glyphCount > 0 && glyphCount < 120) {
    if (ctx.scannedPage || (ctx.imageCoverage ?? 0) > 0.35) return true;
  }

  const garble = ctx.garbleRate ?? 0;
  if (garble >= 0.22) return true;

  const imageCov = ctx.imageCoverage ?? 0;
  if (ctx.scannedPage || imageCov > 0.35) {
    if (glyphCount < 400) return true;
    if (garble >= 0.12) return true;
  }

  const joined = local.words.map((w) => w.text).join(" ");
  if (REGISTRATION_FORM_CUE.test(joined) && (glyphCount < 500 || garble >= 0.1)) {
    return true;
  }

  if (ctx.anchorCandidateCount === 0 && glyphCount > 0 && glyphCount < 800) {
    return true;
  }

  return false;
}
