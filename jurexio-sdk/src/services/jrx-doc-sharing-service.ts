/**
 * JRX Document Sharing Service — Jurexio-mediated cross-platform sharing.
 * ─────────────────────────────────────────────────────────────────────────────
 * Per Phase 2A decisions LOCKED 2026-05-06:
 *   - Sharing is platform-mediated by Jurexio, NOT peer-to-peer
 *   - Default = private (uploader-platform-only)
 *   - Documents ≥ auto_share_threshold_mb (default 50 MB) auto-receive
 *     ecosystem-wide read grants for ALL 7 platforms — eliminates per-platform
 *     duplication of large legal corpora (case law, statutes, contracts)
 *   - Every grant + every cross-platform read is audited via nv_audit_logs
 *
 * This service is consumed BY agents (the AI backbone) — when an agent
 * working on behalf of a platform needs to read a document owned by another
 * platform, it calls `checkAccess()` first; if denied, the agent can request
 * a grant via `requestGrantOrEscalate()` (typically routed through the
 * Maker-Checker P07 ROMA pattern for governance approval).
 *
 * @see docs/v5.0.0/DOC-MGMT-PHASE2-ARCHITECTURE-PLAN-2026-05-06.md §10-§11
 * @see config/storage/document-storage-deployment.yaml § sharing
 * @module jrx-doc-sharing-service
 * @version 1.0.0
 */

import crypto from 'crypto';
import { db as _raw_db } from '../db/index.js';
import { lazyRequire } from '../utils/jrx-type-helpers.js';
const db = lazyRequire(() => _raw_db, 'db');
import { nvDocShareGrants, type NvDocShareGrant, type NewNvDocShareGrant } from '../../shared/schema.js';
import { and, eq, isNull, or, sql, desc } from 'drizzle-orm';
import { getJrxDmsConfig, type PlatformCode } from '../config/jrx-dms-config.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('./jrx-doc-sharing');

export type GrantType = 'read' | 'write' | 'admin';
export type GrantReason =
  | 'auto-large-doc'           // crossed threshold; auto-issued by Jurexio
  | 'manual'                   // explicit grant by owner platform
  | 'cross-platform-workflow'  // agent-orchestrated (e.g. NSI lawyer needs NSP filing)
  | 'jurexio-orchestrator'; // central platform decision

export interface IssueGrantInput {
  documentId: string;
  ownerOrgId: string;
  ownerPlatformCode: PlatformCode | 'JRX';
  grantedToPlatformCode: PlatformCode;
  grantedToOrgId?: string | null; // null = ecosystem-wide for that platform
  grantType?: GrantType;
  grantReason: GrantReason;
  thresholdBytes?: number;
  storagePath?: string;
  sharedBucket?: string;
  expiresAt?: Date | null;
  createdBy?: string; // user_id or 'jurexio-orchestrator'
  metadata?: Record<string, unknown>;
}

export interface CheckAccessResult {
  hasAccess: boolean;
  grantId?: number;
  grantType?: GrantType;
  grantReason?: string;
  expiresAt?: Date | null;
  reason: 'owner' | 'org-grant' | 'ecosystem-grant' | 'no-grant' | 'revoked' | 'expired';
}

/** Compute audit-chain hash for a grant event (linkable into nv_audit_logs). */
function computeGrantAuditHash(input: IssueGrantInput, timestamp: string): string {
  const payload = JSON.stringify({
    docId: input.documentId,
    owner: `${input.ownerOrgId}::${input.ownerPlatformCode}`,
    grantedTo: `${input.grantedToPlatformCode}::${input.grantedToOrgId ?? 'ECOSYSTEM'}`,
    type: input.grantType ?? 'read',
    reason: input.grantReason,
    timestamp,
  });
  return crypto.createHash('sha256').update(payload).digest('hex');
}

/**
 * Issue a cross-platform share grant. Idempotent on the
 * (document_id, granted_to_platform, granted_to_org) tuple — re-issuing
 * an active grant returns the existing row.
 */
