// JRX-NS-021 (2026-05-05): pre-existing strict-null cluster (gateway runs via tsx).
/**
 * ClaWdBot™ REST Routes — /api/jrx/clawdbot/*
 * Legal Chatbot Builder | Jurexio Enterprise Platform 312
 *
 * ENDPOINTS:
 *   POST   /bots                              Create a new chatbot
 *   GET    /bots                              List all bots for org
 *   GET    /bots/:botId                       Get bot config
 *   PUT    /bots/:botId                       Update bot config
 *   POST   /bots/:botId/activate              Activate bot
 *   POST   /bots/:botId/pause                 Pause bot
 *   DELETE /bots/:botId                       Delete bot
 *
 *   POST   /bots/:botId/chat                  Send message to bot
 *   GET    /bots/:botId/conversations         List conversations
 *   GET    /conversations/:conversationId      Get conversation history
 *   POST   /conversations/:conversationId/close  Close conversation
 *
 *   POST   /webhooks/whatsapp/:botId          WhatsApp incoming message webhook
 *   GET    /bots/:botId/analytics             Bot analytics
 *   GET    /stats                             Service stats
 */

import { Router, Request, Response } from 'express';
import { z, ZodError } from 'zod';
import { authenticateToken } from '../middleware/auth.js';
import { claWdBotService } from '../services/clawdbot/clawdbot-service.js';
import { sanitizeErrorForClient } from '../utils/error-sanitizer.js';

const router = Router();
router.use(authenticateToken as any);

// task-224: caller's org scope. Falls back to a per-user pseudo-org so two
// users without an organizationId on their token are still isolated from each
// other (was previously hard-coded to '1', leaking every tenant's bots).
function getOrgId(req: Request): string {
  const user: any = req.user;
  const org = user?.organizationId ?? user?.orgId ?? user?.org_id;
  if (org !== undefined && org !== null && String(org).length > 0) return String(org);
  return `__user_${user?.id ?? 'anon'}__`;
}

// task-224: ownership guard. Returns the bot only if the caller owns it.
// `mode='read'` returns 404 on miss; `mode='write'` returns 403 when the row
// belongs to another org.
function loadOwnedBot(req: Request, res: Response, mode: 'read' | 'write'): any | null {
  // @ts-expect-error NV-TS230 legacy typing gap (TS2345)
  const bot = claWdBotService.getBot(req.params.botId);
  if (!bot) {
    res.status(404).json({ success: false, error: 'Bot not found' });
    return null;
  }
  if (String(bot.orgId) !== getOrgId(req)) {
    if (mode === 'write') {
      res.status(403).json({ success: false, error: 'Forbidden: bot belongs to another organization' });
    } else {
      res.status(404).json({ success: false, error: 'Bot not found' });
    }
    return null;
  }
  return bot;
}

// ── CREATE BOT ────────────────────────────────────────────────────────────────
router.post('/bots', async (req: Request, res: Response) => {
  try {
    const schema = z.object({
      name: z.string().min(2).max(80),
      channels: z.array(z.enum(['whatsapp', 'web', 'api', 'telegram', 'email'])).optional(),
      jurisdiction: z.string().optional(),
      legalDomains: z.array(z.string()).optional(),
      language: z.string().optional(),
      persona: z.object({
        greeting: z.string().optional(),
        tone: z.enum(['formal', 'friendly', 'professional']).optional(),
        signOff: z.string().optional(),
      }).optional(),
      hitlConfig: z.object({
        enabled: z.boolean().optional(),
        maxAutoReplies: z.number().int().min(1).max(20).optional(),
        escalationMessage: z.string().optional(),
      }).optional(),
    });
    const input = schema.parse(req.body);
    const orgId = getOrgId(req);
    const bot = claWdBotService.createBot({ ...input, name: input.name ?? 'Bot', orgId });
    res.status(201).json({ success: true, bot });
  } catch (err: any) {
    if (err instanceof ZodError) { res.status(400).json({ error: err.errors }); return; }
    res.status(500).json({ error: sanitizeErrorForClient(err) });
  }
});

