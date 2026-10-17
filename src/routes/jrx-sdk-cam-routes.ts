/**
 * SDK CAM (Continuous Agent Monitoring 2.0) Bridge Routes
 * Session-15 v15 TASK-B (NV-CAM-DASHBOARD-BRIDGE-2026-05-11)
 *
 * Bridges the existing CAMMonitoringDashboard UI + partner SDK clients to
 * real telemetry from `nv_agents` + `nv_router_decisions` (+ in-memory
 * BMADCAMFramework framework when available).
 *
 * Mounts:
 *   /api/jrx/v1/sdk/cam/*           — partner-facing, sdkGatewayAuth (X-API-Key)
 *   /api/nyayavigya/cam/*          — internal UI, authenticateToken (JWT)
 *
 * Both expose the SAME shape so the existing
 * `client/src/components/CAMMonitoringDashboard.tsx` (queryKey
 * `['/api/nyayavigya/cam/dashboard', startupId]`) keeps working without
 * client changes.
 *
 * NV-API-CONTRACT-001: additive routes only.
 * NV-WIRING-001: this file is imported and mounted in src/index.ts.
 */

import { Router, Request, Response } from 'express';
import { sdkGatewayAuth } from '../middleware/sdk-gateway.js';
import { authenticateToken } from '../middleware/jrx-auth.js';
import { pool } from '../db/index.js';
import { secureRandomHex } from '../utils/jrx-secure-random.js';
import { createLogger } from '../utils/logger.js';
import { NYV_PLATFORM_VERSION } from '../config/nyv-master-config.js';
import { getRegistryStats } from '../services/agent-registry-service.js';
import { romaL5Engine } from '../packages/protocols/roma/roma-l5-engine.js';
import { resolveCamTotalAgents } from '../utils/jrx-cam-total-agents.js';

const logger = createLogger('sdk-cam');
const PLATFORM_VERSION = NYV_PLATFORM_VERSION;
const DOCS_URL = 'https://docs.jurexio.example/canonical/04c-sdk-troubleshooting';

interface CAMOverview {
  totalAgents: number;
  activeWorkflows: number;
  totalExecutions: number;
  avgSuccessRate: number;
  persistedAgents?: number;
  romaTrackedAgents?: number;
}

interface CostMetrics {
  totalCost: number;
  llmCosts: number;
  storageCosts: number;
  computeCosts: number;
  costTrend: 'up' | 'down' | 'stable';
  recommendations: string[];
}

interface QualityMetrics {
  avgQuality: number;
  accuracy: number;
  reliability: number;
  consistency: number;
}

interface AgentHealth {
  agentId: string;
  successRate: number;
  avgLatency: number;
  totalExecutions: number;
  uptime: number;
  workload: number;
  qualityScore: number;
  status: 'healthy' | 'degraded' | 'unhealthy';
}

interface RecentExecution {
  orchestrationId: string;
  workflow: string;
  duration: number;
  cost: number;
  status: 'success' | 'failed';
  timestamp: string;
}

interface CAMDashboardData {
  overview: CAMOverview;
  agents: AgentHealth[];
  costs: CostMetrics;
  quality: QualityMetrics;
  recentExecutions: RecentExecution[];
}

const EMPTY_DASHBOARD: CAMDashboardData = {
  overview: { totalAgents: 0, activeWorkflows: 0, totalExecutions: 0, avgSuccessRate: 0 },
  agents: [],
  costs: { totalCost: 0, llmCosts: 0, storageCosts: 0, computeCosts: 0, costTrend: 'stable', recommendations: [] },
  quality: { avgQuality: 0, accuracy: 0, reliability: 0, consistency: 0 },
  recentExecutions: [],
};

/** Fail-soft query — missing tables / columns never take down the dashboard. */
async function qSafe<T = any>(sqlText: string, fallbackRows: T[] = []): Promise<{ rows: T[] }> {
  if (!pool) return { rows: fallbackRows };
  try {
    const result = await pool.query(sqlText);
    return { rows: (result.rows ?? fallbackRows) as T[] };
  } catch (err: unknown) {
    logger.warn('cam_query_soft_fail', { err: err instanceof Error ? err.message : String(err) });
    return { rows: fallbackRows };
  }
}

