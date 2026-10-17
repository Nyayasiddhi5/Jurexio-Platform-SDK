import { randomUUID } from 'node:crypto';

export const generateCorrelationId = (): string =>
  `corr-${Date.now()}-${randomUUID().substring(0, 8)}`;

export interface TimeoutController {
  signal: AbortSignal;
  cancel: () => void;
  timeoutMs: number;
}

export const createTimeoutController = (timeoutMs: number): TimeoutController => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`Timeout after ${timeoutMs}ms`)), timeoutMs);
  return {
    signal: controller.signal,
    cancel: () => clearTimeout(timer),
    timeoutMs,
  };
};

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export const withTimeout = async <T>(
  promise: Promise<T>,
  timeoutMs: number,
  errorMessage = `Operation timed out after ${timeoutMs}ms`,
): Promise<T> => {
  const ctrl = createTimeoutController(timeoutMs);
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        ctrl.signal.addEventListener('abort', () => reject(new Error(errorMessage)));
      }),
    ]);
  } finally {
    ctrl.cancel();
  }
};
