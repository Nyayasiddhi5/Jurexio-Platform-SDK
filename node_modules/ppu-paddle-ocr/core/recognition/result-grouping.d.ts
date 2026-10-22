import type { RecognitionResult } from "../base-recognition.service.js";
import type { PaddleOcrResult } from "../base-paddle-ocr.service.js";
/**
 * Converts a flat list of recognition results into line-grouped `PaddleOcrResult`.
 *
 * Items within 50% of the running average height are placed on the same line.
 */
export declare function groupRecognitionResultsByLine(recognition: RecognitionResult[]): PaddleOcrResult;
