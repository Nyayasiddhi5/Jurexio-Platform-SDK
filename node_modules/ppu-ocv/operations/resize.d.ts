import type { OperationResult, RequiredOptions } from "../pipeline/types.js";
import { cv } from "../cv-provider.js";
/** Options for resizing the image to exact pixel dimensions. */
export type ResizeOptions = RequiredOptions & {
    /** Width of the resized image */
    width: number;
    /** Height of the resized image */
    height: number;
};
/** Resize the image to the given width and height. */
export declare function resize(img: cv.Mat, options: ResizeOptions): OperationResult;
