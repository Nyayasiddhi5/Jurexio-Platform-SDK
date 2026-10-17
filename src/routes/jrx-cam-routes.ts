/**
 * Compliance Action Manager (CAM) Reviewer Routes — Task #190.
 *
 * Mounts at: /api/jrx/cam
 *   GET /reviews   — list pending compliance actions for reviewers.
 *
 * RBAC: compliance_reviewer / org_admin / super_admin (NV-AUTH-HEADER-001
 *       canonical JWT path via authenticateToken).
 *
 * Backed by `nv_cam_actions`, defined in shared/schema.ts (nvCamActions) and
 * shipped via drizzle/0009_cam_actions.sql. The shape matches the reviewer
 * queue surface that Task #178 deliberately deferred for cross-listing under
 * Compliance + Governance B2.
 *
 * NV-WIRING-001: imported and mounted in src/index.ts.
 * NV-API-CONTRACT-001: additive route only.
 * NV-NAMING-001: nv- prefix; pre-flight grep confirms no existing
 *   `/api/jrx/cam` (only `/api/jrx/v1/sdk/cam` + `/api/nyayavigya/cam`
 *   for the CAM dashboard bridge — different surface).
 */
import { Router, Request, Response } from 'express';
import { sql } from 'drizzle-orm';
import { authenticateToken, requireRole, AuthRequest } from '../middleware/jrx-auth.js';
import { bridgeJwtOrgToSdkContext } from '../middleware/jrx-jwt-org-bridge.js';
import { db } from '../db/index.js';
import { createLogger } from '../utils/logger.js';
import { appendAuditRecord } from '../middleware/jrx-sdk-tracking-middleware.js';
import {
  getRbacIdentityFromRequest,
  customerOrgScopeSql,
  classifyLayer,
  assertCanAccessCustomerOrg,
  RbacAccessError,
} from '../services/rbac/jrx-customer-org-rbac.js';
import { mem0PersistenceService } from '../services/mem0-persistence-service.js';

const router = Router();
const logger = createLogger('./jrx-cam-routes');

const REVIEWER_ROLES = ['compliance_reviewer', 'org_admin', 'super_admin'];

router.use(authenticateToken);
// Task #353: bridge Console JWT → req.sdkContext so reviewer queries can
// AND in (platform_id=org_id, customer_org_id) the same way SDK callers
// do. The bridge is async so we wrap it for Express route mounting.
router.use((req, res, next) => { void bridgeJwtOrgToSdkContext(req, res, next); });

// GET /api/jrx/cam/entries — mem0/CAM memory browser (Console MemoryBrowserCAM).
router.get(
  '/entries',
  requireRole(...REVIEWER_ROLES),
  async (req: Request, res: Response): Promise<void> => {
    const agentId = req.query.agentId ? String(req.query.agentId) : undefined;
    const limit = Math.min(Number(req.query.limit) || 100, 200);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    await mem0PersistenceService.ensureListHydratedFromDurable();
    const { entries, total } = mem0PersistenceService.listEntries({ agentId, limit, offset });
    res.json({ success: true, data: { entries, total, limit, offset } });
  },
);

// GET /api/jrx/cam/stats — aggregate mem0 stats for CAM dashboard tiles.
router.get(
  '/stats',
  requireRole(...REVIEWER_ROLES),
  async (_req: Request, res: Response): Promise<void> => {
    await mem0PersistenceService.ensureListHydratedFromDurable();
    const stats = mem0PersistenceService.getStats();
    res.json({
      success: true,
      data: {
        total_entries: stats.totalMemories,
        distinct_agents: stats.totalAgents,
        scopes: Object.keys(stats.namespaceBreakdown),
        namespaceBreakdown: stats.namespaceBreakdown,
        memoryTypeDistribution: stats.memoryTypeDistribution,
        averageStrength: stats.averageStrength,
      },
    });
  },
);

