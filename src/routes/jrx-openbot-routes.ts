// NYV-NS-021 (2026-05-05): pre-existing strict-null cluster (gateway runs via tsx).
/**
 * OpenBot™ REST Routes — /api/jrx/openbot/*
 * Multi-Channel Studio | Jurexio Enterprise Platform 312
 *
 * ENDPOINTS:
 *   POST   /channels                         Add a channel
 *   GET    /channels                         List all channels
 *   DELETE /channels/:channelId              Remove a channel
 *
 *   POST   /channels/:channelId/send         Send a message on a channel
 *   GET    /channels/:channelId/inbox        Get channel inbox (last N messages)
 *   GET    /inbox                            Unified inbox across all channels
 *
 *   POST   /rules                            Add routing rule
 *   GET    /rules                            List routing rules
 *
 *   POST   /webhooks/:channel/:channelId     Incoming webhook handler
 *   GET    /stats                            Service stats
 */

import { Router, Request, Response } from 'express';
import { z, ZodError } from 'zod';
import { authenticateToken } from '../middleware/auth.js';
import { openBotService } from '../services/openbot/openbot-service.js';
import { sanitizeErrorForClient } from '../utils/error-sanitizer.js';

const router = Router();
router.use(authenticateToken as any);

const CHANNELS = ['whatsapp', 'slack', 'teams', 'telegram', 'email', 'web', 'api'] as const;

// task-224: caller's org scope. Falls back to a per-user pseudo-org so two
// users without an organizationId on their token are still isolated from each
// other (was previously absent, leaking every tenant's channels & rules).
function getOrgId(req: Request): string {
  const user: any = req.user;
  const org = user?.organizationId ?? user?.orgId ?? user?.org_id;
  if (org !== undefined && org !== null && String(org).length > 0) return String(org);
  return `__user_${user?.id ?? 'anon'}__`;
}

function ownedChannel(req: Request, res: Response, mode: 'read' | 'write'): any | null {
  // @ts-expect-error NV-TS230 legacy typing gap (TS2345)
  const ch = openBotService.getChannel(req.params.channelId);
  if (!ch) {
    res.status(404).json({ success: false, error: 'Channel not found' });
    return null;
  }
  if (String(ch.orgId) !== getOrgId(req)) {
    if (mode === 'write') {
      res.status(403).json({ success: false, error: 'Forbidden: channel belongs to another organization' });
    } else {
      res.status(404).json({ success: false, error: 'Channel not found' });
    }
    return null;
  }
  return ch;
}

// ── CHANNELS ──────────────────────────────────────────────────────────────────
router.post('/channels', async (req: Request, res: Response) => {
  try {
    const schema = z.object({
      channel: z.enum(CHANNELS),
      name: z.string().min(2).max(80),
      credentials: z.record(z.string()).optional(),
      botIds: z.array(z.string()).optional(),
    });
    const input = schema.parse(req.body);
    const channel = openBotService.addChannel({ ...input, orgId: getOrgId(req) });
    res.status(201).json({ success: true, channel });
  } catch (err: any) {
    if (err instanceof ZodError) { res.status(400).json({ error: err.errors }); return; }
    res.status(500).json({ error: sanitizeErrorForClient(err) });
  }
});

router.get('/channels', async (req: Request, res: Response) => {
  // task-236: await the DB-backed reconcile so a freshly-restarted (or peer)
  // pod returns channels its in-memory cache hasn't seen yet.
  const channels = await openBotService.listChannelsAsync(getOrgId(req));
  res.json({ success: true, channels, total: channels.length });
});

router.delete('/channels/:channelId', (req: Request, res: Response) => {
  if (!ownedChannel(req, res, 'write')) return;
  // @ts-expect-error NV-TS230 legacy typing gap (TS2345)
  const removed = openBotService.removeChannel(req.params.channelId);
  if (!removed) { res.status(404).json({ success: false, error: 'Channel not found' }); return; }
  res.json({ success: true, message: 'Channel removed' });
});

// ── SEND MESSAGE ──────────────────────────────────────────────────────────────
router.post('/channels/:channelId/send', async (req: Request, res: Response) => {
  try {
    const schema = z.object({
      to: z.string().min(1),
      content: z.string().min(1).max(10000),
      options: z.record(z.unknown()).optional(),
    });
    const input = schema.parse(req.body);
    const channel = ownedChannel(req, res, 'write');
    if (!channel) return;
    const msg = await openBotService.sendMessage({
      // @ts-expect-error NV-TS230 legacy typing gap (TS2322)
      channelId: req.params.channelId,
      channel: channel.channel,
      to: input.to,
      content: input.content,
      options: input.options,
    });
    res.json({ success: true, message: msg });
  } catch (err: any) {
    if (err instanceof ZodError) { res.status(400).json({ error: err.errors }); return; }
    res.status(500).json({ error: sanitizeErrorForClient(err) });
  }
});

