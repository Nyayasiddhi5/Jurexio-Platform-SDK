// NYV-NS-021 (2026-05-05): pre-existing TS errors (gateway runs via tsx).
import { Router, Request, Response } from 'express';
import { sdkGatewayAuth } from '../middleware/sdk-gateway.js';
import { tenantIsolation } from '../middleware/jrx-tenant-isolation.js';
import { guardrailEnforcementMiddleware, responseGuardrailMiddleware } from '../middleware/guardrails-enforcement.js';
import { sdkWorkflowProtocolService } from '../services/sdk/sdk-workflow-protocol-service.js';
import { sdkUsageMeteringService } from '../services/sdk/sdk-usage-metering-service.js';

function checkScope(scopes: string[], required: string): boolean {
  if (scopes.includes('*') || scopes.includes('all')) return true;
  return scopes.includes(required);
}

/**
 * NV-MCP-PARTNER-AUTH-001: partner SDK keys often ship agents/research scopes
 * instead of explicit protocols:*. Accept those aliases for MCP list/invoke so
 * NSP/NYM/JRX keys work without a separate protocols scope grant. JWT console
 * paths receive explicit protocols:* via computeInternalScopesForRole().
 */
function checkProtocolsScope(scopes: string[], mode: 'read' | 'write'): boolean {
  const required = mode === 'read' ? 'protocols:read' : 'protocols:write';
  if (checkScope(scopes, required)) return true;
  if (mode === 'read') {
    return checkScope(scopes, 'agents:read')
      || checkScope(scopes, 'research:read')
      || checkScope(scopes, 'intelligence:read');
  }
  return checkScope(scopes, 'agents:execute')
    || checkScope(scopes, 'research:write')
    || checkScope(scopes, 'intelligence:write');
}

function buildCtx(req: Request): any {
  const ctx = req.sdkContext!;
  return {
    applicationId: ctx.applicationId,
    organizationId: ctx.organizationId,
    apiKeyId: ctx.apiKeyId,
    appName: ctx.appName,
    jurisdiction: ctx.jurisdiction,
    requestId: `req_${Date.now()}_${crypto.randomUUID().substring(0, 8)}`,
  };
}

const router = Router();
router.use(sdkGatewayAuth);
router.use(tenantIsolation);
router.use(guardrailEnforcementMiddleware);
router.use(responseGuardrailMiddleware);

router.post('/workflows/create', async (req: Request, res: Response): Promise<void> => {
  const ctx = req.sdkContext!;
  if (!checkScope(ctx.scopes, 'workflows:write')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: workflows:write' });
    return;
  }
  const { name, description, steps, triggers, jurisdiction } = req.body;
  if (!name || typeof name !== 'string') {
    res.status(400).json({ success: false, error: 'Missing required field: name' });
    return;
  }
  if (!steps || !Array.isArray(steps) || steps.length === 0) {
    res.status(400).json({ success: false, error: 'Missing required field: steps (non-empty array of { action, params })' });
    return;
  }
  try {
    const result = await sdkWorkflowProtocolService.createWorkflow(
      name, description || '', steps, triggers || [], jurisdiction || ctx.jurisdiction || 'IN', buildCtx(req)
    );
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error?.message || 'Failed to create workflow' });
  }
});

router.post('/workflows/execute', async (req: Request, res: Response): Promise<void> => {
  const ctx = req.sdkContext!;
  if (!checkScope(ctx.scopes, 'workflows:write')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: workflows:write' });
    return;
  }
  const { workflowId, input, executionMode } = req.body;
  if (!workflowId || typeof workflowId !== 'string') {
    res.status(400).json({ success: false, error: 'Missing required field: workflowId' });
    return;
  }
  try {
    const result = await sdkWorkflowProtocolService.executeWorkflow(
      workflowId, input || {}, executionMode || 'async', buildCtx(req)
    );
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error?.message || 'Failed to execute workflow' });
  }
});

router.get('/workflows/list', async (req: Request, res: Response): Promise<void> => {
  const ctx = req.sdkContext!;
  if (!checkScope(ctx.scopes, 'workflows:read')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: workflows:read' });
    return;
  }
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const status = (req.query.status as string) || 'all';
    const result = await sdkWorkflowProtocolService.listWorkflows(status, page, limit, buildCtx(req));
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error?.message || 'Failed to list workflows' });
  }
});

