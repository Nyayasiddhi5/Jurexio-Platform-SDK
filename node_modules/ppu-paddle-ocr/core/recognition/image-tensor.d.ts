import type { cv } from "ppu-ocv";
import type { CanvasProcessor } from "ppu-ocv/canvas";
import type { CoreCanvas, ImageProcessorProvider } from "../platform.js";
/**
 * Preprocesses a cropped canvas region into a float tensor ready for the recognition model.
 *
 * Uses OpenCV resize when `imageProcessor` is supplied, otherwise falls back to canvas-native.
 */
export declare function preprocessImage(cropCanvas: CoreCanvas, targetHeight: number, imageProcessor: ImageProcessorProvider | undefined, createCanvasProcessor: (canvas: CoreCanvas) => CanvasProcessor): Promise<{
    imageTensor: Float32Array;
    tensorWidth: number;
    tensorHeight: number;
}>;
/**
 * Creates a normalized float tensor from a `CanvasProcessor`.
 */
export declare function createImageTensor(processor: CanvasProcessor, width: number, height: number): Float32Array;
/**
 * Creates a normalized float tensor from a canvas.
 *
 * The model expects three identical channels (grayscale replicated to RGB).
 * Fills channel 0, then `copyWithin` copies it to channels 1 and 2.
 */
export declare function createImageTensorFromCanvas(canvas: CoreCanvas, width: number, height: number): Float32Array;
/**
 * Creates a normalized float tensor directly from a continuous 8-bit OpenCV Mat.
 *
 * Same normalization as {@link createImageTensorFromCanvas} (red channel for
 * RGBA mats), but reads `mat.data` in place instead of routing the pixels
 * through a canvas render and `getImageData` readback.
 *
 * The mat must be continuous: opencv.js sizes the `data` view as
 * `total() * elemSize()`, so a padded (ROI) mat's last rows fall outside it
 * and would read back as NaN. Callers send those through the canvas path.
 */
export declare function createImageTensorFromMat(mat: cv.Mat, width: number, height: number): Float32Array;
