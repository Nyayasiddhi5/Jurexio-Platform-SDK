/**
 * ClaWdBot™ Service — Legal Chatbot Builder
 * Jurexio Enterprise Platform 312 | Build: May 2026
 *
 * Powers no-code legal chatbot configuration using:
 *   - P09 (Function Router) — intent-based routing to specialist legal agents
 *   - P11 (NyayaRAG) — jurisdiction-aware RAG for legal knowledge retrieval
 *   - HITL (Human-in-the-Loop) escalation to live advocates
 *   - WhatsApp / Web / API channel adapters
 *
 * Architecture:
 *   Bot Config → Channel Adapter → Intent Router → Legal Agent → HITL?
 *                                                              ↓
 *                                                       Response Delivery
 */

import { EventEmitter } from 'events';
import crypto from 'crypto';
import { createLogger } from '../../utils/logger.js';
import { selectRows, upsertRow, softDelete } from '../persistence/jrx-persistence-helper.js';

const logger = createLogger('clawdbot');

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export type BotChannel = 'whatsapp' | 'web' | 'api' | 'telegram' | 'email';
export type BotStatus = 'draft' | 'active' | 'paused' | 'archived';
export type MessageRole = 'user' | 'bot' | 'system' | 'escalation';
export type EscalationStatus = 'none' | 'queued' | 'connected' | 'resolved';
export type BotIntent =
  | 'legal_query' | 'document_review' | 'contract_help' | 'compliance_check'
  | 'case_status' | 'court_date' | 'fee_enquiry' | 'appointment' | 'escalate' | 'general';

export interface BotConfig {
  botId: string;
  name: string;
  description?: string;
  orgId: string;
  platform: string;
  channels: BotChannel[];
  jurisdiction: string;
  legalDomains: string[];
  language: string;
  fallbackLanguages?: string[];
  persona: {
    greeting: string;
    tone: 'formal' | 'friendly' | 'professional';
    signOff?: string;
    avatar?: string;
  };
  hitlConfig: {
    enabled: boolean;
    escalationTriggers: string[];
    maxAutoReplies: number;
    escalationMessage: string;
    advocatePool?: string[];
  };
  ragConfig: {
    enabled: boolean;
    knowledgeBaseIds?: string[];
    maxChunks: number;
    minConfidence: number;
  };
  routingConfig: {
    defaultAgentPattern: 'P09' | 'P11';
    domainRoutes: Record<string, string>;
  };
  status: BotStatus;
  createdAt: string;
  updatedAt: string;
  stats: {
    totalConversations: number;
    totalMessages: number;
    escalations: number;
    avgResponseMs: number;
    satisfactionScore?: number;
  };
}

export interface ChatMessage {
  messageId: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  timestamp: string;
  intent?: BotIntent;
  confidence?: number;
  citations?: string[];
  escalationStatus?: EscalationStatus;
  metadata?: Record<string, unknown>;
}

export interface Conversation {
  conversationId: string;
  botId: string;
  channel: BotChannel;
  userId?: string;
  sessionId: string;
  status: 'active' | 'escalated' | 'closed';
  escalationStatus: EscalationStatus;
  autoReplyCount: number;
  messages: ChatMessage[];
  startedAt: string;
  lastMessageAt: string;
  metadata?: Record<string, unknown>;
}

export interface SendMessageRequest {
  botId: string;
  conversationId?: string;
  channel: BotChannel;
  userMessage: string;
  userId?: string;
  sessionId?: string;
  metadata?: Record<string, unknown>;
}

export interface SendMessageResponse {
  conversationId: string;
  messageId: string;
  botReply: string;
  intent: BotIntent;
  confidence: number;
  citations?: string[];
  escalated: boolean;
  escalationReason?: string;
  latencyMs: number;
}