router.get('/workflows/:workflowId/status', async (req: Request, res: Response): Promise<void> => {
  const ctx = req.sdkContext!;
  if (!checkScope(ctx.scopes, 'workflows:read')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: workflows:read' });
    return;
  }
  try {
    const result = await sdkWorkflowProtocolService.getWorkflowStatus(String(req.params.workflowId), buildCtx(req));
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error?.message || 'Failed to get workflow status' });
  }
});

router.post('/workflows/schedule', async (req: Request, res: Response): Promise<void> => {
  const ctx = req.sdkContext!;
  if (!checkScope(ctx.scopes, 'workflows:write')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: workflows:write' });
    return;
  }
  const { workflowId, schedule } = req.body;
  if (!workflowId || typeof workflowId !== 'string') {
    res.status(400).json({ success: false, error: 'Missing required field: workflowId' });
    return;
  }
  if (!schedule || typeof schedule !== 'object') {
    res.status(400).json({ success: false, error: 'Missing required field: schedule' });
    return;
  }
  try {
    const result = await sdkWorkflowProtocolService.scheduleWorkflow(workflowId, schedule, buildCtx(req));
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error?.message || 'Failed to schedule workflow' });
  }
});

router.delete('/workflows/:workflowId', async (req: Request, res: Response): Promise<void> => {
  const ctx = req.sdkContext!;
  if (!checkScope(ctx.scopes, 'workflows:write')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: workflows:write' });
    return;
  }
  try {
    const result = await sdkWorkflowProtocolService.deleteWorkflow(String(req.params.workflowId), buildCtx(req));
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error?.message || 'Failed to delete workflow' });
  }
});

router.post('/workflows/autonomous/start', async (req: Request, res: Response): Promise<void> => {
  const ctx = req.sdkContext!;
  if (!checkScope(ctx.scopes, 'workflows:write')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: workflows:write' });
    return;
  }
  const { goal, constraints, maxIterations } = req.body;
  if (!goal || typeof goal !== 'string') {
    res.status(400).json({ success: false, error: 'Missing required field: goal' });
    return;
  }
  try {
    const result = await sdkWorkflowProtocolService.startAutonomousExecution(
      goal, constraints || {}, maxIterations || 100, buildCtx(req)
    );
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error?.message || 'Failed to start autonomous execution' });
  }
});

router.post('/protocols/agui/event', async (req: Request, res: Response): Promise<void> => {
  const ctx = req.sdkContext!;
  if (!checkScope(ctx.scopes, 'protocols:write')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: protocols:write' });
    return;
  }
  const { eventType, payload, targetComponent } = req.body;
  if (!eventType || typeof eventType !== 'string') {
    res.status(400).json({ success: false, error: 'Missing required field: eventType' });
    return;
  }
  try {
    const result = await sdkWorkflowProtocolService.dispatchAGUIEvent(
      eventType, payload || {}, targetComponent || 'default', buildCtx(req)
    );
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error?.message || 'Failed to dispatch AG-UI event' });
  }
});

router.get('/protocols/agui/state', async (req: Request, res: Response): Promise<void> => {
  const ctx = req.sdkContext!;
  if (!checkScope(ctx.scopes, 'protocols:read')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: protocols:read' });
    return;
  }
  try {
    const result = await sdkWorkflowProtocolService.getAGUIState(buildCtx(req));
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error?.message || 'Failed to get AG-UI state' });
  }
});

router.post('/protocols/roma/evaluate', async (req: Request, res: Response): Promise<void> => {
  const ctx = req.sdkContext!;
  if (!checkScope(ctx.scopes, 'protocols:write')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: protocols:write' });
    return;
  }
  const { agentId, task, evaluationCriteria } = req.body;
  if (!agentId || typeof agentId !== 'string') {
    res.status(400).json({ success: false, error: 'Missing required field: agentId' });
    return;
  }
  if (!task || typeof task !== 'string') {
    res.status(400).json({ success: false, error: 'Missing required field: task' });
    return;
  }
  try {
    const result = await sdkWorkflowProtocolService.evaluateROMA(
      agentId, task, evaluationCriteria || ['accuracy', 'relevance', 'completeness'], buildCtx(req)
    );
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error?.message || 'Failed to evaluate ROMA' });
  }
});

