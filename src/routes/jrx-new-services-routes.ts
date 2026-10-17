// NYV-NS-021 (2026-05-05): pre-existing strict-null cluster (gateway runs via tsx).
/**
 * Jurexio New Services API Routes v3.1.2
 * NYV-ROUTE-NEW-SERVICES-001
 *
 * Routes for all new production services:
 *   - Digital Twin API         /api/jrx/digital-twin/*
 *   - Skills System API        /api/jrx/skills/*
 *   - E-Filing API             /api/jrx/e-filing/*
 *   - White-Label API          /api/jrx/white-label/*
 *   - RBAC API                 /api/jrx/rbac/*
 *   - Contract Lifecycle API   /api/jrx/clm/*
 *   - Regulatory Monitor API   /api/jrx/regulatory/*
 *   - LLM Priority Manager API /api/jrx/llm-priority/*
 *   - NS LRM Router API        /api/jrx/lrm/*
 */

import { Router, type Request, type Response } from 'express';
import { authenticateToken, requireRole } from '../middleware/jrx-auth.js';
import { digitalTwinService } from '../services/digital-twin/digital-twin-service.js';
import { skillsSystem } from '../services/skills/skills-system-service.js';
import { eFilingService } from '../services/e-filing/e-filing-service.js';
import { whiteLabelService } from '../services/white-label/white-label-service.js';
import { rbacService } from '../services/rbac/rbac-service.js';
import { contractLifecycleService } from '../services/contract-lifecycle/contract-lifecycle-service.js';
import { regulatoryMonitor } from '../services/regulatory-monitor/regulatory-monitor-service.js';
import { llmPriorityManager } from '../services/llm-priority-manager/llm-priority-manager.js';
import { nsLRMRouter } from '../services/ns-lrm-router.js';
import { logger } from '../utils/logger.js';

const router = Router();

const requireAuth = authenticateToken;

// ──────────────────────────────────────────────────────────────────────────────
// Error handler helper
// ──────────────────────────────────────────────────────────────────────────────
function handleError(res: Response, err: unknown, context: string): void {
  const message = err instanceof Error ? err.message : 'Internal error';
  logger.error(`[Route] ${context} failed`, { error: message });
  res.status(500).json({ success: false, error: message, context });
}

// ──────────────────────────────────────────────────────────────────────────────
// Digital Twin Routes — /api/jrx/digital-twin/*
// ──────────────────────────────────────────────────────────────────────────────

router.post('/digital-twin', requireAuth, async (req: Request, res: Response) => {
  try {
    const twin = await digitalTwinService.createTwin(req.body);
    res.status(201).json({ success: true, data: twin });
  } catch (err: any) { handleError(res, err, 'create-twin'); }
});

router.get('/digital-twin', requireAuth, async (req: Request, res: Response) => {
  try {
    const { entityId, organizationId } = req.query;
    const twins = entityId
      ? await digitalTwinService.getTwinsByEntity(entityId as string)
      : organizationId
        ? await digitalTwinService.getTwinsByOrganization(organizationId as string)
        : await digitalTwinService.getAllTwins();
    res.json({ success: true, data: twins, count: twins.length });
  } catch (err: any) { handleError(res, err, 'list-twins'); }
});

router.get('/digital-twin/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const twin = await digitalTwinService.getTwin(String(req.params.id ?? ""));
    if (!twin) { res.status(404).json({ success: false, error: 'Twin not found' }); return; }
    res.json({ success: true, data: twin });
  } catch (err: any) { handleError(res, err, 'get-twin'); }
});

router.post('/digital-twin/:id/event', requireAuth, async (req: Request, res: Response) => {
  try {
    const twin = await digitalTwinService.processEvent({ twinId: String(req.params.id ?? ""), ...req.body });
    res.json({ success: true, data: twin });
  } catch (err: any) { handleError(res, err, 'twin-event'); }
});

