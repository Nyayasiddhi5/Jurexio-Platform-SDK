import type { DebuggingOptions, DetectionOptions, PaddleOptions, ProcessingEngine, ProcessingOptions, RecognitionOptions, SessionOptions } from "./interface.js";
/** Default debugging options - logging and image dumps disabled. */
export declare const DEFAULT_DEBUGGING_OPTIONS: DebuggingOptions;
/** Default text detection options. */
export declare const DEFAULT_DETECTION_OPTIONS: DetectionOptions;
/** Default text recognition options. */
export declare const DEFAULT_RECOGNITION_OPTIONS: RecognitionOptions;
/**
 * Default `mainThreadYieldMs` applied by the web entry on the main thread
 * (never in workers): one macrotask pause per recognition inference keeps
 * the page painting and handling input while WASM blocks the thread.
 */
export declare const DEFAULT_WEB_MAIN_THREAD_YIELD_MS = 10;
/** Default ONNX Runtime session options. */
export declare const DEFAULT_SESSION_OPTIONS: SessionOptions;
/** Default image processing engine. */
export declare const DEFAULT_PROCESSING_ENGINE: ProcessingEngine;
/** Default image processing options. */
export declare const DEFAULT_PROCESSING_OPTIONS: ProcessingOptions;
/** Default combined options used when no custom config is provided. */
export declare const DEFAULT_PADDLE_OPTIONS: PaddleOptions;
