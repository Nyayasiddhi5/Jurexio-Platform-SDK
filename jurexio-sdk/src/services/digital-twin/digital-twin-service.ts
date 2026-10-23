/**
 * Jurexio Digital Twin Service v3.1.2
 * JRX-SVC-DIGITAL-TWIN-001
 *
 * Digital Twin creates a live, continuously updated virtual replica of:
 *   - Legal cases (case digital twin)
 *   - Legal entities/organizations (entity digital twin)
 *   - Regulatory compliance state (compliance digital twin)
 *   - Court proceedings (proceeding digital twin)
 *
 * Features:
 *   - Real-time state synchronization from all platform events
 *   - Predictive simulation ("what if" scenario modeling)
 *   - Autonomous monitoring with alert generation
 *   - Cross-jurisdictional state tracking
 *   - Integration with ROMA L5 governance pipeline
 *
 * Architecture:
 *   TwinRegistry → TwinStateEngine → TwinSimulator → TwinMonitor → TwinAlerts
 */

import { logger } from '../../utils/logger.js';
import { selectRows, upsertRow, softDelete } from '../persistence/jrx-persistence-helper.js';

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

export type TwinType = 'case' | 'entity' | 'compliance' | 'proceeding' | 'contract';

export type TwinStatus =
  | 'active'
  | 'inactive'
  | 'archived'
  | 'simulating'
  | 'monitoring'
  | 'alert-triggered';

export interface DigitalTwin {
  id: string;
  type: TwinType;
  name: string;
  entityId: string;           // ID of the real-world entity being twinned
  organizationId?: string;
  jurisdiction: string;
  status: TwinStatus;
  state: TwinState;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
  lastSyncAt: Date;
  version: number;
}

export interface TwinState {
  current: Record<string, unknown>;
  history: Array<{
    timestamp: Date;
    event: string;
    previousState: Record<string, unknown>;
    newState: Record<string, unknown>;
    changedBy?: string;
  }>;
  predictedOutcomes?: PredictedOutcome[];
  alerts?: TwinAlert[];
  complianceScore?: number;     // 0–100
  riskScore?: number;           // 0–100
}

export interface PredictedOutcome {
  scenario: string;
  probability: number;          // 0–1
  timeHorizon: string;          // e.g., '30 days', '6 months'
  impact: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  mitigationActions: string[];
}

export interface TwinAlert {
  id: string;
  severity: 'info' | 'warning' | 'critical';
  message: string;
  triggeredAt: Date;
  acknowledged: boolean;
  category: 'compliance' | 'deadline' | 'risk' | 'opportunity';
}

export interface CreateTwinInput {
  type: TwinType;
  name: string;
  entityId: string;
  organizationId?: string;
  jurisdiction: string;
  initialState?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface TwinEventInput {
  twinId: string;
  event: string;
  stateChanges: Record<string, unknown>;
  changedBy?: string;
  timestamp?: Date;
}

export interface SimulationInput {
  twinId: string;
  scenario: string;
  variables: Record<string, unknown>;
  timeHorizon: string;
}

// ──────────────────────────────────────────────────────────────────────────────
// Twin Registry — in-memory cache with Postgres write-through (NV-TWIN-DB-001)
// ──────────────────────────────────────────────────────────────────────────────

class TwinRegistry {
  private twins = new Map<string, DigitalTwin>();

  set(twin: DigitalTwin): void {
    this.twins.set(twin.id, twin);
  }

  get(id: string): DigitalTwin | undefined {
    return this.twins.get(id);
  }

  getByEntityId(entityId: string): DigitalTwin[] {
    return Array.from(this.twins.values()).filter(t => t.entityId === entityId);
  }

  getByOrganization(orgId: string): DigitalTwin[] {
    return Array.from(this.twins.values()).filter(t => t.organizationId === orgId);
  }

  getAll(): DigitalTwin[] {
    return Array.from(this.twins.values());
  }

  delete(id: string): boolean {
    return this.twins.delete(id);
  }

