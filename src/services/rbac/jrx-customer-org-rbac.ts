/**
 * Customer-Org-Aware RBAC — Task #343 (Multi-tenant sub-org model).
 *
 * Console RBAC has FOUR layers in the two-tier (platform × customer-org)
 * tenancy model:
 *
 *   1. SUPER_ADMIN          — Jurexio internal staff. Sees everything,
 *                             across every platform and every customer org.
 *   2. PLATFORM_ADMIN       — Staff of an SDK platform (e.g. NSP). Sees
 *                             every customer org BELONGING to their
 *                             platform_id, but never another platform's.
 *   3. CUSTOMER_ORG_ADMIN   — Admin user of a downstream customer org
 *                             (e.g. a partner at Sharma & Co inside NSP).
 *                             Sees only their own (platform_id,
 *                             customer_org_id) data.
 *   4. CUSTOMER_USER        — Regular end-user of a customer org (e.g. a
 *                             lawyer at Sharma & Co). Same scope as
 *                             customer_org_admin minus admin actions.
 *
 * This module is the ONE place that maps a JWT/SDK identity to a layer
 * and computes the SQL filter that should be applied to tenant-scoped
 * queries. Adding a new layer or changing the matrix MUST happen here.
 *
 * NV-NAMING-001: jrx- prefix; pre-flight grep confirms no prior file at
 *   this path.
 */

export type CustomerOrgRbacLayer =
  | 'super_admin'
  | 'platform_admin'
  | 'customer_org_admin'
  | 'customer_user';

export interface RbacIdentity {
  /** JWT role (super_admin / org_admin / analyst / …) or 'sdk' for keys. */
  role?: string;
  /** Platform tenant the call resolves to (sdk_applications.id). */
  platformId?: number | null;
  /** Customer org the call resolves to (nv_customer_organizations.id). */
  customerOrgId?: number | null;
  /** True when this identity has Console / SDK admin scope on its layer. */
  isAdmin?: boolean;
  /** True when the identity arrived via SDK API key (no human reviewer). */
  isSdkOnly?: boolean;
}

/** Map a raw identity to one of the four layers. */
export function classifyLayer(id: RbacIdentity): CustomerOrgRbacLayer {
  const role = (id.role ?? '').toLowerCase();
  if (role === 'super_admin' || role === 'admin') return 'super_admin';
  // Platform admins are recognised either by an explicit JWT role
  // (`platform_admin`) or by an SDK key with `customer-orgs:admin` scope
  // — the latter is what Steps 5 of task #343 grants the partner platform.
  if (role === 'platform_admin' || role === 'org_admin' || id.isSdkOnly) {
    return 'platform_admin';
  }
  if (id.isAdmin) return 'customer_org_admin';
  return 'customer_user';
}

export interface QueryScope {
  layer: CustomerOrgRbacLayer;
  /**
   * SQL fragment plus parameter args that should be ANDed onto any
   * tenant-scoped query. `''` means "no extra filter" (super_admin).
   *
   * Example: `WHERE … AND ${scope.fragment}` with values `scope.params`
   * passed in the same `$N` order.
   */
  fragment: string;
  params: Array<string | number>;
  /** Human-readable explanation for audit logs. */
  reason: string;
}

/**
 * Compute the WHERE-fragment that scopes a query to the layer this
 * identity is allowed to see. Always defence-in-depth: callers MUST still
 * apply RLS at the DB layer; this is the application-tier echo of the
 * same rules so misconfigured RLS doesn't silently leak rows.
 */
export function scopeForIdentity(id: RbacIdentity): QueryScope {
  const layer = classifyLayer(id);
  switch (layer) {
    case 'super_admin':
      return { layer, fragment: 'TRUE', params: [], reason: 'super_admin: no scope' };
    case 'platform_admin': {
      if (id.platformId == null) {
        return { layer, fragment: 'FALSE', params: [], reason: 'platform_admin without platformId — fail closed' };
      }
      return {
        layer,
        fragment: 'platform_id = $1',
        params: [id.platformId],
        reason: `platform_admin scoped to platform_id=${id.platformId}`,
      };
    }
    case 'customer_org_admin':
    case 'customer_user': {
      if (id.platformId == null || id.customerOrgId == null) {
        return { layer, fragment: 'FALSE', params: [], reason: `${layer} missing tenant pair — fail closed` };
      }
      return {
        layer,
        fragment: 'platform_id = $1 AND customer_org_id = $2',
        params: [id.platformId, id.customerOrgId],
        reason: `${layer} scoped to (platform_id=${id.platformId}, customer_org_id=${id.customerOrgId})`,
      };
    }
  }
}

/**
 * Throw if `targetCustomerOrgId` is not visible to the identity. Used by
 * write paths (POST/PUT/DELETE) where wrapping every UPDATE in a
 * scoped WHERE is awkward.
 */
