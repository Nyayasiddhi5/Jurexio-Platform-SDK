// NYV-NS-021 (2026-05-05): pre-existing strict-null violations cluster in this
// file. Runtime is unaffected (gateway runs via tsx). Opt out of strict-null
// for the v5.0.0 deploy gate; track follow-up cleanup in INV-CLEANUP-001.
import { Router, Request, Response } from 'express';
import { createLogger } from '../utils/logger.js';
import { sendApiError, safeError } from '../utils/jrx-api-error.js';
import { nvNyayaGraphService } from '../services/nyaya-tools/jrx-nyayagraph-service.js';
import { nvNyayaWatchService } from '../services/nyaya-tools/jrx-nyayawatch-service.js';
import { nvNyayaCompareService } from '../services/nyaya-tools/jrx-nyayacompare-service.js';
import { nvNyayaAmendService } from '../services/nyaya-tools/jrx-nyayaamend-service.js';
import { nvAgentLifecycleService } from '../services/nyaya-tools/jrx-agent-lifecycle-service.js';
import { nv5TierMemoryService } from '../services/memory/jrx-5tier-memory-service.js';
import { nvCitationVerificationService } from '../services/jrx-citation-verification-service.js';
import { nvVectorStore } from '../services/rag/jrx-qdrant-adapter-service.js';
import { nvNyayaTemplateService } from '../services/nyaya-tools/jrx-nyayatemplate-service.js';
import { nvNyayaTimelineService } from '../services/nyaya-tools/jrx-nyayatimeline-service.js';
import { nvNyayaForensicService } from '../services/nyaya-tools/jrx-nyayaforensic-service.js';
import { nvNyayaTrailService } from '../services/nyaya-tools/jrx-nyayatrail-service.js';
import { NV_MCP_TOOLS_REGISTRY, EXECUTABLE_MCP_TOOL_IDS, PARTNER_CURATED_MCP_TOOL_IDS, isMcpToolExecutable, type McpTool } from '../data/jrx-mcp-tools-registry.js';
import { requireRole } from '../middleware/jrx-auth.js';

const logger = createLogger('./jrx-nyaya-tools-routes');
const router = Router();

/**
 * NV-MEM-TENANT-001 — durable memory scope comes from the authenticated
 * principal. A body/query `userId` is accepted only as a write hint and never
 * widens a read.
 */
function resolveMemoryScope(req: Request, writeUserIdHint?: unknown): { userId?: string; orgId?: string } {
  const sdkCtx = (req as any).sdkContext;
  const authUserId = sdkCtx?.customerUserId ?? (req as any).user?.id;
  const orgId = sdkCtx?.organizationId ?? (req as any).user?.orgId ?? (req as any).user?.organizationId;
  const userId = authUserId ?? writeUserIdHint;
  return {
    userId: userId === undefined || userId === null ? undefined : String(userId),
    orgId: orgId === undefined || orgId === null ? undefined : String(orgId),
  };
}

// ── task-303 (Demo G3A): MCP catalog (read-only) ─────────────────────────
// Surfaces the in-code 530-tool registry as a browsable catalog with
// transport, endpoint, status, and "test connection" probe. Read-only —
// provisioning new MCP servers from the UI is explicitly out of scope.
const MCP_TRANSPORTS: Record<string, 'stdio' | 'sse' | 'http'> = {
  research: 'http', legal_research: 'http', court: 'http', verification: 'http',
  document: 'stdio', analysis: 'stdio', compliance: 'http', identity: 'http',
  language: 'stdio', security: 'sse', database: 'stdio', financial: 'http',
  social: 'http', ip_patent: 'http', employment: 'stdio', real_estate: 'http',
  corporate: 'http', criminal: 'stdio', family_law: 'stdio', tax: 'http',
  insurance: 'http', immigration: 'http', environmental: 'http',
  data_privacy: 'sse', international_trade: 'http', adr_arbitration: 'http',
  integration: 'http',
};
function transportFor(t: McpTool): 'stdio' | 'sse' | 'http' {
  return MCP_TRANSPORTS[t.category] ?? 'http';
}
function endpointFor(t: McpTool): string {
  return `/api/jrx/v1/mcp/tools/${t.id}/execute`;
}
// NV-MCP-SSOT-001 / NV-REAL-DATA-001: status reflects REAL execute capability
// and configured credentials — never synthetic "down"/last-used noise.
//   • executable + no key required          → healthy (live handler)
//   • executable + required key missing      → degraded (handler present, creds missing)
//   • catalog-only (no live handler)         → catalog (listed, not yet executable)
function statusFor(t: McpTool): { status: 'healthy' | 'degraded' | 'catalog'; reason?: string } {
  if (!isMcpToolExecutable(t.id)) {
    return { status: 'catalog', reason: 'Catalog-listed; no live execute handler yet' };
  }
  if (t.requiresKey && !process.env[t.requiresKey]) {
    return { status: 'degraded', reason: `${t.requiresKey} not set — execution will fail until configured` };
  }
  return { status: 'healthy' };
}
function shapeTool(t: McpTool) {
  const st = statusFor(t);
  return {
    id: t.id,
    name: t.name,
    description: t.description,
    category: t.category,
    jurisdictions: t.jurisdictions,
    transport: transportFor(t),
    endpoint: endpointFor(t),
    executable: isMcpToolExecutable(t.id),
    requires_key: t.requiresKey ?? null,
    status: st.status,
    status_reason: st.reason ?? null,
    last_used_at: null,
    input_schema: t.inputSchema,
    tags: t.tags ?? [],
  };
}

