// JRX-NS-021 (2026-05-05): pre-existing strict-null cluster (gateway runs via tsx).
/**
 * Jurexio Enterprise Platform SDK v5.0.0 Enhanced Routes
 * 
 * New endpoints for v3.1.1 features:
 * - Enhanced OCR
 * - Statute Verification
 * - Legal Web Search
 * - Document Templates
 * - Citation Grounding
 * - Token Optimization
 * - Performance Metrics
 */

import { Router, Request, Response } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { PLATFORM_VERSION } from '../config/platform-config.js';
import { enhancedOCRService } from '../services/jurexio-enhanced-ocr-service.js';
import { statuteVerificationService } from '../services/jurexio-statute-verification-service.js';
import { legalWebSearchService } from '../services/jurexio-legal-web-search-service.js';
import { documentTemplatesService } from '../services/jurexio-document-templates-service.js';
import { citationGroundingService } from '../services/jurexio-citation-grounding-service.js';
import { tokenOptimizationService } from '../services/jurexio-token-optimization-service.js';
import { performanceMetricsService } from '../services/jurexio-performance-metrics-service.js';
import { isJrxFeatureOn } from '../config/jrx-feature-flags.js';
import { syncAgentsWithRawSQL, getSyncStatusRaw, updateAllModelsRaw, validatePromptsRaw } from '../../server/services/legal-agents/raw-database-sync.js';
import { syncLLMModelsToDatabase, getLLMModelsDbStatus, getProvidersList } from '../../server/services/llm-models/llm-models-database-sync.js';
import { syncAllDocumentation } from '../../server/services/documentation-sync-guardrail.js';
import { syncAllJurisdictionAgents, getJurisdictionStats, validateAllAgentPrompts } from '../../server/services/jurisdiction-agents/unified-jurisdiction-sync.js';
import { sanitizeErrorForClient } from '../utils/error-sanitizer.js';
import { createLogger } from '../utils/logger.js';


const logger = createLogger('v311-routes');

const router = Router();

router.use((req, res, next) => {
  const publicPaths = ['/status', '/health'];
  if (publicPaths.includes(req.path)) return next();
  return authenticateToken(req, res, next);
});

router.get('/v311/status', (req: Request, res: Response) => {
  res.json({
    success: true,
    version: PLATFORM_VERSION,
    features: {
      enhancedOCR: { status: 'active', engines: ['gpt4v', 'tesseract', 'azure'] },
      statuteVerification: { status: 'active', statutes: 15, sections: 2849 },
      legalWebSearch: { status: 'active', providers: 6 },
      documentTemplates: { status: 'active', templates: documentTemplatesService.getTemplateCount() },
      citationGrounding: { status: 'active', formats: ['indian', 'bluebook'] },
      // Session-16 (2026-06-02) token-opt unification: the /tokens/* advisory
      // endpoints stay always-on (additive contract). `advisoryFlag` exposes
      // the now-coherent JRX_F_TOKEN_OPT signal, and `enforcement` points at
      // the separate JRX_F_GOV_COST_OPT lever that actually shapes/denies spend
      // (queen orchestrator + /api/nv5/gov/cost-optimizer/*).
      tokenOptimization: {
        status: 'active',
        mode: 'advisory',
        advisoryFlag: { env: 'JRX_F_TOKEN_OPT', on: isJrxFeatureOn('tokenOpt') },
        enforcement: { env: 'JRX_F_GOV_COST_OPT', on: isJrxFeatureOn('govCostOpt'), surface: '/api/nv5/gov/cost-optimizer/*' },
      },
      performanceMetrics: { status: 'active' }
    },
    buildDate: '2026-01-30'
  });
});

router.post('/ocr/process', async (req: Request, res: Response) => {
  try {
    const { imageData, config } = req.body;
    
    const result = await enhancedOCRService.processDocument(
      imageData || 'sample-image-data',
      config || {}
    );
    
    res.json({
      success: true,
      data: result
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: sanitizeErrorForClient(error)
    });
  }
});

router.get('/ocr/document-types', (req: Request, res: Response) => {
  res.json({
    success: true,
    data: enhancedOCRService.getDocumentTypes()
  });
});

router.get('/ocr/languages', (req: Request, res: Response) => {
  res.json({
    success: true,
    data: enhancedOCRService.getSupportedLanguages()
  });
});

