import type { Contours } from "ppu-ocv";
import type { Box } from "../../interface.js";
/** New pixel dimensions plus the scale ratio that produced them. */
export type ResizeDimensions = {
    width: number;
    height: number;
    ratio: number;
};
/**
 * Resolves the effective detection size cap for an input image.
 *
 * `"auto"` scales the cap with the input - `clamp(0.75 * longestSide, 960,
 * 1920)` - so inputs up to ~1280px behave exactly like the proven fixed 960
 * (a slight downscale also denoises busy backgrounds for the tiny detector),
 * while large photos keep enough pixels for small text instead of being
 * crushed to a fraction of their size.
 */
export declare function resolveMaxSideLength(maxSideLength: number | "auto", longestSide: number): number;
/**
 * Calculates resize dimensions keeping the longest side at or below `maxSideLength`.
 *
 * Returns the new dimensions and the scale ratio applied.
 */
export declare function calculateResizeDimensions(originalWidth: number, originalHeight: number, maxSideLength: number): ResizeDimensions;
/**
 * Expands a bounding rect by padding derived from its height, clamped to canvas bounds.
 */
export declare function applyPaddingToRect(rect: Box, maxWidth: number, maxHeight: number, paddingVertical: number, paddingHorizontal: number): Box;
/**
 * Maps a rect from the resized/padded tensor space back to original image coordinates.
 */
export declare function convertToOriginalCoordinates(rect: Box, resizeRatio: number, originalWidth: number, originalHeight: number): Box;
/**
 * Iterates OpenCV contours and converts each to a padded, coordinate-mapped `Box`.
 */
export declare function extractBoxesFromContours(contours: Contours, width: number, height: number, resizeRatio: number, originalWidth: number, originalHeight: number, minBoxArea: number, paddingVertical: number, paddingHorizontal: number): Box[];
/**
 * Converts raw region bboxes from `findRegions` into `Box` objects clamped to the original image.
 */
export declare function extractBoxesFromRegions(regions: Array<{
    bbox: {
        x0: number;
        y0: number;
        x1: number;
        y1: number;
    };
    area: number;
}>, originalWidth: number, originalHeight: number): Box[];
