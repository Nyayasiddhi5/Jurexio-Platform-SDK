import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { authenticateToken } from '../middleware/auth.js';
import { sdkApplicationService } from '../services/sdk/sdk-application-service.js';
import { PLATFORM_VERSION } from '../config/platform-config.js';
import { sanitizeErrorForClient } from '../utils/error-sanitizer.js';
import { writeAuditLog } from '../middleware/jrx-sdk-tracking-middleware.js';

const router = Router();

router.use(authenticateToken);

// NV-UAT-DEFAULT-ORG-001 (task #335, 2026-05-13): every handler in this
// router resolves the caller's org via req.user?.organizationId. Until
// the dev-tenant rollout completes, fall back to the platform-baseline
// org_id=1 in dev / E2E-bypass mode so the SDK Console pages stop
// hitting "Organization context required". Production keeps undefined
// and continues to 403.
function nvResolveOrgId(req: Request): number | undefined {
  const raw = (req.user as any)?.organizationId;
  if (raw !== undefined && raw !== null && raw !== '') return Number(raw);
  if (process.env.NODE_ENV !== 'production') return 1;
  return undefined;
}

router.get('/info', (_req: Request, res: Response) => {
  res.json({
    success: true,
    data: {
      service: 'Jurexio Developer Console API',
      version: PLATFORM_VERSION,
      endpoints: {
        apps: '/apps',
        keys: '/apps/:appId/keys',
        agents: '/apps/:appId/agents',
        usage: '/apps/:appId/usage',
        overview: '/overview',
      },
    },
  });
});

router.post('/apps', async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = nvResolveOrgId(req);
    if (!organizationId) {
      res.status(403).json({ success: false, error: 'Organization context required' });
      return;
    }
    const { appName, appType, description, jurisdiction, rateLimitPerMinute, dailyTokenBudget, monthlyTokenBudget, webhookUrl, webhookSecret, allowedOrigins } = req.body;
    if (!appName) {
      res.status(400).json({ success: false, error: 'Missing required field: appName' });
      return;
    }
    if (webhookUrl && !webhookSecret) {
      res.status(400).json({ success: false, error: 'webhookSecret is required when webhookUrl is set' });
      return;
    }
    const result = await sdkApplicationService.createApplication({
      organizationId: parseInt(String(organizationId), 10),
      appName,
      appType,
      description,
      jurisdiction,
      rateLimitPerMinute,
      dailyTokenBudget,
      monthlyTokenBudget,
      webhookUrl,
      webhookSecret,
      allowedOrigins,
      createdBy: req.user?.id,
    });
    if (!result.success) {
      res.status(400).json({ success: false, error: result.error });
      return;
    }
    res.status(201).json({ success: true, data: result.data });
  } catch (err: any) {
    res.status(500).json({ success: false, error: sanitizeErrorForClient(err) });
  }
});

router.get('/apps', async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = nvResolveOrgId(req);
    if (!organizationId) {
      res.status(403).json({ success: false, error: 'Organization context required' });
      return;
    }
    const result = await sdkApplicationService.getApplicationsByOrg(parseInt(String(organizationId), 10));
    if (!result.success) {
      res.status(400).json({ success: false, error: result.error });
      return;
    }
    res.json({ success: true, data: result.data });
  } catch (err: any) {
    res.status(500).json({ success: false, error: sanitizeErrorForClient(err) });
  }
});

router.get('/apps/:appId', async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = nvResolveOrgId(req);
    if (!organizationId) {
      res.status(403).json({ success: false, error: 'Organization context required' });
      return;
    }
    const appId = parseInt(String(req.params.appId), 10);
    const result = await sdkApplicationService.getApplicationById(appId, parseInt(String(organizationId), 10));
    if (!result.success) {
      res.status(404).json({ success: false, error: result.error });
      return;
    }
    res.json({ success: true, data: result.data });
  } catch (err: any) {
    res.status(500).json({ success: false, error: sanitizeErrorForClient(err) });
  }
});