// GET /api/jrx/cam/reviews — pending compliance action queue for reviewers.
router.get(
  '/reviews',
  requireRole(...REVIEWER_ROLES),
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthRequest;

    const status = String((req.query.status as string) || 'pending').toLowerCase();
    const severity = req.query.severity ? String(req.query.severity).toLowerCase() : null;
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Math.max(Number(req.query.offset) || 0, 0);

    if (!db) {
      res.status(503).json({ success: false, error: 'Database not available', code: 'CAM_DB_UNAVAILABLE' });
      return;
    }

    // Task #353: AND in (platform_id, customer_org_id) so two firms
    // sharing one platform key can't see each other's compliance queue.
    // Reviewer roles classify as platform_admin (org_admin / super_admin)
    // or customer_org_admin (compliance_reviewer of a single firm).
    const identity = getRbacIdentityFromRequest(req);
    const scope = customerOrgScopeSql(identity, {
      platformCol: sql`org_id`,
      customerCol: sql`customer_org_id`,
      platformIsText: true,
    });
    try {
      const rowsRes: any = await db.execute(sql`
        SELECT id, action_id, org_id, customer_org_id, framework, control_id,
               severity, status, title, description, assigned_to, triggered_by,
               evidence_ref, metadata, created_at, updated_at, reviewed_at, reviewed_by
        FROM nv_cam_actions
        WHERE status = ${status}
          AND (${severity}::text IS NULL OR severity = ${severity})
          ${scope}
        ORDER BY
          CASE severity
            WHEN 'critical' THEN 1
            WHEN 'high'     THEN 2
            WHEN 'medium'   THEN 3
            WHEN 'low'      THEN 4
            ELSE 5
          END,
          created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `);
      const rows = (rowsRes?.rows ?? rowsRes ?? []) as any[];

      const countRes: any = await db.execute(sql`
        SELECT
          COUNT(*) FILTER (WHERE status = 'pending')::int   AS pending,
          COUNT(*) FILTER (WHERE status = 'in_review')::int AS in_review,
          COUNT(*) FILTER (WHERE status = 'approved')::int  AS approved,
          COUNT(*) FILTER (WHERE status = 'rejected')::int  AS rejected,
          COUNT(*)::int AS total
        FROM nv_cam_actions
        WHERE 1 = 1 ${scope}
      `);
      const counts = (countRes?.rows?.[0] ?? countRes?.[0] ?? {
        pending: 0, in_review: 0, approved: 0, rejected: 0, total: 0,
      });

      res.json({
        success: true,
        reviewer: {
          id: authReq.user?.id ?? null,
          role: authReq.user?.role ?? null,
        },
        filter: { status, severity, limit, offset },
        counts,
        actions: rows,
        total: rows.length,
        generatedAt: new Date().toISOString(),
      });
    } catch (err: any) {
      logger.error('cam_reviews_query_failed', {
        errClass: err?.name ?? 'Error',
        code: err?.code ?? 'UNKNOWN',
      });
      res.status(500).json({
        success: false,
        error: 'Failed to load CAM reviewer queue',
        code: 'CAM_REVIEWS_ERROR',
      });
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// REVIEWER WRITE ENDPOINTS — Task #200
// ─────────────────────────────────────────────────────────────────────────────
// POST /api/jrx/cam/reviews/:actionId/approve
// POST /api/jrx/cam/reviews/:actionId/reject
// POST /api/jrx/cam/reviews/:actionId/assign
//
// Each transition:
//   1. Loads the current row (404 if missing).
//   2. Updates status / reviewed_by / reviewed_at (and assigned_to for assign).
//   3. Appends a tamper-evident record to nv_schema.nv_audit_logs via
//      appendAuditRecord() so governance keeps the chain intact.
//
// All gated to compliance_reviewer / org_admin / super_admin.
// NV-API-CONTRACT-001: additive POST routes only.

type CamRow = {
  action_id: string;
  org_id: string | null;
  status: string;
  assigned_to: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
};

// Task #213: the original Task #200 patch landed three call sites that
// invoke `ensureTable()` (lines 174 / 243 / 316) without ever defining or
// importing it — masked by the file-level `// @ts-nocheck`. Every POST
// reviewer route therefore ReferenceError-ed before reaching the audit /
// update step. We mirror the same idempotent CREATE-IF-NOT-EXISTS used
// by `services/compliance/jrx-cam-writer.ts::ensureTable()` so the route
// is self-sufficient (writers may not have fired yet in fresh envs /
// tests). Schema kept in lock-step with the writer.
let _camTableEnsured = false;
async function ensureTable(): Promise<void> {
  if (_camTableEnsured) return;
  if (!db) return;
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS nv_cam_actions (
        id              SERIAL PRIMARY KEY,
        action_id       VARCHAR(64)  UNIQUE NOT NULL,
        org_id          VARCHAR(100),
        framework       VARCHAR(64),
        control_id      VARCHAR(100),
        severity        VARCHAR(20)  DEFAULT 'medium',
        status          VARCHAR(20)  DEFAULT 'pending',
        title           VARCHAR(255) NOT NULL,
        description     TEXT,
        assigned_to     VARCHAR(100),
        triggered_by    VARCHAR(100),
        evidence_ref    VARCHAR(255),
        metadata        JSONB        DEFAULT '{}'::jsonb,
        created_at      TIMESTAMP    DEFAULT NOW(),
        updated_at      TIMESTAMP    DEFAULT NOW(),
        reviewed_at     TIMESTAMP,
        reviewed_by     VARCHAR(100),
        customer_org_id BIGINT
      )
    `);
    // Task #353: idempotent migration for warm DBs that bootstrapped before
    // the customer_org_id column was added (e.g. drizzle/0012 not applied).
    await db.execute(sql`ALTER TABLE nv_cam_actions ADD COLUMN IF NOT EXISTS customer_org_id BIGINT`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_nv_cam_actions_customer_org ON nv_cam_actions (org_id, customer_org_id)`);
    _camTableEnsured = true;
  } catch (err: any) {
    logger.warn('cam_routes_ensure_table_failed', { err: err?.message });
  }
}

