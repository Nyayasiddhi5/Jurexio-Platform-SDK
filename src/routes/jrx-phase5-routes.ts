// JRX-NS-021 (2026-05-05): pre-existing strict-null cluster (gateway runs via tsx).
import { requireDb } from '../utils/jrx-type-helpers.js';
import { Router, Request, Response } from 'express';
import { authenticateToken, requireRole } from '../middleware/auth.js';
import { sanitizeErrorForClient } from '../utils/error-sanitizer.js';
import crypto from 'crypto';
import {
  nvAutonomousWorkflow, nvMarketplace, nvAutoBilling,
  nvKnowledgeGraph, nvFineTuning, nvPredictiveAnalytics,
  nvAgentLearning, nvRAGEnhancements, nvAdversarialTesting,
  nvDataLineage,
} from '../services/jrx-phase5-services.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('phase5-routes');

const router = Router();

function userId(req: Request): string {
  return req.user?.userId || req.user?.id || 'anonymous';
}

// ── Health Check ─────────────────────────────────────────────────────────────
router.get('/phase5/health', (_req: Request, res: Response) => {
  res.json({
    success: true,
    status: 'ok',
    phase: 5,
    version: '5.0.0',
    services: 10,
    serviceNames: [
      'autonomous-workflows', 'agent-marketplace', 'auto-billing',
      'knowledge-graph', 'fine-tuning', 'predictive-analytics',
      'agent-learning', 'rag-enhancements', 'adversarial-testing', 'data-lineage',
    ],
    endpoints: 51,
    timestamp: new Date().toISOString(),
  });
});

// ── Autonomous Workflows ──────────────────────────────────────────────────────
router.post('/workflows', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { name, description, steps, triggerType } = req.body;
    if (!name) { res.status(400).json({ success: false, error: 'name is required' }); return; }
    if (!steps || !Array.isArray(steps) || !steps.length) { res.status(400).json({ success: false, error: 'steps (non-empty array) is required' }); return; }
    const result = await nvAutonomousWorkflow.defineWorkflow({ name, description, steps, triggerType, ownerId: userId(req) });
    res.json({ success: true, data: result });
  } catch (err: any) { res.status(500).json({ success: false, error: sanitizeErrorForClient(err) }); }
});

router.post('/workflows/:id/execute', authenticateToken, async (req: Request, res: Response) => {
  try {
    // @ts-expect-error NV-TS230 legacy typing gap (TS2345)
    const wfId = parseInt(req.params.id);
    if (isNaN(wfId)) { res.status(400).json({ success: false, error: 'Invalid workflow ID' }); return; }
    const { input } = req.body;
    if (!input) { res.status(400).json({ success: false, error: 'input is required' }); return; }
    const result = await nvAutonomousWorkflow.executeWorkflow({ workflowId: wfId, triggerInput: input, userId: userId(req) });
    res.json({ success: true, data: result });
  } catch (err: any) { res.status(500).json({ success: false, error: sanitizeErrorForClient(err) }); }
});

router.get('/workflows', authenticateToken, async (req: Request, res: Response) => {
  try {
    const result = await nvAutonomousWorkflow.listWorkflows(userId(req));
    res.json({ success: true, data: result });
  } catch (err: any) { res.status(500).json({ success: false, error: sanitizeErrorForClient(err) }); }
});

router.get('/workflows/templates', authenticateToken, async (_req: Request, res: Response) => {
  try {
    const result = nvAutonomousWorkflow.getWorkflowTemplates();
    res.json({ success: true, data: result });
  } catch (err: any) { res.status(500).json({ success: false, error: sanitizeErrorForClient(err) }); }
});

router.get('/workflows/executions/:id', authenticateToken, async (req: Request, res: Response) => {
  try {
    // @ts-expect-error NV-TS230 legacy typing gap (TS2345)
    const id = parseInt(req.params.id);
    if (isNaN(id)) { res.status(400).json({ success: false, error: 'Invalid execution ID' }); return; }
    const result = await nvAutonomousWorkflow.getExecution(id);
    if (!result) { res.status(404).json({ success: false, error: 'Execution not found' }); return; }
    res.json({ success: true, data: result });
  } catch (err: any) { res.status(500).json({ success: false, error: sanitizeErrorForClient(err) }); }
});