router.get('/catalog', (req: Request, res: Response): void => {
  const limit = Math.min(1000, Math.max(1, parseInt(String(req.query.limit ?? '600'), 10)));
  const offset = Math.max(0, parseInt(String(req.query.offset ?? '0'), 10));
  const category = req.query.category ? String(req.query.category) : undefined;
  const jurisdiction = req.query.jurisdiction ? String(req.query.jurisdiction) : undefined;
  const transport = req.query.transport ? String(req.query.transport) : undefined;
  const q = req.query.q ? String(req.query.q).toLowerCase().trim() : '';
  const includeArchived = String(req.query.includeArchived ?? '') === '1' || String(req.query.includeArchived ?? '').toLowerCase() === 'true';

  const filtered = NV_MCP_TOOLS_REGISTRY.filter(t => {
    if (!includeArchived && !PARTNER_CURATED_MCP_TOOL_IDS.has(t.id)) return false;
    if (category && t.category !== category) return false;
    if (jurisdiction && !t.jurisdictions.includes(jurisdiction as any)) return false;
    if (transport && transportFor(t) !== transport) return false;
    if (q && !(t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q) || t.id.includes(q))) return false;
    return true;
  });

  const cats: Record<string, number> = {};
  const catSource = includeArchived ? NV_MCP_TOOLS_REGISTRY : NV_MCP_TOOLS_REGISTRY.filter(t => PARTNER_CURATED_MCP_TOOL_IDS.has(t.id));
  for (const t of catSource) cats[t.category] = (cats[t.category] ?? 0) + 1;

  res.json({
    success: true,
    tools: filtered.slice(offset, offset + limit).map(shapeTool),
    total: filtered.length,
    catalogTotal: NV_MCP_TOOLS_REGISTRY.length,
    executableTotal: EXECUTABLE_MCP_TOOL_IDS.size,
    curatedPartnerTotal: PARTNER_CURATED_MCP_TOOL_IDS.size,
    includeArchived,
    paging: { limit, offset, returned: Math.max(0, Math.min(limit, filtered.length - offset)) },
    categories: Object.entries(cats).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    transports: ['stdio', 'sse', 'http'],
    jurisdictions: ['IN', 'UK', 'GC', 'EU', 'US', 'SG'],
    generatedAt: new Date().toISOString(),
  });
});

router.get('/catalog/:id', (req: Request, res: Response): void => {
  const t = NV_MCP_TOOLS_REGISTRY.find(x => x.id === req.params.id);
  if (!t) { sendApiError(res, 'BAD_REQUEST', { status: 404, overrideMessage: 'tool_not_found' }); return; }
  res.json({ success: true, tool: shapeTool(t) });
});