type CamRowWithCustomer = CamRow & { customer_org_id: number | string | null };

async function loadAction(actionId: string): Promise<CamRowWithCustomer | null> {
  if (!db) return null;
  const r: any = await db.execute(sql`
    SELECT action_id, org_id, customer_org_id, status, assigned_to, reviewed_by, reviewed_at
    FROM nv_cam_actions
    WHERE action_id = ${actionId}
    LIMIT 1
  `);
  const row = (r?.rows?.[0] ?? r?.[0]) as CamRowWithCustomer | undefined;
  return row ?? null;
}

/**
 * Task #353 — write-path tenant guard. Throws 403 if the caller can't see
 * the row's (platform_id, customer_org_id). Wraps assertCanAccessCustomerOrg
 * with cam-specific column coercion (org_id is a varchar/text on this table).
 */
function assertCamRowAccess(req: Request, row: CamRowWithCustomer): void {
  const id = getRbacIdentityFromRequest(req);
  const layer = classifyLayer(id);
  if (layer === 'super_admin') return;
  const targetPlatformId = row.org_id == null ? NaN : Number(row.org_id);
  const targetCustomerOrgId = row.customer_org_id == null ? NaN : Number(row.customer_org_id);
  // Legacy row without customer_org_id tagging: ONLY platform_admin (or
  // higher) of the row's platform may operate on it. customer_org_admin
  // and customer_user fail closed — we will not assume the legacy row
  // belongs to their tenant.
  if (!Number.isFinite(targetCustomerOrgId)) {
    if (
      layer === 'platform_admin'
      && id.platformId != null
      && Number.isFinite(targetPlatformId)
      && id.platformId === targetPlatformId
    ) return;
    throw new RbacAccessError('cam row missing customer_org_id binding');
  }
  if (!Number.isFinite(targetPlatformId)) {
    throw new RbacAccessError('cam row missing org_id binding');
  }
  assertCanAccessCustomerOrg(id, targetPlatformId, targetCustomerOrgId);
}

async function emitAudit(
  eventType: string,
  payload: Record<string, unknown>,
): Promise<{ id: string; recordHash: string; previousHash: string; createdAt: string }> {
  // Strict mode: governance requires that EVERY reviewer transition produces
  // a tamper-evident audit-chain record. If the chain append fails, the
  // caller must propagate the failure so the route returns 5xx and the
  // state transition is reported as failed (we do NOT swallow). Task #200.
  return appendAuditRecord({
    eventType,
    payload: JSON.stringify(payload),
    strict: true,
  });
}

function reviewerIdentity(authReq: AuthRequest): { id: string; role: string; orgId: string | null } {
  const u: any = authReq.user ?? {};
  return {
    id: String(u.id ?? u.userId ?? 'unknown'),
    role: String(u.role ?? 'unknown'),
    // NV-UAT-DEFAULT-ORG-001 (task #335): dev / E2E-bypass falls back to
    // platform-baseline org_id=1 when reviewer JWT carries no org claim.
    // Production keeps the historical null and will fail closed downstream.
    orgId: ((u.organizationId ?? u.orgId ?? u.tenantId ?? u.org_id) ??
      ((process.env.NODE_ENV !== 'production') ? '1' : null)) as string | null,
  };
}

