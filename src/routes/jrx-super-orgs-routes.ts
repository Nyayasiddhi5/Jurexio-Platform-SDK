/**
 * Super-Org Admin Routes — Task #384.
 *
 * Mounted at: /api/jrx/sdk/super-orgs
 *
 *   POST   /                           — create / upsert (by slug) a super-org.
 *   GET    /                           — list super-orgs visible to the caller.
 *   GET    /:id                        — fetch one super-org with its memberships.
 *   GET    /:id/members                — list (platform_id, customer_org_id) tuples
 *                                        belonging to the super-org.
 *   POST   /:id/members                — attach a (platform_id, customer_org_id) pair.
 *   DELETE /:id/members/:platform/:co  — detach a tuple.
 *   GET    /me/switchable              — for the calling SDK identity, list the
 *                                        sibling (platform_id, customer_org_id)
 *                                        pairs the caller can switch into via
 *                                        their super-org membership. This is the
 *                                        "ONE login, ONE bill, ONE admin
 *                                        console across all three products" UX
 *                                        primitive.
 *
 * Security model
 *   • Super-org is a grouping/UI/billing layer, NOT a security boundary.
 *     The RLS policy `customer_org_isolation` (drizzle/0013_customer_org_rls.sql)
 *     stays UNCHANGED. Per-platform rate limits and access scopes continue to
 *     be enforced at (platform_id, customer_org_id) — no rollup.
 *   • Mutating routes (POST / DELETE) require an admin-scoped SDK key (same
 *     scope set as jrx-customer-orgs-routes.ts).
 *   • `GET /me/switchable` uses the caller's resolved (platform_id,
 *     customer_org_id) to find their super-org and return ONLY the siblings
 *     of that super-org. A caller with no super-org binding gets an empty list.
 *
 * NV-AUTH-HEADER-001 compliant (X-API-Key only via sdkGatewayAuth).
 * NV-API-CONTRACT-001: additive routes only.
 * NV-WIRING-001: imported and mounted in src/index.ts.
 */

import { Router, Request, Response } from 'express';
import { z, ZodError } from 'zod';
import { sql } from 'drizzle-orm';
import { sdkGatewayAuth } from '../middleware/jrx-sdk-gateway.js';
import { db } from '../db/index.js';
import { createLogger } from '../utils/logger.js';

const router = Router();
const logger = createLogger('./jrx-super-orgs');

router.use(sdkGatewayAuth);

// Code-review fix (Task #384): super-org admin operations are inherently
// CROSS-TENANT (a super-org spans many platforms × customer-orgs). They
// must therefore be locked to a true Jurexio super-admin — NOT to a
// partner-platform org_admin.
//
// Reject the temptation to reuse `customer-orgs:admin` or the JWT-derived
// `admin` scope here: `computeInternalScopesForRole` in jrx-sdk-gateway.ts
// auto-grants `customer-orgs:admin` to every JWT carrying role=org_admin,
// which would let a single platform's admin list / mutate super-orgs that
// belong to other platforms. The only acceptable scopes are the explicit
// `super-orgs:*` SDK key scopes (issued out-of-band by Jurexio ops) and
// the wildcard `*` SDK key. JWTs are accepted only when the verified role
// is `super_admin` (verified by sdkGatewayAuth's JWT bypass path, which
// stamps `req.user`).
const SUPER_ORG_ADMIN_SCOPES = new Set([
  '*',
  'super-orgs:admin',
  'super-orgs:write',
]);

function isSuperAdminCaller(req: Request): boolean {
  const sdk = (req as any).sdkContext;
  const scopes: string[] = Array.isArray(sdk?.scopes) ? sdk.scopes : [];
  if (scopes.some((s) => SUPER_ORG_ADMIN_SCOPES.has(s))) return true;
  // JWT path — accept ONLY a verified super_admin role. We do NOT accept
  // `admin` / `org_admin` here (see comment above on the JWT scope-grant
  // pitfall in computeInternalScopesForRole).
  const user = (req as any).user;
  if (user && (user.role === 'super_admin' || user.isSuperAdmin === true)) return true;
  return false;
}

