/**
 * MCP Utilities
 * Helper functions for error normalization and type safety
 */

/**
 * Normalize error to ensure we always have a message
 */
export function normalizeError(error: unknown): { message: string; code?: string } {
  if (error instanceof Error) {
    return {
      message: error.message,
      code: (error as any).code,
    };
  }

  if (typeof error === 'string') {
    return { message: error };
  }

  if (error && typeof error === 'object' && 'message' in error) {
    return {
      message: String(error.message),
      code: 'code' in error ? String(error.code) : undefined,
    };
  }

  return { message: 'Unknown error occurred' };
}

/**
 * Safe JSON stringify that handles circular references
 */
export function safeStringify(obj: any): string {
  const seen = new WeakSet();
  return JSON.stringify(obj, (key, value) => {
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) {
        return '[Circular]';
      }
      seen.add(value);
    }
    return value;
  });
}

/**
 * Create ISO timestamp string
 */
export function createTimestamp(): string {
  return new Date().toISOString();
}