router.post('/digital-twin/:id/simulate', requireAuth, async (req: Request, res: Response) => {
  try {
    const outcomes = await digitalTwinService.runSimulation({ twinId: String(req.params.id ?? ""), ...req.body });
    res.json({ success: true, data: outcomes });
  } catch (err: any) { handleError(res, err, 'twin-simulate'); }
});

router.post('/digital-twin/:id/alerts/:alertId/acknowledge', requireAuth, async (req: Request, res: Response) => {
  try {
    const ok = await digitalTwinService.acknowledgeAlert(String(req.params.id ?? ""), String(req.params.alertId ?? ""));
    res.json({ success: ok });
  } catch (err: any) { handleError(res, err, 'twin-ack'); }
});

router.delete('/digital-twin/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const ok = await digitalTwinService.archiveTwin(String(req.params.id ?? ""));
    res.json({ success: ok });
  } catch (err: any) { handleError(res, err, 'twin-archive'); }
});

router.get('/digital-twin/health', (_req: Request, res: Response) => {
  res.json({ success: true, data: digitalTwinService.healthCheck() });
});

// ──────────────────────────────────────────────────────────────────────────────
// Skills System Routes — /api/jrx/skills/*
// ──────────────────────────────────────────────────────────────────────────────

router.get('/skills', requireAuth, (req: Request, res: Response) => {
  try {
    const { category, jurisdiction, tier, isPublic } = req.query;
    const skills = skillsSystem.getSkills({
      category: category as any,
      jurisdiction: jurisdiction as string,
      tier: tier as any,
      isPublic: isPublic === 'true' ? true : isPublic === 'false' ? false : undefined,
    });
    res.json({ success: true, data: skills, count: skills.length });
  } catch (err: any) { handleError(res, err, 'list-skills'); }
});

// NOTE: /skills/health and /skills/marketplace must be before /skills/:id to avoid catch-all shadowing
router.get('/skills/health', (_req: Request, res: Response) => {
  res.json({ success: true, data: skillsSystem.healthCheck() });
});

router.post('/skills', requireAuth, (req: Request, res: Response) => {
  try {
    const skill = skillsSystem.registerSkill(req.body);
    res.status(201).json({ success: true, data: skill });
  } catch (err: any) { handleError(res, err, 'register-skill'); }
});

router.post('/skills/activate', requireAuth, (req: Request, res: Response) => {
  try {
    const result = skillsSystem.activateSkillsForContext(req.body);
    res.json({ success: true, data: result });
  } catch (err: any) { handleError(res, err, 'activate-skills'); }
});

router.get('/skills/:id', requireAuth, (req: Request, res: Response) => {
  const skill = skillsSystem.getSkill(String(req.params.id ?? ""));
  if (!skill) { res.status(404).json({ success: false, error: 'Skill not found' }); return; }
  res.json({ success: true, data: skill });
});

router.post('/skills/:id/performance', requireAuth, (req: Request, res: Response) => {
  const { jurisdiction, qualityScore, responseTimeMs, success } = req.body;
  skillsSystem.recordSkillPerformance(String(req.params.id ?? ""), jurisdiction, qualityScore, responseTimeMs, success);
  res.json({ success: true });
});

// ──────────────────────────────────────────────────────────────────────────────
// E-Filing Routes — /api/jrx/e-filing/*
// ──────────────────────────────────────────────────────────────────────────────

router.post('/e-filing', requireAuth, async (req: Request, res: Response) => {
  try {
    const filing = await eFilingService.createFiling({ ...req.body, userId: req.user?.id });
    res.status(201).json({ success: true, data: filing });
  } catch (err: any) { handleError(res, err, 'create-filing'); }
});

router.get('/e-filing', requireAuth, (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    const filings = eFilingService.getFilingsByUser(String(userId ?? ""));
    res.json({ success: true, data: filings, count: filings.length });
  } catch (err: any) { handleError(res, err, 'list-filings'); }
});

router.get('/e-filing/:id', requireAuth, (req: Request, res: Response) => {
  const filing = eFilingService.getFiling(String(req.params.id ?? ""));
  if (!filing) { res.status(404).json({ success: false, error: 'Filing not found' }); return; }
  res.json({ success: true, data: filing });
});

