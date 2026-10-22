import type { CoreCanvas } from "../platform.js";
import type { RecognitionContext } from "./strategies.js";
/**
 * Recognizes many crops with width-bucketed batched inference: crops are
 * sorted by width, chunked into `recBatchSize` groups, right-padded to each
 * chunk's max width, and stacked into one `[N, 3, H, W]` tensor per chunk -
 * one `session.run` per chunk instead of per crop. Results come back in the
 * caller's original crop order.
 *
 * Falls back to per-crop tensors when the loaded model's batch dimension is
 * fixed (`recBatchSize` is treated as 1 then by the caller) - padding is
 * tensor-space zeros, matching upstream PaddleOCR's `padding_im`.
 */
export declare function recognizeCropsBatched(crops: CoreCanvas[], ctx: RecognitionContext, charactersDictionary?: string[]): Promise<Array<{
    text: string;
    confidence: number;
    positions: number[];
}>>;
/**
 * True when the loaded recognition session accepts a dynamic batch dimension.
 * Fixed-batch models (some custom exports) must stay on the per-crop path.
 */
export declare function supportsDynamicBatch(session: {
    inputMetadata?: unknown;
}): boolean;
