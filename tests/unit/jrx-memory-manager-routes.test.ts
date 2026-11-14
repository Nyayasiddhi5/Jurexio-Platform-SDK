/**
 * JRX-MEMORY-AUTHZ-001 — memory route identity is the authenticated caller.
 * A 403 must not fall through into flush, export, or import.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import express from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

const calls = {
  remember: [] as Array<Record<string, unknown>>,
  recall: [] as Array<Record<string, unknown>>,
  flush: [] as string[],
  export: [] as string[],
  import: 0,
  publish: [] as Array<Record<string, unknown>>,
};

beforeEach(() => {
  calls.remember = [];
  calls.recall = [];
  calls.flush = [];
  calls.export = [];
  calls.import = 0;
  calls.publish = [];
});

vi.mock('../../src/middleware/jrx-auth.js', () => ({
  authenticateToken: (req: any, _res: any, next: any) => {
    req.user = {
      id: req.headers['x-test-user'] || 'user-a',
      role: req.headers['x-test-role'] || 'user',
      organizationId: req.headers['x-test-org'] || 'org-a',
    };
    next();
  },
}));

vi.mock('../../src/services/jrx-memory-manager.js', () => ({
  nvMemoryManager: {
    remember: vi.fn(async (input: Record<string, unknown>) => {
      calls.remember.push(input);
      return { id: 'mem_1', tier: input.tier ?? 'session', type: input.type, createdAt: new Date(), expiresAt: undefined };
    }),
    recall: vi.fn(async (input: Record<string, unknown>) => {
      calls.recall.push(input);
      return [{ id: 'mem_1', content: 'secret', userId: input.userId }];
    }),
    flushUser: vi.fn(async (userId: string) => {
      calls.flush.push(userId);
      return { flushedSession: 1, flushedLongterm: 1, flushedSocial: 0 };
    }),
    export: vi.fn(async (userId: string) => {
      calls.export.push(userId);
      return [{ id: 'mem_1', content: 'secret', userId }];
    }),
    import: vi.fn(async () => {
      calls.import += 1;
      return 1;
    }),
    agentPublish: vi.fn(async (_agentId: string, _sessionId: string, entries: Array<Record<string, unknown>>) => {
      calls.publish.push(...entries);
    }),
    getStats: vi.fn(() => ({ pressure: { status: 'normal' } })),
  },
}));

const router = (await import('../../src/routes/jrx-memory-manager-routes.js')).default;

const app = express();
app.use(express.json());
app.use('/api/jrx/memory', router);

let server: http.Server;
let baseUrl = '';

await new Promise<void>((resolve) => {
  server = app.listen(0, '127.0.0.1', () => {
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    resolve();
  });
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));

function headers(extra: Record<string, string> = {}): Record<string, string> {
  return { 'content-type': 'application/json', ...extra };
}

describe('memory route authorization', () => {
  it('does not flush another user after 403', async () => {
    const res = await fetch(`${baseUrl}/api/jrx/memory/flush/user-b`, {
      method: 'DELETE',
      headers: headers({ 'x-test-user': 'user-a', 'x-test-role': 'user' }),
    });
    expect(res.status).toBe(403);
    expect(calls.flush).toEqual([]);
  });

  it('flushes the caller themselves', async () => {
    const res = await fetch(`${baseUrl}/api/jrx/memory/flush/user-a`, {
      method: 'DELETE',
      headers: headers({ 'x-test-user': 'user-a', 'x-test-role': 'user' }),
    });
    expect(res.status).toBe(200);
    expect(calls.flush).toEqual(['user-a']);
  });

  it('does not export another user after 403', async () => {
    const res = await fetch(`${baseUrl}/api/jrx/memory/export/user-b`, {
      headers: headers({ 'x-test-user': 'user-a', 'x-test-role': 'user' }),
    });
    expect(res.status).toBe(403);
    expect(calls.export).toEqual([]);
  });

  it('does not import when the caller is not an admin', async () => {
    const res = await fetch(`${baseUrl}/api/jrx/memory/import`, {
      method: 'POST',
      headers: headers({ 'x-test-user': 'user-a', 'x-test-role': 'user' }),
      body: JSON.stringify({ entries: [{ id: 'x', userId: 'user-b', content: 'planted' }] }),
    });
    expect(res.status).toBe(403);
    expect(calls.import).toBe(0);
  });

  it('recalls as the authenticated user even when the body names someone else', async () => {
    const res = await fetch(`${baseUrl}/api/jrx/memory/recall`, {
      method: 'POST',
      headers: headers({ 'x-test-user': 'user-a', 'x-test-org': 'org-a' }),
      body: JSON.stringify({ userId: 'user-b', tiers: ['longterm'] }),
    });
    expect(res.status).toBe(200);
    expect(calls.recall).toEqual([
      expect.objectContaining({ userId: 'user-a', orgId: undefined }),
    ]);
  });

  it('rejects a recall orgId that is not the caller organization', async () => {
    const res = await fetch(`${baseUrl}/api/jrx/memory/recall`, {
      method: 'POST',
      headers: headers({ 'x-test-user': 'user-a', 'x-test-org': 'org-a' }),
      body: JSON.stringify({ orgId: 'org-victim', tiers: ['social'] }),
    });
    expect(res.status).toBe(403);
    expect(calls.recall).toEqual([]);
  });

  it('stores remember under the caller and refuses a foreign org', async () => {
    const denied = await fetch(`${baseUrl}/api/jrx/memory/remember`, {
      method: 'POST',
      headers: headers({ 'x-test-user': 'user-a', 'x-test-org': 'org-a' }),
      body: JSON.stringify({ content: 'fact', type: 'fact', tier: 'social', orgId: 'org-victim' }),
    });
    expect(denied.status).toBe(403);
    expect(calls.remember).toEqual([]);

    const ok = await fetch(`${baseUrl}/api/jrx/memory/remember`, {
      method: 'POST',
      headers: headers({ 'x-test-user': 'user-a', 'x-test-org': 'org-a' }),
      body: JSON.stringify({ content: 'fact', type: 'fact', tier: 'longterm' }),
    });
    expect(ok.status).toBe(201);
    expect(calls.remember).toEqual([
      expect.objectContaining({ userId: 'user-a', content: 'fact', orgId: undefined }),
    ]);
  });

  it('publishes agent memory as the caller, not the entry userId', async () => {
    const res = await fetch(`${baseUrl}/api/jrx/memory/agent/publish`, {
      method: 'POST',
      headers: headers({ 'x-test-user': 'user-a' }),
      body: JSON.stringify({
        agentId: 'contract-drafter',
        sessionId: 's1',
        entries: [{ userId: 'user-b', content: 'planted', type: 'fact' }],
      }),
    });
    expect(res.status).toBe(201);
    expect(calls.publish).toEqual([
      expect.objectContaining({ userId: 'user-a', content: 'planted' }),
    ]);
  });
});
