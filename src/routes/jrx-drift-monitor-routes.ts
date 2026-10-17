/**
 * Drift Monitor — Phase C / T011 Stream B (2026-05-06)
 *
 * Real backend for the model-drift monitor page. Replaces the prior
 * `model_drift` Phase C stub which returned 501. Returns per-agent
 * rolling p50/p95 latency and a 24h vs prior-24h accuracy delta from
 * the `nv_agent_performance` aggregate table.
 *
 * If the table is empty (fresh DB), we still return 200 with
 * `{ ok:true, empty:true, agents:[] }` so the UI compiles cleanly.
 */
import { Router, Request, Response } from 'express';
import { pool as rawPool } from '../db/index.js';
import { requireValue } from '../utils/jrx-type-helpers.js';
import { createLogger } from '../utils/logger.js';
import { dualSdkOrJwt } from '../middleware/jrx-dual-auth.js';
import {
  writeCamActionAsync,
  camActionId,
  type CamSeverity,
} from '../services/compliance/jrx-cam-writer.js';

const logger = createLogger('./jrx-drift-monitor-routes');

export const driftMonitorRouter = Router();

// ── Phase 1 audit-fix 2026-05-11: drift namespace root ──────────────────────
// Console "Model Drift" page polls /api/jrx/drift root to detect liveness
// before fetching /agents. Returns namespace metadata + sub-route map.
driftMonitorRouter.get('/', (_req: Request, res: Response) => {
  res.json({
    ok: true,
    namespace: 'drift',
    version: 'v5.0.1',
    uptimeSec: Math.floor(process.uptime()),
    routes: {
      agents: 'GET /api/jrx/drift/agents',
    },
    description: 'Per-agent rolling p50/p95 latency + 24h vs prior-24h accuracy delta.',
  });
});

driftMonitorRouter.get('/agents', async (_req: Request, res: Response) => {
  try {
    if (!rawPool) {
      res.status(200).json({ ok: true, empty: true, agents: [], reason: 'database_not_configured' });
      return;
    }
    const pool = requireValue(rawPool, 'pool');

    // Detect schema availability — surface a clear empty payload (not 500)
    // when the aggregate table hasn't been provisioned yet on this env.
    const tableCheck = await pool.query(
      `SELECT to_regclass('public.nv_agent_performance') AS reg`,
    );
    if (!tableCheck.rows?.[0]?.reg) {
      res.status(200).json({ ok: true, empty: true, agents: [], reason: 'table_missing' });
      return;
    }

    const sqlText = `
      WITH recent AS (
        SELECT agent_id,
               avg_latency_ms,
               success_rate,
               recorded_at
          FROM nv_agent_performance
         WHERE recorded_at >= NOW() - INTERVAL '24 hours'
      ),
      prior AS (
        SELECT agent_id,
               success_rate
          FROM nv_agent_performance
         WHERE recorded_at <  NOW() - INTERVAL '24 hours'
           AND recorded_at >= NOW() - INTERVAL '48 hours'
      ),
      agg_recent AS (
        SELECT agent_id,
               COUNT(*)::int                                          AS samples_24h,
               ROUND(AVG(avg_latency_ms)::numeric, 1)                 AS avg_latency_ms,
               PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY avg_latency_ms) AS p50_latency_ms,
               PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY avg_latency_ms) AS p95_latency_ms,
               ROUND(AVG(success_rate)::numeric, 4)                   AS accuracy_recent,
               MAX(recorded_at)                                       AS last_recorded_at
          FROM recent
         GROUP BY agent_id
      ),
      agg_prior AS (
        SELECT agent_id,
               ROUND(AVG(success_rate)::numeric, 4) AS accuracy_prior
          FROM prior
         GROUP BY agent_id
      )
      SELECT r.agent_id,
             r.samples_24h,
             r.avg_latency_ms,
             ROUND(r.p50_latency_ms::numeric, 1) AS p50_latency_ms,
             ROUND(r.p95_latency_ms::numeric, 1) AS p95_latency_ms,
             r.accuracy_recent,
             p.accuracy_prior,
             CASE
               WHEN p.accuracy_prior IS NULL THEN NULL
               ELSE ROUND((r.accuracy_recent - p.accuracy_prior)::numeric, 4)
             END AS accuracy_delta,
             r.last_recorded_at
        FROM agg_recent r
        LEFT JOIN agg_prior p ON p.agent_id = r.agent_id
       ORDER BY r.samples_24h DESC, r.agent_id ASC
    `;

    const result = await pool.query(sqlText);
    const agents = result.rows ?? [];

    // Task #201: emit a CAM reviewer-queue row when an agent's 24h
    // accuracy regresses by ≥5pp (medium) or ≥10pp (high). Idempotent
    // per (agent, day) so polling the dashboard doesn't dup rows.
    const today = new Date().toISOString().slice(0, 10);
    for (const a of agents as Array<any>) {
      const delta = a?.accuracy_delta != null ? Number(a.accuracy_delta) : null;
      if (delta == null || Number.isNaN(delta)) continue;
      let severity: CamSeverity | null = null;
      if (delta <= -0.10) severity = 'high';
      else if (delta <= -0.05) severity = 'medium';
      if (!severity) continue;

      const agentId = String(a.agent_id ?? 'unknown');
      writeCamActionAsync({
        actionId: camActionId(['drift', agentId, today]),
        framework: 'drift',
        controlId: agentId,
        severity,
        title: `Agent drift: ${agentId} accuracy ↓${(Math.abs(delta) * 100).toFixed(1)}pp`,
        description:
          `Agent ${agentId} 24h accuracy ${a.accuracy_recent} vs prior 24h ${a.accuracy_prior} ` +
          `(Δ ${delta}). Samples=${a.samples_24h}, p95=${a.p95_latency_ms}ms.`,
        triggeredBy: 'drift_monitor',
        evidenceRef: agentId,
        metadata: {
          agentId,
          accuracyRecent: a.accuracy_recent,
          accuracyPrior: a.accuracy_prior,
          accuracyDelta: delta,
          samples24h: a.samples_24h,
          p50LatencyMs: a.p50_latency_ms,
          p95LatencyMs: a.p95_latency_ms,
          window: { recent: '24h', prior: '24h-48h' },
        },
      });
    }

    res.status(200).json({
      ok: true,
      empty: agents.length === 0,
      window: { recent: '24h', prior: '24h-48h' },
      generatedAt: new Date().toISOString(),
      agents,
    });
  } catch (err: any) {
    logger.error('drift/agents query failed', { error: err?.message });
    res.status(500).json({ ok: false, error: 'drift_query_failed' });
  }
});

