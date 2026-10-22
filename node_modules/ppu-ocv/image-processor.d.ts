import type { CanvasLike } from "./canvas-factory.js";
import { cv } from "./cv-provider.js";
import type { AdaptiveThresholdOptions, BlurOptions, BorderOptions, CannyOptions, ConvertOptions, DilateOptions, EqualizeOptions, ErodeOptions, GrayscaleOptions, InvertOptions, MorphologicalGradientOptions, OperationName, OperationOptions, RequiredOptions, ResizeOptions, RotateOptions, ThresholdOptions, WarpOptions } from "./pipeline/index.js";
type NameWithRequiredOptions = {
    [N in OperationName]: OperationOptions<N> extends RequiredOptions ? N : never;
}[OperationName];
type NameWithOptionalOptions = Exclude<OperationName, NameWithRequiredOptions>;
/**
 * OpenCV-powered image processing pipeline.
 *
 * Wraps a `cv.Mat` and exposes a chainable API of named operations
 * (grayscale, blur, threshold, etc.).  Each method mutates the internal
 * state and returns `this`, so operations can be chained fluently.
 *
 * Call {@link ImageProcessor.initRuntime} once before creating any instances.
 *
 * @example
 * ```ts
 * await ImageProcessor.initRuntime();
 * const result = new ImageProcessor(canvas)
 *   .grayscale()
 *   .blur()
 *   .threshold()
 *   .toCanvas();
 * ```
 */
export declare class ImageProcessor {
    /** Underlying OpenCV Mat. Each operation deletes the previous Mat and replaces this reference. */
    img: cv.Mat;
    /** Current image width in pixels, kept in sync with `img.cols`. */
    width: number;
    /** Current image height in pixels, kept in sync with `img.rows`. */
    height: number;
    /**
     * Create an ImageProcessor instance from a Canvas or cv.Mat
     * @param source Source image as CanvasLike or cv.Mat
     */
    constructor(source: CanvasLike | cv.Mat);
    /**
     * Initialize OpenCV runtime. This is recommended to be called before any
     * image processing.
     */
    static initRuntime(): Promise<void>;
    /**
     * Execute a registered pipeline operation that requires options.
     * @param operationName Name of the operation (e.g., "resize")
     * @param options Required options for the operation
     */
    execute<N extends NameWithRequiredOptions>(operationName: N, options: OperationOptions<N>): this;
    /**
     * Execute a registered pipeline operation that has default options.
     * @param operationName Name of the operation (e.g., "blur")
     * @param options Optional override of the default options
     */
    execute<N extends NameWithOptionalOptions>(operationName: N, options?: Partial<OperationOptions<N>>): this;
    /**
     * Convert image to grayscale
     * @description Usage order: independent
     * @param options Optional configuration for grayscale conversion
     */
    grayscale(options?: Partial<GrayscaleOptions>): this;
    /**
     * Bluring image to reduce noise using Gaussian Blur
     * @description Usage order: (ideally after) grayscale
     * @param options Blur configuration options
     */
    blur(options?: Partial<BlurOptions>): this;
    /**
     * Thresholding to convert image to binary
     * @description Usage order: (after) grayscale (and optionally blur)
     * @param options Thresholding configuration options
     */
    threshold(options?: Partial<ThresholdOptions>): this;
    /**
     * Adaptive thresholding to convert image to binary
     * @description Usage order: (after) grayscale (and optionally blur)
     * @param options Adaptive thresholding configuration options
     */
    adaptiveThreshold(options?: Partial<AdaptiveThresholdOptions>): this;
    /**
     * Invert image colors
     * @description Usage order: ideally (after) threshold or adaptiveThreshold
     * @param options Optional configuration for inversion
     */
    invert(options?: Partial<InvertOptions>): this;
    /**
     * Equalise image contrast using histogram equalization
     * @description Usage order: (after) grayscale — input must be single-channel
     * @param options Equalization configuration options
     */
    equalize(options?: Partial<EqualizeOptions>): this;
    /**
     * Canny edge detection to detect edges in the image
     * @description Usage order: (after) grayscale + blur
     * @param options Canny edge detection configuration options
     */
    canny(options?: Partial<CannyOptions>): this;
    /**
     * Dilate image to increase the size of the foreground object
     * @description Usage order: (after) threshold or edge detection
     * @param options Dilation configuration options
     */
    dilate(options?: Partial<DilateOptions>): this;
    /**
     * Erode image to reduce noise
     * @description Usage order: (after) threshold or edge detection
     * @param options Erosion configuration options
     */
    erode(options?: Partial<ErodeOptions>): this;
    /**
     * Add border to image
     * @description Usage order: independent
     * @param options Border configuration options
     */
    border(options?: Partial<BorderOptions>): this;
    /**
     * Resize image to a new width and height
     * @description Usage order: independent
     * @param options Resize configuration options
     */
    resize(options: ResizeOptions): this;
    /**
     * Rotate image by a given angle
     * @description Usage order: independent
     * @param options Rotate configuration options
     */
    rotate(options: RotateOptions): this;
    /**
     * Warp image to a new perspective
     * @description Usage order: independent
     * @param options Warp configuration options
     */
    warp(options: WarpOptions): this;
    /**
     * Convert image matrix into new matrix type
     * @description Usage order: independent
     * @param options Convert configuration options
     */
    convert(options: ConvertOptions): this;
    /**
     * Morphological gradient to highlight the edges in the image
     * @description Usage order: (after) dilation + erosion (or threshold)
     * @param options Morphological gradient configuration options
     */
    morphologicalGradient(options?: Partial<MorphologicalGradientOptions>): this;
    /**
     * Get the result as a cv.Mat
     */
    toMat(): cv.Mat;
    /**
     * Get the result canvas
     */
    toCanvas(): CanvasLike;
    /**
     * Clean up cv.Mat to free memory
     */
    destroy(): void;
}
export {};
