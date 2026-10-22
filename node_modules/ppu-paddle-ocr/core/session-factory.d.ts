import type { InferenceSession } from "onnxruntime-common";
/** Minimal shape of an ORT namespace capable of creating sessions. */
export type OrtLike = {
    InferenceSession: typeof InferenceSession;
};
/**
 * Create an ORT session, retrying with a CPU/WASM-only provider list if the
 * original attempt fails.
 *
 * Works around cases like `executionProviders: ["cuda", "cpu"]` on a host
 * without the CUDA runtime - ORT throws during session construction instead
 * of silently falling back to CPU. We catch that, log once, and retry with
 * whichever safe provider (`cpu` or `wasm`) was in the original list (or
 * default to `cpu` / `wasm` based on the ORT binding shape).
 *
 * Throws the original error if the provider list was already safe-only.
 */
export declare function createSessionWithFallback(ort: OrtLike, modelData: Uint8Array, sessionOpts: InferenceSession.SessionOptions | undefined, logger: (msg: string) => void, onFallback?: (newOpts: InferenceSession.SessionOptions) => void): Promise<InferenceSession>;
