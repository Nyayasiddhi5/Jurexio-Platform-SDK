import type { Tensor } from "onnxruntime-common";
import type { Box, DebuggingOptions, RecognitionOptions } from "../../interface.js";
import type { CoreCanvas, PlatformProvider } from "../platform.js";
import type { RecognitionResult } from "../base-recognition.service.js";
/** Minimal context passed from `BaseRecognitionService` into strategy helpers. */
export type RecognitionContext = {
    platform: PlatformProvider;
    options: RecognitionOptions;
    debugging: DebuggingOptions;
    engine: "opencv" | "canvas-native";
    runInference: (inputTensor: Tensor) => Promise<Tensor>;
};
/**
 * Rotates a crop 90 degrees counter-clockwise when it is markedly taller than
 * wide (height/width >= 1.5, upstream PaddleOCR's convention via np.rot90):
 * vertical text lines become horizontal for the recognition model without
 * needing an orientation-classifier model. Controlled by
 * `recognition.rotateVerticalCrops`.
 */
export declare function rotateTallCropIfNeeded(crop: CoreCanvas, ctx: RecognitionContext): CoreCanvas;
/**
 * Per-box strategy: recognize each detected box individually.
 */
export declare function runPerBoxStrategy(sourceCanvas: CoreCanvas, validBoxes: Array<{
    box: Box;
    index: number;
}>, ctx: RecognitionContext, processBox: (canvas: CoreCanvas, box: Box, index: number, total: number, debugPath: string, dict?: string[]) => Promise<RecognitionResult | null>, charactersDictionary?: string[]): Promise<RecognitionResult[]>;
/**
 * Per-line strategy: merge same-line boxes and recognize per line.
 */
export declare function runLineStrategy(sourceCanvas: CoreCanvas, validBoxes: Array<{
    box: Box;
    index: number;
}>, ctx: RecognitionContext, charactersDictionary?: string[]): Promise<RecognitionResult[]>;
/**
 * Cross-line strategy: bin-pack line crops by width to minimize inference count.
 */
export declare function runCrossLineStrategy(sourceCanvas: CoreCanvas, validBoxes: Array<{
    box: Box;
    index: number;
}>, ctx: RecognitionContext, charactersDictionary?: string[]): Promise<RecognitionResult[]>;
