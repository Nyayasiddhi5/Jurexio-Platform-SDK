/**
 * Canvas <-> ArrayBuffer conversion helpers, shared by `CanvasProcessor`'s
 * static `prepareCanvas` / `prepareBuffer`. Kept separate so the processor
 * class stays focused on the pixel pipeline.
 */
import type { CanvasLike } from "./canvas-factory.js";
/**
 * Convert an ArrayBuffer (image file bytes) or string URI to a CanvasLike. If the value is
 * already a CanvasLike it is returned as-is.
 */
export declare function bufferToCanvas(file: ArrayBuffer | string | CanvasLike): Promise<CanvasLike>;
/**
 * Convert a CanvasLike to an ArrayBuffer (PNG bytes). If the value is already
 * an ArrayBuffer it is returned as-is.
 */
export declare function canvasToBuffer(canvas: CanvasLike): Promise<ArrayBuffer>;
