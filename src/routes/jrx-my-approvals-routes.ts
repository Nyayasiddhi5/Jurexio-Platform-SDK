/**
 * jrx-my-approvals-routes.ts — Task #337 (2026-05-13, hardened post-review)
 *
 * Real backend for the Console "My Approvals" page (`/console/my-approvals`),
 * replacing the Phase-C 501 stub at `/api/jrx/phase-c/my-approvals`.
 *
 * Endpoints (mounted behind `dualSdkOrJwt` — Console JWT or partner SDK key):
 *   GET  /api/jrx/my-approvals
 *        — List HITL items the caller is allowed to action. By default
 *          scopes to assigned_to = caller (id OR email). Operators / managers
 *          / org_admins / super_admins additionally see role-fallback rows
 *          (assigned_to NULL, scoped to caller's org_id when an org_id is
 *          known) and can opt into a wider view via ?unassigned=1.
 *          Joins LATERAL onto the latest nv_hitl_decisions row so historical
 *          items show the prior decision + chain hash.
 *          Query: ?status=pending|decided|escalated|all (default 'pending'),
 *                 ?limit=50, ?offset=0
 *
 *   POST /api/jrx/my-approvals/:request_id/decision
 *        — Record reviewer decision. Body: { decision: 'approve'|'reject'|
 *          'modify'|'escalate', reason?, policy_refs?: string[],
 *          modified_output?: any }.
 *          AUTHORIZATION (defence in depth):
 *            • The caller MUST be the row's assigned_to (by user id OR
 *              email), OR
 *            • the caller MUST hold a privileged role
 *              (operator / manager / org_admin / super_admin / admin),
 *              AND the row's org_id MUST match the caller's org_id when
 *              both are known (super_admin / admin can decide cross-org).
 *          Otherwise 403.
 *          Atomically updates `nv_hitl_queue.status` + `decided_at` and
 *          INSERTs `nv_hitl_decisions` with an inline tamper-evident
 *          hash-chain receipt: `record_hash = SHA-256(prev_hash || canonical
 *          decision payload)`, where `prev_hash` is the most recent
 *          decision's `record_hash` (or '' for the genesis row). The chain
 *          per request_id is verifiable by rehashing in order.
 *
 * NV-AUTH-HEADER-001: dualSdkOrJwt mounts under one canonical SDK header
 *   (`X-API-Key`) and the existing JWT fallback. No new accepted headers.
 * NV-OWNERSHIP-001: queries our own `public.nv_hitl_*` tables; gracefully
 *   returns an empty list if the tables aren't provisioned yet.
 */

import { Router, Request, Response } from 'express';
import { createHash } from 'crypto';
import { dualSdkOrJwt } from '../middleware/jrx-dual-auth.js';
import { bridgeJwtOrgToSdkContext } from '../middleware/jrx-jwt-org-bridge.js';
import { pool } from '../db/index.js';
import { createLogger } from '../utils/logger.js';
import { sendApiError, safeError } from '../utils/jrx-api-error.js';
import {
  getRbacIdentityFromRequest,
  classifyLayer,
} from '../services/rbac/jrx-customer-org-rbac.js';

const logger = createLogger('./jrx-my-approvals');
const router = Router();

router.use(dualSdkOrJwt);
// Task #353: bridge JWT identities into req.sdkContext so the HITL filter
// can AND in customer_org_id for Console reviewers the same way it does
// for SDK callers (sdkContext.customerOrgId resolved by sdkGatewayAuth).
router.use((req, res, next) => { void bridgeJwtOrgToSdkContext(req, res, next); });

const VALID_DECISIONS = new Set(['approve', 'reject', 'modify', 'escalate']);
const DECISION_TO_STATUS: Record<string, string> = {
  approve: 'decided',
  reject: 'decided',
  modify: 'decided',
  escalate: 'escalated',
};