function requireSuperAdmin(req: Request, res: Response): boolean {
  if (isSuperAdminCaller(req)) return true;
  res.status(403).json({
    success: false,
    error: 'super-org admin endpoints require a Jurexio super-admin (JWT role=super_admin or SDK key scope in super-orgs:*)',
    code: 'SUPER_ORG_SUPER_ADMIN_REQUIRED',
    required_one_of_scopes: Array.from(SUPER_ORG_ADMIN_SCOPES),
  });
  return false;
}

/**
 * Allow access to a SPECIFIC super-org if the caller is either:
 *   1. a true super-admin (above), OR
 *   2. an SDK caller whose resolved (platform_id, customer_org_id) tuple
 *      is a member of THIS super-org. This is the read-your-own-grouping
 *      use case for the Console "switch product" picker.
 *
 * Returns true if allowed, false (and writes 403/404) otherwise.
 */
async function allowReadOfSuperOrg(req: Request, res: Response, superOrgId: number): Promise<boolean> {
  if (isSuperAdminCaller(req)) return true;
  const sdk = (req as any).sdkContext;
  const platformId: number | undefined = sdk?.applicationId ?? sdk?.platformId;
  const customerOrgId: number | undefined = sdk?.customerOrgId;
  if (db && platformId && customerOrgId) {
    try {
      const r: any = await db.execute(sql`
        SELECT 1 FROM nv_super_org_platform_memberships
         WHERE super_org_id = ${superOrgId}
           AND platform_id  = ${platformId}
           AND customer_org_id = ${customerOrgId}
         LIMIT 1
      `);
      if ((r?.rows?.[0] ?? r?.[0])) return true;
    } catch (err: any) {
      logger.warn('super_org_membership_check_failed', { superOrgId, err: err?.message });
    }
  }
  // Indistinguishable 404 — do NOT leak existence to non-members.
  res.status(404).json({
    success: false,
    error: 'super-org not found',
    code: 'SUPER_ORG_NOT_FOUND',
  });
  return false;
}

const SAFE_SLUG = /^[a-z0-9][a-z0-9._-]{0,127}$/;

const SUPER_ORG_STATUSES = ['active', 'suspended', 'archived'] as const;

const UpsertSchema = z.object({
  name: z.string().min(1).max(255),
  slug: z.string().regex(SAFE_SLUG, 'slug must be 1-128 chars of [a-z0-9._-] starting with [a-z0-9]'),
  billing_email: z.string().email().max(320).optional(),
  status: z.enum(SUPER_ORG_STATUSES).optional(),
  metadata: z.record(z.unknown()).optional(),
});

const AttachMemberSchema = z.object({
  platform_id: z.number().int().positive(),
  customer_org_id: z.number().int().positive(),
  role: z.string().min(1).max(50).optional(),
  metadata: z.record(z.unknown()).optional(),
});

function dbOr503(res: Response): boolean {
  if (!db) {
    res.status(503).json({ success: false, error: 'Database unavailable', code: 'DB_UNAVAILABLE' });
    return false;
  }
  return true;
}

