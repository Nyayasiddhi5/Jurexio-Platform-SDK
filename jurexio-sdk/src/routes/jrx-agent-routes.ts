import { Router, Request, Response } from 'express';
import { dualSdkOrJwt } from '../middleware/jrx-dual-auth.js';
import { sanitizeErrorForClient } from '../utils/error-sanitizer.js';
import { sendApiError, safeError } from '../utils/jrx-api-error.js';
import {
  getAllAgents,
  getAgent,
  getRegistryStats,
  type AgentDefinition,
} from '../services/agent-registry-service.js';
import { db as _raw_db } from '../db/index.js';
import { lazyRequire } from '../utils/jrx-type-helpers.js';
import { sql } from 'drizzle-orm';
import { createLogger } from '../utils/logger.js';

const db = lazyRequire(() => _raw_db, 'db');
const logger = createLogger('./jrx-agent-routes');
const router = Router();

// NV-AUTH-HEADER-001: accept either SDK key (X-API-Key) or JWT.
router.use(dualSdkOrJwt);

// Source agents from the in-memory v5.1.0 registry (164 canonical IDs;
// optional jurisdiction overlay via NV_PRIMARY_JURISDICTION).
// and derive status from nv_pattern_audit_log: 24h=available, 7d=degraded,
// older-or-never=disabled.

const JURISDICTION_ALIASES: Record<string, string> = {
  'india': 'IN', 'republic of india': 'IN', 'in': 'IN', 'ind': 'IN',
  'united kingdom': 'UK', 'uk': 'UK', 'gbr': 'UK', 'gbr.': 'UK',
  'united kingdom of great britain and northern ireland': 'UK',
  'united states': 'US', 'usa': 'US', 'us': 'US', 'united states of america': 'US',
  'european union': 'EU', 'eu': 'EU', 'eur': 'EU', 'europe': 'EU',
  'singapore': 'SG', 'sg': 'SG', 'sgp': 'SG', 'republic of singapore': 'SG',
  'gulf cooperation council': 'GC', 'gcc': 'GC', 'gc': 'GC', 'gulf': 'GC',
  'all jurisdictions': 'ALL', 'all': 'ALL', 'default': 'ALL',
  'multi-jurisdiction': 'ALL', 'multi-jurisdictional': 'ALL',
};

function toIsoJurisdictions(jurisdictions: string[] | undefined): string[] {
  if (!jurisdictions || jurisdictions.length === 0) return ['ALL'];
  const out = new Set<string>();
  for (const j of jurisdictions) {
    const raw = j.toLowerCase().trim();
    // Strip any parenthetical qualifier so e.g.
    // "European Union (27 Member States)" → "european union" → "EU".
    const stripped = raw.replace(/\s*\([^)]*\)\s*/g, '').trim();
    const code =
      JURISDICTION_ALIASES[raw] ||
      JURISDICTION_ALIASES[stripped] ||
      j.toUpperCase().slice(0, 3);
    out.add(code === 'EUR' ? 'EU' : code);
  }
  return Array.from(out);
}

interface AuditProbe {
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
  invocations24h: number;
  avgLatencyMs: number | null;
}

let probeCache: { ts: number; data: Map<string, AuditProbe> } | null = null;
const PROBE_TTL_MS = 30_000;

async function probeAuditLog(): Promise<Map<string, AuditProbe>> {
  if (probeCache && Date.now() - probeCache.ts < PROBE_TTL_MS) return probeCache.data;
  const out = new Map<string, AuditProbe>();
  try {
    const rows = await db.execute(sql`
      SELECT
        agent_id,
        MAX(CASE WHEN blocked = false THEN created_at END) AS last_success_at,
        MAX(CASE WHEN blocked = true  THEN created_at END) AS last_failure_at,
        COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') AS invocations_24h,
        AVG(latency_ms) FILTER (WHERE created_at > NOW() - INTERVAL '7 days')::float AS avg_latency_ms
      FROM nv_pattern_audit_log
      WHERE agent_id IS NOT NULL
      GROUP BY agent_id
    `);
    const arr: any[] = (rows as any).rows ?? (Array.isArray(rows) ? rows : []);
    for (const r of arr) {
      const id = r.agent_id ?? r.agentId;
      if (!id) continue;
      out.set(id, {
        lastSuccessAt: r.last_success_at ? new Date(r.last_success_at) : null,
        lastFailureAt: r.last_failure_at ? new Date(r.last_failure_at) : null,
        invocations24h: Number(r.invocations_24h ?? 0),
        avgLatencyMs: r.avg_latency_ms != null ? Number(r.avg_latency_ms) : null,
      });
    }
  } catch (err: any) {
    logger.warn({ method: 'probeAuditLog', err: err?.message });
  }
  probeCache = { ts: Date.now(), data: out };
  return out;
}

