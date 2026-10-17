/**
 * NYV Error Utilities — typed error extraction helpers
 * Eliminates `catch (error: any)` patterns across the codebase.
 *
 * GUARDRAIL: All catch blocks MUST use extractErrorMessage() or extractError().
 * Never use `(error as any).message` — use these helpers instead.
 *
 * @file src/types/errors.ts
 */

/**
 * Extracts a human-readable message from any thrown value.
 * Handles Error instances, strings, objects with .message, and unknown shapes.
 */
export function extractErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  if (typeof e === 'object' && e !== null && 'message' in e) {
    const msg = (e as { message: unknown }).message;
    return typeof msg === 'string' ? msg : String(msg);
  }
  return String(e);
}

/**
 * Extracts a structured error object from any thrown value.
 * Returns { message, stack, code, status } where available.
 */
export function extractError(e: unknown): {
  message: string;
  stack?: string;
  code?: string;
  status?: number;
} {
  if (e instanceof Error) {
    return {
      message: e.message,
      stack: e.stack,
      code: (e as NodeJS.ErrnoException).code,
      status: (e as { status?: number }).status,
    };
  }
  return { message: extractErrorMessage(e) };
}

/**
 * Type predicate — narrows unknown error to Error instance.
 */
export function isErrorInstance(e: unknown): e is Error {
  return e instanceof Error;
}

/**
 * Creates a standardised HTTP error response payload.
 */
export function toErrorPayload(e: unknown, fallback = 'An unexpected error occurred'): {
  error: string;
  code?: string;
} {
  const { message, code } = extractError(e);
  return { error: message || fallback, ...(code ? { code } : {}) };
}
