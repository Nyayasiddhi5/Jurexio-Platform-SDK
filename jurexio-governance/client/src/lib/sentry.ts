/**
 * Sentry Client-Side Integration
 * 
 * Features:
 * - Frontend error tracking
 * - React error boundary integration
 * - Performance monitoring
 * - User session tracking
 * - Breadcrumbs for debugging
 */

import * as Sentry from '@sentry/react';

/**
 * Initialize Sentry for React frontend
 */
export function initializeSentry() {
  const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN;
  const ENVIRONMENT = import.meta.env.MODE || 'development';
  
  if (!SENTRY_DSN) {
    console.log('[Sentry] No DSN configured - frontend monitoring disabled');
    return;
  }

  Sentry.init({
    dsn: SENTRY_DSN,
    environment: ENVIRONMENT,
    
    // Performance Monitoring
    tracesSampleRate: ENVIRONMENT === 'production' ? 0.1 : 1.0, // 10% in production
    
    // Session Replay (optional - captures user sessions for debugging)
    replaysSessionSampleRate: 0.1, // 10% of sessions
    replaysOnErrorSampleRate: 1.0, // 100% of sessions with errors
    
    integrations: [
      // Session replay for debugging
      Sentry.replayIntegration({
        maskAllText: true, // Mask all text for privacy
        blockAllMedia: true, // Block all media for privacy
      }),
    ],
    
    // Release tracking (use package.json version or default)
    release: '1.0.0',
    
    // Error filtering
    beforeSend(event, hint) {
      // Filter out known benign errors
      const error = hint?.originalException;
      
      // Filter out network errors (often user-caused)
      if (error && error.toString().includes('NetworkError')) {
        return null;
      }
      
      // Filter out expected errors
      if (event.tags?.expected === 'true') {
        return null;
      }
      
      return event;
    },
    
    // Ignore certain errors
    ignoreErrors: [
      // Browser extensions
      'top.GLOBALS',
      'chrome-extension://',
      'moz-extension://',
      
      // Random plugins/extensions
      'Script error.',
      
      // Network errors
      'Network request failed',
      'Failed to fetch',
      'NetworkError',
    ],
    
    // Deny URLs (don't capture errors from these)
    denyUrls: [
      // Browser extensions
      /extensions\//i,
      /^chrome:\/\//i,
      /^moz-extension:\/\//i,
    ],
  });

  console.log(`[Sentry] Frontend initialized for environment: ${ENVIRONMENT}`);
}

/**
 * Set user context for Sentry
 */
export function setSentryUser(userId: string, userData?: { email?: string; username?: string }) {
  Sentry.setUser({
    id: userId,
    ...userData,
  });
}

/**
 * Clear user context (on logout)
 */
export function clearSentryUser() {
  Sentry.setUser(null);
}

/**
 * Add custom context to Sentry events
 */
export function setSentryContext(key: string, data: Record<string, any>) {
  Sentry.setContext(key, data);
}

/**
 * Add tags to Sentry events
 */
export function setSentryTags(tags: Record<string, string>) {
  Sentry.setTags(tags);
}

/**
 * Manually capture an exception
 */
export function captureException(error: Error, context?: Record<string, any>) {
  if (context) {
    Sentry.withScope((scope) => {
      Object.entries(context).forEach(([key, value]) => {
        scope.setContext(key, value);
      });
      Sentry.captureException(error);
    });
  } else {
    Sentry.captureException(error);
  }
}

/**
 * Manually capture a message
 */
export function captureMessage(message: string, level: Sentry.SeverityLevel = 'info') {
  Sentry.captureMessage(message, level);
}

/**
 * Add breadcrumb for debugging
 */
export function addBreadcrumb(message: string, data?: Record<string, any>) {
  Sentry.addBreadcrumb({
    message,
    data,
    level: 'info',
  });
}

/**
 * Start an inactive performance span.
 *
 * NV-SENTRY-V10-SPAN-001 (2026-08-19) — this called `Sentry.startTransaction`, which was
 * REMOVED in Sentry SDK v8; the installed version is v10.47, where the property is
 * `undefined` at runtime. So this helper would have thrown "Sentry.startTransaction is not a
 * function" the moment anything called it. Nothing did, which is the only reason it went
 * unnoticed — it was dead code hiding a real breakage.
 *
 * It surfaced only after the server type gate stopped aborting the guardrail chain at step 1,
 * which had been masking every client type error behind it.
 *
 * `startInactiveSpan` is the v10 equivalent for a span the caller ends explicitly (the old
 * transaction semantics). Prefer `Sentry.startSpan(...)` with a callback for new code, since
 * it closes the span automatically.
 */
export function startTransaction(name: string, op: string) {
  return Sentry.startInactiveSpan({ name, op });
}

/**
 * Wrapper for async functions with error capture
 */
export function withSentry<T extends (...args: any[]) => Promise<any>>(fn: T): T {
  return (async (...args: Parameters<T>) => {
    try {
      return await fn(...args);
    } catch (error) {
      if (error instanceof Error) {
        captureException(error, {
          function: fn.name,
          args,
        });
      }
      throw error;
    }
  }) as T;
}

/**
 * React Error Boundary component
 */
export const ErrorBoundary = Sentry.ErrorBoundary;

/**
 * Profiler component for performance monitoring
 */
export const Profiler = Sentry.Profiler;

/**
 * withProfiler HOC for component performance monitoring
 */
export const withProfiler = Sentry.withProfiler;

// Export Sentry instance for advanced usage
export { Sentry };
