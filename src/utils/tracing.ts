/**
 * OpenTelemetry Tracing Stubs for Jurexio Enterprise Platform
 * Lightweight span tracking without external OTel SDK dependencies
 * Compatible with standard OTel format for future migration
 */

import { randomUUID } from 'crypto';
import { createLogger } from './logger.js';
import { maybeExportSpan } from './jrx-otlp-exporter.js';

const logger = createLogger('tracing');

// ================================================================================================
// TYPES & INTERFACES
// ================================================================================================

export interface SpanAttributes {
  [key: string]: string | number | boolean | undefined;
}

export interface Span {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  attributes: SpanAttributes;
  status: 'UNSET' | 'OK' | 'ERROR';
  error?: string;
}

export interface TraceContext {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
}

// ================================================================================================
// CONSTANTS
// ================================================================================================

export const TRACE_HEADER = 'x-trace-id';
export const TRACEPARENT_HEADER = 'traceparent';

// Context storage for async operations
const contextStorage = new Map<string, TraceContext>();
let currentTraceId: string | null = null;

// ================================================================================================
// CORE TRACING FUNCTIONS
// ================================================================================================

/**
 * Start a new span with given name and optional attributes
 * @param name - Name of the span (follows OTel naming conventions)
 * @param attributes - Optional attributes to attach to the span
 * @param parentSpan - Optional parent span for hierarchy
 * @returns Span object with trace/span IDs and metadata
 */
export function startSpan(
  name: string,
  attributes?: SpanAttributes,
  parentSpan?: Span
): Span {
  const traceId = currentTraceId || randomUUID();
  const spanId = randomUUID();
  const parentSpanId = parentSpan?.spanId;
  const startTime = Date.now();

  const span: Span = {
    traceId,
    spanId,
    parentSpanId,
    name,
    startTime,
    attributes: attributes || {},
    status: 'UNSET',
  };

  // Update current trace ID
  if (!currentTraceId) {
    currentTraceId = traceId;
  }

  if (process.env.NODE_ENV !== 'production') {
    logger.debug(`[SPAN START] ${name}`, {
      spanId: span.spanId.substring(0, 8),
      traceId: span.traceId.substring(0, 8),
      parentSpanId: span.parentSpanId?.substring(0, 8),
      attributes,
    });
  }

  return span;
}

/**
 * End a span and record its duration
 * @param span - Span to end
 * @param status - Final status of the span (OK or ERROR)
 * @param error - Optional error message if status is ERROR
 */
export function endSpan(
  span: Span,
  status: 'OK' | 'ERROR' = 'OK',
  error?: string
): void {
  const endTime = Date.now();
  const duration = endTime - span.startTime;

  span.endTime = endTime;
  span.duration = duration;
  span.status = status;
  if (error) {
    span.error = error;
  }

  if (process.env.NODE_ENV === 'production') {
    // Production: structured JSON log compatible with OTel format
    const traceData = {
      resourceSpans: [
        {
          resource: {
            attributes: {
              'service.name': 'nyayavigya',
              'service.version': process.env.SERVICE_VERSION || '1.0.0',
            },
          },
          scopeSpans: [
            {
              scope: {
                name: 'nyayavigya-tracer',
                version: '1.0.0',
              },
              spans: [
                {
                  traceId: span.traceId,
                  spanId: span.spanId,
                  parentSpanId: span.parentSpanId,
                  name: span.name,
                  kind: 1, // INTERNAL
                  startTimeUnixNano: span.startTime * 1_000_000,
                  endTimeUnixNano: endTime * 1_000_000,
                  attributes: span.attributes,
                  status: {
                    code: status === 'OK' ? 0 : 2, // 0=OK, 2=ERROR
                    message: error || '',
                  },
                  droppedAttributesCount: 0,
                  droppedEventsCount: 0,
                  droppedLinksCount: 0,
                },
              ],
            },
          ],
        },
      ],
    };

    logger.info('trace', traceData);
  } else {
    // Development: human-readable trace info
    logger.debug(`[SPAN END] ${span.name}`, {
      spanId: span.spanId.substring(0, 8),
      traceId: span.traceId.substring(0, 8),
      duration: `${duration}ms`,
      status,
      error,
      attributes: span.attributes,
    });
  }

  // NV-OTEL-GENAI-001 — export every finished span (LLM and generic) to an
  // OTLP/HTTP collector when one is configured, through this single path so a
  // span is never exported twice. No-op when OTLP export is disabled. Spans
  // carrying gen_ai.* attributes are outbound LLM calls (kind=CLIENT); all
  // others are INTERNAL.
  const isLlmSpan = 'gen_ai.system' in span.attributes;
  maybeExportSpan({
    traceId: span.traceId,
    spanId: span.spanId,
    parentSpanId: span.parentSpanId,
    name: span.name,
    startTime: span.startTime,
    endTime: span.endTime,
    attributes: span.attributes,
    status: span.status,
    error: span.error,
    kind: isLlmSpan ? 5 : 1,
  });
}

