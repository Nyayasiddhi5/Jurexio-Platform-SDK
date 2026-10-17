/**
 * Shared shim for /api/nv5/* sub-routers (Session-10 Batch B+).
 *
 * `requireSdkKey`: re-exports canonical full SDK validator `sdkGatewayAuth`
 * from `src/middleware/jrx-sdk-gateway.ts` (DB-backed key verification +
 * scope checks + tenant binding). NV-AUTH-HEADER-001 honored —
 * `sdkGatewayAuth` internally uses `extractSdkApiKey` from
 * `src/middleware/jrx-sdk-auth-header.ts` for header parsing.
 *
 * `delegateTo`: proxies the current request into a canonical router
 * mounted elsewhere (e.g. jrx-sdk-multimodal-voice-routes,
 * jrx-voice-ws-routes). This is how Batch B keeps NV-LLM-001 / NV-ARCH-001:
 * the canonical chain is the ONE place provider calls happen, traversing
 * the safety ring; nv5 routes are thin auth+rename wrappers.
 *
 * Auth semantics for delegated paths (post-2026-05-10 review):
 *   - Multimodal canonical (jrx-sdk-multimodal-voice-routes) auths via
 *     `sdkGatewayAuth` — strict SDK-key only.
 *   - Voice canonical (jrx-voice-ws-routes) auths via `requireSdkOrJwt` —
 *     SDK key OR session JWT. The /api/nv5/voice/* surface therefore
 *     INHERITS the SDK-OR-JWT semantics by design (intentional: voice
 *     streaming clients sometimes connect with a session JWT after the
 *     initial SDK handshake). If a future caller needs strict-SDK-only
 *     for nv5 voice, layer `requireSdkKey` on the delegated handler.
 *
 * Underscore prefix keeps this file out of any route discovery walker.
 */
export { sdkGatewayAuth as requireSdkKey } from '../../middleware/sdk-gateway.js';

import type { Request, Response, NextFunction, RequestHandler, Router } from 'express';
import { sdkGatewayAuth } from '../../middleware/sdk-gateway.js';
import { extractSdkApiKey } from '../../middleware/jrx-sdk-auth-header.js';
import { sendApiError } from '../../utils/jrx-api-error.js';

/**
 * Strict SDK-key-only middleware (Session-10 Batch C, post-architect-review).
 *
 * `requireSdkKey` (= `sdkGatewayAuth`) includes a `tryJwtBypass` branch that
 * accepts a session JWT when no SDK key is present — useful for downstream
 * mixed-auth flows but inappropriate for endpoints that contractually
 * require SDK-key semantics (workflow + doc-AI lifecycle per task-100.md
 * step 5). `requireSdkKeyStrict` rejects with 401 BEFORE delegating when
 * `extractSdkApiKey` returns null, so the JWT-bypass branch in
 * `sdkGatewayAuth` is provably unreachable from these routes. After the
 * strict pre-check we still delegate to `sdkGatewayAuth` for the canonical
 * DB-backed key validation + scope check + tenant binding.
 */
export const requireSdkKeyStrict: RequestHandler = (req, res, next) => {
  const key = extractSdkApiKey(req);
  if (!key) {
    sendApiError(res, 'API_KEY_MISSING');
    return;
  }
  return sdkGatewayAuth(req, res, next);
};

/**
 * SDK-key-only auth: rejects JWT-shaped Bearer tokens (3 dot-separated
 * base64url segments) BEFORE delegating to the gateway. Used by the
 * Session-10 Batch D `/api/nv5/gov/*` admin endpoints to close the
 * "Bearer-fallback could carry a JWT and bypass SDK-key validation"
 * concern raised in architect review (2026-05-10).
 *
 * The canonical SDK key format is an opaque token (UUID-ish, 32+ chars,
 * no embedded dots). A token containing exactly 2 dots and 3 non-empty
 * base64url-shaped segments is rejected as 401 BEARER_NOT_SDK_KEY.
 * X-API-Key callers pass through unchanged.
 */
const JWT_SHAPE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
export const requireSdkKeyOnly: RequestHandler = (req, res, next) => {
  const key = extractSdkApiKey(req);
  if (!key) {
    sendApiError(res, 'API_KEY_MISSING');
    return;
  }
  if (JWT_SHAPE.test(key)) {
    sendApiError(res, 'BEARER_NOT_SDK_KEY');
    return;
  }
  return sdkGatewayAuth(req, res, next);
};

/**
 * Scope-gate for nv5 sub-routes. Mirrors the inline `hasScope` helper used
 * throughout `src/routes/jrx-sdk-*-routes.ts` (canonical pattern, NOT a new
 * scope vocabulary): wildcards `*` and `all` bypass; otherwise the literal
 * scope name must be present in the SDK app key's `scopes` array. Place
 * AFTER `requireSdkKeyStrict` in the handler chain so `req.sdkContext` /
 * `req.sdkAppContext` is populated.
 *
 * Use for the Session-10 Batch D `/api/nv5/gov/*` admin endpoints — the
 * required scope is `admin`, which super-admin-minted keys satisfy via
 * the wildcard `*` they receive at provisioning time
 * (`src/routes/jrx-sdk-provision-routes.ts` line 385).
 */
export function requireScope(required: string): RequestHandler {
  return (req, res, next) => {
    const ctx = (req as unknown as { sdkContext?: { scopes?: string[] }; sdkAppContext?: { scopes?: string[] } });
    const scopes = ctx.sdkContext?.scopes ?? ctx.sdkAppContext?.scopes ?? [];
    if (scopes.includes('*') || scopes.includes('all') || scopes.includes(required)) {
      return next();
    }
    sendApiError(res, 'INSUFFICIENT_SCOPE', {
      overrideMessage: `Required scope: ${required}`,
    });
  };
}

/**
 * Production-safe error responder — see src/utils/jrx-api-error.ts (NV-MSG-001).
 */
export { safeError } from '../../utils/jrx-api-error.js';

/**
 * Delegate the current request to a canonical Router by rewriting `req.url`
 * to `toUrl` and invoking that router as middleware. The canonical router
 * runs its own auth + safety-ring chain.
 *
 * Hardening (2026-05-10 pass-3): the original `req.url` is captured and
 * restored after the canonical router calls `next()` (only path — when the
 * canonical chain matches and writes a response, `next` is never invoked
 * so restoration is unnecessary; when it does not match, restoring the
 * URL ensures upstream Express stack sees the original path).
 */
export function delegateTo(canonical: Router, toUrl: string): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const originalUrl = req.url;
    req.url = toUrl;
    return canonical(req, res, (err?: unknown) => {
      req.url = originalUrl;
      next(err);
    });
  };
}