router.post('/e-filing/:id/submit', requireAuth, async (req: Request, res: Response) => {
  try {
    const filing = await eFilingService.submitFiling(String(req.params.id ?? ""));
    res.json({ success: true, data: filing });
  } catch (err: any) { handleError(res, err, 'submit-filing'); }
});

router.get('/e-filing/config/:jurisdiction', (req: Request, res: Response) => {
  const jurisdiction = req.params.jurisdiction as any;
  const requirements = eFilingService.getFormatRequirements(jurisdiction);
  const types = eFilingService.getSupportedFilingTypes(jurisdiction);
  res.json({ success: true, data: { requirements, supportedTypes: types } });
});

router.get('/e-filing/health', (_req: Request, res: Response) => {
  res.json({ success: true, data: eFilingService.healthCheck() });
});

// ──────────────────────────────────────────────────────────────────────────────
// RBAC Routes — /api/jrx/rbac/*
// ──────────────────────────────────────────────────────────────────────────────

router.get('/rbac/roles', requireAuth, (_req: Request, res: Response) => {
  res.json({ success: true, data: rbacService.listRoles() });
});

router.post('/rbac/check', requireAuth, (req: Request, res: Response) => {
  try {
    const { resource, action, ...context } = req.body;
    const decision = rbacService.checkAccess(context, resource, action);
    res.json({ success: true, data: decision });
  } catch (err: any) { handleError(res, err, 'rbac-check'); }
});

router.get('/rbac/audit-log', requireAuth, (req: Request, res: Response) => {
  try {
    const { userId, resource, limit } = req.query;
    const entries = rbacService.getAuditLog({
      userId: userId as string,
      resource: resource as string,
      limit: limit ? parseInt(limit as string) : undefined,
    });
    res.json({ success: true, data: entries, count: entries.length });
  } catch (err: any) { handleError(res, err, 'rbac-audit'); }
});

router.get('/rbac/health', (_req: Request, res: Response) => {
  res.json({ success: true, data: rbacService.healthCheck() });
});

// ──────────────────────────────────────────────────────────────────────────────
// Contract Lifecycle (CLM) Routes — /api/jrx/clm/*
// ──────────────────────────────────────────────────────────────────────────────

router.post('/clm', requireAuth, (req: Request, res: Response) => {
  try {
    const contract = contractLifecycleService.createContract({ ...req.body, ownedBy: req.user?.id });
    res.status(201).json({ success: true, data: contract });
  } catch (err: any) { handleError(res, err, 'create-contract'); }
});

router.get('/clm', requireAuth, (req: Request, res: Response) => {
  try {
    const { organizationId } = req.query;
    const contracts = contractLifecycleService.getContractsByOrganization(organizationId as string || '');
    res.json({ success: true, data: contracts, count: contracts.length });
  } catch (err: any) { handleError(res, err, 'list-contracts'); }
});

router.get('/clm/dashboard', requireAuth, (req: Request, res: Response) => {
  try {
    const { organizationId } = req.query;
    const stats = contractLifecycleService.getDashboardStats(organizationId as string);
    res.json({ success: true, data: stats });
  } catch (err: any) { handleError(res, err, 'clm-dashboard'); }
});

router.get('/clm/expiring', requireAuth, (req: Request, res: Response) => {
  const { days = '30', organizationId } = req.query;
  const contracts = contractLifecycleService.getExpiringContracts(parseInt(days as string), organizationId as string);
  res.json({ success: true, data: contracts, count: contracts.length });
});

router.get('/clm/:id', requireAuth, (req: Request, res: Response) => {
  const contract = contractLifecycleService.getContract(String(req.params.id ?? ""));
  if (!contract) { res.status(404).json({ success: false, error: 'Contract not found' }); return; }
  res.json({ success: true, data: contract });
});

