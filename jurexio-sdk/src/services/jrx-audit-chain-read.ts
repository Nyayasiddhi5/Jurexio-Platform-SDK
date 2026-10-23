/**
 * Unified audit-chain read layer (2026-06-16).
 *
 * Live NSP / orchestration traffic is persisted to:
 *   • nv_schema.nv_audit_logs  — hash-chained events (appendAuditRecord)
 *   • public.sdk_api_request_logs — per-request SDK metering (writeAuditLog)
 *
 * The audit-chain UI previously read only nv_pattern_audit_log (demo seed table),
 * which stays empty on EC2 when partners exercise real SDK routes. This module
 * merges the live sources for list/detail endpoints.
 */
import { sql } from 'drizzle-orm';
import { createHash } from 'crypto';
import { db as _rawDb } from '../db/index.js';
import { lazyRequire } from '../utils/jrx-type-helpers.js';

const db = lazyRequire(() => _rawDb, 'db');

export type AuditChainRecord = {
  id: string | number;
  orgId?: string | null;
  sdkKey?: string | null;
  agentId?: string | null;
  jurisdiction?: string | null;
  pattern?: string | null;
  eventType?: string | null;
  route?: string | null;
  method?: string | null;
  statusCode?: number | null;
  model?: string | null;
  provider?: string | null;
  latencyMs?: number | null;
  tokensUsed?: number | null;
  tokensIn?: number | null;
  tokensOut?: number | null;
  riskScore?: number | null;
  riskBadge?: string | null;
  blocked?: boolean | null;
  traceId?: string | null;
  requestId?: string | null;
  inputHash?: string | null;
  outputHash?: string | null;
  previousHash?: string | null;
  recordHash?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt?: string | Date | null;
  source?: 'hash_chain' | 'sdk_log' | 'pattern_log';
};

function rowsOf(r: unknown): any[] {
  return ((r as any)?.rows ?? r ?? []) as any[];
}

// ── Tenant-scope resolution (NV-AUDIT-TENANT-SCOPE-001) ─────────────────────
// Canonical authority for "which org may this caller read?" for /api/jrx/audit.
// Only super_admins may read across orgs (explicit orgId or null = all-orgs
// rollup). EVERY other caller — including admin / platform_admin / org_admin —
// is hard-scoped to their OWN org, so cross-tenant audit rows can never leak.
export interface AuditCallerContext {
  role?: string | null;
  organizationId?: string | number | null;
  orgId?: string | number | null;
  tenantId?: string | number | null;
  org_id?: string | number | null;
}

export type AuditReadScope =
  | { ok: true; effectiveOrg: string | null; allOrgs: boolean }
  | { ok: false; status: number; error: string };

function normOrg(v: string | number | null | undefined): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
}

/**
 * Resolve the org an audit-chain read is allowed to target.
 *
 * @param caller          The authenticated principal (req.user).
 * @param requestedOrgId  An optional ?orgId= the caller asked for.
 *
 * Policy:
 *   • super_admin → may target an explicit org, or pass null for the all-orgs
 *     rollup (effectiveOrg === null).
 *   • everyone else → forced to their OWN org. A session with no org claim is
 *     rejected; a requestedOrgId that differs from the caller's own org is
 *     denied (never silently honoured) so cross-tenant reads cannot leak.
 */
export function resolveAuditReadScope(
  caller: AuditCallerContext | null | undefined,
  requestedOrgId?: string | null,
): AuditReadScope {
  const u = caller ?? {};
  const role = String(u.role ?? 'guest');
  const callerOrg = normOrg(u.organizationId ?? u.orgId ?? u.tenantId ?? u.org_id ?? null);
  const requestedOrg = normOrg(requestedOrgId ?? null);

  if (role === 'super_admin') {
    return { ok: true, effectiveOrg: requestedOrg, allOrgs: requestedOrg === null };
  }

  if (!callerOrg) {
    return { ok: false, status: 403, error: 'Audit chain requires an org-scoped session.' };
  }
  if (requestedOrg && requestedOrg !== callerOrg) {
    return { ok: false, status: 403, error: 'Cross-tenant audit chain reads are not permitted.' };
  }
  return { ok: true, effectiveOrg: callerOrg, allOrgs: false };
}

