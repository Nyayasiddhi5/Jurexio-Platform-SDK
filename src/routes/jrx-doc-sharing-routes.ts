/**
 * NYV Document Sharing Routes — SDK-facing grant lifecycle + admin probe.
 * ─────────────────────────────────────────────────────────────────────────────
 * SDK routes (under /api/jrx/sdk/documents/*) require the SDK gateway middleware
 * upstream (already mounted at the app level). They use req.sdkContext for
 * platform_code + org_id attribution.
 *
 * Admin routes (under /api/jrx/admin/dms/*) require dashboard-user JWT
 * (the existing authenticateToken middleware).
 *
 * @see src/services/jrx-doc-sharing-service.ts
 * @module nv-doc-sharing-routes
 * @version 1.0.0
 */

import { Router, type Request, type Response } from 'express';
import {
  issueGrant, revokeGrant, getGrantById, listGrantsForDoc, listGrantsByOwner, checkAccess,
  autoShareIfLarge, getShareStats, type GrantReason,
} from '../services/jrx-doc-sharing-service.js';
import { getNyvDmsConfig, getNyvDmsConfigSource, type PlatformCode } from '../config/nyv-dms-config.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';
import { consentGate } from '../middleware/jrx-consent-gate.js';
import { db as _raw_db } from '../db/index.js';
import { lazyRequire } from '../utils/jrx-type-helpers.js';
const db = lazyRequire(() => _raw_db, 'db');
import { sql } from 'drizzle-orm';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('./jrx-doc-sharing-routes');

/**
 * Resolve the owner (orgId, platformCode) of a document from the
 * canonical ingest-status table. Returns `null` if the doc isn't
 * registered. Architect-mandated (2026-05-06) — every share/revoke
 * must verify caller identity against this owner row, not against
 * the request body.
 */
async function resolveDocOwner(
  docId: string,
): Promise<{ ownerOrgId: string; ownerPlatformCode: string } | null> {
  try {
    const r: any = await db.execute(sql`
      SELECT org_id, platform
      FROM nv_schema.nv_document_ingest_status
      WHERE doc_id = ${docId}
      LIMIT 1
    `);
    const row = (r?.rows ?? r ?? [])[0];
    if (!row) return null;
    return {
      ownerOrgId: String(row.org_id),
      ownerPlatformCode: String(row.platform),
    };
  } catch (err: any) {
    logger.warn('resolveDocOwner failed', { docId, err: err?.message });
    return null;
  }
}