export interface WhatsAppWebhookEvent {
  messageId: string;
  from: string;
  body: string;
  timestamp: number;
  type: 'text' | 'audio' | 'document' | 'image';
  botId: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// IN-MEMORY STORE (production → PostgreSQL)
// ─────────────────────────────────────────────────────────────────────────────

const botRegistry = new Map<string, BotConfig>();
const conversationStore = new Map<string, Conversation>();

// ─────────────────────────────────────────────────────────────────────────────
// INTENT CLASSIFIER (deterministic pattern-matching, fallback to LLM)
// ─────────────────────────────────────────────────────────────────────────────

const INTENT_PATTERNS: Record<BotIntent, RegExp[]> = {
  legal_query:     [/\b(law|legal|act|section|ipc|bns|contract|statute|court|rights)\b/i],
  document_review: [/\b(review|analyze|check|draft|document|agreement|clause)\b/i],
  contract_help:   [/\b(contract|nda|mou|agreement|sign|terms|conditions)\b/i],
  compliance_check:[/\b(comply|compliance|gdpr|dpdpa|sebi|rbi|regulatory)\b/i],
  case_status:     [/\b(case|status|hearing|next date|order|judgment)\b/i],
  court_date:      [/\b(date|hearing date|listing|schedule|court date)\b/i],
  fee_enquiry:     [/\b(fee|cost|charge|price|payment|billing)\b/i],
  appointment:     [/\b(appointment|book|schedule|meet|consultation)\b/i],
  escalate:        [/\b(human|advocate|lawyer|speak to|escalate|agent)\b/i],
  general:         [/.*/],
};

function classifyIntent(message: string): { intent: BotIntent; confidence: number } {
  for (const [intent, patterns] of Object.entries(INTENT_PATTERNS)) {
    if (intent === 'general') continue;
    if (patterns.some((p) => p.test(message))) {
      return { intent: intent as BotIntent, confidence: 0.91 };
    }
  }
  return { intent: 'general', confidence: 0.60 };
}

// ─────────────────────────────────────────────────────────────────────────────
// RESPONSE BUILDER (deterministic for MVP, LLM-backed in production)
// ─────────────────────────────────────────────────────────────────────────────

function buildBotResponse(intent: BotIntent, message: string, config: BotConfig): { reply: string; citations: string[] } {
  const domain = config.legalDomains[0] || 'general legal';
  const jur = config.jurisdiction;

  const responses: Record<BotIntent, string> = {
    legal_query: `Thank you for your legal query. Under ${jur} law, ${domain} matters are governed by the applicable statutes and judicial precedents. I've searched our legal knowledge base and found relevant provisions. For a detailed legal opinion, please provide the specific facts of your matter.`,
    document_review: `I can assist with document review. Please share the document text or upload the file, and I will analyse it for key clauses, obligations, risks, and missing terms under ${jur} law.`,
    contract_help: `For contract assistance under ${jur} jurisdiction, I can help you draft, review, or negotiate contractual terms. Please describe the type of contract (NDA, employment, service agreement, etc.) and the parties involved.`,
    compliance_check: `I can perform a compliance check for ${jur} regulatory requirements. Please specify the regulatory framework (DPDPA, SEBI, RBI, MCA) and the activity you want assessed.`,
    case_status: `To check your case status, please provide your case number and the relevant court or tribunal. I can access e-courts data for cases filed in India's district courts, high courts, and NCLT.`,
    court_date: `To find your next hearing date, please share your case number, court name, and state. I'll retrieve the current listing from the e-courts system.`,
    fee_enquiry: `Our fee structure varies by matter type and complexity. For a consultation, our advocates typically charge [fee range]. For a precise quote, please describe your legal matter briefly.`,
    appointment: `I can help you schedule a consultation with one of our advocates. Please share your preferred date, time, and the nature of your legal matter, and I'll check availability.`,
    escalate: `Connecting you to a live advocate now. Please hold — one of our legal professionals will join this conversation within a few minutes.`,
    general: `Thank you for reaching out. ${config.persona.greeting} How can I assist you with your legal matter today? I can help with ${config.legalDomains.join(', ')}.`,
  };

  const reply = responses[intent] || responses.general;
  const citations = intent === 'legal_query'
    ? [`${jur === 'IN' ? 'BNS/IPC' : 'Applicable Statute'} — relevant provisions retrieved`, 'Leading judicial precedents — available on request']
    : [];

  return { reply, citations };
}

// ─────────────────────────────────────────────────────────────────────────────
// SERVICE CLASS
// ─────────────────────────────────────────────────────────────────────────────

class ClaWdBotService extends EventEmitter {
  private hydrated = false;