router.get('/ocr/capabilities', (req: Request, res: Response) => {
  res.json({
    success: true,
    data: enhancedOCRService.getCapabilities()
  });
});

router.post('/verify/content', async (req: Request, res: Response) => {
  try {
    const { content, options } = req.body;
    
    if (!content) {
      res.status(400).json({
        success: false,
        error: 'Content is required for verification'
      });
    }
    
    const result = await statuteVerificationService.verifyLegalContent(content, options || {});
    
    res.json({
      success: true,
      data: result
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: sanitizeErrorForClient(error)
    });
  }
});

router.get('/verify/statutes', (req: Request, res: Response) => {
  res.json({
    success: true,
    data: statuteVerificationService.getStatutes()
  });
});

router.get('/verify/statutes/:id', (req: Request, res: Response) => {
  // @ts-expect-error NV-TS230 legacy typing gap (TS2345)
  const statute = statuteVerificationService.getStatuteById(req.params.id);
  
  if (!statute) {
    res.status(404).json({
      success: false,
      error: 'Statute not found'
    });
  }
  
  res.json({
    success: true,
    data: statute
  });
});

router.post('/verify/citation', async (req: Request, res: Response) => {
  try {
    const { citation, format } = req.body;
    
    if (!citation) {
      res.status(400).json({
        success: false,
        error: 'Citation is required'
      });
    }
    
    const validation = citationGroundingService.validateCitationFormat(citation, format || 'indian');
    
    res.json({
      success: true,
      data: validation
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: sanitizeErrorForClient(error)
    });
  }
});

router.post('/search/legal', async (req: Request, res: Response) => {
  try {
    const { query, jurisdiction, sources, limit } = req.body;
    
    if (!query) {
      res.status(400).json({
        success: false,
        error: 'Query is required'
      });
    }
    
    const result = await legalWebSearchService.search({
      query,
      jurisdiction: jurisdiction || 'india',
      sources: sources || ['indian_kanoon', 'perplexity'],
      limit: limit || 10
    });
    
    res.json({
      success: true,
      data: result
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: sanitizeErrorForClient(error)
    });
  }
});

router.post('/search/cases', async (req: Request, res: Response) => {
  try {
    const { query, court } = req.body;
    
    const result = await legalWebSearchService.searchCaseLaw(query, court);
    
    res.json({
      success: true,
      data: result
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: sanitizeErrorForClient(error)
    });
  }
});

router.get('/search/providers', (req: Request, res: Response) => {
  res.json({
    success: true,
    data: legalWebSearchService.getProviderStatus()
  });
});

router.get('/search/courts', (req: Request, res: Response) => {
  res.json({
    success: true,
    data: legalWebSearchService.getCourts()
  });
});

router.get('/templates', (req: Request, res: Response) => {
  const { category } = req.query;
  
  let templates;
  if (category) {
    templates = documentTemplatesService.getTemplatesByCategory(category as string);
  } else {
    templates = documentTemplatesService.getAllTemplates();
  }
  
  res.json({
    success: true,
    data: templates,
    count: templates.length,
    categories: documentTemplatesService.getCategories()
  });
});

router.get('/templates/:id', (req: Request, res: Response) => {
  // @ts-expect-error NV-TS230 legacy typing gap (TS2345)
  const template = documentTemplatesService.getTemplateById(req.params.id);
  
  if (!template) {
    res.status(404).json({
      success: false,
      error: 'Template not found'
    });
  }
  
  res.json({
    success: true,
    data: template
  });
});

router.post('/templates/:id/generate', (req: Request, res: Response) => {
  try {
    const { fields, format } = req.body;
    
    // @ts-expect-error NV-TS230 legacy typing gap (TS2345)
    const validation = documentTemplatesService.validateFields(req.params.id, fields || {});
    
    if (!validation.valid) {
      res.status(400).json({
        success: false,
        error: 'Validation failed',
        errors: validation.errors
      });
    }
    
    const document = documentTemplatesService.generateDocument(
      // @ts-expect-error NV-TS230 legacy typing gap (TS2345)
      req.params.id,
      fields || {},
      format || 'text'
    );
    
    if (!document) {
      res.status(404).json({
        success: false,
        error: 'Template not found'
      });
    }
    
    res.json({
      success: true,
      data: document
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: sanitizeErrorForClient(error)
    });
  }
});

