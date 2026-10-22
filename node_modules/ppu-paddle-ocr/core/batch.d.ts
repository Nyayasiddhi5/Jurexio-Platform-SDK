/**
 * Bounded-concurrency orchestration used by `batchRecognize` /
 * `batchRecognizeStream`. Kept platform-agnostic and free of any OCR types so
 * it can be unit-tested in isolation.
 */
/** A single settled batch item, tagged with its input index. */
export type BatchItemResult<T> = {
    index: number;
    status: "fulfilled";
    value: T;
} | {
    index: number;
    status: "rejected";
    reason: unknown;
};
/** Controls how {@link runPool} schedules and settles work. */
export type RunPoolOptions = {
    /** Maximum number of tasks in flight at once. Clamped to >= 1. */
    concurrency: number;
    /** When `true`, per-item rejections are reported instead of aborting the run. */
    settle: boolean;
    /** Cancels scheduling of further items; the run rejects with an `AbortError`. */
    signal?: AbortSignal;
    /** Invoked after each item settles, with the running done count and total (if known). */
    onProgress?: (done: number, total: number | undefined) => void;
    /** Total item count when the input length is known up front. */
    total?: number;
};
/**
 * Run `task` over `inputs` with at most `concurrency` tasks in flight,
 * invoking `onSettle` as each item finishes (in completion order, each tagged
 * with its input index for reordering).
 *
 * Resolves once every item has settled. With `settle: false` it rejects on the
 * first task error after halting further scheduling; with `settle: true` every
 * item is delivered to `onSettle` and the run only rejects on abort. Honors
 * `signal` by ceasing to schedule new items (in-flight tasks are not forcibly
 * cancelled, but their results are dropped).
 */
export declare function runPool<I, O>(inputs: Iterable<I> | AsyncIterable<I>, options: RunPoolOptions, task: (item: I, index: number) => Promise<O>, onSettle: (result: BatchItemResult<O>) => void): Promise<void>;
/** Producer handle plus the consumer's drain, for {@link createAsyncQueue}. */
export type AsyncQueue<T> = {
    push: (item: T) => void;
    close: () => void;
    fail: (error: unknown) => void;
    drain: () => AsyncGenerator<T>;
};
/**
 * A minimal single-consumer async queue: producers `push` settled items, the
 * consumer drains them as an async iterable. Bridges {@link runPool}'s callback
 * model to `batchRecognizeStream`'s generator.
 */
export declare function createAsyncQueue<T>(): AsyncQueue<T>;
