import { Router, Request, Response } from 'express';
import { sdkGatewayAuth } from '../middleware/sdk-gateway.js';
import { tenantIsolation } from '../middleware/jrx-tenant-isolation.js';
import { guardrailEnforcementMiddleware, responseGuardrailMiddleware } from '../middleware/guardrails-enforcement.js';
import A2ACollaborationBus from '../packages/protocols/a2a-collaboration-bus.js';
import { workflowSchedulerService } from '../packages/workflows/workflow-scheduler-service.js';
import { predictiveAnalyticsEngine } from '../packages/analytics/predictive-analytics-engine.js';
import { tokenCostPredictionService } from '../packages/analytics/token-cost-prediction-service.js';
import { advancedAnalytics } from '../packages/analytics/advanced-analytics.js';
import { costOptimizationEngine } from '../packages/analytics/cost-optimization-engine.js';

const a2aBus = new A2ACollaborationBus({
  coreConfig: { agents: [], maxConcurrency: 10 },
  storage: { get: async () => null, set: async () => {}, delete: async () => {} }
});

function checkScope(scopes: string[], required: string): boolean {
  if (scopes.includes('*') || scopes.includes('all')) return true;
  return scopes.includes(required);
}

const router = Router();

router.use(sdkGatewayAuth);
router.use(tenantIsolation);
router.use(guardrailEnforcementMiddleware);
router.use(responseGuardrailMiddleware);

router.post('/protocols/a2a/task', async (req: Request, res: Response): Promise<void> => {
  const ctx = req.sdkContext!;
  if (!checkScope(ctx.scopes, 'agents:read')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: agents:read' });
    return;
  }
  const { fromAgent, toAgent, payload, metadata } = req.body;
  if (!fromAgent || typeof fromAgent !== 'string') {
    res.status(400).json({ success: false, error: 'Missing required field: fromAgent' });
    return;
  }
  if (!toAgent) {
    res.status(400).json({ success: false, error: 'Missing required field: toAgent' });
    return;
  }
  if (!payload || typeof payload !== 'object') {
    res.status(400).json({ success: false, error: 'Missing required field: payload' });
    return;
  }
  try {
    const message = {
      id: `msg_${Date.now()}_${crypto.randomUUID().substring(0, 8)}`,
      type: 'request' as const,
      fromAgent,
      toAgent,
      payload,
      metadata: metadata || {
        priority: 'normal' as const,
        category: 'task',
        tags: []
      },
      routing: {
        path: [],
        hops: 0,
        maxHops: 5,
        broadcast: false,
        multicast: false,
        failover: true,
        retryPolicy: {
          maxRetries: 3,
          baseDelay: 1000,
          maxDelay: 10000,
          backoffStrategy: 'exponential' as const,
          jitter: true,
          circuitBreaker: false
        }
      },
      security: {
        authenticated: true,
        authorized: true,
        encryptionLevel: 'basic' as const,
        accessLevel: 'internal' as const
      },
      timestamp: new Date()
    };
    const data = await a2aBus.sendMessage(message);
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error?.message || 'Failed to create collaboration task' });
  }
});

router.get('/protocols/a2a/task/:taskId', async (req: Request, res: Response): Promise<void> => {
  const ctx = req.sdkContext!;
  if (!checkScope(ctx.scopes, 'agents:read')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: agents:read' });
    return;
  }
  const taskId = req.params.taskId;
  if (!taskId || typeof taskId !== 'string') {
    res.status(400).json({ success: false, error: 'Missing required parameter: taskId' });
    return;
  }
  try {
    const handoff = a2aBus.getTaskHandoff(taskId);
    const negotiation = a2aBus.getNegotiationSession(taskId);
    const data = handoff || negotiation || null;
    if (!data) {
      res.status(404).json({ success: false, error: 'Task not found' });
      return;
    }
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error?.message || 'Failed to get task status' });
  }
});