router.put('/apps/:appId', async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = nvResolveOrgId(req);
    if (!organizationId) {
      res.status(403).json({ success: false, error: 'Organization context required' });
      return;
    }
    const appId = parseInt(String(req.params.appId), 10);
    const { appName, description, appType, allowedAgents, llmConfig, rateLimitPerMinute, dailyTokenBudget, monthlyTokenBudget, webhookUrl, webhookSecret, allowedOrigins, jurisdiction, metadata } = req.body;
    const result = await sdkApplicationService.updateApplication(appId, parseInt(String(organizationId), 10), {
      appName,
      description,
      appType,
      allowedAgents,
      llmConfig,
      rateLimitPerMinute,
      dailyTokenBudget,
      monthlyTokenBudget,
      webhookUrl,
      webhookSecret,
      allowedOrigins,
      jurisdiction,
      metadata,
    });
    if (!result.success) {
      res.status(404).json({ success: false, error: result.error });
      return;
    }
    res.json({ success: true, data: result.data });
  } catch (err: any) {
    res.status(500).json({ success: false, error: sanitizeErrorForClient(err) });
  }
});

router.post('/apps/:appId/suspend', async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = nvResolveOrgId(req);
    if (!organizationId) {
      res.status(403).json({ success: false, error: 'Organization context required' });
      return;
    }
    const appId = parseInt(String(req.params.appId), 10);
    const result = await sdkApplicationService.suspendApplication(appId, parseInt(String(organizationId), 10));
    if (!result.success) {
      res.status(404).json({ success: false, error: result.error });
      return;
    }
    res.json({ success: true, data: result.data });
  } catch (err: any) {
    res.status(500).json({ success: false, error: sanitizeErrorForClient(err) });
  }
});

router.post('/apps/:appId/revoke', async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = nvResolveOrgId(req);
    if (!organizationId) {
      res.status(403).json({ success: false, error: 'Organization context required' });
      return;
    }
    const appId = parseInt(String(req.params.appId), 10);
    const result = await sdkApplicationService.revokeApplication(appId, parseInt(String(organizationId), 10));
    if (!result.success) {
      res.status(404).json({ success: false, error: result.error });
      return;
    }
    res.json({ success: true, data: result.data });
  } catch (err: any) {
    res.status(500).json({ success: false, error: sanitizeErrorForClient(err) });
  }
});

router.post('/apps/:appId/activate', async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = nvResolveOrgId(req);
    if (!organizationId) {
      res.status(403).json({ success: false, error: 'Organization context required' });
      return;
    }
    const appId = parseInt(String(req.params.appId), 10);
    const result = await sdkApplicationService.reactivateApplication(appId, parseInt(String(organizationId), 10));
    if (!result.success) {
      res.status(404).json({ success: false, error: result.error });
      return;
    }
    res.json({ success: true, data: result.data });
  } catch (err: any) {
    res.status(500).json({ success: false, error: sanitizeErrorForClient(err) });
  }
});

router.post('/apps/:appId/rotate-secret', async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = nvResolveOrgId(req);
    if (!organizationId) {
      res.status(403).json({ success: false, error: 'Organization context required' });
      return;
    }
    const appId = parseInt(String(req.params.appId), 10);
    const result = await sdkApplicationService.rotateClientSecret(appId, parseInt(String(organizationId), 10));
    if (!result.success) {
      res.status(404).json({ success: false, error: result.error });
      return;
    }
    res.json({ success: true, data: result.data });
  } catch (err: any) {
    res.status(500).json({ success: false, error: sanitizeErrorForClient(err) });
  }
});

router.post('/apps/:appId/keys', async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = nvResolveOrgId(req);
    if (!organizationId) {
      res.status(403).json({ success: false, error: 'Organization context required' });
      return;
    }
    const appId = parseInt(String(req.params.appId), 10);
    const { name, scopes, expiresAt, rateLimitOverride } = req.body;
    if (!name) {
      res.status(400).json({ success: false, error: 'Missing required field: name' });
      return;
    }
    const result = await sdkApplicationService.createApiKey(appId, parseInt(String(organizationId), 10), {
      name,
      scopes,
      expiresAt: expiresAt ? new Date(expiresAt) : undefined,
      rateLimitOverride,
      createdBy: req.user?.id,
    });
    if (!result.success) {
      res.status(400).json({ success: false, error: result.error });
      return;
    }
    // Audit log: API key created — tamper-evident hash chain entry
    writeAuditLog({
      traceId: crypto.randomUUID(),
      appId: String(appId),
      orgId: String(organizationId),
      route: `/api/jrx/sdk/console/apps/${appId}/keys`,
      method: 'POST',
      statusCode: 201,
      latencyMs: 0,
    }).catch(() => { /* non-critical */ });
    res.status(201).json({ success: true, data: result.data });
  } catch (err: any) {
    res.status(500).json({ success: false, error: sanitizeErrorForClient(err) });
  }
});

