import type { OperationResult, PartialOptions } from "../pipeline/types.js";
import { cv } from "../cv-provider.js";
/** Options for the morphological dilation operation. */
export type DilateOptions = PartialOptions & {
    /** Size of the block [x, y] */
    size: [number, number];
    /** Number of iterations for the dilation operation */
    iter: number;
};
/** Dilate the image to expand foreground regions. */
export declare function dilate(img: cv.Mat, options: DilateOptions): OperationResult;