export default driftMonitorRouter;

// ── Page-compat aliases (2026-05-14) ─────────────────────────────────────────
// The Console "Model Drift" page (model-drift-monitor.tsx) polls /report and
// /status and reads `response.data.{summary,activeAlerts,baselines,recentChecks}`
// + `response.data.overallHealth`. Map both to real `nv_agent_performance` data
// using the actual schema (avg_latency_ms, success_rate, recorded_at).
//
// Auth note: drift telemetry is internal — wrap aliases with dualSdkOrJwt at
// the route level to satisfy NV-AUTH-HEADER-001 without breaking the existing
// public liveness endpoints (/, /agents) on this router.
driftMonitorRouter.get('/report', dualSdkOrJwt, async (_req: Request, res: Response) => {
  try {
    if (!rawPool) {
      res.json({
        data: { summary: { activeAlerts: 0, driftRate: '0%', totalChecks: 0, totalBaselines: 0, totalCalls: 0 }, activeAlerts: [], baselines: [], recentChecks: [] },
        ok: true, empty: true, generatedAt: new Date().toISOString(),
      });
      return;
    }
    const pool = requireValue(rawPool, 'pool');
    const recent = await pool.query(`
      SELECT agent_id,
             AVG(avg_latency_ms)::float AS avg_latency_ms,
             AVG(success_rate)::float   AS success_rate,
             SUM(total_calls)::int      AS total_calls,
             MAX(recorded_at)           AS last_seen
      FROM nv_agent_performance
      WHERE recorded_at >= NOW() - INTERVAL '24 hours'
      GROUP BY agent_id
      ORDER BY total_calls DESC
      LIMIT 50
    `);
    const prior = await pool.query(`
      SELECT agent_id, AVG(success_rate)::float AS prior_success_rate
      FROM nv_agent_performance
      WHERE recorded_at >= NOW() - INTERVAL '48 hours'
        AND recorded_at <  NOW() - INTERVAL '24 hours'
      GROUP BY agent_id
    `);
    type DriftAgentRow = {
      agent_id: string;
      avg_latency_ms?: number | string | null;
      success_rate?: number | string | null;
      total_calls?: number | string | null;
      last_seen?: string | Date | null;
      prior_success_rate?: number | string | null;
    };
    const priorMap = new Map<string, number>();
    for (const p of (prior.rows ?? []) as DriftAgentRow[]) {
      priorMap.set(p.agent_id, Number(p.prior_success_rate ?? 0));
    }

    // Build the shape the UI expects (summary / activeAlerts / baselines / recentChecks).
    const recentChecks: any[] = [];
    const activeAlerts: any[] = [];
    for (const r of (recent.rows ?? []) as DriftAgentRow[]) {
      const cur = Number(r.success_rate ?? 0);
      const prv = priorMap.get(r.agent_id) ?? cur;
      const delta = cur - prv;
      const drifted = Math.abs(delta) > 0.05; // >5pp accuracy swing
      recentChecks.push({
        model_id: r.agent_id,
        agent_id: r.agent_id,
        avg_latency_ms: Math.round(Number(r.avg_latency_ms ?? 0)),
        success_rate: Number(cur.toFixed(4)),
        prior_success_rate: Number(prv.toFixed(4)),
        delta: Number(delta.toFixed(4)),
        has_drift: drifted,
        drifted,
        total_calls: Number(r.total_calls ?? 0),
        recorded_at: r.last_seen,
      });
      if (drifted) {
        activeAlerts.push({
          model_id: r.agent_id,
          severity: Math.abs(delta) > 0.1 ? 'high' : 'medium',
          message: `Accuracy ${delta >= 0 ? 'improved' : 'dropped'} ${(Math.abs(delta) * 100).toFixed(1)}pp vs prior 24h`,
          recorded_at: r.last_seen,
        });
      }
    }

    const totalCalls = recentChecks.reduce((s, x) => s + x.total_calls, 0);
    const driftedCount = recentChecks.filter(x => x.drifted).length;
    const driftRate = recentChecks.length > 0
      ? `${((driftedCount / recentChecks.length) * 100).toFixed(1)}%`
      : '0%';

    const baselines = ((recent.rows ?? []) as DriftAgentRow[]).slice(0, 10).map(r => ({
      model_id: r.agent_id,
      baseline_success_rate: Number((priorMap.get(r.agent_id) ?? r.success_rate ?? 0).toString()),
      baseline_latency_ms: Math.round(Number(r.avg_latency_ms ?? 0)),
      created_at: r.last_seen,
    }));

    res.json({
      data: {
        summary: {
          activeAlerts: activeAlerts.length,
          driftRate,
          totalChecks: recentChecks.length,
          totalBaselines: baselines.length,
          totalCalls,
        },
        activeAlerts,
        baselines,
        recentChecks,
      },
      ok: true,
      generatedAt: new Date().toISOString(),
    });
  } catch (e: any) {
    logger.warn('drift/report fallback', { error: e?.message });
    res.json({
      data: { summary: { activeAlerts: 0, driftRate: '0%', totalChecks: 0, totalBaselines: 0, totalCalls: 0 }, activeAlerts: [], baselines: [], recentChecks: [] },
      ok: true, empty: true, generatedAt: new Date().toISOString(),
    });
  }
});