async function buildDashboard(startupId?: string): Promise<CAMDashboardData> {
  if (!pool) return EMPTY_DASHBOARD;
  void startupId;

  // Total agent count + active workflows (rough proxy: distinct agent_id active in last 24h)
  const [agentTotalRow, last24Rows, perAgentRows, costRows, recentRows] = await Promise.all([
    qSafe(`SELECT COUNT(*)::int AS total FROM nv_agents`, [{ total: 0 } as any]),
    qSafe(`
      SELECT COUNT(*)::int AS total,
             SUM(CASE WHEN ok THEN 1 ELSE 0 END)::int AS successes,
             COUNT(DISTINCT agent_id)::int AS active_agents
      FROM nv_router_decisions
      WHERE ts >= NOW() - INTERVAL '24 hours'
    `, [{ total: 0, successes: 0, active_agents: 0 } as any]),
    qSafe(`
      SELECT agent_id,
             COUNT(*)::int AS total,
             SUM(CASE WHEN ok THEN 1 ELSE 0 END)::int AS ok_count,
             ROUND(AVG(latency_ms)::numeric, 1)::float AS avg_latency
      FROM nv_router_decisions
      WHERE ts >= NOW() - INTERVAL '24 hours' AND agent_id IS NOT NULL
      GROUP BY agent_id
      ORDER BY total DESC
      LIMIT 20
    `),
    qSafe(`
      SELECT
        ROUND(COALESCE(SUM(cost_usd), 0)::numeric, 6)::float AS total_cost,
        ROUND(COALESCE(AVG(CASE WHEN ts >= NOW() - INTERVAL '1 hour' THEN cost_usd END), 0)::numeric, 6)::float AS recent_avg_cost,
        ROUND(COALESCE(AVG(CASE WHEN ts < NOW() - INTERVAL '1 hour' AND ts >= NOW() - INTERVAL '2 hours' THEN cost_usd END), 0)::numeric, 6)::float AS prior_avg_cost
      FROM nv_router_decisions
      WHERE ts >= NOW() - INTERVAL '24 hours'
    `, [{ total_cost: 0, recent_avg_cost: 0, prior_avg_cost: 0 } as any]),
    qSafe(`
      SELECT request_id, agent_id, latency_ms, cost_usd, ok, ts
      FROM nv_router_decisions
      WHERE ts >= NOW() - INTERVAL '24 hours'
      ORDER BY ts DESC
      LIMIT 25
    `),
  ]);

  let registryCount = 0;
  try {
    registryCount = getRegistryStats().totalAgents;
  } catch {
    registryCount = 0;
  }
  const dbAgentCount = (agentTotalRow.rows?.[0]?.total ?? 0) as number;
  const totalAgents = resolveCamTotalAgents(dbAgentCount, registryCount);
  await romaL5Engine.hydrate();
  const romaStore = romaL5Engine.getPerformanceStore();
  const romaTracked = Object.keys(romaStore).length;
  const last = last24Rows.rows?.[0] ?? { total: 0, successes: 0, active_agents: 0 };
  const totalExecutions = (last.total ?? 0) as number;
  const successes = (last.successes ?? 0) as number;
  const activeWorkflows = (last.active_agents ?? 0) as number;
  const avgSuccessRate = totalExecutions > 0 ? successes / totalExecutions : 0;

  const agents: AgentHealth[] = (perAgentRows.rows ?? []).map((r: any) => {
    const total = Number(r.total ?? 0);
    const ok = Number(r.ok_count ?? 0);
    const successRate = total > 0 ? ok / total : 0;
    const status: AgentHealth['status'] =
      successRate >= 0.95 ? 'healthy' : successRate >= 0.80 ? 'degraded' : 'unhealthy';
    return {
      agentId: String(r.agent_id),
      successRate,
      avgLatency: Number(r.avg_latency ?? 0),
      totalExecutions: total,
      uptime: 1,
      workload: Math.min(1, total / Math.max(1, totalExecutions)),
      qualityScore: successRate,
      status,
    };
  });

  const costRow = costRows.rows?.[0] ?? { total_cost: 0, recent_avg_cost: 0, prior_avg_cost: 0 };
  const totalCost = Number(costRow.total_cost ?? 0);
  const recentAvg = Number(costRow.recent_avg_cost ?? 0);
  const priorAvg = Number(costRow.prior_avg_cost ?? 0);
  const trend: CostMetrics['costTrend'] =
    recentAvg > priorAvg * 1.1 ? 'up' : recentAvg < priorAvg * 0.9 ? 'down' : 'stable';

  const recommendations: string[] = [];
  if (trend === 'up') recommendations.push('Cost-per-call rising in last hour — consider preferCheaper tier or semantic caching.');
  if (avgSuccessRate < 0.9 && totalExecutions > 10) recommendations.push('Success rate below 90% — inspect /api/jrx/observability/router-stats/recent for failure clusters.');
  if (totalAgents > 1000 && activeWorkflows < 50) recommendations.push('Large agent registry but low utilisation — review agent allocation rules.');

  const recentExecutions: RecentExecution[] = (recentRows.rows ?? []).map((r: any) => ({
    orchestrationId: String(r.request_id ?? ''),
    workflow: String(r.agent_id ?? 'unknown'),
    duration: Number(r.latency_ms ?? 0),
    cost: Number(r.cost_usd ?? 0),
    status: r.ok ? 'success' : 'failed',
    timestamp: new Date(r.ts).toISOString(),
  }));

  return {
    overview: {
      totalAgents,
      activeWorkflows,
      totalExecutions,
      avgSuccessRate,
      persistedAgents: dbAgentCount,
      romaTrackedAgents: romaTracked,
    },
    agents,
    costs: {
      totalCost,
      llmCosts: totalCost,
      storageCosts: 0,
      computeCosts: 0,
      costTrend: trend,
      recommendations,
    },
    quality: {
      avgQuality: avgSuccessRate,
      accuracy: avgSuccessRate,
      reliability: agents.length > 0 ? agents.filter((a) => a.status === 'healthy').length / agents.length : 0,
      consistency: avgSuccessRate,
    },
    recentExecutions,
  };
}

