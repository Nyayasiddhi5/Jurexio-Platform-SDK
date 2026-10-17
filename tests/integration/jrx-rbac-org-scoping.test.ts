/**
 * task-224 — Regression test for org-level RBAC isolation across the four
 * product routers (AutomateAI / ClaWdBot / OpenBot / TwinDesk).
 *
 * Strategy: spin up an express app with each live router mounted, stub
 * authenticateToken so we can flip between two organizations via a header,
 * then assert that:
 *
 *   - Lists are filtered by the caller's orgId.
 *   - Cross-org reads return 404.
 *   - Cross-org writes (delete / mutate) return 403.
 *
 * Before this fix every router defaulted the caller's orgId to '1', so as soon
 * as a second tenant logged into the console they could see and mutate every
 * other tenant's bots / workflows / channels / twins.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

vi.mock('../../src/middleware/jrx-auth.js', () => ({
  authenticateToken: (req: any, _res: any, next: any) => {
    const org = req.headers['x-test-org'];
    const id = req.headers['x-test-user-id'] || `usr_${org ?? 'anon'}`;
    if (org) {
      req.user = { id, userId: id, role: 'admin', organizationId: String(org) };
    }
    next();
  },
  requireRole: (..._allowed: string[]) => (_req: any, _res: any, next: any) => next(),
  requireAdmin: (_req: any, _res: any, next: any) => next(),
  AuthRequest: undefined as any,
}));

vi.mock('../../src/middleware/auth.js', async () => {
  const m = await import('../../src/middleware/jrx-auth.js');
  return m;
});

// Persistence helpers used by the services — stub them so nothing tries to
// write to a real database during the test.
vi.mock('../../src/services/persistence/jrx-persistence-helper.js', () => ({
  selectRows: vi.fn(async () => []),
  upsertRow: vi.fn(async () => undefined),
  softDelete: vi.fn(async () => undefined),
}));

const automateRouter = (await import('../../src/routes/jrx-automateai-routes.js')).default;
const clawdRouter = (await import('../../src/routes/jrx-clawdbot-routes.js')).default;
const openRouter = (await import('../../src/routes/jrx-openbot-routes.js')).default;
const twinRouter = (await import('../../src/routes/jrx-twindesk-routes.js')).default;

const app = express();
app.use(express.json());
app.use('/api/jrx/automateai', automateRouter);
app.use('/api/jrx/clawdbot', clawdRouter);
app.use('/api/jrx/openbot', openRouter);
app.use('/api/jrx/twindesk', twinRouter);

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

afterAll(
  () =>
    new Promise<void>((resolve) => {
      server.close(() => resolve());
    }),
);

function as(org: string) {
  return { 'content-type': 'application/json', 'x-test-org': org };
}

async function http_(method: string, path: string, org: string, body?: unknown) {
  const r = await fetch(`${baseUrl}${path}`, {
    method,
    headers: as(org),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json: any = null;
  try { json = await r.json(); } catch { /* ignore */ }
  return { status: r.status, body: json };
}

