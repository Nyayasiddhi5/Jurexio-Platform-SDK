import type * as ort from "onnxruntime-web";
import { BaseRecognitionService } from "../core/base-recognition.service.js";
import type { RecognitionResult } from "../core/base-recognition.service.js";
import type { DebuggingOptions, RecognitionOptions } from "../interface.js";
export type { RecognitionResult };
/**
 * Applies the web main-thread default for `mainThreadYieldMs`: one macrotask
 * pause per recognition inference keeps the page painting while WASM blocks
 * the thread. Workers have no UI to yield to and keep the shared default (0),
 * and an explicit caller value - including 0 - always wins.
 *
 * Exported so the main-thread/worker branch stays testable outside a browser.
 */
export declare function withMainThreadYieldDefault(options: Partial<RecognitionOptions>, onMainThread?: boolean): Partial<RecognitionOptions>;
/**
 * Service for detecting and recognizing text in images using Web implementation.
 * Web always uses canvas-native engine (no OpenCV available in browser).
 */
export declare class RecognitionService extends BaseRecognitionService {
    /**
     * Creates a web recognition service bound to a loaded ONNX session.
     *
     * @param session - Loaded ONNX recognition model session (`onnxruntime-web`).
     * @param options - Recognition tuning options.
     * @param debugging - Logging and image-dump options.
     */
    constructor(session: ort.InferenceSession, options?: Partial<RecognitionOptions>, debugging?: Partial<DebuggingOptions>);
}
