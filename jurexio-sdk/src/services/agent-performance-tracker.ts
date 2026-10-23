// JRX-NS-021 (2026-05-05): pre-existing TS errors (gateway runs via tsx).
/**
 * Agent Performance Tracker — Algorithm P3
 * @version 5.3.0
 *
 * Tracks per-agent live signals used by the smart router:
 *   - success rate (rolling window)
 *   - average + P95 latency
 *   - quality score (hallucination check / feedback)
 *   - active concurrency (in-flight executions)
 *   - per-jurisdiction outcomes (proven wins from the metering log)
 *
 * Storage: in-memory (ring buffer) + optional DB flush.
 */

import { db as _raw_db } from '../db/index.js';
import { lazyRequire } from '../utils/jrx-type-helpers.js';
const db = lazyRequire(() => _raw_db, 'db');
import { sql } from 'drizzle-orm';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('agent-performance-tracker');

/* ── Types ─────────────────────────────────────────────────── */

export interface AgentExecution {
  agentKey: string;
  success: boolean;
  latencyMs: number;
  qualityScore: number;   // 0.0 – 1.0 (from hallucination check / feedback)
  timestamp: Date;
}

export interface AgentStats {
  agentKey: string;
  totalExecutions: number;
  successRate: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  avgQualityScore: number;
  activeConcurrency: number;
  performanceScore: number;  // composite 0.0 – 1.0
  lastUpdated: string;
}

export interface JurisdictionOutcome {
  total: number;
  successes: number;
  successRate: number;
}

/* ── Ring buffer (last 100 per agent) ──────────────────────── */

const RING_SIZE = 100;
const rings = new Map<string, AgentExecution[]>();

function getRing(agentKey: string): AgentExecution[] {
  if (!rings.has(agentKey)) rings.set(agentKey, []);
  return rings.get(agentKey)!;
}

/* ── Active concurrency ────────────────────────────────────── */

const active = new Map<string, number>();

/* ── Per-jurisdiction outcomes (rolling totals) ────────────── */

const jurisdictionOutcomes = new Map<string, Map<string, { total: number; successes: number }>>();

function getJurisdictionMap(agentKey: string): Map<string, { total: number; successes: number }> {
  if (!jurisdictionOutcomes.has(agentKey)) {
    jurisdictionOutcomes.set(agentKey, new Map());
  }
  return jurisdictionOutcomes.get(agentKey)!;
}

/* ── DB persistence (background, non-blocking) ─────────────── */

async function persistToDB(exec: AgentExecution): Promise<void> {
  try {
    await db.execute(sql`
      INSERT INTO agent_performance_log
        (agent_key, success, latency_ms, quality_score, executed_at)
      VALUES
        (${exec.agentKey}, ${exec.success}, ${exec.latencyMs},
         ${exec.qualityScore}, ${exec.timestamp.toISOString()})
      ON CONFLICT DO NOTHING
    `);
  } catch {
    /* Table may not exist yet — silently skip */
  }
}

/* ── Helpers ───────────────────────────────────────────────── */

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

/* ── Main tracker ──────────────────────────────────────────── */

