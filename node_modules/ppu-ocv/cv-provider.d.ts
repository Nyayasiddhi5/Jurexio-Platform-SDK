/**
 * Lazy OpenCV accessor.
 *
 * In Node (with @techstark/opencv-js installed), `cv` is available after
 * `import cv from "@techstark/opencv-js"`.
 *
 * In the browser, `cv` is set on `globalThis` after OpenCV.js is loaded
 * (either via a <script> tag or dynamically by `initRuntime()`).
 *
 * This module re-exports `cv` as a lazy proxy so that static `import`
 * resolution does NOT require `@techstark/opencv-js` to be present
 * as a resolvable bare specifier at module-load time.
 */
import type _cvType from "@techstark/opencv-js";
type CV = typeof _cvType;
/**
 * Set the cv instance (called by platform entry points).
 */
export declare function setCv(instance: CV): void;
/**
 * Resolve the OpenCV module to a ready instance.
 *
 * @techstark/opencv-js v5 changed the default export from a module with an
 * `onRuntimeInitialized` callback to a `Promise` that resolves to the ready
 * module. This awaits that Promise (when present) and re-stores the resolved
 * instance. On v4 / browser-global setups the stored value is already the
 * module, so this is a no-op passthrough.
 */
export declare function resolveCv(): Promise<CV | null>;
/**
 * Type-side companion to the {@link cv} runtime proxy.
 *
 * Re-exports the OpenCV.js type aliases (Mat, Rect, Size, enum constants…) under
 * the `cv.` namespace, so consumers importing `{ cv }` get the types AND the
 * runtime Proxy object via TypeScript's declaration-merging rules.
 */
export declare namespace cv {
    /** OpenCV Mat (matrix / image buffer). */
    type Mat = _cvType.Mat;
    /** A vector of Mat objects, used for contours. */
    type MatVector = _cvType.MatVector;
    /** A 2D point `{ x, y }`. */
    type Point = _cvType.Point;
    /** An axis-aligned rectangle `{ x, y, width, height }`. */
    type Rect = _cvType.Rect;
    /** A 2D size `{ width, height }`. */
    type Size = _cvType.Size;
    /** A 4-element scalar value, often used for colors `[b, g, r, a]`. */
    type Scalar = _cvType.Scalar;
    /** Adaptive thresholding method constants (e.g., `cv.ADAPTIVE_THRESH_GAUSSIAN_C`). */
    type AdaptiveThresholdTypes = _cvType.AdaptiveThresholdTypes;
    /** Thresholding type constants (e.g., `cv.THRESH_BINARY`). */
    type ThresholdTypes = _cvType.ThresholdTypes;
    /** Line type constants (e.g., `cv.LINE_8`). */
    type LineTypes = _cvType.LineTypes;
    /** Contour retrieval mode constants (e.g., `cv.RETR_EXTERNAL`). */
    type RetrievalModes = _cvType.RetrievalModes;
    /** Contour approximation method constants (e.g., `cv.CHAIN_APPROX_SIMPLE`). */
    type ContourApproximationModes = _cvType.ContourApproximationModes;
    /** Border type constants (e.g., `cv.BORDER_CONSTANT`). */
    type BorderTypes = _cvType.BorderTypes;
    /** Interpolation flag constants (e.g., `cv.INTER_LINEAR`). */
    type InterpolationFlags = _cvType.InterpolationFlags;
    /** Color conversion code constants (e.g., `cv.COLOR_RGBA2GRAY`). */
    type ColorConversionCodes = _cvType.ColorConversionCodes;
    /** Morphological structuring element shape constants (e.g., `cv.MORPH_RECT`). */
    type MorphShapes = _cvType.MorphShapes;
    /** Morphological operation type constants (e.g., `cv.MORPH_GRADIENT`). */
    type MorphTypes = _cvType.MorphTypes;
    /** Integer alias — opencv-js represents `int` as a plain `number`. */
    type int = number;
}
/**
 * Lazy proxy for the OpenCV runtime.
 * Access any OpenCV constant or constructor (e.g. `cv.Mat`, `cv.RETR_EXTERNAL`)
 * through this object. The underlying instance is resolved on first access,
 * so importing this module never throws at module-load time — only when a
 * property is actually accessed before {@link ImageProcessor.initRuntime} has run.
 */
export declare const cv: CV;
export {};