driftMonitorRouter.get('/status', dualSdkOrJwt, async (_req: Request, res: Response) => {
  try {
    if (!rawPool) {
      res.json({ data: { overallHealth: 'healthy', samples_24h: 0, agents_observed: 0 }, ok: true, empty: true });
      return;
    }
    const pool = requireValue(rawPool, 'pool');
    const r = await pool.query(`
      SELECT
        (SELECT COUNT(*)::int FROM nv_agent_performance WHERE recorded_at >= NOW() - INTERVAL '24 hours') AS samples_24h,
        (SELECT COUNT(DISTINCT agent_id)::int FROM nv_agent_performance WHERE recorded_at >= NOW() - INTERVAL '24 hours') AS agents_observed,
        (SELECT MAX(recorded_at) FROM nv_agent_performance) AS last_observation,
        (SELECT AVG(success_rate)::float FROM nv_agent_performance WHERE recorded_at >= NOW() - INTERVAL '24 hours') AS avg_success_rate
    `);
    const row = (r.rows ?? [])[0] as Record<string, unknown> ?? {};
    const avg = Number(row.avg_success_rate ?? 0);
    const samples = Number(row.samples_24h ?? 0);
    // No samples yet ⇒ default to healthy rather than alarming "critical".
    const overallHealth = samples === 0
      ? 'healthy'
      : avg >= 0.95 ? 'healthy' : avg >= 0.80 ? 'warning' : 'critical';
    res.json({
      data: {
        overallHealth,
        samples_24h: Number(row.samples_24h ?? 0),
        agents_observed: Number(row.agents_observed ?? 0),
        last_observation: row.last_observation,
        avg_success_rate: Number(avg.toFixed(4)),
      },
      ok: true, status: 'live',
    });
  } catch (e: any) {
    res.json({
      data: { overallHealth: 'healthy', samples_24h: 0, agents_observed: 0, last_observation: null, avg_success_rate: 0 },
      ok: true, status: 'idle',
    });
  }
});