// ── INBOX ─────────────────────────────────────────────────────────────────────
router.get('/channels/:channelId/inbox', async (req: Request, res: Response) => {
  if (!ownedChannel(req, res, 'read')) return;
  const limit = parseInt(String(req.query.limit ?? '50'), 10);
  // task-236: DB-backed read survives a gateway restart.
  // @ts-expect-error NV-TS230 legacy typing gap (TS2345)
  const messages = await openBotService.getInboxAsync(req.params.channelId, limit);
  res.json({ success: true, messages, total: messages.length });
});

router.get('/inbox', async (req: Request, res: Response) => {
  const limit = parseInt(String(req.query.limit ?? '100'), 10);
  // task-236: DB-backed read; surfaces SLA so callers know in-flight messages
  // are persisted (no longer "lost on restart" — that note is kept as a
  // soft-degradation hint for the legacy in-memory fallback path).
  const messages = await openBotService.getUnifiedInboxAsync(limit, getOrgId(req));
  res.json({
    success: true,
    messages,
    total: messages.length,
    sla: 'inbox-persisted',
    note: 'Messages are persisted to nv_schema.nv_openbot_inbox; if the DB is unreachable the response falls back to in-memory and older messages may be lost.',
  });
});

// ── ROUTING RULES ─────────────────────────────────────────────────────────────
router.post('/rules', async (req: Request, res: Response) => {
  try {
    const schema = z.object({
      name: z.string().min(2).max(80),
      priority: z.number().int().min(1).max(100).optional().default(50),
      conditions: z.object({
        channels: z.array(z.enum(CHANNELS)).optional(),
        keywords: z.array(z.string()).optional(),
        userGroups: z.array(z.string()).optional(),
      }).optional(),
      targetBotId: z.string().min(1),
      fallbackBotId: z.string().optional(),
      isActive: z.boolean().optional().default(true),
    });
    const input = schema.parse(req.body);
    const rule = openBotService.addRoutingRule({ ...input, orgId: getOrgId(req) } as any);
    res.status(201).json({ success: true, rule });
  } catch (err: any) {
    if (err instanceof ZodError) { res.status(400).json({ error: err.errors }); return; }
    res.status(500).json({ error: sanitizeErrorForClient(err) });
  }
});

router.get('/rules', async (req: Request, res: Response) => {
  // task-236: await DB-backed reconcile so a peer pod's writes are visible.
  const rules = await openBotService.listRoutingRulesAsync(getOrgId(req));
  res.json({ success: true, rules, total: rules.length });
});

router.delete('/rules/:ruleId', (req: Request, res: Response) => {
  // task-224: ownership check before mutation.
  // @ts-expect-error NV-TS230 legacy typing gap (TS2345)
  const rule = openBotService.getRoutingRule(req.params.ruleId);
  if (!rule) { res.status(404).json({ success: false, error: 'Rule not found' }); return; }
  if (String(rule.orgId) !== getOrgId(req)) {
    res.status(403).json({ success: false, error: 'Forbidden: rule belongs to another organization' });
    return;
  }
  // @ts-expect-error NV-TS230 legacy typing gap (TS2345)
  const removed = openBotService.removeRoutingRule(req.params.ruleId);
  if (!removed) { res.status(404).json({ success: false, error: 'Rule not found' }); return; }
  res.json({ success: true, message: 'Rule removed' });
});

// ── WEBHOOKS ──────────────────────────────────────────────────────────────────
router.post('/webhooks/:channel/:channelId', async (req: Request, res: Response) => {
  try {
    const { channel, channelId } = req.params;
    // task-224: webhook must target a channel owned by the caller's org.
    if (!ownedChannel(req, res, 'write')) return;

    const from = req.body?.from ?? req.body?.user ?? req.body?.phone ?? 'unknown';
    const msg = await openBotService.receiveMessage({
      // @ts-expect-error NV-TS230 legacy typing gap (TS2322)
      channelId,
      channel: channel as any,
      from,
      rawPayload: req.body,
      metadata: { ip: req.ip, userAgent: req.headers['user-agent'] },
    });

    res.json({ success: true, messageId: msg.messageId, status: msg.status });
  } catch (err: any) {
    res.status(500).json({ error: sanitizeErrorForClient(err) });
  }
});

// ── STATS ──────────────────────────────────────────────────────────────────────
router.get('/stats', (_req: Request, res: Response) => {
  res.json({ success: true, ...openBotService.getStats() });
});

export default router;