function envelopeOk(data: CAMDashboardData) {
  return {
    success: true,
    requestId: secureRandomHex(8),
    platform: PLATFORM_VERSION,
    generated_at: new Date().toISOString(),
    data,
    docs_url: DOCS_URL,
  };
}

async function dashboardHandler(req: Request, res: Response): Promise<void> {
  // Always HTTP 200 with a usable envelope — empty metrics when telemetry
  // tables are missing or queries fail (production fail-soft, no 500 surprise).
  try {
    const startupId = (req.query.startupId as string) || (req.params.startupId as string) || undefined;
    const dashboard = await buildDashboard(startupId);
    res.json(envelopeOk(dashboard));
  } catch (err) {
    logger.error('cam_dashboard_failed', { error: (err as Error).message });
    res.status(200).json({
      ...envelopeOk(EMPTY_DASHBOARD),
      degraded: true,
      notice: {
        code: 'CAM_DASHBOARD_DEGRADED',
        message: 'CAM telemetry unavailable — showing empty baseline. Retry later.',
        retryable: true,
        docs_url: DOCS_URL,
      },
    });
  }
}

// SDK partner-facing router (X-API-Key)
const sdkRouter = Router();
sdkRouter.use(sdkGatewayAuth);
sdkRouter.get('/dashboard', dashboardHandler);
sdkRouter.get('/dashboard/:startupId', dashboardHandler);

// Internal UI router (JWT) — mounted at /api/nyayavigya/cam to satisfy the
// existing CAMMonitoringDashboard.tsx queryKey.
const uiRouter = Router();
uiRouter.use(authenticateToken);
uiRouter.get('/dashboard', dashboardHandler);
uiRouter.get('/dashboard/:startupId', dashboardHandler);

export { sdkRouter as sdkCamRouter, uiRouter as uiCamRouter };
export default sdkRouter;