// ── Agent Marketplace ─────────────────────────────────────────────────────────
router.get('/marketplace/agents', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { category, search, sort, page, limit } = req.query;
    const result = await nvMarketplace.listAgents({ category: category as string, search: search as string, sort: sort as string, page: page ? parseInt(page as string) : 1, limit: limit ? parseInt(limit as string) : 20 });
    res.json({ success: true, data: result });
  } catch (err: any) { res.status(500).json({ success: false, error: sanitizeErrorForClient(err) }); }
});

router.post('/marketplace/agents', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { agentConfig, name, description, category, priceUsd, tags } = req.body;
    if (!name) { res.status(400).json({ success: false, error: 'name is required' }); return; }
    const result = await nvMarketplace.publishAgent({ agentConfig: agentConfig || {}, sellerId: userId(req), name, description, category, priceUsd, tags });
    res.json({ success: true, data: result });
  } catch (err: any) { res.status(500).json({ success: false, error: sanitizeErrorForClient(err) }); }
});

router.post('/marketplace/agents/:id/install', authenticateToken, async (req: Request, res: Response) => {
  try {
    // @ts-expect-error NV-TS230 legacy typing gap (TS2345)
    const listingId = parseInt(req.params.id);
    if (isNaN(listingId)) { res.status(400).json({ success: false, error: 'Invalid listing ID' }); return; }
    const result = await nvMarketplace.installAgent({ listingId, buyerId: userId(req), orgId: req.body.orgId });
    res.json({ success: true, data: result });
  } catch (err: any) { res.status(500).json({ success: false, error: sanitizeErrorForClient(err) }); }
});

router.get('/marketplace/agents/:id', authenticateToken, async (req: Request, res: Response) => {
  try {
    // @ts-expect-error NV-TS230 legacy typing gap (TS2345)
    const id = parseInt(req.params.id);
    if (isNaN(id)) { res.status(400).json({ success: false, error: 'Invalid listing ID' }); return; }
    const result = await nvMarketplace.getAgent(id);
    if (!result) { res.status(404).json({ success: false, error: 'Agent listing not found' }); return; }
    res.json({ success: true, data: result });
  } catch (err: any) { res.status(500).json({ success: false, error: sanitizeErrorForClient(err) }); }
});

router.post('/marketplace/agents/:id/rate', authenticateToken, async (req: Request, res: Response) => {
  try {
    // @ts-expect-error NV-TS230 legacy typing gap (TS2345)
    const listingId = parseInt(req.params.id);
    if (isNaN(listingId)) { res.status(400).json({ success: false, error: 'Invalid listing ID' }); return; }
    const { rating } = req.body;
    if (!rating || typeof rating !== 'number') { res.status(400).json({ success: false, error: 'rating (number 1-5) is required' }); return; }
    const result = await nvMarketplace.rateAgent({ listingId, rating, userId: userId(req) });
    res.json({ success: true, data: result });
  } catch (err: any) { res.status(500).json({ success: false, error: sanitizeErrorForClient(err) }); }
});

router.get('/marketplace/stats', authenticateToken, async (_req: Request, res: Response) => {
  try {
    const result = await nvMarketplace.getMarketplaceStats();
    res.json({ success: true, data: result });
  } catch (err: any) { res.status(500).json({ success: false, error: sanitizeErrorForClient(err) }); }
});

// ── Billing ───────────────────────────────────────────────────────────────────
router.post('/billing/track', authenticateToken, requireRole('org_admin', 'super_admin'), async (req: Request, res: Response) => {
  try {
    const { orgId, activityType, resourceId, units, unitPrice, tier } = req.body;
    if (!orgId) { res.status(400).json({ success: false, error: 'orgId is required' }); return; }
    if (!activityType) { res.status(400).json({ success: false, error: 'activityType is required' }); return; }
    const result = await nvAutoBilling.trackActivity({ orgId, userId: userId(req), activityType, resourceId, units, unitPrice, tier });
    res.json({ success: true, data: result });
  } catch (err: any) { res.status(500).json({ success: false, error: sanitizeErrorForClient(err) }); }
});

router.post('/billing/invoices/generate', authenticateToken, requireRole('org_admin', 'super_admin'), async (req: Request, res: Response) => {
  try {
    const { orgId, periodStart, periodEnd } = req.body;
    if (!orgId || !periodStart || !periodEnd) { res.status(400).json({ success: false, error: 'orgId, periodStart, periodEnd are required' }); return; }
    const result = await nvAutoBilling.generateInvoice({ orgId, periodStart, periodEnd });
    res.json({ success: true, data: result });
  } catch (err: any) { res.status(500).json({ success: false, error: sanitizeErrorForClient(err) }); }
});

