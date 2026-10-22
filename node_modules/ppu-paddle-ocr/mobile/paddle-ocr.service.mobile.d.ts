import type { CanvasLike } from "ppu-ocv/canvas-mobile";
import type { FlattenedPaddleOcrResult, PaddleOcrResult } from "../core/base-paddle-ocr.service.js";
import { BasePaddleOcrService } from "../core/base-paddle-ocr.service.js";
import type { PaddleOptions, RecognizeOptions } from "../interface.js";
export type { FlattenedPaddleOcrResult, PaddleOcrResult };
/**
 * PaddleOcrService for React Native (iOS / Android) environments.
 * Uses `onnxruntime-react-native` and `ppu-ocv/canvas-mobile` (Skia) instead of
 * their Node or Web counterparts.
 */
export declare class PaddleOcrService extends BasePaddleOcrService {
    /**
     * Creates a mobile PaddleOcrService instance.
     * @param options - Configuration options for the service.
     */
    constructor(options?: PaddleOptions);
    /**
     * Creates the detection and recognition ONNX sessions from the configured
     * models using `onnxruntime-react-native`.
     */
    protected initSessions(): Promise<void>;
    /**
     * Loads a resource from a URL string, or the default URL.
     */
    private _loadResource;
    /** Resolve execution providers, defaulting to CPU when none are supplied. */
    private _resolveSessionExecutionProviders;
    /** Create an ORT session, silently falling back to CPU if the preferred providers fail. */
    private _createSession;
    /**
     * Initialize the OCR service by loading models and the character dictionary.
     *
     * Must be called before `recognize()`.
     */
    initialize(): Promise<void>;
    /**
     * Returns `true` once both detection and recognition sessions are loaded.
     */
    isInitialized(): boolean;
    /**
     * Swaps the detection model at runtime, releasing the previous session.
     * @param model - ONNX detection model as a buffer, file path, or URL.
     */
    changeDetectionModel(model: ArrayBuffer | string): Promise<void>;
    /**
     * Swaps the recognition model at runtime, releasing the previous session.
     * @param model - ONNX recognition model as a buffer, file path, or URL.
     */
    changeRecognitionModel(model: ArrayBuffer | string): Promise<void>;
    /**
     * Replaces the character dictionary used to decode recognition output.
     * @param dictionary - Dictionary as a buffer, file path, or URL.
     */
    changeTextDictionary(dictionary: ArrayBuffer | string): Promise<void>;
    /**
     * Run the full OCR pipeline (detection → recognition) on an image.
     * @param image - Source image as an `ArrayBuffer` or Skia canvas.
     * @param options - Per-call options such as `flatten` and `strategy`.
     * @returns Grouped or flattened OCR results depending on `options.flatten`.
     */
    recognize(image: ArrayBuffer | CanvasLike, options: RecognizeOptions & {
        flatten: true;
    }): Promise<FlattenedPaddleOcrResult>;
    /**
     * Run the full OCR pipeline (detection → recognition) on an image.
     * @param image - Source image as an `ArrayBuffer` or Skia canvas.
     * @param options - Per-call options; omit `flatten` for line-grouped results.
     * @returns OCR results grouped by line.
     */
    recognize(image: ArrayBuffer | CanvasLike, options?: RecognizeOptions & {
        flatten?: false;
    }): Promise<PaddleOcrResult>;
    /**
     * Release all ONNX sessions and free resources.
     */
    destroy(): Promise<void>;
}
export default PaddleOcrService;
