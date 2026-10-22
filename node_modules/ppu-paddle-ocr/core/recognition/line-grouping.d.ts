import type { Box } from "../../interface.js";
import type { FlattenedPaddleOcrResult, PaddleOcrResult } from "../base-paddle-ocr.service.js";
import type { RecognitionResult } from "../base-recognition.service.js";
import type { CanvasOps, CoreCanvas } from "../platform.js";
/**
 * Shapes recognition results into the flat {@link FlattenedPaddleOcrResult}:
 * space-joined text and the mean confidence across all items.
 */
export declare function flattenResults(results: RecognitionResult[]): FlattenedPaddleOcrResult;
/**
 * Shapes recognition results into the grouped {@link PaddleOcrResult}:
 * items within half the running average height of the current line's y are
 * kept on that line, each line is sorted left-to-right, and lines are joined
 * with newlines.
 */
export declare function groupResultsByLine(results: RecognitionResult[]): PaddleOcrResult;
/**
 * Groups detected boxes into lines based on vertical proximity.
 *
 * Boxes within 50% of the average line height are placed on the same line,
 * then each line is sorted left-to-right.
 */
export declare function groupBoxesIntoLines(boxes: Array<{
    box: Box;
    index: number;
}>): Array<Array<{
    box: Box;
    index: number;
}>>;
/**
 * Merges multiple same-line boxes into a single stitched canvas.
 *
 * All crops are stretched to a common height so character sizes are uniform.
 * Degenerate boxes (far shorter than the line) have their stretch clamped so
 * the merged width stays bounded. A white gap is drawn between crops so the
 * recognizer sees a word boundary at each box seam; `cropWidths` gives each
 * box's share of the stitched width (its crop plus the trailing gap) for
 * mapping recognized text back to its source box.
 */
/** One line stitched into a single canvas, with each box's share of its width. */
export type MergedLineCrop = {
    mergedCanvas: CoreCanvas;
    mergedBox: Box;
    cropWidths: number[];
};
export declare function mergeLineCrop(sourceCanvas: CoreCanvas, lineBoxes: Array<{
    box: Box;
    index: number;
}>, createCanvas: (width: number, height: number) => CoreCanvas, canvasOps: CanvasOps): MergedLineCrop;
/**
 * Splits recognized text across stitched segments using the CTC decoder's
 * per-character positions (fraction 0..1 of the input width).
 *
 * Each character lands in the segment containing its position, which is exact
 * up to the model's own alignment; falls back to the width-proportional split
 * when positions don't align one-to-one with the text's characters.
 */
export declare function splitTextByPositions(text: string, positions: number[], segmentWidths: number[]): string[];
/**
 * Splits recognized text proportionally across stitched line crops by pixel width.
 *
 * Characters are assigned proportionally to each crop's share of total width.
 * Each cut snaps to the nearest whitespace within {@link CUT_SNAP_RANGE} so
 * proportional drift does not slice through a word; the space itself is
 * dropped from both sides of the cut.
 */
export declare function splitBatchTextByWidths(text: string, cropWidths: number[]): string[];
/**
 * Packs sized items into width-bounded batches (first-fit-decreasing).
 *
 * A batch accepts an item while its running width plus a per-item separator gap
 * stays within `targetWidth`; otherwise a new batch is opened.
 */
export declare function packIntoBatches<T>(items: T[], widthOf: (item: T) => number, targetWidth: number, separatorGap: number): T[][];
