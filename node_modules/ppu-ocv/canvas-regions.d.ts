/**
 * Canvas-native region detection: 8-connected flood-fill bounding-box
 * extraction on a binary image's raw RGBA pixels. Extracted from
 * `CanvasProcessor.findRegions` so the processor stays a thin wrapper over this
 * pure algorithm.
 */
import type { BoundingBox } from "./index.interface.js";
/** A detected region: its bounding box and foreground-pixel count. */
export type DetectedRegion = {
    /** Axis-aligned bounding box of the region (x1/y1 are exclusive). */
    bbox: BoundingBox;
    /** Number of foreground pixels in the region. */
    area: number;
};
/** Options for {@link detectRegions} / `CanvasProcessor.findRegions`. */
export type FindRegionsOptions = {
    /** Which pixels count as foreground relative to `thresh`. @default "light" */
    foreground?: "light" | "dark";
    /** Grayscale threshold separating foreground from background. @default 127 */
    thresh?: number;
    /** Discard regions with fewer than this many pixels. @default 1 */
    minArea?: number;
    /** Discard regions with more than this many pixels. @default Infinity */
    maxArea?: number;
    /** Padding per box as a fraction of its height (vertical/horizontal). */
    padding?: {
        vertical?: number;
        horizontal?: number;
    };
    /** Multiply all bbox coordinates by this factor after padding. @default 1 */
    scale?: number;
};
/**
 * Detect foreground regions in raw RGBA pixel data via 8-connected flood fill.
 *
 * @param data - RGBA pixel data (`width * height * 4` bytes).
 * @param width - Image width in pixels.
 * @param height - Image height in pixels.
 * @param options - See {@link FindRegionsOptions}.
 */
export declare function detectRegions(data: Uint8ClampedArray, width: number, height: number, options?: FindRegionsOptions): DetectedRegion[];
