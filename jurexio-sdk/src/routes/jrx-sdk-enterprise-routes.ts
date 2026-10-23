// JRX-NS-021 (2026-05-05): pre-existing strict-null cluster (gateway runs via tsx).
import { Router, Request, Response } from 'express';
import { sdkGatewayAuth } from '../middleware/sdk-gateway.js';
import { tenantIsolation } from '../middleware/jrx-tenant-isolation.js';
import { guardrailEnforcementMiddleware, responseGuardrailMiddleware } from '../middleware/guardrails-enforcement.js';
import { realFinancialDataService } from '../services/enterprise-platform/real-financial-data-service.js';
import { realMultimediaAPIService } from '../services/enterprise-platform/real-multimedia-api-service.js';
import { notebookDocumentStudioService } from '../services/enterprise-platform/notebook-document-studio-service.js';
import { codeQualityGatewayService } from '../services/enterprise-platform/code-quality-gateway-service.js';
import { domainResearchAPIService } from '../services/enterprise-platform/domain-research-api-service.js';
import { investmentResearchService } from '../services/enterprise-platform/investment-research-service.js';
import { visualAnalyticsDashboardService } from '../services/enterprise-platform/visual-analytics-dashboard-service.js';
import { contentAssetManagementService } from '../services/enterprise-platform/content-asset-management-service.js';
import { realWebSearchService } from '../services/enterprise-platform/real-web-search-service.js';

function checkScope(scopes: string[], required: string): boolean {
  if (scopes.includes('*') || scopes.includes('all')) return true;
  return scopes.includes(required);
}

const router = Router();

router.use(sdkGatewayAuth);
router.use(tenantIsolation);
router.use(guardrailEnforcementMiddleware);
router.use(responseGuardrailMiddleware);

router.get('/financial/quote/:symbol', async (req: Request, res: Response): Promise<void> => {
  const ctx = req.sdkContext!;
  if (!checkScope(ctx.scopes, 'documents:read')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: documents:read' });
    return;
  }
  const symbol = req.params.symbol;
  if (!symbol || typeof symbol !== 'string') {
    res.status(400).json({ success: false, error: 'Missing required parameter: symbol' });
    return;
  }
  try {
    const data = await realFinancialDataService.getStockQuote(symbol);
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error?.message || 'Failed to fetch stock quote' });
  }
});

router.get('/financial/historical/:symbol', async (req: Request, res: Response): Promise<void> => {
  const ctx = req.sdkContext!;
  if (!checkScope(ctx.scopes, 'documents:read')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: documents:read' });
    return;
  }
  const symbol = req.params.symbol;
  if (!symbol || typeof symbol !== 'string') {
    res.status(400).json({ success: false, error: 'Missing required parameter: symbol' });
    return;
  }
  try {
    const options: any = {};
    if (req.query.interval) options.interval = req.query.interval;
    if (req.query.limit) options.limit = parseInt(req.query.limit as string, 10);
    if (req.query.from) options.from = new Date(req.query.from as string);
    if (req.query.to) options.to = new Date(req.query.to as string);
    const data = await realFinancialDataService.getHistoricalData(symbol, options);
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error?.message || 'Failed to fetch historical data' });
  }
});

router.get('/financial/fundamentals/:symbol', async (req: Request, res: Response): Promise<void> => {
  const ctx = req.sdkContext!;
  if (!checkScope(ctx.scopes, 'documents:read')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: documents:read' });
    return;
  }
  const symbol = req.params.symbol;
  if (!symbol || typeof symbol !== 'string') {
    res.status(400).json({ success: false, error: 'Missing required parameter: symbol' });
    return;
  }
  try {
    const data = await realFinancialDataService.getCompanyFundamentals(symbol);
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error?.message || 'Failed to fetch company fundamentals' });
  }
});

router.get('/financial/search', async (req: Request, res: Response): Promise<void> => {
  const ctx = req.sdkContext!;
  if (!checkScope(ctx.scopes, 'documents:read')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: documents:read' });
    return;
  }
  const q = req.query.q as string;
  if (!q || typeof q !== 'string') {
    res.status(400).json({ success: false, error: 'Missing required query parameter: q' });
    return;
  }
  try {
    const data = await realFinancialDataService.searchStocks(q);
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error?.message || 'Failed to search stocks' });
  }
});

router.get('/financial/stats', (req: Request, res: Response): void => {
  const ctx = req.sdkContext!;
  if (!checkScope(ctx.scopes, 'usage:read')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: usage:read' });
    return;
  }
  try {
    const data = realFinancialDataService.getStats();
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error?.message || 'Failed to fetch financial stats' });
  }
});

