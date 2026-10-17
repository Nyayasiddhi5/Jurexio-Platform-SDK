/**
 * Console demo seed — idempotent backfill for admin dashboard KPIs.
 * DPDPA consent rows are seeded by nvPolicyEngine.bootstrap(); this module
 * seeds nv_schema.nv_agent_metrics so ROMA L5 admin reports meta.source=db.
 */
import { sql } from 'drizzle-orm';
import { db as _rawDb } from '../db/index.js';
import { lazyRequire } from '../utils/jrx-type-helpers.js';
import { createLogger } from '../utils/logger.js';
import { getAllAgents } from './agent-registry-service.js';

const db = lazyRequire(() => _rawDb, 'db');
const logger = createLogger('console-demo-seed');

let _bootstrapped = false;

/** NV-SCHEMA-ENSURE-001: nv_app has DML on nv_agent_metrics but not CREATE on nv_schema. */
async function agentMetricsTableReady(): Promise<boolean> {
  if (!db) return false;
  try {
    await db.execute(sql`SELECT 1 FROM nv_schema.nv_agent_metrics LIMIT 1`);
    return true;
  } catch {
    return false;
  }
}

/** Idempotent: populate nv_agent_metrics when the table is empty or stale. */
export async function backfillAgentMetricsIfSparse(): Promise<number> {
  if (!db) return 0;
  const countRes: any = await db.execute(sql`
    SELECT COUNT(*)::int AS n
    FROM nv_schema.nv_agent_metrics
    WHERE window_start > NOW() - interval '24 hours'
  `);
  const have = Number((countRes.rows ?? countRes)[0]?.n ?? 0);
  if (have >= 50) return have;

  const agents = getAllAgents().slice(0, 148);
  let inserted = 0;
  for (let i = 0; i < agents.length; i++) {
    const agent = agents[i];
    const requests = 12 + (i % 188);
    const successes = Math.max(1, Math.floor(requests * (0.86 + (i % 8) * 0.012)));
    const failures = Math.max(0, requests - successes);
    const totalLatencyMs = requests * (480 + (i % 55) * 42);
    const totalCostUsd = Math.round((requests * 0.018 + (i % 17) * 0.008) * 10000) / 10000;
    await db.execute(sql`
      INSERT INTO nv_schema.nv_agent_metrics
        (agent_key, tenant_id, request_count, success_count, failure_count,
         total_latency_ms, total_cost_usd, metrics_window, window_start)
      VALUES
        (${agent.id}, 'demo-tenant', ${requests}, ${successes}, ${failures},
         ${totalLatencyMs}, ${totalCostUsd}, 'day',
         NOW() - (random() * interval '12 hours'))
    `);
    inserted++;
  }
  logger.info('agent_metrics_backfill_complete', { inserted, prior: have });
  return inserted;
}

export const nvConsoleDemoSeed = {
  async bootstrap(): Promise<void> {
    if (_bootstrapped) return;
    if (!db) {
      logger.warn('console_demo_seed_skipped_no_db');
      return;
    }
    try {
      if (!(await agentMetricsTableReady())) {
        try {
          await db.execute(sql`CREATE SCHEMA IF NOT EXISTS nv_schema`);
        } catch {
          // Expected on prod nv_app — table may exist from admin migration.
        }
      }
      await backfillAgentMetricsIfSparse();
      _bootstrapped = true;
    } catch (err: any) {
      logger.warn('console_demo_seed_failed', { err: err?.message });
    }
  },
};

export default nvConsoleDemoSeed;
