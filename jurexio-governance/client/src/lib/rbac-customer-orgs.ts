/**
 * rbac-customer-orgs.ts — client-side RBAC helper for the Customer Orgs
 * Console pages (task-354, 2026-05-13).
 *
 * Mirrors the four-layer model in
 *   src/services/rbac/jrx-customer-org-rbac.ts (server side):
 *
 *     super_admin       — Jurexio internal. Sees every platform.
 *     platform_admin    — Staff of an SDK platform (e.g. NSP). Sees their
 *                         own customer orgs only.
 *     customer_org_admin — admin of a downstream customer firm.
 *     customer_user     — regular end-user of a customer firm.
 *
 * The Console-side mapping uses the existing JWT roles in
 *   client/src/lib/rbac-registry.ts:
 *
 *     super_admin / admin   → super_admin layer
 *     org_admin             → platform_admin layer (partner platform's admin)
 *
 * The Customer Orgs page is gated to the top two layers (super_admin +
 * platform_admin). Anything below sees a 403-style "Access Restricted"
 * page via the standard <ProtectedRoute minRole="org_admin"> wrapper.
 *
 * NV-NAMING-001: pre-flight grep confirmed no prior `rbac-customer-orgs.ts`.
 * NV-CONTRACT-001: contract documented; thin shim over rbac-registry.
 */

import type { RoleLevel } from '@/lib/rbac-registry';

/** The single minRole that lets exactly platform_admin + super_admin in. */
export const CUSTOMER_ORGS_MIN_ROLE: RoleLevel = 'org_admin';

/**
 * True iff the given role is at the `platform_admin` layer or above.
 *
 * Why `org_admin` maps to `platform_admin`: in the partner-platform tenancy
 * model the "org" is the partner platform itself (NSP / NSI / …). Their
 * org_admin user is the same human who, server-side, presents an SDK key
 * with `customer-orgs:admin` scope. See
 * src/services/rbac/jrx-customer-org-rbac.ts § classifyLayer().
 */
export function isCustomerOrgPlatformAdmin(role: string | undefined | null): boolean {
  if (!role) return false;
  return role === 'org_admin' || role === 'admin' || role === 'super_admin';
}
