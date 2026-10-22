import type { CoreCanvas } from "../platform.js";
/**
 * Converts a canvas to a normalized CHW float tensor for detection model input.
 *
 * Hot loop; pre-multiplies normalization constants to a single multiply+subtract per channel per pixel.
 */
export declare function imageToTensor(canvas: CoreCanvas, width: number, height: number, mean: [number, number, number], stdDeviation: [number, number, number]): Float32Array;
/**
 * Converts a flat float tensor (probability map) back to a grayscale canvas.
 */
export declare function tensorToCanvas(tensor: Float32Array, width: number, height: number, createCanvas: (w: number, h: number) => CoreCanvas): CoreCanvas;
