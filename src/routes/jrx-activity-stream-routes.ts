/**
 * NV Activity Stream Routes — Gap #4 backend (Session-15 v3)
 * ─────────────────────────────────────────────────────────────────────────────
 *  GET  /api/jrx/activity/stream       SSE — real-time per-org activity feed
 *  GET  /api/jrx/activity/recent       JSON — ring-buffer poll fallback
 *  GET  /api/jrx/activity/health       Always-on liveness probe
 *
 * Auth: JWT via `authenticateToken`. EventSource browsers can't set
 * Authorization headers, so the stream endpoint also accepts `?token=…`
 * (validated by the same `verifyToken` helper used by the middleware) — no
 * new header invented (NV-AUTH-HEADER-001 respected).
 *
 * Guardrails:
 *   - NV-ARCH-001: pure read of in-memory ring buffer / event-bus; no LLM.
 *   - NV-NAMING-001: grep `activity-stream` showed no existing file.
 *   - NV-LLM-001: not in LLM-emit path.
 *   - NV-API-CONTRACT-001: additive; never removes a route.
 */

import { Router, type Request, type Response } from 'express';
import jwt from 'jsonwebtoken';
import { sql } from 'drizzle-orm';
import { nvActivityEventBus, type SdkActivityEvent } from '../services/jrx-activity-event-bus.js';
import { authenticateToken } from '../middleware/jrx-auth.js';
import { db as rawDb } from '../db/index.js';
import { createLogger } from '../utils/logger.js';

const router = Router();
const logger = createLogger('./jrx-activity-stream');

const HEARTBEAT_MS = 25_000;
const JWT_SECRET = process.env.NYV_JWT_SECRET || process.env.JWT_SECRET || 'dev-secret';

interface JwtUserPayload {
  id?: string | number;
  orgId?: string;
  organization_id?: string;
  organizationId?: string;
  role?: string;
}

function decodeQueryToken(req: Request): JwtUserPayload | null {
  const token = (req.query.token as string) || '';
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as JwtUserPayload;
    return decoded || null;
  } catch {
    return null;
  }
}

router.get('/health', (_req: Request, res: Response) => {
  // Task #313 — surface batched DB-persistence health so ops can detect a
  // stuck flusher (queueDepth growing, circuit open) without reading logs.
  const persist = nvActivityEventBus.getPersistenceStats();
  res.json({
    status: 'ok',
    namespace: 'activity',
    version: 'v1',
    bufferRingCap: 200,
    uptimeS: Math.floor(process.uptime()),
    persistence: persist,
  });
});

// ─── Filter helpers (server-side narrowing for the live feed) ───────────────
interface ActivityFilter {
  method?: string;        // GET / POST / PUT / DELETE
  jurisdiction?: string;  // IN / US / EU / UK / SG / GC
  agent?: string;         // pattern_key / agentKey substring (ci)
  severity?: string;      // ok / redirect / clientError / serverError / blocked
  routeContains?: string; // free-text route substring
  eventType?: string;     // orchestrate | llm | guardrail | consent | audit | agent | rag | other
}

