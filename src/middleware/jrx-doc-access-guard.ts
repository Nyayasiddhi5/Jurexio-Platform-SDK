/**
 * NV Document Access Guard — Share-Grant Enforcement (T010 Stream A)
 * ─────────────────────────────────────────────────────────────────────────────
 * Express middleware that enforces `nv_doc_share_grants` for any route reading
 * a document owned by an organisation OTHER than the caller's. If no active
 * grant matches the (document, caller-platform, caller-org) tuple, the
 * middleware short-circuits with 403 DOC_ACCESS_DENIED.
 *
 * Resolution order (delegated to `assertReadAccess`):
 *   1. Caller IS the owner → allow (owner-implicit)
 *   2. Org-specific active grant → allow
 *   3. Ecosystem-wide active grant for caller's platform → allow
 *   4. Otherwise → 403
 *
 * Owner is resolved from `nv_schema.nv_document_ingest_status` so we don't
 * trust a client-supplied owner hint.
 *
 * @see src/services/jrx-doc-sharing-service.ts (assertReadAccess)
 * @module nv-doc-access-guard
 */

import type { Request, Response, NextFunction } from 'express';
import { db as _raw_db } from '../db/index.js';
import { lazyRequire } from '../utils/jrx-type-helpers.js';
const db = lazyRequire(() => _raw_db, 'db');
import { sql } from 'drizzle-orm';
import {
  assertReadAccess,
  DocAccessDeniedError,
} from '../services/jrx-doc-sharing-service.js';
import type { PlatformCode } from '../config/nyv-dms-config.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('./jrx-doc-access-guard');

// NV-DOC-ACCESS-DEV (R5 — 2026-05-07): permissive mode logs the would-be
// decision but always allows. strict mode (prod default) enforces full
// Session-7 share-grant. Switch via NYV_DOC_ACCESS_MODE.
const DOC_ACCESS_MODE: 'permissive' | 'strict' =
  (process.env.NYV_DOC_ACCESS_MODE as any) ||
  (process.env.NODE_ENV === 'production' ? 'strict' : 'permissive');
logger.info(`Doc-access mode: ${DOC_ACCESS_MODE} (NYV_DOC_ACCESS_MODE)`);

interface DocOwnerRow {
  org_id: string;
  platform: string;
}

async function lookupDocOwner(docId: string): Promise<DocOwnerRow | null> {
  try {
    const r: any = await db.execute(sql`
      SELECT org_id, platform
      FROM nv_schema.nv_document_ingest_status
      WHERE doc_id = ${docId}
      LIMIT 1
    `);
    const row = (r?.rows ?? r ?? [])[0];
    if (!row) return null;
    return { org_id: String(row.org_id), platform: String(row.platform) };
  } catch (err: any) {
    logger.warn('owner lookup failed', { docId, err: err?.message });
    return null;
  }
}

/**
 * Express middleware factory. Reads `req.params[paramName]` (default `docId`),
 * resolves the document owner, then calls `assertReadAccess` with the caller's
 * (orgId, platform) taken from `req.user` (JWT auth) or `req.sdkContext`
 * (SDK gateway). Sets `req.docAccess = { ownerOrgId, ownerPlatform, reason }`
 * on success so downstream handlers can audit the grant used.
 */
export function nvDocAccessGuard(opts: { paramName?: string; allowMissingDoc?: boolean } = {}) {
  const paramName = opts.paramName ?? 'docId';
  const allowMissingDoc = opts.allowMissingDoc ?? false;

  return async function docAccessGuard(req: Request, res: Response, next: NextFunction): Promise<void> {
    const docId = String(req.params?.[paramName] ?? '');
    if (!docId) {
      res.status(400).json({
        success: false,
        error: { code: 'DOC_ID_MISSING', message: `Missing :${paramName} route parameter.` },
      });
      return;
    }

    const callerOrgId = String(
      (req as any).user?.orgId ??
      (req as any).user?.org_id ??
      (req as any).user?.organizationId ??
      (req as any).sdkContext?.organizationId ??
      '',
    );
    const callerPlatform = String(
      (req as any).user?.platform ??
      (req as any).sdkContext?.appType ??
      'nv',
    ).toLowerCase() as PlatformCode;

    if (!callerOrgId) {
      res.status(401).json({
        success: false,
        error: { code: 'CALLER_UNIDENTIFIED', message: 'Unable to determine caller organisation.' },
      });
      return;
    }

    const owner = await lookupDocOwner(docId);
    if (!owner) {
      if (allowMissingDoc) { next(); return; }
      res.status(404).json({
        success: false,
        error: { code: 'DOC_NOT_FOUND', message: `Document ${docId} not found.` },
      });
      return;
    }

    try {
      const decision = await assertReadAccess(
        docId,
        callerOrgId,
        callerPlatform,
        { ownerOrgId: owner.org_id, ownerPlatformCode: owner.platform as PlatformCode },
      );
      (req as any).docAccess = {
        ownerOrgId: owner.org_id,
        ownerPlatform: owner.platform,
        reason: decision.reason,
        grantId: decision.grantId,
      };
      next();
    } catch (err: any) {
      if (err instanceof DocAccessDeniedError) {
        // NV-DOC-ACCESS-DEV (R5): permissive mode logs + allows; strict denies.
        if (DOC_ACCESS_MODE === 'permissive') {
          logger.warn('doc_access_denied (PERMISSIVE_ALLOW)', {
            docId, callerOrgId, callerPlatform,
            owner: `${owner.org_id}::${owner.platform}`,
            reason: err.reason,
          });
          (req as any).docAccess = {
            ownerOrgId: owner.org_id,
            ownerPlatform: owner.platform,
            reason: 'permissive_allow',
            grantId: null,
          };
          next();
          return;
        }
        logger.info('doc_access_denied', {
          docId, callerOrgId, callerPlatform,
          owner: `${owner.org_id}::${owner.platform}`,
          reason: err.reason,
        });
        res.status(403).json({
          success: false,
          error: { code: err.code, message: err.message, reason: err.reason },
        });
        return;
      }
      logger.error('doc_access_guard_error', { docId, err: err?.message });
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Access check failed.' },
      });
    }
  };
}

export default nvDocAccessGuard;