router.post('/clm/:id/advance', requireAuth, (req: Request, res: Response) => {
  try {
    const contract = contractLifecycleService.advanceStage(String(req.params.id ?? ""), String(req.user?.id ?? ""), req.body.comments);
    res.json({ success: true, data: contract });
  } catch (err: any) { handleError(res, err, 'advance-contract-stage'); }
});

router.post('/clm/:id/clauses', requireAuth, (req: Request, res: Response) => {
  try {
    const contract = contractLifecycleService.addClauses(String(req.params.id ?? ""), req.body.clauses);
    res.json({ success: true, data: contract });
  } catch (err: any) { handleError(res, err, 'add-clauses'); }
});

router.post('/clm/:id/obligations', requireAuth, (req: Request, res: Response) => {
  try {
    const contract = contractLifecycleService.addObligation(String(req.params.id ?? ""), req.body);
    res.json({ success: true, data: contract });
  } catch (err: any) { handleError(res, err, 'add-obligation'); }
});

router.patch('/clm/:id/obligations/:obligationId/fulfill', requireAuth, (req: Request, res: Response) => {
  try {
    const contract = contractLifecycleService.fulfillObligation(String(req.params.id ?? ""), String(req.params.obligationId ?? ""));
    res.json({ success: true, data: contract });
  } catch (err: any) { handleError(res, err, 'fulfill-obligation'); }
});

router.get('/clm/health', (_req: Request, res: Response) => {
  res.json({ success: true, data: contractLifecycleService.healthCheck() });
});

// ──────────────────────────────────────────────────────────────────────────────
// Regulatory Monitor Routes — /api/jrx/regulatory/*
// ──────────────────────────────────────────────────────────────────────────────

router.get('/regulatory/events', requireAuth, (req: Request, res: Response) => {
  try {
    const { jurisdiction, type, severity, regulator, sector, limit } = req.query;
    const events = regulatoryMonitor.getEvents({
      jurisdiction: jurisdiction as any,
      type: type as any,
      severity: severity as any,
      regulator: regulator as string,
      sector: sector as string,
      limit: limit ? parseInt(limit as string) : undefined,
    });
    res.json({ success: true, data: events, count: events.length });
  } catch (err: any) { handleError(res, err, 'list-reg-events'); }
});

router.post('/regulatory/events', requireAuth, (req: Request, res: Response) => {
  try {
    const event = regulatoryMonitor.addRegulatoryEvent(req.body);
    res.status(201).json({ success: true, data: event });
  } catch (err: any) { handleError(res, err, 'add-reg-event'); }
});

router.get('/regulatory/alerts', requireAuth, (req: Request, res: Response) => {
  try {
    const { organizationId, onlyUnread } = req.query;
    const alerts = regulatoryMonitor.getAlerts(organizationId as string || '', onlyUnread === 'true');
    res.json({ success: true, data: alerts, count: alerts.length });
  } catch (err: any) { handleError(res, err, 'list-reg-alerts'); }
});

router.post('/regulatory/subscribe', requireAuth, (req: Request, res: Response) => {
  try {
    const subscription = regulatoryMonitor.subscribe(req.body);
    res.status(201).json({ success: true, data: subscription });
  } catch (err: any) { handleError(res, err, 'reg-subscribe'); }
});

router.patch('/regulatory/alerts/:id/dismiss', requireAuth, (req: Request, res: Response) => {
  regulatoryMonitor.dismissAlert(String(req.params.id ?? ""), req.body.action);
  res.json({ success: true });
});

router.get('/regulatory/regulators/:jurisdiction', (req: Request, res: Response) => {
  const regs = regulatoryMonitor.getRegulatorsForJurisdiction(req.params.jurisdiction as any);
  res.json({ success: true, data: regs });
});

router.get('/regulatory/health', (_req: Request, res: Response) => {
  res.json({ success: true, data: regulatoryMonitor.healthCheck() });
});

// ──────────────────────────────────────────────────────────────────────────────
// LLM Priority Manager Routes — /api/jrx/llm-priority/*
// ──────────────────────────────────────────────────────────────────────────────

