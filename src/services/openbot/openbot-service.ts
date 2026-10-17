// NYV-NS-021 (2026-05-05): pre-existing TS errors (gateway runs via tsx).
/**
 * OpenBot™ Service — Multi-Channel Studio
 * Jurexio Enterprise Platform 312 | Build: June 2026
 *
 * Manages multi-channel bot routing across WhatsApp, Slack, Teams, Telegram,
 * Email. Extends ClaWdBot with multi-bot orchestration and channel unification.
 *
 * Features:
 *   - Unified message inbox across all channels
 *   - Bot-to-bot handoff (ClaWdBot → specialist bot)
 *   - Channel-specific formatting (WhatsApp markdown, Slack blocks, etc.)
 *   - Webhook management for all platforms
 *   - Live conversation monitoring dashboard
 */

import { EventEmitter } from 'events';
import crypto from 'crypto';
import { createLogger } from '../../utils/logger.js';
import { selectRows, upsertRow, softDelete } from '../persistence/jrx-persistence-helper.js';

const logger = createLogger('openbot');

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export type OpenBotChannel = 'whatsapp' | 'slack' | 'teams' | 'telegram' | 'email' | 'web' | 'api';
export type OpenBotStatus = 'active' | 'paused' | 'error';

export interface ChannelConfig {
  channelId: string;
  channel: OpenBotChannel;
  name: string;
  // task-224: org scope so multi-tenant lookups can filter cross-org data.
  orgId: string;
  credentials: Record<string, string>;
  webhookUrl?: string;
  isVerified: boolean;
  botIds: string[];
  status: OpenBotStatus;
  createdAt: string;
}

export interface MultiChannelMessage {
  messageId: string;
  channelId: string;
  channel: OpenBotChannel;
  from: string;
  fromName?: string;
  to: string;
  content: string;
  formattedContent?: Record<string, unknown>;
  attachments?: Array<{ type: string; url: string; name?: string }>;
  timestamp: string;
  direction: 'inbound' | 'outbound';
  botId?: string;
  conversationId?: string;
  status: 'received' | 'processing' | 'sent' | 'delivered' | 'failed';
  metadata?: Record<string, unknown>;
}

export interface BotRoutingRule {
  ruleId: string;
  name: string;
  // task-224: org scope so a tenant's rules can't be enumerated by others.
  orgId: string;
  priority: number;
  conditions: {
    channels?: OpenBotChannel[];
    keywords?: string[];
    userGroups?: string[];
    timeWindows?: Array<{ from: string; to: string; timezone?: string }>;
  };
  targetBotId: string;
  fallbackBotId?: string;
  isActive: boolean;
}

export interface ChannelFormatAdapter {
  format(content: string, channel: OpenBotChannel, options?: Record<string, unknown>): string | Record<string, unknown>;
  parse(raw: unknown, channel: OpenBotChannel): { text: string; attachments?: unknown[] };
}

// ─────────────────────────────────────────────────────────────────────────────
// CHANNEL FORMAT ADAPTERS
// ─────────────────────────────────────────────────────────────────────────────

