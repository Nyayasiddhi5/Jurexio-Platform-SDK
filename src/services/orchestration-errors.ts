export interface ProviderErrorContext {
  correlationId?: string;
  model?: string;
  statusCode?: number;
  upstreamError?: unknown;
  [key: string]: unknown;
}

export class ProviderError extends Error {
  public readonly provider: string;
  public readonly context: ProviderErrorContext;
  public readonly correlationId?: string;
  public readonly statusCode?: number;
  public readonly retryable: boolean;

  constructor(message: string, provider: string = 'unknown', context: ProviderErrorContext = {}) {
    super(message);
    this.name = 'ProviderError';
    this.provider = provider;
    this.context = context;
    this.correlationId = context.correlationId;
    this.statusCode = context.statusCode;
    this.retryable = (context.statusCode ?? 0) >= 500 || context.statusCode === 429;
    Object.setPrototypeOf(this, ProviderError.prototype);
  }
}

export class TimeoutError extends Error {
  constructor(message = 'Operation timed out', public readonly timeoutMs?: number) {
    super(message);
    this.name = 'TimeoutError';
    Object.setPrototypeOf(this, TimeoutError.prototype);
  }
}

export class RateLimitError extends ProviderError {
  constructor(message: string, provider: string, context: ProviderErrorContext = {}) {
    super(message, provider, { ...context, statusCode: context.statusCode ?? 429 });
    this.name = 'RateLimitError';
    Object.setPrototypeOf(this, RateLimitError.prototype);
  }
}

export class ValidationError extends Error {
  constructor(message: string, public readonly field?: string) {
    super(message);
    this.name = 'ValidationError';
    Object.setPrototypeOf(this, ValidationError.prototype);
  }
}

export class OrchestrationError extends Error {
  constructor(message: string, public readonly context?: Record<string, unknown>) {
    super(message);
    this.name = 'OrchestrationError';
    Object.setPrototypeOf(this, OrchestrationError.prototype);
  }
}
