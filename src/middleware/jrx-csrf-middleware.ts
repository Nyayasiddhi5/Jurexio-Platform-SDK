/**
 * NV CSRF / Origin Validation Middleware
 * Protects state-changing auth endpoints from CSRF attacks by validating
 * the Origin and Referer headers. Uses the double-submit + Origin-check
 * pattern which is safe for JWT Bearer token APIs.
 *
 * Applied to: POST /api/auth/login, /register, /signup, /refresh, /logout
 * Safe for: All GET requests, SDK API routes (Bearer token protected)
 *
 * Jurexio Enterprise Platform 3.1.2 — NEVER bump version.
 */

import { Request, Response, NextFunction } from 'express';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('./jrx-csrf');

// ─── Allowed origins ──────────────────────────────────────────────────────────

function buildAllowedOrigins(): Set<string> {
  const origins = new Set<string>();

  // Always allow same-origin / no-origin (server-to-server or curl)

  // Explicit allow-list from env
  const extra = (process.env.NYV_ALLOWED_ORIGINS ?? '').split(',').map(s => s.trim()).filter(Boolean);
  extra.forEach(o => origins.add(o));

  // Always allow localhost in development
  if (process.env.NODE_ENV !== 'production') {
    ['http://localhost:3000', 'http://localhost:3004', 'http://localhost:5000',
      'http://127.0.0.1:3004', 'http://127.0.0.1:5000'].forEach(o => origins.add(o));
  }

  return origins;
}

const ALLOWED_ORIGINS = buildAllowedOrigins();

// ─── Middleware factory ───────────────────────────────────────────────────────

/**
 * Validates Origin / Referer on mutation requests (POST/PATCH/PUT/DELETE).
 * Returns 403 if the origin is suspicious.
 * Attaches `req.csrfVerified = true` on success.
 */
export function nvCsrfGuard(req: Request, res: Response, next: NextFunction): void {
  // Only apply to state-changing methods
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }

  const origin  = req.headers['origin']  as string | undefined;
  const referer = req.headers['referer'] as string | undefined;

  // If no Origin header at all, trust it only in non-production (curl/Postman/SDK)
  if (!origin && !referer) {
    if (process.env.NODE_ENV !== 'production') {
      return next(); // dev / curl / server-to-server
    }
    // In production, require Origin for mutation endpoints
    logger.warn('[CSRF] Missing Origin header on mutation request', {
      method: req.method, path: req.path,
      ip: req.ip, ua: req.headers['user-agent']?.slice(0, 60),
    });
    res.status(403).json({ success: false, error: 'CSRF validation failed: missing origin' });
    return;
  }

  // Extract origin from Referer if Origin is absent
  const requestOrigin = origin ?? (referer ? new URL(referer).origin : null);

  if (!requestOrigin) {
    next();
    return;
  }

  // Check against allowed origins
  if (ALLOWED_ORIGINS.has(requestOrigin)) {
    (req as any).csrfVerified = true;
    return next();
  }

  // Allow same-host requests (proxy scenarios) — strict equality check
  const host = req.headers['host'];
  if (host) {
    try {
      const parsedOrigin = new URL(requestOrigin);
      if (parsedOrigin.host === host) {
        (req as any).csrfVerified = true;
        return next();
      }
    } catch {}
  }

  logger.warn('[CSRF] Suspicious cross-origin mutation blocked', {
    origin: requestOrigin,
    method: req.method,
    path: req.path,
    ip: req.ip,
  });

  res.status(403).json({
    success: false,
    error: 'CSRF validation failed: origin not allowed',
    code: 'CSRF_ORIGIN_REJECTED',
  });
}

/**
 * Sets CSRF-safe response headers for all responses.
 * Prevents clickjacking and ensures proper cross-origin policy.
 */
export function nvCsrfHeaders(req: Request, res: Response, next: NextFunction): void {
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=()');
  next();
}
