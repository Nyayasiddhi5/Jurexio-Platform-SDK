import type { OperationResult, PartialOptions } from "../pipeline/types.js";
import { cv } from "../cv-provider.js";
/** Options for the morphological gradient operation. */
export type MorphologicalGradientOptions = PartialOptions & {
    /** Kernel size for the morphological gradient operation [x, y] */
    size: [number, number];
};
/** Apply morphological gradient to highlight edges (dilation minus erosion). */
export declare function morphologicalGradient(img: cv.Mat, options: MorphologicalGradientOptions): OperationResult;