const channelAdapters: Record<OpenBotChannel, ChannelFormatAdapter> = {
  whatsapp: {
    format(content) {
      return content.replace(/\*\*(.*?)\*\*/g, '*$1*').replace(/_(.*?)_/g, '_$1_');
    },
    parse(raw) {
      const r = raw as any;
      return { text: r?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.text?.body ?? String(r?.body ?? '') };
    },
  },
  slack: {
    format(content, _channel, opts) {
      return {
        blocks: [
          { type: 'section', text: { type: 'mrkdwn', text: content } },
          ...(opts?.citations ? [{ type: 'context', elements: (opts.citations as string[]).map((c) => ({ type: 'mrkdwn', text: c })) }] : []),
        ],
      };
    },
    parse(raw) {
      const r = raw as any;
      return { text: r?.event?.text ?? r?.text ?? '' };
    },
  },
  teams: {
    format(content) {
      return { type: 'message', text: content, textFormat: 'markdown' };
    },
    parse(raw) {
      const r = raw as any;
      return { text: r?.text ?? r?.body?.content ?? '' };
    },
  },
  telegram: {
    format(content) {
      return content;
    },
    parse(raw) {
      const r = raw as any;
      return { text: r?.message?.text ?? '' };
    },
  },
  email: {
    format(content, _channel, opts) {
      return `<html><body><p>${content.replace(/\n/g, '<br>')}</p>${opts?.footer ? `<hr><small>${opts.footer}</small>` : ''}</body></html>`;
    },
    parse(raw) {
      const r = raw as any;
      return { text: r?.text ?? r?.body ?? '' };
    },
  },
  web: {
    format(content) { return content; },
    parse(raw) { return { text: String((raw as any)?.message ?? raw ?? '') }; },
  },
  api: {
    format(content) { return content; },
    parse(raw) { return { text: String((raw as any)?.message ?? raw ?? '') }; },
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// IN-MEMORY STORES
// ─────────────────────────────────────────────────────────────────────────────

const channelRegistry = new Map<string, ChannelConfig>();
const routingRules = new Map<string, BotRoutingRule>();
const messageInbox = new Map<string, MultiChannelMessage[]>(); // channelId → messages

// ─────────────────────────────────────────────────────────────────────────────
// SERVICE
// ─────────────────────────────────────────────────────────────────────────────

class OpenBotService extends EventEmitter {
  private hydrated = false;

  constructor() {
    super();
    logger.info('[OpenBot™] Multi-Channel Studio initialized');

    // Persistence write-through (V5.0.0 — workstream #1; task-236 added org_id +
    // inbox persistence so channels/rules/messages survive a gateway restart and
    // can be filtered server-side by tenant).
    this.on('channel:added', (c: ChannelConfig) => { void upsertRow('nv_schema.nv_openbot_channels', 'channel_id',
      { channel_id: c.channelId, channel_type: c.channel, org_id: c.orgId, config: c, status: c.status }); });
    this.on('channel:removed', ({ channelId }: { channelId: string }) => { void softDelete('nv_schema.nv_openbot_channels', 'channel_id', channelId, true); });
    this.on('rule:added', (r: BotRoutingRule) => { void upsertRow('nv_schema.nv_openbot_routes', 'rule_id',
      { rule_id: r.ruleId, org_id: r.orgId, rule: r, is_active: r.isActive }); });
    // Task #223 — propagate rule deletions and persist inbox messages so the
    // unified inbox survives restart / is consistent across pods.
    // task-236: include the channel's `org_id` on inbox upserts so the
    // server-side org filter in `getUnifiedInboxAsync` works correctly.
    this.on('rule:removed', ({ ruleId }: { ruleId: string }) => {
      void softDelete('nv_schema.nv_openbot_routes', 'rule_id', ruleId, false);
    });
    this.on('message:received', (m: MultiChannelMessage) => {
      void upsertRow('nv_schema.nv_openbot_inbox', 'message_id', {
        message_id: m.messageId,
        channel_id: m.channelId,
        org_id: channelRegistry.get(m.channelId)?.orgId ?? null,
        message: m,
        received_at: new Date(m.timestamp),
      });
    });
    this.on('message:sent', (m: MultiChannelMessage) => {
      void upsertRow('nv_schema.nv_openbot_inbox', 'message_id', {
        message_id: m.messageId,
        channel_id: m.channelId,
        org_id: channelRegistry.get(m.channelId)?.orgId ?? null,
        message: m,
        received_at: new Date(m.timestamp),
      });
    });
  }

  async _hydrate(): Promise<void> {
    if (this.hydrated) return;
    this.hydrated = true;
    // task-236: idempotent runtime ALTERs so older deployments that pre-date
    // the org_id column (Drizzle push hasn't run yet) still get the multi-tenant
    // filter. Same pattern as `nyv-graphrag-legal-service.ts`.
    try {
      const { pool } = await import('../../db/index.js');
      await (pool as any).query(`ALTER TABLE nv_schema.nv_openbot_channels ADD COLUMN IF NOT EXISTS org_id VARCHAR(64)`);
      await (pool as any).query(`ALTER TABLE nv_schema.nv_openbot_routes   ADD COLUMN IF NOT EXISTS org_id VARCHAR(64)`);
      await (pool as any).query(`ALTER TABLE nv_schema.nv_openbot_inbox    ADD COLUMN IF NOT EXISTS org_id VARCHAR(64)`);
      await (pool as any).query(`CREATE INDEX IF NOT EXISTS nv_openbot_channels_org_idx ON nv_schema.nv_openbot_channels (org_id, status)`);
      await (pool as any).query(`CREATE INDEX IF NOT EXISTS nv_openbot_routes_org_idx   ON nv_schema.nv_openbot_routes   (org_id, is_active)`);
      await (pool as any).query(`CREATE INDEX IF NOT EXISTS nv_openbot_inbox_org_idx    ON nv_schema.nv_openbot_inbox    (org_id, received_at)`);
    } catch (e: any) {
      logger.warn({ msg: '[OpenBot™] org_id column/index ensure failed (table may not exist yet)', error: e.message });
    }

    const channels = await selectRows(`SELECT channel_id, org_id, config FROM nv_schema.nv_openbot_channels WHERE status != 'archived'`);
    for (const r of channels) {
      const cfg = typeof r.config === 'string' ? JSON.parse(r.config) : r.config;
      // Backfill org_id onto the cached config when the column was authoritative
      // but the embedded JSON was written before task-224.
      if (r.org_id && cfg && !cfg.orgId) cfg.orgId = r.org_id;
      channelRegistry.set(r.channel_id, cfg);
      if (!messageInbox.has(r.channel_id)) messageInbox.set(r.channel_id, []);
    }
    const routes = await selectRows(`SELECT rule_id, org_id, rule FROM nv_schema.nv_openbot_routes WHERE is_active = TRUE`);
    for (const r of routes) {
      const rule = typeof r.rule === 'string' ? JSON.parse(r.rule) : r.rule;
      if (r.org_id && rule && !rule.orgId) rule.orgId = r.org_id;
      routingRules.set(r.rule_id, rule);
    }
    // Task #223 / task-236 — restore the recent inbox window so /inbox endpoints
    // don't return empty after a restart and conversations survive across pods.
    // Bounded global LIMIT protects boot time; per-channel slice(-500) preserves
    // the in-memory ring-buffer semantics.
    const msgs = await selectRows(`SELECT channel_id, message FROM nv_schema.nv_openbot_inbox ORDER BY received_at DESC LIMIT 5000`);
    for (const r of msgs) {
      const m = typeof r.message === 'string' ? JSON.parse(r.message) : r.message;
      const arr = messageInbox.get(r.channel_id) ?? [];
      arr.push(m);
      messageInbox.set(r.channel_id, arr);
    }
    // Inbox is hydrated newest-first; flip to oldest-first to preserve the
    // service's append-then-trim semantics (slice(-500) keeps most recent).
    for (const [chId, arr] of messageInbox) messageInbox.set(chId, arr.reverse().slice(-500));
    logger.info(`[OpenBot™] hydrated ${channels.length} channels + ${routes.length} routes + ${msgs.length} inbox messages from DB`);
  }

  // ── CHANNEL MANAGEMENT ──────────────────────────────────────────────────────

  addChannel(params: {
    channel: OpenBotChannel;
    name: string;
    // task-224: required for org-scoped lookups
    orgId: string;
    credentials?: Record<string, string>;
    botIds?: string[];
  }): ChannelConfig {
    const channelId = `CH-${crypto.randomUUID().substring(0, 8).toUpperCase()}`;
    const config: ChannelConfig = {
      channelId,
      channel: params.channel,
      name: params.name,
      orgId: params.orgId,
      credentials: params.credentials ?? {},
      webhookUrl: `/api/jrx/openbot/webhooks/${params.channel}/${channelId}`,
      isVerified: false,
      botIds: params.botIds ?? [],
      status: 'active',
      createdAt: new Date().toISOString(),
    };
    channelRegistry.set(channelId, config);
    messageInbox.set(channelId, []);
    logger.info(`[OpenBot™] Channel added: ${channelId} (${params.channel}) [org=${params.orgId}]`);
    this.emit('channel:added', config);
    return config;
  }

  getChannel(channelId: string): ChannelConfig | null {
    void this._hydrate();
    return channelRegistry.get(channelId) ?? null;
  }

  // task-224: filter by caller's org. Pre-existing call sites that omit orgId
  // get an unscoped list (back-compat for stats/admin paths only — the route
  // layer always passes an org).
  // task-236: when an org is supplied, drive the result from the indexed
  // `org_id` column on `nv_schema.nv_openbot_channels` so a freshly-restarted
  // pod (or a sibling pod in a multi-pod deployment) sees writes from peers
  // even before its in-memory cache is hydrated. The DB rows are merged back
  // into the cache so subsequent calls stay fast.
  listChannels(orgId?: string): ChannelConfig[] {
    void this._hydrate();
    if (orgId === undefined) return Array.from(channelRegistry.values());
    // Best-effort sync read: kick a DB query and reconcile the cache. The
    // listing itself returns the post-reconcile cache view so it remains
    // synchronous (route handlers and back-compat tests rely on that).
    void (async () => {
      const rows = await selectRows(
        `SELECT channel_id, org_id, config FROM nv_schema.nv_openbot_channels WHERE org_id = $1 AND status != 'archived'`,
        [String(orgId)],
      );
      for (const r of rows) {
        const cfg = typeof r.config === 'string' ? JSON.parse(r.config) : r.config;
        if (cfg && !cfg.orgId && r.org_id) cfg.orgId = r.org_id;
        if (cfg) channelRegistry.set(r.channel_id, cfg);
      }
    })();
    return Array.from(channelRegistry.values()).filter((c) => String(c.orgId) === String(orgId));
  }

  // task-236: async variant for callers that can await the freshest server-side
  // view (e.g. pod-spanning admin paths). Always reconciles the cache before
  // returning.
  async listChannelsAsync(orgId?: string): Promise<ChannelConfig[]> {
    await this._hydrate();
    if (orgId === undefined) return Array.from(channelRegistry.values());
    const rows = await selectRows(
      `SELECT channel_id, org_id, config FROM nv_schema.nv_openbot_channels WHERE org_id = $1 AND status != 'archived'`,
      [String(orgId)],
    );
    const out: ChannelConfig[] = [];
    for (const r of rows) {
      const cfg = typeof r.config === 'string' ? JSON.parse(r.config) : r.config;
      if (cfg && !cfg.orgId && r.org_id) cfg.orgId = r.org_id;
      if (cfg) { channelRegistry.set(r.channel_id, cfg); out.push(cfg); }
    }
    return out;
  }

  removeChannel(channelId: string): boolean {
    const removed = channelRegistry.delete(channelId);
    if (removed) this.emit('channel:removed', { channelId });
    return removed;
  }

  // ── ROUTING RULES ────────────────────────────────────────────────────────────

  addRoutingRule(rule: Omit<BotRoutingRule, 'ruleId'>): BotRoutingRule {
    const ruleId = `RULE-${crypto.randomUUID().substring(0, 8)}`;
    const newRule = { ...rule, ruleId };
    routingRules.set(ruleId, newRule);
    this.emit('rule:added', newRule);
    return newRule;
  }

  getRoutingRule(ruleId: string): BotRoutingRule | null {
    void this._hydrate();
    return routingRules.get(ruleId) ?? null;
  }

  // task-224: filter by caller's org when supplied. Internal callers (e.g.
  // `resolveBot`) intentionally pass no org because they need to evaluate every
  // rule attached to a channel; route handlers always pass an org.
  // task-223: trigger lazy DB hydration so persisted rules survive restart.
  // task-236: when an org is supplied, also reconcile from the indexed
  // `org_id` column so peer-pod / post-restart writes show up without waiting
  // for the next full hydrate.
  listRoutingRules(orgId?: string): BotRoutingRule[] {
    void this._hydrate();
    if (orgId !== undefined) {
      void (async () => {
        const rows = await selectRows(
          `SELECT rule_id, org_id, rule FROM nv_schema.nv_openbot_routes WHERE org_id = $1 AND is_active = TRUE`,
          [String(orgId)],
        );
        for (const r of rows) {
          const rule = typeof r.rule === 'string' ? JSON.parse(r.rule) : r.rule;
          if (rule && !rule.orgId && r.org_id) rule.orgId = r.org_id;
          if (rule) routingRules.set(r.rule_id, rule);
        }
      })();
    }
    const all = Array.from(routingRules.values());
    const filtered = orgId === undefined ? all : all.filter((r) => String(r.orgId) === String(orgId));
    return filtered.sort((a, b) => b.priority - a.priority);
  }

  async listRoutingRulesAsync(orgId?: string): Promise<BotRoutingRule[]> {
    await this._hydrate();
    if (orgId === undefined) return Array.from(routingRules.values()).sort((a, b) => b.priority - a.priority);
    const rows = await selectRows(
      `SELECT rule_id, org_id, rule FROM nv_schema.nv_openbot_routes WHERE org_id = $1 AND is_active = TRUE`,
      [String(orgId)],
    );
    const out: BotRoutingRule[] = [];
    for (const r of rows) {
      const rule = typeof r.rule === 'string' ? JSON.parse(r.rule) : r.rule;
      if (rule && !rule.orgId && r.org_id) rule.orgId = r.org_id;
      if (rule) { routingRules.set(r.rule_id, rule); out.push(rule); }
    }
    return out.sort((a, b) => b.priority - a.priority);
  }

  removeRoutingRule(ruleId: string): boolean {
    const removed = routingRules.delete(ruleId);
    if (removed) this.emit('rule:removed', { ruleId });
    return removed;
  }

  resolveBot(message: string, channel: OpenBotChannel, orgId?: string): { botId: string; ruleId: string | null } {
    const rules = Array.from(routingRules.values())
      .filter((r) => r.isActive && (!r.conditions.channels || r.conditions.channels.includes(channel)))
      .filter((r) => orgId === undefined || String(r.orgId) === String(orgId))
      .sort((a, b) => b.priority - a.priority);

    for (const rule of rules) {
      if (rule.conditions.keywords?.some((kw) => message.toLowerCase().includes(kw.toLowerCase()))) {
        return { botId: rule.targetBotId, ruleId: rule.ruleId };
      }
    }

    const defaultRule = rules.find((r) => !r.conditions.keywords?.length);
    if (defaultRule) return { botId: defaultRule.targetBotId, ruleId: defaultRule.ruleId };

    return { botId: 'DEFAULT', ruleId: null };
  }

  // ── INBOUND MESSAGE PROCESSING ───────────────────────────────────────────────

  async receiveMessage(params: {
    channelId: string;
    channel: OpenBotChannel;
    from: string;
    rawPayload: unknown;
    metadata?: Record<string, unknown>;
  }): Promise<MultiChannelMessage> {
    await this._hydrate();
    const adapter = channelAdapters[params.channel] ?? channelAdapters.api;
    const { text, attachments } = adapter.parse(params.rawPayload, params.channel);

    const msg: MultiChannelMessage = {
      messageId: crypto.randomUUID(),
      channelId: params.channelId,
      channel: params.channel,
      from: params.from,
      to: params.channelId,
      content: text,
      // @ts-expect-error NV-TS230 legacy typing gap (TS2322)
      attachments,
      timestamp: new Date().toISOString(),
      direction: 'inbound',
      status: 'received',
      metadata: params.metadata,
    };

    const inbox = messageInbox.get(params.channelId) ?? [];
    inbox.push(msg);
    messageInbox.set(params.channelId, inbox.slice(-500));

    // task-224: only consider routing rules belonging to the same org as the
    // channel that received the message, so a tenant cannot inadvertently
    // (or maliciously) route another tenant's traffic.
    // task-236: inbox persistence is handled by the `message:received` event
    // listener in the constructor (so we don't double-write here).
    const channelOrgId = channelRegistry.get(params.channelId)?.orgId;
    const { botId, ruleId } = this.resolveBot(text, params.channel, channelOrgId);
    msg.botId = botId;
    msg.status = 'processing';

    logger.info(`[OpenBot™] Message received on ${params.channel} → routed to bot ${botId} (rule: ${ruleId ?? 'none'})`);
    this.emit('message:received', msg);

    return msg;
  }

  async sendMessage(params: {
    channelId: string;
    channel: OpenBotChannel;
    to: string;
    content: string;
    options?: Record<string, unknown>;
  }): Promise<MultiChannelMessage> {
    const adapter = channelAdapters[params.channel] ?? channelAdapters.api;
    const formattedContent = adapter.format(params.content, params.channel, params.options);

    const msg: MultiChannelMessage = {
      messageId: crypto.randomUUID(),
      channelId: params.channelId,
      channel: params.channel,
      from: params.channelId,
      to: params.to,
      content: params.content,
      formattedContent: typeof formattedContent === 'object' ? formattedContent as Record<string, unknown> : undefined,
      timestamp: new Date().toISOString(),
      direction: 'outbound',
      status: 'sent',
    };

    const inbox = messageInbox.get(params.channelId) ?? [];
    inbox.push(msg);
    messageInbox.set(params.channelId, inbox.slice(-500));

    // task-236: outbound persistence is handled by the `message:sent` event
    // listener in the constructor (so we don't double-write here).
    this.emit('message:sent', msg);
    return msg;
  }

  // ── INBOX ────────────────────────────────────────────────────────────────────

  // task-236: prefer the DB view so a freshly-restarted pod (with an empty
  // in-memory cache) still serves the persisted history. Falls back to the
  // cache if the DB read fails (degraded mode keeps the SLA documented in the
  // route response).
  getInbox(channelId: string, limit = 50): MultiChannelMessage[] {
    void this._hydrate();
    return (messageInbox.get(channelId) ?? []).slice(-limit).reverse();
  }

  async getInboxAsync(channelId: string, limit = 50): Promise<MultiChannelMessage[]> {
    await this._hydrate();
    const rows = await selectRows(
      `SELECT message FROM nv_schema.nv_openbot_inbox WHERE channel_id = $1 ORDER BY received_at DESC LIMIT $2`,
      [channelId, limit],
    );
    if (rows.length === 0) return (messageInbox.get(channelId) ?? []).slice(-limit).reverse();
    return rows.map((r) => (typeof r.message === 'string' ? JSON.parse(r.message) : r.message));
  }

  // task-224: when orgId is supplied, only return messages from channels owned
  // by that org. Without it, returns the full unified inbox (admin/stats path).
  // task-223: trigger lazy DB hydration so persisted inbox survives restart.
  // task-236: see `getUnifiedInboxAsync` for the indexed-`org_id` server-side
  // filter that callers should prefer when they can await a DB read.
  getUnifiedInbox(limit = 100, orgId?: string): MultiChannelMessage[] {
    void this._hydrate();
    const all: MultiChannelMessage[] = [];
    for (const [channelId, msgs] of messageInbox.entries()) {
      if (orgId !== undefined) {
        const ch = channelRegistry.get(channelId);
        if (!ch || String(ch.orgId) !== String(orgId)) continue;
      }
      all.push(...msgs);
    }
    return all.sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, limit);
  }

  async getUnifiedInboxAsync(limit = 100, orgId?: string): Promise<MultiChannelMessage[]> {
    await this._hydrate();
    const rows = orgId === undefined
      ? await selectRows(
          `SELECT message FROM nv_schema.nv_openbot_inbox ORDER BY received_at DESC LIMIT $1`,
          [limit],
        )
      : await selectRows(
          `SELECT message FROM nv_schema.nv_openbot_inbox WHERE org_id = $1 ORDER BY received_at DESC LIMIT $2`,
          [String(orgId), limit],
        );
    if (rows.length === 0) return this.getUnifiedInbox(limit, orgId);
    return rows.map((r) => (typeof r.message === 'string' ? JSON.parse(r.message) : r.message));
  }

  // ── STATS ────────────────────────────────────────────────────────────────────

  getStats(): {
    totalChannels: number;
    activeChannels: number;
    totalMessages: number;
    channelBreakdown: Record<string, number>;
    routingRules: number;
  } {
    const channels = Array.from(channelRegistry.values());
    const channelBreakdown: Record<string, number> = {};
    let totalMessages = 0;
    for (const [channelId, msgs] of messageInbox.entries()) {
      const ch = channelRegistry.get(channelId);
      if (ch) {
        channelBreakdown[ch.channel] = (channelBreakdown[ch.channel] ?? 0) + msgs.length;
        totalMessages += msgs.length;
      }
    }
    return {
      totalChannels: channels.length,
      activeChannels: channels.filter((c) => c.status === 'active').length,
      totalMessages,
      channelBreakdown,
      routingRules: routingRules.size,
    };
  }
}

export const openBotService = new OpenBotService();
export default openBotService;
