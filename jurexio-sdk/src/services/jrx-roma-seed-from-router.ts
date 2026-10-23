/**
 * Seed the ROMA L5 store from nv_router_decisions when Redis/memory is empty
 * after a process start — so CAM/romaTrackedAgents is live without waiting
 * for the next Queen multi-agent turn.
 */
import { pool } from '../db/index.js';
import { romaL5Engine } from '../packages/protocols/roma/roma-l5-engine.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('roma-seed');

export async function seedRomaStoreFromRouterDecisions(): Promise<number> {
  if (!pool) return 0;
  try {
    const existing = Object.keys(romaL5Engine.getPerformanceStore()).length;
    if (existing > 0) return 0;
    const result = await pool.query(`
      SELECT agent_id,
             COUNT(*)::int AS total,
             SUM(CASE WHEN ok THEN 1 ELSE 0 END)::int AS ok_count,
             COALESCE(ROUND(AVG(latency_ms)::numeric, 1), 0)::float AS avg_latency
      FROM nv_router_decisions
      WHERE ts >= NOW() - INTERVAL '7 days' AND agent_id IS NOT NULL
      GROUP BY agent_id
      ORDER BY total DESC
      LIMIT 200
    `);
    let seeded = 0;
    for (const row of result.rows ?? []) {
      const id = String(row.agent_id || '').trim();
      if (!id) continue;
      const total = Number(row.total) || 0;
      if (total <= 0) continue;
      const ok = Number(row.ok_count) || 0;
      romaL5Engine.seedIfMissing(id, {
        usageCount: total,
        successRate: ok / total,
        fallbackRate: 0,
        averageLatencyMs: Number(row.avg_latency) || 0,
        hallucinationFlags: 0,
        lastUsed: new Date(),
      });
      seeded += 1;
    }
    if (seeded > 0) {
      await romaL5Engine.flushPersist();
      logger.info('roma_seeded_from_router', { seeded });
    }
    return seeded;
  } catch (e: unknown) {
    logger.warn('roma_seed_from_router_failed', {
      err: e instanceof Error ? e.message : String(e),
    });
    return 0;
  }
}