router.get('/apps/:appId/keys', async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = nvResolveOrgId(req);
    if (!organizationId) {
      res.status(403).json({ success: false, error: 'Organization context required' });
      return;
    }
    const appId = parseInt(String(req.params.appId), 10);
    const result = await sdkApplicationService.listApiKeys(appId, parseInt(String(organizationId), 10));
    if (!result.success) {
      res.status(404).json({ success: false, error: result.error });
      return;
    }
    res.json({ success: true, data: result.data });
  } catch (err: any) {
    res.status(500).json({ success: false, error: sanitizeErrorForClient(err) });
  }
});

router.post('/apps/:appId/keys/:keyId/revoke', async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = nvResolveOrgId(req);
    if (!organizationId) {
      res.status(403).json({ success: false, error: 'Organization context required' });
      return;
    }
    const appId = parseInt(String(req.params.appId), 10);
    const keyId = parseInt(String(req.params.keyId), 10);
    const result = await sdkApplicationService.revokeApiKey(keyId, appId);
    if (!result.success) {
      res.status(404).json({ success: false, error: result.error });
      return;
    }
    res.json({ success: true, data: result.data });
  } catch (err: any) {
    res.status(500).json({ success: false, error: sanitizeErrorForClient(err) });
  }
});

router.post('/apps/:appId/keys/:keyId/activate', async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = nvResolveOrgId(req);
    if (!organizationId) {
      res.status(403).json({ success: false, error: 'Organization context required' });
      return;
    }
    const appId = parseInt(String(req.params.appId), 10);
    const keyId = parseInt(String(req.params.keyId), 10);
    const result = await sdkApplicationService.reactivateApiKey(keyId, appId);
    if (!result.success) {
      res.status(404).json({ success: false, error: result.error });
      return;
    }
    res.json({ success: true, data: result.data });
  } catch (err: any) {
    res.status(500).json({ success: false, error: sanitizeErrorForClient(err) });
  }
});

router.post('/apps/:appId/agents', async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = nvResolveOrgId(req);
    if (!organizationId) {
      res.status(403).json({ success: false, error: 'Organization context required' });
      return;
    }
    const appId = parseInt(String(req.params.appId), 10);
    const { agents } = req.body;
    if (!agents || !Array.isArray(agents) || agents.length === 0) {
      res.status(400).json({ success: false, error: 'Missing required field: agents (non-empty array)' });
      return;
    }
    const result = await sdkApplicationService.allocateAgents(appId, parseInt(String(organizationId), 10), agents);
    if (!result.success) {
      res.status(400).json({ success: false, error: result.error });
      return;
    }
    res.status(201).json({ success: true, data: result.data });
  } catch (err: any) {
    res.status(500).json({ success: false, error: sanitizeErrorForClient(err) });
  }
});

router.get('/apps/:appId/agents', async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = nvResolveOrgId(req);
    if (!organizationId) {
      res.status(403).json({ success: false, error: 'Organization context required' });
      return;
    }
    const appId = parseInt(String(req.params.appId), 10);
    const result = await sdkApplicationService.getAgentAllocations(appId);
    if (!result.success) {
      res.status(400).json({ success: false, error: result.error });
      return;
    }
    res.json({ success: true, data: result.data });
  } catch (err: any) {
    res.status(500).json({ success: false, error: sanitizeErrorForClient(err) });
  }
});

router.delete('/apps/:appId/agents/:agentId', async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = nvResolveOrgId(req);
    if (!organizationId) {
      res.status(403).json({ success: false, error: 'Organization context required' });
      return;
    }
    const appId = parseInt(String(req.params.appId), 10);
    const agentId = String(req.params.agentId);
    const result = await sdkApplicationService.deallocateAgent(appId, agentId);
    if (!result.success) {
      res.status(404).json({ success: false, error: result.error });
      return;
    }
    res.json({ success: true, data: result.data });
  } catch (err: any) {
    res.status(500).json({ success: false, error: sanitizeErrorForClient(err) });
  }
});