export function assertCanAccessCustomerOrg(
  id: RbacIdentity,
  targetPlatformId: number,
  targetCustomerOrgId: number,
): void {
  const layer = classifyLayer(id);
  if (layer === 'super_admin') return;
  if (id.platformId !== targetPlatformId) {
    throw new RbacAccessError(
      `cross-platform access denied (caller=${id.platformId} target=${targetPlatformId})`,
    );
  }
  if (layer === 'platform_admin') return;
  if (id.customerOrgId !== targetCustomerOrgId) {
    throw new RbacAccessError(
      `cross-customer-org access denied (caller=${id.customerOrgId} target=${targetCustomerOrgId})`,
    );
  }
}

export class RbacAccessError extends Error {
  readonly code = 'RBAC_ACCESS_DENIED';
  constructor(message: string) {
    super(message);
    this.name = 'RbacAccessError';
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Task #353 — Express request → RbacIdentity bridge + drizzle SQL helper.
// Used by every read path under src/routes/** + src/services/** that AND-s
// in the (platform_id, customer_org_id) filter.
// ─────────────────────────────────────────────────────────────────────────

import { sql, type SQL } from 'drizzle-orm';
import type { Request } from 'express';

/**
 * Derive an RbacIdentity from an Express request. Honours both the JWT
 * identity (`req.user`) and the SDK gateway identity (`req.sdkContext`).
 * The JWT-org-bridge middleware copies a Console JWT into a minimal
 * `sdkContext`, so this works uniformly for both call paths.
 */
export function getRbacIdentityFromRequest(req: Request): RbacIdentity {
  const u: any = (req as any).user ?? {};
  const sdk: any = (req as any).sdkContext ?? {};
  const role = String(u.role ?? u.roleName ?? '').toLowerCase();
  const pickNum = (...vals: unknown[]): number | null => {
    for (const v of vals) {
      if (v == null || v === '') continue;
      const n = typeof v === 'number' ? v : Number(v);
      if (Number.isFinite(n) && n > 0) return n;
    }
    return null;
  };
  const platformId = pickNum(
    sdk.platformId, sdk.applicationId, sdk.organizationId,
    u.organizationId, u.orgId,
  );
  const customerOrgId = pickNum(sdk.customerOrgId);
  const isSdkOnly =
    Boolean(sdk.applicationId) && !u.id && !u.userId && !u.email;
  const isAdmin =
    role === 'org_admin' || role === 'admin' || role === 'super_admin' || Boolean(u.isAdmin);
  return {
    role: role || (isSdkOnly ? 'sdk' : undefined),
    platformId: typeof platformId === 'number' && Number.isFinite(platformId) ? platformId : null,
    customerOrgId: typeof customerOrgId === 'number' && Number.isFinite(customerOrgId) ? customerOrgId : null,
    isAdmin,
    isSdkOnly,
  };
}

/**
 * Build a drizzle `sql` fragment that AND-s the (platform_id,
 * customer_org_id) filter onto a tenant-scoped query, given the actual
 * column names on the target table. Returns `sql\`\`` for super_admin
 * (no extra filter), `sql\`AND 1=0\`` when fail-closed, etc.
 *
 * Example:
 *   const scope = customerOrgScopeSql(getRbacIdentityFromRequest(req), {
 *     platformCol: sql`application_id`, customerCol: sql`customer_org_id`,
 *   });
 *   await db.execute(sql`SELECT * FROM sdk_workflows WHERE 1=1 ${scope}`);
 */
export function customerOrgScopeSql(
  id: RbacIdentity,
  cols: { platformCol: SQL; customerCol: SQL; platformIsText?: boolean },
): SQL {
  const layer = classifyLayer(id);
  const { platformCol, customerCol, platformIsText } = cols;
  if (layer === 'super_admin') return sql``;
  if (id.platformId == null) return sql`AND 1 = 0`;
  // Platform col may be VARCHAR (cam_actions.org_id) or BIGINT/INT
  // (sdk_*.application_id). Cast both sides to text when caller asserts.
  const platformPredicate = platformIsText
    ? sql`${platformCol} = ${String(id.platformId)}`
    : sql`${platformCol}::text = ${String(id.platformId)}`;
  if (layer === 'platform_admin') {
    return sql`AND ${platformPredicate}`;
  }
  if (id.customerOrgId == null) return sql`AND 1 = 0`;
  return sql`AND ${platformPredicate} AND ${customerCol} = ${id.customerOrgId}`;
}

/**
 * Render the audit-log identity chain string used by request logs:
 *   `platform=NSP customer_org=Sharma&Co user=ananya@sharma.in`
 */
export function renderAuditIdentity(parts: {
  platformName?: string;
  customerOrgName?: string;
  customerUserEmail?: string;
}): string {
  const platform = parts.platformName ? `platform=${parts.platformName}` : 'platform=?';
  const customer = parts.customerOrgName ? ` customer_org=${parts.customerOrgName}` : '';
  const user = parts.customerUserEmail ? ` user=${parts.customerUserEmail}` : '';
  return `${platform}${customer}${user}`.trim();
}
