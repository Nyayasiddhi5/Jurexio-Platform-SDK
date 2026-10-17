/**
 * NV Federated Privacy Service — v5.0.0 (2026-05-06)
 * ─────────────────────────────────────────────────────────────────────────────
 * Differential-privacy federated-learning coordination with **persistent**
 * ε-budget enforcement. All sessions, gradient submissions, and aggregated
 * models live in `nv_schema.nv_fed_sessions / nv_fed_gradients /
 * nv_fed_aggregated_models`.
 *
 * Critical guarantee: ε-budget consumption is checked + incremented inside
 * a SERIALIZABLE transaction so two concurrent gradient submissions cannot
 * both observe budget remaining and each push the consumer over the limit.
 *
 * In-memory `Map<>`s are kept ONLY as a hot read cache; the source of truth
 * is the database.
 */

import crypto from 'crypto';
import { secureRandom } from '../../utils/jrx-secure-random.js';
import { createLogger } from '../../utils/logger.js';
import { selectRows } from '../persistence/jrx-persistence-helper.js';

const logger = createLogger('./jrx-federated-privacy-service');

type JurisdictionCode = 'IN' | 'UK' | 'EU' | 'US' | 'GCC' | 'SG';

interface FederatedSession {
  sessionId: string;
  clientId: string;
  modelType: string;
  status: 'initialized' | 'collecting' | 'aggregating' | 'completed' | 'over_budget';
  participantCount: number;
  epsilonBudget: number;
  epsilonConsumed: number;
  jurisdiction?: JurisdictionCode;
  createdAt: Date;
}

interface AggregatedModel {
  sessionId: string;
  aggregatedGradients: number[];
  participantCount: number;
  noiseAdded: boolean;
  completedAt: Date;
}

interface OnPremiseConfig {
  clientId: string;
  jurisdiction: JurisdictionCode;
  deploymentType: 'full-airgap' | 'hybrid' | 'cloud-connected';
  requiredServices: string[];
  networkConfig: { internalEndpoints: string[]; externalWhitelist: string[] };
  dataResidency: { primaryRegion: string; backupRegion: string; crossBorderAllowed: boolean };
  generatedAt: Date;
}

const sessionCache = new Map<string, FederatedSession>();
let hydrated = false;

async function getPool() {
  const { pool } = await import('../../db/index.js');
  return pool as any;
}

async function hydrate(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  const rows = await selectRows(
    `SELECT session_id, client_id, model_type, status, participant_count,
            epsilon_budget, epsilon_consumed, jurisdiction, created_at
     FROM nv_schema.nv_fed_sessions
     WHERE status NOT IN ('completed', 'archived')`,
  );
  for (const r of rows) {
    sessionCache.set(r.session_id, {
      sessionId: r.session_id,
      clientId: r.client_id,
      modelType: r.model_type,
      status: r.status,
      participantCount: Number(r.participant_count),
      epsilonBudget: Number(r.epsilon_budget),
      epsilonConsumed: Number(r.epsilon_consumed),
      jurisdiction: r.jurisdiction || undefined,
      createdAt: new Date(r.created_at),
    });
  }
  logger.info({ msg: 'fed-privacy hydrated', sessions: rows.length });
}

