import type { OperationResult, RequiredOptions } from "../pipeline/types.js";
import { cv } from "../cv-provider.js";
/** Options for converting a Mat to a different depth/channel type. */
export type ConvertOptions = RequiredOptions & {
    /** Desired matrix type (cv.CV_...) if negative, it will be the same as input */
    rtype: number;
};
/** Convert the image matrix to a new type via `Mat.convertTo`. */
export declare function convert(img: cv.Mat, options: ConvertOptions): OperationResult;