router.get('/billing/invoices', authenticateToken, async (req: Request, res: Response) => {
  try {
    const orgId = (req.query.orgId as string) || userId(req);
    const result = await nvAutoBilling.getInvoices(orgId);
    res.json({ success: true, data: result });
  } catch (err: any) { res.status(500).json({ success: false, error: sanitizeErrorForClient(err) }); }
});

router.get('/billing/usage', authenticateToken, async (req: Request, res: Response) => {
  try {
    const orgId = (req.query.orgId as string) || userId(req);
    const days = parseInt(req.query.days as string || '30');
    const result = await nvAutoBilling.getUsageSummary(orgId, days);
    res.json({ success: true, data: result });
  } catch (err: any) { res.status(500).json({ success: false, error: sanitizeErrorForClient(err) }); }
});

router.get('/billing/pricing', authenticateToken, async (_req: Request, res: Response) => {
  try {
    const result = nvAutoBilling.getPricingTiers();
    res.json({ success: true, data: result });
  } catch (err: any) { res.status(500).json({ success: false, error: sanitizeErrorForClient(err) }); }
});

// ── Knowledge Graph ───────────────────────────────────────────────────────────
router.post('/graph/entities', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { entityType, name, description, properties } = req.body;
    if (!name) { res.status(400).json({ success: false, error: 'name is required' }); return; }
    if (!entityType) { res.status(400).json({ success: false, error: 'entityType is required' }); return; }
    const result = await nvKnowledgeGraph.addEntity({ entityType, name, description, properties });
    res.json({ success: true, data: result });
  } catch (err: any) { res.status(500).json({ success: false, error: sanitizeErrorForClient(err) }); }
});

router.post('/graph/edges', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { fromEntityId, toEntityId, relationshipType, weight, properties } = req.body;
    if (!fromEntityId || !toEntityId || !relationshipType) { res.status(400).json({ success: false, error: 'fromEntityId, toEntityId, relationshipType are required' }); return; }
    const result = await nvKnowledgeGraph.addRelationship({ fromEntityId, toEntityId, relationshipType, weight, properties });
    res.json({ success: true, data: result });
  } catch (err: any) { res.status(500).json({ success: false, error: sanitizeErrorForClient(err) }); }
});

router.post('/graph/query', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { query, entityTypes, maxDepth, topK } = req.body;
    if (!query) { res.status(400).json({ success: false, error: 'query is required' }); return; }
    const result = await nvKnowledgeGraph.queryGraph({ query, entityTypes, maxDepth, topK });
    res.json({ success: true, data: result });
  } catch (err: any) { res.status(500).json({ success: false, error: sanitizeErrorForClient(err) }); }
});

router.post('/graph/rag', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { query } = req.body;
    if (!query) { res.status(400).json({ success: false, error: 'query is required' }); return; }
    const context = await nvKnowledgeGraph.graphRAGSearch(query);
    res.json({ success: true, data: { context, query } });
  } catch (err: any) { res.status(500).json({ success: false, error: sanitizeErrorForClient(err) }); }
});

router.get('/graph/entity/:id/network', authenticateToken, async (req: Request, res: Response) => {
  try {
    // @ts-expect-error NV-TS230 legacy typing gap (TS2345)
    const id = parseInt(req.params.id);
    if (isNaN(id)) { res.status(400).json({ success: false, error: 'Invalid entity ID' }); return; }
    const depth = parseInt(req.query.depth as string || '1');
    const result = await nvKnowledgeGraph.getEntityNetwork(id, depth);
    if (!result) { res.status(404).json({ success: false, error: 'Entity not found' }); return; }
    res.json({ success: true, data: result });
  } catch (err: any) { res.status(500).json({ success: false, error: sanitizeErrorForClient(err) }); }
});

router.get('/graph/stats', authenticateToken, async (_req: Request, res: Response) => {
  try {
    const result = await nvKnowledgeGraph.getGraphStats();
    res.json({ success: true, data: result });
  } catch (err: any) { res.status(500).json({ success: false, error: sanitizeErrorForClient(err) }); }
});

// ── Fine-Tuning ───────────────────────────────────────────────────────────────
router.post('/fine-tuning/prepare', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { agentKey, minRating, limit } = req.body;
    if (!agentKey) { res.status(400).json({ success: false, error: 'agentKey is required' }); return; }
    const result = await nvFineTuning.prepareTrainingData({ agentKey, minRating, limit });
    res.json({ success: true, data: result });
  } catch (err: any) { res.status(500).json({ success: false, error: sanitizeErrorForClient(err) }); }
});

