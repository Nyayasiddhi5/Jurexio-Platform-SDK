/**
 * OpenTelemetry Tracing Middleware for Express
 * Handles request-level tracing with automatic span lifecycle management
 * Reads incoming traceparent/x-trace-id headers and creates root spans
 */

import { Request, Response, NextFunction } from 'express';
import {
  startSpan,
  endSpan,
  setTraceId,
  getTraceId,
  parseTraceparent,
  createTraceparent,
  clearTraceContext,
  Span,
} from '../utils/tracing.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('tracing-middleware');

/**
 * Extend Express Request and Response types to include trace context
 */
declare global {
  namespace Express {
    interface Request {
      traceId?: string;
      spanId?: string;
      span?: Span;
    }
  }
}

/**
 * Express middleware for automatic request tracing
 * - Extracts trace context from incoming headers (traceparent or x-trace-id)
 * - Creates a new trace ID if none exists
 * - Creates a root span for the HTTP request
 * - Attaches span to request object
 * - Ends span on response completion with status code
 * - Sets x-trace-id response header
 * - Logs trace information
 *
 * @param req - Express request object
 * @param res - Express response object
 * @param next - Express next middleware function
 */
export function tracingMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  try {
    // Extract trace context from incoming headers
    let traceContext = null;
    let incomingTraceId = null;

    // Priority 1: Check W3C Trace Context (traceparent header)
    const traceparentHeader = req.get('traceparent');
    if (traceparentHeader) {
      traceContext = parseTraceparent(traceparentHeader);
      if (traceContext) {
        incomingTraceId = traceContext.traceId;
      }
    }

    // Priority 2: Check legacy x-trace-id header
    if (!incomingTraceId) {
      incomingTraceId = req.get('x-trace-id');
    }

    // Set trace ID in context
    if (incomingTraceId) {
      setTraceId(incomingTraceId);
    }

    // Create root span for HTTP request
    const span = startSpan(`http.${req.method.toLowerCase()}`, {
      'http.method': req.method,
      'http.url': req.url,
      'http.scheme': req.protocol,
      'http.host': req.hostname,
      'http.target': req.path,
      'http.client_ip': req.ip || '',
      'http.user_agent': req.get('user-agent') || '',
    });

    // Attach trace context to request
    req.traceId = span.traceId;
    req.spanId = span.spanId;
    req.span = span;

    // Set response header with trace ID
    res.setHeader('x-trace-id', span.traceId);
    res.setHeader('traceparent', createTraceparent(span));

    // Capture response start time for accurate timing
    const startTime = Date.now();

    // Track response completion
    const handleResponseEnd = () => {
      const statusCode = res.statusCode;
      const duration = Date.now() - startTime;

      // Determine span status based on HTTP status code
      const isError = statusCode >= 400;
      const spanStatus = isError ? 'ERROR' : 'OK';
      const errorMsg = isError ? `HTTP ${statusCode}` : undefined;

      // Add HTTP status code to span attributes
      span.attributes['http.status_code'] = statusCode;
      span.attributes['http.response_time_ms'] = duration;

      // End the span
      endSpan(span, spanStatus, errorMsg);

      // Log trace info via structured logger
      logger.info('request.trace', {
        traceId: span.traceId,
        spanId: span.spanId,
        method: req.method,
        url: req.url,
        statusCode,
        duration: `${duration}ms`,
        durationMs: duration,
        status: spanStatus,
        attributes: span.attributes,
      });

      // Clear trace context after request completes
      clearTraceContext();

      // Remove event listener to prevent memory leak
      res.removeListener('finish', handleResponseEnd);
      res.removeListener('close', handleResponseEnd);
    };

    // Listen for response completion
    res.on('finish', handleResponseEnd);
    res.on('close', handleResponseEnd);

    next();
  } catch (error: any) {
    logger.error('tracing middleware error', {
      error: error instanceof Error ? error.message : String(error),
      url: req.url,
      method: req.method,
    });

    next();
  }
}

/**
 * Helper middleware to create child loggers with trace context
 * Useful for passing trace ID through application layers
 */
export function tracingContextMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (req.traceId) {
    // Create a child logger with trace context
    req.logger = logger.child({
      traceId: req.traceId,
      spanId: req.spanId,
    });
  } else {
    req.logger = logger;
  }

  next();
}

/**
 * Utility function to create a child span from an existing request span
 * Useful for tracing operations within request handlers
 *
 * @param req - Express request object
 * @param name - Name of the child span
 * @param attributes - Optional attributes for the span
 * @returns Child span attached to request
 */
export function createChildSpan(
  req: Request,
  name: string,
  attributes?: Record<string, string | number | boolean>
): Span {
  return startSpan(name, attributes, req.span);
}

/**
 * Utility function to end a child span
 * @param span - Span to end
 * @param status - Status of the span (OK or ERROR)
 * @param error - Optional error message
 */
export function endChildSpan(
  span: Span,
  status: 'OK' | 'ERROR' = 'OK',
  error?: string
): void {
  endSpan(span, status, error);
}

/**
 * Wrap an Express route handler with tracing
 * Useful for request handlers that need detailed span tracking
 *
 * @param name - Name of the operation being traced
 * @param handler - Express route handler function
 * @returns Wrapped handler with automatic tracing
 */
export function withRequestTracing(
  name: string,
  handler: (req: Request, res: Response, next: NextFunction) => Promise<void> | void
): (req: Request, res: Response, next: NextFunction) => Promise<void> {
  return async (req: Request, res: Response, next: NextFunction) => {
    const span = createChildSpan(req, name);

    try {
      await Promise.resolve(handler(req, res, next));
      endChildSpan(span, 'OK');
    } catch (error: any) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      endChildSpan(span, 'ERROR', errorMessage);
      next(error);
    }
  };
}

export default tracingMiddleware;