// ── LIST BOTS ─────────────────────────────────────────────────────────────────
router.get('/bots', (_req: Request, res: Response) => {
  const orgId = getOrgId(_req);
  const bots = claWdBotService.listBots(orgId);
  res.json({ success: true, bots, total: bots.length });
});

// ── GET BOT ───────────────────────────────────────────────────────────────────
router.get('/bots/:botId', (req: Request, res: Response) => {
  const bot = loadOwnedBot(req, res, 'read');
  if (!bot) return;
  res.json({ success: true, bot });
});

// ── UPDATE BOT ────────────────────────────────────────────────────────────────
router.put('/bots/:botId', async (req: Request, res: Response) => {
  try {
    if (!loadOwnedBot(req, res, 'write')) return;
    // @ts-expect-error NV-TS230 legacy typing gap (TS2345)
    const bot = claWdBotService.updateBot(req.params.botId, req.body);
    if (!bot) { res.status(404).json({ success: false, error: 'Bot not found' }); return; }
    res.json({ success: true, bot });
  } catch (err: any) {
    res.status(500).json({ error: sanitizeErrorForClient(err) });
  }
});

// ── ACTIVATE / PAUSE BOT ─────────────────────────────────────────────────────
router.post('/bots/:botId/activate', (req: Request, res: Response) => {
  if (!loadOwnedBot(req, res, 'write')) return;
  // @ts-expect-error NV-TS230 legacy typing gap (TS2345)
  const bot = claWdBotService.activateBot(req.params.botId);
  if (!bot) { res.status(404).json({ success: false, error: 'Bot not found' }); return; }
  res.json({ success: true, bot, message: `Bot ${bot.name} is now active` });
});

router.post('/bots/:botId/pause', (req: Request, res: Response) => {
  if (!loadOwnedBot(req, res, 'write')) return;
  // @ts-expect-error NV-TS230 legacy typing gap (TS2345)
  const bot = claWdBotService.pauseBot(req.params.botId);
  if (!bot) { res.status(404).json({ success: false, error: 'Bot not found' }); return; }
  res.json({ success: true, bot, message: `Bot ${bot.name} paused` });
});

// ── DELETE BOT ────────────────────────────────────────────────────────────────
router.delete('/bots/:botId', (req: Request, res: Response) => {
  if (!loadOwnedBot(req, res, 'write')) return;
  // @ts-expect-error NV-TS230 legacy typing gap (TS2345)
  const deleted = claWdBotService.deleteBot(req.params.botId);
  if (!deleted) { res.status(404).json({ success: false, error: 'Bot not found' }); return; }
  res.json({ success: true, message: 'Bot deleted' });
});

// ── SEND MESSAGE ──────────────────────────────────────────────────────────────
router.post('/bots/:botId/chat', async (req: Request, res: Response) => {
  try {
    if (!loadOwnedBot(req, res, 'write')) return;
    const schema = z.object({
      message: z.string().min(1).max(5000),
      conversationId: z.string().optional(),
      channel: z.enum(['whatsapp', 'web', 'api', 'telegram', 'email']).optional().default('web'),
      userId: z.string().optional(),
      sessionId: z.string().optional(),
    });
    const input = schema.parse(req.body);
    const response = await claWdBotService.sendMessage({
      // @ts-expect-error NV-TS230 legacy typing gap (TS2322)
      botId: req.params.botId,
      conversationId: input.conversationId,
      channel: input.channel,
      userMessage: input.message,
      userId: input.userId,
      sessionId: input.sessionId,
    });
    res.json({ success: true, ...response });
  } catch (err: any) {
    if (err instanceof ZodError) { res.status(400).json({ error: err.errors }); return; }
    if ((err as Error).message?.includes('not found')) { res.status(404).json({ error: (err as Error).message }); return; }
    if ((err as Error).message?.includes('not accepting')) { res.status(409).json({ error: (err as Error).message }); return; }
    res.status(500).json({ error: sanitizeErrorForClient(err) });
  }
});

