import * as ort from "onnxruntime-react-native";
import type { CanvasOps, CoreCanvas, PlatformProvider } from "../core/platform.js";
/**
 * Default execution providers for React Native.
 *
 * `onnxruntime-react-native` runs on CPU by default; NNAPI (Android) and CoreML
 * (iOS) can be opted into via `session.executionProviders`. WebGPU is not
 * available on React Native.
 */
export declare function getDefaultMobileExecutionProviders(): ort.InferenceSession.SessionOptions["executionProviders"];
export declare class MobilePlatformProvider implements PlatformProvider<CoreCanvas> {
    readonly pathSeparator = "/";
    readonly ort: PlatformProvider["ort"];
    createCanvas(width: number, height: number): CoreCanvas;
    isCanvas(image: unknown): image is CoreCanvas;
    loadResource(source: string | ArrayBuffer | undefined, defaultUrl: string): Promise<ArrayBuffer>;
    saveDebugImage(_canvas: CoreCanvas, _filename: string, _outputDir: string): Promise<void>;
    readonly canvas: CanvasOps<CoreCanvas>;
}