router.post('/code-review/analyze', async (req: Request, res: Response): Promise<void> => {
  const ctx = req.sdkContext!;
  if (!checkScope(ctx.scopes, 'documents:read')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: documents:read' });
    return;
  }
  const { code, language, filename } = req.body;
  if (!code || typeof code !== 'string') {
    res.status(400).json({ success: false, error: 'Missing required field: code' });
    return;
  }
  if (!language || typeof language !== 'string') {
    res.status(400).json({ success: false, error: 'Missing required field: language' });
    return;
  }
  try {
    const data = await codeQualityGatewayService.analyzeCode({
      code,
      language,
      // @ts-expect-error NV-TS230 legacy typing gap (TS2353)
      fileName: filename,
      userId: `sdk_app_${ctx.applicationId}`
    });
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error?.message || 'Failed to analyze code' });
  }
});

router.get('/code-review/stats', (req: Request, res: Response): void => {
  const ctx = req.sdkContext!;
  if (!checkScope(ctx.scopes, 'usage:read')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: usage:read' });
    return;
  }
  try {
    const data = codeQualityGatewayService.getStats();
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error?.message || 'Failed to fetch code review stats' });
  }
});

router.post('/research/domain/legal', async (req: Request, res: Response): Promise<void> => {
  // v5.0.1 (G-verification fix 2026-05-06): enterprise research is reserved for
  // enterprise/government tiers (NSI/NSM/JRX with wildcard scope). Was gated on
  // documents:read which leaked to NYM/NSA after the B2 scope additions. Now
  // gated on `enterprise:research` — wildcard `['*']` keys pass automatically.
  const ctx = req.sdkContext!;
  if (!checkScope(ctx.scopes, 'enterprise:research')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: enterprise:research' });
    return;
  }
  const { query, options } = req.body;
  if (!query || typeof query !== 'string') {
    res.status(400).json({ success: false, error: 'Missing required field: query' });
    return;
  }
  try {
    // v5.0.1 (EC2 deploy-blocker B1 fix): searchLegal/Academic/Patents/Medical
    // were missing from DomainResearchAPIService — added as typed stubs that
    // return well-shaped empty payloads with a `notice` field. See
    // src/services/enterprise-platform/domain-research-api-service.ts and
    // docs/v5.0.0/DOCUMENT-MANAGEMENT-AUDIT-AND-PLAN-2026-05-06.md (v5.0.2 backlog).
    const data = await domainResearchAPIService.searchLegal(query, options);
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error?.message || 'Failed to search legal research' });
  }
});

router.post('/research/domain/academic', async (req: Request, res: Response): Promise<void> => {
  const ctx = req.sdkContext!;
  if (!checkScope(ctx.scopes, 'enterprise:research')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: enterprise:research' });
    return;
  }
  const { query, options } = req.body;
  if (!query || typeof query !== 'string') {
    res.status(400).json({ success: false, error: 'Missing required field: query' });
    return;
  }
  try {
    const data = await domainResearchAPIService.searchAcademic(query, options);
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error?.message || 'Failed to search academic research' });
  }
});

router.post('/research/domain/patents', async (req: Request, res: Response): Promise<void> => {
  const ctx = req.sdkContext!;
  if (!checkScope(ctx.scopes, 'enterprise:research')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: enterprise:research' });
    return;
  }
  const { query, options } = req.body;
  if (!query || typeof query !== 'string') {
    res.status(400).json({ success: false, error: 'Missing required field: query' });
    return;
  }
  try {
    const data = await domainResearchAPIService.searchPatents(query, options);
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error?.message || 'Failed to search patents' });
  }
});

router.post('/research/domain/medical', async (req: Request, res: Response): Promise<void> => {
  const ctx = req.sdkContext!;
  if (!checkScope(ctx.scopes, 'enterprise:research')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: enterprise:research' });
    return;
  }
  const { query, options } = req.body;
  if (!query || typeof query !== 'string') {
    res.status(400).json({ success: false, error: 'Missing required field: query' });
    return;
  }
  try {
    const data = await domainResearchAPIService.searchMedical(query, options);
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error?.message || 'Failed to search medical research' });
  }
});

router.post('/research/domain/synthesize', async (req: Request, res: Response): Promise<void> => {
  const ctx = req.sdkContext!;
  if (!checkScope(ctx.scopes, 'enterprise:research')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: enterprise:research' });
    return;
  }
  const { query, domain, options } = req.body;
  if (!query || typeof query !== 'string') {
    res.status(400).json({ success: false, error: 'Missing required field: query' });
    return;
  }
  if (!domain || typeof domain !== 'string') {
    res.status(400).json({ success: false, error: 'Missing required field: domain' });
    return;
  }
  try {
    // v5.0.1 (B1 follow-up): aligned with route path /research/domain/patents
    // (plural) and DomainResearchAPIService.DomainType. Was 'patent' (singular)
    // which caused a 400 for clients calling with the path-consistent value.
    const validDomains = ['legal', 'academic', 'patents', 'medical', 'general'] as const;
    type DomainType = typeof validDomains[number];
    if (!validDomains.includes(domain as DomainType)) {
      res.status(400).json({ success: false, error: `Invalid domain. Must be one of: ${validDomains.join(', ')}` });
      return;
    }
    const data = await domainResearchAPIService.generateResearchSynthesis(query, domain as DomainType);
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error?.message || 'Failed to synthesize research' });
  }
});

