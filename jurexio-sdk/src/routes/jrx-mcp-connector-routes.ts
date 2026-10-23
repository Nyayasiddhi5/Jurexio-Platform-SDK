/**
 * NV-MCP-CONNECTOR-ROUTES-001 — HTTP API for legaltech MCP connectors.
 * Mounted at /api/jrx/mcp/connectors — SDK + Console + Jurexio ecosystem.
 */
import { Router, Request, Response } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { requireRole } from '../middleware/jrx-auth.js';
import { sanitizeErrorForClient } from '../utils/error-sanitizer.js';
import { nvMcpConnectorService } from '../services/mcp/jrx-mcp-connector-service.js';

const router = Router();

function orgId(req: Request): string {
  return String(req.user?.orgId || req.query.orgId || 'platform');
}

router.get('/', authenticateToken, (req: Request, res: Response) => {
  res.json({
    success: true,
    data: {
      connectors: nvMcpConnectorService.listConnectors(orgId(req)),
      stats: nvMcpConnectorService.stats(),
    },
  });
});

router.get('/:connectorId', authenticateToken, (req: Request, res: Response) => {
  const data = nvMcpConnectorService.getConnector(String(req.params.connectorId), orgId(req));
  if (!data) {
    res.status(404).json({ success: false, error: 'Connector not found' });
    return;
  }
  res.json({ success: true, data });
});

router.post('/:connectorId/connect', authenticateToken, requireRole('developer', 'org_admin'), async (req: Request, res: Response) => {
  try {
    const result = await nvMcpConnectorService.connect(
      String(req.params.connectorId),
      orgId(req),
      req.body?.credentials ?? req.body,
    );
    res.json({ success: result.success !== false, data: result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: sanitizeErrorForClient(err) });
  }
});

router.post('/:connectorId/disconnect', authenticateToken, requireRole('developer', 'org_admin'), async (req: Request, res: Response) => {
  const result = await nvMcpConnectorService.disconnect(String(req.params.connectorId), orgId(req));
  res.json({ success: true, data: result });
});

router.get('/:connectorId/health', authenticateToken, async (req: Request, res: Response) => {
  const data = await nvMcpConnectorService.healthCheck(String(req.params.connectorId), orgId(req));
  res.json({ success: true, data });
});

router.post('/:connectorId/invoke', authenticateToken, requireRole('developer', 'org_admin'), async (req: Request, res: Response) => {
  try {
    const { action, input } = req.body ?? {};
    if (!action) {
      res.status(400).json({ success: false, error: 'action is required' });
      return;
    }
    const data = await nvMcpConnectorService.invoke(
      String(req.params.connectorId),
      String(action),
      input ?? {},
      orgId(req),
    );
    const needsAuth = data.status === 'oauth_required' || data.status === 'api_key_missing';
    res.status(needsAuth ? 501 : 200).json({ success: !needsAuth, data });
  } catch (err: any) {
    res.status(500).json({ success: false, error: sanitizeErrorForClient(err) });
  }
});

export default router;