// ── LIST CONVERSATIONS ────────────────────────────────────────────────────────
router.get('/bots/:botId/conversations', (req: Request, res: Response) => {
  if (!loadOwnedBot(req, res, 'read')) return;
  const limit = parseInt(String(req.query.limit ?? '50'), 10);
  // @ts-expect-error NV-TS230 legacy typing gap (TS2345)
  const conversations = claWdBotService.listConversations(req.params.botId, limit);
  res.json({ success: true, conversations, total: conversations.length });
});

// ── GET CONVERSATION ──────────────────────────────────────────────────────────
router.get('/conversations/:conversationId', (req: Request, res: Response) => {
  // @ts-expect-error NV-TS230 legacy typing gap (TS2345)
  const conv = claWdBotService.getConversation(req.params.conversationId);
  if (!conv) { res.status(404).json({ success: false, error: 'Conversation not found' }); return; }
  // task-224: scope by parent bot's org
  const bot = claWdBotService.getBot(conv.botId);
  if (!bot || String(bot.orgId) !== getOrgId(req)) {
    res.status(404).json({ success: false, error: 'Conversation not found' });
    return;
  }
  res.json({ success: true, conversation: conv });
});

// ── CLOSE CONVERSATION ────────────────────────────────────────────────────────
router.post('/conversations/:conversationId/close', (req: Request, res: Response) => {
  // task-224: ownership check via the parent bot
  // @ts-expect-error NV-TS230 legacy typing gap (TS2345)
  const conv = claWdBotService.getConversation(req.params.conversationId);
  if (!conv) { res.status(404).json({ success: false, error: 'Conversation not found' }); return; }
  const bot = claWdBotService.getBot(conv.botId);
  if (!bot) { res.status(404).json({ success: false, error: 'Conversation not found' }); return; }
  if (String(bot.orgId) !== getOrgId(req)) {
    res.status(403).json({ success: false, error: 'Forbidden: conversation belongs to another organization' });
    return;
  }
  // @ts-expect-error NV-TS230 legacy typing gap (TS2345)
  const closed = claWdBotService.closeConversation(req.params.conversationId);
  if (!closed) { res.status(404).json({ success: false, error: 'Conversation not found' }); return; }
  res.json({ success: true, message: 'Conversation closed' });
});

// ── WHATSAPP WEBHOOK ──────────────────────────────────────────────────────────
// Note: this router is mounted under `authenticateToken`, so the webhook still
// runs authenticated — task-224 enforces org ownership of the target bot here.
router.post('/webhooks/whatsapp/:botId', async (req: Request, res: Response) => {
  try {
    if (!loadOwnedBot(req, res, 'write')) return;
    const { botId } = req.params;
    const event = {
      messageId: req.body.messageId || crypto.randomUUID(),
      from: req.body.from || req.body.phone || '',
      body: req.body.body || req.body.message || req.body.text || '',
      timestamp: req.body.timestamp || Date.now(),
      type: req.body.type || 'text',
      botId,
    };

    if (!event.from || !event.body) {
      res.status(400).json({ success: false, error: 'Missing from or body in webhook payload' });
    }

    const response = await claWdBotService.handleWhatsAppWebhook(event as any);
    res.json({ success: true, response });
  } catch (err: any) {
    res.status(500).json({ error: sanitizeErrorForClient(err) });
  }
});

// ── ANALYTICS ─────────────────────────────────────────────────────────────────
router.get('/bots/:botId/analytics', (req: Request, res: Response) => {
  if (!loadOwnedBot(req, res, 'read')) return;
  try {
    // @ts-expect-error NV-TS230 legacy typing gap (TS2345)
    const analytics = claWdBotService.getBotAnalytics(req.params.botId);
    res.json({ success: true, ...analytics });
  } catch (err: any) {
    res.status(404).json({ error: (err as Error).message });
  }
});

// ── SERVICE STATS ─────────────────────────────────────────────────────────────
router.get('/stats', (_req: Request, res: Response) => {
  res.json({ success: true, ...claWdBotService.getServiceStats() });
});

export default router;