router.post('/templates/search', (req: Request, res: Response) => {
  const { query } = req.body;
  
  if (!query) {
    res.status(400).json({
      success: false,
      error: 'Query is required'
    });
  }
  
  const results = documentTemplatesService.searchTemplates(query);
  
  res.json({
    success: true,
    data: results,
    count: results.length
  });
});

router.post('/citations/ground', async (req: Request, res: Response) => {
  try {
    const { text, options } = req.body;
    
    if (!text) {
      res.status(400).json({
        success: false,
        error: 'Text is required'
      });
    }
    
    const result = await citationGroundingService.groundCitations(text, options || {});
    
    res.json({
      success: true,
      data: result
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: sanitizeErrorForClient(error)
    });
  }
});

router.post('/citations/format', (req: Request, res: Response) => {
  const { citation, targetFormat } = req.body;
  
  if (!citation) {
    res.status(400).json({
      success: false,
      error: 'Citation is required'
    });
  }
  
  let formatted;
  if (targetFormat === 'bluebook') {
    formatted = citationGroundingService.formatToBluebook(citation);
  } else {
    formatted = citationGroundingService.formatToIndian(citation);
  }
  
  res.json({
    success: true,
    data: {
      original: citation,
      formatted,
      format: targetFormat || 'indian'
    }
  });
});

router.get('/citations/reporters', (req: Request, res: Response) => {
  res.json({
    success: true,
    data: citationGroundingService.getReporters()
  });
});

router.post('/tokens/budget', (req: Request, res: Response) => {
  const { model, systemPromptTokens, contextTokens, userMessageTokens, maxOutputTokens } = req.body;
  
  const budget = tokenOptimizationService.calculateTokenBudget(
    model || 'gpt-4.1',
    systemPromptTokens || 1000,
    contextTokens || 2000,
    userMessageTokens || 500,
    maxOutputTokens
  );
  
  res.json({
    success: true,
    data: budget
  });
});

router.post('/tokens/optimize', (req: Request, res: Response) => {
  const { context, targetTokens, options } = req.body;
  
  if (!context) {
    res.status(400).json({
      success: false,
      error: 'Context is required'
    });
  }
  
  const result = tokenOptimizationService.optimizeContext(
    context,
    targetTokens || 4000,
    options || {}
  );
  
  res.json({
    success: true,
    data: result
  });
});

router.get('/tokens/tracking', (req: Request, res: Response) => {
  res.json({
    success: true,
    data: tokenOptimizationService.getCostTracking()
  });
});

router.get('/tokens/pricing', (req: Request, res: Response) => {
  res.json({
    success: true,
    data: {
      providers: tokenOptimizationService.getProviderPricing(),
      contextWindows: tokenOptimizationService.getContextWindows()
    }
  });
});

router.get('/metrics', (req: Request, res: Response) => {
  res.json({
    success: true,
    data: performanceMetricsService.getMetrics()
  });
});

router.get('/metrics/overview', (req: Request, res: Response) => {
  res.json({
    success: true,
    data: performanceMetricsService.getOverview()
  });
});

router.get('/metrics/response-time', (req: Request, res: Response) => {
  res.json({
    success: true,
    data: performanceMetricsService.getResponseTimeMetrics()
  });
});

router.get('/metrics/accuracy', (req: Request, res: Response) => {
  res.json({
    success: true,
    data: performanceMetricsService.getAccuracyMetrics()
  });
});

router.get('/metrics/usage', (req: Request, res: Response) => {
  res.json({
    success: true,
    data: performanceMetricsService.getUsageMetrics()
  });
});

router.get('/metrics/agents', (req: Request, res: Response) => {
  res.json({
    success: true,
    data: performanceMetricsService.getAgentPerformance()
  });
});

router.get('/metrics/roi', (req: Request, res: Response) => {
  res.json({
    success: true,
    data: performanceMetricsService.getROIMetrics()
  });
});

router.get('/metrics/health', (req: Request, res: Response) => {
  res.json({
    success: true,
    data: performanceMetricsService.getHealthStatus()
  });
});

router.post('/metrics/record', (req: Request, res: Response) => {
  const { responseTime, success, agentId } = req.body;
  
  performanceMetricsService.recordRequest(
    responseTime || 100,
    success !== false,
    agentId
  );
  
  res.json({
    success: true,
    message: 'Metric recorded'
  });
});