router.post('/research/investment/analyze', async (req: Request, res: Response): Promise<void> => {
  const ctx = req.sdkContext!;
  if (!checkScope(ctx.scopes, 'enterprise:research')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: enterprise:research' });
    return;
  }
  const { symbol, options } = req.body;
  if (!symbol || typeof symbol !== 'string') {
    res.status(400).json({ success: false, error: 'Missing required field: symbol' });
    return;
  }
  try {
    const data = await investmentResearchService.getCompanyFundamentals(symbol);
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error?.message || 'Failed to analyze company' });
  }
});

router.post('/research/investment/filings', async (req: Request, res: Response): Promise<void> => {
  const ctx = req.sdkContext!;
  if (!checkScope(ctx.scopes, 'enterprise:research')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: enterprise:research' });
    return;
  }
  const { query, options } = req.body;
  if (!query || typeof query !== 'string') {
    res.status(400).json({ success: false, error: 'Missing required field: query' });
    return;
  }
  try {
    // @ts-expect-error NV-TS230 legacy typing gap (TS2339)
    const data = await investmentResearchService.searchSECFilings(query, options);
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error?.message || 'Failed to search filings' });
  }
});

router.post('/research/investment/market-trends', async (req: Request, res: Response): Promise<void> => {
  const ctx = req.sdkContext!;
  if (!checkScope(ctx.scopes, 'enterprise:research')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: enterprise:research' });
    return;
  }
  const { sector, options } = req.body;
  if (!sector || typeof sector !== 'string') {
    res.status(400).json({ success: false, error: 'Missing required field: sector' });
    return;
  }
  try {
    // @ts-expect-error NV-TS230 legacy typing gap (TS2339)
    const data = await investmentResearchService.analyzeMarket({ sector, context: options?.context });
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error?.message || 'Failed to get market trends' });
  }
});

router.post('/analytics/visual/chart', async (req: Request, res: Response): Promise<void> => {
  const ctx = req.sdkContext!;
  if (!checkScope(ctx.scopes, 'usage:read')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: usage:read' });
    return;
  }
  const { dataSource, metrics, timeRange, granularity, aggregation, dimensions, filters } = req.body;
  if (!metrics || !Array.isArray(metrics) || metrics.length === 0) {
    res.status(400).json({ success: false, error: 'Missing required field: metrics (array)' });
    return;
  }
  if (!timeRange || !timeRange.start || !timeRange.end) {
    res.status(400).json({ success: false, error: 'Missing required field: timeRange (with start and end)' });
    return;
  }
  try {
    // @ts-expect-error NV-TS230 legacy typing gap (TS2339)
    const data = await visualAnalyticsDashboardService.generateChartData({
      dataSource: dataSource || 'api-metrics',
      metrics,
      dimensions,
      filters,
      timeRange: { start: new Date(timeRange.start), end: new Date(timeRange.end) },
      granularity: granularity || 'day',
      aggregation: aggregation || 'sum'
    });
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error?.message || 'Failed to generate chart' });
  }
});

router.post('/analytics/visual/dashboard', async (req: Request, res: Response): Promise<void> => {
  const ctx = req.sdkContext!;
  if (!checkScope(ctx.scopes, 'usage:read')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: usage:read' });
    return;
  }
  const { name, description, layout, isPublic, tags } = req.body;
  if (!name || typeof name !== 'string') {
    res.status(400).json({ success: false, error: 'Missing required field: name' });
    return;
  }
  try {
    const data = await visualAnalyticsDashboardService.createDashboard(
      name,
      // @ts-expect-error NV-TS230 legacy typing gap (TS2554)
      `sdk_app_${ctx.applicationId}`,
      { description, layout, isPublic, tags }
    );
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error?.message || 'Failed to create dashboard' });
  }
});

router.get('/analytics/visual/stats', async (req: Request, res: Response): Promise<void> => {
  const ctx = req.sdkContext!;
  if (!checkScope(ctx.scopes, 'usage:read')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: usage:read' });
    return;
  }
  try {
    // @ts-expect-error NV-TS230 legacy typing gap (TS2339)
    const data = await visualAnalyticsDashboardService.getSystemHealth();
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error?.message || 'Failed to fetch analytics stats' });
  }
});