router.get('/protocols/a2a/stats', (req: Request, res: Response): void => {
  const ctx = req.sdkContext!;
  if (!checkScope(ctx.scopes, 'agents:read')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: agents:read' });
    return;
  }
  try {
    const data = a2aBus.getHealthStatus();
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error?.message || 'Failed to get bus stats' });
  }
});

router.post('/workflows/schedule', async (req: Request, res: Response): Promise<void> => {
  const ctx = req.sdkContext!;
  if (!checkScope(ctx.scopes, 'agents:read')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: agents:read' });
    return;
  }
  const { startupId } = req.body;
  if (!startupId || typeof startupId !== 'number') {
    res.status(400).json({ success: false, error: 'Missing required field: startupId (number)' });
    return;
  }
  try {
    await workflowSchedulerService.triggerPhaseProgression(startupId);
    res.json({ success: true, data: { startupId, scheduled: true, timestamp: new Date() } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error?.message || 'Failed to schedule workflow' });
  }
});

router.get('/workflows/stats', (req: Request, res: Response): void => {
  const ctx = req.sdkContext!;
  if (!checkScope(ctx.scopes, 'agents:read')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: agents:read' });
    return;
  }
  try {
    const data = {
      schedulerActive: true,
      timestamp: new Date()
    };
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error?.message || 'Failed to get scheduler stats' });
  }
});

router.get('/workflows/:workflowId', async (req: Request, res: Response): Promise<void> => {
  const ctx = req.sdkContext!;
  if (!checkScope(ctx.scopes, 'agents:read')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: agents:read' });
    return;
  }
  const workflowId = req.params.workflowId;
  if (!workflowId || typeof workflowId !== 'string') {
    res.status(400).json({ success: false, error: 'Missing required parameter: workflowId' });
    return;
  }
  try {
    const startupId = parseInt(workflowId, 10);
    if (isNaN(startupId)) {
      res.status(400).json({ success: false, error: 'Invalid workflowId: must be a numeric startup ID' });
      return;
    }
    await workflowSchedulerService.triggerPhaseProgression(startupId);
    res.json({ success: true, data: { workflowId, startupId, status: 'active', timestamp: new Date() } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error?.message || 'Failed to get workflow status' });
  }
});

router.delete('/workflows/:workflowId', async (req: Request, res: Response): Promise<void> => {
  const ctx = req.sdkContext!;
  if (!checkScope(ctx.scopes, 'agents:read')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: agents:read' });
    return;
  }
  const workflowId = req.params.workflowId;
  if (!workflowId || typeof workflowId !== 'string') {
    res.status(400).json({ success: false, error: 'Missing required parameter: workflowId' });
    return;
  }
  try {
    const startupId = parseInt(workflowId, 10);
    if (isNaN(startupId)) {
      res.status(400).json({ success: false, error: 'Invalid workflowId: must be a numeric startup ID' });
      return;
    }
    await workflowSchedulerService.pauseWorkflow(startupId);
    res.json({ success: true, data: { workflowId, startupId, cancelled: true, timestamp: new Date() } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error?.message || 'Failed to cancel workflow' });
  }
});

router.post('/analytics/predict', async (req: Request, res: Response): Promise<void> => {
  const ctx = req.sdkContext!;
  if (!checkScope(ctx.scopes, 'usage:read')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: usage:read' });
    return;
  }
  const { metrics, components } = req.body;
  try {
    if (components && Array.isArray(components)) {
      const data = await predictiveAnalyticsEngine.generatePerformanceForecasts(components);
      res.json({ success: true, data });
    } else if (metrics && Array.isArray(metrics)) {
      const data = await predictiveAnalyticsEngine.analyzeBusinessTrends(metrics);
      res.json({ success: true, data });
    } else {
      res.status(400).json({ success: false, error: 'Missing required field: metrics (array) or components (array)' });
    }
  } catch (error: any) {
    res.status(500).json({ success: false, error: error?.message || 'Failed to generate forecast' });
  }
});

