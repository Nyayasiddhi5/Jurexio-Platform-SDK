/**
 * NV-COMPLETION-DRIVEN-001 — optional stages must not hold the critical path
 * after the useful result is already in.
 *
 * Timeouts are upper bounds for *hung required* work. They are not the event
 * that moves the request to the next stage. Pattern: required completes →
 * proceed immediately; optional gets a short grace, then abort / degrade.
 */

export type RequestPhase =
  | 'accepted'
  | 'grounding'
  | 'generating'
  | 'enriching'
  | 'ready'
  | 'degraded'
  | 'failed_infra';

function envMs(name: string, fallback: number, min: number, max: number): number {
  const n = Number(process.env[name]);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

/** Grace after first useful optional result before aborting hangers (ms). */
export const OPTIONAL_STAGE_GRACE_MS = envMs('NYV_OPTIONAL_STAGE_GRACE_MS', 200, 50, 2_000);

/** Skip starting CoT when the Queen wall has less than this remaining. */
export const COT_MIN_REMAINING_MS = envMs('NYV_COT_MIN_REMAINING_MS', 8_000, 1_000, 60_000);

export async function settleOptional<T>(
  promise: Promise<T>,
  graceMs: number = OPTIONAL_STAGE_GRACE_MS,
): Promise<{ timedOut: boolean; value?: T }> {
  let finished = false;
  const wrapped = promise.then(
    (value) => {
      finished = true;
      return { timedOut: false as const, value };
    },
    () => {
      finished = true;
      return { timedOut: true as const };
    },
  );
  const grace = new Promise<{ timedOut: true }>((resolve) => {
    setTimeout(() => resolve({ timedOut: true }), Math.max(0, graceMs));
  });
  const winner = await Promise.race([wrapped, grace]);
  if (!winner.timedOut) return winner;
  if (finished) return wrapped;
  return { timedOut: true };
}

export function setRequestPhase(
  target: { __requestPhase?: RequestPhase },
  phase: RequestPhase,
): void {
  target.__requestPhase = phase;
}

/** A promise whose settled state can be read synchronously. */
export interface SettledTracker<T> {
  readonly promise: Promise<T>;
  readonly state: { done: boolean; value?: T };
}

/**
 * Wrap a promise so callers can read whether it has settled without awaiting it.
 *
 * Needed by `proceedOnFirstUseful`: after an early release the caller must use
 * whatever arrived and ignore what did not, which is impossible with a bare
 * `Promise.all`. The rejection is swallowed on the tracking branch only — the
 * returned promise still rejects for anyone who awaits it — so abandoning a
 * failed source cannot surface as an unhandled rejection and take the process
 * down mid-request.
 */
export function trackSettled<T>(promise: Promise<T>): SettledTracker<T> {
  const state: { done: boolean; value?: T } = { done: false };
  const tracked = promise.then(
    (value) => {
      state.done = true;
      state.value = value;
      return value;
    },
    (err) => {
      state.done = true;
      throw err;
    },
  );
  void tracked.catch(() => {
    /* observed by the caller via state.done; see doc comment */
  });
  return { promise: tracked, state };
}

/** Never settles. Used to withhold a non-useful result from a `race`. */
const NEVER: Promise<never> = new Promise<never>(() => {
  /* intentionally pending */
});

/**
 * Resolve when either every source has settled, or one source produced a
 * *useful* result and the others have had `graceMs` to catch up.
 *
 * Why usefulness and not first-settle: a source that returns "nothing found" in
 * 20 ms would win a plain `Promise.race`, and releasing on that would cut the
 * only source that was actually going to produce grounding down to the grace
 * window. So a non-useful result withholds itself from the race and the caller
 * keeps waiting on the hard cap, which is the honest behaviour — no useful
 * output means there is nothing to progress *to* yet.
 */
export async function proceedOnFirstUseful(
  sources: Array<{ promise: Promise<unknown>; isUseful: (value: unknown) => boolean }>,
  graceMs: number = OPTIONAL_STAGE_GRACE_MS,
): Promise<{ releasedEarly: boolean }> {
  if (sources.length === 0) return { releasedEarly: false };
  const all = Promise.allSettled(sources.map((s) => s.promise)).then(() => undefined);
  const firstUseful = Promise.race(
    sources.map((s) =>
      s.promise.then(
        (value) => (s.isUseful(value) ? (value as unknown) : NEVER),
        () => NEVER,
      ),
    ),
  );
  let releasedEarly = false;
  await Promise.race([
    all,
    firstUseful.then(
      () =>
        new Promise<void>((resolve) => {
          setTimeout(() => {
            releasedEarly = true;
            resolve();
          }, Math.max(0, graceMs));
        }),
    ),
  ]);
  return { releasedEarly };
}

export function isTerminalSuccessPhase(phase: RequestPhase | undefined): boolean {
  return phase === 'ready' || phase === 'degraded';
}

/**
 * NV-STEP0-OBSERVABILITY-001 — process-level counters for Step-0 grounding.
 *
 * Why counters and not just a log line: `proceedOnFirstUseful` only logs when it
 * releases early, so a healthy platform logs nothing and `grep -c` returns 0. That
 * zero is ambiguous between "never needed" (correct) and "never reached" (a wiring
 * defect), and the two demand opposite responses. Counting both outcomes turns 0
 * into `0 / N`, which is falsifiable.
 *
 * Deliberately in-process and unbounded-free (plain integers, no labels, no
 * cardinality): this is a diagnostic ratio, not billing, and it must not become
 * another thing that can fail a request.
 */
export interface Step0Counters {
  /** Both sources settled within the window — the mechanism was not needed. */
  bothSettled: number;
  /** One source was useful and a sibling was still pending — the mechanism fired. */
  releasedEarly: number;
  /** Neither source produced anything useful — the hard cap governed. */
  neitherUseful: number;
  /** Step-0 ran at all. If this stays 0, the stage is not being reached. */
  observed: number;
}

const step0Counters: Step0Counters = {
  bothSettled: 0,
  releasedEarly: 0,
  neitherUseful: 0,
  observed: 0,
};

export function recordStep0Outcome(o: {
  releasedEarly: boolean;
  ragSettled: boolean;
  memSettled: boolean;
  ragUseful: boolean;
  memUseful: boolean;
}): void {
  step0Counters.observed += 1;
  if (o.releasedEarly && !(o.ragSettled && o.memSettled)) {
    step0Counters.releasedEarly += 1;
  } else if (!o.ragUseful && !o.memUseful) {
    step0Counters.neitherUseful += 1;
  } else {
    step0Counters.bothSettled += 1;
  }
}

export function getStep0Counters(): Step0Counters {
  return { ...step0Counters };
}

/** Test-only reset so counters do not leak across cases. */
export function __resetStep0CountersForTest(): void {
  step0Counters.bothSettled = 0;
  step0Counters.releasedEarly = 0;
  step0Counters.neitherUseful = 0;
  step0Counters.observed = 0;
}