function deriveStatus(agent: AgentDefinition, probe?: AuditProbe): {
  status: 'available' | 'degraded' | 'disabled';
  isAvailable: boolean;
  lastInvokedAt: string | null;
  avgLatencyMs: number | null;
} {
  const now = Date.now();
  const last = probe?.lastSuccessAt?.getTime() ?? 0;
  const ageMs = last > 0 ? now - last : Infinity;

  // NV-UAT-DEFAULT-ORG-001 (2026-05-13): pre-EC2 demo posture — when no
  // pattern-audit probe exists yet, treat configured agents as 'available'
  // instead of 'disabled', so the Agent Registry counters are not all 0
  // for a freshly-seeded environment. Probed runs still demote to
  // degraded/disabled by age. Revert to fail-cold ('disabled') after
  // continuous traffic is flowing in production.
  let status: 'available' | 'degraded' | 'disabled';
  if (agent && last > 0 && ageMs < 24 * 3600 * 1000) status = 'available';
  else if (agent && last > 0 && ageMs < 7 * 24 * 3600 * 1000) status = 'degraded';
  else if (agent && last === 0) status = 'available';
  else status = 'disabled';

  return {
    status,
    isAvailable: status !== 'disabled',
    lastInvokedAt: probe?.lastSuccessAt?.toISOString() ?? null,
    avgLatencyMs: probe?.avgLatencyMs ?? null,
  };
}