// Database Sync Endpoints - February 2, 2026 (using raw SQL for schema compatibility)
router.get('/v311/database/sync-status', async (req: Request, res: Response) => {
  try {
    const status = await getSyncStatusRaw();
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      data: status
    });
  } catch (error: any) {
    logger.error('Sync status error:', error);
    res.status(500).json({ success: false, error: sanitizeErrorForClient(error) });
  }
});

router.post('/v311/database/sync', async (req: Request, res: Response) => {
  try {
    const { forceUpdate } = req.body;
    logger.info('🔄 Starting raw SQL database sync...');
    // @ts-expect-error NV-TS230 legacy typing gap (TS2554)
    const result = await syncAgentsWithRawSQL(forceUpdate === true);
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      data: result
    });
  } catch (error: any) {
    logger.error('Database sync error:', error);
    res.status(500).json({ success: false, error: sanitizeErrorForClient(error) });
  }
});

router.post('/v311/database/update-models', async (req: Request, res: Response) => {
  try {
    logger.info('📊 Updating all agents to latest LLM models...');
    const result = await updateAllModelsRaw();
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      data: result
    });
  } catch (error: any) {
    logger.error('Update models error:', error);
    res.status(500).json({ success: false, error: sanitizeErrorForClient(error) });
  }
});

router.get('/v311/database/validate-prompts', async (req: Request, res: Response) => {
  try {
    const result = await validatePromptsRaw();
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      data: result
    });
  } catch (error: any) {
    logger.error('Validate prompts error:', error);
    res.status(500).json({ success: false, error: sanitizeErrorForClient(error) });
  }
});

router.get('/v311/llm-models/status', async (req: Request, res: Response) => {
  try {
    const status = await getLLMModelsDbStatus();
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      data: status
    });
  } catch (error: any) {
    logger.error('LLM models status error:', error);
    res.status(500).json({ success: false, error: sanitizeErrorForClient(error) });
  }
});

router.post('/v311/llm-models/sync', async (req: Request, res: Response) => {
  try {
    logger.info('📦 Syncing LLM models to database...');
    const result = await syncLLMModelsToDatabase();
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      data: result
    });
  } catch (error: any) {
    logger.error('LLM models sync error:', error);
    res.status(500).json({ success: false, error: sanitizeErrorForClient(error) });
  }
});

router.get('/v311/llm-models/providers', async (req: Request, res: Response) => {
  try {
    const providers = await getProvidersList();
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      data: providers
    });
  } catch (error: any) {
    logger.error('Get providers error:', error);
    res.status(500).json({ success: false, error: sanitizeErrorForClient(error) });
  }
});

router.post('/v311/documentation/sync', async (req: Request, res: Response) => {
  try {
    logger.info('📝 Syncing all documentation with current metrics...');
    const result = await syncAllDocumentation();
    res.json({
      // @ts-expect-error NV-TS230 legacy typing gap (TS2339)
      success: result.success,
      timestamp: new Date().toISOString(),
      data: result
    });
  } catch (error: any) {
    logger.error('Documentation sync error:', error);
    res.status(500).json({ success: false, error: sanitizeErrorForClient(error) });
  }
});

router.post('/v311/jurisdiction/sync-all', async (req: Request, res: Response) => {
  try {
    logger.info('🌍 Syncing all jurisdiction agents (USA, Europe)...');
    const result = await syncAllJurisdictionAgents();
    res.json({
      success: result.success,
      timestamp: new Date().toISOString(),
      data: result
    });
  } catch (error: any) {
    logger.error('Jurisdiction sync error:', error);
    res.status(500).json({ success: false, error: sanitizeErrorForClient(error) });
  }
});

router.get('/v311/jurisdiction/stats', async (req: Request, res: Response) => {
  try {
    const stats = await getJurisdictionStats();
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      data: stats
    });
  } catch (error: any) {
    logger.error('Jurisdiction stats error:', error);
    res.status(500).json({ success: false, error: sanitizeErrorForClient(error) });
  }
});

router.get('/v311/jurisdiction/validate', async (req: Request, res: Response) => {
  try {
    const validation = await validateAllAgentPrompts();
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      data: validation
    });
  } catch (error: any) {
    logger.error('Validation error:', error);
    res.status(500).json({ success: false, error: sanitizeErrorForClient(error) });
  }
});

export default router;
