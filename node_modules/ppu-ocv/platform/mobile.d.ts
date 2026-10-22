/**
 * React Native platform adapter for ppu-ocv, backed by @shopify/react-native-skia.
 *
 * The Skia JS Canvas2D API surface is close enough to the browser's that a
 * thin shim layer is all we need:
 *
 *  - SkiaCanvasLike  wraps an SkSurface and exposes width / height / getContext("2d")
 *  - SkiaContext2DLike bridges Skia's SkCanvas drawing commands to the Context2DLike
 *    interface consumed by CanvasProcessor and CanvasToolkitBase
 *
 * Import requirements:
 *  - @shopify/react-native-skia ≥ 1.0.0 must be installed by the consuming app
 *  - React Native ≥ 0.74 / Expo SDK ≥ 51 (Hermes engine)
 *
 * This file uses a **lazy import** pattern — the Skia module is only resolved at
 * runtime inside mobilePlatform, so bundlers for other entries (Node / browser)
 * never pull Skia code in.
 */
import type { CanvasPlatform } from "../canvas-factory.js";
/** React Native canvas platform backed by @shopify/react-native-skia */
export declare const mobilePlatform: CanvasPlatform;
