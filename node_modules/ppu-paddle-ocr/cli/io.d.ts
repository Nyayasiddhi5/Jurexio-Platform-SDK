/** A non-zero-exit error carrying the intended process exit code. */
export declare class CliError extends Error {
    readonly code: number;
    constructor(message: string, code?: number);
}
/** Throw a usage error (exit code 2). */
export declare function usageError(message: string): never;
/**
 * Resolve a CLI image argument to an `ArrayBuffer`. The Node `recognize()`
 * accepts only `ArrayBuffer`/`Canvas`, so URLs are fetched here and files read
 * from disk - which also sidesteps the SDK's absolute-path-only string rule.
 */
export declare function loadImageInput(arg: string): Promise<ArrayBuffer>;
/** True if a non-URL path is missing on disk. URLs are assumed reachable. */
export declare function isMissingLocalFile(arg: string): boolean;
/**
 * Expand positional patterns into a concrete list. Glob patterns are resolved
 * against the filesystem; plain paths and URLs pass through verbatim so a typo
 * surfaces as a clear "No such file" later instead of silently vanishing.
 */
export declare function expandPatterns(patterns: string[]): string[];
/** Walk up from this module to the nearest `ppu-paddle-ocr` package.json. */
export declare function readVersion(): string;
/** Write `content` to a file (with trailing newline) or to stdout. */
export declare function writeOutput(content: string, outputPath?: string): void;
/** Log a line to stderr unless quiet. */
export declare function logStderr(message: string, quiet: boolean): void;