  get size(): number {
    return this.twins.size;
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Digital Twin Service
// ──────────────────────────────────────────────────────────────────────────────

export class DigitalTwinService {
  private static instance: DigitalTwinService;
  private readonly registry = new TwinRegistry();
  private readonly monitoringIntervalMs: number;
  private monitoringInterval?: NodeJS.Timer;
  private hydrated = false;

  private constructor() {
    this.monitoringIntervalMs = parseInt(process.env.TWIN_MONITORING_INTERVAL_MS || '60000', 10);
  }

  /** NV-TWIN-DB-001: load durable twins from Postgres on first access. */
  private async ensureHydrated(): Promise<void> {
    if (this.hydrated) return;
    this.hydrated = true;
    const rows = await selectRows(
      `SELECT twin_id, profile FROM nv_schema.nv_digital_twins WHERE status != 'archived'`,
    );
    for (const r of rows) {
      const raw = typeof r.profile === 'string' ? JSON.parse(r.profile) : r.profile;
      const twin = this.deserializeTwin(raw);
      if (twin) this.registry.set(twin);
    }
    if (rows.length > 0) {
      logger.info('[DigitalTwin] hydrated twins from DB', { count: rows.length });
    }
  }

  private deserializeTwin(raw: Record<string, unknown>): DigitalTwin | null {
    if (!raw?.id || typeof raw.id !== 'string') return null;
    const state = (raw.state ?? {}) as TwinState;
    return {
      id: raw.id as string,
      type: raw.type as TwinType,
      name: String(raw.name ?? ''),
      entityId: String(raw.entityId ?? ''),
      organizationId: raw.organizationId as string | undefined,
      jurisdiction: String(raw.jurisdiction ?? 'IN'),
      status: (raw.status as TwinStatus) ?? 'active',
      state: {
        current: state.current ?? {},
        history: (state.history ?? []).map((h) => ({
          ...h,
          timestamp: new Date(h.timestamp),
        })),
        predictedOutcomes: state.predictedOutcomes,
        alerts: (state.alerts ?? []).map((a) => ({
          ...a,
          triggeredAt: new Date(a.triggeredAt),
        })),
        complianceScore: state.complianceScore,
        riskScore: state.riskScore,
      },
      metadata: (raw.metadata ?? {}) as Record<string, unknown>,
      createdAt: new Date(String(raw.createdAt ?? Date.now())),
      updatedAt: new Date(String(raw.updatedAt ?? Date.now())),
      lastSyncAt: new Date(String(raw.lastSyncAt ?? Date.now())),
      version: Number(raw.version ?? 1),
    };
  }

  private persistTwin(twin: DigitalTwin): void {
    void upsertRow('nv_schema.nv_digital_twins', 'twin_id', {
      twin_id: twin.id,
      organization_id: twin.organizationId ?? null,
      entity_id: twin.entityId,
      twin_type: twin.type,
      status: twin.status,
      profile: twin,
      updated_at: twin.updatedAt.toISOString(),
    });
  }

  static getInstance(): DigitalTwinService {
    if (!DigitalTwinService.instance) {
      DigitalTwinService.instance = new DigitalTwinService();
      logger.info('[DigitalTwin] Digital Twin Service initialized');
    }
    return DigitalTwinService.instance;
  }

  /**
   * Create a new digital twin for an entity.
   */
  async createTwin(input: CreateTwinInput): Promise<DigitalTwin> {
    await this.ensureHydrated();
    const id = `twin-${input.type}-${Date.now()}-${crypto.randomUUID().substring(0, 8)}`;
    const now = new Date();

    const twin: DigitalTwin = {
      id,
      type: input.type,
      name: input.name,
      entityId: input.entityId,
      organizationId: input.organizationId,
      jurisdiction: input.jurisdiction,
      status: 'active',
      state: {
        current: input.initialState || {},
        history: [],
        alerts: [],
        complianceScore: 100,
        riskScore: 0,
      },
      metadata: input.metadata || {},
      createdAt: now,
      updatedAt: now,
      lastSyncAt: now,
      version: 1,
    };

    this.registry.set(twin);
    this.persistTwin(twin);
    logger.info('[DigitalTwin] Twin created', { id, type: input.type, entity: input.entityId });
    return twin;
  }

  /**
   * Process an event that updates a twin's state.
   */
  async processEvent(input: TwinEventInput): Promise<DigitalTwin> {
    await this.ensureHydrated();
    const twin = this.registry.get(input.twinId);
    if (!twin) throw new Error(`Digital twin not found: ${input.twinId}`);

    const previousState = { ...twin.state.current };
    const newState = { ...previousState, ...input.stateChanges };

    twin.state.history.push({
      timestamp: input.timestamp || new Date(),
      event: input.event,
      previousState,
      newState,
      changedBy: input.changedBy,
    });

    twin.state.current = newState;
    twin.updatedAt = new Date();
    twin.lastSyncAt = new Date();
    twin.version += 1;

    // Auto-run monitoring checks after state change
    await this.runMonitoringChecks(twin);

    this.registry.set(twin);
    this.persistTwin(twin);
    logger.debug('[DigitalTwin] State updated', { id: twin.id, event: input.event, version: twin.version });
    return twin;
  }

  /**
   * Run "what if" simulation on a twin state.
   */
  async runSimulation(input: SimulationInput): Promise<PredictedOutcome[]> {
    await this.ensureHydrated();
    const twin = this.registry.get(input.twinId);
    if (!twin) throw new Error(`Digital twin not found: ${input.twinId}`);

    twin.status = 'simulating';
    this.registry.set(twin);

    // NV-TWIN-REAL-001: real LLM-backed prediction grounded on the twin's actual
    // state + scenario (was hardcoded probabilities). Honest empty when no LLM.
    const outcomes = await this.predictOutcomes(twin, input);

    twin.state.predictedOutcomes = outcomes;
    twin.status = 'active';
    twin.updatedAt = new Date();
    this.registry.set(twin);
    this.persistTwin(twin);

    logger.info('[DigitalTwin] Simulation complete', { twinId: input.twinId, scenario: input.scenario, outcomes: outcomes.length });
    return outcomes;
  }

  /**
   * Get a twin by ID.
   */
  async getTwin(id: string): Promise<DigitalTwin | undefined> {
    await this.ensureHydrated();
    return this.registry.get(id);
  }

  /**
   * Get all twins for an entity.
   */
  async getTwinsByEntity(entityId: string): Promise<DigitalTwin[]> {
    await this.ensureHydrated();
    return this.registry.getByEntityId(entityId);
  }

  /**
   * Get all twins for an organization.
   */
  async getTwinsByOrganization(orgId: string): Promise<DigitalTwin[]> {
    await this.ensureHydrated();
    return this.registry.getByOrganization(orgId);
  }

  /**
   * Get all active twins (for dashboard).
   */
  async getAllTwins(): Promise<DigitalTwin[]> {
    await this.ensureHydrated();
    return this.registry.getAll();
  }

  /**
   * Acknowledge an alert on a twin.
   */
  async acknowledgeAlert(twinId: string, alertId: string): Promise<boolean> {
    await this.ensureHydrated();
    const twin = this.registry.get(twinId);
    if (!twin) return false;
    const alert = twin.state.alerts?.find(a => a.id === alertId);
    if (!alert) return false;
    alert.acknowledged = true;
    twin.updatedAt = new Date();
    this.registry.set(twin);
    this.persistTwin(twin);
    return true;
  }

  /**
   * Archive a twin (soft delete).
   */
  async archiveTwin(id: string): Promise<boolean> {
    await this.ensureHydrated();
    const twin = this.registry.get(id);
    if (!twin) return false;
    twin.status = 'archived';
    twin.updatedAt = new Date();
    this.registry.set(twin);
    this.persistTwin(twin);
    void softDelete('nv_schema.nv_digital_twins', 'twin_id', id, true);
    logger.info('[DigitalTwin] Twin archived', { id });
    return true;
  }

  /**
   * Start continuous monitoring of all active twins.
   */
  startMonitoring(): void {
    if (this.monitoringInterval) return;
    this.monitoringInterval = setInterval(() => {
      this.runAllMonitoringChecks().catch(err =>
        logger.error('[DigitalTwin] Monitoring check failed', { err: err.message }),
      );
    }, this.monitoringIntervalMs);
    logger.info('[DigitalTwin] Continuous monitoring started', { intervalMs: this.monitoringIntervalMs });
  }

  /**
   * Stop monitoring.
   */
  stopMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval as any);
      this.monitoringInterval = undefined;
    }
  }