router.post('/fine-tuning/jobs', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { modelBase, agentKey, trainingExamples, hyperparameters } = req.body;
    if (!agentKey) { res.status(400).json({ success: false, error: 'agentKey is required' }); return; }
    const result = await nvFineTuning.createFineTuningJob({ modelBase, agentKey, trainingExamples, hyperparameters });
    res.json({ success: true, data: result });
  } catch (err: any) { res.status(500).json({ success: false, error: sanitizeErrorForClient(err) }); }
});

router.get('/fine-tuning/jobs', authenticateToken, async (_req: Request, res: Response) => {
  try {
    const result = await nvFineTuning.listJobs();
    res.json({ success: true, data: result });
  } catch (err: any) { res.status(500).json({ success: false, error: sanitizeErrorForClient(err) }); }
});

router.get('/fine-tuning/jobs/:id', authenticateToken, async (req: Request, res: Response) => {
  try {
    // @ts-expect-error NV-TS230 legacy typing gap (TS2345)
    const id = parseInt(req.params.id);
    if (isNaN(id)) { res.status(400).json({ success: false, error: 'Invalid job ID' }); return; }
    const result = await nvFineTuning.getJobStatus(id);
    if (!result) { res.status(404).json({ success: false, error: 'Fine-tuning job not found' }); return; }
    res.json({ success: true, data: result });
  } catch (err: any) { res.status(500).json({ success: false, error: sanitizeErrorForClient(err) }); }
});

router.post('/fine-tuning/jobs/:id/deploy', authenticateToken, requireRole('org_admin'), async (req: Request, res: Response) => {
  try {
    // @ts-expect-error NV-TS230 legacy typing gap (TS2345)
    const id = parseInt(req.params.id);
    if (isNaN(id)) { res.status(400).json({ success: false, error: 'Invalid job ID' }); return; }
    const result = await nvFineTuning.deployModel(id);
    res.json({ success: true, data: result });
  } catch (err: any) { res.status(500).json({ success: false, error: sanitizeErrorForClient(err) }); }
});

// ── Predictive Analytics ──────────────────────────────────────────────────────
router.post('/analytics/predict/case-outcome', authenticateToken, async (req: Request, res: Response) => {
  try {
    const result = nvPredictiveAnalytics.predictCaseOutcome(req.body);
    res.json({ success: true, data: result });
  } catch (err: any) { res.status(500).json({ success: false, error: sanitizeErrorForClient(err) }); }
});

router.post('/analytics/estimate/litigation-cost', authenticateToken, async (req: Request, res: Response) => {
  try {
    const result = nvPredictiveAnalytics.estimateLitigationCost(req.body);
    res.json({ success: true, data: result });
  } catch (err: any) { res.status(500).json({ success: false, error: sanitizeErrorForClient(err) }); }
});

router.post('/analytics/forecast/timeline', authenticateToken, async (req: Request, res: Response) => {
  try {
    const result = nvPredictiveAnalytics.forecastMatterTimeline(req.body);
    res.json({ success: true, data: result });
  } catch (err: any) { res.status(500).json({ success: false, error: sanitizeErrorForClient(err) }); }
});

router.get('/analytics/model/stats', authenticateToken, async (_req: Request, res: Response) => {
  try {
    const result = nvPredictiveAnalytics.getModelStats();
    res.json({ success: true, data: result });
  } catch (err: any) { res.status(500).json({ success: false, error: sanitizeErrorForClient(err) }); }
});

// ── Agent Learning ────────────────────────────────────────────────────────────
router.post('/learning/analyze/:agentKey', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { lookbackDays } = req.body;
    // @ts-expect-error NV-TS230 legacy typing gap (TS2322)
    const result = await nvAgentLearning.analyzeAgentFeedback({ agentKey: req.params.agentKey, lookbackDays });
    res.json({ success: true, data: result });
  } catch (err: any) { res.status(500).json({ success: false, error: sanitizeErrorForClient(err) }); }
});

router.post('/learning/suggest/:agentKey', authenticateToken, async (req: Request, res: Response) => {
  try {
    // @ts-expect-error NV-TS230 legacy typing gap (TS2322)
    const result = await nvAgentLearning.generateImprovementSuggestions({ agentKey: req.params.agentKey });
    res.json({ success: true, data: result });
  } catch (err: any) { res.status(500).json({ success: false, error: sanitizeErrorForClient(err) }); }
});

