/**
 * Caller binding for the orchestration memory routes.
 *
 * `POST /memory/store` and `POST /memory/retrieve` used to compute the
 * caller's id and then spread `req.body` over it, so a body `userId`
 * replaced the authenticated principal. Any signed-in caller could read
 * or write `nv_schema.memory_entries` for someone else. The subject is
 * the caller unless a platform operator names another principal.
 */

export interface OrchestrationMemoryCaller {
  id: string;
  role?: string;
}

export type OrchestrationMemorySubject =
  | { ok: true; userId: string }
  | { ok: false; status: 401 | 403 };

/**
 * Exact roles that may name another principal. `org_admin` stays on
 * their own rows. `superadmin` is the unranked alias used by Legal Chat;
 * `service` is the inter-service account.
 */
const PLATFORM_OPERATOR_ROLES = new Set(['admin', 'super_admin', 'superadmin', 'service']);

export function memoryCallerFromUser(
  user: { id?: unknown; userId?: unknown; role?: unknown } | null | undefined,
): OrchestrationMemoryCaller | null {
  if (!user) return null;
  const raw = user.id ?? user.userId;
  if (raw == null || String(raw).length === 0) return null;
  return {
    id: String(raw),
    role: typeof user.role === 'string' ? user.role : undefined,
  };
}

function requestedUserId(raw: unknown): string | undefined {
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw);
  return undefined;
}

export function resolveOrchestrationMemorySubject(
  caller: OrchestrationMemoryCaller | null,
  requested: unknown,
): OrchestrationMemorySubject {
  if (!caller) return { ok: false, status: 401 };
  const requestedId = requestedUserId(requested);
  if (requestedId == null || requestedId === caller.id) {
    return { ok: true, userId: caller.id };
  }
  if (caller.role != null && PLATFORM_OPERATOR_ROLES.has(caller.role)) {
    return { ok: true, userId: requestedId };
  }
  return { ok: false, status: 403 };
}

/**
 * Put the resolved subject on the payload last so a body `userId` cannot
 * override it again at the call site.
 */
export function bindOrchestrationMemoryUser<T extends Record<string, unknown>>(
  body: T,
  subjectUserId: string,
): Omit<T, 'userId'> & { userId: string } {
  const rest: Record<string, unknown> = { ...body };
  delete rest.userId;
  return { ...rest, userId: subjectUserId } as Omit<T, 'userId'> & { userId: string };
}
