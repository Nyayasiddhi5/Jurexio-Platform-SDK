/**
 * BIPA §15(b) pre-flight consent gate (task-357).
 *
 * Blocks any biometric-capture route from running unless the data
 * subject has a written-informed-consent record on file in
 * `nv_schema.nv_bipa_consent_records` for the requested biometric
 * identifier.
 *
 * Scope of enforcement:
 *  - Default: BLOCK when the principal is identifiable AS an Illinois
 *    resident — either jurisdiction `IL` / `US-IL` arrives via SDK
 *    context / body / query, or the principal already has at least one
 *    BIPA record on file (granted OR revoked: a previous self-
 *    declaration of IL residency is sticky).
 *  - `NV_BIPA_CONSENT_ENFORCE_ALL=1` extends enforcement to every
 *    request regardless of jurisdiction (recommended for tenants that
 *    cannot reliably pin a US state).
 *  - Anonymous callers (no resolvable userId) are skipped — they
 *    cannot establish IL residency, and unauthenticated probes should
 *    not mint reviewer rows.
 *
 * On block: returns HTTP 403 with code `BIPA_CONSENT_REQUIRED` and a
 * `consent_url` pointing the data subject at the Console grant flow.
 *
 * @module jrx-bipa-consent-gate
 */
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import {
  bipaConsentService,
  type BipaBiometricType,
} from '../services/compliance/jrx-bipa-consent-service.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('./jrx-bipa-consent-gate');

export interface BipaConsentGateOptions {
  /** Biometric identifier the protected route will collect. */
  biometricType: BipaBiometricType;
  /** Stable identifier for the call site (logs + audit). */
  triggeredBy?: string;
  /** Force enforcement regardless of jurisdiction signal. */
  enforceAll?: boolean;
}

function envEnforceAll(): boolean {
  const v = process.env.NV_BIPA_CONSENT_ENFORCE_ALL;
  return v === '1' || v === 'true';
}

/**
 * Single source of truth for "who is this BIPA subject?". Used by the
 * HTTP middleware, the WS capture handler, and the grant/status routes
 * so a record written under one principal is reachable by every check.
 *
 * Resolution order (first non-empty wins):
 *   1. authenticated user (req.user.id / userId / sub)  — JWT path
 *   2. SDK customer-user pinned by the SDK gateway (sdkContext.userId)
 *      or the X-Nv-User-Id header (lets a tenant scope by their end
 *      user for the same API key)
 *   3. SDK application principal (sdkContext.applicationId →
 *      `sdk:app:<id>`) — same string the HTTP gate already produces, so
 *      WS / nv5 / multimodal callers all resolve identically
 *   4. SDK organisation principal (`sdk:org:<id>`)
 *   5. SDK API-key principal (`sdk:key:<id>`)
 *   6. body.userId / query.userId (test harnesses, scripted callers)
 */
export function resolveBipaSubject(req: Request): string | null {
  const u = (req as any).user;
  if (u?.id) return String(u.id);
  if (u?.userId) return String(u.userId);
  if (u?.sub) return String(u.sub);
  const ctx = (req as any).sdkContext;
  if (ctx?.userId) return String(ctx.userId);
  if (ctx?.customerUserId) return String(ctx.customerUserId);
  const customerHdr = req.headers?.['x-jrx-user-id'] as string | undefined;
  if (customerHdr) return String(customerHdr);
  if (ctx?.applicationId) return `sdk:app:${ctx.applicationId}`;
  if (ctx?.organizationId) return `sdk:org:${ctx.organizationId}`;
  if (ctx?.orgId) return `sdk:org:${ctx.orgId}`;
  if (ctx?.apiKeyId) return `sdk:key:${ctx.apiKeyId}`;
  const body = (req as any).body;
  if (body?.userId) return String(body.userId);
  const q = (req as any).query;
  if (q?.userId) return String(q.userId);
  return null;
}

/** Back-compat shim — keep the old name for any in-tree caller. */
function resolveUserId(req: Request): string | null {
  return resolveBipaSubject(req);
}

function looksLikeIllinois(req: Request): boolean {
  const candidates: Array<string | undefined> = [];
  const ctx = (req as any).sdkContext;
  candidates.push(ctx?.jurisdiction, ctx?.usState, ctx?.region);
  const u = (req as any).user;
  candidates.push(u?.jurisdiction, u?.usState, u?.state);
  const body = (req as any).body;
  candidates.push(body?.jurisdiction, body?.usState, body?.state);
  const q = (req as any).query;
  candidates.push(q?.jurisdiction as string | undefined, q?.usState as string | undefined, q?.state as string | undefined);
  candidates.push(req.headers['x-jrx-jurisdiction'] as string | undefined, req.headers['x-jrx-us-state'] as string | undefined);
  for (const c of candidates) {
    if (!c) continue;
    const v = String(c).toUpperCase();
    if (v === 'IL' || v === 'US-IL' || v === 'ILLINOIS' || v.endsWith('/IL') || v.endsWith('-IL')) return true;
  }
  return Boolean((req as any).body?.bipaApplicable);
}

/**
 * Build an Express middleware that pre-flight-checks BIPA §15(b)
 * written consent before handing off to the route handler.
 */
export function bipaConsentGate(opts: BipaConsentGateOptions): RequestHandler {
  const triggeredBy = opts.triggeredBy ?? `bipa-consent-gate:${opts.biometricType}`;
  return async function bipaConsentGateMw(req: Request, res: Response, next: NextFunction): Promise<void> {
    const userId = resolveUserId(req);
    if (!userId) return next();
    let illinois = looksLikeIllinois(req);
    let check: Awaited<ReturnType<typeof bipaConsentService.check>> = { granted: false, status: 'missing', record: null };
    try {
      check = await bipaConsentService.check(userId, opts.biometricType);
    } catch (err: any) {
      logger.warn('bipa_gate_check_failed', { userId, biometricType: opts.biometricType, err: err?.message });
    }
    // Sticky-IL: a prior BIPA record (granted or revoked) means the
    // principal previously self-identified as an IL resident. Treat as
    // in-scope even if the current request omits the jurisdiction hint.
    if (check.record) illinois = true;

    const enforce = opts.enforceAll || envEnforceAll() || illinois;
    if (!enforce) return next();

    if (!check.granted) {
      logger.warn('bipa_consent_blocked', {
        userId,
        biometricType: opts.biometricType,
        status: check.status,
        triggeredBy: `${triggeredBy} ${req.method} ${req.originalUrl ?? req.url}`,
      });
      res.status(403).json({
        success: false,
        error: 'BIPA §15(b) written informed consent required before biometric capture',
        code: 'BIPA_CONSENT_REQUIRED',
        biometricType: opts.biometricType,
        status: check.status,
        policy: 'POL-US-BIPA-740-14-15',
        // The Console SPA mounts wouter under <Router base="/console">
        // (see client/src/App.tsx). The internal route is `/bipa-consent`,
        // so the externally-reachable URL is `/console/bipa-consent` —
        // this string is intentional, do NOT shorten to `/bipa-consent`.
        consent_url: '/console/bipa-consent',
        grant_endpoint: '/api/jrx/bipa/consent/grant',
      });
      return;
    }
    return next();
  };
}

export default bipaConsentGate;