router.post('/learning/apply/:agentKey', authenticateToken, requireRole('org_admin'), async (req: Request, res: Response) => {
  try {
    const { suggestions } = req.body;
    if (!suggestions || !Array.isArray(suggestions)) { res.status(400).json({ success: false, error: 'suggestions (array) is required' }); return; }
    // @ts-expect-error NV-TS230 legacy typing gap (TS2322)
    const result = await nvAgentLearning.applyLearning({ agentKey: req.params.agentKey, suggestions, approvedBy: userId(req) });
    res.json({ success: true, data: result });
  } catch (err: any) { res.status(500).json({ success: false, error: sanitizeErrorForClient(err) }); }
});

router.get('/learning/top-agents', authenticateToken, async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string || '10');
    const result = await nvAgentLearning.getTopPerformingAgents(limit);
    res.json({ success: true, data: result });
  } catch (err: any) { res.status(500).json({ success: false, error: sanitizeErrorForClient(err) }); }
});

// ── RAG Enhancements ──────────────────────────────────────────────────────────
router.post('/rag/feedback', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { chunkId, documentId, query, relevant } = req.body;
    if (!chunkId || !query || relevant === undefined) { res.status(400).json({ success: false, error: 'chunkId, query, relevant are required' }); return; }
    const result = await nvRAGEnhancements.submitRelevanceFeedback({ userId: userId(req), chunkId, documentId, query, relevant });
    res.json({ success: true, data: result });
  } catch (err: any) { res.status(500).json({ success: false, error: sanitizeErrorForClient(err) }); }
});

router.post('/rag/multi-source', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { query, sources, topK } = req.body;
    if (!query) { res.status(400).json({ success: false, error: 'query is required' }); return; }
    const result = await nvRAGEnhancements.multiSourceSearch({ query, sources, topK });
    res.json({ success: true, data: result });
  } catch (err: any) { res.status(500).json({ success: false, error: sanitizeErrorForClient(err) }); }
});

router.post('/rag/org-memory', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { orgId, key, value, expiresInDays } = req.body;
    if (!orgId || !key || !value) { res.status(400).json({ success: false, error: 'orgId, key, value are required' }); return; }
    const result = await nvRAGEnhancements.storeOrgMemory({ orgId, key, value, expiresInDays });
    res.json({ success: true, data: result });
  } catch (err: any) { res.status(500).json({ success: false, error: sanitizeErrorForClient(err) }); }
});

router.get('/rag/org-memory', authenticateToken, async (req: Request, res: Response) => {
  try {
    const orgId = (req.query.orgId as string) || userId(req);
    const query = req.query.query as string || '';
    if (!query) { res.status(400).json({ success: false, error: 'query parameter is required' }); return; }
    const memories = await nvRAGEnhancements.retrieveOrgMemory({ orgId, query, limit: parseInt(req.query.limit as string || '5') });
    const withDecay = nvRAGEnhancements.applyForgettingCurve(memories);
    res.json({ success: true, data: withDecay });
  } catch (err: any) { res.status(500).json({ success: false, error: sanitizeErrorForClient(err) }); }
});

router.post('/rag/knowledge-graph', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { query } = req.body;
    if (!query) { res.status(400).json({ success: false, error: 'query is required' }); return; }
    const context = await nvRAGEnhancements.getKnowledgeGraphContext(query);
    res.json({ success: true, data: { context, query } });
  } catch (err: any) { res.status(500).json({ success: false, error: sanitizeErrorForClient(err) }); }
});

// ── Adversarial Testing ───────────────────────────────────────────────────────
router.post('/adversarial/injection-test', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { agentKey } = req.body;
    if (!agentKey) { res.status(400).json({ success: false, error: 'agentKey is required' }); return; }
    const result = await nvAdversarialTesting.runPromptInjectionTest({ agentKey, userId: userId(req) });
    res.json({ success: true, data: result });
  } catch (err: any) { res.status(500).json({ success: false, error: sanitizeErrorForClient(err) }); }
});

router.post('/adversarial/jailbreak-test', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { agentKey } = req.body;
    if (!agentKey) { res.status(400).json({ success: false, error: 'agentKey is required' }); return; }
    const result = await nvAdversarialTesting.runJailbreakTest({ agentKey, userId: userId(req) });
    res.json({ success: true, data: result });
  } catch (err: any) { res.status(500).json({ success: false, error: sanitizeErrorForClient(err) }); }
});

