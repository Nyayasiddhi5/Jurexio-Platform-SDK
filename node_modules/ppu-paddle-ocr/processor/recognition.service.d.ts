import type * as ort from "onnxruntime-node";
import { BaseRecognitionService } from "../core/base-recognition.service.js";
import type { RecognitionResult } from "../core/base-recognition.service.js";
import type { DebuggingOptions, ProcessingEngine, RecognitionOptions } from "../interface.js";
export type { RecognitionResult };
/**
 * Service for detecting and recognizing text in images using Node.js implementation
 */
export declare class RecognitionService extends BaseRecognitionService {
    /**
     * Creates a Node recognition service bound to a loaded ONNX session.
     *
     * @param session - Loaded ONNX recognition model session.
     * @param options - Recognition tuning options.
     * @param debugging - Logging and image-dump options.
     * @param engine - Image processing engine; falls back to `canvas-native` when OpenCV is unavailable.
     */
    constructor(session: ort.InferenceSession, options?: Partial<RecognitionOptions>, debugging?: Partial<DebuggingOptions>, engine?: ProcessingEngine);
}
