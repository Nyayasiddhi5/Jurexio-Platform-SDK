/**
 * Legal Chat RBAC — who may enter the product.
 *
 * The gate is binary and easy to widen by accident: only superadmin
 * (or super_admin) and a native SME role skip the allocation lookup.
 * Ordinary admin and org_admin must have an active, unrevoked
 * sme_allocations row. A missing database or a failed lookup must deny.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import type { LegalChatAuthRequest } from '../../src/middleware/legal-chat-rbac.js';

process.env.LOG_LEVEL = 'fatal';

const { queryMock, poolBox } = vi.hoisted(() => {
  const queryMock = vi.fn();
  const poolBox: { current: { query: typeof queryMock } | null } = {
    current: { query: queryMock },
  };
  return { queryMock, poolBox };
});

vi.mock('../../src/db/index.js', () => ({
  get pool() {
    return poolBox.current;
  },
}));

const { isSuperadmin, requireLegalChatAccess, requireSuperadmin } = await import(
  '../../src/middleware/legal-chat-rbac.js'
);

interface CapturedResponse {
  statusCode: number;
  body: unknown;
  status(code: number): CapturedResponse;
  json(payload: unknown): CapturedResponse;
}

interface GateUser {
  id: string;
  role?: string;
}

function createResponse(): CapturedResponse {
  const res: CapturedResponse = {
    statusCode: 200,
    body: undefined,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(payload: unknown) {
      res.body = payload;
      return res;
    },
  };
  return res;
}

function gateRequest(user: GateUser | undefined): LegalChatAuthRequest {
  const req = { user } as LegalChatAuthRequest;
  return req;
}

async function runAccess(user: GateUser | undefined): Promise<{
  req: LegalChatAuthRequest;
  res: CapturedResponse;
  next: ReturnType<typeof vi.fn>;
}> {
  const req = gateRequest(user);
  const res = createResponse();
  const next = vi.fn();
  await requireLegalChatAccess(req, res as unknown as Response, next as unknown as NextFunction);
  return { req, res, next };
}

function allocationCall(): { text: string; values: unknown[] } {
  expect(queryMock).toHaveBeenCalledTimes(1);
  const [text, values] = queryMock.mock.calls[0] as [string, unknown[]];
  return { text, values };
}

beforeEach(() => {
  queryMock.mockReset();
  queryMock.mockResolvedValue({ rows: [] });
  poolBox.current = { query: queryMock };
});

describe('requireLegalChatAccess role bypass', () => {
  it('rejects a request with no authenticated user', async () => {
    const { res, next } = await runAccess(undefined);

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'authentication required' });
    expect(next).not.toHaveBeenCalled();
    expect(queryMock).not.toHaveBeenCalled();
  });

  it.each(['superadmin', 'super_admin'])(
    'admits %s without reading sme_allocations, even when the database is down',
    async (role) => {
      poolBox.current = null;
      const { req, res, next } = await runAccess({ id: '7', role });

      expect(next).toHaveBeenCalledOnce();
      expect(req.legalChatRole).toBe('superadmin');
      expect(req.smeAllocation).toBeUndefined();
      expect(res.body).toBeUndefined();
      expect(queryMock).not.toHaveBeenCalled();
    },
  );

  it('admits a native SME role without loading allocation scope', async () => {
    poolBox.current = null;
    const { req, res, next } = await runAccess({ id: '7', role: 'sme' });

    expect(next).toHaveBeenCalledOnce();
    expect(req.legalChatRole).toBe('sme');
    expect(req.smeAllocation).toBeUndefined();
    expect(res.body).toBeUndefined();
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('does not treat a lookalike role as a bypass', async () => {
    const { res, next } = await runAccess({ id: '7', role: 'Superadmin' });

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({
      error: 'forbidden',
      message: 'Legal Chat is restricted to Superadmin and Superadmin-allocated SMEs.',
    });
    expect(next).not.toHaveBeenCalled();
    expect(queryMock).toHaveBeenCalledTimes(1);
  });
});

describe('requireLegalChatAccess allocation lookup', () => {
  it.each(['admin', 'org_admin'])(
    'denies %s when no active allocation exists',
    async (role) => {
      const { req, res, next } = await runAccess({ id: '42', role });
      const { text, values } = allocationCall();

      expect(text).toMatch(/FROM sme_allocations/);
      expect(text).toMatch(/sme_user_id = \$1/);
      expect(text).toMatch(/active = true/);
      expect(text).toMatch(/revoked_at IS NULL/);
      expect(text).not.toContain('42');
      expect(values).toEqual([42]);
      expect(res.statusCode).toBe(403);
      expect(res.body).toEqual({
        error: 'forbidden',
        message: 'Legal Chat is restricted to Superadmin and Superadmin-allocated SMEs.',
      });
      expect(req.legalChatRole).toBeUndefined();
      expect(next).not.toHaveBeenCalled();
    },
  );

  it('admits an admin when an active allocation row exists and attaches that row', async () => {
    const allocation = { id: 9, scope: { jurisdictions: ['IN'], practiceAreas: ['tax'] } };
    queryMock.mockResolvedValue({ rows: [allocation] });

    const { req, res, next } = await runAccess({ id: '42', role: 'admin' });

    expect(next).toHaveBeenCalledOnce();
    expect(req.legalChatRole).toBe('sme');
    expect(req.smeAllocation).toEqual(allocation);
    expect(res.body).toBeUndefined();
  });

  it('denies a user id that is not numeric and does not query', async () => {
    const { res, next } = await runAccess({ id: 'user-42', role: 'admin' });

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ error: 'forbidden — user id not numeric' });
    expect(next).not.toHaveBeenCalled();
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('denies an empty user id as non-numeric', async () => {
    const { res, next } = await runAccess({ id: '', role: 'admin' });

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ error: 'forbidden — user id not numeric' });
    expect(queryMock).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it('fails closed with 503 when the pool is missing', async () => {
    poolBox.current = null;

    const { res, next } = await runAccess({ id: '42', role: 'admin' });

    expect(res.statusCode).toBe(503);
    expect(res.body).toEqual({ error: 'database unavailable' });
    expect(next).not.toHaveBeenCalled();
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('fails closed with 500 when the lookup throws and hides the database error', async () => {
    queryMock.mockRejectedValue(new Error('relation sme_allocations does not exist'));

    const { res, next } = await runAccess({ id: '42', role: 'admin' });

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'internal error checking sme allocation' });
    expect(JSON.stringify(res.body)).not.toContain('relation');
    expect(next).not.toHaveBeenCalled();
  });

  it('denies when the query returns no rows array', async () => {
    queryMock.mockResolvedValue({});

    const { res, next } = await runAccess({ id: '42', role: 'user' });

    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });
});

describe('requireSuperadmin', () => {
  it('rejects a missing user', () => {
    const req = {} as Request;
    const res = createResponse();
    const next = vi.fn();

    requireSuperadmin(req, res as unknown as Response, next as unknown as NextFunction);

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'authentication required' });
    expect(next).not.toHaveBeenCalled();
    expect(queryMock).not.toHaveBeenCalled();
  });

  it.each(['admin', 'org_admin', 'sme'])('rejects %s', (role) => {
    const req = { user: { id: '1', role } } as Request;
    const res = createResponse();
    const next = vi.fn();

    requireSuperadmin(req, res as unknown as Response, next as unknown as NextFunction);

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ error: 'superadmin only' });
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects a superadmin role that only matches after trimming', () => {
    const req = { user: { id: '1', role: 'superadmin ' } } as Request;
    const res = createResponse();
    const next = vi.fn();

    requireSuperadmin(req, res as unknown as Response, next as unknown as NextFunction);

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ error: 'superadmin only' });
    expect(next).not.toHaveBeenCalled();
  });

  it.each(['superadmin', 'super_admin'])('admits %s', (role) => {
    const req = { user: { id: '1', role } } as Request;
    const res = createResponse();
    const next = vi.fn();

    requireSuperadmin(req, res as unknown as Response, next as unknown as NextFunction);

    expect(next).toHaveBeenCalledOnce();
    expect(res.body).toBeUndefined();
    expect(queryMock).not.toHaveBeenCalled();
  });
});

describe('isSuperadmin', () => {
  it.each([
    [{}, false],
    [{ user: { id: '1' } }, false],
    [{ user: { id: '1', role: 'admin' } }, false],
    [{ user: { id: '1', role: 'sme' } }, false],
    [{ user: { id: '1', role: 'superadmin' } }, true],
    [{ user: { id: '1', role: 'super_admin' } }, true],
  ] as const)('classifies %j', (req, expected) => {
    expect(isSuperadmin(req as unknown as Request)).toBe(expected);
  });
});
