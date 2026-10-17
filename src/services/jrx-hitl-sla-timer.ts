/**
 * HITL SLA Timer — reconciled to actual nv_hitl_queue schema (2026-05-15)
 *
 * Periodic worker (default every 60s) that scans `nv_hitl_queue` for
 * pending rows that have blown their SLA window (per-row `sla_minutes`,
 * default 60 in the table DDL). For each expired row it:
 *   1. Resolves the next reviewer via the agent's `escalationPath`
 *      (using `resolveReviewer` from hitl-workflow-service) keyed off
 *      `agent_id` (preferred — added in 2026-05-15 cleanup) with fallback
 *      to legacy `agent_key`.
 *   2. Marks the row `status='escalated'`. The actual table has no
 *      `assigned_to` column, so reviewer assignment is logged only — the
 *      escalation event carries the reviewerId for downstream consumers.
 *   3. Logs a structured `hitl_escalated` event so the audit chain +
 *      operator dashboards can detect SLA misses.
 *
 * Schema reconciliation (replaces the legacy assumption of
 * task_type/context/priority/deadline_at/assigned_to columns):
 *   • SLA window = `created_at + (INTERVAL '1 minute' * sla_minutes)`
 *     where `sla_minutes` is per-row (NOT NULL DEFAULT 60).
 *   • `agent_id`  → reviewer lookup (preferred); falls back to `agent_key`.
 *   • `category`  → surfaced as `taskType` in the escalation event.
 *   • `severity`  → surfaced as `priority` in the escalation event.
 *   • `org_id`    → passed to reviewer resolver.
 *
 * Disabled when `NYV_HITL_SLA_TIMER=off`.
 */
import { pool } from '../db/index.js';
import { createLogger } from '../utils/logger.js';
import { resolveReviewer } from './hitl-workflow-service.js';

const logger = createLogger('./jrx-hitl-sla-timer');

const TICK_MS = Math.max(
  10_000,
  Number(process.env.NYV_HITL_SLA_TICK_MS ?? 60_000),
);

let _interval: NodeJS.Timeout | null = null;
let _running = false;

interface ExpiredRow {
  id: string;
  agent_id: string | null;
  agent_key: string | null;
  category: string | null;
  severity: string | null;
  sla_minutes: number;
  status: string;
  created_at: string;
  org_id: number | null;
}

async function scanAndEscalate(): Promise<void> {
  if (_running) return;
  _running = true;
  try {
    if (!pool) return;

    // Skip silently if the queue table hasn't been provisioned yet on this env.
    const reg = await pool.query(`SELECT to_regclass('public.nv_hitl_queue') AS reg`);
    if (!reg.rows?.[0]?.reg) return;

    const expiredSql = `
      SELECT id, agent_id, agent_key, category, severity, sla_minutes,
             status, created_at, org_id
        FROM nv_hitl_queue
       WHERE status = 'pending'
         AND created_at + (INTERVAL '1 minute' * COALESCE(sla_minutes, 60)) < NOW()
       ORDER BY created_at ASC
       LIMIT 100
    `;
    const result = await pool.query(expiredSql);
    // @ts-expect-error NV-TS230 legacy typing gap (TS2322)
    const rows: ExpiredRow[] = result.rows ?? [];
    if (rows.length === 0) return;

    for (const row of rows) {
      let reviewerId: string | null = null;
      try {
        const agentRef = row.agent_id ?? row.agent_key ?? undefined;
        reviewerId = await resolveReviewer(
          agentRef != null ? String(agentRef) : undefined,
          row.org_id != null ? String(row.org_id) : undefined,
        );
      } catch {
        reviewerId = null;
      }

      try {
        await pool.query(
          `UPDATE nv_hitl_queue
              SET status = 'escalated'
            WHERE id = $1 AND status = 'pending'`,
          [row.id],
        );
      } catch (err: any) {
        logger.error('hitl_escalation_update_failed', {
          hitlId: row.id,
          error: err?.message,
        });
        continue;
      }

      logger.info('hitl_escalated', {
        hitlId: row.id,
        agentId: row.agent_id ?? row.agent_key ?? null,
        taskType: row.category,
        priority: row.severity,
        slaMinutes: row.sla_minutes,
        createdAt: row.created_at,
        orgId: row.org_id,
        reviewerId,
        reason: 'sla_expired',
        timestamp: new Date().toISOString(),
      });
    }
  } catch (err: any) {
    logger.error('hitl_sla_scan_failed', { error: err?.message });
  } finally {
    _running = false;
  }
}

export function startHitlSlaTimer(): { stop: () => void } {
  if (process.env.NYV_HITL_SLA_TIMER === 'off') {
    logger.info('HITL SLA timer disabled (NYV_HITL_SLA_TIMER=off)');
    return { stop: () => { /* no-op */ } };
  }

  if (_interval) {
    return { stop: () => stopHitlSlaTimer() };
  }

  _interval = setInterval(() => {
    scanAndEscalate().catch(() => { /* swallowed in scan */ });
  }, TICK_MS);
  // unref so a stray timer never blocks shutdown
  if (typeof (_interval as any).unref === 'function') (_interval as any).unref();

  logger.info('HITL SLA timer started', { tickMs: TICK_MS });

  // Run one pass shortly after boot so a bad SLA is caught quickly.
  setTimeout(() => { scanAndEscalate().catch(() => {}); }, 5_000);

  return { stop: () => stopHitlSlaTimer() };
}

export function stopHitlSlaTimer(): void {
  if (_interval) {
    clearInterval(_interval);
    _interval = null;
    logger.info('HITL SLA timer stopped');
  }
}