// POST /  — upsert super-org by slug. Cross-tenant operation: super-admin only.
router.post('/', async (req: Request, res: Response): Promise<void> => {
  if (!requireSuperAdmin(req, res)) return;
  if (!dbOr503(res)) return;
  try {
    const body = UpsertSchema.parse(req.body ?? {});
    const r: any = await db!.execute(sql`
      INSERT INTO nv_super_orgs (name, slug, billing_email, status, metadata)
      VALUES (
        ${body.name},
        ${body.slug},
        ${body.billing_email ?? null},
        ${body.status ?? 'active'},
        ${JSON.stringify(body.metadata ?? {})}::jsonb
      )
      ON CONFLICT (slug) DO UPDATE
        SET name          = EXCLUDED.name,
            billing_email = COALESCE(EXCLUDED.billing_email, nv_super_orgs.billing_email),
            status        = COALESCE(EXCLUDED.status, nv_super_orgs.status),
            metadata      = nv_super_orgs.metadata || EXCLUDED.metadata,
            updated_at    = NOW()
      RETURNING id, name, slug, billing_email, status, metadata, created_at, updated_at
    `);
    const row = r?.rows?.[0] ?? r?.[0] ?? null;
    res.status(200).json({ success: true, data: row });
  } catch (err: any) {
    if (err instanceof ZodError) {
      res.status(400).json({ success: false, error: 'invalid body', detail: err.errors });
      return;
    }
    logger.error('super_org_upsert_failed', { err: err?.message });
    res.status(500).json({ success: false, error: 'Failed to upsert super-org', code: 'SUPER_ORG_UPSERT_FAILED' });
  }
});

// GET /  — list ALL super-orgs (cross-tenant): super-admin only. Non-super-
// admin callers should use GET /me/switchable to discover their own grouping.
router.get('/', async (req: Request, res: Response): Promise<void> => {
  if (!requireSuperAdmin(req, res)) return;
  if (!dbOr503(res)) return;
  try {
    const r: any = await db!.execute(sql`
      SELECT s.id, s.name, s.slug, s.billing_email, s.status, s.metadata,
             s.created_at, s.updated_at,
             COALESCE(m.member_count, 0)::int AS member_count
        FROM nv_super_orgs s
        LEFT JOIN (
          SELECT super_org_id, COUNT(*) AS member_count
            FROM nv_super_org_platform_memberships
           GROUP BY super_org_id
        ) m ON m.super_org_id = s.id
       ORDER BY s.created_at DESC
       LIMIT 500
    `);
    res.status(200).json({ success: true, data: r?.rows ?? r ?? [] });
  } catch (err: any) {
    logger.error('super_org_list_failed', { err: err?.message });
    res.status(500).json({ success: false, error: 'Failed to list super-orgs', code: 'SUPER_ORG_LIST_FAILED' });
  }
});

// GET /:id — fetch one with memberships. Allowed for super-admin OR a member
// SDK caller (read-your-own-grouping). Non-members get an indistinguishable
// 404 so this endpoint cannot be used to enumerate super-org existence.
router.get('/:id(\\d+)', async (req: Request, res: Response): Promise<void> => {
  if (!dbOr503(res)) return;
  const id = Number(req.params.id);
  if (!(await allowReadOfSuperOrg(req, res, id))) return;
  try {
    const head: any = await db!.execute(sql`
      SELECT id, name, slug, billing_email, status, metadata, created_at, updated_at
        FROM nv_super_orgs WHERE id = ${id} LIMIT 1
    `);
    const row = head?.rows?.[0] ?? head?.[0] ?? null;
    if (!row) {
      res.status(404).json({ success: false, error: 'super-org not found', code: 'SUPER_ORG_NOT_FOUND' });
      return;
    }
    const members: any = await db!.execute(sql`
      SELECT m.platform_id, m.customer_org_id, m.role, m.joined_at,
             a.app_name AS platform_name,
             c.external_ref AS customer_external_ref,
             c.display_name AS customer_display_name
        FROM nv_super_org_platform_memberships m
        LEFT JOIN sdk_applications a            ON a.id = m.platform_id
        LEFT JOIN nv_customer_organizations c   ON c.id = m.customer_org_id
       WHERE m.super_org_id = ${id}
       ORDER BY m.platform_id, m.customer_org_id
    `);
    res.status(200).json({
      success: true,
      data: { ...row, members: members?.rows ?? members ?? [] },
    });
  } catch (err: any) {
    logger.error('super_org_get_failed', { id, err: err?.message });
    res.status(500).json({ success: false, error: 'Failed to load super-org', code: 'SUPER_ORG_GET_FAILED' });
  }
});

