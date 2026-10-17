import { Router } from 'express';
import {
  getAggregates,
  getRecentDecisions,
  getHealthSnapshot,
  MODEL_CATALOG,
  isProviderAvailable,
  providerKeyRequirement,
  pickSequence,
} from '../services/intelligent-router/index.js';
import { ALLOWED_PROVIDERS } from '../config/nyv-allowed-providers.js';
import { getStep0Counters } from '../orchestration/jrx-completion-driven.js';
import { getPersistentLogStats } from '../services/intelligent-router/router-stats.js';
import { pool } from '../db/index.js';
import { createLogger } from '../utils/logger.js';
import { authenticateToken, requireAdmin } from '../middleware/jrx-auth.js';

const router = Router();
const logger = createLogger('./jrx-router-stats-routes');

router.get('/router-stats', (_req, res) => {
  res.json({
    ok: true,
    aggregates: getAggregates(),
    health: getHealthSnapshot(),
    catalogSize: MODEL_CATALOG.length,
    providersAvailable: {
      anthropic: isProviderAvailable('anthropic'),
      openai: isProviderAvailable('openai'),
      google: isProviderAvailable('google'),
      openrouter: isProviderAvailable('openrouter'),
      groq: isProviderAvailable('groq'),
      mistral: isProviderAvailable('mistral'),
      deepseek: isProviderAvailable('deepseek'),
      // xai + perplexity were missing from this map (Session-16 fix) — they
      // are keyless in dev and were silently absent from the availability
      // surface, defeating the "explicit unavailable" contract.
      xai: isProviderAvailable('xai'),
      perplexity: isProviderAvailable('perplexity'),
      together: isProviderAvailable('together'),
      cohere: isProviderAvailable('cohere'),
      sarvam: isProviderAvailable('sarvam'),
      bedrock: isProviderAvailable('bedrock'),
      vertex: isProviderAvailable('vertex'),
      agentzero: true,
    },
    // Session-16 (2026-06-02): explicit, actionable availability checklist for
    // every allowed provider. `available:false` is NOT a silent fallback — it
    // tells the operator EXACTLY which env var(s) to supply (NV-SECRETS-001:
    // names only, never values). Keyless providers are skipped by the router
    // (intelligent-router.ts gates on isProviderAvailable) and agentzero is the
    // always-on sovereign terminal fallback, so no crash occurs without keys.
    providerKeyChecklist: ALLOWED_PROVIDERS.map((id) => {
      const acceptsEnv = providerKeyRequirement(id);
      const available = (() => { try { return isProviderAvailable(id); } catch { return false; } })();
      return {
        provider: id,
        available,
        status: available ? 'available' : (id === 'agentzero' ? 'always-on' : 'unavailable-no-key'),
        canonicalEnv: acceptsEnv[0] ?? null,
        acceptsEnv,
      };
    }),
    /* NV-STEP0-OBSERVABILITY-001 — Step-0 grounding outcome ratio.
     *
     * `releasedEarly / observed` answers a question that a log grep could not:
     * `observed: 0` means the stage is never reached (a wiring problem), whereas
     * `observed: N, releasedEarly: 0` means the first-useful mechanism is wired and
     * simply never needed — the expected reading while memory recall is fast. Those
     * demand opposite responses, and before this the two were indistinguishable.
     *
     * NV-ROUTER-LOG-WIDTH-001 — decision-log writer health, including the
     * unwritable-drop counter, so a frozen history is visible without reading logs.
     */
    step0Grounding: getStep0Counters(),
    decisionLog: getPersistentLogStats(),
  });
});

/**
 * Persistent decision-log query — backed by nv_router_decisions in RDS.
 * Filters: ?since=ISO  ?provider=  ?ok=true|false  ?model=  ?limit=
 * Returns aggregates + a slice of recent rows. Auditor/SOC2 ready.
 */
