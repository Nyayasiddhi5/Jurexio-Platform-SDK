/**
 * jrx-governance-aggregators.ts — Task #176 / B2 (2026-05-12)
 * ─────────────────────────────────────────────────────────────────────────────
 * Thin read-only aggregator routes that back ten Governance + Orchestration
 * console pages currently falling back to /api/jrx/admin/audit or
 * /api/jrx/audit/guardrail-stats. Every route derives its shape from existing
 * tables — no new schema, no writes.
 *
 * Routes (all gated to super_admin / compliance_officer):
 *   GET /hitl/queue                          ← nv_schema.hitl_reviews
 *   GET /orchestration/lineage               ← nv_schema.data_lineage_events
 *   GET /orchestration/memory                ← nv_schema.memory_entries
 *   GET /governance/surface                  ← aggregated counts
 *   GET /enforcement                         ← nv_audit_logs (block/enforce)
 *   GET /llm-judge                           ← nv_schema.hallucination_checks
 *   GET /adversarial                         ← nv_schema.adversarial_test_runs
 *   GET /orchestration/policies              ← nv_schema.nv_grpo_policy_snapshots
 *   GET /orchestration/router-decisions      ← public.nv_router_decisions
 *   GET /orchestration/cam/reviews           ← nv_schema.bias_analysis_log
 *
 * Each handler tolerates a missing table by catching the PG 42P01 error and
 * returning an empty (but well-shaped) payload, so a fresh dev DB still
 * renders the pages without 500s.
 */

import { Router, Request, Response } from 'express';
import { sql } from 'drizzle-orm';
import { db as rawDb } from '../db/index.js';
import { authenticateToken, requireRole } from '../middleware/jrx-auth.js';
import { createLogger } from '../utils/logger.js';
import { sendApiError, safeError } from '../utils/jrx-api-error.js';

const logger = createLogger('./jrx-governance-aggregators');
const router = Router();

const ALLOWED_ROLES = ['super_admin', 'compliance_officer'] as const;
const gate = requireRole(...ALLOWED_ROLES);

function rowsOf(result: any): any[] {
  if (!result) return [];
  return (result.rows ?? result ?? []) as any[];
}

function clampLimit(raw: any, def = 50, max = 500): number {
  const n = Number(raw ?? def);
  if (!Number.isFinite(n) || n <= 0) return def;
  return Math.min(Math.floor(n), max);
}

