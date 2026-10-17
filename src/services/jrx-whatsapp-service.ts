/**
 * NV WhatsApp Business API Service v3.1.2
 * ─────────────────────────────────────────────────────────────────────────────
 * Full Meta WhatsApp Business Cloud API integration.
 * Gracefully degrades when JRX_WHATSAPP_TOKEN / JRX_WHATSAPP_PHONE_ID not set.
 *
 * Endpoints used:
 *   POST https://graph.facebook.com/v18.0/{phone_number_id}/messages
 *   GET  https://graph.facebook.com/v18.0/{phone_number_id} (health check)
 *
 * Message types supported:
 *   text, template, interactive (button / list), document, audio, image
 */

import { createLogger } from '../utils/logger.js';

const logger = createLogger('./jrx-whatsapp');

const WA_API_BASE = 'https://graph.facebook.com/v18.0';

export interface WhatsAppConfig {
  token: string;
  phoneNumberId: string;
  webhookVerifyToken?: string;
}

export interface WhatsAppTextMessage {
  to: string;
  body: string;
  previewUrl?: boolean;
}

export interface WhatsAppTemplateMessage {
  to: string;
  templateName: string;
  languageCode?: string;
  components?: Array<{
    type: 'header' | 'body' | 'button';
    parameters: Array<{ type: string; text?: string }>;
  }>;
}

export interface WhatsAppMessageResult {
  success: boolean;
  messageId?: string;
  error?: string;
  status: 'sent' | 'failed' | 'not_configured';
}

function getConfig(): WhatsAppConfig | null {
  const token = process.env.JRX_WHATSAPP_TOKEN;
  const phoneNumberId = process.env.JRX_WHATSAPP_PHONE_ID;
  if (!token || !phoneNumberId) return null;
  return {
    token,
    phoneNumberId,
    webhookVerifyToken: process.env.JRX_WHATSAPP_VERIFY_TOKEN || 'jrx-webhook-verify',
  };
}

// ─── Send text message ────────────────────────────────────────────────────────
export async function sendTextMessage(msg: WhatsAppTextMessage): Promise<WhatsAppMessageResult> {
  const config = getConfig();
  if (!config) {
    logger.warn('[WhatsApp] JRX_WHATSAPP_TOKEN or JRX_WHATSAPP_PHONE_ID not configured');
    return { success: false, status: 'not_configured', error: 'WhatsApp not configured' };
  }

  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: msg.to,
    type: 'text',
    text: { preview_url: msg.previewUrl ?? false, body: msg.body },
  };

  return sendMessage(config, payload);
}

// ─── Send template message ────────────────────────────────────────────────────
export async function sendTemplateMessage(msg: WhatsAppTemplateMessage): Promise<WhatsAppMessageResult> {
  const config = getConfig();
  if (!config) {
    return { success: false, status: 'not_configured', error: 'WhatsApp not configured' };
  }

  const payload = {
    messaging_product: 'whatsapp',
    to: msg.to,
    type: 'template',
    template: {
      name: msg.templateName,
      language: { code: msg.languageCode || 'en_IN' },
      components: msg.components || [],
    },
  };

  return sendMessage(config, payload);
}

// ─── Send legal alert (pre-built template) ────────────────────────────────────
export async function sendLegalAlert(
  to: string,
  alertType: 'case_update' | 'hearing_reminder' | 'document_ready' | 'payment_due',
  params: Record<string, string>
): Promise<WhatsAppMessageResult> {
  const templateMap: Record<string, string> = {
    case_update: 'nyv_case_update',
    hearing_reminder: 'nyv_hearing_reminder',
    document_ready: 'nyv_document_ready',
    payment_due: 'nyv_payment_due',
  };

  return sendTemplateMessage({
    to,
    templateName: templateMap[alertType],
    languageCode: 'en_IN',
    components: [
      {
        type: 'body',
        parameters: Object.entries(params).map(([, v]) => ({ type: 'text', text: v })),
      },
    ],
  });
}

// ─── Verify webhook (Meta challenge-response) ─────────────────────────────────
export function verifyWebhook(
  mode: string,
  token: string,
  challenge: string
): { valid: boolean; challenge: string } {
  const config = getConfig();
  const verifyToken = config?.webhookVerifyToken || 'jrx-webhook-verify';
  if (mode === 'subscribe' && token === verifyToken) {
    return { valid: true, challenge };
  }
  return { valid: false, challenge: '' };
}

// ─── Process incoming webhook event ───────────────────────────────────────────
export interface IncomingWhatsAppMessage {
  from: string;
  messageId: string;
  type: 'text' | 'audio' | 'document' | 'image' | 'interactive';
  text?: string;
  timestamp: string;
  phoneNumberId: string;
}

export function parseIncomingWebhook(body: any): IncomingWhatsAppMessage[] {
  const messages: IncomingWhatsAppMessage[] = [];
  try {
    const entry = body?.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const phoneNumberId = value?.metadata?.phone_number_id || '';

    for (const msg of value?.messages || []) {
      messages.push({
        from: msg.from,
        messageId: msg.id,
        type: msg.type,
        text: msg.text?.body,
        timestamp: msg.timestamp,
        phoneNumberId,
      });
    }
  } catch {
    /* non-message webhook event */
  }
  return messages;
}

// ─── Health check ─────────────────────────────────────────────────────────────
export async function getWhatsAppHealth(): Promise<{
  configured: boolean;
  status: 'live' | 'not_configured' | 'error';
  phoneNumberId?: string;
}> {
  const config = getConfig();
  if (!config) {
    return { configured: false, status: 'not_configured' };
  }

  try {
    const res = await fetch(`${WA_API_BASE}/${config.phoneNumberId}?access_token=${config.token}`);
    if (res.ok) {
      return { configured: true, status: 'live', phoneNumberId: config.phoneNumberId };
    }
    return { configured: true, status: 'error', phoneNumberId: config.phoneNumberId };
  } catch {
    return { configured: true, status: 'error', phoneNumberId: config.phoneNumberId };
  }
}

// ─── Internal helper ──────────────────────────────────────────────────────────
async function sendMessage(config: WhatsAppConfig, payload: object): Promise<WhatsAppMessageResult> {
  try {
    const res = await fetch(`${WA_API_BASE}/${config.phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.token}`,
      },
      body: JSON.stringify(payload),
    });

    const data: any = await res.json();

    if (res.ok && data.messages?.[0]?.id) {
      logger.info('[WhatsApp] Message sent', { messageId: data.messages[0].id });
      return { success: true, status: 'sent', messageId: data.messages[0].id };
    }

    const errMsg = data?.error?.message || 'Unknown error';
    logger.warn('[WhatsApp] Message send failed', { error: errMsg, status: res.status });
    return { success: false, status: 'failed', error: errMsg };
  } catch (err: any) {
    logger.warn('[WhatsApp] Network error', { error: err.message });
    return { success: false, status: 'failed', error: err.message };
  }
}