// Categorise an event by its route prefix into a small, demo-friendly set of
// event types. Mirrored on the client (see live-activity-feed.tsx) so server
// + client filtering stay in agreement. Returning a stable string makes this
// safe to expose as a query param.
const EVENT_TYPE_RULES: Array<[string, RegExp]> = [
  ['orchestrate', /^\/api\/nv\/orchestrate(\/|$)/],
  ['llm',         /^\/api\/nv\/(ai|llm)\//],
  ['guardrail',   /^\/api\/nv\/intelligence\/(hitl|hallucination|bias|safety)\//],
  ['consent',     /^\/api\/nv\/consent\//],
  ['audit',       /^\/api\/nv\/audit\//],
  ['agent',       /^\/api\/nv\/agent(s)?\//],
  ['rag',         /^\/api\/nv\/(rag|knowledge|km)\//],
  ['hitl',        /^\/api\/nv\/hitl\//],
  ['governance',  /^\/api\/nv\/governance\//],
  ['intel',       /^\/api\/nv\/intelligence\//],
];
export function deriveEventType(route: string): string {
  for (const [name, re] of EVENT_TYPE_RULES) if (re.test(route)) return name;
  return 'other';
}

function pickFilter(req: Request): ActivityFilter {
  const f: ActivityFilter = {};
  const get = (k: string): string | undefined => {
    const v = req.query[k];
    if (typeof v === 'string' && v.trim() && v !== 'all') return v.trim();
    return undefined;
  };
  f.method = get('method')?.toUpperCase();
  f.jurisdiction = get('jurisdiction')?.toUpperCase();
  f.agent = get('agent');
  f.severity = get('severity')?.toLowerCase();
  f.routeContains = get('route');
  f.eventType = get('eventType')?.toLowerCase();
  return f;
}

// JWT shape narrowed to the fields we actually consult — no `as any`.
interface SessionUser {
  id?: string;
  role?: string;
  orgId?: string;
  organization_id?: string;
  organizationId?: string;
}
// Express's `Request.user` (from passport types pulled in elsewhere) is widened
// across the codebase, so we narrow via intersection rather than `extends`.
type ReqWithUser = Request & { user?: SessionUser; routedAgent?: string };
function callerOrgId(req: Request): string {
  const u = (req as ReqWithUser).user;
  return String(u?.orgId ?? u?.organization_id ?? u?.organizationId ?? '_global');
}
function callerIsAdmin(req: Request): boolean {
  const role = String((req as ReqWithUser).user?.role ?? '').toLowerCase();
  return role === 'admin' || role === 'super_admin' || role === 'compliance_officer';
}

function severityOf(ev: SdkActivityEvent): string {
  const s = ev.status;
  if (s >= 500) return 'serverError';
  if (s >= 400) return 'clientError';
  if (s >= 300) return 'redirect';
  return 'ok';
}

function eventTypeOf(ev: SdkActivityEvent): string {
  return ev.eventType ?? deriveEventType(ev.route);
}

function applyFilter(events: SdkActivityEvent[], f: ActivityFilter): SdkActivityEvent[] {
  if (!f.method && !f.jurisdiction && !f.agent && !f.severity && !f.routeContains && !f.eventType) return events;
  const ag = f.agent?.toLowerCase();
  const rt = f.routeContains?.toLowerCase();
  return events.filter(ev => {
    if (f.method && ev.method !== f.method) return false;
    if (f.jurisdiction && (ev.jurisdiction ?? '') !== f.jurisdiction) return false;
    if (ag) {
      const hay = (`${ev.agent ?? ''} ${ev.scope ?? ''} ${ev.platformCode ?? ''}`).toLowerCase();
      if (!hay.includes(ag)) return false;
    }
    if (f.severity && severityOf(ev) !== f.severity) return false;
    if (rt && !ev.route.toLowerCase().includes(rt)) return false;
    if (f.eventType && eventTypeOf(ev) !== f.eventType) return false;
    return true;
  });
}

// Project an `nv_schema.ai_activity` row into the SdkActivityEvent shape so
// the Live Activity Feed can render historical events when the in-memory ring
// buffer is empty (fresh restart) or below the requested page size.
interface AiActivityRow {
  trace_id: string | null;
  user_id: string | null;
  jurisdiction: string | null;
  pattern_key: string | null;
  route: string | null;
  blocked: boolean | null;
  model_provider: string | null;
  model_name: string | null;
  tokens_used: number | null;
  latency_ms: number | null;
  created_at: Date | string;
}
function aiActivityRowToEvent(row: AiActivityRow): SdkActivityEvent {
  const ts = row.created_at instanceof Date ? row.created_at.getTime() : Date.parse(String(row.created_at));
  const route = String(row.route ?? '/api/jrx/');
  return {
    orgId: String(row.user_id ?? '_global'),
    requestId: String(row.trace_id ?? ''),
    ts: Number.isFinite(ts) ? ts : Date.now(),
    method: /\/(stream|sse|chat)/.test(route) ? 'GET' : 'POST',
    route,
    status: row.blocked ? 451 : 200,
    ms: Number(row.latency_ms ?? 0),
    sdkKeyPrefix: row.pattern_key ? String(row.pattern_key).slice(0, 8) : null,
    platformCode: row.model_provider ?? null,
    scope: row.pattern_key ?? null,
    userAgent: null,
    jurisdiction: row.jurisdiction ?? null,
    agent: row.pattern_key ?? null,
    eventType: deriveEventType(route),
  };
}

// SECURITY: NV-ARCH-001 — DB fallback MUST be org-scoped to prevent cross-tenant
// activity leaks. Rules:
//   1. Caller's own org (matched against `user_id` which the publisher persists
//      from `req.sdkContext.orgId`) is always visible.
//   2. Rows tagged `_global` are intentional shared/demo seed data (Task #301
//      backfill) — visible to everyone, never contains PII per the seed contract.
//   3. Admin / super_admin / compliance_officer roles see the full firehose
//      (parity with /governance read paths) — controlled by `callerIsAdmin`.
async function loadFromDb(limit: number, f: ActivityFilter, orgId: string, isAdmin: boolean): Promise<SdkActivityEvent[]> {
  if (!rawDb) return [];
  const lim = Math.max(1, Math.min(500, limit));
  try {
    const orgPredicate = isAdmin
      ? sql`TRUE`
      : sql`(user_id = ${orgId} OR user_id = '_global')`;
    const eventTypeRoute = (() => {
      if (!f.eventType) return null;
      const rule = EVENT_TYPE_RULES.find(([n]) => n === f.eventType);
      return rule ? rule[1].source.replace(/^\^/, '').replace(/\\\//g, '/') : null;
    })();
    const r = await rawDb.execute(sql`
      SELECT trace_id, user_id, jurisdiction, pattern_key, route,
             blocked, model_provider, model_name,
             tokens_used, latency_ms, created_at
      FROM nv_schema.ai_activity
      WHERE ${orgPredicate}
        AND (${f.jurisdiction ?? null}::text IS NULL OR jurisdiction = ${f.jurisdiction ?? null})
        AND (${f.agent ?? null}::text IS NULL OR pattern_key ILIKE '%' || ${f.agent ?? null} || '%')
        AND (${f.routeContains ?? null}::text IS NULL OR route ILIKE '%' || ${f.routeContains ?? null} || '%')
        AND (${eventTypeRoute}::text IS NULL OR route ~ ${eventTypeRoute})
      ORDER BY created_at DESC
      LIMIT ${lim}
    `);
    const rows: AiActivityRow[] = (((r as unknown) as { rows?: AiActivityRow[] }).rows ?? []);
    return rows.map(aiActivityRowToEvent);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.warn('activity_recent_db_fallback_failed', { err: msg });
    return [];
  }
}

router.get('/recent', authenticateToken, async (req: Request, res: Response) => {
  const orgId = callerOrgId(req);
  const isAdmin = callerIsAdmin(req);
  const limit = Math.max(1, Math.min(200, parseInt((req.query.limit as string) || '50', 10)));
  const filter = pickFilter(req);

  // 1) In-memory ring buffer first (truly live, already org-scoped by the bus).
  const live = applyFilter(nvActivityEventBus.recent(orgId, 200), filter);

  // 2) DB fallback to fill the page from nv_schema.ai_activity (historical).
  //    Org-scoped query — see loadFromDb security note.
  let merged: SdkActivityEvent[] = live.slice(0, limit);
  let source: 'memory' | 'memory+db' | 'db' = 'memory';
  if (merged.length < limit) {
    const dbRows = await loadFromDb(limit - merged.length + 25, filter, orgId, isAdmin);
    if (dbRows.length) {
      const seen = new Set(merged.map(e => `${e.requestId}-${e.ts}`));
      const extra = dbRows.filter(e => !seen.has(`${e.requestId}-${e.ts}`));
      merged = merged.concat(extra).slice(0, limit);
      source = live.length === 0 ? 'db' : 'memory+db';
    }
  }

  res.json({ success: true, data: { orgId, events: merged, count: merged.length, source, filter } });
});

router.get('/stream', (req: Request, res: Response) => {
  const headerUser = (req as Request & { user?: JwtUserPayload }).user;
  const queryUser = headerUser ? null : decodeQueryToken(req);
  const user = headerUser ?? queryUser;
  if (!user) {
    res.status(401).json({ success: false, message: 'Access token required', code: 'AUTH_TOKEN_MISSING' });
    return;
  }
  const orgId = String(user.orgId ?? user.organization_id ?? user.organizationId ?? '_global');

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  res.write(`event: hello\ndata: ${JSON.stringify({ orgId, ts: Date.now() })}\n\n`);
  for (const ev of nvActivityEventBus.recent(orgId, 25).reverse()) {
    res.write(`event: activity\ndata: ${JSON.stringify(ev)}\n\n`);
  }

  const send = (ev: unknown) => {
    try { res.write(`event: activity\ndata: ${JSON.stringify(ev)}\n\n`); } catch { /* ignore */ }
  };
  const unsub = nvActivityEventBus.subscribe(orgId, send);

  const heartbeat = setInterval(() => {
    try { res.write(`event: heartbeat\ndata: ${JSON.stringify({ ts: Date.now() })}\n\n`); } catch { /* ignore */ }
  }, HEARTBEAT_MS);

  const cleanup = () => { try { unsub(); } catch { /* ignore */ } clearInterval(heartbeat); try { res.end(); } catch { /* ignore */ } };
  req.on('close', cleanup);
  req.on('aborted', cleanup);
});

export default router;
