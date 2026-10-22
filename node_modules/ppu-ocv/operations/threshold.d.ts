import type { OperationResult, PartialOptions } from "../pipeline/types.js";
import { cv } from "../cv-provider.js";
/** Options for the global threshold operation. */
export type ThresholdOptions = PartialOptions & {
    /** Lower threshold value (0-255) */
    lower: number;
    /** Upper threshold value (0-255) */
    upper: number;
    /** Type of thresholding (cv.THRESH_...) */
    type: cv.ThresholdTypes;
};
/** Apply a global threshold to convert a grayscale image to binary. */
export declare function threshold(img: cv.Mat, options: ThresholdOptions): OperationResult;
