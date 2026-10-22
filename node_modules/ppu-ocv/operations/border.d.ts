import type { OperationResult, PartialOptions } from "../pipeline/types.js";
import { cv } from "../cv-provider.js";
/** Options for adding a constant-color border around the image. */
export type BorderOptions = PartialOptions & {
    /** Size of the border in pixels */
    size: number;
    /** Border type (e.g., cv.BORDER_CONSTANT) */
    borderType: cv.BorderTypes;
    /** Border color in [B, G, R, A] format */
    borderColor: [cv.int, cv.int, cv.int, cv.int];
};
/** Add a uniform border around the image using `cv.copyMakeBorder`. */
export declare function border(img: cv.Mat, options: BorderOptions): OperationResult;