export async function issueGrant(input: IssueGrantInput): Promise<NvDocShareGrant> {
  const cfg = getJrxDmsConfig();
  const now = new Date();
  const auditHash = computeGrantAuditHash(input, now.toISOString());

  const row: NewNvDocShareGrant = {
    documentId: input.documentId,
    ownerOrgId: input.ownerOrgId,
    ownerPlatformCode: input.ownerPlatformCode,
    grantedToPlatformCode: input.grantedToPlatformCode,
    grantedToOrgId: input.grantedToOrgId ?? null,
    grantType: input.grantType ?? 'read',
    grantReason: input.grantReason,
    thresholdBytes: input.thresholdBytes ?? null,
    storagePath: input.storagePath ?? null,
    sharedBucket: input.sharedBucket ?? cfg.backend.sharedBucket,
    expiresAt: input.expiresAt ?? null,
    createdBy: input.createdBy ?? 'jurexio-orchestrator',
    auditChainHash: auditHash,
    metadata: input.metadata ?? {},
  };

  // Use ON CONFLICT DO NOTHING via raw SQL since the unique index uses a
  // partial WHERE clause — drizzle's onConflict helpers don't model that
  // cleanly. We then SELECT to return either the existing or new row.
  await db.execute(sql`
    INSERT INTO public.nv_doc_share_grants
      (document_id, owner_org_id, owner_platform_code, granted_to_platform_code,
       granted_to_org_id, grant_type, grant_reason, threshold_bytes, storage_path,
       shared_bucket, expires_at, created_by, audit_chain_hash, metadata)
    VALUES
      (${row.documentId}, ${row.ownerOrgId}, ${row.ownerPlatformCode}, ${row.grantedToPlatformCode},
       ${row.grantedToOrgId}, ${row.grantType}, ${row.grantReason}, ${row.thresholdBytes}, ${row.storagePath},
       ${row.sharedBucket}, ${row.expiresAt}, ${row.createdBy}, ${row.auditChainHash}, ${JSON.stringify(row.metadata)}::jsonb)
    ON CONFLICT (document_id, granted_to_platform_code, COALESCE(granted_to_org_id, ''))
      WHERE revoked_at IS NULL
    DO NOTHING
  `);

  // Fetch the active grant (existing or newly inserted)
  const existing = await db.select().from(nvDocShareGrants).where(
    and(
      eq(nvDocShareGrants.documentId, row.documentId),
      eq(nvDocShareGrants.grantedToPlatformCode, row.grantedToPlatformCode),
      row.grantedToOrgId
        ? eq(nvDocShareGrants.grantedToOrgId, row.grantedToOrgId)
        : isNull(nvDocShareGrants.grantedToOrgId),
      isNull(nvDocShareGrants.revokedAt),
    ),
  ).limit(1);

  if (cfg.sharing.auditEveryGrant) {
    logger.info('grant issued', {
      docId: row.documentId,
      owner: `${row.ownerOrgId}::${row.ownerPlatformCode}`,
      grantedTo: `${row.grantedToPlatformCode}::${row.grantedToOrgId ?? 'ECOSYSTEM'}`,
      type: row.grantType,
      reason: row.grantReason,
      auditHash: row.auditChainHash,
    });
  }
  return existing[0];
}

/** Revoke an active grant. Idempotent. */
export async function revokeGrant(grantId: number, revokedBy: string, revokeReason?: string): Promise<boolean> {
  const result = await db.update(nvDocShareGrants)
    .set({ revokedAt: new Date(), revokedBy, revokeReason: revokeReason ?? null })
    .where(and(eq(nvDocShareGrants.id, grantId), isNull(nvDocShareGrants.revokedAt)))
    .returning();
  if (result.length > 0) {
    logger.info('grant revoked', { grantId, revokedBy, reason: revokeReason });
    return true;
  }
  return false;
}

/**
 * Fetch a single grant by id (active or revoked). Used by route layer
 * to enforce owner-only revoke (architect 2026-05-06).
 */
export async function getGrantById(grantId: number): Promise<NvDocShareGrant | null> {
  const rows = await db.select().from(nvDocShareGrants)
    .where(eq(nvDocShareGrants.id, grantId))
    .limit(1);
  return rows[0] ?? null;
}

/** List all active grants on a document. */
export async function listGrantsForDoc(documentId: string): Promise<NvDocShareGrant[]> {
  return db.select().from(nvDocShareGrants).where(
    and(eq(nvDocShareGrants.documentId, documentId), isNull(nvDocShareGrants.revokedAt)),
  ).orderBy(desc(nvDocShareGrants.createdAt));
}