router.post('/protocols/bmad/analyze', async (req: Request, res: Response): Promise<void> => {
  const ctx = req.sdkContext!;
  if (!checkScope(ctx.scopes, 'protocols:write')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: protocols:write' });
    return;
  }
  const { methodology, inputs, framework } = req.body;
  if (!methodology || typeof methodology !== 'string') {
    res.status(400).json({ success: false, error: 'Missing required field: methodology' });
    return;
  }
  try {
    const result = await sdkWorkflowProtocolService.analyzeBMAD(
      methodology, inputs || {}, framework || 'default', buildCtx(req)
    );
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error?.message || 'Failed to analyze BMAD' });
  }
});

router.post('/protocols/parlant/interact', async (req: Request, res: Response): Promise<void> => {
  const ctx = req.sdkContext!;
  if (!checkScope(ctx.scopes, 'protocols:write')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: protocols:write' });
    return;
  }
  const { message, conversationId, context, standards } = req.body;
  if (!message || typeof message !== 'string') {
    res.status(400).json({ success: false, error: 'Missing required field: message' });
    return;
  }
  try {
    const result = await sdkWorkflowProtocolService.interactParlant(
      message, conversationId, context || {}, standards || ['professional', 'legal-accuracy'], buildCtx(req)
    );
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error?.message || 'Failed to interact with Parlant' });
  }
});

router.post('/protocols/context-engineering/optimize', async (req: Request, res: Response): Promise<void> => {
  const ctx = req.sdkContext!;
  if (!checkScope(ctx.scopes, 'protocols:write')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: protocols:write' });
    return;
  }
  const { prompt, context, strategy, maxTokens } = req.body;
  if (!prompt || typeof prompt !== 'string') {
    res.status(400).json({ success: false, error: 'Missing required field: prompt' });
    return;
  }
  try {
    const result = await sdkWorkflowProtocolService.optimizeContext(
      prompt, context || {}, strategy || 'adaptive-compression', maxTokens || 4096, buildCtx(req)
    );
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error?.message || 'Failed to optimize context' });
  }
});

router.get('/protocols/context-engineering/strategies', async (req: Request, res: Response): Promise<void> => {
  const ctx = req.sdkContext!;
  if (!checkScope(ctx.scopes, 'protocols:read')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: protocols:read' });
    return;
  }
  try {
    const result = sdkWorkflowProtocolService.getContextStrategies();
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error?.message || 'Failed to fetch strategies' });
  }
});

router.post('/protocols/mcp/tools/invoke', async (req: Request, res: Response): Promise<void> => {
  const ctx = req.sdkContext!;
  if (!checkProtocolsScope(ctx.scopes, 'write')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: protocols:write (or agents:execute / research:write / intelligence:write)' });
    return;
  }
  const { toolName, parameters, context } = req.body;
  if (!toolName || typeof toolName !== 'string') {
    res.status(400).json({ success: false, error: 'Missing required field: toolName' });
    return;
  }
  try {
    const result = await sdkWorkflowProtocolService.invokeMCPTool(toolName, parameters || {}, context || {}, buildCtx(req));
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error?.message || 'Failed to invoke MCP tool' });
  }
});

router.get('/protocols/mcp/tools', async (req: Request, res: Response): Promise<void> => {
  const ctx = req.sdkContext!;
  if (!checkProtocolsScope(ctx.scopes, 'read')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: protocols:read (or agents:read / research:read / intelligence:read)' });
    return;
  }
  try {
    const result = sdkWorkflowProtocolService.getMCPTools({
      includeArchived: String(req.query.includeArchived ?? '') === '1' || String(req.query.includeArchived ?? '').toLowerCase() === 'true',
    });
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error?.message || 'Failed to fetch MCP tools' });
  }
});

router.get('/usage/summary', async (req: Request, res: Response): Promise<void> => {
  const ctx = req.sdkContext!;
  try {
    const days = parseInt(req.query.days as string) || 30;
    const periodType = (req.query.periodType as string) || 'daily';
    const result = await sdkUsageMeteringService.getUsageSummary(ctx.applicationId, periodType, days);
    res.json({ success: true, data: { applicationId: ctx.applicationId, periodType, days, records: result } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error?.message || 'Failed to fetch usage summary' });
  }
});

export default router;
