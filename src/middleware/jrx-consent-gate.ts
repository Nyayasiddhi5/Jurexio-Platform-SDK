/**
 * DPDPA pre-flight consent gate middleware (Task #217).
 *
 * Wraps high-risk personal-data routes (orchestration, document
 * analysis, third-party sharing, biometric) with a call to
 * `consentManagementService.checkConsent(...)` BEFORE the handler
 * runs. The service writes a `nv_cam_actions` reviewer-queue row
 * (framework=`dpdpa`) when a breach is detected — so unlawful
 * processing now produces a real CAM signal, not just a probe via
 * `/consent/check`.
 *
 * Behaviour:
 *  - Default = OBSERVATION mode: never blocks the request, only emits
 *    the breach row + structured warn log. Mirrors the firewall
 *    observation-then-enforcement pattern already used in the
 *    platform.
 *  - Set `NV_DPDPA_CONSENT_ENFORCE=1` (or pass `{ enforce: true }`)
 *    to switch to enforcement: a breach returns HTTP 403 with code
 *    `DPDPA_CONSENT_BREACH` and the request never reaches the
 *    handler.
 *  - Anonymous callers (no resolvable userId) are skipped — they
 *    can't "breach" their own consent and we don't want to mint
 *    anonymous CAM rows on every public health probe.
 *
 * Identity resolution order: `req.user.id` / `req.user.userId` →
 * `req.sdkContext.userId` → `req.body.userId` → `req.query.userId`.
 * Org id is resolved similarly (user.orgId → sdkContext.organizationId
 * / orgId → body.tenantId/orgId).
 *
 * @module nv-consent-gate
 */
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import crypto from 'crypto';
import {
  consentManagementService,
  type ConsentPurpose,
} from '../services/consent-management-service.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('./jrx-consent-gate');

export interface ConsentGateOptions {
  /** DPDPA purpose to check against (e.g. `ai_processing`). */
  purpose: ConsentPurpose;
  /**
   * If true, breaches return HTTP 403. If false (default), the
   * request continues and the breach is only recorded in the CAM
   * reviewer queue + logs. Env override: NV_DPDPA_CONSENT_ENFORCE=1.
   */
  enforce?: boolean;
  /**
   * Stable identifier for the call site, recorded on the CAM row so
   * reviewers can see *which route* triggered the breach. Defaults
   * to "consent-gate".
   */
  triggeredBy?: string;
}

function envEnforce(): boolean {
  const v = process.env.NV_DPDPA_CONSENT_ENFORCE;
  return v === '1' || v === 'true';
}

/**
 * Resolve a principal id for the consent check. Order:
 *   1. Real end-user id (req.user.id / userId, sdkContext.userId,
 *      body.userId, query.userId)
 *   2. SDK principal — when an SDK key calls on behalf of an org but
 *      no end-user id is present (the common case for the
 *      sdk-doc-pipeline + nsp shared-docs paths). Synthesised as
 *      `sdk:app:<applicationId>` or `sdk:org:<organizationId>`. The
 *      DPDPA fiduciary IS the SDK customer org, so this is the
 *      correct principal for the breach record — and crucially it
 *      means the gate ACTUALLY RUNS instead of silently no-op'ing
 *      on every SDK call.
 *   3. NSP shared-docs body — `nsp:org:<body.orgId>` (the nvClientAuth
 *      middleware doesn't populate req.user; the body always carries
 *      orgId per the route contract).
 *   4. null → caller is truly anonymous (e.g. health probe), skip.
 */