router.post('/assets/upload', async (req: Request, res: Response): Promise<void> => {
  const ctx = req.sdkContext!;
  if (!checkScope(ctx.scopes, 'enterprise:assets')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: enterprise:assets' });
    return;
  }
  const { content, originalName, mimeType, tags, metadata, folderId } = req.body;
  if (!content || typeof content !== 'string') {
    res.status(400).json({ success: false, error: 'Missing required field: content (base64 encoded)' });
    return;
  }
  if (!originalName || typeof originalName !== 'string') {
    res.status(400).json({ success: false, error: 'Missing required field: originalName' });
    return;
  }
  if (!mimeType || typeof mimeType !== 'string') {
    res.status(400).json({ success: false, error: 'Missing required field: mimeType' });
    return;
  }
  try {
    const fileBuffer = Buffer.from(content, 'base64');
    // @ts-expect-error NV-TS230 legacy typing gap (TS2339)
    const data = await contentAssetManagementService.createAsset(
      fileBuffer,
      originalName,
      mimeType,
      `sdk_app_${ctx.applicationId}`,
      { folderId, tags, metadata }
    );
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error?.message || 'Failed to upload asset' });
  }
});

router.get('/assets/stats', async (req: Request, res: Response): Promise<void> => {
  const ctx = req.sdkContext!;
  if (!checkScope(ctx.scopes, 'usage:read')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: usage:read' });
    return;
  }
  try {
    // @ts-expect-error NV-TS230 legacy typing gap (TS2339)
    const data = await contentAssetManagementService.getStorageStats(`sdk_app_${ctx.applicationId}`);
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error?.message || 'Failed to fetch asset stats' });
  }
});

router.get('/assets/:assetId', async (req: Request, res: Response): Promise<void> => {
  const ctx = req.sdkContext!;
  if (!checkScope(ctx.scopes, 'enterprise:assets')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: enterprise:assets' });
    return;
  }
  const assetId = req.params.assetId;
  if (!assetId || typeof assetId !== 'string') {
    res.status(400).json({ success: false, error: 'Missing required parameter: assetId' });
    return;
  }
  try {
    const data = await contentAssetManagementService.getAsset(assetId);
    if (!data) {
      res.status(404).json({ success: false, error: 'Asset not found' });
      return;
    }
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error?.message || 'Failed to fetch asset' });
  }
});

router.get('/assets', async (req: Request, res: Response): Promise<void> => {
  const ctx = req.sdkContext!;
  if (!checkScope(ctx.scopes, 'enterprise:assets')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: enterprise:assets' });
    return;
  }
  try {
    const query = (req.query.q as string) || '';
    const options: any = {
      ownerId: `sdk_app_${ctx.applicationId}`
    };
    if (req.query.category) options.category = req.query.category;
    if (req.query.page) options.page = parseInt(req.query.page as string, 10);
    if (req.query.pageSize) options.pageSize = parseInt(req.query.pageSize as string, 10);
    if (req.query.folderId) options.folderId = req.query.folderId;
    const data = await contentAssetManagementService.searchAssets(query, options);
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error?.message || 'Failed to list assets' });
  }
});

router.delete('/assets/:assetId', async (req: Request, res: Response): Promise<void> => {
  const ctx = req.sdkContext!;
  if (!checkScope(ctx.scopes, 'documents:write') && !checkScope(ctx.scopes, 'documents:read')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: documents:write or documents:read' });
    return;
  }
  const assetId = req.params.assetId;
  if (!assetId || typeof assetId !== 'string') {
    res.status(400).json({ success: false, error: 'Missing required parameter: assetId' });
    return;
  }
  try {
    const deleted = await contentAssetManagementService.deleteAsset(assetId);
    if (!deleted) {
      res.status(404).json({ success: false, error: 'Asset not found' });
      return;
    }
    res.json({ success: true, data: { assetId, deleted: true } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error?.message || 'Failed to delete asset' });
  }
});

router.post('/search/web', async (req: Request, res: Response): Promise<void> => {
  const ctx = req.sdkContext!;
  if (!checkScope(ctx.scopes, 'enterprise:research')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: enterprise:research' });
    return;
  }
  const { query, options } = req.body;
  if (!query || typeof query !== 'string') {
    res.status(400).json({ success: false, error: 'Missing required field: query' });
    return;
  }
  try {
    const data = await realWebSearchService.search(query, options || {});
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error?.message || 'Failed to perform web search' });
  }
});

router.get('/search/stats', (req: Request, res: Response): void => {
  const ctx = req.sdkContext!;
  if (!checkScope(ctx.scopes, 'usage:read')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: usage:read' });
    return;
  }
  try {
    const providers = realWebSearchService.getProviderStats();
    const cache = realWebSearchService.getCacheStats();
    res.json({ success: true, data: { providers, cache } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error?.message || 'Failed to fetch search stats' });
  }
});

export default router;
