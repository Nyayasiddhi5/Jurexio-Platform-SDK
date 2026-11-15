/**
 * Caller binding for consent and incident routes.
 *
 * Ordinary signed-in users may only read or change their own consent rows.
 * Platform operators (admin, super_admin, the superadmin alias, and the
 * internal service account) may name another principal. That is the support
 * path; it is not the default for every JWT.
 */

import type { Request } from 'express';

/**
 * Exact roles that may act on another principal's consent or on the
 * incident ledger. `admin` is the floor: org_admin and below stay on
 * their own rows. `superadmin` is the unranked alias used by Legal Chat;
 * `service` is the inter-service account.
 */
const PLATFORM_OPERATOR_ROLES = new Set(['admin', 'super_admin', 'superadmin', 'service']);

export interface ConsentCaller {
  id: string;
  role?: string;
}

export type ConsentSubjectDecision =
  | { ok: true; subjectUserId: string }
  | { ok: false; status: 401 | 403 };

export function isPlatformOperator(role: string | undefined): boolean {
  return !!role && PLATFORM_OPERATOR_ROLES.has(role);
}

export function consentCallerFromRequest(req: Request): ConsentCaller | null {
  const user = req.user;
  if (!user) return null;
  const raw = user.id ?? user.userId;
  if (raw == null || String(raw).length === 0) return null;
  return {
    id: String(raw),
    role: typeof user.role === 'string' ? user.role : undefined,
  };
}

/**
 * Decide which user id a consent read or write may use.
 * A missing or identical requested id means the caller. A different id is
 * allowed only for a platform operator.
 */
export function resolveConsentSubject(
  caller: ConsentCaller | null,
  requestedUserId: string | undefined,
): ConsentSubjectDecision {
  if (!caller) return { ok: false, status: 401 };
  if (requestedUserId == null || requestedUserId.length === 0 || requestedUserId === caller.id) {
    return { ok: true, subjectUserId: caller.id };
  }
  if (isPlatformOperator(caller.role)) {
    return { ok: true, subjectUserId: requestedUserId };
  }
  return { ok: false, status: 403 };
}
