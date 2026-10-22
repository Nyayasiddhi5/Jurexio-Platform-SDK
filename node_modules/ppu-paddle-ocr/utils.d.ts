/**
 * Deep merges multiple objects into the target object.
 * Arrays are overwritten, not concatenated.
 *
 * @param target The target object to merge into.
 * @param sources The source objects to merge from.
 * @returns The merged target object.
 */
export declare function deepMerge<T extends Record<string, unknown>>(target: T, ...sources: Partial<T>[]): T;
export declare function levenshteinDistance(a: string, b: string): number;
/**
 * Fetches a URL as an `ArrayBuffer` with a per-attempt deadline and bounded
 * retries. Each attempt is aborted after `timeoutMs` (covering both the
 * response headers and the body download), so a stalled connection fails fast
 * and is retried instead of hanging indefinitely.
 *
 * @param url - Resource to download.
 * @param options - `timeoutMs` per-attempt deadline (default 300 000 ms / 5 min) and
 *   `retries` additional attempts after the first (default 2).
 * @returns The downloaded bytes.
 * @throws If every attempt fails (network error, timeout, or non-2xx response).
 */
export declare function fetchArrayBufferWithRetry(url: string, options?: {
    timeoutMs?: number;
    retries?: number;
}): Promise<ArrayBuffer>;
/** Parse a PaddleOCR dictionary into an ordered array. Handles LF/CRLF; preserves blank entries. */
export declare function parseDictionary(source: ArrayBuffer | Uint8Array | string): string[];
/**
 * Checks if a value is a plain object.
 *
 * @param item The value to check.
 * @returns True if the value is a plain object, false otherwise.
 */
export declare function isObject(item: unknown): item is Record<string, unknown>;