function shapeAgent(a: AgentDefinition, probe?: AuditProbe) {
  const jurs = toIsoJurisdictions(a.jurisdictions);
  const derived = deriveStatus(a, probe);
  return {
    id: a.id,
    agent_id: a.id,
    agentId: a.id,
    name: a.name,
    description: a.description ?? '',
    tier: a.tier,
    roma_level: a.romaLevel,
    romaLevel: a.romaLevel,
    category: a.category,
    practice_area: a.practiceArea,
    practiceArea: a.practiceArea,
    specialization: a.practiceArea,
    capabilities: a.capabilities ?? [],
    tools: a.tools ?? [],
    preferred_models: a.preferredModels ?? [],
    preferredModels: a.preferredModels ?? [],
    fallback_models: a.fallbackModels ?? [],
    protocols: a.protocols ?? [],
    version: a.version,
    jurisdiction: jurs,
    jurisdictionScope: jurs,
    status: derived.status,
    is_available: derived.isAvailable,
    isAvailable: derived.isAvailable,
    last_invoked_at: derived.lastInvokedAt,
    lastInvokedAt: derived.lastInvokedAt,
    avg_latency_ms: derived.avgLatencyMs,
    avgLatencyMs: derived.avgLatencyMs,
    quantum_ready: !!a.quantumReady,
    security_level: a.securityLevel,
    /*
     * NV-CAPABILITY-MANIFEST-002 (2026-08-19) — the five fields NSP needs for an
     * assignable skill catalogue ("you assign, you don't prompt").
     *
     * NSP nominated THIS endpoint as canonical over `/gateway/agents` because it already
     * carries `capabilities` and `avgLatencyMs`. Extending it rather than minting a manifest
     * file: they already reconcile four registries that disagree, and a fifth would be worse.
     *
     * On the 20-vs-148 confusion they raised: this endpoint is NOT a smaller population. It
     * defaults to `limit=20` (line ~179) and accepts up to 1500, over the same registry. So
     * `?limit=1500` returns the full set and the two endpoints agree.
     */

    /* Decides which agents route through citation grounding. Derived from three signals the
     * registry already carries, and labelled as derived so nobody reads it as editorial. */
    producesCitations: (() => {
      const skills = JSON.stringify((a as any).agentSkills ?? '');
      const caps = JSON.stringify(a.capabilities ?? []);
      const perf = JSON.stringify((a as any).performanceTargets ?? '');
      const outs = JSON.stringify((a as any).outputFormats ?? '');
      return /SKILL-CITATION|citation/i.test(skills)
        || /citation/i.test(caps)
        || /citationVerificationRate/i.test(perf)
        || /citation/i.test(outs);
    })(),

    /* NSP keeps an 18-entry cost table that will silently drift from our ladder. We do not
     * price per agent — cost follows the model the router picks — so the honest answer is the
     * agent's tier plus its model preference, and NSP can join that to our published ladder.
     * Inventing a per-agent credit number we do not track would be worse than exposing the
     * inputs to one. */
    costBasis: {
      tier: a.tier ?? null,
      preferredModels: a.preferredModels ?? [],
      subscriptionGating: (a as any).subscriptionGating ?? null,
      note: 'Cost follows the model the router selects, not the agent. Join tier + preferredModels to the published model ladder.',
    },

    /* Required for "assign, don't prompt": without a declared shape a skill stays a
     * free-text box rather than a form. */
    inputTypes: (a as any).inputTypes ?? [],
    outputSchema: (a as any).outputFormats ?? [],

    /* NSP dispatches by taskType (32 in use) while we list by agentId, so they cannot join
     * the two without guessing. `operationModes` is the registry's own task-shape field. */
    taskTypes: (a as any).operationModes ?? [],

    /* So a removed skill degrades honestly instead of 404-ing a lawyer mid-matter. */
    deprecated: String((a as any).status ?? '').toLowerCase() === 'deprecated'
      || (a as any).deprecated === true,
    since: (a as any).since ?? a.version ?? null,
  };
}