/**
 * Wrap an async function in a span, automatically managing span lifecycle
 * @param name - Name of the span
 * @param fn - Async function to wrap
 * @param attributes - Optional attributes to attach to the span
 * @param parentSpan - Optional parent span for hierarchy
 * @returns Result of the wrapped function
 */
export async function withSpan<T>(
  name: string,
  fn: () => Promise<T>,
  attributes?: SpanAttributes,
  parentSpan?: Span
): Promise<T> {
  const span = startSpan(name, attributes, parentSpan);

  try {
    const result = await fn();
    endSpan(span, 'OK');
    return result;
  } catch (error: any) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    endSpan(span, 'ERROR', errorMessage);
    throw error;
  }
}

/**
 * Get the current trace ID from context
 * @returns Current trace ID or null if not set
 */
export function getTraceId(): string | null {
  return currentTraceId;
}

/**
 * Set the trace ID for the current context
 * Useful when receiving trace context from incoming requests
 * @param traceId - Trace ID to set
 */
export function setTraceId(traceId: string): void {
  currentTraceId = traceId;
}

/**
 * Clear the current trace ID and context
 * Should be called at the end of a request lifecycle
 */
export function clearTraceContext(): void {
  currentTraceId = null;
  contextStorage.clear();
}

/**
 * Parse traceparent header in W3C Trace Context format
 * Format: version-traceId-parentId-traceFlags
 * Example: 00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01
 * @param traceparent - Traceparent header value
 * @returns Parsed trace context or null if invalid
 */
export function parseTraceparent(traceparent: string): TraceContext | null {
  try {
    const parts = traceparent.split('-');
    if (parts.length !== 4) {
      return null;
    }

    const [version, traceId, parentSpanId, traceFlags] = parts;

    // Validate version (00 is current)
    if (version !== '00') {
      return null;
    }

    // Validate trace ID format (32 hex characters)
    if (!/^[0-9a-f]{32}$/.test(traceId)) {
      return null;
    }

    // Validate parent span ID format (16 hex characters)
    if (!/^[0-9a-f]{16}$/.test(parentSpanId)) {
      return null;
    }

    return {
      traceId,
      spanId: randomUUID(),
      parentSpanId: parentSpanId === '0000000000000000' ? undefined : parentSpanId,
    };
  } catch {
    return null;
  }
}

/**
 * Create traceparent header value from span
 * @param span - Span to create header from
 * @returns Formatted traceparent header value
 */
export function createTraceparent(span: Span): string {
  // Convert UUID to trace format (32 hex chars)
  const traceIdHex = span.traceId.replace(/-/g, '').substring(0, 32).padEnd(32, '0');
  // Convert spanId to trace format (16 hex chars)
  const spanIdHex = span.spanId.replace(/-/g, '').substring(0, 16).padEnd(16, '0');
  const traceFlags = '01'; // Trace recorded

  return `00-${traceIdHex}-${spanIdHex}-${traceFlags}`;
}

/**
 * Get the current trace context
 * @returns Current trace context or null
 */
export function getTraceContext(): TraceContext | null {
  if (!currentTraceId) {
    return null;
  }

  return {
    traceId: currentTraceId,
    spanId: randomUUID(),
  };
}

export default {
  startSpan,
  endSpan,
  withSpan,
  getTraceId,
  setTraceId,
  clearTraceContext,
  parseTraceparent,
  createTraceparent,
  getTraceContext,
  TRACE_HEADER,
  TRACEPARENT_HEADER,
};
