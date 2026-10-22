import { cv } from "../cv-provider.js";
import type { OperationResult, PartialOptions } from "../pipeline/types.js";
/** Options for the adaptive threshold operation. */
export type AdaptiveThresholdOptions = PartialOptions & {
    /** Upper threshold value (0-255) */
    upper: number;
    /** Adaptive threshold method (cv.ADAPTIVE_THRESH_...) */
    method: cv.AdaptiveThresholdTypes;
    /** Type of thresholding (cv.THRESH_...) */
    type: cv.ThresholdTypes;
    /** Block size for adaptive thresholding (must be odd) */
    size: number;
    /** Constant subtracted from the mean or weighted mean */
    constant: number;
};
/** Apply adaptive thresholding to convert a grayscale image to binary. */
export declare function adaptiveThreshold(img: cv.Mat, options: AdaptiveThresholdOptions): OperationResult;