router.post('/analytics/cost/estimate', async (req: Request, res: Response): Promise<void> => {
  const ctx = req.sdkContext!;
  if (!checkScope(ctx.scopes, 'usage:read')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: usage:read' });
    return;
  }
  const { workflow, taskDescription, preferredProviders, budgetLimit, qualityThreshold } = req.body;
  if (!workflow || typeof workflow !== 'string') {
    res.status(400).json({ success: false, error: 'Missing required field: workflow' });
    return;
  }
  try {
    const data = await tokenCostPredictionService.predictCost({
      workflow,
      taskDescription,
      preferredProviders,
      budgetLimit,
      qualityThreshold
    });
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error?.message || 'Failed to estimate token cost' });
  }
});

router.get('/analytics/cost/stats', (req: Request, res: Response): void => {
  const ctx = req.sdkContext!;
  if (!checkScope(ctx.scopes, 'usage:read')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: usage:read' });
    return;
  }
  try {
    const data = costOptimizationEngine.getCostMetrics();
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error?.message || 'Failed to get cost prediction stats' });
  }
});

router.post('/analytics/advanced/query', async (req: Request, res: Response): Promise<void> => {
  const ctx = req.sdkContext!;
  if (!checkScope(ctx.scopes, 'usage:read')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: usage:read' });
    return;
  }
  const { type, params } = req.body;
  if (!type || typeof type !== 'string') {
    res.status(400).json({ success: false, error: 'Missing required field: type' });
    return;
  }
  try {
    let data;
    switch (type) {
      case 'customer-behavior':
        if (!params?.customerId) {
          res.status(400).json({ success: false, error: 'Missing required field: params.customerId' });
          return;
        }
        data = await advancedAnalytics.analyzeCustomerBehavior(params.customerId, params.data || {});
        break;
      case 'market-research':
        if (!params?.topic) {
          res.status(400).json({ success: false, error: 'Missing required field: params.topic' });
          return;
        }
        data = await advancedAnalytics.conductMarketResearch(params.topic, params.scope);
        break;
      case 'revenue-optimization':
        data = await advancedAnalytics.optimizeRevenue(params?.metrics || []);
        break;
      case 'business-intelligence':
        data = await advancedAnalytics.generateBusinessIntelligence(params?.timeframe);
        break;
      default:
        res.status(400).json({ success: false, error: `Invalid query type. Must be one of: customer-behavior, market-research, revenue-optimization, business-intelligence` });
        return;
    }
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error?.message || 'Failed to execute advanced analytics query' });
  }
});

router.get('/analytics/advanced/dashboard', (req: Request, res: Response): void => {
  const ctx = req.sdkContext!;
  if (!checkScope(ctx.scopes, 'usage:read')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: usage:read' });
    return;
  }
  try {
    const data = advancedAnalytics.getAnalyticsStats();
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error?.message || 'Failed to get analytics dashboard' });
  }
});

router.post('/analytics/optimize', async (req: Request, res: Response): Promise<void> => {
  const ctx = req.sdkContext!;
  if (!checkScope(ctx.scopes, 'usage:read')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: usage:read' });
    return;
  }
  const { request } = req.body;
  if (!request || typeof request !== 'object') {
    res.status(400).json({ success: false, error: 'Missing required field: request' });
    return;
  }
  try {
    const data = await costOptimizationEngine.optimizeProviderSelection(request);
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error?.message || 'Failed to generate optimization recommendation' });
  }
});

router.get('/analytics/optimize/stats', (req: Request, res: Response): void => {
  const ctx = req.sdkContext!;
  if (!checkScope(ctx.scopes, 'usage:read')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: usage:read' });
    return;
  }
  try {
    const data = costOptimizationEngine.getSystemStatus();
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error?.message || 'Failed to get optimization engine stats' });
  }
});

export default router;
