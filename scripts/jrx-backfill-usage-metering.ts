#!/usr/bin/env node
/**
 * nv-backfill-usage-metering.mjs — Task #302
 *
 * Seeds public.sdk_usage_metering with rows synthesised from existing
 * audit/decision sources so the Cost Optimizer + Operations Hub have
 * meaningful data on first paint, before any new SDK traffic flows
 * through nv-usage-metering-middleware.
 *
 * Sources (in order of preference):
 *   1. nv_router_decisions  (canonical: provider, model, cost_usd, tokens)
 *   2. sdk_api_request_logs (gateway request log; if present)
 *   3. nv_audit_logs        (last-resort: count + latency for activity proxy)
 *
 * Idempotent: skips backfill if sdk_usage_metering already has > 100
 * `period='request'` rows, or if the synthesised metadata.id was already
 * inserted (matches on metadata->>'backfillSource' + ->>'sourceId').
 *
 * NV-DB-SCRIPT-001: uses makePgSql() (node-postgres pool) — the neon HTTP
 * driver silently drops writes off-Neon.
 *
 * Run: node scripts/jrx-backfill-usage-metering.mjs [--days=7] [--max=2000] [--dry]
 */

import { makePgSql } from './_pg-pool.js';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  }),
);
const DAYS = parseInt(args.days ?? '7', 10);
const MAX_ROWS = parseInt(args.max ?? '2000', 10);
const DRY = !!args.dry;

const sql = await makePgSql();

console.log(`[backfill] window=${DAYS}d  max=${MAX_ROWS}  dry=${DRY}`);

// 1) Idempotency check.
const existing = await sql`
  SELECT COUNT(*)::int AS n
  FROM sdk_usage_metering
  WHERE period = 'request'
    AND recorded_at >= NOW() - (${DAYS} || ' days')::interval
`;
const existingN = existing?.[0]?.n ?? 0;
if (existingN > 100) {
  console.log(`[backfill] skip: ${existingN} request-period rows already present in window`);
  process.exit(0);
}

// 2) Try nv_router_decisions first (real schema: no org_id/route columns;
//    those are extracted from the `meta` jsonb when present).
interface DecisionRow {
  source_id: string; provider: string; model: string; cost_usd: number;
  tokens_in: number; tokens_out: number; latency_ms: number;
  org_id: string | null; jurisdiction: string; route: string;
  ok: boolean; recorded_at: string;
}
let decisions: DecisionRow[] = [];
try {
  decisions = await sql`
    SELECT id::text                                    AS source_id,
           COALESCE(picked_provider,'unknown')         AS provider,
           COALESCE(picked_model_id,'unknown')         AS model,
           COALESCE(cost_usd, 0)::float8                AS cost_usd,
           COALESCE(tokens_in, 0)                       AS tokens_in,
           COALESCE(tokens_out, 0)                      AS tokens_out,
           COALESCE(latency_ms, 0)                      AS latency_ms,
           COALESCE(meta->>'orgId', meta->>'organizationId') AS org_id,
           COALESCE(jurisdiction, meta->>'jurisdiction', 'IN') AS jurisdiction,
           COALESCE(meta->>'route', '/api/jrx/orchestrate')      AS route,
           COALESCE(ok, true)                           AS ok,
           ts                                           AS recorded_at
    FROM nv_router_decisions
    WHERE ts >= NOW() - (${DAYS} || ' days')::interval
    ORDER BY ts DESC
    LIMIT ${MAX_ROWS}
  `;
} catch (e) {
  console.warn(`[backfill] nv_router_decisions unavailable: ${(e instanceof Error ? e.message : String(e))}`);
}

// 3) Fallback to nv_sdk_usage_metrics (real schema: app_id, endpoint, method,
//    status_code, tokens, latency, cost, recorded_at).
if (decisions.length === 0) {
  try {
    decisions = await sql`
      SELECT id::text                              AS source_id,
             'unknown'                             AS provider,
             'unknown'                             AS model,
             COALESCE(cost_usd, 0)::float8         AS cost_usd,
             COALESCE(tokens_in, 0)                AS tokens_in,
             COALESCE(tokens_out, 0)               AS tokens_out,
             COALESCE(latency_ms, 0)               AS latency_ms,
             NULL                                  AS org_id,
             'IN'                                  AS jurisdiction,
             COALESCE(endpoint, '/api/jrx/sdk')     AS route,
             (COALESCE(status_code, 200) < 400)    AS ok,
             recorded_at                           AS recorded_at
      FROM nv_sdk_usage_metrics
      WHERE recorded_at >= NOW() - (${DAYS} || ' days')::interval
      ORDER BY recorded_at DESC
      LIMIT ${MAX_ROWS}
    `;
    console.log(`[backfill] fallback: ${decisions.length} rows from nv_sdk_usage_metrics`);
  } catch (e) {
    console.warn(`[backfill] nv_sdk_usage_metrics unavailable: ${(e instanceof Error ? e.message : String(e))}`);
  }
}

console.log(`[backfill] ${decisions.length} candidate rows ready for insert`);

if (decisions.length === 0) {
  console.log('[backfill] nothing to backfill — exiting');
  process.exit(0);
}

if (DRY) {
  console.log('[backfill] DRY RUN — first 3 candidate rows:');
  console.log(JSON.stringify(decisions.slice(0, 3), null, 2));
  process.exit(0);
}

let inserted = 0, skipped = 0;
for (const r of decisions) {
  try {
    const metadata = {
      backfillSource: 'nv_router_decisions',
      sourceId: r.source_id,
      orgId: r.org_id,
      provider: r.provider,
      model: r.model,
      latencyMs: r.latency_ms,
      route: r.route,
      method: 'POST',
      statusCode: r.ok === false ? 500 : 200,
      jurisdiction: r.jurisdiction,
      sdkKeyPrefix: 'backfill',
      ts: r.recorded_at,
    };
    const dup = await sql`
      SELECT 1 FROM sdk_usage_metering
      WHERE period = 'request'
        AND metadata->>'backfillSource' = 'nv_router_decisions'
        AND metadata->>'sourceId' = ${r.source_id}
      LIMIT 1
    `;
    if (dup.length > 0) { skipped++; continue; }

    await sql`
      INSERT INTO sdk_usage_metering (
        application_id, agent_id, tokens_in, tokens_out, cost_usd,
        period, request_count, metadata, recorded_at
      ) VALUES (
        NULL, NULL, ${r.tokens_in}, ${r.tokens_out}, ${r.cost_usd},
        'request', 1, ${JSON.stringify(metadata)}::jsonb, ${r.recorded_at}
      )
    `;
    inserted++;
  } catch (e) {
    console.warn(`[backfill] row failed (${r.source_id}): ${(e instanceof Error ? e.message : String(e))}`);
  }
}

console.log(`[backfill] DONE — inserted=${inserted} skipped=${skipped}`);
process.exit(0);
