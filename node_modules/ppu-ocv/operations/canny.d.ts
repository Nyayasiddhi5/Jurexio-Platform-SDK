import type { OperationResult, PartialOptions } from "../pipeline/types.js";
import { cv } from "../cv-provider.js";
/** Options for the Canny edge-detection operation. */
export type CannyOptions = PartialOptions & {
    /** Lower threshold for the hysteresis procedure (0-255) */
    lower: number;
    /** Upper threshold for the hysteresis procedure (0-255) */
    upper: number;
};
/** Detect edges using the Canny algorithm. */
export declare function canny(img: cv.Mat, options: CannyOptions): OperationResult;