// GET /:id/members — list members. Same access rule as GET /:id.
router.get('/:id(\\d+)/members', async (req: Request, res: Response): Promise<void> => {
  if (!dbOr503(res)) return;
  const id = Number(req.params.id);
  if (!(await allowReadOfSuperOrg(req, res, id))) return;
  try {
    const r: any = await db!.execute(sql`
      SELECT m.platform_id, m.customer_org_id, m.role, m.joined_at, m.metadata,
             a.app_name AS platform_name,
             c.external_ref AS customer_external_ref,
             c.display_name AS customer_display_name
        FROM nv_super_org_platform_memberships m
        LEFT JOIN sdk_applications a            ON a.id = m.platform_id
        LEFT JOIN nv_customer_organizations c   ON c.id = m.customer_org_id
       WHERE m.super_org_id = ${id}
       ORDER BY m.platform_id, m.customer_org_id
    `);
    res.status(200).json({ success: true, data: r?.rows ?? r ?? [] });
  } catch (err: any) {
    logger.error('super_org_members_failed', { id, err: err?.message });
    res.status(500).json({ success: false, error: 'Failed to list super-org members', code: 'SUPER_ORG_MEMBERS_FAILED' });
  }
});

// POST /:id/members — attach a (platform_id, customer_org_id) pair.
// The unique index on (platform_id, customer_org_id) at the DB level guarantees
// a tenant tuple can belong to AT MOST one super-org — a re-bind requires an
// explicit DELETE first. We surface a clear 409 here instead of a raw 23505.
router.post('/:id(\\d+)/members', async (req: Request, res: Response): Promise<void> => {
  // Mutating a super-org's membership crosses tenant boundaries by
  // construction (the new tuple may belong to a different platform than
  // the caller). Lock to true super-admin only.
  if (!requireSuperAdmin(req, res)) return;
  if (!dbOr503(res)) return;
  const id = Number(req.params.id);
  try {
    const body = AttachMemberSchema.parse(req.body ?? {});
    // Validate the (platform, customer_org) tuple actually exists & is consistent.
    const tuple: any = await db!.execute(sql`
      SELECT id, platform_id FROM nv_customer_organizations
       WHERE id = ${body.customer_org_id} AND platform_id = ${body.platform_id}
       LIMIT 1
    `);
    const tupleRow = tuple?.rows?.[0] ?? tuple?.[0] ?? null;
    if (!tupleRow) {
      res.status(400).json({
        success: false,
        error: 'customer_org_id does not belong to platform_id',
        code: 'SUPER_ORG_MEMBER_TUPLE_INVALID',
      });
      return;
    }
    try {
      await db!.execute(sql`
        INSERT INTO nv_super_org_platform_memberships
          (super_org_id, platform_id, customer_org_id, role, metadata)
        VALUES (${id}, ${body.platform_id}, ${body.customer_org_id},
                ${body.role ?? 'member'},
                ${JSON.stringify(body.metadata ?? {})}::jsonb)
      `);
    } catch (err: any) {
      if (String(err?.code) === '23505') {
        res.status(409).json({
          success: false,
          error: '(platform_id, customer_org_id) is already bound to a super-org; detach it first',
          code: 'SUPER_ORG_MEMBER_TUPLE_TAKEN',
        });
        return;
      }
      throw err;
    }
    // Best-effort denormalisation of the convenience back-pointer.
    await db!.execute(sql`
      UPDATE nv_customer_organizations
         SET super_org_id = ${id}, updated_at = NOW()
       WHERE id = ${body.customer_org_id}
    `);
    res.status(201).json({
      success: true,
      data: {
        super_org_id: id,
        platform_id: body.platform_id,
        customer_org_id: body.customer_org_id,
        role: body.role ?? 'member',
      },
    });
  } catch (err: any) {
    if (err instanceof ZodError) {
      res.status(400).json({ success: false, error: 'invalid body', detail: err.errors });
      return;
    }
    logger.error('super_org_attach_failed', { id, err: err?.message });
    res.status(500).json({ success: false, error: 'Failed to attach member', code: 'SUPER_ORG_ATTACH_FAILED' });
  }
});