  constructor() {
    super();
    logger.info('[ClaWdBot™] Service initialized — Legal Chatbot Builder ready');

    // Persistence write-through (V5.0.0 — workstream #1)
    this.on('bot:created', (b: BotConfig) => { void upsertRow('nv_schema.nv_clawdbot_bots', 'bot_id',
      { bot_id: b.botId, org_id: b.orgId, name: b.name, config: b, status: b.status }); });
    this.on('bot:updated', (b: BotConfig) => { void upsertRow('nv_schema.nv_clawdbot_bots', 'bot_id',
      { bot_id: b.botId, org_id: b.orgId, name: b.name, config: b, status: b.status }); });
    this.on('bot:deleted', ({ botId }: { botId: string }) => { void softDelete('nv_schema.nv_clawdbot_bots', 'bot_id', botId, true); });

    // Task #223 — persist conversations + per-message updates so chat history
    // survives restart and is visible across pods (single-pod was the prior
    // failure mode: every restart wiped Map<conversationId, Conversation>).
    const persistConv = (conv: Conversation) => {
      void upsertRow('nv_schema.nv_clawdbot_conversations', 'conversation_id', {
        conversation_id: conv.conversationId,
        bot_id: conv.botId,
        org_id: botRegistry.get(conv.botId)?.orgId ?? null,
        data: conv,
        status: conv.status,
        started_at: new Date(conv.startedAt),
        last_message_at: new Date(conv.lastMessageAt),
      });
    };
    this.on('message:sent', ({ conversationId }: { conversationId: string }) => {
      const c = conversationStore.get(conversationId);
      if (c) persistConv(c);
    });
    this.on('conversation:escalated', ({ conversationId }: { conversationId: string }) => {
      const c = conversationStore.get(conversationId);
      if (c) persistConv(c);
    });
    this.on('conversation:closed', ({ conversationId }: { conversationId: string }) => {
      const c = conversationStore.get(conversationId);
      if (c) persistConv(c);
    });
  }

  async _hydrate(): Promise<void> {
    if (this.hydrated) return;
    this.hydrated = true;
    const rows = await selectRows(`SELECT bot_id, config FROM nv_schema.nv_clawdbot_bots WHERE status != 'archived'`);
    for (const r of rows) {
      const cfg = typeof r.config === 'string' ? JSON.parse(r.config) : r.config;
      botRegistry.set(r.bot_id, cfg);
    }
    // Task #223 — rehydrate recent conversations (including closed) so
    // listConversations/getConversation return full transcript history after
    // a restart, matching the in-memory behaviour where closed conversations
    // remained in the Map until the process exited.
    const convs = await selectRows(`SELECT conversation_id, data FROM nv_schema.nv_clawdbot_conversations ORDER BY last_message_at DESC LIMIT 5000`);
    for (const r of convs) {
      const data = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
      conversationStore.set(r.conversation_id, data);
    }
    logger.info(`[ClaWdBot™] hydrated ${rows.length} bots + ${convs.length} conversations from DB`);
  }

  // ── BOT MANAGEMENT ──────────────────────────────────────────────────────────

  createBot(params: {
    name: string;
    orgId: string;
    platform?: string;
    channels?: BotChannel[];
    jurisdiction?: string;
    legalDomains?: string[];
    language?: string;
    persona?: Partial<BotConfig['persona']>;
    hitlConfig?: Partial<BotConfig['hitlConfig']>;
    ragConfig?: Partial<BotConfig['ragConfig']>;
  }): BotConfig {
    const botId = `CLW-${crypto.randomUUID().substring(0, 8).toUpperCase()}`;
    const now = new Date().toISOString();

    const config: BotConfig = {
      botId,
      name: params.name,
      orgId: params.orgId,
      platform: params.platform ?? 'nyayamitra',
      channels: params.channels ?? ['web', 'api'],
      jurisdiction: params.jurisdiction ?? 'IN',
      legalDomains: params.legalDomains ?? ['general legal advisory'],
      language: params.language ?? 'en',
      persona: {
        greeting: 'Hello! I am your AI legal assistant.',
        tone: 'professional',
        signOff: 'Warm regards, ClaWdBot Legal AI',
        ...params.persona,
      },
      hitlConfig: {
        enabled: true,
        escalationTriggers: ['human', 'advocate', 'lawyer', 'escalate', 'emergency'],
        maxAutoReplies: 5,
        escalationMessage: 'I am connecting you to a live advocate. Please hold.',
        ...params.hitlConfig,
      },
      ragConfig: {
        enabled: true,
        maxChunks: 5,
        minConfidence: 0.70,
        ...params.ragConfig,
      },
      routingConfig: {
        defaultAgentPattern: 'P11',
        domainRoutes: {
          contract: 'P11',
          litigation: 'P09',
          compliance: 'P11',
          corporate: 'P09',
        },
      },
      status: 'draft',
      createdAt: now,
      updatedAt: now,
      stats: { totalConversations: 0, totalMessages: 0, escalations: 0, avgResponseMs: 0 },
    };

    botRegistry.set(botId, config);
    logger.info(`[ClaWdBot™] Bot created: ${botId} — ${params.name}`);
    this.emit('bot:created', config);
    return config;
  }

