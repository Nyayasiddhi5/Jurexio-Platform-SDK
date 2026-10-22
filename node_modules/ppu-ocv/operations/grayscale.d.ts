import type { OperationResult, PartialOptions } from "../pipeline/types.js";
import { cv } from "../cv-provider.js";
/** Options for the grayscale conversion operation (no configurable fields). */
export type GrayscaleOptions = PartialOptions;
/** Convert the image to grayscale using `COLOR_RGBA2GRAY`. */
export declare function grayscale(img: cv.Mat, _options: GrayscaleOptions): OperationResult;
