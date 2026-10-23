/**
 * NV-LONG-AI-HTTP-TIMEOUT-001 — do not cut partner long AI HTTP paths early.
 *
 * NSP owns lawyer-facing copy; JRX must keep the socket open through Queen /
 * orchestrate / doc-analyze budgets (ALB/nginx 600s class). Applies per-request
 * socket timeouts on long AI routes only (health/metrics stay default).
 */

import type { Request, Response, NextFunction } from 'express';
import { NV_TIMEOUTS } from '../config/jrx-timeout-policy.js';

function longAiTimeoutMs(): number {
  const n = Number(process.env.JRX_HTTP_LONG_AI_TIMEOUT_MS);
  if (Number.isFinite(n) && n >= 60_000) {
    return Math.min(600_000, Math.floor(n));
  }
  return NV_TIMEOUTS.edgeHttpMs;
}

const LONG_AI_PATH =
  /^\/api\/nv\/(?:orchestrate|orchestration|stream|legal-chat|legal-work|doc-analyze|documents\/analyze|v1\/sdk\/(?:docs-pipeline|patra-mitra|intelligence)|matter-vault\/matters\/[^/]+\/run-playbook)/;

export function isLongAiHttpPath(path: string): boolean {
  return LONG_AI_PATH.test(path);
}

export function nvLongAiHttpTimeoutMiddleware() {
  const ms = longAiTimeoutMs();
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!isLongAiHttpPath(req.path)) {
      next();
      return;
    }
    req.setTimeout(ms);
    res.setTimeout(ms);
    next();
  };
}

/** Gateway http.Server — align with edge 600s (env JRX_HTTP_SERVER_TIMEOUT_MS). */
export function applyGatewayHttpServerTimeouts(server: import('http').Server): void {
  const ms = longAiTimeoutMs();
  server.requestTimeout = ms;
  server.headersTimeout = ms + 10_000;
  server.keepAliveTimeout = Math.min(ms, 620_000);
}