router.post('/adversarial/bias-test', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { agentKey } = req.body;
    if (!agentKey) { res.status(400).json({ success: false, error: 'agentKey is required' }); return; }
    const result = await nvAdversarialTesting.runBiasAuditTest({ agentKey, userId: userId(req) });
    res.json({ success: true, data: result });
  } catch (err: any) { res.status(500).json({ success: false, error: sanitizeErrorForClient(err) }); }
});

router.post('/adversarial/red-team', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { agentKey } = req.body;
    if (!agentKey) { res.status(400).json({ success: false, error: 'agentKey is required' }); return; }
    const result = await nvAdversarialTesting.runFullRedTeam({ agentKey, userId: userId(req) });
    res.json({ success: true, data: result });
  } catch (err: any) { res.status(500).json({ success: false, error: sanitizeErrorForClient(err) }); }
});

router.get('/adversarial/results', authenticateToken, async (_req: Request, res: Response) => {
  try {
    const result = await nvAdversarialTesting.getTestResults();
    res.json({ success: true, data: result });
  } catch (err: any) { res.status(500).json({ success: false, error: sanitizeErrorForClient(err) }); }
});

// ── Data Lineage ──────────────────────────────────────────────────────────────
router.get('/lineage/:requestId', authenticateToken, async (req: Request, res: Response) => {
  try {
    // @ts-expect-error NV-TS230 legacy typing gap (TS2345)
    const result = await nvDataLineage.getLineage(req.params.requestId);
    if (!result) { res.status(404).json({ success: false, error: 'Lineage event not found' }); return; }
    res.json({ success: true, data: result });
  } catch (err: any) { res.status(500).json({ success: false, error: sanitizeErrorForClient(err) }); }
});

router.get('/lineage/org/report', authenticateToken, async (req: Request, res: Response) => {
  try {
    const orgId = (req.query.orgId as string) || userId(req);
    const days = parseInt(req.query.days as string || '30');
    const result = await nvDataLineage.getLineageReport(orgId, days);
    res.json({ success: true, data: result });
  } catch (err: any) { res.status(500).json({ success: false, error: sanitizeErrorForClient(err) }); }
});

router.get('/lineage/org/audit', authenticateToken, async (req: Request, res: Response) => {
  try {
    const orgId = (req.query.orgId as string) || userId(req);
    const result = await nvDataLineage.exportLineageAudit(orgId, req.query.start as string, req.query.end as string);
    res.json({ success: true, data: result });
  } catch (err: any) { res.status(500).json({ success: false, error: sanitizeErrorForClient(err) }); }
});

router.get('/lineage/summary', authenticateToken, async (req: Request, res: Response) => {
  try {
    const orgId = (req.query.orgId as string) || userId(req);
    const result = await nvDataLineage.getLineageReport(orgId, 7);
    res.json({ success: true, data: result });
  } catch (err: any) { res.status(500).json({ success: false, error: sanitizeErrorForClient(err) }); }
});

// ── GAP-026: GRPO Data Feed (Agent Learning Analytics) ────────────────────────
router.get('/grpo/stats', authenticateToken, async (req: Request, res: Response) => {
  try {
    const agentKey = req.query.agentKey as string | undefined;
    const limit = Math.min(parseInt(req.query.limit as string || '10'), 50);
    const [topAgents, feedbackAnalysis] = await Promise.all([
      nvAgentLearning.getTopPerformingAgents(limit),
      agentKey ? nvAgentLearning.analyzeAgentFeedback({ agentKey, lookbackDays: 30 }) : Promise.resolve(null),
    ]);
    res.json({
      success: true,
      data: {
        description: 'GRPO Policy Optimisation Feed — agent performance data for reinforcement learning',
        topAgents,
        feedbackAnalysis: feedbackAnalysis || { message: 'Pass ?agentKey= to get agent-specific analysis' },
        generatedAt: new Date().toISOString(),
      },
    });
  } catch (err: any) { res.status(500).json({ success: false, error: sanitizeErrorForClient(err) }); }
});

router.get('/grpo/suggestions', authenticateToken, async (req: Request, res: Response) => {
  try {
    const agentKey = req.query.agentKey as string;
    if (!agentKey) { res.status(400).json({ success: false, error: 'agentKey is required' }); return; }
    const result = await nvAgentLearning.generateImprovementSuggestions({ agentKey });
    res.json({ success: true, data: result });
  } catch (err: any) { res.status(500).json({ success: false, error: sanitizeErrorForClient(err) }); }
});