router.post('/test/:id', async (req: Request, res: Response): Promise<void> => {
  const t = NV_MCP_TOOLS_REGISTRY.find(x => x.id === req.params.id);
  if (!t) { sendApiError(res, 'BAD_REQUEST', { status: 404, overrideMessage: 'tool_not_found' }); return; }
  const started = Date.now();
  const transport = transportFor(t);
  const endpoint = endpointFor(t);
  const requiresKeyMissing = !!(t.requiresKey && !process.env[t.requiresKey]);
  const executable = isMcpToolExecutable(t.id);
  // NV-MCP-SSOT-001: 'catalog' = listed but no live handler; 'mock' = handler
  // present but required credential missing; 'live' = handler + creds ready.
  const mode: 'live' | 'mock' | 'catalog' = !executable ? 'catalog' : (requiresKeyMissing ? 'mock' : 'live');

  // 3-second bounded probe: hit our gateway's MCP execute endpoint with a
  // dry-run preflight so we measure real network round-trip + auth + route
  // resolution. We OPTIONS the route (or HEAD as a fallback) — both are
  // safe (no execution, no API-key burn) and any 2xx/3xx/4xx that returns
  // BEFORE the deadline proves connectivity. Only timeouts / connection
  // refused / 5xx are treated as "down".
  const ctrl = new AbortController();
  const deadline = setTimeout(() => ctrl.abort(), 3000);
  // SSRF guard: NEVER trust inbound Host / X-Forwarded-Proto headers when
  // constructing a server-side fetch target. Pin the probe to loopback on
  // the gateway's own listening port (overridable via NV_PROBE_BASE_URL,
  // which is operator-controlled). This keeps the probe a same-process
  // round-trip and makes header-spoofed redirection impossible.
  const probeBase = process.env.NV_PROBE_BASE_URL
    ?? `http://127.0.0.1:${process.env.PORT ?? 5000}`;
  const url = `${probeBase}${endpoint}`;
  let httpStatus: number | null = null;
  let probeStatus: 'healthy' | 'degraded' | 'down' = 'healthy';
  let reason: string | null = null;
  try {
    let r: globalThis.Response | undefined;
    try {
      r = await fetch(url, { method: 'OPTIONS', signal: ctrl.signal });
    } catch {
      r = await fetch(url, { method: 'HEAD', signal: ctrl.signal });
    }
    httpStatus = r.status;
    if (r.status >= 500) {
      probeStatus = 'down';
      reason = `upstream returned HTTP ${r.status}`;
    } else if (!executable) {
      probeStatus = 'degraded';
      reason = 'catalog-listed tool — no live execute handler yet';
    } else if (requiresKeyMissing) {
      probeStatus = 'degraded';
      reason = `${t.requiresKey} not set — running in mock mode`;
    } else if (r.status === 404) {
      // Route not yet wired — this is a real degradation worth surfacing
      // rather than a "healthy" lie.
      probeStatus = 'degraded';
      reason = 'execute endpoint not mounted (registry-only)';
    }
  } catch (err: any) {
    probeStatus = 'down';
    reason = err?.name === 'AbortError'
      ? 'timeout after 3s'
      : (err?.code || err?.message || 'connection failed');
  } finally {
    clearTimeout(deadline);
  }

  const ok = probeStatus !== 'down';
  res.json({
    success: true,
    tool_id: t.id,
    transport,
    endpoint,
    probe: {
      ok,
      status: probeStatus,
      reason,
      http_status: httpStatus,
      latency_ms: Date.now() - started,
      probed_at: new Date().toISOString(),
      mode,
    },
  });
});

router.get('/status', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    version: '3.1.2',
    services: {
      nyayaGraph: 'active',
      nyayaWatch: 'active',
      nyayaCompare: 'active',
      nyayaAmend: 'active',
      nyayaTemplate: 'active',
      nyayaTimeline: 'active',
      nyayaForensic: 'active',
      nyayaTrail: 'active',
      agentLifecycle: 'active',
      memory5Tier: 'active',
      citationVerification: 'active',
      vectorStore: 'active',
    },
  });
});

router.post('/graph/citation-chain', async (req: Request, res: Response) => {
  try {
    const { sectionId, maxHops } = req.body;
    if (!sectionId) { sendApiError(res, 'BAD_REQUEST', { overrideMessage: 'sectionId is required' }); return; }
    const chain = await nvNyayaGraphService.findCitationChain(sectionId, maxHops || 5);
    res.json({ success: true, data: chain });
  } catch (error: any) {
    logger.error({ route: 'graph/citation-chain', error: (error as Error).message });
    safeError(res, 'Citation chain lookup failed', 500);
  }
});

