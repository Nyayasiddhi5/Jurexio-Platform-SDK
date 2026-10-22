import type { OperationResult, PartialOptions } from "../pipeline/types.js";
import { cv } from "../cv-provider.js";
/** Options for the bitwise-NOT color inversion operation (no configurable fields). */
export type InvertOptions = PartialOptions;
/** Invert all pixel values using `cv.bitwise_not`. */
export declare function invert(img: cv.Mat, _options: InvertOptions): OperationResult;