describe('task-224: org-level RBAC isolation across product routers', () => {
  it('AutomateAI workflows are scoped per-org and cross-org access is blocked', async () => {
    const a = await http_('POST', '/api/jrx/automateai/workflows', 'org-A', { name: 'orgA wf', jurisdiction: 'IN' });
    expect(a.status).toBe(201);
    const wfA = a.body.workflow.workflowId;

    const b = await http_('POST', '/api/jrx/automateai/workflows', 'org-B', { name: 'orgB wf' });
    expect(b.status).toBe(201);
    const wfB = b.body.workflow.workflowId;

    // Lists are scoped
    const listA = await http_('GET', '/api/jrx/automateai/workflows', 'org-A');
    expect(listA.body.workflows.map((w: any) => w.workflowId)).toContain(wfA);
    expect(listA.body.workflows.map((w: any) => w.workflowId)).not.toContain(wfB);

    // Cross-org READ → 404
    const crossRead = await http_('GET', `/api/jrx/automateai/workflows/${wfB}`, 'org-A');
    expect(crossRead.status).toBe(404);

    // Cross-org WRITE → 403
    const crossDelete = await http_('DELETE', `/api/jrx/automateai/workflows/${wfB}`, 'org-A');
    expect(crossDelete.status).toBe(403);

    const crossActivate = await http_('POST', `/api/jrx/automateai/workflows/${wfB}/activate`, 'org-A');
    expect(crossActivate.status).toBe(403);

    // Owner can still operate
    const ownActivate = await http_('POST', `/api/jrx/automateai/workflows/${wfB}/activate`, 'org-B');
    expect(ownActivate.status).toBe(200);
  });

  it('ClaWdBot bots are scoped per-org and cross-org access is blocked', async () => {
    const a = await http_('POST', '/api/jrx/clawdbot/bots', 'org-A', { name: 'orgA bot' });
    expect(a.status).toBe(201);
    const botA = a.body.bot.botId;

    const b = await http_('POST', '/api/jrx/clawdbot/bots', 'org-B', { name: 'orgB bot' });
    expect(b.status).toBe(201);
    const botB = b.body.bot.botId;

    const listB = await http_('GET', '/api/jrx/clawdbot/bots', 'org-B');
    expect(listB.body.bots.map((b: any) => b.botId)).toContain(botB);
    expect(listB.body.bots.map((b: any) => b.botId)).not.toContain(botA);

    expect((await http_('GET', `/api/jrx/clawdbot/bots/${botA}`, 'org-B')).status).toBe(404);
    expect((await http_('PUT', `/api/jrx/clawdbot/bots/${botA}`, 'org-B', { name: 'pwn' })).status).toBe(403);
    expect((await http_('DELETE', `/api/jrx/clawdbot/bots/${botA}`, 'org-B')).status).toBe(403);
    expect((await http_('POST', `/api/jrx/clawdbot/bots/${botA}/pause`, 'org-B')).status).toBe(403);

    // task-224: WhatsApp webhook is authenticated → cross-org POST must be 403,
    // owner POST must succeed (we don't care about the bot's status here, just
    // that the auth gate stopped the cross-org caller).
    const crossWebhook = await http_('POST', `/api/jrx/clawdbot/webhooks/whatsapp/${botA}`, 'org-B', {
      from: '+15551234567', body: 'hello', messageId: 'wamid_x',
    });
    expect(crossWebhook.status).toBe(403);
    const ownWebhook = await http_('POST', `/api/jrx/clawdbot/webhooks/whatsapp/${botA}`, 'org-A', {
      from: '+15551234567', body: 'hello', messageId: 'wamid_y',
    });
    expect(ownWebhook.status).not.toBe(403);
    expect(ownWebhook.status).not.toBe(404);
  });

  it('OpenBot channels and rules are scoped per-org and cross-org access is blocked', async () => {
    const a = await http_('POST', '/api/jrx/openbot/channels', 'org-A', { channel: 'web', name: 'orgA web' });
    expect(a.status).toBe(201);
    const chA = a.body.channel.channelId;

    const b = await http_('POST', '/api/jrx/openbot/channels', 'org-B', { channel: 'web', name: 'orgB web' });
    expect(b.status).toBe(201);
    const chB = b.body.channel.channelId;

    const listA = await http_('GET', '/api/jrx/openbot/channels', 'org-A');
    expect(listA.body.channels.map((c: any) => c.channelId)).toContain(chA);
    expect(listA.body.channels.map((c: any) => c.channelId)).not.toContain(chB);

    expect((await http_('GET', `/api/jrx/openbot/channels/${chB}/inbox`, 'org-A')).status).toBe(404);
    expect((await http_('DELETE', `/api/jrx/openbot/channels/${chB}`, 'org-A')).status).toBe(403);

    // Routing rules
    const ruleA = await http_('POST', '/api/jrx/openbot/rules', 'org-A', { name: 'orgA rule', targetBotId: 'BOT-A' });
    expect(ruleA.status).toBe(201);
    const ruleB = await http_('POST', '/api/jrx/openbot/rules', 'org-B', { name: 'orgB rule', targetBotId: 'BOT-B' });
    expect(ruleB.status).toBe(201);

    const rulesA = await http_('GET', '/api/jrx/openbot/rules', 'org-A');
    expect(rulesA.body.rules.map((r: any) => r.ruleId)).toContain(ruleA.body.rule.ruleId);
    expect(rulesA.body.rules.map((r: any) => r.ruleId)).not.toContain(ruleB.body.rule.ruleId);

    expect((await http_('DELETE', `/api/jrx/openbot/rules/${ruleB.body.rule.ruleId}`, 'org-A')).status).toBe(403);

    // Send to send messages on the other tenant's channel and confirm 403; then on owner's channel and confirm 200.
    expect((await http_('POST', `/api/jrx/openbot/channels/${chB}/send`, 'org-A', { to: 'foo', content: 'hi' })).status).toBe(403);
    expect((await http_('POST', `/api/jrx/openbot/channels/${chB}/send`, 'org-B', { to: 'foo', content: 'hi' })).status).toBe(200);

    // Unified inbox is org-scoped — org-A must not see anything posted to org-B's channel.
    const inbox = await http_('GET', '/api/jrx/openbot/inbox', 'org-A');
    const channelsSeen = new Set<string>(inbox.body.messages.map((m: any) => m.channelId));
    expect(channelsSeen.has(chB)).toBe(false);
  });

  it('TwinDesk twins are scoped per-org and cross-org access is blocked', async () => {
    const a = await http_('POST', '/api/jrx/twindesk/twins', 'org-A', {
      name: 'orgA twin', persona: 'managing-partner', expertise: 'M&A',
    });
    expect(a.status).toBe(201);
    const tA = a.body.twin.twinId;

    const b = await http_('POST', '/api/jrx/twindesk/twins', 'org-B', {
      name: 'orgB twin', persona: 'senior-litigator', expertise: 'Litigation',
    });
    expect(b.status).toBe(201);
    const tB = b.body.twin.twinId;

    const listA = await http_('GET', '/api/jrx/twindesk/twins', 'org-A');
    expect(listA.body.twins.map((t: any) => t.twinId)).toContain(tA);
    expect(listA.body.twins.map((t: any) => t.twinId)).not.toContain(tB);

    expect((await http_('GET', `/api/jrx/twindesk/twins/${tB}`, 'org-A')).status).toBe(404);
    expect((await http_('PATCH', `/api/jrx/twindesk/twins/${tB}`, 'org-A', { name: 'pwn' })).status).toBe(403);
    expect((await http_('DELETE', `/api/jrx/twindesk/twins/${tB}`, 'org-A')).status).toBe(403);
    expect((await http_('POST', `/api/jrx/twindesk/twins/${tB}/chat`, 'org-A', { message: 'hello' })).status).toBe(403);
    expect((await http_('POST', `/api/jrx/twindesk/twins/${tB}/benchmark`, 'org-A')).status).toBe(403);
  });
});