  /**
   * Health check.
   */
  healthCheck(): { status: 'healthy'; twinCount: number; monitoringActive: boolean } {
    return {
      status: 'healthy',
      twinCount: this.registry.size,
      monitoringActive: !!this.monitoringInterval,
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Private helpers
  // ──────────────────────────────────────────────────────────────────────────

  private async runMonitoringChecks(twin: DigitalTwin): Promise<void> {
    const alerts: TwinAlert[] = twin.state.alerts || [];

    // Compliance score degradation check
    if ((twin.state.complianceScore ?? 100) < 70) {
      alerts.push({
        id: `alert-${Date.now()}`,
        severity: 'critical',
        message: `Compliance score dropped to ${twin.state.complianceScore}% — immediate review required`,
        triggeredAt: new Date(),
        acknowledged: false,
        category: 'compliance',
      });
    }

    // Risk score threshold check
    if ((twin.state.riskScore ?? 0) > 70) {
      alerts.push({
        id: `alert-${Date.now()}-risk`,
        severity: 'warning',
        message: `High risk score detected: ${twin.state.riskScore}/100`,
        triggeredAt: new Date(),
        acknowledged: false,
        category: 'risk',
      });
    }

    // Deadline monitoring for case twins
    if (twin.type === 'case' && twin.state.current.nextHearing) {
      const hearingDate = new Date(twin.state.current.nextHearing as string);
      const daysUntilHearing = (hearingDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
      if (daysUntilHearing <= 7 && daysUntilHearing > 0) {
        alerts.push({
          id: `alert-hearing-${Date.now()}`,
          severity: 'warning',
          message: `Hearing in ${Math.ceil(daysUntilHearing)} days: ${hearingDate.toLocaleDateString()}`,
          triggeredAt: new Date(),
          acknowledged: false,
          category: 'deadline',
        });
      }
    }

    twin.state.alerts = alerts;
    if (alerts.some(a => !a.acknowledged)) {
      twin.status = 'alert-triggered';
    }
  }

  private async runAllMonitoringChecks(): Promise<void> {
    const activeTwins = this.registry.getAll().filter(t => t.status === 'active' || t.status === 'monitoring');
    for (const twin of activeTwins) {
      await this.runMonitoringChecks(twin);
      this.registry.set(twin);
    }
  }

  /**
   * NV-TWIN-REAL-001: produce predicted outcomes with a REAL LLM call grounded
   * on the twin's actual current state, recent event history, scenario and
   * variables — through the cost-aware orchestrator + safety ring. Returns an
   * honest empty array when no live LLM is available (never fabricated
   * probabilities / descriptions).
   */
  private async predictOutcomes(twin: DigitalTwin, input: SimulationInput): Promise<PredictedOutcome[]> {
    try {
      const { callLLM, extractJSON } = await import('../../utils/jrx-llm-gateway.js');
      const historySummary = twin.state.history.slice(-5).map(h => `- ${h.event}`).join('\n') || '(no prior events)';
      const systemPrompt = `You are a legal predictive-analytics engine for a ${twin.type} digital twin. Given the twin's current state and a "what-if" scenario, produce a JSON array of 2-4 predicted outcomes. Each outcome MUST have: {"scenario": string, "probability": number between 0 and 1, "timeHorizon": string, "impact": "low"|"medium"|"high"|"critical", "description": string, "mitigationActions": string[]}. Ground probabilities in legal reasoning about the given state and jurisdiction. Do NOT fabricate specific case citations, section numbers or party names. Return ONLY the JSON array.`;
      const userMessage = [
        `TWIN TYPE: ${twin.type}`,
        `JURISDICTION: ${twin.jurisdiction}`,
        `CURRENT STATE: ${JSON.stringify(twin.state.current).slice(0, 1500)}`,
        `RECENT EVENTS:\n${historySummary}`,
        `SCENARIO: ${input.scenario}`,
        `VARIABLES: ${JSON.stringify(input.variables ?? {}).slice(0, 800)}`,
        `TIME HORIZON: ${input.timeHorizon}`,
      ].join('\n');

      const res = await callLLM({
        requestId: `twin-sim-${Date.now()}-${crypto.randomUUID().substring(0, 8)}`,
        systemPrompt,
        userMessage,
        jurisdiction: twin.jurisdiction as any,
        maxTokens: 1500,
        temperature: 0.3,
        expectJson: true,
      });

      if (res.isSimulation || !res.content) {
        logger.warn('[DigitalTwin] simulation LLM unavailable — returning no predictions (honest, not fabricated)', { twinId: twin.id });
        return [];
      }

      const parsed = extractJSON<any>(res.content);
      const arr: any[] = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.outcomes) ? parsed.outcomes : [];
      const validImpacts = ['low', 'medium', 'high', 'critical'];
      return arr
        .filter(o => o && typeof o.scenario === 'string')
        .slice(0, 4)
        .map<PredictedOutcome>(o => ({
          scenario: String(o.scenario),
          probability: typeof o.probability === 'number' ? Math.max(0, Math.min(1, o.probability)) : 0,
          timeHorizon: String(o.timeHorizon ?? input.timeHorizon),
          impact: validImpacts.includes(o.impact) ? o.impact : 'medium',
          description: String(o.description ?? ''),
          mitigationActions: Array.isArray(o.mitigationActions) ? o.mitigationActions.map(String) : [],
        }));
    } catch (err: any) {
      logger.warn('[DigitalTwin] predictOutcomes failed — returning no predictions', { err: err?.message?.slice(0, 120) });
      return [];
    }
  }
}

export const digitalTwinService = DigitalTwinService.getInstance();