/** List all docs the given (org, platform) shared out. */
export async function listGrantsByOwner(orgId: string, platformCode: PlatformCode | 'JRX', limit = 100): Promise<NvDocShareGrant[]> {
  return db.select().from(nvDocShareGrants).where(
    and(
      eq(nvDocShareGrants.ownerOrgId, orgId),
      eq(nvDocShareGrants.ownerPlatformCode, platformCode),
      isNull(nvDocShareGrants.revokedAt),
    ),
  ).orderBy(desc(nvDocShareGrants.createdAt)).limit(limit);
}

/**
 * Decide whether the requesting (platform, org) has read access to the doc.
 * Resolution order:
 *   1. Owner check — if requestor IS the owner, always allow
 *   2. Org-specific grant — (granted_to_platform, granted_to_org) match
 *   3. Ecosystem grant — (granted_to_platform, granted_to_org IS NULL)
 *   4. Deny
 */
export async function checkAccess(
  documentId: string,
  requestingPlatform: PlatformCode,
  requestingOrgId: string,
  ownerHint?: { ownerOrgId: string; ownerPlatformCode: PlatformCode | 'JRX' },
): Promise<CheckAccessResult> {
  if (ownerHint && ownerHint.ownerOrgId === requestingOrgId && ownerHint.ownerPlatformCode === requestingPlatform) {
    return { hasAccess: true, reason: 'owner' };
  }

  const grants = await db.select().from(nvDocShareGrants).where(
    and(
      eq(nvDocShareGrants.documentId, documentId),
      eq(nvDocShareGrants.grantedToPlatformCode, requestingPlatform),
      or(
        isNull(nvDocShareGrants.grantedToOrgId),
        eq(nvDocShareGrants.grantedToOrgId, requestingOrgId),
      ),
      isNull(nvDocShareGrants.revokedAt),
    ),
  );

  if (grants.length === 0) {
    return { hasAccess: false, reason: 'no-grant' };
  }

  // Filter expired
  const now = Date.now();
  const valid = grants.filter(g => !g.expiresAt || g.expiresAt.getTime() > now);
  if (valid.length === 0) {
    return { hasAccess: false, reason: 'expired' };
  }

  // Prefer org-specific grant over ecosystem grant
  const orgSpecific = valid.find(g => g.grantedToOrgId === requestingOrgId);
  const chosen = orgSpecific ?? valid[0];

  if (getJrxDmsConfig().sharing.auditEveryCrossPlatformRead) {
    logger.info('cross-platform read authorised', {
      docId: documentId,
      requestor: `${requestingPlatform}::${requestingOrgId}`,
      grantId: chosen.id,
      grantReason: chosen.grantReason,
    });
  }

  return {
    hasAccess: true,
    grantId: chosen.id,
    grantType: chosen.grantType as GrantType,
    grantReason: chosen.grantReason ?? undefined,
    expiresAt: chosen.expiresAt,
    reason: orgSpecific ? 'org-grant' : 'ecosystem-grant',
  };
}

/**
 * Strict variant of `checkAccess` that throws a `DocAccessDeniedError`
 * when access is not granted. Used by the share-grant enforcement middleware
 * (`jrx-doc-access-guard`) to keep route handlers free of duplicated checks.
 *
 * Acceptance (T010 Stream A): Org B reading Org A's document MUST receive a
 * 403 unless an active row exists in `nv_doc_share_grants` matching either
 *   (granted_to_platform_code = B.platform AND granted_to_org_id = B.orgId)
 *   OR (granted_to_platform_code = B.platform AND granted_to_org_id IS NULL).
 *
 * @throws DocAccessDeniedError when no active grant exists or grant expired.
 */
export class DocAccessDeniedError extends Error {
  public readonly statusCode = 403;
  public readonly code = 'DOC_ACCESS_DENIED';
  constructor(
    public readonly documentId: string,
    public readonly callerPlatform: string,
    public readonly callerOrgId: string,
    public readonly reason: CheckAccessResult['reason'],
  ) {
    super(
      `Access denied to document ${documentId} for ${callerPlatform}::${callerOrgId} (reason: ${reason})`,
    );
    this.name = 'DocAccessDeniedError';
  }
}

