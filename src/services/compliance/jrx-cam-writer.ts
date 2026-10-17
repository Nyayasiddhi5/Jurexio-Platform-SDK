/**
 * CAM (Compliance Action Manager) Writer — Task #201.
 *
 * Shared helper used by upstream signal sources (guardrail enforcement,
 * EU AI Act gap analysis, drift monitor, etc.) to seed the
 * `nv_cam_actions` reviewer queue surfaced at /api/jrx/cam/reviews.
 *
 * Design notes:
 *   - Idempotent: every writer must supply a stable `actionId`. We rely
 *     on the table's UNIQUE(action_id) constraint via ON CONFLICT
 *     DO NOTHING so repeated triggers (e.g. the same EU AI Act gap
 *     re-emitted on every gap-analysis call) don't create duplicates.
 *   - Best-effort: persistence failures must NEVER break the upstream
 *     request path. We swallow + log warnings only.
 *   - Table shape: kept in sync with `jrx-cam-routes.ts::ensureTable()`.
 *     This helper also runs CREATE TABLE IF NOT EXISTS so writers can
 *     fire before any reviewer ever hits GET /reviews.
 *
 * NV-NAMING-001: jrx- prefix.
 * NV-WIRING-001: imported by middleware/services that produce signals.
 */
import { createHash } from 'crypto';
import { sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('./jrx-cam-writer');

export type CamSeverity = 'critical' | 'high' | 'medium' | 'low';
export type CamFramework =
  | 'guardrails'
  | 'eu_ai_act'
  | 'dpdpa'
  | 'drift'
  | 'bmad_cam'
  | string;

export interface CamActionInput {
  actionId: string;
  orgId?: string | null;
  framework: CamFramework;
  controlId?: string | null;
  severity: CamSeverity;
  title: string;
  description?: string | null;
  triggeredBy?: string | null;
  evidenceRef?: string | null;
  metadata?: Record<string, unknown>;
}

let _tableEnsured = false;
async function ensureTable(): Promise<void> {
  if (_tableEnsured) return;
  if (!db) return;
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS nv_cam_actions (
        id              SERIAL PRIMARY KEY,
        action_id       VARCHAR(64)  UNIQUE NOT NULL,
        org_id          VARCHAR(100),
        framework       VARCHAR(64),
        control_id      VARCHAR(100),
        severity        VARCHAR(20)  DEFAULT 'medium',
        status          VARCHAR(20)  DEFAULT 'pending',
        title           VARCHAR(255) NOT NULL,
        description     TEXT,
        assigned_to     VARCHAR(100),
        triggered_by    VARCHAR(100),
        evidence_ref    VARCHAR(255),
        metadata        JSONB        DEFAULT '{}'::jsonb,
        created_at      TIMESTAMP    DEFAULT NOW(),
        updated_at      TIMESTAMP    DEFAULT NOW(),
        reviewed_at     TIMESTAMP,
        reviewed_by     VARCHAR(100)
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_nv_cam_actions_status
        ON nv_cam_actions (status, created_at DESC)
    `);
    _tableEnsured = true;
  } catch (err: any) {
    logger.warn('cam_writer_ensure_table_failed', { err: err?.message });
  }
}

/**
 * Build a stable, short action_id from a logical key. Callers should
 * pass framework + control + the dimension that makes the row unique
 * (e.g. an org id, request id, gap text, agent id) so re-firing the
 * same trigger collapses to the same row.
 */
export function camActionId(parts: Array<string | undefined | null>): string {
  const key = parts.filter(Boolean).join('|');
  // 16 hex chars = 64 bits — plenty of headroom, fits the VARCHAR(64) col
  // alongside a human-readable prefix.
  return createHash('sha256').update(key).digest('hex').slice(0, 32);
}

/**
 * Insert (or no-op on duplicate) a pending compliance action.
 * Returns true if a new row was written, false if duplicate or on error.
 */
export async function writeCamAction(input: CamActionInput): Promise<boolean> {
  if (!input?.actionId || !input?.title || !input?.framework || !input?.severity) {
    logger.warn('cam_writer_invalid_input', {
      hasActionId: Boolean(input?.actionId),
      hasTitle: Boolean(input?.title),
      framework: input?.framework,
      severity: input?.severity,
    });
    return false;
  }

  try {
    await ensureTable();
    if (!db) return false;
    const metadataJson = JSON.stringify(input.metadata ?? {});
    const result: any = await db.execute(sql`
      INSERT INTO nv_cam_actions
        (action_id, org_id, framework, control_id, severity, status,
         title, description, triggered_by, evidence_ref, metadata)
      VALUES
        (${input.actionId},
         ${input.orgId ?? null},
         ${input.framework},
         ${input.controlId ?? null},
         ${input.severity},
         'pending',
         ${input.title},
         ${input.description ?? null},
         ${input.triggeredBy ?? null},
         ${input.evidenceRef ?? null},
         ${metadataJson}::jsonb)
      ON CONFLICT (action_id) DO NOTHING
      RETURNING id
    `);
    const rows = (result?.rows ?? result ?? []) as any[];
    return rows.length > 0;
  } catch (err: any) {
    logger.warn('cam_writer_insert_failed', {
      framework: input.framework,
      severity: input.severity,
      actionId: input.actionId,
      err: err?.message,
    });
    return false;
  }
}

/**
 * Convenience: fire-and-forget. Useful in hot paths (request middleware,
 * route handlers) where we don't want to await DB I/O.
 */
export function writeCamActionAsync(input: CamActionInput): void {
  void writeCamAction(input).catch(() => {
    /* already logged inside writeCamAction */
  });
}
