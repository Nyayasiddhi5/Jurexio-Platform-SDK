/**
 * Jurexio Enterprise Platform — Canonical SDK API-Key Auth Header
 * NV-AUTH-HEADER-001 (2026-05-10)
 *
 * Single source of truth for SDK API-key extraction across the entire
 * platform. Every middleware/route that authenticates an external SDK
 * caller MUST use `extractSdkApiKey(req)` from this file. Inventing a
 * new accepted header (`X-NV-SDK-Key`, `X-SDK-Key`, `X-NYV-Key`, etc.)
 * is a guardrail violation enforced by `scripts/jrx-check-auth-header-discipline.sh`.
 *
 * Canonical contract:
 *   - Primary header  : `X-API-Key: <raw-sdk-key>`
 *   - Fallback header : `Authorization: Bearer <raw-sdk-key>`
 *
 * Inter-service east-west traffic uses a separate `X-NV-API-Key` header
 * handled exclusively by `src/middleware/jrx-inter-service-auth.ts`. Do
 * NOT mix the two concerns.
 */

import type { Request } from 'express';
import { nvMessageEnvelope } from '../config/jrx-message-catalog.js';

/** Canonical HTTP header name for SDK API-key auth (case-insensitive in HTTP). */
export const SDK_AUTH_HEADER = 'X-API-Key' as const;

/** Lowercase form, matching `req.headers[…]` key normalization in Node/Express. */
export const SDK_AUTH_HEADER_LC = 'x-api-key' as const;

/** Bearer-token fallback header name. */
export const SDK_AUTH_BEARER_HEADER = 'Authorization' as const;

/**
 * True when a Bearer credential is an SDK API key (nyv_*), not a Console JWT.
 * Used by dualSdkOrJwt so JWT Bearers are not mis-routed through sdkGatewayAuth.
 * NV-CONSOLE-JWT-DUAL-001.
 */
export function isSdkBearerCredential(token: string): boolean {
  const t = token.trim();
  if (!t) return false;
  if (t.startsWith('nyv_')) return true;
  if (t.startsWith('eyJ')) return false;
  if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(t)) return false;
  return false;
}

/**
 * Extract a raw SDK API key from an incoming request.
 *
 * Lookup order (first match wins):
 *   1. `X-API-Key: <key>`
 *   2. `Authorization: Bearer <key>`
 *
 * Returns the trimmed raw key, or `null` if no key is present.
 *
 * IMPORTANT: never accept the key from `req.query` for SDK auth — query
 * params leak into access logs, proxy logs, browser history, and CDNs.
 * Routes that legitimately need a query-param fallback (e.g. signed
 * one-shot download URLs) must wrap this helper and add their own
 * narrowly-scoped param check, not modify this contract.
 */
export function extractSdkApiKey(req: Request): string | null {
  const xApiKey = req.headers[SDK_AUTH_HEADER_LC];
  if (typeof xApiKey === 'string' && xApiKey.trim()) {
    return xApiKey.trim();
  }

  const authHeader = req.headers.authorization;
  if (typeof authHeader === 'string') {
    const parts = authHeader.split(/\s+/);
    if (parts.length === 2 && parts[0].toLowerCase() === 'bearer' && parts[1].trim()) {
      return parts[1].trim();
    }
  }

  return null;
}

/**
 * Standard 401 payload used by every SDK auth middleware when the API key
 * is missing. Co-located here so the error message stays in lock-step
 * with the accepted header set.
 */
export const SDK_AUTH_KEY_MISSING_RESPONSE = nvMessageEnvelope('API_KEY_MISSING');
