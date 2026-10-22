/**
 * Maps parsed CLI flags onto the library's option objects. Every flag here has
 * a 1:1 counterpart in `PaddleOptions` / `RecognizeOptions`.
 */
import type { ParseArgsConfig } from "node:util";
import type { BatchRecognizeOptions, PaddleOptions, RecognizeOptions } from "../interface.js";
/** `parseArgs` option spec shared by every command. */
export declare const PARSE_OPTIONS: NonNullable<ParseArgsConfig["options"]>;
/** Shape of `parseArgs().values` for the spec above. */
export type CliValues = Record<string, string | boolean | undefined>;
/**
 * Reads a string-valued flag. Boolean flags are declared separately in the
 * parser's option table, so a value here is either absent or a string.
 */
export declare function str(values: CliValues, key: string): string | undefined;
/** Build the constructor `PaddleOptions` from parsed flags. */
export declare function buildPaddleOptions(values: CliValues): PaddleOptions;
/** Per-call recognize options from parsed flags. */
export declare function buildRecognizeOptions(values: CliValues): RecognizeOptions;
/**
 * Batch options: recognize options plus concurrency. `settle` is part of the
 * return type, not a choice, so the batch commands select the settled overload.
 */
export declare function buildBatchOptions(values: CliValues): BatchRecognizeOptions & {
    settle: true;
};