router.get('/apps/:appId/usage', async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = nvResolveOrgId(req);
    if (!organizationId) {
      res.status(403).json({ success: false, error: 'Organization context required' });
      return;
    }
    const appId = parseInt(String(req.params.appId), 10);
    const period = (req.query.period as string) || 'month';
    const now = new Date();
    let start: Date;
    switch (period) {
      case 'day':
        start = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        break;
      case 'week':
        start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case 'month':
      default:
        start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
    }
    const result = await sdkApplicationService.getAppUsageAnalytics(appId, parseInt(String(organizationId), 10), { start, end: now });
    if (!result.success) {
      res.status(404).json({ success: false, error: result.error });
      return;
    }
    res.json({ success: true, data: result.data });
  } catch (err: any) {
    res.status(500).json({ success: false, error: sanitizeErrorForClient(err) });
  }
});

router.get('/overview', async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = nvResolveOrgId(req);
    if (!organizationId) {
      res.status(403).json({ success: false, error: 'Organization context required' });
      return;
    }
    const orgIdNum = parseInt(String(organizationId), 10);
    const appsResult = await sdkApplicationService.getApplicationsByOrg(orgIdNum);
    if (!appsResult.success) {
      res.status(400).json({ success: false, error: appsResult.error });
      return;
    }
    const apps = appsResult.data || [];
    const now = new Date();
    const monthStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    let totalRequests = 0;
    let totalTokens = 0;
    let totalCost = 0;
    const appSummaries = [];
    for (const app of apps) {
      const usageResult = await sdkApplicationService.getAppUsageAnalytics(app.id, orgIdNum, { start: monthStart, end: now });
      const usage = usageResult.success ? usageResult.data : null;
      totalRequests += usage?.requestCount ?? 0;
      totalTokens += usage?.totalTokensUsed ?? 0;
      totalCost += parseFloat(usage?.totalEstimatedCost ?? '0');
      appSummaries.push({
        id: app.id,
        appName: app.appName,
        appType: app.appType,
        status: app.status,
        clientId: app.clientId,
        createdAt: app.createdAt,
        usage: usage ? {
          requestCount: usage.requestCount,
          totalTokensUsed: usage.totalTokensUsed,
          totalEstimatedCost: usage.totalEstimatedCost,
        } : null,
      });
    }
    res.json({
      success: true,
      data: {
        organizationId: orgIdNum,
        totalApps: apps.length,
        activeApps: apps.filter((a: any) => a.status === 'active').length,
        suspendedApps: apps.filter((a: any) => a.status === 'suspended').length,
        revokedApps: apps.filter((a: any) => a.status === 'revoked').length,
        last30Days: {
          totalRequests,
          totalTokensUsed: totalTokens,
          totalEstimatedCost: totalCost.toFixed(6),
        },
        apps: appSummaries,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: sanitizeErrorForClient(err) });
  }
});

/* ── POST /apps/:appId/webhook/test ─────────────────────────────────────────
 * Send a synthetic `orchestration.completed` event to the app's configured
 * webhook URL so the tenant can verify HMAC signature verification end-to-end.
 */
router.post('/apps/:appId/webhook/test', async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = nvResolveOrgId(req);
    if (!organizationId) {
      res.status(403).json({ success: false, error: 'Organization context required' });
      return;
    }
    const appId = parseInt(String(req.params.appId), 10);

    // Verify the app belongs to this org before firing.
    const appResult = await sdkApplicationService.getApplicationById(
      appId,
      parseInt(String(organizationId), 10),
    );
    if (!appResult.success) {
      res.status(404).json({ success: false, error: 'Application not found' });
      return;
    }
    const app: any = appResult.data;
    if (!app.webhookUrl || !app.webhookSecret) {
      res.status(400).json({
        success: false,
        error: 'Configure webhookUrl and webhookSecret on the application before testing.',
      });
      return;
    }

    const { fireOrchestrationCompletedWebhook, _resetWebhookCache } =
      await import('../services/sdk/sdk-webhook-listener.js');
    _resetWebhookCache();
    await fireOrchestrationCompletedWebhook(appId, {
      orchestrationId: `test_${crypto.randomUUID()}`,
      endpoint: '/api/jrx/sdk/console/apps/:appId/webhook/test',
      summary: 'Synthetic orchestration.completed event for webhook verification.',
      tokens: { input: 0, output: 0, total: 0 },
      cost: 0,
      metadata: { test: true, requestedBy: req.user?.id ?? null },
    });

    res.status(202).json({
      success: true,
      message: 'Test webhook enqueued. Check your endpoint for X-NYV-Event: orchestration.completed.',
      target: app.webhookUrl,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: sanitizeErrorForClient(err) });
  }
});

export default router;