// Roles allowed to ACT on (decide) HITL items via the role-fallback path.
// Intentionally narrow: only documented approval actors. Analyst /
// senior_analyst are listing-only (they can see role-fallback rows but
// cannot decide unless they are the explicit assignee).
const DECISION_ROLES = new Set([
  'operator', 'manager', 'org_admin', 'super_admin', 'admin',
]);
// Roles allowed to SEE role-fallback rows (assigned_to IS NULL with a
// matching assigned_role). Superset of DECISION_ROLES so analysts can
// triage but not decide.
const FALLBACK_VIEW_ROLES = new Set([
  ...DECISION_ROLES,
  'analyst', 'senior_analyst',
]);
const CROSS_ORG_ROLES = new Set(['super_admin', 'admin']);
// SDK callers are listing-only and may never decide, even on rows whose
// assigned_role is literally 'sdk'. Decisioning requires a human reviewer
// identity (Console JWT).
const SDK_ROLE = 'sdk';

interface CallerIdentity {
  email: string | null;
  id: string | null;
  role: string;
  orgId: string | null;
  isSdkOnly: boolean;        // X-API-Key with no JWT identity
  canViewFallback: boolean;  // role allowed to see assigned_role fallback rows
  canDecide: boolean;        // role allowed to decide via role fallback
  canCrossOrg: boolean;      // can act on rows outside their org_id
}

function identifyCaller(req: Request): CallerIdentity {
  const u: any = (req as any).user ?? {};
  const sdk: any = (req as any).sdkContext ?? {};
  const hasJwtIdentity = Boolean(u.email || u.id || u.userId);
  const role: string = hasJwtIdentity ? String(u.role ?? 'analyst') : SDK_ROLE;
  return {
    email: u.email ? String(u.email) : null,
    id: u.id != null ? String(u.id) : (u.userId != null ? String(u.userId) : null),
    role,
    orgId:
      u.organizationId != null ? String(u.organizationId)
      : u.orgId         != null ? String(u.orgId)
      : sdk.organizationId != null ? String(sdk.organizationId)
      : null,
    isSdkOnly: !hasJwtIdentity && Boolean(sdk),
    canViewFallback: FALLBACK_VIEW_ROLES.has(role) || role === SDK_ROLE,
    canDecide: DECISION_ROLES.has(role),
    canCrossOrg: CROSS_ORG_ROLES.has(role),
  };
}

// Self-healing: ensure nv_hitl_queue / nv_hitl_decisions expose every column
// the GET query references. Legacy / minimal EC2 installs were missing
// assigned_to, customer_org_id, etc., which made the SELECT 500 with
// `column "…" does not exist`. We additively widen both tables (idempotent)
// AND introspect the live schema so the SELECT degrades gracefully (emits
// NULL for any column an ALTER could not add). Idempotent + safe.
let _columnEnsured = false;
let _hitlDecisionCols: Set<string> | null = null;
let _hitlQueueCols: Set<string> | null = null;
async function getDecisionColumnSet(clientLike: { query: (sql: string, params?: unknown[]) => Promise<any> }): Promise<Set<string>> {
  if (_hitlDecisionCols) return _hitlDecisionCols;
  const res = await clientLike.query(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'nv_hitl_decisions'`,
  );
  _hitlDecisionCols = new Set((res.rows ?? []).map((r: any) => String(r.column_name)));
  return _hitlDecisionCols;
}

async function getQueueColumnSet(clientLike: { query: (sql: string, params?: unknown[]) => Promise<any> }): Promise<Set<string>> {
  if (_hitlQueueCols) return _hitlQueueCols;
  const res = await clientLike.query(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'nv_hitl_queue'`,
  );
  _hitlQueueCols = new Set((res.rows ?? []).map((r: any) => String(r.column_name)));
  return _hitlQueueCols;
}

