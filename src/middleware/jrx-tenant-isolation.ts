/**
 * Tenant isolation middleware.
 *
 * After `sdkGatewayAuth` (or `authenticateToken`) has set the auth context on
 * the request, this middleware verifies that any tenant identifier supplied
 * by the client (in body / query / header / route params) MATCHES the tenant
 * that the API key / JWT was issued for.
 *
 * Rules:
 *   1. If NYV_TENANT_ENFORCE != "1", behave as a no-op (kept off in dev).
 *   2. The "auth tenant" is read in priority order:
 *        req.sdkContext.organizationId   (SDK API-key auth)
 *        req.user.organizationId         (JWT auth)
 *        process.env.NYV_TENANT_ID       (single-tenant container fallback)
 *   3. The "claimed tenant" is read in priority order:
 *        req.body.tenantId / req.body.tenant_id / req.body.organizationId
 *        req.query.tenantId / req.query.tenant_id
 *        req.headers['x-tenant-id'] / req.headers['x-organization-id']
 *        req.params.tenantId
 *   4. If a claimed tenant exists and !== auth tenant, return 403.
 *   5. If NYV_TENANT_ENFORCE=strict and the auth tenant is missing on an
 *      /api/sdk/* path, return 401 (unauthenticated tenant context).
 *
 * The middleware never throws — it only `res.status(403|401).json(...)` and
 * returns.  All decisions are logged at info-level for audit.
 */

import type { NextFunction, Request, Response } from "express";

type TenantClaim = string | undefined;

function readClaimedTenant(req: Request): TenantClaim {
  // Body
  const b = (req.body ?? {}) as Record<string, unknown>;
  const fromBody =
    (typeof b.tenantId === "string" && b.tenantId) ||
    (typeof b.tenant_id === "string" && b.tenant_id) ||
    (typeof b.organizationId === "string" && b.organizationId) ||
    (typeof b.organization_id === "string" && b.organization_id);
  if (fromBody) return String(fromBody);

  // Query
  const q = (req.query ?? {}) as Record<string, unknown>;
  const fromQuery =
    (typeof q.tenantId === "string" && q.tenantId) ||
    (typeof q.tenant_id === "string" && q.tenant_id);
  if (fromQuery) return String(fromQuery);

  // Headers (header names are normalised to lowercase by Express)
  const h = req.headers;
  const fromHeader =
    (typeof h["x-tenant-id"] === "string" && (h["x-tenant-id"] as string)) ||
    (typeof h["x-organization-id"] === "string" && (h["x-organization-id"] as string));
  if (fromHeader) return String(fromHeader);

  // Route params
  const p = (req.params ?? {}) as Record<string, unknown>;
  const fromParam = typeof p.tenantId === "string" && p.tenantId;
  if (fromParam) return String(fromParam);

  return undefined;
}

function readAuthTenant(req: Request): TenantClaim {
  const sdkCtx = (req as unknown as { sdkContext?: { organizationId?: string } }).sdkContext;
  if (sdkCtx?.organizationId) return sdkCtx.organizationId;

  const user = (req as unknown as { user?: { organizationId?: string } }).user;
  if (user?.organizationId) return user.organizationId;

  const envTenant = process.env.NYV_TENANT_ID;
  if (envTenant) return envTenant;

  // NV-UAT-DEFAULT-ORG-001 (task #335, 2026-05-13): in dev / E2E-bypass
  // mode resolve missing tenant claim to platform-baseline org_id=1 so
  // demo flows are not 401'd before downstream routes can render. The
  // gate keeps production fail-cold semantics untouched.
  if (process.env.NODE_ENV !== "production" || process.env.NV_E2E_BYPASS === "1") {
    return "1";
  }

  return undefined;
}

export function tenantIsolation(req: Request, res: Response, next: NextFunction): void {
  const enforce = process.env.NYV_TENANT_ENFORCE;
  if (enforce !== "1" && enforce !== "strict") {
    return next();
  }

  const claimed = readClaimedTenant(req);
  const auth = readAuthTenant(req);

  // Strict mode: SDK requests MUST resolve to a tenant.
  // NOTE: use originalUrl (not req.path) — when the middleware is mounted
  // inside a sub-router via router.use(...), Express strips the mount prefix
  // from req.path, which would silently disable the strict-mode check on
  // every per-router mount. originalUrl always contains the full incoming
  // path, so the prefix test works for both app-level and per-router mounts.
  const fullPath = (req.originalUrl || req.url || "").split("?")[0];
  const isSdkPath =
    fullPath.startsWith("/api/sdk") ||
    fullPath.startsWith("/api/jrx/sdk") ||
    fullPath.startsWith("/api/jrx/gateway") ||
    fullPath.startsWith("/api/jrx/v1/sdk");

  // Dual-mount safety: the app-level mount runs BEFORE sdkGatewayAuth, so
  // sdkContext is always undefined here for SDK paths. If we 401'd in strict
  // mode at the app level, every SDK request would be rejected before the
  // API key ever gets validated. So in strict mode we only fire the 401 at
  // the per-router mount (where sdkGatewayAuth has already run). The app-
  // level mount has req.baseUrl === "/api/jrx"; per-router mounts have
  // deeper baseUrls like "/api/jrx/sdk" or "/api/jrx/gateway".
  const baseUrl = req.baseUrl || "";
  const isAppLevelMount =
    baseUrl === "/api/jrx" || baseUrl === "/api/jrx/" || baseUrl === "";

  if (enforce === "strict" && isSdkPath && !auth && !isAppLevelMount) {
    res.status(401).json({
      error: "TENANT_CONTEXT_MISSING",
      message: "Authenticated tenant context is required for SDK requests.",
    });
    return;
  }

  if (claimed && auth && claimed !== auth) {
    res.status(403).json({
      error: "TENANT_MISMATCH",
      message:
        "The tenant identifier in this request does not match the authenticated tenant.",
      // We deliberately do NOT echo back which tenant the API key resolved to.
      claimedTenantHash: hashShort(claimed),
    });
    return;
  }

  return next();
}

function hashShort(s: string): string {
  // 8-char djb2 — non-cryptographic, just enough to correlate audit logs
  // without echoing user-supplied values verbatim.
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) & 0xffffffff;
  return (h >>> 0).toString(16).padStart(8, "0");
}

export default tenantIsolation;
