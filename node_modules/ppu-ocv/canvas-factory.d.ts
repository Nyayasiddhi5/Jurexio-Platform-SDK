/**
 * Platform abstraction layer for canvas operations.
 * Allows ppu-ocv to work with both @napi-rs/canvas (Node) and browser canvas APIs.
 */
/** Structural type satisfied by both @napi-rs/canvas Canvas and HTMLCanvasElement/OffscreenCanvas. */
export type CanvasLike = {
    /** Canvas width in pixels. */
    width: number;
    /** Canvas height in pixels. */
    height: number;
    /** Return a 2D rendering context for drawing on the canvas. */
    getContext(contextId: "2d"): any;
    /** Serialize the canvas to a binary buffer (Node-side `@napi-rs/canvas`). Absent on browser canvases. */
    toBuffer?: (...args: any[]) => Buffer;
    toDataURL?: (...args: any[]) => string;
    /** Asynchronously serialize to a `Blob` via callback (browser `HTMLCanvasElement`). */
    toBlob?: (callback: (blob: Blob | null) => void, type?: string, quality?: number) => void;
    /** Asynchronously serialize to a `Blob` (`OffscreenCanvas`, used in workers and extensions). */
    convertToBlob?: (options?: {
        type?: string;
        quality?: number;
    }) => Promise<Blob>;
};
/** Structural type for 2D rendering context, matching the cross-runtime subset used by ppu-ocv. */
export type Context2DLike = {
    /** The canvas this context is bound to. */
    canvas: any;
    /** Draw an image, canvas, or bitmap onto the context. Signature follows the standard Canvas2D `drawImage`. */
    drawImage(...args: any[]): void;
    /** Read raw RGBA pixel data from a rectangular region of the canvas. */
    getImageData(sx: number, sy: number, sw: number, sh: number): {
        data: Uint8ClampedArray;
        width: number;
        height: number;
    };
    /** Write raw RGBA pixel data back to the canvas at `(dx, dy)`. */
    putImageData(imageData: any, dx: number, dy: number): void;
    /** Allocate a blank `ImageData` of the given size. */
    createImageData(width: number, height: number): any;
    /** Start a new path for stroke/fill commands. */
    beginPath(): void;
    /** Close the current sub-path by connecting the last point to the first. */
    closePath(): void;
    /** Move the path cursor to `(x, y)` without drawing. */
    moveTo(x: number, y: number): void;
    /** Draw a straight line from the current path point to `(x, y)`. */
    lineTo(x: number, y: number): void;
    /** Stroke the current path with the current `strokeStyle` and `lineWidth`. */
    stroke(): void;
    /** Stroke an axis-aligned rectangle outline. */
    strokeRect(x: number, y: number, w: number, h: number): void;
    /** Color, gradient, or pattern used by `stroke` and `strokeRect`. */
    strokeStyle: string | CanvasGradient | CanvasPattern;
    /** Width in pixels of the line drawn by `stroke` / `strokeRect`. */
    lineWidth: number;
    /** Color, gradient, or pattern used by `fill` and `fillRect`. */
    fillStyle: string | CanvasGradient | CanvasPattern;
    /** Fill an axis-aligned rectangle with the current `fillStyle`. */
    fillRect(x: number, y: number, w: number, h: number): void;
    /** Save the current drawing state (transform, styles) onto the state stack. */
    save(): void;
    /** Restore the most recently saved drawing state. */
    restore(): void;
    /** Translate the coordinate system by `(x, y)`. */
    translate(x: number, y: number): void;
    /** Rotate the coordinate system clockwise by `angle` radians. */
    rotate(angle: number): void;
};
/** Platform-specific canvas operations. Each runtime entry point registers an implementation via {@link setPlatform}. */
export type CanvasPlatform = {
    /** Create a blank canvas of the given width and height. */
    createCanvas(width: number, height: number): CanvasLike;
    /** Decode an image from a buffer or URL and draw it onto a fresh canvas. */
    loadImage(source: ArrayBuffer | string): Promise<CanvasLike>;
    /** Type guard for "is this value a canvas of this platform?". */
    isCanvas(value: unknown): value is CanvasLike;
};
/** Register the platform-specific canvas implementation */
export declare function setPlatform(platform: CanvasPlatform): void;
/** Get the registered platform. Throws if none has been set. */
export declare function getPlatform(): CanvasPlatform;
/**
 * Structural ("duck-typed") canvas check, independent of the registered
 * platform. A value is canvas-like if it exposes `width`/`height` numbers and a
 * `getContext` function — true for both `@napi-rs/canvas` (Node) and browser
 * `HTMLCanvasElement`/`OffscreenCanvas`.
 *
 * Unlike {@link CanvasPlatform.isCanvas}, this does not depend on which platform
 * is globally registered, so it stays correct when the Node and web entry
 * points are loaded in the same process (e.g. a dual-target test suite).
 */
export declare function isCanvasLike(value: unknown): value is CanvasLike;