async function ensureHitlTables(): Promise<boolean> {
  if (!pool) return false;
  try {
    const r = await pool.query(
      `SELECT to_regclass('public.nv_hitl_queue')   AS q,
              to_regclass('public.nv_hitl_decisions') AS d`,
    );
    const ok = Boolean(r.rows?.[0]?.q && r.rows?.[0]?.d);
    if (ok && !_columnEnsured) {
      try {
        // Widen nv_hitl_queue with every column the GET SELECT / WHERE
        // references. Legacy installs only had a subset; types mirror the
        // canonical governance migration (2026-05-14-jrx-governance-tables.sql)
        // and the customer-org cutover (drizzle/0012). All idempotent.
        await pool.query(
          `ALTER TABLE nv_hitl_queue
             ADD COLUMN IF NOT EXISTS request_id      varchar(120),
             ADD COLUMN IF NOT EXISTS org_id          integer     NOT NULL DEFAULT 1,
             ADD COLUMN IF NOT EXISTS customer_org_id bigint,
             ADD COLUMN IF NOT EXISTS platform        varchar(20),
             ADD COLUMN IF NOT EXISTS jurisdiction    varchar(10),
             ADD COLUMN IF NOT EXISTS agent_key       varchar(120),
             ADD COLUMN IF NOT EXISTS category        varchar(60),
             ADD COLUMN IF NOT EXISTS severity        varchar(20)  NOT NULL DEFAULT 'medium',
             ADD COLUMN IF NOT EXISTS payload_summary text,
             ADD COLUMN IF NOT EXISTS status          varchar(20)  NOT NULL DEFAULT 'pending',
             ADD COLUMN IF NOT EXISTS assigned_to     varchar(120),
             ADD COLUMN IF NOT EXISTS assigned_role   varchar,
             ADD COLUMN IF NOT EXISTS sla_minutes     integer      NOT NULL DEFAULT 60,
             ADD COLUMN IF NOT EXISTS created_at      timestamptz  NOT NULL DEFAULT NOW(),
             ADD COLUMN IF NOT EXISTS decided_at      timestamptz`,
        );
        await pool.query(
          `CREATE INDEX IF NOT EXISTS idx_nv_hitl_queue_assigned_role
             ON nv_hitl_queue (assigned_role)
           WHERE assigned_to IS NULL`,
        );
        await pool.query(
          `ALTER TABLE nv_hitl_decisions
             ADD COLUMN IF NOT EXISTS decided_by text`,
        );
        await pool.query(
          `ALTER TABLE nv_hitl_decisions
             ADD COLUMN IF NOT EXISTS decided_at timestamptz`,
        );
        await pool.query(
          `ALTER TABLE nv_hitl_decisions
             ADD COLUMN IF NOT EXISTS reason text`,
        );
        await pool.query(
          `ALTER TABLE nv_hitl_decisions
             ADD COLUMN IF NOT EXISTS policy_refs jsonb NOT NULL DEFAULT '[]'::jsonb`,
        );
        await pool.query(
          `ALTER TABLE nv_hitl_decisions
             ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb`,
        );
        _columnEnsured = true;
        // Invalidate introspection caches so the defensive SELECT/WHERE
        // picks up the freshly-added columns on this same request.
        _hitlQueueCols = null;
        _hitlDecisionCols = null;
      } catch (err: any) {
        logger.warn('hitl_queue_self_heal_alter_failed', { error: err?.message });
      }
    }
    return ok;
  } catch {
    return false;
  }
}

/* ─────────────────────────────────────────────────────────────────────────
 * GET /api/jrx/my-approvals
 * ─────────────────────────────────────────────────────────────────────── */