router.get('/', async (req: Request, res: Response) => {
  try {
    const all = getAllAgents();
    const probes = await probeAuditLog();

    const qstr = (v: unknown): string | undefined =>
      typeof v === 'string' ? v : Array.isArray(v) && typeof v[0] === 'string' ? v[0] : undefined;
    const search = qstr(req.query.search)?.toLowerCase().trim();
    const tier = qstr(req.query.tier);
    const practiceArea = qstr(req.query.practiceArea)?.toLowerCase().trim();
    const jurisdictionFilter = qstr(req.query.jurisdiction)?.toUpperCase().trim();
    const statusFilter = qstr(req.query.status)?.toLowerCase().trim();
    const limit = Math.min(Number(req.query.limit ?? 20) || 20, 1500);
    const offset = Math.max(Number(req.query.offset ?? 0) || 0, 0);

    const shaped = all.map(a => shapeAgent(a, probes.get(a.id)));

    const filtered = shaped.filter(row => {
      if (search) {
        const hay = `${row.name} ${row.description} ${row.practice_area} ${(row.capabilities || []).join(' ')}`.toLowerCase();
        if (!hay.includes(search)) return false;
      }
      if (tier && tier !== 'all' && row.tier !== tier) return false;
      if (practiceArea && practiceArea !== 'all' &&
          row.practice_area?.toLowerCase() !== practiceArea &&
          row.category?.toLowerCase() !== practiceArea) return false;
      // Jurisdiction filter: bare 'ALL' = no filter; explicit code (IN/UK/US/
      // EU/SG/GC) must match a tag; sentinel 'ALL_JURISDICTION' selects only
      // cross-jurisdiction agents tagged literally 'ALL' or 'DEFAULT'.
      if (jurisdictionFilter && jurisdictionFilter !== 'ALL') {
        const jurs = row.jurisdiction as string[];
        if (jurisdictionFilter === 'ALL_JURISDICTION') {
          if (!jurs.includes('ALL') && !jurs.includes('DEFAULT')) return false;
        } else if (!jurs.includes(jurisdictionFilter)) return false;
      }
      if (statusFilter && statusFilter !== 'all' && row.status !== statusFilter) return false;
      return true;
    });

    // `counts` is filter-aware (drives the live header chips); `globalCounts`
    // is computed over the full registry (drives the "/ TOTAL" denominator).
    const aggregate = (rows: typeof shaped) => {
      const c = {
        total: rows.length,
        byStatus: { available: 0, degraded: 0, disabled: 0 } as Record<string, number>,
        byJurisdiction: {} as Record<string, number>,
        byTier: {} as Record<string, number>,
        // task-336: per-tier × per-status cross-tab so the L1–L5 cards on
        // /console/agent-registry can render available/total without
        // re-deriving from the current page slice (which is only ~20 rows).
        // Additive only — NV-API-CONTRACT-001.
        byTierStatus: {} as Record<string, { available: number; degraded: number; disabled: number; total: number }>,
        // task-336: registry uses `tier` for executive/senior/specialist/…
        // and `romaLevel` for L1-L5. The Agent Registry UI's tier cards are
        // labelled L1–L5 (ROMA levels), so we expose ROMA-level aggregates
        // alongside the existing tier ones. Additive only.
        byRomaLevel: {} as Record<string, number>,
        byRomaLevelStatus: {} as Record<string, { available: number; degraded: number; disabled: number; total: number }>,
      };
      for (const r of rows) {
        c.byStatus[r.status] = (c.byStatus[r.status] || 0) + 1;
        for (const j of r.jurisdiction as string[]) {
          c.byJurisdiction[j] = (c.byJurisdiction[j] || 0) + 1;
        }
        const t = r.tier || 'unknown';
        c.byTier[t] = (c.byTier[t] || 0) + 1;
        const ts = c.byTierStatus[t] || (c.byTierStatus[t] = { available: 0, degraded: 0, disabled: 0, total: 0 });
        ts.total += 1;
        if (r.status === 'available' || r.status === 'degraded' || r.status === 'disabled') {
          ts[r.status] += 1;
        }
        const rl = (r.romaLevel || r.roma_level || 'unknown') as string;
        c.byRomaLevel[rl] = (c.byRomaLevel[rl] || 0) + 1;
        const rls = c.byRomaLevelStatus[rl] || (c.byRomaLevelStatus[rl] = { available: 0, degraded: 0, disabled: 0, total: 0 });
        rls.total += 1;
        if (r.status === 'available' || r.status === 'degraded' || r.status === 'disabled') {
          rls[r.status] += 1;
        }
      }
      return c;
    };
    const counts = aggregate(filtered);
    const globalCounts = aggregate(shaped);

    const page = filtered.slice(offset, offset + limit);

    const runtimeTotal = getRegistryStats().totalAgents;

    // Registry cardinality invariant: runtime must expose the full active set.
    if (shaped.length !== runtimeTotal) {
      logger.warn({
        route: 'GET /api/jrx/agents',
        cardinalityInvariant: 'FAIL',
        registryTotal: shaped.length,
        expected: runtimeTotal,
      });
    }

    res.json({
      success: true,
      data: {
        total: filtered.length,
        registryTotal: shaped.length,
        loaded: shaped.length,
        agents: page,
        counts,
        globalCounts,
      },
    });
  } catch (error: any) {
    logger.error({ route: 'GET /api/jrx/agents', error: error?.message });
    safeError(res, error, 500);
  }
});

router.get('/tier/:tier', (req: Request, res: Response) => {
  const { tier } = req.params;
  const agents = getAllAgents().filter(a => a.tier === tier).map(a => shapeAgent(a));
  res.json({ success: true, data: { tier, agents } });
});

// NV-AGENT-EXEC-REAL-001: real single-agent execution through the Queen safety
// pipeline (decompose → capability-routed agent → safety ring → synthesis). The
// optional `agentId` is plumbed as a routing hint; the Queen still enforces
// capability/tier gating, and the response carries the ACTUAL synthesized
// output plus real token/cost metrics from the run.
//
// Register BEFORE `/:agentId` so path literals (`run` / `execute`) are never
// captured as agent ids.
const ORCH_TYPES = ['code', 'research', 'creative', 'analysis', 'general'] as const;

