import type { OperationResult, PartialOptions } from "../pipeline/types.js";
import { cv } from "../cv-provider.js";
/** Options for the morphological erosion operation. */
export type ErodeOptions = PartialOptions & {
    /** Size of the block [x, y] */
    size: [number, number];
    /** Number of iterations for the erosion operation */
    iter: number;
};
/** Erode the image to shrink foreground regions and remove small noise. */
export declare function erode(img: cv.Mat, options: ErodeOptions): OperationResult;
