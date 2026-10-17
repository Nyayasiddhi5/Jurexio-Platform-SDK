#!/usr/bin/env node
/**
 * NV-PILOT-COST-METRICS-001 — Phase-0 cost pilot sample (cache hit + Queen share).
 *
 * Usage:
 *   DATABASE_URL=postgres://... npm run pilot:cost-metrics
 *   npm run pilot:cost-metrics -- --days=7
 *
 * Reads (no secrets):
 *   - sdk_usage_metering (period=request): cache token columns + provider metadata
 *   - nv_router_decisions: model tier mix, LLM call volume
 *   - sdk_usage_metering metadata.provider = queen-orchestrator vs direct LLM
 *
 * Does not call LLM APIs. Safe for prod RDS read-only when DATABASE_URL is set.
 */

import { makePgSql } from './_pg-pool.js';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  }),
);
const DAYS = Math.max(1, parseInt(String(args.days ?? '7'), 10));

const sql = await makePgSql();

console.log(`[pilot:cost-metrics] window=${DAYS}d`);

const since = `${DAYS} days`;

const usageRows = await sql`
  SELECT
    COUNT(*)::int AS requests,
    COALESCE(SUM(tokens_in), 0)::bigint AS tokens_in,
    COALESCE(SUM(tokens_out), 0)::bigint AS tokens_out,
    COALESCE(SUM(tokens_cache_read), 0)::bigint AS cache_read,
    COALESCE(SUM(tokens_cache_write), 0)::bigint AS cache_write,
    COALESCE(SUM(cost_usd), 0)::float AS cost_usd
  FROM sdk_usage_metering
  WHERE period = 'request'
    AND recorded_at >= NOW() - (${since})::interval
    AND COALESCE((metadata->>'internal')::boolean, false) = false
`;

const u = usageRows[0] ?? {};
const billableInput =
  Number(u.tokens_in ?? 0) + Number(u.cache_read ?? 0) + Number(u.cache_write ?? 0);
const cacheHitRate =
  billableInput > 0 ? Number(u.cache_read ?? 0) / billableInput : 0;

const queenRows = await sql`
  SELECT COUNT(*)::int AS n
  FROM sdk_usage_metering
  WHERE period = 'request'
    AND recorded_at >= NOW() - (${since})::interval
    AND COALESCE((metadata->>'internal')::boolean, false) = false
    AND (
      metadata->>'provider' = 'queen-orchestrator'
      OR agent_id ILIKE '%queen%'
    )
`;

const queenN = queenRows[0]?.n ?? 0;
const queenShare = u.requests > 0 ? queenN / u.requests : 0;

const routerRows = await sql`
  SELECT
    picked_model_id AS model,
    COUNT(*)::int AS calls,
    COALESCE(SUM(tokens_in), 0)::bigint AS tokens_in,
    COALESCE(SUM(cost_usd), 0)::float AS cost_usd
  FROM nv_router_decisions
  WHERE ts >= NOW() - (${since})::interval
    AND ok = true
  GROUP BY picked_model_id
  ORDER BY calls DESC
  LIMIT 15
`;

console.log('\n--- Usage metering (external /api/nv/* requests) ---');
console.log(JSON.stringify({
  requests: u.requests,
  tokensInNonCache: Number(u.tokens_in ?? 0),
  tokensCacheRead: Number(u.cache_read ?? 0),
  tokensCacheWrite: Number(u.cache_write ?? 0),
  tokensOut: Number(u.tokens_out ?? 0),
  costUsd: Number(u.cost_usd ?? 0),
  cacheReadShareOfBillableInput: Math.round(cacheHitRate * 1000) / 1000,
  queenOrchestratedRequests: queenN,
  queenShareOfMeteredRequests: Math.round(queenShare * 1000) / 1000,
}, null, 2));

console.log('\n--- Top router models (nv_router_decisions) ---');
console.log(JSON.stringify(routerRows, null, 2));

console.log('\n[pilot:cost-metrics] Phase-0 gates (targets from NYV-DEPLOYMENT-COST-PLAN):');
console.log(`  cache read share >= 0.08? ${cacheHitRate >= 0.08 ? 'PASS' : 'FAIL'} (${(cacheHitRate * 100).toFixed(1)}%)`);
console.log(`  queen share <= 0.08? ${queenShare <= 0.08 ? 'PASS' : 'FAIL'} (${(queenShare * 100).toFixed(1)}%)`);

await sql.end();
