import { cv } from "../cv-provider.js";
import type { BoundingBox, Points } from "../index.interface.js";
import type { OperationResult, RequiredOptions } from "../pipeline/types.js";
/** Options for the perspective warp (four-point transform) operation. */
export type WarpOptions = RequiredOptions & {
    /** Four points of the source image containing x and y point in
     * topLeft, topRight, bottomLeft and BottomRight.
     * Use Contours class instance to get the points
     */
    points: Points;
    /** A destination canvas bounding box for cropping the original canvas */
    bbox: BoundingBox;
};
/** Apply a perspective warp using four source/destination corner points. */
export declare function warp(img: cv.Mat, options: WarpOptions): OperationResult;