router.post('/llm-priority/route', requireAuth, (req: Request, res: Response) => {
  try {
    const result = llmPriorityManager.routeRequest(req.body);
    res.json({ success: true, data: result });
  } catch (err: any) { handleError(res, err, 'llm-route'); }
});

router.get('/llm-priority/models', requireAuth, (_req: Request, res: Response) => {
  res.json({ success: true, data: llmPriorityManager.getModelCatalogue() });
});

router.get('/llm-priority/health-status', requireAuth, (_req: Request, res: Response) => {
  res.json({ success: true, data: llmPriorityManager.getProviderHealth() });
});

router.get('/llm-priority/analytics', requireAuth, (req: Request, res: Response) => {
  const { since } = req.query;
  const sinceDate = since ? new Date(since as string) : undefined;
  const analytics = llmPriorityManager.getCostAnalytics(sinceDate);
  res.json({ success: true, data: analytics });
});

router.post('/llm-priority/usage', requireAuth, (req: Request, res: Response) => {
  llmPriorityManager.recordUsage(req.body);
  res.json({ success: true });
});

router.get('/llm-priority/health', (_req: Request, res: Response) => {
  res.json({ success: true, data: llmPriorityManager.healthCheck() });
});

// ──────────────────────────────────────────────────────────────────────────────
// NS LRM Router Routes — /api/jrx/lrm/*
// ──────────────────────────────────────────────────────────────────────────────

router.post('/lrm/route', requireAuth, (req: Request, res: Response) => {
  try {
    const decision = nsLRMRouter.route(req.body);
    res.json({ success: true, data: decision });
  } catch (err: any) { handleError(res, err, 'lrm-route'); }
});

router.post('/lrm/detect-jurisdiction', requireAuth, (req: Request, res: Response) => {
  try {
    const result = nsLRMRouter.detectJurisdiction(req.body);
    res.json({ success: true, data: result });
  } catch (err: any) { handleError(res, err, 'lrm-detect-jurisdiction'); }
});

router.get('/lrm/slm-bindings', (_req: Request, res: Response) => {
  res.json({ success: true, data: nsLRMRouter.getAllSLMBindings() });
});

router.get('/lrm/health', (_req: Request, res: Response) => {
  res.json({ success: true, data: nsLRMRouter.healthCheck() });
});

// ──────────────────────────────────────────────────────────────────────────────
// White-Label Routes — /api/jrx/white-label/* (admin only)
// ──────────────────────────────────────────────────────────────────────────────

router.post('/white-label', requireAuth, requireRole('org_admin', 'super_admin'), (req: Request, res: Response) => {
  try {
    const config = whiteLabelService.createPartnerConfig(req.body);
    res.status(201).json({ success: true, data: config });
  } catch (err: any) { handleError(res, err, 'create-wl-config'); }
});

router.get('/white-label', requireAuth, (_req: Request, res: Response) => {
  res.json({ success: true, data: whiteLabelService.getAllActiveConfigs() });
});

router.get('/white-label/:id', requireAuth, (req: Request, res: Response) => {
  const config = whiteLabelService.getConfig(String(req.params.id ?? ""));
  if (!config) { res.status(404).json({ success: false, error: 'Partner config not found' }); return; }
  res.json({ success: true, data: config });
});

router.get('/white-label/:partnerId/brand', (req: Request, res: Response) => {
  const brand = whiteLabelService.getBrandConfig(String(req.params.partnerId ?? ""));
  if (!brand) { res.status(404).json({ success: false, error: 'Brand config not found' }); return; }
  res.json({ success: true, data: brand });
});

router.get('/white-label/:partnerId/stats', requireAuth, (req: Request, res: Response) => {
  const { period } = req.query;
  const stats = whiteLabelService.getUsageStats(String(req.params.partnerId ?? ""), period as string);
  res.json({ success: true, data: stats });
});

router.get('/white-label/health', (_req: Request, res: Response) => {
  res.json({ success: true, data: whiteLabelService.healthCheck() });
});

export default router;