// Admin-only: this endpoint exposes per-request audit telemetry
// (request_id, agent_id, model/provider behavior, errors). Must not be
// reachable unauthenticated.
router.get('/router-stats/persistent', authenticateToken, requireAdmin, async (req, res): Promise<void> => {
  try {
    const since = (req.query.since as string) || null;
    const provider = (req.query.provider as string) || null;
    const model = (req.query.model as string) || null;
    const okQ = req.query.ok as string | undefined;
    const limit = Math.min(1000, Math.max(1, parseInt((req.query.limit as string) ?? '100', 10) || 100));

    const where: string[] = [];
    const args: any[] = [];
    let p = 1;
    if (since) { where.push(`ts >= $${p++}`); args.push(new Date(since)); }
    if (provider) { where.push(`picked_provider = $${p++}`); args.push(provider); }
    if (model) { where.push(`picked_model_id = $${p++}`); args.push(model); }
    if (okQ === 'true' || okQ === 'false') { where.push(`ok = $${p++}`); args.push(okQ === 'true'); }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const aggSql =
      `SELECT picked_provider, picked_model_id,
              COUNT(*)::int AS total,
              SUM(CASE WHEN ok THEN 1 ELSE 0 END)::int AS successes,
              SUM(CASE WHEN NOT ok THEN 1 ELSE 0 END)::int AS failures,
              ROUND(AVG(latency_ms)::numeric, 1) AS avg_latency_ms,
              ROUND(SUM(cost_usd)::numeric, 6) AS total_cost_usd,
              SUM(tokens_in)::bigint AS total_tokens_in,
              SUM(tokens_out)::bigint AS total_tokens_out
       FROM nv_router_decisions ${whereSql}
       GROUP BY picked_provider, picked_model_id
       ORDER BY total DESC`;
    const recentSql =
      `SELECT id, ts, request_id, agent_id, tier, jurisdiction, task_kind,
              primary_model_id, picked_model_id, picked_provider,
              fallback_level, ok, latency_ms, cost_usd, tokens_in, tokens_out, error_message
       FROM nv_router_decisions ${whereSql}
       ORDER BY ts DESC
       LIMIT ${limit}`;

    if (!pool) {
      res.status(503).json({ ok: false, error: 'database_not_configured' });
      return;
    }
    const [agg, recent] = await Promise.all([
      pool.query(aggSql, args),
      pool.query(recentSql, args),
    ]);

    res.json({
      ok: true,
      filter: { since, provider, model, ok: okQ ?? null, limit },
      aggregatesByModel: agg.rows,
      recent: recent.rows,
      totalReturned: recent.rowCount,
    });
  } catch (err) {
    logger.error('persistent router-stats query failed', { error: (err as Error).message });
    res.status(500).json({ ok: false, error: 'persistent_log_query_failed' });
  }
});

router.get('/router-stats/recent', (req, res) => {
  const limit = Math.min(500, Math.max(1, parseInt((req.query.limit as string) ?? '50', 10) || 50));
  res.json({ ok: true, decisions: getRecentDecisions(limit) });
});

router.get('/router-stats/catalog', (_req, res) => {
  res.json({
    ok: true,
    models: MODEL_CATALOG.map((m) => ({
      id: m.id,
      provider: m.provider,
      displayName: m.displayName,
      contextWindow: m.contextWindow,
      costInPer1M: m.costInPer1M,
      costOutPer1M: m.costOutPer1M,
      isFree: m.isFree,
      isLatest: m.isLatest,
      legalQuality: m.legalQuality,
      generalQuality: m.generalQuality,
      speedScore: m.speedScore,
      preferredFor: m.preferredFor,
      jurisdictionFit: m.jurisdictionFit,
      providerAvailable: isProviderAvailable(m.provider),
    })),
  });
});

router.post('/router-stats/explain', (req, res) => {
  const body = req.body ?? {};
  const decision = pickSequence({
    agentId: body.agentId,
    userId: body.userId,
    // NV-UAT-DEFAULT-ORG-001 (task #335): missing org → baseline org_id=1
    // in dev / E2E-bypass mode so router-stats explain renders for demo users.
    organizationId: body.organizationId ??
      ((process.env.NODE_ENV !== 'production') ? 1 : undefined),
    tier: body.tier,
    plan: body.plan,
    jurisdiction: body.jurisdiction,
    taskKind: body.taskKind,
    promptTokens: body.promptTokens,
    expectedOutputTokens: body.expectedOutputTokens,
    requireJson: body.requireJson,
    requireVision: body.requireVision,
    requireReasoning: body.requireReasoning,
    maxCostUsd: body.maxCostUsd,
    preferCheaper: body.preferCheaper,
    preferredModels: body.preferredModels,
    fallbackModels: body.fallbackModels,
    forbiddenModels: body.forbiddenModels,
    patternKey: body.patternKey,
    app: body.app,
  });
  res.json({
    ok: true,
    primary: decision.primary?.id,
    sequence: decision.sequence.map((m) => ({
      id: m.id,
      provider: m.provider,
      reasons: decision.reasonsByModel[m.id] ?? [],
    })),
    inputs: decision.inputs,
  });
});

export default router;
