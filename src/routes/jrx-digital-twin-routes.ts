// JRX-NS-021 (2026-05-05): pre-existing strict-null cluster (gateway runs via tsx).
/**
 * JRX Digital Twin REST API Routes v1.0.0
 * JRX-SVC-DIGITAL-TWIN-ROUTES-001
 *
 * Exposes the Digital Twin Service as a full customer-facing HTTP REST API.
 * Digital Twins are live virtual replicas of legal cases, contracts,
 * compliance state, and legal entities — with predictive simulation.
 *
 * Mounted at: /api/jrx/digital-twin
 *
 * Endpoints:
 *   GET  /health                           — Service health check
 *   POST /                                 — Create a digital twin
 *   GET  /                                 — List all twins (org-filtered)
 *   GET  /:twinId                          — Get single twin state
 *   POST /:twinId/event                    — Process event (update twin state)
 *   POST /:twinId/simulate                 — Run "what-if" simulation
 *   POST /:twinId/alerts/:alertId/ack      — Acknowledge an alert
 *   DELETE /:twinId                        — Archive a twin
 *   GET  /entity/:entityId                 — Get all twins for an entity
 *   GET  /stats                            — Aggregate twin statistics
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authenticateToken } from '../middleware/auth.js';
import { sanitizeErrorForClient } from '../utils/error-sanitizer.js';
import { digitalTwinService } from '../services/digital-twin/digital-twin-service.js';
import { createLogger } from '../utils/logger.js';

const router = Router();
const logger = createLogger('./jrx-digital-twin-routes');

function userId(req: Request): string {
  return req.user?.userId || req.user?.id || 'anonymous';
}

function orgId(req: Request): string | undefined {
  return req.user?.orgId || (req.query.orgId as string) || undefined;
}

function paramId(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? '') : String(value ?? '');
}

// ─── Zod Schemas ──────────────────────────────────────────────────────────────

const CreateTwinSchema = z.object({
  type: z.enum(['case', 'entity', 'compliance', 'proceeding', 'contract']),
  name: z.string().min(2).max(300),
  entityId: z.string().min(1).max(200),
  organizationId: z.string().optional(),
  jurisdiction: z.enum(['IN', 'UK', 'GC', 'EU', 'US', 'SG']).default('IN'),
  initialState: z.record(z.any()).optional(),
  metadata: z.record(z.any()).optional(),
});

const ProcessEventSchema = z.object({
  event: z.string().min(1).max(200),
  stateChanges: z.record(z.any()),
  timestamp: z.string().datetime().optional(),
  changedBy: z.string().optional(),
});

const SimulationSchema = z.object({
  scenario: z.string().min(2).max(500),
  parameters: z.record(z.any()).optional().default({}),
  timeHorizon: z.string().optional().default('6_months'),
});

// ─── Health ───────────────────────────────────────────────────────────────────

router.get('/health', async (_req: Request, res: Response) => {
  try {
    const allTwins = await digitalTwinService.getAllTwins();
    const active = allTwins.filter(t => t.status === 'active').length;
    const alertTriggered = allTwins.filter(t => t.status === 'alert-triggered').length;
    res.json({
      success: true,
      service: 'JRX-SVC-DIGITAL-TWIN-001',
      version: '1.0.0',
      status: 'healthy',
      stats: {
        totalTwins: allTwins.length,
        activeTwins: active,
        alertTriggeredTwins: alertTriggered,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: sanitizeErrorForClient(err) });
  }
});

// ─── Create Digital Twin ──────────────────────────────────────────────────────

router.post('/', authenticateToken, async (req: Request, res: Response) => {
  try {
    const result = CreateTwinSchema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({ success: false, error: 'Validation failed', details: result.error.errors });
      return;
    }
    const input = {
      ...result.data,
      organizationId: result.data.organizationId || orgId(req),
    };
    const twin = await digitalTwinService.createTwin({
      ...input,
      name: input.name ?? 'Twin',
      type: input.type ?? 'entity',
      entityId: input.entityId ?? input.organizationId,
      jurisdiction: input.jurisdiction ?? 'IN',
    });
    logger.info('[DigitalTwin] Twin created via API', {
      twinId: twin.id, type: twin.type, entity: twin.entityId, user: userId(req),
    });
    res.status(201).json({
      success: true,
      data: twin,
      message: `Digital twin '${twin.name}' created successfully`,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: sanitizeErrorForClient(err) });
  }
});

// ─── List Twins ───────────────────────────────────────────────────────────────

router.get('/', authenticateToken, async (req: Request, res: Response) => {
  try {
    const requestOrgId = (req.query.orgId as string) || orgId(req);
    let twins = await digitalTwinService.getAllTwins();

    if (requestOrgId) {
      twins = twins.filter(t => t.organizationId === requestOrgId);
    }

    const { type, status, jurisdiction } = req.query;
    if (type) twins = twins.filter(t => t.type === type);
    if (status) twins = twins.filter(t => t.status === status);
    if (jurisdiction) twins = twins.filter(t => t.jurisdiction === jurisdiction);

    res.json({
      success: true,
      data: {
        twins: twins.map(t => ({
          id: t.id,
          type: t.type,
          name: t.name,
          entityId: t.entityId,
          organizationId: t.organizationId,
          jurisdiction: t.jurisdiction,
          status: t.status,
          riskScore: t.state.riskScore,
          complianceScore: t.state.complianceScore,
          alertCount: t.state.alerts?.filter(a => !a.acknowledged).length || 0,
          version: t.version,
          lastSyncAt: t.lastSyncAt,
          updatedAt: t.updatedAt,
        })),
        total: twins.length,
        filters: { type, status, jurisdiction, orgId: requestOrgId },
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: sanitizeErrorForClient(err) });
  }
});

// ─── Get Single Twin ──────────────────────────────────────────────────────────

router.get('/:twinId', authenticateToken, async (req: Request, res: Response) => {
  try {
    const twin = await digitalTwinService.getTwin(paramId(req.params.twinId));
    if (!twin) {
      res.status(404).json({ success: false, error: `Digital twin not found: ${paramId(req.params.twinId)}` });
      return;
    }
    res.json({ success: true, data: twin });
  } catch (err: any) {
    res.status(500).json({ success: false, error: sanitizeErrorForClient(err) });
  }
});

// ─── Process Event (Update State) ────────────────────────────────────────────

router.post('/:twinId/event', authenticateToken, async (req: Request, res: Response) => {
  try {
    const twin = await digitalTwinService.getTwin(paramId(req.params.twinId));
    if (!twin) {
      res.status(404).json({ success: false, error: `Digital twin not found: ${paramId(req.params.twinId)}` });
      return;
    }

    const result = ProcessEventSchema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({ success: false, error: 'Validation failed', details: result.error.errors });
      return;
    }

    const updated = await digitalTwinService.processEvent({
      twinId: paramId(req.params.twinId),
      event: result.data.event,
      stateChanges: result.data.stateChanges,
      timestamp: result.data.timestamp ? new Date(result.data.timestamp) : new Date(),
      changedBy: result.data.changedBy || userId(req),
    });

    logger.info('[DigitalTwin] Event processed via API', {
      twinId: updated.id, event: result.data.event, version: updated.version, user: userId(req),
    });

    res.json({
      success: true,
      data: {
        id: updated.id,
        version: updated.version,
        status: updated.status,
        currentState: updated.state.current,
        alerts: updated.state.alerts?.filter(a => !a.acknowledged) || [],
        riskScore: updated.state.riskScore,
        complianceScore: updated.state.complianceScore,
        lastSyncAt: updated.lastSyncAt,
      },
      message: `Event '${result.data.event}' processed successfully`,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: sanitizeErrorForClient(err) });
  }
});

// ─── Run Simulation ───────────────────────────────────────────────────────────

router.post('/:twinId/simulate', authenticateToken, async (req: Request, res: Response) => {
  try {
    const twin = await digitalTwinService.getTwin(paramId(req.params.twinId));
    if (!twin) {
      res.status(404).json({ success: false, error: `Digital twin not found: ${paramId(req.params.twinId)}` });
      return;
    }

    const result = SimulationSchema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({ success: false, error: 'Validation failed', details: result.error.errors });
      return;
    }

    const outcomes = await digitalTwinService.runSimulation({
      twinId: paramId(req.params.twinId),
      scenario: result.data.scenario,
      variables: result.data.parameters,
      timeHorizon: result.data.timeHorizon,
    });

    logger.info('[DigitalTwin] Simulation run via API', {
      twinId: paramId(req.params.twinId), scenario: result.data.scenario, outcomes: outcomes.length, user: userId(req),
    });

    res.json({
      success: true,
      data: {
        twinId: paramId(req.params.twinId),
        scenario: result.data.scenario,
        timeHorizon: result.data.timeHorizon,
        outcomes,
        simulatedAt: new Date().toISOString(),
        mostLikelyOutcome: outcomes.sort((a, b) => b.probability - a.probability)[0] || null,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: sanitizeErrorForClient(err) });
  }
});

// ─── Acknowledge Alert ────────────────────────────────────────────────────────

router.post('/:twinId/alerts/:alertId/ack', authenticateToken, async (req: Request, res: Response) => {
  try {
    const success = await digitalTwinService.acknowledgeAlert(paramId(req.params.twinId), paramId(req.params.alertId));
    if (!success) {
      res.status(404).json({ success: false, error: 'Twin or alert not found' });
      return;
    }
    logger.info('[DigitalTwin] Alert acknowledged', {
      twinId: paramId(req.params.twinId), alertId: paramId(req.params.alertId), user: userId(req),
    });
    res.json({ success: true, message: 'Alert acknowledged successfully' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: sanitizeErrorForClient(err) });
  }
});

// ─── Archive Twin ─────────────────────────────────────────────────────────────

router.delete('/:twinId', authenticateToken, async (req: Request, res: Response) => {
  try {
    const success = await digitalTwinService.archiveTwin(paramId(req.params.twinId));
    if (!success) {
      res.status(404).json({ success: false, error: `Digital twin not found: ${paramId(req.params.twinId)}` });
      return;
    }
    logger.info('[DigitalTwin] Twin archived via API', { twinId: paramId(req.params.twinId), user: userId(req) });
    res.json({ success: true, message: 'Digital twin archived successfully' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: sanitizeErrorForClient(err) });
  }
});

// ─── Get Twins by Entity ──────────────────────────────────────────────────────

router.get('/entity/:entityId', authenticateToken, async (req: Request, res: Response) => {
  try {
    const twins = await digitalTwinService.getTwinsByEntity(paramId(req.params.entityId));
    res.json({
      success: true,
      data: {
        entityId: paramId(req.params.entityId),
        twins,
        total: twins.length,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: sanitizeErrorForClient(err) });
  }
});

// ─── Stats Dashboard ──────────────────────────────────────────────────────────

router.get('/meta/stats', authenticateToken, async (req: Request, res: Response) => {
  try {
    const requestOrgId = (req.query.orgId as string) || orgId(req);
    let twins = await digitalTwinService.getAllTwins();
    if (requestOrgId) {
      twins = twins.filter(t => t.organizationId === requestOrgId);
    }

    const byType = twins.reduce((acc, t) => { acc[t.type] = (acc[t.type] || 0) + 1; return acc; }, {} as Record<string, number>);
    const byStatus = twins.reduce((acc, t) => { acc[t.status] = (acc[t.status] || 0) + 1; return acc; }, {} as Record<string, number>);
    const totalAlerts = twins.reduce((sum, t) => sum + (t.state.alerts?.filter(a => !a.acknowledged).length || 0), 0);
    const avgRisk = twins.length > 0 ? twins.reduce((sum, t) => sum + (t.state.riskScore || 0), 0) / twins.length : 0;
    const avgCompliance = twins.length > 0 ? twins.reduce((sum, t) => sum + (t.state.complianceScore || 100), 0) / twins.length : 100;

    res.json({
      success: true,
      data: {
        totalTwins: twins.length,
        activeTwins: twins.filter(t => t.status === 'active').length,
        alertTriggeredTwins: twins.filter(t => t.status === 'alert-triggered').length,
        totalUnacknowledgedAlerts: totalAlerts,
        avgRiskScore: Math.round(avgRisk * 10) / 10,
        avgComplianceScore: Math.round(avgCompliance * 10) / 10,
        byType,
        byStatus,
        recentActivity: twins
          .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
          .slice(0, 5)
          .map(t => ({ id: t.id, name: t.name, type: t.type, status: t.status, updatedAt: t.updatedAt })),
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: sanitizeErrorForClient(err) });
  }
});

export default router;
