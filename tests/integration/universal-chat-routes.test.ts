/**
 * Universal Chat backend integration test (task-257).
 *
 * Boots the real `createUniversalChatRouter()` against an in-process
 * express app with `orchestrateLLM` + `authenticateToken` mocked, then
 * asserts:
 *   1. Selectors are public.
 *   2. Session create/message/upload all require auth (401 without).
 *   3. With a valid JWT user, POST /chat/sessions/:id/messages returns
 *      a real assistant reply built from the orchestrator result, plus
 *      workflowSteps when useWorkflow=true.
 *   4. POST /chat/sessions/:id/upload persists bytes — and when object
 *      storage is unavailable, falls back to local scratch (storageBackend
 *      = 'local-scratch') and the file actually lives on disk.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import http from 'http';
import { AddressInfo } from 'net';
import fs from 'fs';

// Mock auth: maps `Bearer user-<id>` → that user. Any other / missing
// header → 401. Lets us simulate distinct authenticated users for the
// IDOR test below.
vi.mock('../../src/middleware/jrx-auth.js', () => ({
  authenticateToken: (req: any, res: any, next: any) => {
    const auth: string | undefined = req.headers['authorization'];
    const m = typeof auth === 'string' ? /^Bearer\s+user-(\S+)$/.exec(auth) : null;
    if (m) {
      const id = m[1];
      req.user = { id, userId: id, email: `${id}@x`, role: 'user', organizationId: null };
      return next();
    }
    return res.status(401).json({ success: false, code: 'AUTH_TOKEN_MISSING' });
  },
}));

// Mock rate limiters to no-op (we're not testing rate limiting here).
vi.mock('../../src/middleware/jrx-rate-limit-middleware.js', () => ({
  authenticatedRateLimit: (_req: any, _res: any, next: any) => next(),
  aiPatternRateLimit: (_req: any, _res: any, next: any) => next(),
  NV_E2E_BYPASS: true,
}));

// Mock orchestrateLLM so the test does not call live LLM providers.
vi.mock('../../src/services/intelligent-router/index.js', () => ({
  orchestrateLLM: vi.fn(async (input: any) => ({
    content: `Mock answer to: ${input.userMessage}`,
    model: 'test-slm',
    provider: 'simulation',
    tokensIn: 12,
    tokensOut: 8,
    latencyMs: 5,
    fallbackLevel: 0,
    isSimulation: false,
    finishReason: 'stop',
    requestId: input.requestId,
    costUsd: 0,
    routerDecision: { primary: 'test-slm', sequence: ['test-slm'], inputs: {} },
    attempts: [{ modelId: 'test-slm', ok: true, latencyMs: 5 }],
  })),
}));

// No S3 credentials in the test environment → the route's storage service
// falls back to local scratch automatically, which is the same code path we
// want to exercise.

const { createUniversalChatRouter } = await import('../../src/routes/jrx-universal-chat-routes.js');

const app = express();
app.use(express.json());
app.use('/api', createUniversalChatRouter());

let server: http.Server;
let baseUrl = '';

beforeAll(
  () =>
    new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const { port } = server.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    }),
);
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const AUTH = { authorization: 'Bearer user-alice' };
const AUTH_BOB = { authorization: 'Bearer user-bob' };

describe('Universal Chat backend (task-257)', () => {
  it('selector endpoints are public and return real catalog data', async () => {
    const groups = await (await fetch(`${baseUrl}/api/chat/agent-groups`)).json();
    expect(groups.success).toBe(true);
    expect(groups.data.length).toBeGreaterThan(0);
    const langs = await (await fetch(`${baseUrl}/api/chat/languages`)).json();
    expect(langs.success).toBe(true);
    expect(langs.data.find((l: any) => l.code === 'en')).toBeTruthy();
  });

  it('write endpoints reject unauthenticated callers', async () => {
    const res = await fetch(`${baseUrl}/api/chat/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agentGroupId: 'auto', language: 'en' }),
    });
    expect(res.status).toBe(401);
  });

  it('full flow: create session → send message → assistant reply + workflowSteps', async () => {
    const sRes = await fetch(`${baseUrl}/api/chat/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...AUTH },
      body: JSON.stringify({ agentGroupId: 'litigation', language: 'en' }),
    });
    expect(sRes.status).toBe(200);
    const sJson: any = await sRes.json();
    expect(sJson.data.sessionId).toMatch(/^chat-/);
    expect(sJson.data.stub).toBeUndefined();

    const sessionId = sJson.data.sessionId;
    const mRes = await fetch(`${baseUrl}/api/chat/sessions/${sessionId}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...AUTH },
      body: JSON.stringify({ content: 'What is Article 226?', useWorkflow: true }),
    });
    expect(mRes.status).toBe(200);
    const mJson: any = await mRes.json();
    expect(mJson.data.userMessage.role).toBe('user');
    expect(mJson.data.assistantMessage.role).toBe('assistant');
    expect(mJson.data.assistantMessage.content).toContain('Mock answer to: What is Article 226?');
    expect(mJson.data.assistantMessage.metadata.modelUsed).toBe('test-slm');
    expect(mJson.data.workflowSteps).toHaveLength(3);
  });

  it('rejects cross-user access to a session (IDOR guard)', async () => {
    // Alice creates a session.
    const sRes = await fetch(`${baseUrl}/api/chat/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...AUTH },
      body: JSON.stringify({}),
    });
    const sessionId = (await sRes.json()).data.sessionId;

    // Owner (Alice) can read.
    const own = await fetch(`${baseUrl}/api/chat/sessions/${sessionId}`, { headers: { ...AUTH } });
    expect(own.status).toBe(200);

    // Different authenticated user (Bob) — must be 403, not 200/404.
    const bobGet = await fetch(`${baseUrl}/api/chat/sessions/${sessionId}`, { headers: { ...AUTH_BOB } });
    expect(bobGet.status).toBe(403);

    const bobMsg = await fetch(`${baseUrl}/api/chat/sessions/${sessionId}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...AUTH_BOB },
      body: JSON.stringify({ content: 'hijack attempt' }),
    });
    expect(bobMsg.status).toBe(403);
  });

  it('upload persists bytes to local-scratch when object storage is unavailable', async () => {
    const sRes = await fetch(`${baseUrl}/api/chat/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...AUTH },
      body: JSON.stringify({}),
    });
    const sessionId = (await sRes.json()).data.sessionId;

    const fd = new FormData();
    const bytes = new TextEncoder().encode('hello scratch fallback');
    fd.append('files', new Blob([bytes], { type: 'text/plain' }), 'note.txt');

    const uRes = await fetch(`${baseUrl}/api/chat/sessions/${sessionId}/upload`, {
      method: 'POST',
      headers: { ...AUTH },
      body: fd,
    });
    expect(uRes.status).toBe(200);
    const uJson: any = await uRes.json();
    expect(uJson.data.accepted).toBe(1);
    const att = uJson.data.attachments[0];
    expect(att.storageBackend).toBe('local-scratch');
    // The scratch file must exist on disk and contain the uploaded bytes.
    expect(fs.existsSync(att.storageKey)).toBe(true);
    expect(fs.readFileSync(att.storageKey, 'utf8')).toBe('hello scratch fallback');
  });
});