export const agentPerformanceTracker = {
  record(exec: AgentExecution): void {
    const ring = getRing(exec.agentKey);
    if (ring.length >= RING_SIZE) ring.shift();
    ring.push(exec);
    /* Fire-and-forget DB persist */
    persistToDB(exec).catch(() => {});
  },

  /**
   * Mark an LLM execution as in-flight. Pair with `endExecution`.
   * Used by the router to deprioritize agents already at capacity.
   */
  beginExecution(agentKey: string): void {
    active.set(agentKey, (active.get(agentKey) ?? 0) + 1);
  },

  endExecution(agentKey: string): void {
    const cur = active.get(agentKey) ?? 0;
    if (cur <= 1) active.delete(agentKey);
    else active.set(agentKey, cur - 1);
  },

  getActiveCount(agentKey: string): number {
    return active.get(agentKey) ?? 0;
  },

  /**
   * Record a per-jurisdiction outcome from the metering log so the
   * coalition former can favor agents with proven jurisdiction wins.
   */
  recordJurisdictionOutcome(agentKey: string, jurisdiction: string | undefined, success: boolean): void {
    if (!jurisdiction) return;
    const map = getJurisdictionMap(agentKey);
    const cur = map.get(jurisdiction) ?? { total: 0, successes: 0 };
    cur.total += 1;
    if (success) cur.successes += 1;
    map.set(jurisdiction, cur);
  },

  /**
   * Returns the success rate (0..1) for an agent in a given jurisdiction.
   * Returns null when there is no signal yet so the caller can fall back
   * to neutral weighting instead of treating "no data" as zero.
   */
  getJurisdictionScore(agentKey: string, jurisdiction: string | undefined): number | null {
    if (!jurisdiction) return null;
    const cur = jurisdictionOutcomes.get(agentKey)?.get(jurisdiction);
    if (!cur || cur.total === 0) return null;
    return cur.successes / cur.total;
  },

  getJurisdictionOutcomes(agentKey: string): Record<string, JurisdictionOutcome> {
    const map = jurisdictionOutcomes.get(agentKey);
    if (!map) return {};
    const out: Record<string, JurisdictionOutcome> = {};
    for (const [j, v] of map) {
      out[j] = {
        total: v.total,
        successes: v.successes,
        successRate: v.total === 0 ? 0 : v.successes / v.total,
      };
    }
    return out;
  },

  getStats(agentKey: string): AgentStats {
    const ring = getRing(agentKey);
    const activeNow = this.getActiveCount(agentKey);
    if (ring.length === 0) {
      return {
        agentKey,
        totalExecutions: 0,
        successRate: 1.0,
        avgLatencyMs: 0,
        p95LatencyMs: 0,
        avgQualityScore: 0.8,
        activeConcurrency: activeNow,
        performanceScore: 0.8,
        lastUpdated: new Date().toISOString(),
      };
    }

    const successRate     = ring.filter(r => r.success).length / ring.length;
    const avgLatencyMs    = ring.reduce((s, r) => s + r.latencyMs, 0) / ring.length;
    const avgQualityScore = ring.reduce((s, r) => s + r.qualityScore, 0) / ring.length;
    const p95LatencyMs    = percentile(ring.map(r => r.latencyMs), 95);

    /* Latency penalty: normalise against 10 s baseline */
    const latencyFactor   = Math.max(0, 1 - avgLatencyMs / 10_000);

    /* Composite score: 50% success, 30% quality, 20% latency */
    const performanceScore =
      successRate * 0.5 +
      avgQualityScore * 0.3 +
      latencyFactor * 0.2;

    return {
      agentKey,
      totalExecutions: ring.length,
      successRate: parseFloat(successRate.toFixed(4)),
      avgLatencyMs: Math.round(avgLatencyMs),
      p95LatencyMs: Math.round(p95LatencyMs),
      avgQualityScore: parseFloat(avgQualityScore.toFixed(4)),
      activeConcurrency: activeNow,
      performanceScore: parseFloat(performanceScore.toFixed(4)),
      lastUpdated: ring[ring.length - 1].timestamp.toISOString(),
    };
  },

  getAllScores(): Map<string, number> {
    const scores = new Map<string, number>();
    for (const agentKey of rings.keys()) {
      scores.set(agentKey, this.getStats(agentKey).performanceScore);
    }
    return scores;
  },

  listAll(): AgentStats[] {
    // Union of agents that have either historical executions OR are currently
    // in-flight. The dashboard summary needs both so a fleet that just came
    // online (no history yet but already busy) doesn't read as "0 active".
    const keys = new Set<string>([...rings.keys(), ...active.keys()]);
    return [...keys].map(k => this.getStats(k));
  },

  /** Test-only: clear all in-memory state. */
  __resetForTests(): void {
    rings.clear();
    active.clear();
    jurisdictionOutcomes.clear();
  },
};
