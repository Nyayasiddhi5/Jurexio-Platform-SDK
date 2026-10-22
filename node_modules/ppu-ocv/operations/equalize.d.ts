import type { OperationResult, PartialOptions } from "../pipeline/types.js";
import { cv } from "../cv-provider.js";
/** Options for the histogram equalization operation. */
export type EqualizeOptions = PartialOptions & {
    /**
     * Equalization algorithm to use.
     * - `"clahe"` (default) — Contrast Limited Adaptive Histogram Equalization;
     *   preserves local contrast and avoids over-amplification in bright regions.
     * - `"global"` — Standard global histogram equalization via `cv.equalizeHist`;
     *   faster but may blow out highlights.
     */
    method: "clahe" | "global";
    /**
     * CLAHE only — clip limit for contrast limiting (default `2.0`).
     * Higher values allow more contrast; lower values are closer to global equalization.
     */
    clipLimit: number;
    /**
     * CLAHE only — tile grid size in pixels (default `8` → 8×8 tiles).
     * The image is divided into this many tiles in each dimension.
     */
    tileGridSize: number;
};
/**
 * Equalise histogram contrast on a single-channel (grayscale) image.
 *
 * Supports two algorithms selectable via {@link EqualizeOptions.method}:
 * - `"clahe"` (default) — locally adaptive, clip-limited equalization.
 * - `"global"` — standard whole-image histogram spreading.
 *
 * Input `img` must be an 8-bit single-channel `cv.Mat` (run `.grayscale()` first).
 * The input Mat is deleted by this operation.
 */
export declare function equalize(img: cv.Mat, options: EqualizeOptions): OperationResult;
