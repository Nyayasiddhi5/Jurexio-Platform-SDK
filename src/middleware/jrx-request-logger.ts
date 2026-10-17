import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('http');

/**
 * Express middleware for structured request logging
 * - Generates unique request ID per request
 * - Logs request start and completion with timing
 * - Attaches request ID to response headers
 * - Includes method, URL, status code, and response time
 */
export function requestLogger(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // Generate unique request ID
  const requestId = randomUUID();

  // Attach request ID to request object for use in downstream handlers
  req.requestId = requestId;

  // Attach request ID to response headers
  res.setHeader('x-request-id', requestId);

  // Record the start time
  const startTime = Date.now();

  // Log incoming request
  logger.info('incoming request', {
    requestId,
    method: req.method,
    url: req.url,
    path: req.path,
    query: req.query,
    ip: req.ip,
    userAgent: req.get('user-agent'),
  });

  // Override res.json and res.send to capture status code
  const originalJson = res.json;
  const originalSend = res.send;

  res.json = function (data: any) {
    const responseTime = Date.now() - startTime;
    const statusCode = res.statusCode;

    logger.info('request completed', {
      requestId,
      method: req.method,
      url: req.url,
      statusCode,
      responseTime: `${responseTime}ms`,
      responseTimeMs: responseTime,
    });

    return originalJson.call(this, data);
  };

  res.send = function (data: any) {
    const responseTime = Date.now() - startTime;
    const statusCode = res.statusCode;

    logger.info('request completed', {
      requestId,
      method: req.method,
      url: req.url,
      statusCode,
      responseTime: `${responseTime}ms`,
      responseTimeMs: responseTime,
    });

    return originalSend.call(this, data);
  };

  // Handle when response is closed or finished
  res.on('finish', () => {
    const responseTime = Date.now() - startTime;
    const statusCode = res.statusCode;

    // Only log if we haven't already logged via json/send
    if (!res.headersSent) {
      logger.info('request finished', {
        requestId,
        method: req.method,
        url: req.url,
        statusCode,
        responseTime: `${responseTime}ms`,
        responseTimeMs: responseTime,
      });
    }
  });

  // Handle errors
  res.on('error', (error: Error) => {
    const responseTime = Date.now() - startTime;

    logger.error('request error', {
      requestId,
      method: req.method,
      url: req.url,
      responseTime: `${responseTime}ms`,
      responseTimeMs: responseTime,
      error: error.message,
      stack: error.stack,
    });
  });

  next();
}

/**
 * Express middleware to attach request ID to logger child instances
 * Useful for passing requestId context through the application
 */
export function requestIdMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const requestId = req.requestId || randomUUID();

  // Create a child logger with request ID binding
  req.logger = logger.child({ requestId });

  next();
}

export default requestLogger;