export function createDocSharingRouter(): Router {
  const router = Router();

  /**
   * POST /api/jrx/sdk/documents/:docId/share
   * Issue a grant. Owner platform (from req.sdkContext) shares with another platform.
   * Body: { grantedToPlatformCode, grantedToOrgId?, grantType?, grantReason?, expiresAt? }
   */
  router.post('/sdk/documents/:docId/share', consentGate({ purpose: 'third_party_sharing', triggeredBy: 'doc-sharing:/sdk/documents/:docId/share' }), async (req: Request, res: Response) => {
    const ctx = (req as any).sdkContext;
    if (!ctx?.platformCode || !ctx?.orgId) {
      res.status(401).json({ error: 'NYV-401: SDK context missing — platform_code + org_id required' });
      return;
    }
    const { docId } = req.params;
    const { grantedToPlatformCode, grantedToOrgId, grantType, grantReason, expiresAt } = req.body ?? {};
    if (!grantedToPlatformCode) {
      res.status(400).json({ error: 'NYV-400: grantedToPlatformCode required' });
      return;
    }
    // ── Owner verification (architect-mandated 2026-05-06) ──────────────
    // Look up the canonical owner of `docId` and ensure the SDK caller
    // matches BOTH org_id and platform. Without this check, any tenant
    // could mint grants on documents they don't own.
    const owner = await resolveDocOwner(String(docId));
    if (!owner) {
      res.status(404).json({ error: 'NYV-404: document not found', docId });
      return;
    }
    if (owner.ownerOrgId !== String(ctx.orgId) || owner.ownerPlatformCode !== ctx.platformCode) {
      logger.warn('share denied — caller is not document owner', {
        docId, callerOrg: ctx.orgId, callerPlatform: ctx.platformCode,
        ownerOrg: owner.ownerOrgId, ownerPlatform: owner.ownerPlatformCode,
      });
      res.status(403).json({
        error: 'NYV-403: only the document owner can issue grants',
        code: 'NOT_DOCUMENT_OWNER',
      });
      return;
    }
    try {
      const grant = await issueGrant({
        documentId: String(docId),
        // Use the verified owner from the DB, not the caller-supplied context,
        // to defend against any future drift between sdkContext and the
        // canonical ownership row.
        ownerOrgId: owner.ownerOrgId,
        ownerPlatformCode: owner.ownerPlatformCode as any,
        grantedToPlatformCode,
        grantedToOrgId: grantedToOrgId ?? null,
        grantType: grantType ?? 'read',
        grantReason: (grantReason as GrantReason) ?? 'manual',
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        createdBy: ctx.userId ? `user:${ctx.userId}` : `key:${ctx.keyId ?? 'unknown'}`,
      });
      res.status(201).json({ ok: true, grant });
    } catch (err: any) {
      logger.error('issueGrant failed', { err: err.message });
      res.status(500).json({ error: 'NYV-500: grant issuance failed', detail: err.message });
    }
  });

  /**
   * GET /api/jrx/sdk/documents/:docId/grants
   * List all active grants on a document. Owner platform (from sdkContext) only.
   */
  router.get('/sdk/documents/:docId/grants', async (req: Request, res: Response) => {
    const ctx = (req as any).sdkContext;
    if (!ctx?.platformCode || !ctx?.orgId) {
      res.status(401).json({ error: 'NYV-401: SDK context missing' });
      return;
    }
    try {
      const grants = await listGrantsForDoc(String(req.params.docId));
      // Visibility: owner sees all grants on their doc; non-owners see only grants TO them.
      const filtered = grants.filter(g =>
        (g.ownerOrgId === String(ctx.orgId) && g.ownerPlatformCode === ctx.platformCode) ||
        (g.grantedToPlatformCode === ctx.platformCode &&
          (g.grantedToOrgId === null || g.grantedToOrgId === String(ctx.orgId)))
      );
      res.json({ ok: true, grants: filtered, count: filtered.length });
    } catch (err: any) {
      res.status(500).json({ error: 'NYV-500: list grants failed', detail: err.message });
    }
  });

  /**
   * DELETE /api/jrx/sdk/grants/:grantId
   * Revoke a grant. Only the owner platform can revoke its own grants.
   */
  router.delete('/sdk/grants/:grantId', async (req: Request, res: Response) => {
    const ctx = (req as any).sdkContext;
    if (!ctx?.platformCode || !ctx?.orgId) {
      res.status(401).json({ error: 'NYV-401: SDK context missing' });
      return;
    }
    const grantId = Number(req.params.grantId);
    if (!Number.isFinite(grantId)) {
      res.status(400).json({ error: 'NYV-400: invalid grant id' });
      return;
    }
    // ── Ownership verification (architect-mandated 2026-05-06) ──────────
    // Fetch the grant first and confirm the caller is the owner platform/org
    // recorded on the grant. Without this, any SDK key could revoke grants
    // belonging to other tenants by guessing/scanning grant ids.
    const existing = await getGrantById(grantId);
    if (!existing) {
      res.status(404).json({ error: 'NYV-404: grant not found', grantId });
      return;
    }
    if (existing.revokedAt) {
      res.json({ ok: true, revoked: false, alreadyRevoked: true });
      return;
    }
    if (
      existing.ownerOrgId !== String(ctx.orgId) ||
      existing.ownerPlatformCode !== ctx.platformCode
    ) {
      logger.warn('revoke denied — caller is not grant owner', {
        grantId, callerOrg: ctx.orgId, callerPlatform: ctx.platformCode,
        ownerOrg: existing.ownerOrgId, ownerPlatform: existing.ownerPlatformCode,
      });
      res.status(403).json({
        error: 'NYV-403: only the owner platform can revoke this grant',
        code: 'NOT_GRANT_OWNER',
      });
      return;
    }
    try {
      const ok = await revokeGrant(
        grantId,
        ctx.userId ? `user:${ctx.userId}` : `key:${ctx.keyId ?? 'unknown'}`,
        req.body?.reason,
      );
      res.json({ ok, revoked: ok });
    } catch (err: any) {
      res.status(500).json({ error: 'NYV-500: revoke failed', detail: err.message });
    }
  });

  /**
   * GET /api/jrx/sdk/documents/:docId/access
   * Probe — does the calling SDK context have read access?
   */
  router.get('/sdk/documents/:docId/access', async (req: Request, res: Response) => {
    const ctx = (req as any).sdkContext;
    if (!ctx?.platformCode || !ctx?.orgId) {
      res.status(401).json({ error: 'NYV-401: SDK context missing' });
      return;
    }
    const result = await checkAccess(String(req.params.docId), ctx.platformCode, String(ctx.orgId));
    res.json({ ok: true, ...result });
  });

  // ─── Admin / probe routes ──────────────────────────────────────────────────

  // ── Admin auth gate (architect-mandated 2026-05-06) ──────────────────
  // Every /admin/dms/* route now requires a valid dashboard JWT AND
  // an admin-class role. Previous comment claimed "no secrets exposed",
  // but the config payload includes ecosystem platform routing, retention
  // policy, queue tuning, and OCR worker counts — all are operational
  // intelligence that should not be public.
  const requireAdminJwt = [
    authenticateToken,
    requireRole('admin', 'org_admin', 'super_admin'),
  ];

  /**
   * GET /api/jrx/admin/dms/config
   * Returns the live DMS config + source (yaml | defaults) — useful for
   * verifying that a YAML edit took effect after process restart.
   * Requires dashboard JWT + admin-class role.
   */
  router.get('/admin/dms/config', ...requireAdminJwt, async (_req: Request, res: Response) => {
    const cfg = getNyvDmsConfig();
    const src = getNyvDmsConfigSource();
    res.json({
      ok: true,
      source: src.source,
      version: cfg.version,
      lastReviewed: cfg.lastReviewed,
      backend: cfg.backend,
      uploads: cfg.uploads,
      sharing: cfg.sharing,
      retention: cfg.retention,
      ocr: cfg.ocr,
      agentRouting: cfg.agentRouting,
      queues: cfg.queues,
    });
  });

  /**
   * GET /api/jrx/admin/dms/share-stats
   * Aggregated grant counts for the DMS dashboard.
   */
  router.get('/admin/dms/share-stats', ...requireAdminJwt, async (_req: Request, res: Response) => {
    try {
      const stats = await getShareStats();
      res.json({ ok: true, ...stats, timestamp: new Date().toISOString() });
    } catch (err: any) {
      res.status(500).json({ error: 'NYV-500: stats query failed', detail: err.message });
    }
  });

  /**
   * POST /api/jrx/admin/dms/auto-share-test
   * Test endpoint — simulate auto-share evaluation for a hypothetical doc size.
   * Body: { fileSizeBytes, ownerOrgId, ownerPlatformCode }
   * Returns what grants WOULD be issued (does NOT persist).
   */
  router.post('/admin/dms/auto-share-test', ...requireAdminJwt, async (req: Request, res: Response) => {
    const cfg = getNyvDmsConfig();
    const { fileSizeBytes, ownerOrgId, ownerPlatformCode } = req.body ?? {};
    if (!Number.isFinite(fileSizeBytes) || !ownerOrgId || !ownerPlatformCode) {
      res.status(400).json({ error: 'NYV-400: fileSizeBytes + ownerOrgId + ownerPlatformCode required' });
      return;
    }
    const thresholdBytes = cfg.sharing.autoShareThresholdMb * 1024 * 1024;
    const wouldShare = cfg.sharing.autoShareLargeDocs && fileSizeBytes >= thresholdBytes;
    const wouldGrantTo = wouldShare
      ? cfg.sharing.ecosystemPlatforms.filter(p => p !== ownerPlatformCode)
      : [];
    res.json({
      ok: true,
      wouldShare,
      thresholdMb: cfg.sharing.autoShareThresholdMb,
      thresholdBytes,
      fileSizeBytes,
      wouldGrantTo,
      grantCount: wouldGrantTo.length,
      autoShareLargeDocsEnabled: cfg.sharing.autoShareLargeDocs,
    });
  });

  return router;
}
