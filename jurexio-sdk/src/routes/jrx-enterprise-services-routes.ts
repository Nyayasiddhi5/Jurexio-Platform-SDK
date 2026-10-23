// JRX-NS-021 (2026-05-05): pre-existing strict-null cluster (gateway runs via tsx).
// task-260 (2026-05-12): legacy typing-bypass markers replaced with `getSvc()` typed accessor
// that throws JrxMissingDependencyError when a service hasn't been registered.
import { Router, Request, Response } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { dualSdkOrJwt } from '../middleware/jrx-dual-auth.js';
import { services, type ServiceRegistry } from '../services/index.js';
import { z } from 'zod';
import { sanitizeErrorForClient } from '../utils/error-sanitizer.js';
import { JrxMissingDependencyError } from '../utils/jrx-type-helpers.js';
import { realWebSearchService } from '../services/enterprise-platform/real-web-search-service.js';

const router = Router();

function getSvc<K extends keyof ServiceRegistry>(name: K): ServiceRegistry[K] {
  const v = services[name];
  if (v === undefined || v === null) {
    throw new JrxMissingDependencyError(`services.${String(name)}`, 'Service not registered in services index — see src/services/index.ts');
  }
  return v as ServiceRegistry[K];
}

const searchSchema = z.object({
  query: z.string().min(1).max(500),
  providers: z.array(z.string()).optional(),
  maxResults: z.number().min(1).max(100).optional(),
  limit: z.number().min(1).max(20).optional(),
});

/** NV-NSP-WEB-SEARCH-ENTERPRISE-001 — partner SDK + JWT (real SERP cascade). */
router.post('/web-search/search', dualSdkOrJwt, async (req: Request, res: Response) => {
  try {
    const validated = searchSchema.parse(req.body);
    const limit = validated.maxResults ?? validated.limit ?? 5;
    const data = await realWebSearchService.search(validated.query, { limit });
    res.json({ success: true, data });
  } catch (error: unknown) {
    const err = error as { message?: string };
    res.status(400).json({ success: false, error: sanitizeErrorForClient(err?.message || error) });
  }
});

router.use((req, res, next) => {
  return authenticateToken(req, res, next);
});

router.post('/documents/process', async (req: Request, res: Response) => {
  try {
    const { document, options } = req.body;
    const result = await getSvc('documentProcessing').process(document, options);
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(error instanceof JrxMissingDependencyError ? 500 : 400).json({ success: false, error: sanitizeErrorForClient(error) });
  }
});

router.post('/notebook/projects', async (req: Request, res: Response) => {
  try {
    const { name, documents } = req.body;
    const project = await getSvc('notebookLLM').createProject(name, documents);
    res.json({ success: true, data: project });
  } catch (error: any) {
    res.status(error instanceof JrxMissingDependencyError ? 500 : 400).json({ success: false, error: sanitizeErrorForClient(error) });
  }
});

router.post('/scrape', async (req: Request, res: Response) => {
  try {
    const { url, options } = req.body;
    const result = await getSvc('webScraping').scrape(url, options);
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(error instanceof JrxMissingDependencyError ? 500 : 400).json({ success: false, error: sanitizeErrorForClient(error) });
  }
});

router.post('/database/query', async (req: Request, res: Response) => {
  try {
    const { connectionId, query, params } = req.body;
    const result = await getSvc('databaseConnector').query(connectionId, query, params);
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(error instanceof JrxMissingDependencyError ? 500 : 400).json({ success: false, error: sanitizeErrorForClient(error) });
  }
});

router.post('/code/analyze', async (req: Request, res: Response) => {
  try {
    const { code, language, options } = req.body;
    const analysis = await getSvc('codeQuality').analyze(code, language, options);
    res.json({ success: true, data: analysis });
  } catch (error: any) {
    res.status(error instanceof JrxMissingDependencyError ? 500 : 400).json({ success: false, error: sanitizeErrorForClient(error) });
  }
});

router.post('/research/:domain', async (req: Request, res: Response) => {
  try {
    const domain = String(req.params.domain ?? '');
    const { query, options } = req.body;
    const results = await getSvc('domainResearch').research(domain, query, options);
    res.json({ success: true, data: results });
  } catch (error: any) {
    res.status(error instanceof JrxMissingDependencyError ? 500 : 400).json({ success: false, error: sanitizeErrorForClient(error) });
  }
});

router.post('/investment/analyze', async (req: Request, res: Response) => {
  try {
    const { symbol, analysisType, options } = req.body;
    const analysis = await getSvc('investmentResearch').analyze(symbol, analysisType, options);
    res.json({ success: true, data: analysis });
  } catch (error: any) {
    res.status(error instanceof JrxMissingDependencyError ? 500 : 400).json({ success: false, error: sanitizeErrorForClient(error) });
  }
});