// POST /api/jrx/cam/reviews/:actionId/approve
router.post(
  '/reviews/:actionId/approve',
  requireRole(...REVIEWER_ROLES),
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthRequest;
    if (!db) {
      res.status(503).json({ success: false, error: 'Database not available', code: 'CAM_DB_UNAVAILABLE' });
      return;
    }
    await ensureTable();
    const actionId = String(req.params.actionId);
    const reviewer = reviewerIdentity(authReq);
    const note = typeof req.body?.note === 'string' ? req.body.note : null;

    try {
      const existing = await loadAction(actionId);
      if (!existing) {
        res.status(404).json({ success: false, error: 'Action not found', code: 'CAM_ACTION_NOT_FOUND' });
        return;
      }
      // Task #353: cross-tenant write guard.
      try { assertCamRowAccess(req, existing); }
      catch (e: any) {
        res.status(404).json({ success: false, error: 'Action not found', code: 'CAM_ACTION_NOT_FOUND' });
        return;
      }
      if (existing.status === 'approved' || existing.status === 'rejected') {
        res.status(409).json({
          success: false,
          error: `Action already ${existing.status}`,
          code: 'CAM_ACTION_TERMINAL',
        });
        return;
      }

      // Audit FIRST — strict mode. If the chain append fails, we do NOT
      // mutate the row. This guarantees the requirement that every
      // successful transition has a tamper-evident audit record.
      let auditRec;
      try {
        auditRec = await emitAudit('compliance.cam.review.approved', {
          actionId,
          orgId: existing.org_id,
          previousStatus: existing.status,
          newStatus: 'approved',
          reviewer,
          note,
          at: new Date().toISOString(),
        });
      } catch (auditErr: any) {
        logger.error('cam_approve_audit_failed', { actionId, err: auditErr?.message });
        res.status(500).json({
          success: false,
          error: 'Audit chain unavailable — approval not recorded',
          code: 'CAM_AUDIT_APPEND_FAILED',
        });
        return;
      }

      const updRes: any = await db.execute(sql`
        UPDATE nv_cam_actions
        SET status      = 'approved',
            reviewed_by = ${reviewer.id},
            reviewed_at = NOW(),
            updated_at  = NOW()
        WHERE action_id = ${actionId}
        RETURNING action_id, org_id, status, reviewed_by, reviewed_at
      `);
      const updated = (updRes?.rows?.[0] ?? updRes?.[0]) as any;

      res.json({ success: true, action: updated, audit: { id: auditRec.id, recordHash: auditRec.recordHash } });
    } catch (err: any) {
      logger.error('cam_approve_failed', { actionId, err: err?.message });
      res.status(500).json({ success: false, error: 'Failed to approve action', code: 'CAM_APPROVE_ERROR' });
    }
  },
);

