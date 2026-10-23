/**
 * NV WhatsApp Business API Routes v3.1.2
 * POST /api/jrx/channels/whatsapp/send/text
 * POST /api/jrx/channels/whatsapp/send/template
 * POST /api/jrx/channels/whatsapp/send/alert
 * GET  /api/jrx/channels/whatsapp/webhook   (Meta verification challenge)
 * POST /api/jrx/channels/whatsapp/webhook   (Incoming message events)
 * GET  /api/jrx/channels/whatsapp/health
 */

import { Router, Request, Response } from 'express';
import { authenticateToken } from '../middleware/jrx-auth.js';
import {
  sendTextMessage,
  sendTemplateMessage,
  sendLegalAlert,
  verifyWebhook,
  parseIncomingWebhook,
  getWhatsAppHealth,
} from '../services/jrx-whatsapp-service.js';
import { createLogger } from '../utils/logger.js';

const router = Router();
const logger = createLogger('./jrx-whatsapp-routes');

// ── Health ─────────────────────────────────────────────────────────────────────
router.get('/health', async (_req: Request, res: Response) => {
  const health = await getWhatsAppHealth();
  res.json({ success: true, whatsapp: health });
});

// ── Webhook verification (Meta GET challenge) ─────────────────────────────────
router.get('/webhook', (req: Request, res: Response) => {
  const mode = req.query['hub.mode'] as string;
  const token = req.query['hub.verify_token'] as string;
  const challenge = req.query['hub.challenge'] as string;

  const { valid, challenge: responseChallenge } = verifyWebhook(mode, token, challenge);
  if (valid) {
    res.status(200).send(responseChallenge);
  } else {
    logger.warn('[WhatsApp] Webhook verification failed', { mode, token });
    res.status(403).json({ error: 'Verification failed' });
  }
});

// ── Incoming message events (Meta POST webhook) ───────────────────────────────
router.post('/webhook', async (req: Request, res: Response) => {
  res.sendStatus(200);

  const messages = parseIncomingWebhook(req.body);
  if (messages.length === 0) return;

  logger.info('[WhatsApp] Incoming messages', { count: messages.length, from: messages[0].from });
  try {
    const { claWdBotService } = await import('../services/clawdbot/clawdbot-service.js');
    for (const msg of messages) {
      claWdBotService.handleWhatsAppWebhook({
        messageId: msg.messageId,
        from: msg.from,
        body: msg.text ?? '',
        type: (msg.type as 'text' | 'audio' | 'document' | 'image') ?? 'text',
        timestamp: typeof msg.timestamp === 'string' ? parseInt(msg.timestamp, 10) : (msg.timestamp ?? Date.now()),
        botId: 'default',
      }).catch((err: any) => logger.error('[WhatsApp] ClaWdBot dispatch failed', { from: msg.from, error: err.message }));
    }
  } catch (err: any) {
    logger.error('[WhatsApp] ClaWdBot service unavailable', { error: err.message });
  }
});

// ── Send text message (authenticated) ────────────────────────────────────────
router.post('/send/text', authenticateToken, async (req: Request, res: Response) => {
  const { to, body, previewUrl } = req.body;
  if (!to || !body) {
    res.status(400).json({ error: 'to and body are required' });
    return;
  }
  const result = await sendTextMessage({ to, body, previewUrl });
  res.status(result.success ? 200 : 503).json(result);
});

// ── Send template message (authenticated) ─────────────────────────────────────
router.post('/send/template', authenticateToken, async (req: Request, res: Response) => {
  const { to, templateName, languageCode, components } = req.body;
  if (!to || !templateName) {
    res.status(400).json({ error: 'to and templateName are required' });
    return;
  }
  const result = await sendTemplateMessage({ to, templateName, languageCode, components });
  res.status(result.success ? 200 : 503).json(result);
});

// ── Send legal alert (authenticated) ─────────────────────────────────────────
router.post('/send/alert', authenticateToken, async (req: Request, res: Response) => {
  const { to, alertType, params } = req.body;
  if (!to || !alertType) {
    res.status(400).json({ error: 'to and alertType are required' });
    return;
  }
  const result = await sendLegalAlert(to, alertType, params || {});
  res.status(result.success ? 200 : 503).json(result);
});

export default router;