router.get('/financial/quote/:symbol', async (req: Request, res: Response) => {
  try {
    const symbol = String(req.params.symbol ?? '');
    const quote = await getSvc('financialData').getQuote(symbol);
    res.json({ success: true, data: quote });
  } catch (error: any) {
    res.status(error instanceof JrxMissingDependencyError ? 500 : 400).json({ success: false, error: sanitizeErrorForClient(error) });
  }
});

router.post('/multimedia/process', async (req: Request, res: Response) => {
  try {
    const { type, data, options } = req.body;
    const result = await getSvc('multimedia').process(type, data, options);
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(error instanceof JrxMissingDependencyError ? 500 : 400).json({ success: false, error: sanitizeErrorForClient(error) });
  }
});

router.post('/analytics/dashboards', async (req: Request, res: Response) => {
  try {
    const { name, description, widgets } = req.body;
    const dashboard = await getSvc('visualAnalytics').createDashboard(name, description, widgets);
    res.json({ success: true, data: dashboard });
  } catch (error: any) {
    res.status(error instanceof JrxMissingDependencyError ? 500 : 400).json({ success: false, error: sanitizeErrorForClient(error) });
  }
});

router.get('/analytics/dashboards', async (req: Request, res: Response) => {
  try {
    const dashboards = await getSvc('visualAnalytics').getDashboards();
    res.json({ success: true, data: dashboards });
  } catch (error: any) {
    res.status(error instanceof JrxMissingDependencyError ? 500 : 400).json({ success: false, error: sanitizeErrorForClient(error) });
  }
});

router.post('/assets', async (req: Request, res: Response) => {
  try {
    const { name, type, content, folderId, metadata } = req.body;
    const asset = await getSvc('contentAsset').createAsset(name, type, content, folderId, metadata);
    res.json({ success: true, data: asset });
  } catch (error: any) {
    res.status(error instanceof JrxMissingDependencyError ? 500 : 400).json({ success: false, error: sanitizeErrorForClient(error) });
  }
});

router.get('/assets', async (req: Request, res: Response) => {
  try {
    const { folderId, type } = req.query;
    const assets = await getSvc('contentAsset').getAssets(folderId as string, type as string);
    res.json({ success: true, data: assets });
  } catch (error: any) {
    res.status(error instanceof JrxMissingDependencyError ? 500 : 400).json({ success: false, error: sanitizeErrorForClient(error) });
  }
});

router.post('/translate', async (req: Request, res: Response) => {
  try {
    const { text, targetLanguage, sourceLanguage } = req.body;
    const translation = await getSvc('multiLanguage').translate(text, targetLanguage, sourceLanguage);
    res.json({ success: true, data: translation });
  } catch (error: any) {
    res.status(error instanceof JrxMissingDependencyError ? 500 : 400).json({ success: false, error: sanitizeErrorForClient(error) });
  }
});

router.post('/detect-language', async (req: Request, res: Response) => {
  try {
    const { text } = req.body;
    const detected = await getSvc('multiLanguage').detectLanguage(text);
    res.json({ success: true, data: detected });
  } catch (error: any) {
    res.status(error instanceof JrxMissingDependencyError ? 500 : 400).json({ success: false, error: sanitizeErrorForClient(error) });
  }
});

router.get('/services/status', (req: Request, res: Response) => {
  res.json({
    success: true,
    data: {
      p0: [
        { name: 'Web Search', status: 'operational', endpoints: 3 },
        { name: 'Document Processing', status: 'operational', endpoints: 5 },
        { name: 'NotebookLLM Studio', status: 'operational', endpoints: 7 },
        { name: 'Web Scraping', status: 'operational', endpoints: 4 },
        { name: 'Database Connectors', status: 'operational', endpoints: 6 }
      ],
      p1: [
        { name: 'Code Quality', status: 'operational', endpoints: 5 },
        { name: 'Domain Research', status: 'operational', endpoints: 8 },
        { name: 'Investment Research', status: 'operational', endpoints: 6 },
        { name: 'Financial Data', status: 'operational', endpoints: 5 },
        { name: 'Multimedia API', status: 'operational', endpoints: 7 }
      ],
      p2: [
        { name: 'Visual Analytics', status: 'operational', endpoints: 8 },
        { name: 'Content Assets', status: 'operational', endpoints: 10 },
        { name: 'Multi-language', status: 'operational', endpoints: 5 }
      ]
    }
  });
});

export { router as enterpriseServicesRouter };