router.post('/graph/multi-hop', async (req: Request, res: Response) => {
  try {
    const { startId, relationshipTypes, maxHops } = req.body;
    if (!startId) { sendApiError(res, 'BAD_REQUEST', { overrideMessage: 'startId is required' }); return; }
    const paths = await nvNyayaGraphService.multiHopTraversal(startId, relationshipTypes || ['CITES', 'APPLIES'], maxHops || 3);
    res.json({ success: true, data: paths });
  } catch (error: any) {
    logger.error({ route: 'graph/multi-hop', error: (error as Error).message });
    safeError(res, 'Multi-hop traversal failed', 500);
  }
});

router.get('/graph/stats', async (_req: Request, res: Response) => {
  try {
    const stats = await nvNyayaGraphService.getGraphStats();
    res.json({ success: true, data: stats });
  } catch (error: any) {
    safeError(res, 'Graph stats failed', 500);
  }
});

router.post('/watch/scan', async (req: Request, res: Response) => {
  try {
    const { jurisdiction, sinceDays } = req.body;
    if (!jurisdiction) { sendApiError(res, 'BAD_REQUEST', { overrideMessage: 'jurisdiction is required' }); return; }
    const alerts = await nvNyayaWatchService.scanForChanges(jurisdiction, sinceDays || 7);
    res.json({ success: true, data: alerts });
  } catch (error: any) {
    logger.error({ route: 'watch/scan', error: (error as Error).message });
    safeError(res, 'Watch scan failed', 500);
  }
});

router.post('/watch/digest', async (req: Request, res: Response) => {
  try {
    const { jurisdiction, days } = req.body;
    if (!jurisdiction) { sendApiError(res, 'BAD_REQUEST', { overrideMessage: 'jurisdiction is required' }); return; }
    const digest = await nvNyayaWatchService.generateDigest(jurisdiction, days || 7);
    res.json({ success: true, data: digest });
  } catch (error: any) {
    logger.error({ route: 'watch/digest', error: (error as Error).message });
    safeError(res, 'Watch digest failed', 500);
  }
});