// DELETE /:id/members/:platform/:co — detach a tuple.
router.delete('/:id(\\d+)/members/:platform(\\d+)/:co(\\d+)', async (req: Request, res: Response): Promise<void> => {
  if (!requireSuperAdmin(req, res)) return;
  if (!dbOr503(res)) return;
  const id = Number(req.params.id);
  const platform = Number(req.params.platform);
  const co = Number(req.params.co);
  try {
    await db!.execute(sql`
      DELETE FROM nv_super_org_platform_memberships
       WHERE super_org_id = ${id}
         AND platform_id  = ${platform}
         AND customer_org_id = ${co}
    `);
    // Clear the convenience back-pointer iff it pointed at THIS super-org.
    await db!.execute(sql`
      UPDATE nv_customer_organizations
         SET super_org_id = NULL, updated_at = NOW()
       WHERE id = ${co} AND super_org_id = ${id}
    `);
    res.status(200).json({ success: true });
  } catch (err: any) {
    logger.error('super_org_detach_failed', { id, platform, co, err: err?.message });
    res.status(500).json({ success: false, error: 'Failed to detach member', code: 'SUPER_ORG_DETACH_FAILED' });
  }
});

// GET /me/switchable — for the calling SDK identity, list sibling
// (platform_id, customer_org_id) pairs the caller can switch into via their
// super-org. Returns [] if the caller's tenant has no super-org binding.
//
// This is what powers the Console "switch product / customer" picker so an
// enterprise admin gets ONE login across NSP + NSI + NSM. The picker MUST
// re-call the gateway with the new (X-API-Key, X-Customer-Org-Id) pair —
// nothing here grants cross-tenant data access, the existing
// customer_org_isolation RLS policy still gates every read.
router.get('/me/switchable', async (req: Request, res: Response): Promise<void> => {
  if (!dbOr503(res)) return;
  const sdk = (req as any).sdkContext;
  const platformId: number | undefined = sdk?.applicationId ?? sdk?.platformId;
  const customerOrgId: number | undefined = sdk?.customerOrgId;
  if (!platformId || !customerOrgId) {
    res.status(200).json({ success: true, data: { super_org: null, switchable: [] } });
    return;
  }
  try {
    const own: any = await db!.execute(sql`
      SELECT super_org_id FROM nv_super_org_platform_memberships
       WHERE platform_id = ${platformId} AND customer_org_id = ${customerOrgId}
       LIMIT 1
    `);
    const ownRow = own?.rows?.[0] ?? own?.[0] ?? null;
    if (!ownRow?.super_org_id) {
      res.status(200).json({ success: true, data: { super_org: null, switchable: [] } });
      return;
    }
    const superOrgId = Number(ownRow.super_org_id);
    const head: any = await db!.execute(sql`
      SELECT id, name, slug, billing_email, status FROM nv_super_orgs
       WHERE id = ${superOrgId} LIMIT 1
    `);
    const siblings: any = await db!.execute(sql`
      SELECT m.platform_id, m.customer_org_id, m.role,
             a.app_name AS platform_name,
             c.external_ref AS customer_external_ref,
             c.display_name AS customer_display_name
        FROM nv_super_org_platform_memberships m
        LEFT JOIN sdk_applications a          ON a.id = m.platform_id
        LEFT JOIN nv_customer_organizations c ON c.id = m.customer_org_id
       WHERE m.super_org_id = ${superOrgId}
       ORDER BY m.platform_id, m.customer_org_id
    `);
    res.status(200).json({
      success: true,
      data: {
        super_org: head?.rows?.[0] ?? head?.[0] ?? { id: superOrgId },
        switchable: siblings?.rows ?? siblings ?? [],
      },
    });
  } catch (err: any) {
    logger.error('super_org_switchable_failed', { platformId, customerOrgId, err: err?.message });
    res.status(500).json({ success: false, error: 'Failed to load switchable tenants', code: 'SUPER_ORG_SWITCHABLE_FAILED' });
  }
});

export default router;
