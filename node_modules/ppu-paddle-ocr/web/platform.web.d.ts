import * as ort from "onnxruntime-web";
import type { CanvasOps, CoreCanvas, PlatformProvider } from "../core/platform.js";
/**
 * True inside a Web Worker: dedicated, shared, or a Manifest V3 service worker.
 *
 * `WorkerGlobalScope` exists only in worker scopes, never on a page and never in
 * Node/Bun/Deno. `window` is the mirror image of it: absent in workers, which is
 * why probing for `window` alone reads a worker as a server runtime.
 */
export declare function isWebWorker(): boolean;
/**
 * Point ONNX Runtime at a CDN copy of its WASM binaries to avoid 404s on CDN or
 * unbundled usage. Applies to pages and workers alike; an explicit
 * `ort.env.wasm.wasmPaths` set by the host app always wins.
 *
 * Runs once on import. Exported so the environment probe stays testable.
 */
export declare function applyDefaultWasmPaths(): void;
/** True when `navigator.gpu` is present and at least one adapter is available. */
export declare function isWebGpuAvailable(): Promise<boolean>;
/** Returns `["webgpu", "wasm"]` when WebGPU is available, otherwise `["wasm"]`. */
export declare function getDefaultWebExecutionProviders(): Promise<ort.InferenceSession.SessionOptions["executionProviders"]>;
export declare class WebPlatformProvider implements PlatformProvider<CoreCanvas> {
    readonly pathSeparator = "/";
    readonly ort: PlatformProvider["ort"];
    createCanvas(width: number, height: number): CoreCanvas;
    isCanvas(image: unknown): image is CoreCanvas;
    loadResource(source: string | ArrayBuffer | undefined, defaultUrl: string): Promise<ArrayBuffer>;
    saveDebugImage(_canvas: CoreCanvas, _filename: string, _outputDir: string): Promise<void>;
    readonly canvas: CanvasOps<CoreCanvas>;
}