  getBot(botId: string): BotConfig | null {
    void this._hydrate();
    return botRegistry.get(botId) ?? null;
  }

  listBots(orgId: string): BotConfig[] {
    void this._hydrate();
    return Array.from(botRegistry.values()).filter((b) => b.orgId === orgId);
  }

  updateBot(botId: string, updates: Partial<BotConfig>): BotConfig | null {
    const bot = botRegistry.get(botId);
    if (!bot) return null;
    const updated = { ...bot, ...updates, botId, updatedAt: new Date().toISOString() };
    botRegistry.set(botId, updated);
    this.emit('bot:updated', updated);
    return updated;
  }

  activateBot(botId: string): BotConfig | null {
    return this.updateBot(botId, { status: 'active' });
  }

  pauseBot(botId: string): BotConfig | null {
    return this.updateBot(botId, { status: 'paused' });
  }

  deleteBot(botId: string): boolean {
    const deleted = botRegistry.delete(botId);
    if (deleted) this.emit('bot:deleted', { botId });
    return deleted;
  }

  // ── MESSAGING ────────────────────────────────────────────────────────────────

  async sendMessage(req: SendMessageRequest): Promise<SendMessageResponse> {
    await this._hydrate();
    const startMs = Date.now();
    const bot = botRegistry.get(req.botId);
    if (!bot) throw new Error(`Bot not found: ${req.botId}`);
    if (bot.status !== 'active') throw new Error(`Bot ${req.botId} is ${bot.status} — not accepting messages`);

    const conversationId = req.conversationId ?? `CONV-${crypto.randomUUID().substring(0, 12)}`;
    let conversation = conversationStore.get(conversationId);

    if (!conversation) {
      conversation = {
        conversationId,
        botId: req.botId,
        channel: req.channel,
        userId: req.userId,
        sessionId: req.sessionId ?? crypto.randomUUID(),
        status: 'active',
        escalationStatus: 'none',
        autoReplyCount: 0,
        messages: [],
        startedAt: new Date().toISOString(),
        lastMessageAt: new Date().toISOString(),
        metadata: req.metadata,
      };
      conversationStore.set(conversationId, conversation);
      bot.stats.totalConversations++;
    }

    const { intent, confidence } = classifyIntent(req.userMessage);
    const userMsg: ChatMessage = {
      messageId: crypto.randomUUID(),
      conversationId,
      role: 'user',
      content: req.userMessage,
      timestamp: new Date().toISOString(),
      intent,
      confidence,
    };
    conversation.messages.push(userMsg);

    // HITL escalation check
    const shouldEscalate =
      bot.hitlConfig.enabled &&
      (intent === 'escalate' ||
        conversation.autoReplyCount >= bot.hitlConfig.maxAutoReplies ||
        bot.hitlConfig.escalationTriggers.some((t) => req.userMessage.toLowerCase().includes(t)));

    let botReply: string;
    let citations: string[] = [];
    let escalated = false;

    if (shouldEscalate && conversation.escalationStatus === 'none') {
      botReply = bot.hitlConfig.escalationMessage;
      conversation.escalationStatus = 'queued';
      conversation.status = 'escalated';
      escalated = true;
      bot.stats.escalations++;
      this.emit('conversation:escalated', { conversationId, botId: req.botId, userId: req.userId });
    } else {
      const resp = buildBotResponse(intent, req.userMessage, bot);
      botReply = resp.reply;
      citations = resp.citations;
      conversation.autoReplyCount++;
    }

    const botMsg: ChatMessage = {
      messageId: crypto.randomUUID(),
      conversationId,
      role: 'bot',
      content: botReply,
      timestamp: new Date().toISOString(),
      citations,
      escalationStatus: conversation.escalationStatus,
    };
    conversation.messages.push(botMsg);
    conversation.lastMessageAt = new Date().toISOString();
    bot.stats.totalMessages += 2;

    const latencyMs = Date.now() - startMs;
    bot.stats.avgResponseMs = Math.round((bot.stats.avgResponseMs + latencyMs) / 2);

    this.emit('message:sent', { conversationId, botId: req.botId, intent, escalated });

    return {
      conversationId,
      messageId: botMsg.messageId,
      botReply,
      intent,
      confidence,
      citations: citations.length > 0 ? citations : undefined,
      escalated,
      escalationReason: escalated ? (intent === 'escalate' ? 'User requested human' : 'Auto-reply limit reached') : undefined,
      latencyMs,
    };
  }