// ── GAP-029: Agent Metrics Analytics Dashboard ────────────────────────────────
router.get('/analytics/agent-metrics', authenticateToken, async (req: Request, res: Response) => {
  try {
    const orgId = (req.query.orgId as string) || userId(req);
    const days = parseInt(req.query.days as string || '30');
    const [lineageReport, topAgents, redTeamResults] = await Promise.all([
      nvDataLineage.getLineageReport(orgId, days),
      nvAgentLearning.getTopPerformingAgents(20),
      nvAdversarialTesting.getTestResults(),
    ]);
    res.json({
      success: true,
      data: {
        period: { days, orgId },
        usage: {
          totalRequests: lineageReport.totalRequests,
          avgLatencyMs: lineageReport.avgLatencyMs,
          uniqueUsers: lineageReport.uniqueUsers,
          uniqueAgents: lineageReport.uniqueAgents,
          modelDistribution: lineageReport.modelDistribution,
        },
        agentPerformance: topAgents,
        adversarialTestResults: (redTeamResults || []).slice(0, 10),
        generatedAt: new Date().toISOString(),
      },
    });
  } catch (err: any) { res.status(500).json({ success: false, error: sanitizeErrorForClient(err) }); }
});

// ── GAP-025: Threat Detection Alerting ───────────────────────────────────────
router.post('/security/threat-alert', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { threatType, severity, description, requestId, agentKey } = req.body;
    if (!threatType || !severity) {
      res.status(400).json({ success: false, error: 'threatType and severity are required' });
      return;
    }
    const validSeverities = ['low', 'medium', 'high', 'critical'];
    if (!validSeverities.includes(severity)) {
      res.status(400).json({ success: false, error: `severity must be one of: ${validSeverities.join(', ')}` });
      return;
    }
    const { db: _rawDb } = await import('../db/index.js'); const db = requireDb(_rawDb);
    const { sql } = await import('drizzle-orm');
    const alertId = crypto.randomUUID();
    await db.execute(sql`
      INSERT INTO nv_schema.ai_incidents (id, tenant_id, incident_type, severity, title, description, reported_by, affected_request_ids, status)
      VALUES (${alertId}, ${(req.user as any)?.tenantId || null}, ${threatType}, ${severity},
              ${'[AutoThreat] ' + threatType + ' detected'}, ${description || null},
              ${'system-threat-detector'}, ${JSON.stringify(requestId ? [requestId] : [])}::jsonb, 'open')
    `).catch(() => {});
    logger.warn(`[NV-ThreatAlert] type=${threatType} severity=${severity} agent=${agentKey || 'unknown'} requestId=${requestId || 'n/a'}`);
    res.json({
      success: true,
      data: {
        alertId,
        threatType,
        severity,
        status: 'open',
        message: severity === 'critical' ? 'Critical threat logged — immediate review required' : 'Threat alert logged for review',
        createdAt: new Date().toISOString(),
      },
    });
  } catch (err: any) { res.status(500).json({ success: false, error: sanitizeErrorForClient(err) }); }
});

router.get('/security/threats', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { db: _rawDb } = await import('../db/index.js'); const db = requireDb(_rawDb);
    const { sql } = await import('drizzle-orm');
    const status = (req.query.status as string) || 'open';
    const result = await db.execute(sql`
      SELECT id, incident_type, severity, title, description, status, created_at, resolved_at
      FROM nv_schema.ai_incidents
      WHERE status = ${status}
      ORDER BY CASE severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END, created_at DESC
      LIMIT 100
    `).catch(() => ({ rows: [] }));
    res.json({ success: true, data: result.rows || [], count: (result.rows || []).length });
  } catch (err: any) { res.status(500).json({ success: false, error: sanitizeErrorForClient(err) }); }
});

// ── GAP-024: Zero-Trust API Key Auto-Rotation Check ──────────────────────────
// Lists NV SDK API keys due for rotation (older than 90 days) and can auto-rotate
router.get('/security/api-keys/rotation-status', authenticateToken, async (_req: Request, res: Response) => {
  try {
    const { db: _rawDb } = await import('../db/index.js'); const db = requireDb(_rawDb);
    const { sql } = await import('drizzle-orm');
    const result = await db.execute(sql`
      SELECT id, application_id, key_prefix, name, scopes, is_active, usage_count,
             last_used_at, last_rotated_at, created_at,
             EXTRACT(EPOCH FROM (NOW() - COALESCE(last_rotated_at, created_at))) / 86400 AS days_since_rotation
      FROM sdk_app_api_keys
      WHERE is_active = true
      ORDER BY COALESCE(last_rotated_at, created_at) ASC
    `).catch(() => ({ rows: [] }));
    const rows = (result.rows || []) as any[];
    const dueForRotation = rows.filter((r: any) => parseFloat(r.days_since_rotation) > 90);
    const healthy = rows.filter((r: any) => parseFloat(r.days_since_rotation) <= 90);
    res.json({
      success: true,
      data: {
        total: rows.length,
        dueForRotation: dueForRotation.length,
        healthy: healthy.length,
        rotationThresholdDays: 90,
        keys: rows.map((r: any) => ({
          id: r.id,
          keyPrefix: r.key_prefix,
          name: r.name,
          daysSinceRotation: Math.round(parseFloat(r.days_since_rotation) || 0),
          status: parseFloat(r.days_since_rotation) > 90 ? 'rotation_due' : 'healthy',
          lastRotatedAt: r.last_rotated_at,
          usageCount: r.usage_count,
        }))
      }
    });
  } catch (err: any) { res.status(500).json({ success: false, error: sanitizeErrorForClient(err) }); }
});

