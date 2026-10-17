/**
 * jrx-operations-aggregators.ts — Task #177 (B2)
 *
 * Four thin aggregator routes feeding the Console "Operations" pages:
 *   GET /api/jrx/cost/overview          → Cost Optimizer        (super_admin)
 *   GET /api/jrx/regulatory             → Regulatory Monitor    (super_admin)
 *   GET /api/jrx/providers/failover     → Provider Failover     (analyst+)
 *   GET /api/jrx/operations/overview    → Operations Hub        (analyst+)
 *
 * All read-only. Sourced from existing tables actually present in the DB:
 *   - nv_sdk_usage_metrics  → per-app cost_usd / tokens / latency
 *   - nv_org_api_usage_log  → per-org tokens / model / agent
 *   - nv_router_decisions   → per-provider/per-model cost_usd, fallback levels
 *   - nv_audit_logs         → recent audit events (errors, regulatory.*)
 *   - nv_orchestration_jobs → run counts, queue depth, error counts
 *   - nv_llm_providers      → provider catalogue
 *   - nv_organizations      → tenant labels for byTenant rollup
 *   - nv_sdk_applications   → app → org join for byTenant USD
 *   - nv_statutes           → statute-table source for regulatory updates
 *   - intelligent-router    → live model health snapshot
 *   - regulatoryMonitor     → in-memory regulatory events
 *
 * Response shapes return the direct object (no { success, data } envelope) so
 * Console pages can consume the payload without indirection.
 *
 * Audit: every successful 200 emits a non-strict appendAuditRecord('ops.*.read').
 */

import { Router, Request, Response } from 'express';
import { sql } from 'drizzle-orm';
import { db as rawDb } from '../db/index.js';
import { requireDb } from '../utils/jrx-type-helpers.js';
import { authenticateToken, requireRole, type AuthRequest } from '../middleware/jrx-auth.js';
import { appendAuditRecord } from '../middleware/jrx-sdk-tracking-middleware.js';
import {
  getHealthSnapshot,
  isProviderAvailable,
  getAggregates,
} from '../services/intelligent-router/index.js';
import { regulatoryMonitor } from '../services/regulatory-monitor/regulatory-monitor-service.js';
import { sanitizeErrorForClient } from '../utils/error-sanitizer.js';
import { createLogger } from '../utils/logger.js';
import { suggestCheaperModel, normalizeModel } from '../utils/jrx-llm-pricing.js';

const db = requireDb(rawDb);
const router = Router();
const logger = createLogger('./jrx-operations-aggregators');

async function audit(eventType: string, req: AuthRequest, payload: unknown): Promise<void> {
  try {
    await appendAuditRecord({
      eventType,
      payload: JSON.stringify({
        userId: req.user?.id ?? null,
        role: req.user?.role ?? null,
        path: req.originalUrl,
        ts: new Date().toISOString(),
        summary: payload,
      }),
      strict: false,
    });
  } catch (err) {
    logger.warn('[ops-aggregator] audit append failed (non-fatal)', { err: errMsg(err) });
  }
}