async function runSingleAgentExecute(req: Request, res: Response): Promise<void> {
  try {
    const body = req.body ?? {};
    const agentId = body.agentId ?? body.agentKey;
    const task = body.task ?? body.prompt ?? body.message;
    const type = body.type;
    const jurisdiction = body.jurisdiction;
    const format = body.format;
    const sessionId = body.sessionId ?? body.context?.sessionId;
    if (!task || typeof task !== 'string' || task.trim().length === 0) {
      sendApiError(res, 'BAD_REQUEST', { overrideMessage: 'task (non-empty string) is required' });
      return;
    }
    const u: any = (req as any).user ?? (req as any).sdkContext ?? {};
    const { queenOrchestrator } = await import('../orchestration/jrx-queen-orchestrator.js');
    const { wantsNspNymBestOutcome, wantsPartnerSyncLean } = await import('../utils/jrx-partner-platform.js');
    const forceBest = wantsNspNymBestOutcome(req);
    const allowLean = forceBest
      ? false
      : wantsPartnerSyncLean(req, {
          explicitAgentKey: agentId ? String(agentId) : undefined,
          taskType: typeof type === 'string' ? type : undefined,
        });
    let effectiveSessionId = typeof sessionId === 'string' ? sessionId.trim() : '';
    if (forceBest && !effectiveSessionId) {
      try {
        const { mintEcosystemPromptSessionId } = await import('../services/jrx-prompt-session-store.js');
        const { resolvePartnerPlatformCode } = await import('../utils/jrx-partner-platform.js');
        effectiveSessionId = mintEcosystemPromptSessionId({
          platform: resolvePartnerPlatformCode(req),
          userId: u.id ?? u.userId ?? (u.applicationId ? `sdk_app_${u.applicationId}` : undefined),
          orgId: u.orgId ?? u.org_id ?? u.organizationId,
          explicitSessionId: sessionId,
        });
      } catch {
        effectiveSessionId = `jrx-sess-agents-${Date.now().toString(36)}`;
      }
    }
    const orchReq: any = {
      prompt: task,
      type: ORCH_TYPES.includes(type) ? type : 'general',
      // NV-LEGAL-INTEL-FORCE-001 — ecosystem platforms get Queen depth, not forced single-agent lean
      orchestrationMode: forceBest && !allowLean ? 'auto' : 'single_agent',
      userId: u.id ?? u.userId ?? (u.applicationId ? `sdk_app_${u.applicationId}` : undefined),
      sessionId: effectiveSessionId || undefined,
      jurisdiction: jurisdiction || u.jurisdiction || 'IN',
      tenantId: u.orgId ?? u.org_id ?? u.organizationId,
      tier: u.tier ?? u.subscriptionTier,
      format: format || undefined,
      context: {
        ...(body.context && typeof body.context === 'object' ? body.context : {}),
        ...(agentId ? { userPreferences: { requestedAgentId: String(agentId) } } : {}),
        forceLegalBestOutcome: forceBest,
      },
      partnerSyncLean: allowLean,
      agentKey: agentId ? String(agentId) : undefined,
      enableRAG: true,
      enableCitationVerification: true,
      enableHallucinationCheck: true,
      enableCoT: forceBest,
      forceLegalBestOutcome: forceBest,
    };
    const result = await queenOrchestrator.orchestrate(orchReq);
    const tokensIn = result.metadata?.totalTokens?.input ?? 0;
    const tokensOut = result.metadata?.totalTokens?.output ?? 0;
    res.json({
      success: result.success,
      data: {
        executionId: orchReq.orchestrationId,
        agentId: agentId ?? result.executions?.[0]?.agentId ?? null,
        status: result.success ? 'completed' : 'failed',
        // AgentsApi.run / Jurexio CitizenClient expect `output` at top of data or nested.
        output: result.synthesizedOutput,
        result: {
          task,
          output: result.synthesizedOutput,
          agentsUsed: (result.executions ?? []).map((e) => ({
            agentId: e.agentId, agentName: e.agentName, status: e.status,
          })),
          metrics: {
            duration: result.metadata?.totalTime ?? 0,
            tokensUsed: tokensIn + tokensOut,
            tokensIn,
            tokensOut,
            cost: result.metadata?.totalCost ?? 0,
            pattern: result.metadata?.orchestrationPattern,
          },
        },
      },
    });
  } catch (error: any) {
    logger.error('agent_execute_failed', { error: error?.message });
    safeError(res, error, 500);
  }
}