router.get('/', async (req: Request, res: Response): Promise<void> => {
  const caller = identifyCaller(req);
  if (!caller.email && !caller.id && !caller.orgId) {
    sendApiError(res, 'BAD_REQUEST', { status: 401, overrideMessage: 'No reviewer identity on token / SDK key' });
    return;
  }

  const status = String(req.query.status ?? 'pending');
  const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 50)));
  const offset = Math.max(0, Number(req.query.offset ?? 0));

  const tablesReady = await ensureHitlTables();
  if (!tablesReady || !pool) {
    res.json({
      success: true,
      data: { items: [], total: 0, limit, offset, reviewer: caller.email || null,
              note: 'nv_hitl_queue not provisioned on this environment' },
    });
    return;
  }

  // Introspect the live nv_hitl_queue schema so a minimal / legacy install
  // (missing columns the SELECT/WHERE reference) degrades to 200 instead of
  // 500. ensureHitlTables() already ALTERs the columns in; this is the
  // belt-and-suspenders if an ALTER was blocked.
  const qcols = await getQueueColumnSet(pool);
  const hasQ = (c: string): boolean => qcols.has(c);

  const where: string[] = [];
  const args: unknown[] = [];
  let i = 1;

  if (status !== 'all' && hasQ('status')) {
    where.push(`q.status = $${i++}`);
    args.push(status);
  }

  // Visibility contract (per task #337):
  //   (assigned_to = caller_id OR caller_email)
  //     OR
  //   (assigned_to IS NULL AND assigned_role = caller.role)
  //
  // ALL roles — including admin/super_admin — default to this per-user view
  // to prevent broken-access-control cross-user data exposure. Admin and
  // super_admin can OPT IN to a wider scope via an explicit, audited query
  // flag:
  //   ?scope=org   → all rows in caller's org_id (admin / super_admin only)
  //   ?scope=all   → cross-org, all rows (super_admin only)
  // Anything else falls back to per-user.
  //
  // SDK-only callers (X-API-Key, no JWT identity) get role='sdk', so they
  // see only rows whose assigned_role='sdk' inside their org. They may
  // never decide (enforced in POST handler).
  const requestedScope = String(req.query.scope ?? 'me').toLowerCase();
  const allowOrgScope  = requestedScope === 'org' && (caller.canCrossOrg || caller.role === 'org_admin');
  const allowAllScope  = requestedScope === 'all' && caller.role === 'super_admin';
  const effectiveScope = allowAllScope ? 'all' : (allowOrgScope ? 'org' : 'me');

  if (effectiveScope === 'me') {
    const orParts: string[] = [];

    if (hasQ('assigned_to')) {
      if (caller.id) {
        orParts.push(`q.assigned_to::text = $${i++}`);
        args.push(caller.id);
      }
      if (caller.email) {
        orParts.push(`q.assigned_to::text = $${i++}`);
        args.push(caller.email);
      }

      if (caller.canViewFallback && hasQ('assigned_role')) {
        orParts.push(`(q.assigned_to IS NULL AND q.assigned_role = $${i++})`);
        args.push(caller.role);
      }
    }

    if (orParts.length === 0) {
      // No assignment columns to scope by → fail closed (empty) rather than
      // expose the whole queue. Safe on a legacy schema where the ALTER could
      // not add assigned_to / assigned_role.
      res.json({
        success: true,
        data: { items: [], total: 0, limit, offset, reviewer: caller.email || null,
                note: 'no reviewer identity bound to this caller' },
      });
      return;
    }
    where.push(`(${orParts.join(' OR ')})`);

    if (hasQ('org_id')) {
      if (caller.orgId) {
        where.push(`q.org_id::text = $${i++}`);
        args.push(caller.orgId);
      } else {
        where.push('q.org_id IS NULL');
      }
    }
  } else if (effectiveScope === 'org') {
    if (!caller.orgId) {
      sendApiError(res, 'BAD_REQUEST', { overrideMessage: 'scope=org requires an org_id on the caller' });
      return;
    }
    if (hasQ('org_id')) {
      where.push(`q.org_id::text = $${i++}`);
      args.push(caller.orgId);
    }
    logger.warn('my_approvals_widened_scope', { scope: 'org', reviewerEmail: caller.email, role: caller.role, orgId: caller.orgId });
  } else {
    // 'all' — super_admin cross-org. Audited.
    logger.warn('my_approvals_widened_scope', { scope: 'all', reviewerEmail: caller.email, role: caller.role });
  }

  // Task #353: AND in customer_org_id. Two firms (e.g. Sharma & Co +
  // Lex LLP) sharing one platform key end up with the same caller.orgId;
  // only customer_org_id distinguishes them. Layer rules:
  //   - super_admin                 → no extra filter
  //   - platform_admin              → org_id only is fine
  //   - customer_org_admin / user   → MUST have customerOrgId, else fail
  //                                    closed (1=0) so a missing
  //                                    X-Customer-Org-Id never falls back
  //                                    to org-only scoping
  // Explicit `scope=all` is gated to canCrossOrg above (super_admin only),
  // so the layer check below is the only gate that matters here.
  const rbacIdentity = getRbacIdentityFromRequest(req);
  const layer = classifyLayer(rbacIdentity);
  if (layer === 'customer_org_admin' || layer === 'customer_user') {
    if (rbacIdentity.customerOrgId == null) {
      logger.warn('my_approvals_failed_closed_no_customer_org', {
        reviewerEmail: caller.email, role: caller.role, layer,
      });
      where.push('1 = 0');
    } else if (hasQ('customer_org_id')) {
      where.push(`q.customer_org_id = $${i++}`);
      args.push(rbacIdentity.customerOrgId);
    }
  } else if (layer === 'platform_admin' && effectiveScope !== 'all'
             && rbacIdentity.customerOrgId != null && hasQ('customer_org_id')) {
    // Optional tightening for platform_admin who DOES carry a customer
    // org assertion (e.g. an SDK key acting on behalf of one firm).
    where.push(`q.customer_org_id = $${i++}`);
    args.push(rbacIdentity.customerOrgId);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  // Defensive projection: emit q.<col> when present, NULL otherwise, so a
  // legacy schema missing a column still returns a stable item shape (200)
  // rather than `column "…" does not exist` (500).
  const qsel = (c: string): string => (hasQ(c) ? `q.${c}` : `NULL AS ${c}`);
  const QUEUE_PROJECTED = [
    'id', 'request_id', 'org_id', 'customer_org_id', 'platform', 'jurisdiction',
    'agent_key', 'category', 'severity', 'payload_summary', 'status',
    'assigned_to', 'sla_minutes', 'created_at', 'decided_at',
  ];
  const queueSelectSql = QUEUE_PROJECTED.map(qsel).join(',\n        ');
  // The latest-decision LATERAL join keys off request_id; if that column is
  // absent the join simply matches nothing.
  const qReqIdExpr = hasQ('request_id') ? 'q.request_id' : 'NULL';
  const orderParts: string[] = [];
  if (hasQ('status')) orderParts.push(`CASE WHEN q.status = 'pending' THEN 0 ELSE 1 END`);
  if (hasQ('created_at')) orderParts.push('q.created_at DESC');
  const orderSql = orderParts.length ? `ORDER BY ${orderParts.join(', ')}` : '';

  try {
    const listSql = `
      SELECT
        ${queueSelectSql},
        d.decision      AS decision,
        d.decided_by    AS decided_by,
        d.reason        AS decision_reason,
        d.policy_refs   AS decision_policy_refs,
        d.metadata      AS decision_metadata
      FROM nv_hitl_queue q
      LEFT JOIN LATERAL (
        SELECT
          d0.j ->> 'decision' AS decision,
          COALESCE(
            d0.j ->> 'decided_by',
            d0.j ->> 'reviewer_email',
            d0.j ->> 'reviewed_by'
          ) AS decided_by,
          d0.j ->> 'reason' AS reason,
          COALESCE(d0.j -> 'policy_refs', '[]'::jsonb) AS policy_refs,
          COALESCE(d0.j -> 'metadata', '{}'::jsonb) AS metadata
        FROM (
          SELECT to_jsonb(dfull) AS j
            FROM (
              SELECT *
                FROM nv_hitl_decisions
               WHERE request_id = ${qReqIdExpr}
               ORDER BY decided_at DESC NULLS LAST
               LIMIT 1
            ) dfull
        ) d0
      ) d ON TRUE
      ${whereSql}
      ${orderSql}
      LIMIT $${i++} OFFSET $${i++}
    `;
    args.push(limit, offset);

    const countArgs = args.slice(0, args.length - 2);
    const countSql = `SELECT COUNT(*)::int AS n FROM nv_hitl_queue q ${whereSql}`;

    const [listRes, countRes] = await Promise.all([
      pool.query(listSql, args),
      pool.query(countSql, countArgs),
    ]);

    res.json({
      success: true,
      data: {
        items: (listRes.rows ?? []).map((r: any) => ({
          ...r,
          // Surface the hash-chain receipt for the UI so reviewers can
          // visually confirm the decision is anchored.
          decision_record_hash: r.decision_metadata?.record_hash ?? null,
          decision_prev_hash:   r.decision_metadata?.prev_hash   ?? null,
        })),
        total: countRes.rows?.[0]?.n ?? 0,
        limit,
        offset,
        reviewer: caller.email || null,
        reviewer_role: caller.role,
        can_decide: caller.canDecide,
        sdk_only: caller.isSdkOnly,
        filter: { status },
      },
    });
  } catch (err: any) {
    logger.error('my_approvals_list_failed', { error: err?.message, reviewerEmail: caller.email });
    safeError(res, err, 500);
  }
});