class NvFederatedPrivacyService {
  async initializeFederatedSession(
    clientId: string,
    modelType: string,
    options: { epsilonBudget?: number; jurisdiction?: JurisdictionCode } = {},
  ): Promise<FederatedSession> {
    await hydrate();
    const sessionId = `fed-${crypto.randomBytes(8).toString('hex')}`;
    const epsilonBudget = options.epsilonBudget ?? 1.0;
    const jurisdiction = options.jurisdiction;
    logger.info({ method: 'initializeFederatedSession', sessionId, clientId, modelType, epsilonBudget });

    const session: FederatedSession = {
      sessionId, clientId, modelType,
      status: 'initialized',
      participantCount: 0,
      epsilonBudget,
      epsilonConsumed: 0,
      jurisdiction,
      createdAt: new Date(),
    };
    sessionCache.set(sessionId, session);

    const pool = await getPool();
    try {
      await pool.query(
        `INSERT INTO nv_schema.nv_fed_sessions
           (session_id, client_id, model_type, status, participant_count,
            epsilon_budget, epsilon_consumed, jurisdiction)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [sessionId, clientId, modelType, 'initialized', 0, epsilonBudget, 0, jurisdiction],
      );
    } catch (e: any) {
      logger.error({ msg: 'failed to persist fed session', sessionId, error: e.message });
    }
    return session;
  }

  /**
   * Submit gradients with ε-budget enforcement.
   *
   * IMPORTANT: budget check + consumption + insert all happen inside a
   * SERIALIZABLE transaction. If two concurrent submissions race, exactly
   * one of them will see the budget after the other has consumed; one will
   * be retried by the DB or rejected. Anything weaker than SERIALIZABLE
   * permits concurrent over-budget reads.
   */
  async submitGradients(
    sessionId: string,
    gradients: number[],
    noise?: number,
    epsilonDelta = 0.01,
  ): Promise<{ accepted: boolean; epsilonConsumed: number; epsilonBudget: number; reason?: string }> {
    await hydrate();
    const cached = sessionCache.get(sessionId);
    if (!cached) throw new Error(`Session ${sessionId} not found`);

    let processedGradients = gradients;
    if (noise && noise > 0) {
      processedGradients = gradients.map(g => g + this.laplaceNoise(noise));
    }

    const pool = await getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');

      // Atomic check-and-consume: rowcount = 0 means over-budget.
      const update = await client.query(
        `UPDATE nv_schema.nv_fed_sessions
            SET epsilon_consumed = epsilon_consumed + $2,
                participant_count = participant_count + 1,
                status = 'collecting',
                updated_at = NOW()
          WHERE session_id = $1
            AND epsilon_consumed + $2 <= epsilon_budget
            AND status NOT IN ('completed', 'over_budget', 'archived')
       RETURNING epsilon_consumed, epsilon_budget, participant_count`,
        [sessionId, epsilonDelta],
      );

      if (update.rowCount === 0) {
        await client.query('ROLLBACK');
        // Mark session over_budget if it was the budget that blocked us.
        await pool.query(
          `UPDATE nv_schema.nv_fed_sessions SET status = 'over_budget', updated_at = NOW()
            WHERE session_id = $1 AND epsilon_consumed >= epsilon_budget AND status != 'completed'`,
          [sessionId],
        );
        cached.status = 'over_budget';
        logger.warn({ msg: 'gradient rejected — ε-budget exhausted', sessionId, epsilonBudget: cached.epsilonBudget });
        return { accepted: false, epsilonConsumed: cached.epsilonConsumed, epsilonBudget: cached.epsilonBudget, reason: 'ε-budget exhausted' };
      }

      await client.query(
        `INSERT INTO nv_schema.nv_fed_gradients
           (session_id, gradient_vec, noise_added, noise_scale, epsilon_delta)
         VALUES ($1, $2, $3, $4, $5)`,
        [sessionId, JSON.stringify(processedGradients), !!noise, noise ?? null, epsilonDelta],
      );

      await client.query('COMMIT');

      const r = update.rows[0];
      cached.epsilonConsumed = Number(r.epsilon_consumed);
      cached.participantCount = Number(r.participant_count);
      cached.status = 'collecting';

      logger.info({
        method: 'submitGradients', sessionId,
        epsilonConsumed: cached.epsilonConsumed, epsilonBudget: cached.epsilonBudget,
        participantCount: cached.participantCount,
      });
      return { accepted: true, epsilonConsumed: cached.epsilonConsumed, epsilonBudget: cached.epsilonBudget };
    } catch (e: any) {
      await client.query('ROLLBACK').catch(() => {});
      logger.error({ msg: 'submitGradients tx failed', sessionId, error: e.message });
      throw e;
    } finally {
      client.release();
    }
  }

  async aggregateGradients(sessionId: string): Promise<AggregatedModel> {
    await hydrate();
    const cached = sessionCache.get(sessionId);
    if (!cached) throw new Error(`Session ${sessionId} not found`);

    const rows = await selectRows(
      `SELECT gradient_vec FROM nv_schema.nv_fed_gradients WHERE session_id = $1 ORDER BY id`,
      [sessionId],
    );
    if (rows.length === 0) throw new Error('No gradients submitted for aggregation');

    const allGradients: number[][] = rows.map((r: any) =>
      typeof r.gradient_vec === 'string' ? JSON.parse(r.gradient_vec) : r.gradient_vec,
    );
    const gradientLength = allGradients[0].length;
    const aggregated = new Array(gradientLength).fill(0);
    for (const g of allGradients) {
      for (let i = 0; i < Math.min(g.length, gradientLength); i++) {
        aggregated[i] += g[i] / allGradients.length;
      }
    }

    const pool = await getPool();
    await pool.query(
      `INSERT INTO nv_schema.nv_fed_aggregated_models
         (session_id, aggregated_vec, participant_count, noise_added)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (session_id) DO UPDATE
         SET aggregated_vec = EXCLUDED.aggregated_vec,
             participant_count = EXCLUDED.participant_count,
             completed_at = NOW()`,
      [sessionId, JSON.stringify(aggregated), allGradients.length, true],
    );
    await pool.query(
      `UPDATE nv_schema.nv_fed_sessions SET status='completed', updated_at=NOW() WHERE session_id=$1`,
      [sessionId],
    );
    cached.status = 'completed';

    return {
      sessionId,
      aggregatedGradients: aggregated,
      participantCount: allGradients.length,
      noiseAdded: true,
      completedAt: new Date(),
    };
  }

  async getSession(sessionId: string): Promise<FederatedSession | null> {
    await hydrate();
    return sessionCache.get(sessionId) ?? null;
  }

  async listSessions(filter: { clientId?: string; status?: string } = {}): Promise<FederatedSession[]> {
    await hydrate();
    let arr = Array.from(sessionCache.values());
    if (filter.clientId) arr = arr.filter(s => s.clientId === filter.clientId);
    if (filter.status)   arr = arr.filter(s => s.status === filter.status);
    return arr;
  }

  async addDifferentialPrivacyNoise(queryResult: number, sensitivity: number, epsilon: number): Promise<number> {
    return queryResult + this.laplaceNoise(sensitivity / epsilon);
  }

  async privatizeAnalytics(data: Record<string, number>, epsilon: number): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(data)) {
      out[k] = await this.addDifferentialPrivacyNoise(v, 1.0, epsilon);
    }
    return out;
  }

  async generateOnPremiseConfig(clientId: string, jurisdiction: JurisdictionCode): Promise<OnPremiseConfig> {
    const regionMap: Record<JurisdictionCode, { primary: string; backup: string }> = {
      IN: { primary: 'ap-south-1', backup: 'ap-south-2' },
      UK: { primary: 'eu-west-2', backup: 'eu-west-1' },
      EU: { primary: 'eu-central-1', backup: 'eu-west-1' },
      US: { primary: 'us-east-1', backup: 'us-west-2' },
      GCC: { primary: 'me-south-1', backup: 'me-central-1' },
      SG: { primary: 'ap-southeast-1', backup: 'ap-southeast-3' },
    };
    const regions = regionMap[jurisdiction] || regionMap.IN;
    return {
      clientId, jurisdiction,
      deploymentType: 'hybrid',
      requiredServices: ['NYV-GATEWAY', 'NYV-DOC-SERVICE', 'NYV-AGENT-SERVICE', 'NYV-RAG-SERVICE', 'PostgreSQL', 'Redis', 'Qdrant'],
      networkConfig: {
        internalEndpoints: ['http://nyv-gateway:5000', 'http://nyv-doc:5001', 'http://nyv-agent:5002', 'http://nyv-rag:5003'],
        externalWhitelist: ['api.openai.com', 'api.anthropic.com', 'api.deepseek.com'],
      },
      dataResidency: {
        primaryRegion: regions.primary,
        backupRegion: regions.backup,
        crossBorderAllowed: jurisdiction !== 'IN',
      },
      generatedAt: new Date(),
    };
  }

  async healthCheck(): Promise<{ ramEntries: number; dbEntries: number; lagSeconds: number }> {
    await hydrate();
    const dbRows = await selectRows(
      `SELECT COUNT(*)::int AS c FROM nv_schema.nv_fed_sessions WHERE status NOT IN ('completed','archived')`,
    );
    return {
      ramEntries: sessionCache.size,
      dbEntries: dbRows[0]?.c ?? 0,
      lagSeconds: 0,
    };
  }

  private laplaceNoise(scale: number): number {
    const u = 0.5 - secureRandom();
    return -scale * Math.sign(u) * Math.log(1 - 2 * Math.abs(u));
  }
}

// NV-ENTERPRISE-GATE (R4 — 2026-05-07): FederatedPrivacy is an enterprise-tier
// feature (per audit Appendix A). Gate behind NYV_ENTERPRISE_TIER=true.
// Below-tier callers receive a no-op proxy that throws on first use and logs
// a single startup warning, so non-enterprise dev environments don't pay the
// ε-budget hydration cost or accidentally enable DP-FL flows.
const ENTERPRISE_TIER_ENABLED =
  process.env.NYV_ENTERPRISE_TIER === 'true' ||
  process.env.NYV_ENTERPRISE_TIER === '1';

function makeDisabledProxy(): NvFederatedPrivacyService {
  const err = () => {
    throw new Error(
      'FederatedPrivacy is an enterprise-tier feature. Set NYV_ENTERPRISE_TIER=true to enable.',
    );
  };
  return new Proxy({} as NvFederatedPrivacyService, {
    get(_t, prop) {
      // healthCheck is permitted so monitoring works.
      if (prop === 'healthCheck') {
        return async () => ({ ramEntries: 0, dbEntries: 0, lagSeconds: 0, disabled: true });
      }
      if (prop === 'isEnabled') return () => false;
      return err;
    },
  });
}

export const nvFederatedPrivacyService: NvFederatedPrivacyService = ENTERPRISE_TIER_ENABLED
  ? new NvFederatedPrivacyService()
  : (logger.warn(
      'FederatedPrivacy disabled (NYV_ENTERPRISE_TIER!=true). Service returns a stub proxy.',
    ),
    makeDisabledProxy());
