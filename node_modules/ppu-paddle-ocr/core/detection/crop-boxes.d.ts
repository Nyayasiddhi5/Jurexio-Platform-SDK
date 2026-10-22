import type { Box, DetectOptions } from "../../interface.js";
import type { CoreCanvas, PlatformProvider } from "../platform.js";
/**
 * Crop each detected box out of the source canvas, optionally saving each
 * crop as `crop_NNN.png` under `options.saveCropsTo` (platforms with a
 * filesystem only) and/or collecting PNG-encoded buffers when `options.crop`.
 *
 * @returns PNG buffers index-aligned with `boxes` (empty when `crop` is unset).
 */
export declare function cropDetectedBoxes(platform: PlatformProvider, canvas: CoreCanvas, boxes: Box[], options: DetectOptions): Promise<ArrayBuffer[]>;