// POST /api/jrx/cam/reviews/:actionId/reject
router.post(
  '/reviews/:actionId/reject',
  requireRole(...REVIEWER_ROLES),
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthRequest;
    if (!db) {
      res.status(503).json({ success: false, error: 'Database not available', code: 'CAM_DB_UNAVAILABLE' });
      return;
    }
    await ensureTable();
    const actionId = String(req.params.actionId);
    const reviewer = reviewerIdentity(authReq);
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';

    if (!reason) {
      res.status(400).json({ success: false, error: 'reason is required', code: 'CAM_REJECT_REASON_REQUIRED' });
      return;
    }

    try {
      const existing = await loadAction(actionId);
      if (!existing) {
        res.status(404).json({ success: false, error: 'Action not found', code: 'CAM_ACTION_NOT_FOUND' });
        return;
      }
      // Task #353: cross-tenant write guard.
      try { assertCamRowAccess(req, existing); }
      catch {
        res.status(404).json({ success: false, error: 'Action not found', code: 'CAM_ACTION_NOT_FOUND' });
        return;
      }
      if (existing.status === 'approved' || existing.status === 'rejected') {
        res.status(409).json({
          success: false,
          error: `Action already ${existing.status}`,
          code: 'CAM_ACTION_TERMINAL',
        });
        return;
      }

      let auditRec;
      try {
        auditRec = await emitAudit('compliance.cam.review.rejected', {
          actionId,
          orgId: existing.org_id,
          previousStatus: existing.status,
          newStatus: 'rejected',
          reviewer,
          reason,
          at: new Date().toISOString(),
        });
      } catch (auditErr: any) {
        logger.error('cam_reject_audit_failed', { actionId, err: auditErr?.message });
        res.status(500).json({
          success: false,
          error: 'Audit chain unavailable — rejection not recorded',
          code: 'CAM_AUDIT_APPEND_FAILED',
        });
        return;
      }

      const updRes: any = await db.execute(sql`
        UPDATE nv_cam_actions
        SET status      = 'rejected',
            reviewed_by = ${reviewer.id},
            reviewed_at = NOW(),
            updated_at  = NOW(),
            metadata    = COALESCE(metadata, '{}'::jsonb)
                          || jsonb_build_object('rejection_reason', ${reason}::text)
        WHERE action_id = ${actionId}
        RETURNING action_id, org_id, status, reviewed_by, reviewed_at, metadata
      `);
      const updated = (updRes?.rows?.[0] ?? updRes?.[0]) as any;

      res.json({ success: true, action: updated, audit: { id: auditRec.id, recordHash: auditRec.recordHash } });
    } catch (err: any) {
      logger.error('cam_reject_failed', { actionId, err: err?.message });
      res.status(500).json({ success: false, error: 'Failed to reject action', code: 'CAM_REJECT_ERROR' });
    }
  },
);

// POST /api/jrx/cam/reviews/:actionId/assign
router.post(
  '/reviews/:actionId/assign',
  requireRole(...REVIEWER_ROLES),
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthRequest;
    if (!db) {
      res.status(503).json({ success: false, error: 'Database not available', code: 'CAM_DB_UNAVAILABLE' });
      return;
    }
    await ensureTable();
    const actionId = String(req.params.actionId);
    const reviewer = reviewerIdentity(authReq);
    const assignee = typeof req.body?.assignee === 'string' ? req.body.assignee.trim() : '';

    if (!assignee) {
      res.status(400).json({ success: false, error: 'assignee is required', code: 'CAM_ASSIGN_TARGET_REQUIRED' });
      return;
    }

    try {
      const existing = await loadAction(actionId);
      if (!existing) {
        res.status(404).json({ success: false, error: 'Action not found', code: 'CAM_ACTION_NOT_FOUND' });
        return;
      }
      // Task #353: cross-tenant write guard.
      try { assertCamRowAccess(req, existing); }
      catch {
        res.status(404).json({ success: false, error: 'Action not found', code: 'CAM_ACTION_NOT_FOUND' });
        return;
      }
      if (existing.status === 'approved' || existing.status === 'rejected') {
        res.status(409).json({
          success: false,
          error: `Action already ${existing.status} — cannot reassign`,
          code: 'CAM_ACTION_TERMINAL',
        });
        return;
      }

      const nextStatus = existing.status === 'pending' ? 'in_review' : existing.status;

      let auditRec;
      try {
        auditRec = await emitAudit('compliance.cam.review.assigned', {
          actionId,
          orgId: existing.org_id,
          previousAssignee: existing.assigned_to,
          newAssignee: assignee,
          previousStatus: existing.status,
          newStatus: nextStatus,
          reviewer,
          at: new Date().toISOString(),
        });
      } catch (auditErr: any) {
        logger.error('cam_assign_audit_failed', { actionId, err: auditErr?.message });
        res.status(500).json({
          success: false,
          error: 'Audit chain unavailable — assignment not recorded',
          code: 'CAM_AUDIT_APPEND_FAILED',
        });
        return;
      }

      const updRes: any = await db.execute(sql`
        UPDATE nv_cam_actions
        SET assigned_to = ${assignee},
            status      = ${nextStatus},
            updated_at  = NOW()
        WHERE action_id = ${actionId}
        RETURNING action_id, org_id, status, assigned_to, updated_at
      `);
      const updated = (updRes?.rows?.[0] ?? updRes?.[0]) as any;

      res.json({ success: true, action: updated, audit: { id: auditRec.id, recordHash: auditRec.recordHash } });
    } catch (err: any) {
      logger.error('cam_assign_failed', { actionId, err: err?.message });
      res.status(500).json({ success: false, error: 'Failed to assign action', code: 'CAM_ASSIGN_ERROR' });
    }
  },
);

export default router;