// Auto-rotate all SDK API keys older than the specified threshold (default 90 days)
router.post('/security/api-keys/auto-rotate', authenticateToken, requireRole('super_admin'), async (req: Request, res: Response) => {
  try {
    const { db: _rawDb } = await import('../db/index.js'); const db = requireDb(_rawDb);
    const { sql } = await import('drizzle-orm');
    const thresholdDays = parseInt(req.body.thresholdDays as string) || 90;
    const dryRun = req.body.dryRun === true;

    const eligibleResult = await db.execute(sql`
      SELECT id, key_prefix, name, application_id
      FROM sdk_app_api_keys
      WHERE is_active = true
        AND EXTRACT(EPOCH FROM (NOW() - COALESCE(last_rotated_at, created_at))) / 86400 > ${thresholdDays}
      ORDER BY COALESCE(last_rotated_at, created_at) ASC
    `).catch(() => ({ rows: [] }));

    const eligible = (eligibleResult.rows || []) as any[];

    if (dryRun) {
      res.json({ success: true, dryRun: true, wouldRotate: eligible.length, keys: eligible });
    }

    const rotated: any[] = [];
    for (const key of eligible) {
      const newRawKey = `nyv_key_${crypto.randomBytes(24).toString('hex')}`;
      const newKeyHash = crypto.createHash('sha256').update(newRawKey).digest('hex');
      const newKeyPrefix = newRawKey.substring(0, 12);
      await db.execute(sql`
        UPDATE sdk_app_api_keys
        SET key_hash = ${newKeyHash}, key_prefix = ${newKeyPrefix}, last_rotated_at = NOW(), updated_at = NOW()
        WHERE id = ${key.id} AND is_active = true
      `).catch(() => {});
      rotated.push({ id: key.id, name: key.name, oldPrefix: key.key_prefix, newPrefix: newKeyPrefix });
    }

    res.json({ success: true, rotated: rotated.length, details: rotated, message: `Auto-rotated ${rotated.length} API key(s) older than ${thresholdDays} days.` });
  } catch (err: any) { res.status(500).json({ success: false, error: sanitizeErrorForClient(err) }); }
});

// ── GAP-023: PII Vault Encryption Status ─────────────────────────────────────
router.get('/security/pii-vault/status', authenticateToken, async (_req: Request, res: Response) => {
  try {
    const { nvPIIVaultService } = await import('../services/jrx-orchestration-services.js');
    const { db: _rawDb } = await import('../db/index.js'); const db = requireDb(_rawDb);
    const { sql } = await import('drizzle-orm');
    const encOk = nvPIIVaultService.verifyEncryption();
    const stats = await db.execute(sql`
      SELECT COUNT(*) AS total, COUNT(CASE WHEN expires_at > NOW() THEN 1 END) AS active
      FROM nv_schema.pii_vault
    `).catch(() => ({ rows: [{ total: 0, active: 0 }] }));
    const row = (stats.rows || [{ total: 0, active: 0 }])[0] as any;
    res.json({
      success: true,
      data: {
        encryptionAlgorithm: 'AES-256-GCM',
        encryptionVerified: encOk,
        keySource: process.env.NV_PII_ENCRYPTION_KEY ? 'environment_variable' : 'ephemeral_dev_key',
        totalTokens: parseInt(row.total) || 0,
        activeTokens: parseInt(row.active) || 0,
        gapFixed: 'GAP-023 — base64 replaced with AES-256-GCM at rest',
      }
    });
  } catch (err: any) { res.status(500).json({ success: false, error: sanitizeErrorForClient(err) }); }
});

export default router;