/** SDK AgentsApi.run → used by Jurexio CitizenClient (NYM). */
router.post('/run', (req: Request, res: Response) => {
  void runSingleAgentExecute(req, res);
});

router.post('/execute', (req: Request, res: Response) => {
  void runSingleAgentExecute(req, res);
});

// NV-AGENT-EXEC-REAL-001: real multi-agent orchestration through the Queen.
// `strategy` maps to a real Queen orchestration mode; the response reflects the
// ACTUAL per-agent executions and real token/cost metrics from the run.
const STRATEGY_MODE: Record<string, string> = {
  parallel: 'parallel', sequential: 'sequential', swarm: 'swarm',
  hierarchical: 'hierarchical', dag: 'dag', single: 'single_agent',
};
router.post('/orchestrate', async (req: Request, res: Response) => {
  try {
    const { task, agents, strategy, type, jurisdiction, sessionId } = req.body ?? {};
    if (!task || typeof task !== 'string' || task.trim().length === 0) {
      sendApiError(res, 'BAD_REQUEST', { overrideMessage: 'task (non-empty string) is required' });
      return;
    }
    const u: any = (req as any).user ?? (req as any).sdkContext ?? {};
    const { queenOrchestrator } = await import('../orchestration/jrx-queen-orchestrator.js');
    const orchReq: any = {
      prompt: task,
      type: ORCH_TYPES.includes(type) ? type : 'general',
      orchestrationMode: STRATEGY_MODE[String(strategy || 'parallel')] ?? 'parallel',
      userId: u.id ?? u.userId ?? (u.applicationId ? `sdk_app_${u.applicationId}` : undefined),
      sessionId,
      jurisdiction: jurisdiction || u.jurisdiction || undefined,
      tenantId: u.orgId ?? u.org_id ?? u.organizationId,
      tier: u.tier ?? u.subscriptionTier,
      preferences: Array.isArray(agents) && agents.length > 0 ? { maxAgents: agents.length } : undefined,
    };
    const result = await queenOrchestrator.orchestrate(orchReq);
    const tokensIn = result.metadata?.totalTokens?.input ?? 0;
    const tokensOut = result.metadata?.totalTokens?.output ?? 0;
    res.json({
      success: result.success,
      data: {
        orchestrationId: orchReq.orchestrationId,
        task,
        strategy: orchReq.orchestrationMode,
        status: result.success ? 'completed' : 'failed',
        agents: (result.executions ?? []).map((e) => e.agentId),
        results: (result.executions ?? []).map((e) => ({
          agentId: e.agentId,
          agentName: e.agentName,
          status: e.status,
          output: typeof e.output === 'string' ? e.output : (e.output?.content ?? ''),
        })),
        synthesizedOutput: result.synthesizedOutput,
        metrics: {
          duration: result.metadata?.totalTime ?? 0,
          tokensUsed: tokensIn + tokensOut,
          cost: result.metadata?.totalCost ?? 0,
          agentsUsed: result.metadata?.agentsUsed ?? (result.executions?.length ?? 0),
          pattern: result.metadata?.orchestrationPattern,
        },
      },
    });
  } catch (error: any) {
    logger.error('agent_orchestrate_failed', { error: error?.message });
    safeError(res, error, 500);
  }
});

router.get('/:agentId', async (req: Request, res: Response) => {
  const agentId = String(req.params.agentId);
  const agent = getAgent(agentId);
  if (!agent) {
    safeError(res, 'Agent not found', 404);
    return;
  }
  const probes = await probeAuditLog();
  res.json({ success: true, data: shapeAgent(agent, probes.get(agentId)) });
});

export { router as agentRouter };