type Row = Record<string, unknown>;
function asArr(result: unknown): Row[] {
  if (Array.isArray(result)) return result as Row[];
  if (result && typeof result === 'object' && Array.isArray((result as { rows?: unknown[] }).rows)) {
    return (result as { rows: Row[] }).rows;
  }
  return [];
}
function num(v: unknown, fallback = 0): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : fallback;
}
function str(v: unknown, fallback = ''): string {
  return v == null ? fallback : String(v);
}
function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ─────────────────────────────────────────────────────────────────────────────
// 1) GET /cost/overview — super_admin
// Returns direct shape: { totalToday, totalMtd, byProvider, byModel, byTenant, generatedAt }
// USD is sourced from nv_sdk_usage_metrics (per app/tenant) and
// nv_router_decisions (per provider/model). Tokens from both.
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  '/cost/overview',
  authenticateToken,
  requireRole('super_admin'),
  async (req: Request, res: Response) => {
    try {
      // Task #302 — jurisdiction scope (US/IN/...) optionally narrows all
      // rollups so the Cost Optimizer can match the Operations Hub filter.
      // Also exclude rows tagged metadata.internal=true (aggregator polls,
      // health probes, auth chatter — see jrx-usage-metering-middleware).
      const j = jurisdictionFilter(req);
      const jSql = j ? sql`AND metadata->>'jurisdiction' = ${j}` : sql``;
      const jSqlU = j ? sql`AND u.metadata->>'jurisdiction' = ${j}` : sql``;
      const noInternal = sql`AND (metadata->>'internal') IS NULL`;
      const noInternalU = sql`AND (u.metadata->>'internal') IS NULL`;
      // Task #302 (2026-05-13): switched FROM clauses to public.sdk_usage_metering,
      // which is the table actually written by jrx-usage-metering-middleware
      // (cost_usd, tokens_in, tokens_out, application_id, agent_id, metadata jsonb,
      // recorded_at). nv_sdk_usage_metrics has none of those columns and silently
      // returned zeros via the .catch fallback.
      const [
        todayUsage,
        mtdUsage,
        byProviderRows,
        byModelRows,
        byTenantRows,
        byKeyRows,
        topExpensiveRows,
      ] = await Promise.all([
        db.execute(sql`
          SELECT COALESCE(SUM(cost_usd),0)::float8           AS usd,
                 COALESCE(SUM(tokens_in + tokens_out),0)::bigint AS tokens,
                 COUNT(*)::int                               AS requests
          FROM sdk_usage_metering
          WHERE recorded_at >= DATE_TRUNC('day', NOW())
            AND period = 'request'
            ${jSql}
            ${noInternal}
        `).catch(() => ({ rows: [{}] })),
        db.execute(sql`
          SELECT COALESCE(SUM(cost_usd),0)::float8           AS usd,
                 COALESCE(SUM(tokens_in + tokens_out),0)::bigint AS tokens,
                 COUNT(*)::int                               AS requests
          FROM sdk_usage_metering
          WHERE recorded_at >= DATE_TRUNC('month', NOW())
            AND period = 'request'
            ${jSql}
            ${noInternal}
        `).catch(() => ({ rows: [{}] })),
        // Per-provider rollup from metering metadata.
        db.execute(sql`
          SELECT COALESCE(metadata->>'provider','unknown')   AS provider,
                 COALESCE(SUM(cost_usd),0)::float8            AS usd,
                 COALESCE(SUM(tokens_in + tokens_out),0)::bigint AS tokens,
                 COUNT(*)::int                                AS requests
          FROM sdk_usage_metering
          WHERE recorded_at >= DATE_TRUNC('month', NOW())
            AND period = 'request'
            ${jSql}
            ${noInternal}
          GROUP BY metadata->>'provider'
          ORDER BY usd DESC
          LIMIT 25
        `).catch(() => ({ rows: [] })),
        db.execute(sql`
          SELECT COALESCE(metadata->>'model','unknown')       AS model,
                 COALESCE(metadata->>'provider','unknown')    AS provider,
                 COALESCE(SUM(cost_usd),0)::float8             AS usd,
                 COALESCE(SUM(tokens_in + tokens_out),0)::bigint AS tokens,
                 COUNT(*)::int                                 AS requests
          FROM sdk_usage_metering
          WHERE recorded_at >= DATE_TRUNC('month', NOW())
            AND period = 'request'
            ${jSql}
            ${noInternal}
          GROUP BY metadata->>'model', metadata->>'provider'
          ORDER BY usd DESC
          LIMIT 25
        `).catch(() => ({ rows: [] })),
        db.execute(sql`
          SELECT COALESCE(metadata->>'orgId','unknown')        AS tenant_id,
                 COALESCE(o.name, COALESCE(metadata->>'orgId','Unassigned')) AS tenant_name,
                 COALESCE(SUM(u.cost_usd),0)::float8           AS usd,
                 COALESCE(SUM(u.tokens_in + u.tokens_out),0)::bigint AS tokens,
                 COUNT(*)::int                                 AS requests
          FROM sdk_usage_metering u
          LEFT JOIN nv_organizations o
                 ON o.id::text = u.metadata->>'orgId'
          WHERE u.recorded_at >= DATE_TRUNC('month', NOW())
            AND u.period = 'request'
            ${jSqlU}
            ${noInternalU}
          GROUP BY u.metadata->>'orgId', o.name
          ORDER BY usd DESC
          LIMIT 25
        `).catch(() => ({ rows: [] })),
        // Per-SDK-key spend split (Task #302).
        db.execute(sql`
          SELECT COALESCE(metadata->>'sdkKeyPrefix','anonymous') AS key_prefix,
                 COALESCE(SUM(cost_usd),0)::float8               AS usd,
                 COALESCE(SUM(tokens_in + tokens_out),0)::bigint AS tokens,
                 COUNT(*)::int                                   AS requests
          FROM sdk_usage_metering
          WHERE recorded_at >= DATE_TRUNC('month', NOW())
            AND period = 'request'
            ${jSql}
            ${noInternal}
          GROUP BY metadata->>'sdkKeyPrefix'
          ORDER BY usd DESC
          LIMIT 25
        `).catch(() => ({ rows: [] })),
        // Top 10 most expensive single requests (last 7 days).
        db.execute(sql`
          SELECT id,
                 cost_usd::float8                       AS usd,
                 tokens_in + tokens_out                 AS tokens,
                 metadata->>'route'                     AS route,
                 metadata->>'model'                     AS model,
                 metadata->>'provider'                  AS provider,
                 (metadata->>'latencyMs')::int          AS latency_ms,
                 recorded_at                            AS ts
          FROM sdk_usage_metering
          WHERE recorded_at >= NOW() - INTERVAL '7 days'
            AND period = 'request'
            ${jSql}
            ${noInternal}
          ORDER BY cost_usd DESC NULLS LAST
          LIMIT 10
        `).catch(() => ({ rows: [] })),
      ]);

      const today = asArr(todayUsage)[0] ?? {};
      const mtd = asArr(mtdUsage)[0] ?? {};

      // Direct shape — no { success, data } wrapper.
      const body = {
        totalToday: {
          tokens: num(today.tokens),
          usd: num(today.usd),
          requests: num(today.requests),
        },
        totalMtd: {
          tokens: num(mtd.tokens),
          usd: num(mtd.usd),
          requests: num(mtd.requests),
        },
        byProvider: asArr(byProviderRows).map((r: Row) => ({
          provider: r.provider,
          usd: num(r.usd),
          tokens: num(r.tokens),
          requests: num(r.requests),
        })),
        byModel: asArr(byModelRows).map((r: Row) => ({
          model: r.model,
          provider: r.provider,
          usd: num(r.usd),
          tokens: num(r.tokens),
          requests: num(r.requests),
        })),
        byTenant: asArr(byTenantRows).map((r: Row) => ({
          tenantId: r.tenant_id,
          tenantName: r.tenant_name,
          usd: num(r.usd),
          tokens: num(r.tokens),
          requests: num(r.requests),
        })),
        byKey: asArr(byKeyRows).map((r: Row) => ({
          keyPrefix: r.key_prefix,
          usd: num(r.usd),
          tokens: num(r.tokens),
          requests: num(r.requests),
        })),
        topExpensive: asArr(topExpensiveRows).map((r: Row) => ({
          id: String(r.id),
          usd: num(r.usd),
          tokens: num(r.tokens),
          route: r.route ?? null,
          model: r.model ?? null,
          provider: r.provider ?? null,
          latencyMs: num(r.latency_ms),
          ts: r.ts,
        })),
        jurisdiction: j ?? 'ALL',
        generatedAt: new Date().toISOString(),
      };

      void audit('ops.cost.overview.read', req as AuthRequest, {
        usdMtd: body.totalMtd.usd,
        tokensMtd: body.totalMtd.tokens,
      });
      res.json(body);
    } catch (err) {
      logger.error('[cost/overview] failed', { err: errMsg(err) });
      res.status(500).json({ error: sanitizeErrorForClient(err) });
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// 2) GET /regulatory — super_admin
// Direct shape: { jurisdiction, updates: [...], counts, generatedAt }
// Sources: regulatoryMonitor (live polled), nv_audit_logs (regulatory.* / compliance.*),
// nv_statutes (recently updated statute sections).
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  '/regulatory',
  authenticateToken,
  requireRole('super_admin'),
  async (req: Request, res: Response) => {
    try {
      const jurisdictionParam = (req.query.jurisdiction as string | undefined)?.toUpperCase();
      const limit = Math.min(parseInt((req.query.limit as string) || '50', 10) || 50, 200);

      const validJurisdictions = ['IN', 'UK', 'GC', 'EU', 'US', 'SG'] as const;
      type J = (typeof validJurisdictions)[number];
      const jurisdiction =
        jurisdictionParam && (validJurisdictions as readonly string[]).includes(jurisdictionParam)
          ? (jurisdictionParam as J)
          : undefined;

      const events = regulatoryMonitor.getEvents({ jurisdiction, limit });

      // Task #304: when an operator switches jurisdictions in the UI, kick
      // off a Tavily refresh for that jurisdiction in the background so
      // the next poll-tick (~30s) shows fresh items. Throttled to once
      // per 5 minutes per jurisdiction so rapid back-and-forth toggling
      // doesn't slam Tavily.
      if (jurisdiction && regulatoryMonitor.isTavilyEnabled()) {
        const status = regulatoryMonitor.getTavilyStatus();
        const lastIso = status.lastRunAt[jurisdiction];
        const ageMs = lastIso ? Date.now() - new Date(lastIso).getTime() : Infinity;
        if (ageMs > 5 * 60_000) {
          // Fire and forget — never blocks the response.
          regulatoryMonitor
            .refreshTavilyForJurisdiction(jurisdiction)
            .catch(() => { /* logged inside service */ });
        }
      }

      // Tavily-backed live news items persisted to nv_regulatory_feeds by
      // RegulatoryMonitorService.refreshTavilyForJurisdiction (task #304).
      const tavilyRows = jurisdiction
        ? await db
            .execute(sql`
              SELECT id, source_name, jurisdiction, feed_url,
                     last_fetched_at, last_change_detected_at, metadata
              FROM nv_regulatory_feeds
              WHERE feed_type = 'tavily-news'
                AND jurisdiction = ${jurisdiction}
              ORDER BY COALESCE(last_change_detected_at, last_fetched_at) DESC
              LIMIT ${limit}
            `)
            .catch(() => ({ rows: [] }))
        : await db
            .execute(sql`
              SELECT id, source_name, jurisdiction, feed_url,
                     last_fetched_at, last_change_detected_at, metadata
              FROM nv_regulatory_feeds
              WHERE feed_type = 'tavily-news'
              ORDER BY COALESCE(last_change_detected_at, last_fetched_at) DESC
              LIMIT ${limit}
            `)
            .catch(() => ({ rows: [] }));

      // Recent regulatory-flavoured audit events. nv_audit_logs uses (action, metadata, created_at).
      const auditRows = await db
        .execute(sql`
          SELECT action, metadata, created_at
          FROM nv_audit_logs
          WHERE action ILIKE 'regulatory.%' OR action ILIKE 'compliance.%'
          ORDER BY created_at DESC
          LIMIT ${limit}
        `)
        .catch(() => ({ rows: [] }));

      // Recently updated statutes — surface real statute-table changes.
      const statuteRows = jurisdiction
        ? await db
            .execute(sql`
              SELECT id, jurisdiction, act_short_title, section_number, section_title,
                     effective_date, amended_date, COALESCE(updated_at, created_at) AS changed_at
              FROM nv_statutes
              WHERE jurisdiction = ${jurisdiction}
                AND is_repealed = false
              ORDER BY COALESCE(updated_at, created_at) DESC
              LIMIT ${limit}
            `)
            .catch(() => ({ rows: [] }))
        : await db
            .execute(sql`
              SELECT id, jurisdiction, act_short_title, section_number, section_title,
                     effective_date, amended_date, COALESCE(updated_at, created_at) AS changed_at
              FROM nv_statutes
              WHERE is_repealed = false
              ORDER BY COALESCE(updated_at, created_at) DESC
              LIMIT ${limit}
            `)
            .catch(() => ({ rows: [] }));

      const monitorUpdates = events.map((e) => ({
        id: e.id,
        source: e.regulator,
        sourceKind: 'monitor' as const,
        jurisdiction: e.jurisdiction,
        title: e.title,
        summary: e.summary,
        effectiveDate: e.effectiveDate ? new Date(e.effectiveDate).toISOString() : null,
        publishedAt: new Date(e.publishedAt).toISOString(),
        severity: e.severity,
        type: e.type,
        sourceUrl: e.sourceUrl ?? null,
      }));

      interface TavilyFeedRow {
        id: number;
        source_name: string | null;
        jurisdiction: string;
        feed_url: string;
        last_fetched_at: string | Date | null;
        last_change_detected_at: string | Date | null;
        metadata: Record<string, unknown> | null;
      }
      const tavilyUpdates = (asArr(tavilyRows) as unknown as TavilyFeedRow[]).map((r) => {
        const md: Record<string, unknown> =
          (r.metadata && typeof r.metadata === 'object' ? r.metadata : {}) as Record<
            string,
            unknown
          >;
        const score = typeof md.score === 'number' ? (md.score as number) : 0;
        const severity =
          score >= 0.85 ? 'high' : score >= 0.7 ? 'warning' : score >= 0.5 ? 'medium' : 'info';
        const mdPublishedAt = typeof md.publishedAt === 'string' ? md.publishedAt : null;
        const rawPublishedAt: string | Date | null =
          mdPublishedAt ?? r.last_change_detected_at ?? r.last_fetched_at ?? null;
        const mdSource = typeof md.source === 'string' ? md.source : null;
        const mdTitle = typeof md.title === 'string' ? md.title : null;
        const mdSummary = typeof md.summary === 'string' ? md.summary : '';
        const mdTopic = typeof md.topic === 'string' ? md.topic : null;
        return {
          id: `tavily:${r.id}`,
          source: r.source_name ?? mdSource ?? 'tavily',
          sourceKind: 'monitor' as const,
          jurisdiction: r.jurisdiction,
          title: mdTitle ?? r.feed_url,
          summary: mdSummary,
          effectiveDate: null as string | null,
          publishedAt: rawPublishedAt ? new Date(rawPublishedAt).toISOString() : null,
          severity,
          type: mdTopic ?? 'tavily-news',
          sourceUrl: r.feed_url,
          relevanceScore: Math.round(score * 100),
        };
      });

      const auditUpdates = asArr(auditRows).map((r: Row) => {
        const meta = (r.metadata && typeof r.metadata === 'object') ? (r.metadata as Record<string, unknown>) : {};
        return {
          id: `audit:${str(r.created_at)}:${str(r.action)}`,
          source: 'audit-log',
          sourceKind: 'audit' as const,
          jurisdiction: meta.jurisdiction ?? null,
          title: str(r.action),
          summary: JSON.stringify(meta).slice(0, 500),
          effectiveDate: null,
          publishedAt: str(r.created_at),
          severity: 'info' as const,
          type: str(r.action),
          sourceUrl: null,
        };
      });

      const statuteUpdates = asArr(statuteRows).map((r: Row) => ({
        id: `statute:${str(r.id)}`,
        source: str(r.act_short_title),
        sourceKind: 'statute' as const,
        jurisdiction: str(r.jurisdiction),
        title: `${str(r.act_short_title)} §${str(r.section_number)}${r.section_title ? ` — ${str(r.section_title)}` : ''}`,
        summary: str(r.section_title),
        effectiveDate: r.effective_date ? new Date(str(r.effective_date)).toISOString() : null,
        publishedAt: r.changed_at ? new Date(str(r.changed_at)).toISOString() : null,
        severity: r.amended_date ? 'warning' : ('info' as const),
        type: r.amended_date ? 'amendment' : 'statute',
        sourceUrl: null,
      }));

      // Direct shape — no envelope. Tavily items are merged into the
      // monitor surface (sourceKind='monitor') so the existing client
      // continues to work; counts.fromMonitor includes both polled and
      // Tavily-scraped items, and counts.fromTavily breaks them out.
      const allMonitor = [...monitorUpdates, ...tavilyUpdates];
      const body = {
        jurisdiction: jurisdiction ?? 'ALL',
        updates: [...allMonitor, ...auditUpdates, ...statuteUpdates].slice(0, limit),
        counts: {
          fromMonitor: allMonitor.length,
          fromTavily: tavilyUpdates.length,
          fromAudit: auditUpdates.length,
          fromStatutes: statuteUpdates.length,
        },
        tavily: {
          configured: regulatoryMonitor.isTavilyEnabled(),
          ...regulatoryMonitor.getTavilyStatus(),
        },
        generatedAt: new Date().toISOString(),
      };

      void audit('ops.regulatory.read', req as AuthRequest, {
        jurisdiction: body.jurisdiction,
        count: body.updates.length,
      });
      res.json(body);
    } catch (err) {
      logger.error('[regulatory] failed', err);
      res.status(500).json({ error: sanitizeErrorForClient(err) });
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// 3) GET /providers/failover — analyst+
// Direct shape: { providers: [...], modelHealth: [...], generatedAt }
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  '/providers/failover',
  authenticateToken,
  requireRole('analyst', 'admin', 'org_admin', 'super_admin'),
  async (req: Request, res: Response) => {
    try {
      const [providerRows, failoverRows, recentLatencyRows] = await Promise.all([
        db
          .execute(sql`
            SELECT provider_id, name, is_active
            FROM nv_llm_providers
            ORDER BY name
          `)
          .catch(() => ({ rows: [] })),
        db
          .execute(sql`
            SELECT picked_provider, MAX(ts) AS last_failover_at
            FROM nv_router_decisions
            WHERE fallback_level > 0
            GROUP BY picked_provider
          `)
          .catch(() => ({ rows: [] })),
        db
          .execute(sql`
            SELECT picked_provider,
                   AVG(latency_ms)::float8 AS avg_latency,
                   AVG(CASE WHEN ok THEN 0.0 ELSE 1.0 END)::float8 AS error_rate,
                   COUNT(*)::int AS calls
            FROM nv_router_decisions
            WHERE ts >= NOW() - INTERVAL '24 hours'
            GROUP BY picked_provider
          `)
          .catch(() => ({ rows: [] })),
      ]);

      const failoverByProvider = new Map<string, string>();
      for (const r of asArr(failoverRows)) {
        failoverByProvider.set(str(r.picked_provider), str(r.last_failover_at));
      }
      const latencyByProvider = new Map<
        string,
        { avg_latency: number; error_rate: number; calls: number }
      >();
      for (const r of asArr(recentLatencyRows)) {
        latencyByProvider.set(str(r.picked_provider), {
          avg_latency: num(r.avg_latency),
          error_rate: num(r.error_rate),
          calls: num(r.calls),
        });
      }

      const known = new Set<string>();
      const providers = asArr(providerRows).map((p: Row) => {
        const providerId = str(p.provider_id);
        known.add(providerId);
        const lat = latencyByProvider.get(providerId);
        const envOk = (() => {
          try { return isProviderAvailable(providerId); } catch { return false; }
        })();
        const healthy = !!p.is_active && envOk && (!lat || lat.error_rate < 0.5);
        return {
          name: providerId,
          displayName: str(p.name, providerId),
          status: !p.is_active ? 'disabled' : envOk ? (healthy ? 'healthy' : 'degraded') : 'down',
          envKeyPresent: envOk,
          latencyMs: lat ? Math.round(lat.avg_latency) : null,
          errorRate: lat ? Number(lat.error_rate.toFixed(4)) : null,
          calls24h: lat?.calls ?? 0,
          lastFailoverAt: failoverByProvider.get(providerId) ?? null,
        };
      });
      for (const [name, lat] of latencyByProvider.entries()) {
        if (known.has(name)) continue;
        providers.push({
          name,
          displayName: name,
          status: lat.error_rate < 0.5 ? 'healthy' : 'degraded',
          envKeyPresent: (() => { try { return isProviderAvailable(name); } catch { return false; } })(),
          latencyMs: Math.round(lat.avg_latency),
          errorRate: Number(lat.error_rate.toFixed(4)),
          calls24h: lat.calls,
          lastFailoverAt: failoverByProvider.get(name) ?? null,
        });
      }

      const health = (() => {
        try { return getHealthSnapshot(); } catch { return []; }
      })();

      const body = {
        providers,
        modelHealth: health,
        generatedAt: new Date().toISOString(),
      };

      void audit('ops.providers.failover.read', req as AuthRequest, {
        providerCount: providers.length,
        modelCount: health.length,
      });
      res.json(body);
    } catch (err) {
      logger.error('[providers/failover] failed', err);
      res.status(500).json({ error: sanitizeErrorForClient(err) });
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// 4) GET /operations/overview — analyst+
// Direct shape: { activeAgents, runsLast24h, errorsLast24h, avgLatencyMs, queueDepth, ... }
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  '/operations/overview',
  authenticateToken,
  requireRole('analyst', 'admin', 'org_admin', 'super_admin'),
  async (req: Request, res: Response) => {
    try {
      const [activeAgentsRow, runs24Row, errors24Row, latencyRow, queueRow] = await Promise.all([
        db
          .execute(sql`SELECT COUNT(*)::int AS c FROM legal_agents WHERE is_enabled = true`)
          .catch(() => ({ rows: [{ c: 0 }] })),
        // runs in last 24h: orchestration jobs
        db
          .execute(sql`
            SELECT COUNT(*)::int AS c
            FROM nv_orchestration_jobs
            WHERE created_at >= NOW() - INTERVAL '24 hours'
          `)
          .catch(() => ({ rows: [{ c: 0 }] })),
        // errors in last 24h: failed orchestration jobs
        db
          .execute(sql`
            SELECT COUNT(*)::int AS c
            FROM nv_orchestration_jobs
            WHERE created_at >= NOW() - INTERVAL '24 hours'
              AND (status = 'failed' OR error IS NOT NULL)
          `)
          .catch(() => ({ rows: [{ c: 0 }] })),
        // average latency in last 24h
        db
          .execute(sql`
            SELECT COALESCE(AVG(latency_ms),0)::float8 AS avg_ms
            FROM nv_sdk_usage_metrics
            WHERE recorded_at >= NOW() - INTERVAL '24 hours'
          `)
          .catch(() => ({ rows: [{ avg_ms: 0 }] })),
        // queue depth — pending orchestration jobs right now
        db
          .execute(sql`
            SELECT COUNT(*)::int AS c
            FROM nv_orchestration_jobs
            WHERE status IN ('pending','queued','running')
          `)
          .catch(() => ({ rows: [{ c: 0 }] })),
      ]);

      const activeAgents = num(asArr(activeAgentsRow)[0]?.c);
      const runsLast24h = num(asArr(runs24Row)[0]?.c);
      const errorsLast24h = num(asArr(errors24Row)[0]?.c);
      const avgLatencyMs = Math.round(num(asArr(latencyRow)[0]?.avg_ms));
      const queueDepth = num(asArr(queueRow)[0]?.c);

      // Layer in live router aggregates so the dashboard never reads "all zeros"
      // before any DB-persisted runs land.
      const liveAgg = (() => { try { return getAggregates(); } catch { return null; } })();
      const liveTotalCalls = liveAgg?.totalCalls ?? 0;
      const liveErrorCount = liveAgg
        ? Math.round((1 - (liveAgg.successRate ?? 1)) * (liveAgg.totalCalls ?? 0))
        : 0;

      const effectiveRuns = runsLast24h + liveTotalCalls;
      const effectiveErrors = errorsLast24h + liveErrorCount;

      const body = {
        activeAgents,
        runsLast24h: effectiveRuns,
        errorsLast24h: effectiveErrors,
        avgLatencyMs,
        queueDepth,
        errorRate24h:
          effectiveRuns > 0 ? Number((effectiveErrors / effectiveRuns).toFixed(4)) : 0,
        sources: {
          runsFromDb: runsLast24h,
          runsFromLiveRouter: liveTotalCalls,
        },
        generatedAt: new Date().toISOString(),
      };

      void audit('ops.operations.overview.read', req as AuthRequest, {
        runs: body.runsLast24h,
        errors: body.errorsLast24h,
      });
      res.json(body);
    } catch (err) {
      logger.error('[operations/overview] failed', err);
      res.status(500).json({ error: sanitizeErrorForClient(err) });
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Task #302 — Operations Hub tab endpoints + cost-optimizer suggester
// ─────────────────────────────────────────────────────────────────────────────

function jurisdictionFilter(req: Request): string | null {
  const j = String(req.query.jurisdiction ?? '').toUpperCase();
  return ['IN', 'UK', 'GC', 'EU', 'US', 'SG'].includes(j) ? j : null;
}

// 5) GET /operations/active-sessions — analyst+
router.get(
  '/operations/active-sessions',
  authenticateToken,
  requireRole('analyst', 'admin', 'org_admin', 'super_admin'),
  async (req: Request, res: Response) => {
    try {
      const j = jurisdictionFilter(req);
      const rows = await db.execute(sql`
        SELECT metadata->>'sdkKeyPrefix'   AS key_prefix,
               metadata->>'orgId'          AS org_id,
               metadata->>'route'          AS route,
               metadata->>'provider'       AS provider,
               metadata->>'model'          AS model,
               (metadata->>'latencyMs')::int AS latency_ms,
               metadata->>'jurisdiction'   AS jurisdiction,
               recorded_at                 AS ts
        FROM sdk_usage_metering
        WHERE recorded_at >= NOW() - INTERVAL '5 minutes'
          AND period = 'request'
          ${j ? sql`AND metadata->>'jurisdiction' = ${j}` : sql``}
        ORDER BY recorded_at DESC
        LIMIT 100
      `).catch(() => ({ rows: [] }));

      const sessions = asArr(rows).map((r: Row) => ({
        keyPrefix: r.key_prefix ?? 'anon',
        orgId: r.org_id ?? null,
        route: r.route ?? null,
        provider: r.provider ?? null,
        model: r.model ?? null,
        latencyMs: num(r.latency_ms),
        jurisdiction: r.jurisdiction ?? null,
        ts: r.ts,
      }));

      const distinctKeys = new Set(sessions.map(s => s.keyPrefix)).size;
      const distinctOrgs = new Set(sessions.map(s => s.orgId).filter(Boolean)).size;

      res.json({
        sessions,
        counts: { total: sessions.length, distinctKeys, distinctOrgs },
        windowMinutes: 5,
        jurisdiction: j ?? 'ALL',
        generatedAt: new Date().toISOString(),
      });
    } catch (err) {
      logger.error('[operations/active-sessions] failed', err);
      res.status(500).json({ error: sanitizeErrorForClient(err) });
    }
  },
);

// 6) GET /operations/provider-health — analyst+
router.get(
  '/operations/provider-health',
  authenticateToken,
  requireRole('analyst', 'admin', 'org_admin', 'super_admin'),
  async (req: Request, res: Response) => {
    try {
      const j = jurisdictionFilter(req);
      const rows = await db.execute(sql`
        SELECT COALESCE(metadata->>'provider','unknown') AS provider,
               COUNT(*)::int                              AS calls,
               AVG((metadata->>'latencyMs')::int)::float8 AS avg_latency_ms,
               AVG(CASE WHEN (metadata->>'statusCode')::int < 400 THEN 1.0 ELSE 0.0 END)::float8 AS success_rate,
               COALESCE(SUM(cost_usd),0)::float8          AS usd
        FROM sdk_usage_metering
        WHERE recorded_at >= NOW() - INTERVAL '24 hours'
          AND period = 'request'
          ${j ? sql`AND metadata->>'jurisdiction' = ${j}` : sql``}
        GROUP BY metadata->>'provider'
        ORDER BY calls DESC
      `).catch(() => ({ rows: [] }));

      const providers = asArr(rows).map((r: Row) => ({
        provider: r.provider,
        calls24h: num(r.calls),
        avgLatencyMs: Math.round(num(r.avg_latency_ms)),
        successRate: Number((num(r.success_rate)).toFixed(4)),
        usd24h: num(r.usd),
      }));

      const liveHealth = (() => { try { return getHealthSnapshot(); } catch { return []; } })();

      res.json({
        providers,
        liveModelHealth: liveHealth,
        windowHours: 24,
        jurisdiction: j ?? 'ALL',
        generatedAt: new Date().toISOString(),
      });
    } catch (err) {
      logger.error('[operations/provider-health] failed', err);
      res.status(500).json({ error: sanitizeErrorForClient(err) });
    }
  },
);

// 7) GET /operations/recent-errors — analyst+
router.get(
  '/operations/recent-errors',
  authenticateToken,
  requireRole('analyst', 'admin', 'org_admin', 'super_admin'),
  async (req: Request, res: Response) => {
    try {
      const j = jurisdictionFilter(req);
      const limit = Math.min(parseInt((req.query.limit as string) || '50', 10) || 50, 200);
      const rows = await db.execute(sql`
        SELECT id,
               recorded_at                  AS ts,
               metadata->>'route'           AS route,
               metadata->>'method'          AS method,
               (metadata->>'statusCode')::int AS status_code,
               metadata->>'provider'        AS provider,
               metadata->>'model'           AS model,
               metadata->>'orgId'           AS org_id,
               metadata->>'sdkKeyPrefix'    AS key_prefix,
               metadata->>'error'           AS error,
               metadata->>'jurisdiction'    AS jurisdiction,
               (metadata->>'latencyMs')::int AS latency_ms
        FROM sdk_usage_metering
        WHERE recorded_at >= NOW() - INTERVAL '24 hours'
          AND period = 'request'
          AND (metadata->>'statusCode')::int >= 400
          ${j ? sql`AND metadata->>'jurisdiction' = ${j}` : sql``}
        ORDER BY recorded_at DESC
        LIMIT ${limit}
      `).catch(() => ({ rows: [] }));

      const errors = asArr(rows).map((r: Row) => ({
        id: String(r.id),
        ts: r.ts,
        route: r.route ?? null,
        method: r.method ?? null,
        statusCode: num(r.status_code),
        provider: r.provider ?? null,
        model: r.model ?? null,
        orgId: r.org_id ?? null,
        keyPrefix: r.key_prefix ?? null,
        jurisdiction: r.jurisdiction ?? null,
        latencyMs: num(r.latency_ms),
        error: r.error ?? null,
      }));

      res.json({
        errors,
        count: errors.length,
        jurisdiction: j ?? 'ALL',
        generatedAt: new Date().toISOString(),
      });
    } catch (err) {
      logger.error('[operations/recent-errors] failed', err);
      res.status(500).json({ error: sanitizeErrorForClient(err) });
    }
  },
);

// 8) GET /operations/throughput — analyst+
router.get(
  '/operations/throughput',
  authenticateToken,
  requireRole('analyst', 'admin', 'org_admin', 'super_admin'),
  async (req: Request, res: Response) => {
    try {
      const j = jurisdictionFilter(req);
      const [perMinuteRows, perHourRows] = await Promise.all([
        db.execute(sql`
          SELECT date_trunc('minute', recorded_at) AS bucket,
                 COUNT(*)::int                     AS rpm
          FROM sdk_usage_metering
          WHERE recorded_at >= NOW() - INTERVAL '60 minutes'
            AND period = 'request'
            ${j ? sql`AND metadata->>'jurisdiction' = ${j}` : sql``}
          GROUP BY bucket
          ORDER BY bucket ASC
        `).catch(() => ({ rows: [] })),
        db.execute(sql`
          SELECT date_trunc('hour', recorded_at)   AS bucket,
                 COUNT(*)::int                     AS rph
          FROM sdk_usage_metering
          WHERE recorded_at >= NOW() - INTERVAL '24 hours'
            AND period = 'request'
            ${j ? sql`AND metadata->>'jurisdiction' = ${j}` : sql``}
          GROUP BY bucket
          ORDER BY bucket ASC
        `).catch(() => ({ rows: [] })),
      ]);

      const perMinute = asArr(perMinuteRows).map((r: Row) => ({
        bucket: r.bucket, value: num(r.rpm),
      }));
      const perHour = asArr(perHourRows).map((r: Row) => ({
        bucket: r.bucket, value: num(r.rph),
      }));

      res.json({
        perMinute,
        perHour,
        jurisdiction: j ?? 'ALL',
        generatedAt: new Date().toISOString(),
      });
    } catch (err) {
      logger.error('[operations/throughput] failed', err);
      res.status(500).json({ error: sanitizeErrorForClient(err) });
    }
  },
);

// 9b) GET /cost/trend — super_admin; daily spend / requests, last N days (default 7)
router.get(
  '/cost/trend',
  authenticateToken,
  requireRole('super_admin'),
  async (req: Request, res: Response) => {
    try {
      const j = jurisdictionFilter(req);
      const days = Math.min(Math.max(parseInt((req.query.days as string) || '7', 10) || 7, 1), 90);
      const rows = await db.execute(sql`
        SELECT date_trunc('day', recorded_at)        AS day,
               COALESCE(SUM(cost_usd),0)::float8     AS usd,
               COALESCE(SUM(tokens_in + tokens_out),0)::bigint AS tokens,
               COUNT(*)::int                          AS requests
        FROM sdk_usage_metering
        WHERE recorded_at >= NOW() - (${days} || ' days')::interval
          AND period = 'request'
          AND (metadata->>'internal') IS NULL
          ${j ? sql`AND metadata->>'jurisdiction' = ${j}` : sql``}
        GROUP BY day
        ORDER BY day ASC
      `).catch(() => ({ rows: [] }));

      const series = asArr(rows).map((r: Row) => ({
        day: r.day,
        usd: num(r.usd),
        tokens: num(r.tokens),
        requests: num(r.requests),
      }));

      res.json({
        series,
        windowDays: days,
        jurisdiction: j ?? 'ALL',
        generatedAt: new Date().toISOString(),
      });
    } catch (err) {
      logger.error('[cost/trend] failed', err);
      res.status(500).json({ error: sanitizeErrorForClient(err) });
    }
  },
);

// 9) GET /cost/suggestions — super_admin
// Rule-based optimisation suggestions sourced from sdk_usage_metering metadata.
router.get(
  '/cost/suggestions',
  authenticateToken,
  requireRole('super_admin'),
  async (req: Request, res: Response) => {
    try {
      const j = jurisdictionFilter(req);
      const rows = await db.execute(sql`
        SELECT COALESCE(metadata->>'model','unknown')      AS model,
               COALESCE(metadata->>'provider','unknown')   AS provider,
               COALESCE(metadata->>'route','unknown')      AS route,
               COUNT(*)::int                                AS requests,
               COALESCE(SUM(cost_usd),0)::float8           AS usd,
               COALESCE(SUM(tokens_in),0)::bigint           AS tokens_in,
               COALESCE(SUM(tokens_out),0)::bigint          AS tokens_out
        FROM sdk_usage_metering
        WHERE recorded_at >= DATE_TRUNC('month', NOW())
          AND period = 'request'
          AND (metadata->>'internal') IS NULL
          ${j ? sql`AND metadata->>'jurisdiction' = ${j}` : sql``}
        GROUP BY metadata->>'model', metadata->>'provider', metadata->>'route'
        HAVING COUNT(*) > 0
        ORDER BY usd DESC
        LIMIT 50
      `).catch(() => ({ rows: [] }));

      interface Suggestion {
        id: string; route: string; currentModel: string; currentProvider: string;
        requests: number; currentSpendUsd: number;
        recommendedModel: string; estimatedSpendUsd: number;
        estimatedSavingUsd: number; savingPct: number; rationale: string;
      }
      const suggestions: Suggestion[] = [];
      for (const r of asArr(rows)) {
        const model = str(r.model, 'unknown');
        const route = str(r.route, '*');
        const provider = str(r.provider, 'unknown');
        const cheaper = suggestCheaperModel(model, num(r.tokens_in), num(r.tokens_out));
        if (!cheaper) continue;
        suggestions.push({
          id: `${route}:${model}`,
          route,
          currentModel: normalizeModel(model),
          currentProvider: provider,
          requests: num(r.requests),
          currentSpendUsd: num(r.usd),
          recommendedModel: cheaper.model,
          estimatedSpendUsd: cheaper.estCost,
          estimatedSavingUsd: Number((num(r.usd) * cheaper.savingPct / 100).toFixed(4)),
          savingPct: cheaper.savingPct,
          rationale: `${cheaper.savingPct}% of "${route}" calls use ${normalizeModel(model)} (${provider}). Switching to ${cheaper.model} would cut cost by ~${cheaper.savingPct}%.`,
        });
        if (suggestions.length >= 10) break;
      }

      // Always include a couple of structural suggestions so the page is not
      // empty before the price-based heuristic finds anything.
      if (suggestions.length < 3) {
        suggestions.push({
          id: 'structural:cache',
          route: '*',
          currentModel: '*',
          currentProvider: '*',
          requests: 0,
          currentSpendUsd: 0,
          recommendedModel: 'cache',
          estimatedSpendUsd: 0,
          estimatedSavingUsd: 0,
          savingPct: 0,
          rationale: 'Enable response cache for idempotent classify/summarize calls — typical 30-50% hit-rate on repeated prompts.',
        });
        suggestions.push({
          id: 'structural:batch',
          route: '*',
          currentModel: '*',
          currentProvider: '*',
          requests: 0,
          currentSpendUsd: 0,
          recommendedModel: 'batch',
          estimatedSpendUsd: 0,
          estimatedSavingUsd: 0,
          savingPct: 0,
          rationale: 'Batch ≤8 short prompts into a single completion to amortise per-request latency and overhead.',
        });
        suggestions.push({
          id: 'structural:flash',
          route: '*',
          currentModel: '*',
          currentProvider: '*',
          requests: 0,
          currentSpendUsd: 0,
          recommendedModel: 'gemini-2.5-flash',
          estimatedSpendUsd: 0,
          estimatedSavingUsd: 0,
          savingPct: 0,
          rationale: 'Default routine intelligence calls (classify / NER / sentiment) to gemini-2.5-flash — cheapest tier-1 model with sub-second latency.',
        });
      }

      void audit('ops.cost.suggestions.read', req as AuthRequest, {
        count: suggestions.length,
        jurisdiction: j ?? 'ALL',
      });
      res.json({
        suggestions: suggestions.slice(0, 10),
        jurisdiction: j ?? 'ALL',
        generatedAt: new Date().toISOString(),
      });
    } catch (err) {
      logger.error('[cost/suggestions] failed', err);
      res.status(500).json({ error: sanitizeErrorForClient(err) });
    }
  },
);

export default router;
