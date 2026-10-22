import type { OperationResult, RequiredOptions } from "../pipeline/types.js";
import { cv } from "../cv-provider.js";
/** Options for rotating the image around a pivot point. */
export type RotateOptions = RequiredOptions & {
    /** Angle of rotation in degrees (positive for counter-clockwise) */
    angle: number;
    /** Optional center of rotation. Defaults to the image center. */
    center?: cv.Point;
};
/** Rotate the image by the given angle around its centre (or a custom pivot). */
export declare function rotate(img: cv.Mat, options: RotateOptions): OperationResult;
