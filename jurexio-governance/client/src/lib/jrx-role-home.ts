/**
 * Role → console landing path.
 * LegalChat (/legalchat/*) login is SME-only; platform roles use /console/*.
 *
 * IMPORTANT: roleHomeRelative() is only ever called for an ALREADY-authenticated
 * user (callers gate on `user ? roleHomeRelative(role) : '/login'`). It must
 * therefore NEVER return '/login' for a real role — doing so sends a logged-in
 * user back to the login screen, producing an infinite "logged in but workspace
 * never shows" bounce loop. Every known role maps to a page it can actually
 * reach under ProtectedRoute (see client/src/lib/rbac-registry.ts ROLE_HIERARCHY),
 * and the fallback for any unexpected role is the universal '/dashboard' (minRole
 * 'user') — not '/login'.
 *
 * `sme` is hard-isolated to the stand-alone /legalchat (a.k.a. /sme) workspace
 * shell and is redirected off /console/* by the App.tsx guard before this
 * resolver runs; SME_WORKSPACE_PATH is its canonical landing.
 */

/** Canonical SME workspace entry (branded prod path; /sme also serves the same SPA). */
export const SME_WORKSPACE_PATH = '/legalchat/chat';

/** Pages gated at minRole 'super_admin' (level 100) — only super admins pass. */
const SUPERADMIN_HOME = '/operations?tab=overview';
/** Admin-flavoured landing that is reachable by every authenticated role (minRole 'user'). */
const ADMIN_HOME = '/dashboard';
/** Universal authenticated landing (minRole 'user'). */
const DASHBOARD_HOME = '/dashboard';

export function isSmeRole(role: string | undefined | null): boolean {
  return String(role || '').toLowerCase() === 'sme';
}

export function roleHomeRelative(role: string | undefined | null): string {
  const r = String(role || '').toLowerCase();
  const map: Record<string, string> = {
    // Tier-2 global admins (level 100) — full super-admin console.
    super_admin: SUPERADMIN_HOME,
    superadmin: SUPERADMIN_HOME,

    // Admin-ish roles below super_admin: land on dashboard (minRole 'user').
    admin: ADMIN_HOME,
    platform_admin: ADMIN_HOME,
    enterprise_admin: ADMIN_HOME,
    compliance_officer: ADMIN_HOME,
    compliance_reviewer: ADMIN_HOME,
    cam_reviewer: ADMIN_HOME,

    // Single-org admins.
    org_admin: '/org-admin',
    owner: '/org-admin',

    // Operational / analyst / general tiers → standard dashboard.
    manager: DASHBOARD_HOME,
    senior_analyst: DASHBOARD_HOME,
    analyst: DASHBOARD_HOME,
    developer: DASHBOARD_HOME,
    operator: DASHBOARD_HOME,
    user: DASHBOARD_HOME,
    viewer: DASHBOARD_HOME,
    readonly: DASHBOARD_HOME,
    guest: DASHBOARD_HOME,
  };
  // sme never lands in the console — the App guard sends it to the workspace.
  // Any unexpected/unknown role lands on the universal dashboard, NOT /login.
  return map[r] ?? DASHBOARD_HOME;
}

/**
 * Absolute landing URL for a role across the two SPAs.
 * - sme        → the stand-alone SME workspace (/legalchat/chat)
 * - all others → the console (/console/...)
 */
export function absoluteHomePath(role: string | undefined | null): string {
  if (isSmeRole(role)) return SME_WORKSPACE_PATH;
  return `/console${roleHomeRelative(role)}`;
}

/** Absolute path for hard navigation (LegalChat shell → console). */
export function consoleHomePath(role: string | undefined | null): string {
  if (isSmeRole(role)) return SME_WORKSPACE_PATH;
  return `/console${roleHomeRelative(role)}`;
}

/** LegalChat shell login is restricted to SME role only. */
export function isLegalChatLoginRole(role: string | undefined | null): boolean {
  return isSmeRole(role);
}