/* ─────────────────────────────────────────────────────────────────────────
 * POST /api/jrx/my-approvals/:request_id/decision
 * ─────────────────────────────────────────────────────────────────────── */
router.post('/:request_id/decision', async (req: Request, res: Response): Promise<void> => {
  const caller = identifyCaller(req);
  const reviewerEmail = caller.email;
  const reviewerId = caller.id ?? reviewerEmail;

  if (!reviewerEmail && !reviewerId) {
    sendApiError(res, 'BAD_REQUEST', { status: 401, overrideMessage: 'No reviewer identity on token / SDK key' });
    return;
  }

  const requestId = String(req.params.request_id ?? '').trim();
  if (!requestId) {
    sendApiError(res, 'BAD_REQUEST', { overrideMessage: 'request_id is required in URL' });
    return;
  }

  const body = req.body ?? {};
  const decision = String(body.decision ?? '').toLowerCase();
  if (!VALID_DECISIONS.has(decision)) {
    sendApiError(res, 'BAD_REQUEST', {
      overrideMessage: `Invalid decision '${decision}'. Allowed: approve|reject|modify|escalate`,
    });
    return;
  }
  const reason: string | null = body.reason ? String(body.reason).slice(0, 4000) : null;
  const policyRefs: string[] = Array.isArray(body.policy_refs) ? body.policy_refs.map(String) : [];
  const modifiedOutput: unknown = body.modified_output ?? null;

  const tablesReady = await ensureHitlTables();
  if (!tablesReady || !pool) {
    sendApiError(res, 'BAD_REQUEST', { status: 503, overrideMessage: 'HITL tables not provisioned on this environment' });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const exists = await client.query(
      `SELECT id, status, assigned_to, org_id, customer_org_id
         FROM nv_hitl_queue WHERE request_id = $1 LIMIT 1`,
      [requestId],
    );
    const row = exists.rows?.[0];
    if (!row) {
      await client.query('ROLLBACK');
      sendApiError(res, 'NOT_FOUND', { status: 404, overrideMessage: `HITL row not found: ${requestId}` });
      return;
    }

    // Task #353 — write-path tenant guard (defence in depth).
    //   super_admin                    → bypass
    //   platform_admin                 → org-only check (existing logic
    //                                     below) is sufficient
    //   customer_org_admin / user      → MUST carry a customerOrgId AND
    //                                     it MUST match the row's
    // 404 (not 403) so we don't leak existence of rows belonging to a
    // sibling customer org under the same platform key.
    const rbacIdentity = getRbacIdentityFromRequest(req);
    const layer = classifyLayer(rbacIdentity);
    const rowCustomerOrg = row.customer_org_id == null ? null : Number(row.customer_org_id);
    if (layer === 'customer_org_admin' || layer === 'customer_user') {
      if (rbacIdentity.customerOrgId == null || rowCustomerOrg == null
          || rowCustomerOrg !== rbacIdentity.customerOrgId) {
        await client.query('ROLLBACK');
        logger.warn('my_approvals_decision_failed_closed', {
          requestId, layer,
          callerCustomerOrgId: rbacIdentity.customerOrgId,
          rowCustomerOrgId: rowCustomerOrg,
        });
        sendApiError(res, 'NOT_FOUND', { status: 404, overrideMessage: `HITL row not found: ${requestId}` });
        return;
      }
    } else if (layer === 'platform_admin' && rbacIdentity.customerOrgId != null) {
      // Platform admin asserting a customer org must still match.
      if (rowCustomerOrg != null && rowCustomerOrg !== rbacIdentity.customerOrgId) {
        await client.query('ROLLBACK');
        logger.warn('my_approvals_decision_cross_customer_org_blocked', {
          requestId,
          callerCustomerOrgId: rbacIdentity.customerOrgId,
          rowCustomerOrgId: rowCustomerOrg,
        });
        sendApiError(res, 'NOT_FOUND', { status: 404, overrideMessage: `HITL row not found: ${requestId}` });
        return;
      }
    }

    // ── AUTHORIZATION (defence in depth) ──────────────────────────────────
    // SDK-only callers (X-API-Key without a JWT identity) may NEVER decide.
    // Decisioning requires a Console JWT-attested human reviewer.
    if (caller.isSdkOnly) {
      await client.query('ROLLBACK');
      logger.warn('my_approvals_decision_sdk_blocked', { requestId, decision, callerOrg: caller.orgId });
      sendApiError(res, 'FORBIDDEN', {
        overrideMessage: 'SDK callers are listing-only; decisions require a Console session',
      });
      return;
    }

    // Allowed if EITHER:
    //   1. caller IS assigned_to (by id or email), OR
    //   2. caller holds a DECISION_ROLES role AND
    //      (caller is super_admin/admin → cross-org allowed,
    //       OR caller's org_id matches the row's org_id)
    const assignedTo = row.assigned_to == null ? null : String(row.assigned_to);
    const isAssigneeMatch = assignedTo != null && (
      (reviewerId    != null && assignedTo === reviewerId) ||
      (reviewerEmail != null && assignedTo === reviewerEmail)
    );

    let authorized = false;
    let authReason = '';
    if (isAssigneeMatch) {
      authorized = true; authReason = 'assignee';
    } else if (caller.canDecide) {
      if (caller.canCrossOrg) {
        authorized = true; authReason = 'super_admin';
      } else {
        const rowOrg = row.org_id == null ? null : String(row.org_id);
        if (caller.orgId && rowOrg && caller.orgId === rowOrg) {
          authorized = true; authReason = 'role_org_match';
        } else if (!caller.orgId && rowOrg == null) {
          authorized = true; authReason = 'role_no_org';
        } else {
          authorized = false; authReason = 'role_org_mismatch';
        }
      }
    } else {
      authReason = `role_not_authorized:${caller.role}`;
    }

    if (!authorized) {
      await client.query('ROLLBACK');
      logger.warn('my_approvals_decision_forbidden', {
        requestId, decision, reviewerEmail, reviewerId, callerOrg: caller.orgId,
        rowAssignedTo: assignedTo, rowOrg: row.org_id, role: caller.role, authReason,
      });
      sendApiError(res, 'FORBIDDEN', {
        overrideMessage: 'You are not authorized to decide this approval',
      });
      return;
    }

    // ── HASH-CHAIN RECEIPT ────────────────────────────────────────────────
    // Read the most recent decision's record_hash to chain onto. SHA-256 of
    // canonical JSON (prev_hash || decision payload) yields a reproducible
    // tamper-evident receipt anchored to nv_hitl_decisions.metadata.
    const prior = await client.query(
      `SELECT COALESCE(d0.j -> 'metadata', '{}'::jsonb) AS metadata
         FROM (
           SELECT to_jsonb(dfull) AS j
             FROM (
               SELECT *
                 FROM nv_hitl_decisions
                WHERE request_id = $1
                ORDER BY decided_at DESC NULLS LAST
                LIMIT 1
             ) dfull
         ) d0`,
      [requestId],
    );
    const priorMeta: any = prior.rows?.[0]?.metadata ?? {};
    const prevHash: string = String(priorMeta?.record_hash ?? '') || '';

    const decidedAtIso = new Date().toISOString();
    const canonicalPayload = {
      request_id: requestId,
      decision,
      decided_by: reviewerEmail ?? reviewerId,
      decided_at: decidedAtIso,
      reason,
      policy_refs: policyRefs,
      modified_output: modifiedOutput,
      org_id: row.org_id,
    };
    const recordHash = createHash('sha256')
      .update(prevHash)
      .update('|')
      .update(JSON.stringify(canonicalPayload))
      .digest('hex');

    const newStatus = DECISION_TO_STATUS[decision];
    await client.query(
      `UPDATE nv_hitl_queue
          SET status      = $1,
              decided_at  = NOW(),
              assigned_to = COALESCE(assigned_to, $2)
        WHERE request_id  = $3`,
      [newStatus, reviewerId, requestId],
    );

    const decisionCols = await getDecisionColumnSet(client);
    const insertCols: string[] = [];
    const insertVals: unknown[] = [];
    const insertRefs: string[] = [];
    const add = (col: string, value: unknown, cast = ''): void => {
      insertCols.push(col);
      insertVals.push(value);
      insertRefs.push(`$${insertVals.length}${cast}`);
    };
    add('request_id', requestId);
    add('decision', decision);
    if (decisionCols.has('decided_by')) add('decided_by', reviewerEmail ?? reviewerId);
    else if (decisionCols.has('reviewer_email')) add('reviewer_email', reviewerEmail ?? reviewerId);
    if (decisionCols.has('decided_at')) add('decided_at', decidedAtIso, '::timestamptz');
    if (decisionCols.has('reason')) add('reason', reason);
    if (decisionCols.has('policy_refs')) add('policy_refs', JSON.stringify(policyRefs), '::jsonb');
    if (decisionCols.has('metadata')) {
      add(
        'metadata',
        JSON.stringify({
          modified_output: modifiedOutput,
          reviewer_id: reviewerId,
          reviewer_email: reviewerEmail,
          reviewer_role: caller.role,
          source: 'console.my-approvals',
          // Tamper-evident receipt — the chain is verifiable by rehashing
          // in (decided_at ASC) order per request_id.
          prev_hash: prevHash || null,
          record_hash: recordHash,
          chain_algo: 'sha256(prev_hash|canonical_json_v1)',
          authorized_via: authReason,
        }),
        '::jsonb',
      );
    }
    await client.query(
      `INSERT INTO nv_hitl_decisions (${insertCols.join(', ')})
       VALUES (${insertRefs.join(', ')})`,
      insertVals,
    );

    await client.query('COMMIT');

    logger.info('my_approvals_decision_recorded', {
      requestId, decision, reviewerEmail, newStatus, recordHash, authReason,
    });

    res.json({
      success: true,
      data: {
        request_id: requestId,
        decision,
        status: newStatus,
        decided_by: reviewerEmail ?? reviewerId,
        decided_at: decidedAtIso,
        reason,
        policy_refs: policyRefs,
        receipt: {
          prev_hash: prevHash || null,
          record_hash: recordHash,
          chain_algo: 'sha256(prev_hash|canonical_json_v1)',
        },
      },
    });
  } catch (err: any) {
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    logger.error('my_approvals_decision_failed', { requestId, decision, error: err?.message });
    safeError(res, err, 500);
  } finally {
    client.release();
  }
});

export default router;