router.post('/watch/rules', async (req: Request, res: Response) => {
  try {
    const body = req.body || {};
    const sdkCtx = (req as any).sdkContext;
    const userId = String(
      body.userId
      || sdkCtx?.customerUserId
      || (req as any).user?.id
      || sdkCtx?.applicationId
      || 'nsp-org',
    );
    const actRef = body.actRef || body.statute || body.act || body.keyword;
    const jurisdiction = String(body.jurisdiction || 'IN').toUpperCase() as any;
    const id = String(body.id || `nw-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    if (!userId) {
      sendApiError(res, 'BAD_REQUEST', { overrideMessage: 'userId or authenticated org context is required' });
      return;
    }
    const statutes = Array.isArray(body.statutes)
      ? body.statutes.map(String)
      : actRef
        ? [String(actRef)]
        : [];
    const keywords = Array.isArray(body.keywords)
      ? body.keywords.map(String)
      : actRef
        ? [String(actRef)]
        : [];
    const domains = Array.isArray(body.domains) ? body.domains.map(String) : ['legislation'];
    const rule = await nvNyayaWatchService.addWatchRuleAsync({
      id,
      userId,
      jurisdiction,
      domains,
      keywords,
      statutes,
      notifyEmail: body.notifyEmail,
      notifyWebhook: body.notifyWebhook,
      isActive: body.isActive !== false,
      createdAt: new Date(),
    });
    res.json({
      success: true,
      status: 'ok',
      message: 'Watch rule added',
      data: rule,
      rule,
    });
  } catch (error: any) {
    safeError(res, 'Failed to add watch rule', 500);
  }
});

router.get('/watch/rules', async (req: Request, res: Response) => {
  try {
    const sdkCtx = (req as any).sdkContext;
    const userId = String(
      req.query.userId
      || sdkCtx?.customerUserId
      || (req as any).user?.id
      || sdkCtx?.applicationId
      || '',
    );
    const rules = await nvNyayaWatchService.listWatchRules(userId || undefined);
    res.json({
      success: true,
      status: 'ok',
      data: { rules, status: 'ok', message: rules.length ? undefined : 'No watch rules yet.' },
      rules,
      message: rules.length ? undefined : 'No watch rules yet.',
    });
  } catch (error: any) {
    logger.error({ route: 'watch/rules', error: (error as Error).message });
    res.status(503).json({
      success: false,
      status: 'unavailable',
      rules: [],
      data: { rules: [], status: 'unavailable', message: 'NyayaWatch temporarily unavailable' },
      error: 'NyayaWatch temporarily unavailable',
    });
  }
});

router.get('/watch/rules/:userId', async (req: Request, res: Response) => {
  try {
    const rules = await nvNyayaWatchService.listWatchRules(String(req.params.userId));
    res.json({
      success: true,
      status: 'ok',
      data: { rules, status: 'ok', message: rules.length ? undefined : 'No watch rules yet.' },
      rules,
    });
  } catch (error: any) {
    res.status(503).json({
      success: false,
      status: 'unavailable',
      rules: [],
      data: { rules: [], status: 'unavailable' },
    });
  }
});

router.delete('/watch/rules/:ruleId', async (req: Request, res: Response) => {
  try {
    const ok = nvNyayaWatchService.removeWatchRule(String(req.params.ruleId));
    res.json({ success: true, status: 'ok', deleted: ok });
  } catch {
    safeError(res, 'Failed to delete watch rule', 500);
  }
});

router.post('/watch/statute-validity', async (req: Request, res: Response) => {
  try {
    const { statuteId, sectionNumber } = req.body;
    if (!statuteId || !sectionNumber) { sendApiError(res, 'BAD_REQUEST', { overrideMessage: 'statuteId, sectionNumber required' }); return; }
    const result = await nvNyayaWatchService.checkStatuteValidity(statuteId, sectionNumber);
    res.json({ success: true, data: result });
  } catch (error: any) {
    safeError(res, 'Statute validity check failed', 500);
  }
});

router.post('/compare/sections', async (req: Request, res: Response) => {
  try {
    const input = req.body;
    if (!input.sourceJurisdiction || !input.targetJurisdiction || !input.sourceSectionNumber || !input.sourceStatuteId) {
      sendApiError(res, 'BAD_REQUEST', { overrideMessage: 'sourceJurisdiction, targetJurisdiction, sourceSectionNumber, sourceStatuteId required' });
    }
    const result = await nvNyayaCompareService.compareSections(input);
    res.json({ success: true, data: result });
  } catch (error: any) {
    logger.error({ route: 'compare/sections', error: (error as Error).message });
    safeError(res, 'Section comparison failed', 500);
  }
});

router.post('/compare/versions', async (req: Request, res: Response) => {
  try {
    const { statuteId, sectionNumber } = req.body;
    if (!statuteId || !sectionNumber) { sendApiError(res, 'BAD_REQUEST', { overrideMessage: 'statuteId, sectionNumber required' }); return; }
    const result = await nvNyayaCompareService.compareVersions(statuteId, sectionNumber);
    res.json({ success: true, data: result });
  } catch (error: any) {
    safeError(res, 'Version comparison failed', 500);
  }
});

router.post('/amend/record', async (req: Request, res: Response) => {
  try {
    const record = req.body;
    if (!record.statuteId || !record.sectionNumber || !record.jurisdiction || !record.newText || !record.effectiveDate) {
      sendApiError(res, 'BAD_REQUEST', { overrideMessage: 'statuteId, sectionNumber, jurisdiction, newText, effectiveDate required' });
    }
    record.effectiveDate = new Date(record.effectiveDate);
    await nvNyayaAmendService.recordAmendment(record);
    res.json({ success: true, message: 'Amendment recorded' });
  } catch (error: any) {
    logger.error({ route: 'amend/record', error: (error as Error).message });
    safeError(res, 'Amendment recording failed', 500);
  }
});

router.post('/amend/timeline', async (req: Request, res: Response) => {
  try {
    const { statuteId, sectionNumber, jurisdiction } = req.body;
    if (!statuteId || !sectionNumber) { sendApiError(res, 'BAD_REQUEST', { overrideMessage: 'statuteId, sectionNumber required' }); return; }
    const timeline = await nvNyayaAmendService.getTemporalTimeline(statuteId, sectionNumber, jurisdiction);
    res.json({ success: true, data: timeline });
  } catch (error: any) {
    safeError(res, 'Timeline retrieval failed', 500);
  }
});

router.post('/amend/as-of', async (req: Request, res: Response) => {
  try {
    const { statuteId, sectionNumber, asOfDate } = req.body;
    if (!statuteId || !sectionNumber || !asOfDate) { sendApiError(res, 'BAD_REQUEST', { overrideMessage: 'statuteId, sectionNumber, asOfDate required' }); return; }
    const section = await nvNyayaAmendService.getSectionAsOf(statuteId, sectionNumber, new Date(asOfDate));
    res.json({ success: true, data: section });
  } catch (error: any) {
    safeError(res, 'As-of lookup failed', 500);
  }
});

router.post('/amend/impact', async (req: Request, res: Response) => {
  try {
    const { amendmentId } = req.body;
    if (!amendmentId) { sendApiError(res, 'BAD_REQUEST', { overrideMessage: 'amendmentId required' }); return; }
    const impact = await nvNyayaAmendService.assessAmendmentImpact(amendmentId);
    res.json({ success: true, data: impact });
  } catch (error: any) {
    safeError(res, 'Impact assessment failed', 500);
  }
});

router.get('/amend/recent/:jurisdiction', async (req: Request, res: Response) => {
  try {
    const jurisdiction = req.params.jurisdiction as any;
    const days = parseInt(req.query.days as string) || 30;
    const amendments = await nvNyayaAmendService.getRecentAmendments(jurisdiction, days);
    res.json({ success: true, data: amendments });
  } catch (error: any) {
    safeError(res, 'Recent amendments lookup failed', 500);
  }
});

router.post('/citations/verify', async (req: Request, res: Response) => {
  try {
    const { text, eventDate } = req.body;
    if (!text) { sendApiError(res, 'BAD_REQUEST', { overrideMessage: 'text is required' }); return; }
    const report = await nvCitationVerificationService.verify(text, eventDate ? new Date(eventDate) : undefined);
    res.json({ success: true, data: report });
  } catch (error: any) {
    logger.error({ route: 'citations/verify', error: (error as Error).message });
    safeError(res, 'Citation verification failed', 500);
  }
});

router.post('/lifecycle/spawn', (req: Request, res: Response) => {
  try {
    const { agentId, jurisdiction, traceId, parentInstanceId, totalSteps } = req.body;
    if (!agentId || !jurisdiction || !traceId) { sendApiError(res, 'BAD_REQUEST', { overrideMessage: 'agentId, jurisdiction, traceId required' }); return; }
    const instance = nvAgentLifecycleService.spawn(agentId, jurisdiction, traceId, parentInstanceId, totalSteps);
    res.json({ success: true, data: instance });
  } catch (error: any) {
    safeError(res, 'Agent spawn failed', 500);
  }
});

router.post('/lifecycle/transition', (req: Request, res: Response) => {
  try {
    const { instanceId, newState, reason, triggeredBy } = req.body;
    if (!instanceId || !newState || !reason) { sendApiError(res, 'BAD_REQUEST', { overrideMessage: 'instanceId, newState, reason required' }); return; }
    const success = nvAgentLifecycleService.transition(instanceId, newState, reason, triggeredBy);
    res.json({ success, message: success ? 'Transition applied' : 'Transition rejected' });
  } catch (error: any) {
    safeError(res, 'Lifecycle transition failed', 500);
  }
});

router.get('/lifecycle/health', (_req: Request, res: Response) => {
  const report = nvAgentLifecycleService.getHealthReport();
  res.json({ success: true, data: report });
});

router.get('/lifecycle/events', (_req: Request, res: Response) => {
  const events = nvAgentLifecycleService.getRecentEvents(50);
  res.json({ success: true, data: events });
});

router.post('/memory/episodic', async (req: Request, res: Response) => {
  try {
    const { sessionId, event } = req.body;
    if (!sessionId || !event) { sendApiError(res, 'BAD_REQUEST', { overrideMessage: 'sessionId, event required' }); return; }
    await nv5TierMemoryService.saveEpisodic(sessionId, { ...event, timestamp: new Date() });
    res.json({ success: true, message: 'Episodic memory saved' });
  } catch (error: any) {
    safeError(res, 'Episodic memory save failed', 500);
  }
});

router.get('/memory/episodic/:sessionId', async (req: Request, res: Response) => {
  // @ts-expect-error NV-TS230 legacy typing gap (TS2345)
  const events = await nv5TierMemoryService.getEpisodic(req.params.sessionId);
  res.json({ success: true, data: events });
});

router.post('/memory/matter', async (req: Request, res: Response) => {
  try {
    const { matterId, userId, memory } = req.body;
    if (!matterId || !userId || !memory) { sendApiError(res, 'BAD_REQUEST', { overrideMessage: 'matterId, userId, memory required' }); return; }
    await nv5TierMemoryService.saveMatterMemory(matterId, userId, memory, resolveMemoryScope(req, userId));
    res.json({ success: true, message: 'Matter memory saved' });
  } catch (error: any) {
    safeError(res, 'Matter memory save failed', 500);
  }
});

router.get('/memory/matter/:matterId', async (req: Request, res: Response) => {
  // NV-MEM-TENANT-001 — the caller's identity, never a query param, decides
  // which rows of a matter are readable.
  const scope = resolveMemoryScope(req);
  if (scope.userId === undefined && scope.orgId === undefined) {
    sendApiError(res, 'FORBIDDEN', { overrideMessage: 'authenticated user or org context is required' });
    return;
  }
  const memories = await nv5TierMemoryService.getMatterMemory(String(req.params.matterId), scope);
  res.json({ success: true, data: memories });
});

router.post('/memory/client', async (req: Request, res: Response) => {
  try {
    const { clientId, attribute, value, confidence, matterIds } = req.body;
    if (!clientId || !attribute || !value) { sendApiError(res, 'BAD_REQUEST', { overrideMessage: 'clientId, attribute, value required' }); return; }
    await nv5TierMemoryService.saveClientMemory(
      clientId,
      attribute,
      value,
      confidence || 1.0,
      matterIds || [],
      resolveMemoryScope(req, req.body?.userId),
    );
    res.json({ success: true, message: 'Client memory saved' });
  } catch (error: any) {
    safeError(res, 'Client memory save failed', 500);
  }
});

router.get('/memory/client/:clientId', async (req: Request, res: Response) => {
  const scope = resolveMemoryScope(req);
  if (scope.userId === undefined) {
    sendApiError(res, 'FORBIDDEN', { overrideMessage: 'authenticated user context is required' });
    return;
  }
  const memories = await nv5TierMemoryService.getClientMemory(String(req.params.clientId), scope);
  res.json({ success: true, data: memories });
});

router.get('/memory/working/:traceId', (req: Request, res: Response) => {
  const ctx = nv5TierMemoryService.getWorkingMemory(String(req.params.traceId));
  res.json({
    success: true,
    data: {
      traceId: ctx.traceId,
      createdAt: ctx.createdAt,
      keys: Array.from(ctx.entries.keys()),
      size: ctx.entries.size,
    },
  });
});

router.get('/memory/jurisdictional/:code', async (req: Request, res: Response) => {
  const code = String(req.params.code || 'IN').toUpperCase();
  const rows = await nv5TierMemoryService.getJurisdictionalMemory(code as never);
  res.json({ success: true, data: rows });
});

router.get('/memory/precedent/:jurisdiction', async (req: Request, res: Response) => {
  const rows = await nv5TierMemoryService.getPrecedentMemory(String(req.params.jurisdiction || 'IN'));
  res.json({ success: true, data: rows });
});

router.post('/memory/erase', requireRole('org_admin'), async (req: Request, res: Response) => {
  try {
    const { userId } = req.body;
    if (!userId) { sendApiError(res, 'BAD_REQUEST', { overrideMessage: 'userId required' }); return; }
    const report = await nv5TierMemoryService.eraseUserData(userId);
    res.json({ success: true, data: report });
  } catch (error: any) {
    safeError(res, 'Data erasure failed', 500);
  }
});

router.get('/vector/stats/:collection', async (req: Request, res: Response) => {
  try {
    // @ts-expect-error NV-TS230 legacy typing gap (TS2345)
    const stats = await nvVectorStore.getCollectionStats(req.params.collection);
    res.json({ success: true, data: stats });
  } catch (error: any) {
    safeError(res, 'Vector stats failed', 500);
  }
});

router.post('/template/list', async (req: Request, res: Response) => {
  try {
    const { jurisdiction, category } = req.body;
    if (!jurisdiction) { sendApiError(res, 'BAD_REQUEST', { overrideMessage: 'jurisdiction is required' }); return; }
    const templates = await nvNyayaTemplateService.getTemplates(jurisdiction, category);
    res.json({ success: true, data: templates });
  } catch (error: any) {
    logger.error({ route: 'template/list', error: (error as Error).message });
    safeError(res, 'Template listing failed', 500);
  }
});

router.post('/template/generate', async (req: Request, res: Response) => {
  try {
    const { templateId, variables, jurisdiction } = req.body;
    if (!templateId || !jurisdiction) { sendApiError(res, 'BAD_REQUEST', { overrideMessage: 'templateId and jurisdiction are required' }); return; }
    const result = await nvNyayaTemplateService.generateDocument(templateId, variables || {}, jurisdiction);
    res.json({ success: true, data: result });
  } catch (error: any) {
    logger.error({ route: 'template/generate', error: (error as Error).message });
    safeError(res, 'Template generation failed', 500);
  }
});

router.post('/template/fill-session', async (req: Request, res: Response) => {
  try {
    const { templateId, jurisdiction } = req.body;
    if (!templateId || !jurisdiction) { sendApiError(res, 'BAD_REQUEST', { overrideMessage: 'templateId and jurisdiction are required' }); return; }
    const session = await nvNyayaTemplateService.startFillSession(templateId, jurisdiction);
    res.json({ success: true, data: session });
  } catch (error: any) {
    logger.error({ route: 'template/fill-session', error: (error as Error).message });
    safeError(res, 'Fill session creation failed', 500);
  }
});

router.post('/timeline/limitation', async (req: Request, res: Response) => {
  try {
    const { causeOfAction, jurisdiction, eventDate } = req.body;
    if (!causeOfAction || !jurisdiction || !eventDate) { sendApiError(res, 'BAD_REQUEST', { overrideMessage: 'causeOfAction, jurisdiction, eventDate are required' }); return; }
    const result = await nvNyayaTimelineService.calculateLimitation(causeOfAction, jurisdiction, new Date(eventDate));
    res.json({ success: true, data: result });
  } catch (error: any) {
    logger.error({ route: 'timeline/limitation', error: (error as Error).message });
    safeError(res, 'Limitation calculation failed', 500);
  }
});

router.post('/timeline/checklist', async (req: Request, res: Response) => {
  try {
    const { caseType, court, jurisdiction } = req.body;
    if (!caseType || !jurisdiction) { sendApiError(res, 'BAD_REQUEST', { overrideMessage: 'caseType and jurisdiction are required' }); return; }
    const result = await nvNyayaTimelineService.getProceduralChecklist(caseType, court || 'district', jurisdiction);
    res.json({ success: true, data: result });
  } catch (error: any) {
    logger.error({ route: 'timeline/checklist', error: (error as Error).message });
    safeError(res, 'Checklist generation failed', 500);
  }
});

router.post('/forensic/verify', async (req: Request, res: Response) => {
  try {
    const { documentContent, mimeType, checkAiGenerated } = req.body;
    if (!documentContent) { sendApiError(res, 'BAD_REQUEST', { overrideMessage: 'documentContent is required' }); return; }
    const result = await nvNyayaForensicService.verifyDocument({
      content: documentContent,
      mimeType: mimeType || 'text/plain',
      metadata: { checkAiGenerated: checkAiGenerated ?? true },
    });
    res.json({ success: true, data: result });
  } catch (error: any) {
    logger.error({ route: 'forensic/verify', error: (error as Error).message });
    safeError(res, 'Forensic verification failed', 500);
  }
});

router.post('/trail/classify', async (req: Request, res: Response) => {
  try {
    const { matterId } = req.body;
    if (!matterId) { sendApiError(res, 'BAD_REQUEST', { overrideMessage: 'matterId is required' }); return; }
    const result = await nvNyayaTrailService.classifyMatterDocuments(matterId);
    res.json({ success: true, data: result });
  } catch (error: any) {
    logger.error({ route: 'trail/classify', error: (error as Error).message });
    safeError(res, 'Document classification failed', 500);
  }
});

router.post('/trail/privilege-log', async (req: Request, res: Response) => {
  try {
    const { matterId } = req.body;
    if (!matterId) { sendApiError(res, 'BAD_REQUEST', { overrideMessage: 'matterId is required' }); return; }
    const result = await nvNyayaTrailService.generatePrivilegeLog(matterId);
    res.json({ success: true, data: result });
  } catch (error: any) {
    logger.error({ route: 'trail/privilege-log', error: (error as Error).message });
    safeError(res, 'Privilege log generation failed', 500);
  }
});

router.post('/trail/ediscovery', async (req: Request, res: Response) => {
  try {
    const { matterId, options } = req.body;
    if (!matterId) { sendApiError(res, 'BAD_REQUEST', { overrideMessage: 'matterId is required' }); return; }
    const result = await nvNyayaTrailService.generateEDiscovery(matterId, options || { includePrivileged: false, productionFormat: 'pdf' });
    res.json({ success: true, data: result });
  } catch (error: any) {
    logger.error({ route: 'trail/ediscovery', error: (error as Error).message });
    safeError(res, 'E-discovery generation failed', 500);
  }
});

export default router;
