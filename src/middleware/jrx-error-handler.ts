import { Request, Response, NextFunction } from 'express';
import { createLogger } from '../utils/logger.js';
import { nvMessageEnvelope } from '../config/jrx-message-catalog.js';


const logger = createLogger('error-handler');

export interface AppError extends Error {
  statusCode?: number;
  code?: string;
  details?: any;
}

export function errorHandler(
  err: AppError,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const statusCode = err.statusCode || 500;
  const catalog = nvMessageEnvelope(
    statusCode === 404 ? 'NOT_FOUND' : statusCode >= 500 ? 'INTERNAL_ERROR' : 'BAD_REQUEST',
    process.env.NODE_ENV === 'production' && statusCode >= 500
      ? undefined
      : { overrideMessage: err.message || undefined },
  );
  const message = catalog.error.message;

  logger.error(`[ERROR] ${req.method} ${req.path}:`, {
    message: err.message,
    code: err.code,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });

  res.status(statusCode).json({
    success: false,
    error: {
      message,
      code: err.code ?? catalog.error.code,
      ...(process.env.NODE_ENV === 'development' && { details: err.details })
    },
    timestamp: new Date().toISOString(),
    path: req.path
  });
}

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    ...nvMessageEnvelope('NOT_FOUND'),
    path: req.path
  });
}

export function createError(message: string, statusCode: number = 500, code?: string): AppError {
  const error: AppError = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}