function resolveUserId(req: Request): string | null {
  // ── Trusted principals first ────────────────────────────────────
  // Order matters: we MUST consult middleware-populated identity
  // (req.user from JWT, req.sdkContext from the SDK gateway) before
  // any client-controlled body/query field. Otherwise an SDK caller
  // could spoof userId in the body and shift the breach record off
  // their real org principal — defeating the purpose of the gate
  // in enforce mode and corrupting the CAM audit trail in
  // observation mode.
  const u = (req as any).user;
  if (u?.id) return String(u.id);
  if (u?.userId) return String(u.userId);
  const ctx = (req as any).sdkContext;
  if (ctx?.userId) return String(ctx.userId);
  // ── SDK principal fallback (still trusted: set by gateway) ─────
  // Two SDK-context shapes exist in this codebase:
  //   (a) sdk-gateway shape: { applicationId, organizationId, apiKeyId, jurisdiction }
  //       — used by sdk-doc-pipeline + most v5 SDK routes.
  //   (b) doc-sharing shape: { platformCode, orgId, keyId, userId }
  //       — used by nv-doc-sharing-routes (third-party sharing flow).
  if (ctx?.applicationId) return `sdk:app:${ctx.applicationId}`;
  if (ctx?.organizationId) return `sdk:org:${ctx.organizationId}`;
  if (ctx?.apiKeyId) return `sdk:key:${ctx.apiKeyId}`;
  if (ctx?.orgId && ctx?.platformCode) return `sdk:${ctx.platformCode}:org:${ctx.orgId}`;
  if (ctx?.orgId) return `sdk:org:${ctx.orgId}`;
  if (ctx?.keyId) return `sdk:key:${ctx.keyId}`;
  if (ctx?.platformCode) return `sdk:platform:${ctx.platformCode}`;
  // ── Client-controlled fallbacks (lowest trust, only when no auth
  // context populated identity at all — e.g. NSP shared-docs which
  // uses a header-based shared secret and never sets req.user) ────
  const body = (req as any).body;
  if (body?.userId) return String(body.userId);
  const q = (req as any).query;
  if (q?.userId) return String(q.userId);
  if (body?.orgId) return `nsp:org:${body.orgId}`;
  return null;
}

function resolveOrgId(req: Request): string | undefined {
  const u = (req as any).user;
  if (u?.orgId) return String(u.orgId);
  if (u?.organizationId) return String(u.organizationId);
  if (u?.tenantId) return String(u.tenantId);
  const ctx = (req as any).sdkContext;
  if (ctx?.organizationId) return String(ctx.organizationId);
  if (ctx?.orgId) return String(ctx.orgId);
  const body = (req as any).body;
  if (body?.tenantId) return String(body.tenantId);
  if (body?.orgId) return String(body.orgId);
  return undefined;
}

function resolveJurisdiction(req: Request): string | undefined {
  const ctx = (req as any).sdkContext;
  if (ctx?.jurisdiction) return String(ctx.jurisdiction);
  const body = (req as any).body;
  if (body?.jurisdiction) return String(body.jurisdiction);
  const q = (req as any).query;
  if (q?.jurisdiction) return String(q.jurisdiction);
  return undefined;
}

/**
 * Build an Express middleware that pre-flight-checks consent for
 * `purpose` before handing off to the route handler.
 */
export function consentGate(opts: ConsentGateOptions): RequestHandler {
  const enforce = opts.enforce ?? false;
  const triggeredBy = opts.triggeredBy ?? `consent-gate:${opts.purpose}`;
  return async function consentGateMw(req: Request, res: Response, next: NextFunction): Promise<void> {
    const userId = resolveUserId(req);
    if (!userId) {
      // No identity → nothing to check. Skip silently to avoid
      // CAM-row noise on public/health/anonymous traffic.
      return next();
    }
    const orgId = resolveOrgId(req);
    const jurisdiction = resolveJurisdiction(req);
    const requestId =
      (req.headers['x-request-id'] as string | undefined) ??
      (req as any).requestId ??
      crypto.randomUUID();
    try {
      const result = await consentManagementService.checkConsent(userId, opts.purpose, {
        orgId,
        jurisdiction,
        attemptedUse: true,
        requestId,
        triggeredBy: `${triggeredBy} ${req.method} ${req.originalUrl ?? req.url}`,
      });
      if (!result.granted && (enforce || envEnforce())) {
        res.status(403).json({
          success: false,
          error: 'DPDPA consent required for this operation',
          code: 'DPDPA_CONSENT_BREACH',
          purpose: opts.purpose,
          status: result.status,
          legalBasis: result.legalBasis,
        });
        return;
      }
      // Observation mode (default): proceed even on breach. The CAM
      // row + warn log have already been emitted inside checkConsent.
      return next();
    } catch (err: any) {
      // Never let a consent-check failure break the request — log
      // and continue. NV-OWNERSHIP-001: we own this layer; failures
      // here are a monitoring concern, not a 5xx for the caller.
      logger.warn('consent_gate_check_failed', {
        userId, purpose: opts.purpose, err: err?.message,
      });
      return next();
    }
  };
}

export default consentGate;
