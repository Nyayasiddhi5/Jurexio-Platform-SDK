import { cv } from "../cv-provider.js";
import type { OperationResult, PartialOptions } from "../pipeline/types.js";
/** Options for the Gaussian blur operation. */
export type BlurOptions = PartialOptions & {
    /** Size of the blur [x, y] */
    size: [number, number];
    /** Gaussian kernel standard deviation on x axis */
    sigma: number;
};
/** Apply Gaussian blur to reduce noise. */
export declare function blur(img: cv.Mat, options: BlurOptions): OperationResult;