export async function assertReadAccess(
  documentId: string,
  callerOrgId: string,
  callerPlatform: PlatformCode,
  ownerHint?: { ownerOrgId: string; ownerPlatformCode: PlatformCode | 'JRX' },
): Promise<CheckAccessResult> {
  const result = await checkAccess(documentId, callerPlatform, callerOrgId, ownerHint);
  if (!result.hasAccess) {
    throw new DocAccessDeniedError(documentId, callerPlatform, callerOrgId, result.reason);
  }
  return result;
}

/**
 * Auto-share large documents per Phase 2A decision: if the file is at or
 * above `auto_share_threshold_mb`, issue ecosystem-wide read grants for ALL
 * configured ecosystem platforms in a single batch.
 *
 * Returns the list of grants issued (empty if doc was below threshold or
 * auto-share disabled).
 *
 * Called from the document orchestrator AFTER upload completes successfully.
 */
export async function autoShareIfLarge(input: {
  documentId: string;
  ownerOrgId: string;
  ownerPlatformCode: PlatformCode | 'JRX';
  fileSizeBytes: number;
  storagePath?: string;
  triggeredBy?: string;
}): Promise<NvDocShareGrant[]> {
  const cfg = getJrxDmsConfig();
  if (!cfg.sharing.autoShareLargeDocs) return [];

  const thresholdBytes = cfg.sharing.autoShareThresholdMb * 1024 * 1024;
  if (input.fileSizeBytes < thresholdBytes) return [];

  logger.info('auto-share threshold crossed', {
    docId: input.documentId,
    sizeBytes: input.fileSizeBytes,
    thresholdBytes,
    ecosystemPlatforms: cfg.sharing.ecosystemPlatforms,
  });

  const issued: NvDocShareGrant[] = [];
  for (const platform of cfg.sharing.ecosystemPlatforms) {
    // Skip if requesting platform IS the owner — owner already has implicit access
    if (platform === input.ownerPlatformCode) continue;
    const grant = await issueGrant({
      documentId: input.documentId,
      ownerOrgId: input.ownerOrgId,
      ownerPlatformCode: input.ownerPlatformCode,
      grantedToPlatformCode: platform,
      grantedToOrgId: null, // ecosystem-wide
      grantType: 'read',
      grantReason: 'auto-large-doc',
      thresholdBytes: input.fileSizeBytes,
      storagePath: input.storagePath,
      createdBy: input.triggeredBy ?? 'jurexio-orchestrator',
      metadata: { autoShareThresholdMb: cfg.sharing.autoShareThresholdMb },
    });
    if (grant) issued.push(grant);
  }
  return issued;
}

/** Aggregate counts for the admin DMS dashboard. */
export async function getShareStats(): Promise<{
  activeGrants: number;
  revokedGrants: number;
  ecosystemGrants: number;
  orgSpecificGrants: number;
  byOwnerPlatform: Record<string, number>;
}> {
  const rows = await db.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE revoked_at IS NULL)::int AS active,
      COUNT(*) FILTER (WHERE revoked_at IS NOT NULL)::int AS revoked,
      COUNT(*) FILTER (WHERE revoked_at IS NULL AND granted_to_org_id IS NULL)::int AS ecosystem,
      COUNT(*) FILTER (WHERE revoked_at IS NULL AND granted_to_org_id IS NOT NULL)::int AS org_specific
    FROM public.nv_doc_share_grants
  `);
  const r: any = (rows as any).rows?.[0] ?? (rows as any)[0] ?? {};
  // Simpler per-platform aggregation
  const perPlat = await db.execute(sql`
    SELECT owner_platform_code, COUNT(*)::int AS c
    FROM public.nv_doc_share_grants
    WHERE revoked_at IS NULL
    GROUP BY owner_platform_code
  `);
  const byPlat: Record<string, number> = {};
  for (const p of (perPlat.rows ?? perPlat ?? []) as any[]) {
    byPlat[p.owner_platform_code] = Number(p.c);
  }
  return {
    activeGrants: Number(r.active ?? 0),
    revokedGrants: Number(r.revoked ?? 0),
    ecosystemGrants: Number(r.ecosystem ?? 0),
    orgSpecificGrants: Number(r.org_specific ?? 0),
    byOwnerPlatform: byPlat,
  };
}
