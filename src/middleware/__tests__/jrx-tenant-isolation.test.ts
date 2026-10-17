/**
 * Tests for the tenant-isolation middleware.
 *
 * Verifies:
 *   - off-by-default when JRX_TENANT_ENFORCE is not set
 *   - 403 on cross-tenant body claim
 *   - 403 on cross-tenant query claim
 *   - 403 on cross-tenant header claim
 *   - same-tenant request passes through (next is called)
 *   - 401 in strict mode when no auth tenant and request is /api/sdk/*
 *   - falls back to JRX_TENANT_ID env when neither sdkContext nor user is set
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tenantIsolation } from "../jrx-tenant-isolation";
import type { NextFunction, Request, Response } from "express";

function mkReq(over: Partial<Request> & { sdkContext?: { organizationId?: string } } = {}): Request {
  const base: Partial<Request> = {
    body: {},
    query: {},
    headers: {},
    params: {},
    path: "/api/jrx/sdk/chat",
    originalUrl: "/api/jrx/sdk/chat",
    url: "/api/jrx/sdk/chat",
  };
  // If a caller overrides path but not originalUrl, mirror path into originalUrl
  // so the middleware's SDK-prefix check sees the intended URL.
  const merged = { ...base, ...over } as Partial<Request>;
  if (over.path && !over.originalUrl) {
    (merged as { originalUrl: string }).originalUrl = over.path;
    (merged as { url: string }).url = over.path;
  }
  return merged as Request;
}

function mkRes() {
  const res: Partial<Response> & { _status?: number; _payload?: unknown } = {};
  res.status = vi.fn().mockImplementation((c: number) => {
    res._status = c;
    return res as Response;
  });
  res.json = vi.fn().mockImplementation((p: unknown) => {
    res._payload = p;
    return res as Response;
  });
  return res as Response & { _status?: number; _payload?: unknown };
}

const ENV_BACKUP = { ...process.env };

beforeEach(() => {
  // Reset to a known state between tests.
  process.env = { ...ENV_BACKUP };
  delete process.env.JRX_TENANT_ENFORCE;
  delete process.env.JRX_TENANT_ID;
});

afterEach(() => {
  process.env = { ...ENV_BACKUP };
});

describe("tenantIsolation middleware", () => {
  it("is a no-op when JRX_TENANT_ENFORCE is not set", () => {
    const next = vi.fn();
    const res = mkRes();
    const req = mkReq({
      body: { tenantId: "tenant-a" },
      sdkContext: { organizationId: "tenant-b" },
    });

    tenantIsolation(req, res, next as unknown as NextFunction);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("returns 403 on cross-tenant body claim", () => {
    process.env.JRX_TENANT_ENFORCE = "1";
    const next = vi.fn();
    const res = mkRes();
    const req = mkReq({
      body: { tenantId: "tenant-attacker" },
      sdkContext: { organizationId: "tenant-victim" },
    });

    tenantIsolation(req, res, next as unknown as NextFunction);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    const payload = (res as unknown as { _payload: { error: string } })._payload;
    expect(payload.error).toBe("TENANT_MISMATCH");
  });

  it("returns 403 on cross-tenant query claim", () => {
    process.env.JRX_TENANT_ENFORCE = "1";
    const next = vi.fn();
    const res = mkRes();
    const req = mkReq({
      query: { tenant_id: "tenant-attacker" } as unknown as Request["query"],
      sdkContext: { organizationId: "tenant-victim" },
    });

    tenantIsolation(req, res, next as unknown as NextFunction);

    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("returns 403 on cross-tenant header claim", () => {
    process.env.JRX_TENANT_ENFORCE = "1";
    const next = vi.fn();
    const res = mkRes();
    const req = mkReq({
      headers: { "x-tenant-id": "tenant-attacker" },
      sdkContext: { organizationId: "tenant-victim" },
    });

    tenantIsolation(req, res, next as unknown as NextFunction);

    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("calls next() when claimed tenant matches authenticated tenant", () => {
    process.env.JRX_TENANT_ENFORCE = "1";
    const next = vi.fn();
    const res = mkRes();
    const req = mkReq({
      body: { tenantId: "tenant-a" },
      sdkContext: { organizationId: "tenant-a" },
    });

    tenantIsolation(req, res, next as unknown as NextFunction);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("calls next() when no claim is supplied (auth-only)", () => {
    process.env.JRX_TENANT_ENFORCE = "1";
    const next = vi.fn();
    const res = mkRes();
    const req = mkReq({
      sdkContext: { organizationId: "tenant-a" },
    });

    tenantIsolation(req, res, next as unknown as NextFunction);

    expect(next).toHaveBeenCalledOnce();
  });

  it("returns 401 in strict mode when SDK request has no auth tenant (per-router mount)", () => {
    process.env.JRX_TENANT_ENFORCE = "strict";
    const next = vi.fn();
    const res = mkRes();
    // Per-router mount: baseUrl is the SDK sub-router prefix.
    const req = mkReq({ path: "/chat", originalUrl: "/api/jrx/sdk/chat", baseUrl: "/api/jrx/sdk" });

    tenantIsolation(req, res, next as unknown as NextFunction);

    expect(res.status).toHaveBeenCalledWith(401);
    const payload = (res as unknown as { _payload: { error: string } })._payload;
    expect(payload.error).toBe("TENANT_CONTEXT_MISSING");
  });

  it("uses JRX_TENANT_ID env as the auth-tenant fallback for single-tenant containers", () => {
    process.env.JRX_TENANT_ENFORCE = "1";
    process.env.JRX_TENANT_ID = "nym";
    const next = vi.fn();
    const res = mkRes();

    // claimed=nsa from header but container is bound to nym
    const req = mkReq({ headers: { "x-tenant-id": "nsa" } });
    tenantIsolation(req, res, next as unknown as NextFunction);

    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("user.organizationId (JWT path) is treated as the auth tenant", () => {
    process.env.JRX_TENANT_ENFORCE = "1";
    const next = vi.fn();
    const res = mkRes();
    const req = mkReq({
      body: { organization_id: "tenant-a" },
    });
    (req as unknown as { user: { organizationId: string } }).user = { organizationId: "tenant-b" };

    tenantIsolation(req, res, next as unknown as NextFunction);

    expect(res.status).toHaveBeenCalledWith(403);
  });

  // Regression coverage for the dual-mount strategy in src/index.ts +
  // every SDK sub-router.  When tenantIsolation runs at the app level
  // BEFORE sdkGatewayAuth has populated req.sdkContext, it must NOT
  // false-positive on SDK requests (auth tenant is undefined, claim
  // alone is not enough to 403).  The same middleware then runs again
  // INSIDE the sub-router after sdkGatewayAuth, where sdkContext is
  // populated and the cross-tenant 403 fires.
  it("does not 403 on the app-level mount when sdkContext is not yet set", () => {
    process.env.JRX_TENANT_ENFORCE = "1";
    const next = vi.fn();
    const res = mkRes();
    // Simulates the app-level mount running before sdkGatewayAuth:
    // the body claims a tenant but req.sdkContext / req.user are unset.
    const req = mkReq({
      body: { tenantId: "tenant-attacker" },
      path: "/api/jrx/sdk/chat",
    });

    tenantIsolation(req, res, next as unknown as NextFunction);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("403s on the per-router mount once sdkGatewayAuth has populated sdkContext", () => {
    process.env.JRX_TENANT_ENFORCE = "1";
    const next = vi.fn();
    const res = mkRes();
    // Simulates the per-router mount after sdkGatewayAuth resolved the
    // API key to organizationId=tenant-victim, but the request body still
    // claims tenant-attacker — must 403.
    const req = mkReq({
      body: { tenantId: "tenant-attacker" },
      sdkContext: { organizationId: "tenant-victim" },
      path: "/api/jrx/sdk/chat",
    });

    tenantIsolation(req, res, next as unknown as NextFunction);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  // Regression: when tenantIsolation is mounted INSIDE a sub-router (which
  // is exactly what the per-router mount does after sdkGatewayAuth),
  // Express strips the mount prefix from req.path. The middleware therefore
  // must use req.originalUrl for its SDK-prefix check, otherwise strict
  // mode silently no-ops on every per-router mount.
  it("strict mode 401s on per-router mount where req.path is stripped but originalUrl retains the SDK prefix", () => {
    process.env.JRX_TENANT_ENFORCE = "strict";
    const next = vi.fn();
    const res = mkRes();
    // Simulates Express having stripped the "/api/jrx/sdk" mount prefix:
    // req.path is just "/chat", but originalUrl still contains the full URL.
    const req = mkReq({
      path: "/chat",
      originalUrl: "/api/jrx/sdk/chat",
      url: "/chat",
      baseUrl: "/api/jrx/sdk",
    });

    tenantIsolation(req, res, next as unknown as NextFunction);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    const payload = (res as unknown as { _payload: { error: string } })._payload;
    expect(payload.error).toBe("TENANT_CONTEXT_MISSING");
  });

  // Regression: strict mode must NOT 401 at the app-level mount, because
  // sdkGatewayAuth has not yet run there — auth is always undefined for
  // SDK paths at that point. Without this guard, flipping to
  // JRX_TENANT_ENFORCE=strict would reject every SDK request before its
  // API key was ever validated. The 401 is deferred to the per-router
  // mount, which runs AFTER sdkGatewayAuth.
  it("strict mode does NOT 401 at the app-level mount even on SDK paths (sdkGatewayAuth runs later)", () => {
    process.env.JRX_TENANT_ENFORCE = "strict";
    const next = vi.fn();
    const res = mkRes();
    // App-level mount: baseUrl is the bare /api/nv prefix.
    const req = mkReq({
      path: "/sdk/chat",
      originalUrl: "/api/jrx/sdk/chat",
      url: "/sdk/chat",
      baseUrl: "/api/jrx",
    });

    tenantIsolation(req, res, next as unknown as NextFunction);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });
});