function clampOffset(raw: any): number {
  const n = Number(raw ?? 0);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

// ─── 1. HITL queue ──────────────────────────────────────────────────────────
router.get('/hitl/queue', authenticateToken, gate, async (req: Request, res: Response) => {
  if (!rawDb) { sendApiError(res, 'DB_UNAVAILABLE', { status: 503 }); return; }
  const limit = clampLimit(req.query.limit, 50);
  const offset = clampOffset(req.query.offset);
  const status = (req.query.status as string | undefined) ?? 'pending';
  try {
    const r = await rawDb.execute(sql`
      SELECT id, request_id, agent_key, user_id, tenant_id, risk_level,
             review_status, reviewer_decision, reviewer_id,
             created_at, sla_deadline, reviewed_at
      FROM nv_schema.hitl_reviews
      WHERE (${status}::text = 'all' OR review_status = ${status})
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `).catch((e: any) => { logger.warn('hitl_queue_failed', { err: String(e) }); return { rows: [] }; });

    const items = rowsOf(r).map((x: any) => ({
      id: x.id,
      requestId: x.request_id,
      agentId: x.agent_key,
      decision: x.reviewer_decision ?? null,
      requestedAt: x.created_at,
      requestedBy: x.user_id ?? null,
      tenantId: x.tenant_id ?? null,
      status: x.review_status,
      riskLevel: x.risk_level,
      reviewerId: x.reviewer_id ?? null,
      slaDeadline: x.sla_deadline ?? null,
      reviewedAt: x.reviewed_at ?? null,
    }));
    res.json({ success: true, data: { items, total: items.length, limit, offset } });
  } catch (err: any) {
    logger.error('hitl_queue_error', { err: String(err) });
    sendApiError(res, 'BAD_REQUEST', { status: 500, overrideMessage: 'Failed to fetch HITL queue' });
  }
});

// ─── 2a. Orchestration lineage (path-param) ─────────────────────────────────
// Returns the IronLedger hash-chain shape expected by client/src/pages/
// orchestration/LineagePage.tsx ({ success, requestId, chainLength,
// auditChain, summary }). Data is sourced from the CANONICAL live hash-chained
// ledger `nv_schema.nv_audit_logs` (NV-AUDIT-SURFACE-001 — the same table
// /api/jrx/audit/chain reads; the legacy `public.nv_audit_logs` path is retired)
// filtered by the requestId/traceId stored in the payload jsonb.
router.get('/orchestration/lineage/:requestId', authenticateToken, gate, async (req: Request, res: Response) => {
  if (!rawDb) { sendApiError(res, 'DB_UNAVAILABLE', { status: 503 }); return; }
  const requestId = String(req.params.requestId || '').trim();
  if (!requestId) {
    sendApiError(res, 'BAD_REQUEST', { overrideMessage: 'requestId required' });
    return;
  }
  try {
    // NV-AUDIT-SURFACE-001: read the LIVE hash-chained ledger
    // (nv_schema.nv_audit_logs — id/event_type/payload/hashes/created_at). The
    // per-request detail (route, status, trace id…) lives in the payload jsonb.
    const r = await rawDb.execute(sql`
      SELECT id::text AS id, event_type, payload, previous_hash, record_hash, created_at
      FROM nv_schema.nv_audit_logs
      WHERE payload->>'traceId' = ${requestId}
         OR payload->>'trace_id' = ${requestId}
         OR payload->>'requestId' = ${requestId}
         OR payload->>'request_id' = ${requestId}
      ORDER BY created_at ASC
      LIMIT 500
    `).catch((e: any) => { logger.warn('lineage_path_failed', { err: String(e), requestId }); return { rows: [] }; });

    const rows = rowsOf(r);
    const auditChain = rows.map((x: any) => ({
      id: String(x.id),
      eventType: x.event_type,
      createdAt: x.created_at,
      recordHash: x.record_hash,
      previousHash: x.previous_hash,
      payload: x.payload ?? {},
    }));

    // Summary derived from the chain's coalesced payloads (each event_type
    // contributes a sliver; we coalesce across the chain).
    const meta: Record<string, any> = {};
    for (const x of rows) Object.assign(meta, (x.payload ?? {}));
    const lastPayload: Record<string, any> = rows.length ? (rows[rows.length - 1].payload ?? {}) : {};
    const lastStatus = Number(lastPayload.statusCode ?? lastPayload.status_code ?? 0);
    const lastLatency = Number(lastPayload.latencyMs ?? lastPayload.latency_ms ?? 0);
    const summary = {
      success: lastStatus > 0 ? lastStatus < 400 : null,
      agentKey: meta.agent_key ?? meta.agentKey ?? null,
      jurisdiction: meta.jurisdiction ?? null,
      tier: meta.tier ?? null,
      model: meta.picked_model_id ?? meta.model ?? null,
      latencyMs: lastLatency,
      citations: Array.isArray(meta.citations) ? meta.citations.length : (meta.citations ?? null),
      inputHash: meta.input_hash ?? meta.inputHash ?? null,
      outputHash: meta.output_hash ?? meta.outputHash ?? null,
    };

    res.json({
      success: true,
      requestId,
      chainLength: auditChain.length,
      auditChain,
      summary,
    });
  } catch (err: any) {
    logger.error('lineage_path_error', { err: String(err) });
    sendApiError(res, 'BAD_REQUEST', { status: 500, overrideMessage: 'Failed to fetch lineage' });
  }
});

// ─── 2b. Orchestration lineage (list / query-param) ─────────────────────────
router.get('/orchestration/lineage', authenticateToken, gate, async (req: Request, res: Response) => {
  if (!rawDb) { sendApiError(res, 'DB_UNAVAILABLE', { status: 503 }); return; }
  const orchestrationId = (req.query.orchestrationId ?? req.query.requestId) as string | undefined;
  const limit = clampLimit(req.query.limit, 100);
  try {
    const r = orchestrationId
      ? await rawDb.execute(sql`
          SELECT id, request_id, user_id, org_id, agent_key, model_used, provider,
                 input_hash, output_hash, rag_sources, pii_detected,
                 latency_ms, compliance_flags, created_at
          FROM nv_schema.data_lineage_events
          WHERE request_id = ${orchestrationId}
          ORDER BY created_at ASC
          LIMIT ${limit}
        `).catch((e: any) => { logger.warn('lineage_failed', { err: String(e) }); return { rows: [] }; })
      : await rawDb.execute(sql`
          SELECT id, request_id, user_id, org_id, agent_key, model_used, provider,
                 input_hash, output_hash, rag_sources, pii_detected,
                 latency_ms, compliance_flags, created_at
          FROM nv_schema.data_lineage_events
          ORDER BY created_at DESC
          LIMIT ${limit}
        `).catch((e: any) => { logger.warn('lineage_failed', { err: String(e) }); return { rows: [] }; });

    const steps = rowsOf(r).map((x: any, i: number) => ({
      id: x.id,
      stepIndex: i,
      agent: x.agent_key,
      model: x.model_used,
      provider: x.provider,
      input: x.input_hash,
      output: x.output_hash,
      ragSources: x.rag_sources ?? [],
      piiDetected: x.pii_detected ?? [],
      complianceFlags: x.compliance_flags ?? [],
      latencyMs: x.latency_ms ?? 0,
      timestamp: x.created_at,
      parentStepId: i > 0 ? rowsOf(r)[i - 1]?.id ?? null : null,
      orchestrationId: x.request_id,
    }));
    res.json({ success: true, data: { orchestrationId: orchestrationId ?? null, steps, total: steps.length } });
  } catch (err: any) {
    logger.error('lineage_error', { err: String(err) });
    sendApiError(res, 'BAD_REQUEST', { status: 500, overrideMessage: 'Failed to fetch lineage' });
  }
});

// ─── 3. Orchestration memory ────────────────────────────────────────────────
router.get('/orchestration/memory', authenticateToken, gate, async (req: Request, res: Response) => {
  if (!rawDb) { sendApiError(res, 'DB_UNAVAILABLE', { status: 503 }); return; }
  const limit = clampLimit(req.query.limit, 50);
  const offset = clampOffset(req.query.offset);
  const tenantId = (req.query.tenantId as string | undefined) ?? null;
  const search = (req.query.q as string | undefined)?.trim() ?? '';
  try {
    const r = await rawDb.execute(sql`
      SELECT id, user_id, tenant_id, memory_type, scope, matter_id, session_id,
             key, value, importance, access_count, last_accessed_at, expires_at, created_at
      FROM nv_schema.memory_entries
      WHERE (${tenantId}::text IS NULL OR tenant_id = ${tenantId})
        AND (${search}::text = '' OR key ILIKE '%' || ${search} || '%')
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `).catch((e: any) => { logger.warn('memory_failed', { err: String(e) }); return { rows: [] }; });

    const items = rowsOf(r).map((x: any) => ({
      id: x.id,
      userId: x.user_id,
      tenantId: x.tenant_id,
      memoryType: x.memory_type,
      scope: x.scope,
      matterId: x.matter_id,
      sessionId: x.session_id,
      key: x.key,
      value: x.value,
      importance: x.importance,
      accessCount: x.access_count,
      lastAccessedAt: x.last_accessed_at,
      expiresAt: x.expires_at,
      createdAt: x.created_at,
    }));
    res.json({ success: true, data: { items, total: items.length, limit, offset, search: search || null } });
  } catch (err: any) {
    logger.error('memory_error', { err: String(err) });
    sendApiError(res, 'BAD_REQUEST', { status: 500, overrideMessage: 'Failed to fetch memory' });
  }
});

// ─── 4. Governance surface ──────────────────────────────────────────────────
router.get('/governance/surface', authenticateToken, gate, async (_req: Request, res: Response) => {
  if (!rawDb) { sendApiError(res, 'DB_UNAVAILABLE', { status: 503 }); return; }
  try {
    const safe = (p: Promise<any>) => p.catch(() => ({ rows: [{ c: 0 }] }));
    const [policies, hitlPending, hitlTotal, blocks24h, audit24h, incidentsOpen, adversarial] = await Promise.all([
      safe(rawDb.execute(sql`SELECT COUNT(*)::int AS c FROM nv_schema.nv_grpo_policy_snapshots`)),
      safe(rawDb.execute(sql`SELECT COUNT(*)::int AS c FROM nv_schema.hitl_reviews WHERE review_status = 'pending'`)),
      safe(rawDb.execute(sql`SELECT COUNT(*)::int AS c FROM nv_schema.hitl_reviews`)),
      safe(rawDb.execute(sql`SELECT COUNT(*)::int AS c FROM nv_schema.nv_audit_logs WHERE event_type IN ('guardrail_block','enforcement_action','orchestration.safety-verdict:review') AND created_at > NOW() - INTERVAL '24 hours'`)),
      safe(rawDb.execute(sql`SELECT COUNT(*)::int AS c FROM nv_schema.nv_audit_logs WHERE created_at > NOW() - INTERVAL '24 hours'`)),
      safe(rawDb.execute(sql`SELECT COUNT(*)::int AS c FROM nv_schema.ai_incidents WHERE status = 'open'`)),
      safe(rawDb.execute(sql`SELECT COUNT(*)::int AS c FROM nv_schema.adversarial_test_runs WHERE created_at > NOW() - INTERVAL '7 days'`)),
    ]);

    const num = (r: any) => Number(rowsOf(r)[0]?.c ?? 0);
    const totalAudit = num(audit24h);
    const totalBlocks = num(blocks24h);

    res.json({
      success: true,
      data: {
        policies: { total: num(policies) },
        hitl: { pending: num(hitlPending), total: num(hitlTotal) },
        guardrails: {
          requests24h: totalAudit,
          violations24h: totalBlocks,
          passRate: totalAudit > 0 ? Math.max(0, (totalAudit - totalBlocks) / totalAudit) : 1,
        },
        decisions: { auditEvents24h: totalAudit },
        incidents: { open: num(incidentsOpen) },
        adversarial: { last7d: num(adversarial) },
        lastUpdated: new Date().toISOString(),
      },
    });
  } catch (err: any) {
    logger.error('surface_error', { err: String(err) });
    sendApiError(res, 'BAD_REQUEST', { status: 500, overrideMessage: 'Failed to fetch governance surface' });
  }
});

// ─── 5. Enforcement actions ─────────────────────────────────────────────────
router.get('/enforcement', authenticateToken, gate, async (req: Request, res: Response) => {
  if (!rawDb) { sendApiError(res, 'DB_UNAVAILABLE', { status: 503 }); return; }
  const limit = clampLimit(req.query.limit, 100);
  const offset = clampOffset(req.query.offset);
  try {
    const r = await rawDb.execute(sql`
      SELECT id::text AS id, event_type, payload, created_at
      FROM nv_schema.nv_audit_logs
      WHERE event_type IN ('guardrail_block','guardrail_flag','enforcement_action','policy_violation','orchestration.safety-verdict:review','orchestration.safety-verdict:pass')
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `).catch((e: any) => { logger.warn('enforcement_failed', { err: String(e) }); return { rows: [] }; });

    const actions = rowsOf(r).map((x: any) => {
      const payload = typeof x.payload === 'string' ? JSON.parse(x.payload || '{}') : (x.payload ?? {});
      return {
        id: x.id,
        eventType: x.event_type,
        action: x.event_type,
        route: payload.route ?? payload.endpoint ?? null,
        method: payload.method ?? null,
        statusCode: payload.statusCode ?? null,
        userId: payload.userId ?? null,
        orgId: payload.orgId ?? payload.org_id ?? null,
        traceId: payload.traceId ?? payload.requestId ?? null,
        metadata: payload,
        createdAt: x.created_at,
      };
    });
    res.json({ success: true, data: { actions, total: actions.length, limit, offset } });
  } catch (err: any) {
    logger.error('enforcement_error', { err: String(err) });
    sendApiError(res, 'BAD_REQUEST', { status: 500, overrideMessage: 'Failed to fetch enforcement actions' });
  }
});

// ─── 6. LLM judge evaluations ───────────────────────────────────────────────
router.get('/llm-judge', authenticateToken, gate, async (req: Request, res: Response) => {
  if (!rawDb) { sendApiError(res, 'DB_UNAVAILABLE', { status: 503 }); return; }
  const limit = clampLimit(req.query.limit, 50);
  const offset = clampOffset(req.query.offset);
  try {
    const r = await rawDb.execute(sql`
      SELECT id, request_id, user_id, tenant_id, agent_key,
             confidence_score, grounding_score, flagged_claims,
             verified_citations, unverified_citations, status, created_at
      FROM nv_schema.hallucination_checks
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `).catch((e: any) => { logger.warn('llm_judge_failed', { err: String(e) }); return { rows: [] }; });

    const evaluations = rowsOf(r).map((x: any) => ({
      id: x.id,
      requestId: x.request_id,
      agentId: x.agent_key,
      tenantId: x.tenant_id,
      confidenceScore: x.confidence_score == null ? null : Number(x.confidence_score),
      groundingScore: x.grounding_score == null ? null : Number(x.grounding_score),
      flaggedClaims: x.flagged_claims ?? [],
      verifiedCitations: x.verified_citations ?? [],
      unverifiedCitations: x.unverified_citations ?? [],
      status: x.status,
      createdAt: x.created_at,
    }));
    res.json({ success: true, data: { evaluations, total: evaluations.length, limit, offset } });
  } catch (err: any) {
    logger.error('llm_judge_error', { err: String(err) });
    sendApiError(res, 'BAD_REQUEST', { status: 500, overrideMessage: 'Failed to fetch LLM judge evaluations' });
  }
});

// ─── 7. Adversarial test results ────────────────────────────────────────────
async function adversarialHistoryHandler(req: Request, res: Response) {
  if (!rawDb) { sendApiError(res, 'DB_UNAVAILABLE', { status: 503 }); return; }
  const limit = clampLimit(req.query.limit, 50);
  const offset = clampOffset(req.query.offset);
  try {
    const r = await rawDb.execute(sql`
      SELECT id, agent_key, test_name, attack_type, prompts_tested,
             vulnerabilities_found, severity, results, ran_by, created_at
      FROM nv_schema.adversarial_test_runs
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `).catch((e: any) => { logger.warn('adversarial_failed', { err: String(e) }); return { rows: [] }; });

    const tests = rowsOf(r).map((x: any) => ({
      id: x.id,
      agentId: x.agent_key,
      testName: x.test_name,
      attackType: x.attack_type,
      promptsTested: x.prompts_tested ?? 0,
      vulnerabilitiesFound: x.vulnerabilities_found ?? 0,
      severity: x.severity,
      results: x.results ?? [],
      ranBy: x.ran_by,
      createdAt: x.created_at,
      passed: (x.vulnerabilities_found ?? 0) === 0,
    }));
    res.json({ success: true, data: { tests, total: tests.length, limit, offset } });
  } catch (err: any) {
    logger.error('adversarial_error', { err: String(err) });
    sendApiError(res, 'BAD_REQUEST', { status: 500, overrideMessage: 'Failed to fetch adversarial tests' });
  }
}

router.get('/adversarial', authenticateToken, gate, adversarialHistoryHandler);
// Legacy aliases consumed by client/src/pages/adversarial-testing.tsx — kept
// alongside the canonical /adversarial path until that page migrates fully.
router.get('/adversarial/history', authenticateToken, gate, adversarialHistoryHandler);

router.get('/adversarial/stats', authenticateToken, gate, async (_req: Request, res: Response) => {
  if (!rawDb) { sendApiError(res, 'DB_UNAVAILABLE', { status: 503 }); return; }
  try {
    const r = await rawDb.execute(sql`
      SELECT
        COUNT(*)::int AS total_tests,
        SUM(CASE WHEN COALESCE(vulnerabilities_found,0) = 0 THEN 1 ELSE 0 END)::int AS passed,
        SUM(COALESCE(vulnerabilities_found,0))::int AS vulnerabilities,
        SUM(CASE WHEN severity = 'critical' THEN 1 ELSE 0 END)::int AS critical
      FROM nv_schema.adversarial_test_runs
    `).catch((e: any) => { logger.warn('adversarial_stats_failed', { err: String(e) }); return { rows: [{ total_tests: 0, passed: 0, vulnerabilities: 0, critical: 0 }] }; });
    const row = rowsOf(r)[0] ?? { total_tests: 0, passed: 0, vulnerabilities: 0, critical: 0 };
    const total = Number(row.total_tests ?? 0);
    const passed = Number(row.passed ?? 0);
    res.json({
      success: true,
      data: {
        totalTests: total,
        passed,
        vulnerabilities: Number(row.vulnerabilities ?? 0),
        critical: Number(row.critical ?? 0),
        passRate: total > 0 ? Math.round((passed / total) * 100) : 0,
      },
    });
  } catch (err: any) {
    logger.error('adversarial_stats_error', { err: String(err) });
    sendApiError(res, 'BAD_REQUEST', { status: 500, overrideMessage: 'Failed to fetch adversarial stats' });
  }
});

// ─── 8. Orchestration policies ──────────────────────────────────────────────
router.get('/orchestration/policies', authenticateToken, gate, async (req: Request, res: Response) => {
  if (!rawDb) { sendApiError(res, 'DB_UNAVAILABLE', { status: 503 }); return; }
  const limit = clampLimit(req.query.limit, 50);
  try {
    const [snapshots, runStats] = await Promise.all([
      rawDb.execute(sql`
        SELECT id, policy_snapshot, update_count, created_at
        FROM nv_schema.nv_grpo_policy_snapshots
        ORDER BY created_at DESC
        LIMIT ${limit}
      `).catch((e: any) => { logger.warn('policies_failed', { err: String(e) }); return { rows: [] }; }),
      rawDb.execute(sql`
        SELECT pattern_key, COUNT(*)::int AS runs, AVG(reward) AS avg_reward,
               BOOL_OR(policy_updated) AS has_update
        FROM nv_schema.nv_grpo_runs
        WHERE created_at > NOW() - INTERVAL '7 days'
        GROUP BY pattern_key
        ORDER BY runs DESC
      `).catch(() => ({ rows: [] })),
    ]);

    const policies = rowsOf(snapshots).map((x: any) => ({
      id: x.id,
      snapshot: x.policy_snapshot,
      updateCount: x.update_count ?? 0,
      createdAt: x.created_at,
      status: 'active',
    }));
    const byPattern = rowsOf(runStats).map((x: any) => ({
      patternKey: x.pattern_key,
      runs: Number(x.runs ?? 0),
      avgReward: x.avg_reward == null ? null : Number(x.avg_reward),
      hasUpdate: !!x.has_update,
    }));
    res.json({
      success: true,
      data: {
        policies,
        countByStatus: { active: policies.length },
        byPattern,
        total: policies.length,
      },
    });
  } catch (err: any) {
    logger.error('policies_error', { err: String(err) });
    sendApiError(res, 'BAD_REQUEST', { status: 500, overrideMessage: 'Failed to fetch orchestration policies' });
  }
});

// ─── 9. Router decisions ────────────────────────────────────────────────────
// Response shape is a superset of /api/jrx/observability/router-stats/persistent
// (recent + aggregatesByModel) so that client/src/pages/orchestration/
// RouterDecisionsPage.tsx can be repointed with no UI changes, while new
// callers get the canonical `decisions` projection.
router.get('/orchestration/router-decisions', authenticateToken, gate, async (req: Request, res: Response) => {
  if (!rawDb) { sendApiError(res, 'DB_UNAVAILABLE', { status: 503 }); return; }
  const limit = clampLimit(req.query.limit, 100);
  const offset = clampOffset(req.query.offset);
  const provider = (req.query.provider as string | undefined) ?? null;
  const model = (req.query.model as string | undefined) ?? null;
  const since = (req.query.since as string | undefined) ?? null;
  const okQ = req.query.ok as string | undefined;
  try {
    const okFilter = okQ === 'true' ? true : okQ === 'false' ? false : null;
    const recentR = await rawDb.execute(sql`
      SELECT id, ts, request_id, agent_id, tier, jurisdiction, task_kind,
             primary_model_id, picked_model_id, picked_provider, fallback_level,
             ok, latency_ms, cost_usd, tokens_in, tokens_out, error_message
      FROM nv_router_decisions
      WHERE (${since}::text IS NULL OR ts >= ${since}::timestamptz)
        AND (${provider}::text IS NULL OR picked_provider = ${provider})
        AND (${model}::text    IS NULL OR picked_model_id = ${model})
        AND (${okFilter}::bool IS NULL OR ok = ${okFilter})
      ORDER BY ts DESC
      LIMIT ${limit} OFFSET ${offset}
    `).catch((e: any) => { logger.warn('router_decisions_failed', { err: String(e) }); return { rows: [] }; });

    const aggR = await rawDb.execute(sql`
      SELECT picked_provider, picked_model_id,
             COUNT(*)::int AS total,
             SUM(CASE WHEN ok THEN 1 ELSE 0 END)::int AS successes,
             SUM(CASE WHEN NOT ok THEN 1 ELSE 0 END)::int AS failures,
             ROUND(AVG(latency_ms)::numeric, 1) AS avg_latency_ms,
             ROUND(SUM(cost_usd)::numeric, 6) AS total_cost_usd,
             SUM(tokens_in)::bigint AS total_tokens_in,
             SUM(tokens_out)::bigint AS total_tokens_out
      FROM nv_router_decisions
      WHERE (${since}::text IS NULL OR ts >= ${since}::timestamptz)
        AND (${provider}::text IS NULL OR picked_provider = ${provider})
        AND (${model}::text    IS NULL OR picked_model_id = ${model})
        AND (${okFilter}::bool IS NULL OR ok = ${okFilter})
      GROUP BY picked_provider, picked_model_id
      ORDER BY total DESC
    `).catch(() => ({ rows: [] }));

    const recent = rowsOf(recentR);
    const decisions = recent.map((x: any) => ({
      id: x.id,
      timestamp: x.ts,
      requestId: x.request_id,
      agentId: x.agent_id,
      tier: x.tier,
      jurisdiction: x.jurisdiction,
      taskKind: x.task_kind,
      primaryModel: x.primary_model_id,
      model: x.picked_model_id,
      provider: x.picked_provider,
      fallbackLevel: x.fallback_level ?? 0,
      ok: !!x.ok,
      latencyMs: x.latency_ms ?? 0,
      cost: x.cost_usd == null ? 0 : Number(x.cost_usd),
      tokensIn: x.tokens_in ?? 0,
      tokensOut: x.tokens_out ?? 0,
      errorMessage: x.error_message ?? null,
    }));

    res.json({
      success: true,
      ok: true,
      // canonical projection
      data: { decisions, total: decisions.length, limit, offset },
      // observability-compatible projection (RouterDecisionsPage)
      recent,
      aggregatesByModel: rowsOf(aggR),
      totalReturned: recent.length,
      filter: { since, provider, model, ok: okQ ?? null, limit },
    });
  } catch (err: any) {
    logger.error('router_decisions_error', { err: String(err) });
    sendApiError(res, 'BAD_REQUEST', { status: 500, overrideMessage: 'Failed to fetch router decisions' });
  }
});

// ─── 10. CAM (Constitutional AI Monitor) reviews ────────────────────────────
router.get('/orchestration/cam/reviews', authenticateToken, gate, async (req: Request, res: Response) => {
  if (!rawDb) { sendApiError(res, 'DB_UNAVAILABLE', { status: 503 }); return; }
  const limit = clampLimit(req.query.limit, 50);
  const offset = clampOffset(req.query.offset);
  try {
    const r = await rawDb.execute(sql`
      SELECT id, agent_key, session_id, composite_score, overall_severity,
             flagged, dimension_scores, signal_count, analysed_at
      FROM nv_schema.bias_analysis_log
      ORDER BY analysed_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `).catch((e: any) => { logger.warn('cam_reviews_failed', { err: String(e) }); return { rows: [] }; });

    const reviews = rowsOf(r).map((x: any) => ({
      id: x.id,
      agentId: x.agent_key,
      sessionId: x.session_id,
      compositeScore: x.composite_score == null ? null : Number(x.composite_score),
      severity: x.overall_severity,
      flagged: !!x.flagged,
      dimensionScores: x.dimension_scores ?? [],
      signalCount: x.signal_count ?? 0,
      analysedAt: x.analysed_at,
    }));
    res.json({ success: true, data: { reviews, total: reviews.length, limit, offset } });
  } catch (err: any) {
    logger.error('cam_reviews_error', { err: String(err) });
    sendApiError(res, 'BAD_REQUEST', { status: 500, overrideMessage: 'Failed to fetch CAM reviews' });
  }
});

export default router;
export { router as nvGovernanceAggregatorsRouter };