function parsePayload(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) as Record<string, unknown>; } catch { return {}; }
  }
  if (typeof raw === 'object') return raw as Record<string, unknown>;
  return {};
}

function pickStr(payload: Record<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = payload[k];
    if (v != null && String(v).length > 0) return String(v);
  }
  return null;
}

function pickNum(payload: Record<string, unknown>, ...keys: string[]): number | null {
  for (const k of keys) {
    const v = payload[k];
    if (v == null) continue;
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

export function shapeHashChainRow(r: any): AuditChainRecord {
  const payload = parsePayload(r.payload ?? r.metadata);
  const eventType = r.event_type ?? r.pattern ?? null;
  const methodFromEvent = typeof eventType === 'string' && eventType.includes(':')
    ? eventType.split(':')[1]
    : null;
  const statusFromEvent = typeof eventType === 'string' && eventType.includes(':')
    ? Number(eventType.split(':').pop())
    : null;

  return {
    id: r.id,
    orgId: r.org_id ?? pickStr(payload, 'orgId', 'org_id', 'tenantId'),
    sdkKey: r.sdk_key ?? pickStr(payload, 'appId', 'raw_app_id', 'sdkKey'),
    agentId: r.agent_id ?? pickStr(payload, 'agentKey', 'agentId', 'agent_key'),
    jurisdiction: r.jurisdiction ?? pickStr(payload, 'jurisdiction'),
    pattern: r.pattern ?? eventType,
    eventType,
    route: r.route ?? pickStr(payload, 'route', 'endpoint'),
    method: r.method ?? pickStr(payload, 'method') ?? methodFromEvent,
    statusCode: r.status_code ?? pickNum(payload, 'statusCode', 'status_code') ?? (Number.isFinite(statusFromEvent!) ? statusFromEvent : null),
    model: r.model ?? pickStr(payload, 'model', 'picked_model_id'),
    provider: r.provider ?? pickStr(payload, 'provider', 'picked_provider'),
    latencyMs: r.latency_ms ?? pickNum(payload, 'latencyMs', 'latency_ms'),
    tokensUsed: r.tokens_used ?? pickNum(payload, 'tokensUsed', 'tokens_used'),
    tokensIn: r.tokens_in ?? pickNum(payload, 'tokensIn', 'tokens_in'),
    tokensOut: r.tokens_out ?? pickNum(payload, 'tokensOut', 'tokens_out'),
    riskScore: r.risk_score ?? pickNum(payload, 'riskScore'),
    riskBadge: r.risk_badge ?? pickStr(payload, 'riskBadge'),
    blocked: r.blocked ?? (eventType?.includes('block') ? true : null),
    traceId: r.trace_id ?? pickStr(payload, 'traceId', 'trace_id', 'requestId', 'request_id'),
    requestId: r.request_id ?? pickStr(payload, 'requestId', 'request_id'),
    inputHash: r.input_hash ?? pickStr(payload, 'inputHash', 'input_hash'),
    outputHash: r.output_hash ?? pickStr(payload, 'outputHash', 'output_hash'),
    previousHash: r.prev_hash ?? r.previous_hash ?? null,
    recordHash: r.record_hash ?? null,
    metadata: payload,
    createdAt: r.created_at,
    source: r.source ?? 'hash_chain',
  };
}

function orgMatchPayloadSql(effectiveOrg: string | null) {
  return sql`(
    ${effectiveOrg}::text IS NULL
    OR payload->>'orgId' = ${effectiveOrg}
    OR payload->>'org_id' = ${effectiveOrg}
    OR payload->>'tenantId' = ${effectiveOrg}
  )`;
}

function jurMatchPayloadSql(jurisdiction: string | null) {
  return sql`(
    ${jurisdiction}::text IS NULL
    OR payload->>'jurisdiction' = ${jurisdiction}
  )`;
}

export async function fetchAuditChainRecords(opts: {
  limit: number;
  offset: number;
  effectiveOrg: string | null;
  jurisdiction: string | null;
}): Promise<{ records: AuditChainRecord[]; total: number }> {
  const { limit, offset, effectiveOrg, jurisdiction } = opts;

  const hashRows = await db.execute(sql`
    SELECT
      id::text,
      event_type,
      payload,
      previous_hash,
      record_hash,
      created_at,
      payload->>'traceId'       AS trace_id,
      payload->>'requestId'     AS request_id,
      COALESCE(payload->>'agentKey', payload->>'agentId') AS agent_id,
      COALESCE(payload->>'appId', payload->>'raw_app_id') AS sdk_key,
      COALESCE(payload->>'orgId', payload->>'org_id') AS org_id,
      payload->>'jurisdiction'  AS jurisdiction,
      payload->>'route'         AS route,
      payload->>'method'        AS method,
      NULL::int                 AS status_code,
      payload->>'model'         AS model,
      payload->>'provider'      AS provider,
      (payload->>'latencyMs')::int AS latency_ms,
      (payload->>'tokensUsed')::int AS tokens_used,
      payload->>'inputHash'     AS input_hash,
      payload->>'outputHash'     AS output_hash,
      'hash_chain'::text        AS source
    FROM nv_schema.nv_audit_logs
    WHERE ${orgMatchPayloadSql(effectiveOrg)}
      AND ${jurMatchPayloadSql(jurisdiction)}
    ORDER BY created_at DESC, id DESC
    LIMIT ${limit + offset}
  `).catch(() => ({ rows: [] }));

  const sdkRows = await db.execute(sql`
    SELECT
      ('sdk-' || id::text)      AS id,
      'sdk.api.request'         AS event_type,
      metadata                  AS payload,
      NULL::text                AS previous_hash,
      NULL::text                AS record_hash,
      created_at,
      request_id                AS trace_id,
      request_id,
      metadata->>'raw_app_id'   AS sdk_key,
      metadata->>'org_id'       AS org_id,
      NULL::text                AS agent_id,
      NULL::text                AS jurisdiction,
      endpoint                  AS route,
      method,
      status_code,
      NULL::text                AS model,
      NULL::text                AS provider,
      latency_ms,
      COALESCE(tokens_in, 0) + COALESCE(tokens_out, 0) AS tokens_used,
      NULL::text                AS input_hash,
      NULL::text                AS output_hash,
      'sdk_log'::text           AS source
    FROM public.sdk_api_request_logs
    WHERE (${effectiveOrg}::text IS NULL OR metadata->>'org_id' = ${effectiveOrg})
      AND (${jurisdiction}::text IS NULL OR metadata->>'jurisdiction' = ${jurisdiction})
    ORDER BY created_at DESC
    LIMIT ${Math.max(limit, 50)}
  `).catch(() => ({ rows: [] }));

  const patternRows = await db.execute(sql`
    SELECT
      id::text,
      pattern                   AS event_type,
      metadata                  AS payload,
      prev_hash                 AS previous_hash,
      record_hash,
      created_at,
      trace_id,
      request_id,
      agent_id,
      sdk_key,
      org_id,
      jurisdiction,
      route,
      method,
      status_code,
      model,
      provider,
      latency_ms,
      tokens_used,
      input_hash,
      output_hash,
      'pattern_log'::text       AS source
    FROM nv_pattern_audit_log
    WHERE (${effectiveOrg}::text IS NULL OR org_id = ${effectiveOrg})
      AND (${jurisdiction}::text IS NULL OR jurisdiction = ${jurisdiction})
    ORDER BY created_at DESC
    LIMIT ${Math.max(limit, 50)}
  `).catch(() => ({ rows: [] }));

  const merged = [
    ...rowsOf(hashRows),
    ...rowsOf(sdkRows),
    ...rowsOf(patternRows),
  ]
    .map(shapeHashChainRow)
    .sort((a, b) => {
      const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return tb - ta;
    });

  const deduped: AuditChainRecord[] = [];
  const seen = new Set<string>();
  for (const row of merged) {
    const key = `${row.traceId ?? ''}|${row.route ?? ''}|${row.eventType ?? ''}|${row.createdAt ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(row);
  }

  const page = deduped.slice(offset, offset + limit);

  const countRes = await db.execute(sql`
    SELECT (
      (SELECT COUNT(*)::int FROM nv_schema.nv_audit_logs
        WHERE ${orgMatchPayloadSql(effectiveOrg)} AND ${jurMatchPayloadSql(jurisdiction)})
      +
      (SELECT COUNT(*)::int FROM public.sdk_api_request_logs
        WHERE (${effectiveOrg}::text IS NULL OR metadata->>'org_id' = ${effectiveOrg})
          AND (${jurisdiction}::text IS NULL OR metadata->>'jurisdiction' = ${jurisdiction}))
      +
      (SELECT COUNT(*)::int FROM nv_pattern_audit_log
        WHERE (${effectiveOrg}::text IS NULL OR org_id = ${effectiveOrg})
          AND (${jurisdiction}::text IS NULL OR jurisdiction = ${jurisdiction}))
    ) AS total
  `).catch(() => ({ rows: [{ total: deduped.length }] }));

  const total = Number(rowsOf(countRes)[0]?.total ?? deduped.length);
  return { records: page, total };
}

export async function fetchAuditChainRecordById(id: string): Promise<AuditChainRecord | null> {
  if (id.startsWith('sdk-')) {
    const sdkId = id.slice(4);
    const r = await db.execute(sql`
      SELECT
        ('sdk-' || id::text) AS id,
        'sdk.api.request' AS event_type,
        metadata AS payload,
        NULL::text AS previous_hash,
        NULL::text AS record_hash,
        created_at,
        request_id AS trace_id,
        request_id,
        metadata->>'raw_app_id' AS sdk_key,
        metadata->>'org_id' AS org_id,
        endpoint AS route,
        method,
        status_code,
        latency_ms,
        COALESCE(tokens_in, 0) + COALESCE(tokens_out, 0) AS tokens_used,
        'sdk_log'::text AS source
      FROM public.sdk_api_request_logs WHERE id = ${sdkId}::int LIMIT 1
    `).catch(() => ({ rows: [] }));
    const row = rowsOf(r)[0];
    return row ? shapeHashChainRow(row) : null;
  }

  const hash = await db.execute(sql`
    SELECT
      id::text, event_type, payload, previous_hash, record_hash, created_at,
      payload->>'traceId' AS trace_id,
      payload->>'requestId' AS request_id,
      COALESCE(payload->>'agentKey', payload->>'agentId') AS agent_id,
      COALESCE(payload->>'appId', payload->>'raw_app_id') AS sdk_key,
      COALESCE(payload->>'orgId', payload->>'org_id') AS org_id,
      payload->>'jurisdiction' AS jurisdiction,
      payload->>'route' AS route,
      payload->>'method' AS method,
      payload->>'model' AS model,
      payload->>'provider' AS provider,
      (payload->>'latencyMs')::int AS latency_ms,
      (payload->>'tokensUsed')::int AS tokens_used,
      payload->>'inputHash' AS input_hash,
      payload->>'outputHash' AS output_hash,
      'hash_chain'::text AS source
    FROM nv_schema.nv_audit_logs WHERE id::text = ${id} LIMIT 1
  `).catch(() => ({ rows: [] }));
  if (rowsOf(hash)[0]) return shapeHashChainRow(rowsOf(hash)[0]);

  const pattern = await db.execute(sql`
    SELECT id::text, pattern AS event_type, metadata AS payload,
           prev_hash AS previous_hash, record_hash, created_at,
           trace_id, request_id, agent_id, sdk_key, org_id, jurisdiction,
           route, method, status_code, model, provider, latency_ms,
           tokens_used, input_hash, output_hash,
           'pattern_log'::text AS source
    FROM nv_pattern_audit_log WHERE id::text = ${id} LIMIT 1
  `).catch(() => ({ rows: [] }));
  const prow = rowsOf(pattern)[0];
  return prow ? shapeHashChainRow(prow) : null;
}

/** Verify nv_schema hash-chain row using the same canonical formula as appendAuditRecord. */
export function verifyHashChainRecord(row: {
  id: string;
  previousHash?: string | null;
  recordHash?: string | null;
  eventType?: string | null;
  payload?: unknown;
  createdAt?: string | Date | null;
}): { verified: boolean; expectedHash: string } {
  const payload = row.payload ?? {};
  const canonicalPayload = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const createdAt = row.createdAt instanceof Date
    ? row.createdAt.toISOString()
    : String(row.createdAt ?? '');
  const expectedHash = createHash('sha256')
    .update(`${row.id}\x00${row.previousHash ?? ''}\x00${row.eventType ?? ''}\x00${canonicalPayload}\x00${createdAt}`)
    .digest('hex');
  return { verified: expectedHash === row.recordHash, expectedHash };
}