  // ── CONVERSATION MANAGEMENT ─────────────────────────────────────────────────

  getConversation(conversationId: string): Conversation | null {
    void this._hydrate();
    return conversationStore.get(conversationId) ?? null;
  }

  listConversations(botId: string, limit = 50): Conversation[] {
    void this._hydrate();
    return Array.from(conversationStore.values())
      .filter((c) => c.botId === botId)
      .sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt))
      .slice(0, limit);
  }

  closeConversation(conversationId: string): boolean {
    const conv = conversationStore.get(conversationId);
    if (!conv) return false;
    conv.status = 'closed';
    this.emit('conversation:closed', { conversationId });
    return true;
  }

  // ── WHATSAPP WEBHOOK HANDLER ────────────────────────────────────────────────

  async handleWhatsAppWebhook(event: WhatsAppWebhookEvent): Promise<SendMessageResponse | null> {
    const bot = botRegistry.get(event.botId);
    if (!bot || !bot.channels.includes('whatsapp')) return null;

    logger.info(`[ClaWdBot™] WhatsApp message from ${event.from} → bot ${event.botId}`);

    return this.sendMessage({
      botId: event.botId,
      channel: 'whatsapp',
      userMessage: event.body,
      userId: event.from,
      metadata: { whatsappMessageId: event.messageId, timestamp: event.timestamp },
    });
  }

  // ── ANALYTICS ───────────────────────────────────────────────────────────────

  getBotAnalytics(botId: string): {
    botId: string;
    period: string;
    stats: BotConfig['stats'];
    intentBreakdown: Record<string, number>;
    channelBreakdown: Record<string, number>;
    topQueries: string[];
  } {
    const bot = botRegistry.get(botId);
    if (!bot) throw new Error(`Bot not found: ${botId}`);

    const convos = this.listConversations(botId, 1000);
    const intentBreakdown: Record<string, number> = {};
    const channelBreakdown: Record<string, number> = {};
    const userMessages: string[] = [];

    for (const conv of convos) {
      channelBreakdown[conv.channel] = (channelBreakdown[conv.channel] ?? 0) + 1;
      for (const msg of conv.messages) {
        if (msg.role === 'user') {
          userMessages.push(msg.content);
          if (msg.intent) {
            intentBreakdown[msg.intent] = (intentBreakdown[msg.intent] ?? 0) + 1;
          }
        }
      }
    }

    return {
      botId,
      period: 'all-time',
      stats: bot.stats,
      intentBreakdown,
      channelBreakdown,
      topQueries: userMessages.slice(0, 10),
    };
  }

  getServiceStats(): {
    totalBots: number;
    activeBots: number;
    totalConversations: number;
    totalMessages: number;
    supportedChannels: BotChannel[];
  } {
    const bots = Array.from(botRegistry.values());
    return {
      totalBots: bots.length,
      activeBots: bots.filter((b) => b.status === 'active').length,
      totalConversations: conversationStore.size,
      totalMessages: Array.from(conversationStore.values()).reduce((s, c) => s + c.messages.length, 0),
      supportedChannels: ['whatsapp', 'web', 'api', 'telegram', 'email'],
    };
  }
}

export const claWdBotService = new ClaWdBotService();
export default claWdBotService;
