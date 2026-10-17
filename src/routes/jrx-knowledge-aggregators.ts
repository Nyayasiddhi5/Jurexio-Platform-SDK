/**
 * Knowledge Aggregator Routes (Task #178 / B2 + task-303 G3A)
 *   GET /api/jrx/prompts          — paged prompt-library entries (curated seed + DB merge)
 *   GET /api/jrx/prompts/categories — distinct categories with counts
 *   GET /api/jrx/prompts/:id      — single prompt body
 *   GET /api/jrx/rag/collections  — list RAG collections with doc-count + last-indexed
 */
import { Router, Request, Response } from 'express';
import { sql } from 'drizzle-orm';
import { dualSdkOrJwt } from '../middleware/jrx-dual-auth.js';
import { authenticateToken, requireRole } from '../middleware/jrx-auth.js';
import { backfillStatutesToRag } from '../services/jrx-statute-rag-backfill-service.js';
import { db as _raw_db } from '../db/index.js';
import { lazyRequire } from '../utils/jrx-type-helpers.js';
const db = lazyRequire(() => _raw_db, 'db');
import { createLogger } from '../utils/logger.js';
import {
  NV_PROMPT_LIBRARY,
  NV_PROMPT_CATEGORIES,
  NV_PROMPT_JURISDICTIONS,
  listPrompts,
  getPromptById,
} from '../data/jrx-prompt-library.js';

const logger = createLogger('./jrx-knowledge-aggregators');

// ── /api/jrx/prompts ────────────────────────────────────────────────────────
const promptsRouter = Router();
promptsRouter.use(dualSdkOrJwt);

promptsRouter.get('/categories', (_req: Request, res: Response): void => {
  const counts: Record<string, number> = {};
  for (const p of NV_PROMPT_LIBRARY) counts[p.category] = (counts[p.category] ?? 0) + 1;
  res.json({
    success: true,
    categories: NV_PROMPT_CATEGORIES.map(c => ({ name: c, count: counts[c] ?? 0 })),
    jurisdictions: NV_PROMPT_JURISDICTIONS,
    total: NV_PROMPT_LIBRARY.length,
  });
});

promptsRouter.get('/', async (req: Request, res: Response): Promise<void> => {
  const limit  = Math.min(2000, Math.max(1, parseInt(String(req.query.limit ?? '200'), 10)));
  const offset = Math.max(0, parseInt(String(req.query.offset ?? '0'), 10));
  const category     = req.query.category ? String(req.query.category) : undefined;
  const jurisdiction = req.query.jurisdiction ? String(req.query.jurisdiction) : undefined;
  const agent        = req.query.agent ? String(req.query.agent) : undefined;
  const q            = req.query.q ? String(req.query.q) : undefined;

  // Pull the full filtered seed set (no slicing yet) so we can merge with
  // DB rows and apply unified offset/limit + accurate paging.total.
  const seedAll = listPrompts({ category, jurisdiction, agent, q, limit: 2000, offset: 0 });

  // Build DB query honouring all filters (jurisdiction, q, category) and
  // applying our own offset/limit at the merge layer below. `agent` is not
  // a column in template_library, so DB rows are excluded when a specific
  // agent is requested (curated seed is the source of truth for agent tags).
  let dbRows: any[] = [];
  if (!agent) {
    try {
      const conditions = [sql`1=1`];
      if (category) conditions.push(sql`category = ${category}`);
      if (jurisdiction) conditions.push(sql`jurisdiction = ${jurisdiction}`);
      if (q && q.length > 0) {
        const like = `%${q.toLowerCase()}%`;
        conditions.push(sql`(LOWER(name) LIKE ${like} OR LOWER(template_body) LIKE ${like})`);
      }
      const whereSql = conditions.reduce((acc, c, i) => i === 0 ? c : sql`${acc} AND ${c}`);
      const rows = await db.execute(sql`
        SELECT id, name, slug, category, jurisdiction, language, version, tags,
               template_body, is_public, usage_count, created_at, updated_at
        FROM template_library
        WHERE ${whereSql}
        ORDER BY updated_at DESC NULLS LAST, name ASC
        LIMIT 2000
      `);
      dbRows = ((rows as any).rows ?? rows ?? []) as any[];
    } catch (err: any) {
      logger.warn('prompts_db_query_failed_using_seed_only', { err: err?.message });
    }
  }

  const seenSlugs = new Set(seedAll.rows.map(r => r.slug));
  const extra = dbRows.filter(r => r.slug && !seenSlugs.has(r.slug)).map(r => ({
    id: String(r.id),
    slug: r.slug,
    name: r.name,
    category: r.category ?? 'Other',
    jurisdiction: r.jurisdiction ?? 'IN',
    language: r.language ?? 'en',
    version: r.version ?? '1.0.0',
    is_public: !!r.is_public,
    usage_count: Number(r.usage_count ?? 0),
    template_body: r.template_body ?? '',
    tags: Array.isArray(r.tags) ? r.tags : (typeof r.tags === 'string' ? safeJson(r.tags) : []),
    agents: [],
    source: 'db' as const,
  }));

  const all = [...seedAll.rows.map(r => ({ ...r, source: 'seed' as const })), ...extra];
  const total = all.length;
  const page = all.slice(offset, offset + limit);

  res.json({
    success: true,
    prompts: page,
    paging: { limit, offset, returned: page.length, total },
    filter: { category, jurisdiction, agent, q },
    generatedAt: new Date().toISOString(),
  });
});

promptsRouter.get('/:id', (req: Request, res: Response): void => {
  const p = getPromptById(String(req.params.id));
  if (!p) { res.status(404).json({ success: false, error: 'prompt_not_found' }); return; }
  res.json({ success: true, prompt: p });
});

function safeJson(s: string): unknown[] {
  try { const v = JSON.parse(s); return Array.isArray(v) ? v : []; } catch { return []; }
}

// ── /api/jrx/rag/collections ───────────────────────────────────────────────
const ragCollectionsRouter = Router();
ragCollectionsRouter.use(dualSdkOrJwt);

ragCollectionsRouter.get('/', async (req: Request, res: Response): Promise<void> => {
  const user = (req as any).user ?? {};
  const orgId = String(user.orgId ?? user.organizationId ?? '');
  const role  = String(user.role ?? '');
  const isSuperAdmin = role === 'super_admin';

  const overrideOrgId = isSuperAdmin && req.query.org_id ? String(req.query.org_id) : null;
  const effectiveOrgId = overrideOrgId ?? orgId;

  if (!effectiveOrgId) {
    res.status(400).json({
      success: false,
      error: 'org_context_required',
      message: 'This endpoint is org-scoped. Authenticated user has no organization; super_admin may pass ?org_id=.',
    });
    return;
  }

  try {
    const rows = await db.execute(sql`
      SELECT id, name, description, embedding_model, dimensions,
             document_count, vector_count, total_tokens,
             is_default, is_active, metadata, updated_at, created_at
      FROM rag_namespaces
      WHERE org_id = ${effectiveOrgId}
      ORDER BY updated_at DESC NULLS LAST, name ASC
    `);
    const data = (rows as any).rows ?? rows ?? [];

    const collections = data.map((r: any) => {
      const md = typeof r.metadata === 'string'
        ? (() => { try { return JSON.parse(r.metadata || '{}'); } catch { return {}; } })()
        : (r.metadata ?? {});
      const docCount = Number(r.document_count ?? 0);
      return {
        id: r.id,
        name: r.name,
        description: r.description,
        embedding_model: r.embedding_model,
        dimensions: r.dimensions,
        doc_count: docCount,
        document_count: docCount,
        vector_count: Number(r.vector_count ?? 0),
        total_tokens: Number(r.total_tokens ?? 0),
        is_default: !!r.is_default,
        is_active: !!r.is_active,
        metadata: md,
        last_indexed: r.updated_at,
        created_at: r.created_at,
      };
    });

    res.json({
      success: true,
      collections,
      total: collections.length,
      generatedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    logger.warn('rag_collections_failed', { err: err?.message });
    res.json({ success: true, collections: [], total: 0 });
  }
});

ragCollectionsRouter.post('/backfill-statutes', authenticateToken, requireRole('super_admin', 'admin'), async (req: Request, res: Response): Promise<void> => {
  try {
    const jurisdiction = req.body?.jurisdiction ? String(req.body.jurisdiction).toUpperCase() : undefined;
    const limit = Math.min(5000, Number(req.body?.limit ?? 5000));
    const dryRun = req.body?.dryRun === true;
    const result = await backfillStatutesToRag({ jurisdiction, limit, skipExisting: true, dryRun });
    res.json({ success: true, data: result });
  } catch (err: any) {
    logger.error('rag_backfill_statutes_failed', { err: err?.message });
    res.status(500).json({ success: false, error: err?.message || 'backfill failed' });
  }
});

/** NV-AUTO-RAG-001 — diagnostic retrieve (tier-aware unified router). Partner SDK + JWT. */
ragCollectionsRouter.post('/auto/retrieve', dualSdkOrJwt, async (req: Request, res: Response): Promise<void> => {
  try {
    const { autoRagRetrieve } = await import('../services/jrx-auto-rag-router.js');
    const body = req.body ?? {};
    const result = await autoRagRetrieve({
      query: String(body.query || ''),
      jurisdiction: body.jurisdiction ? String(body.jurisdiction).toUpperCase() : 'IN',
      tier: body.tier ? String(body.tier) : 'pro',
      taskType: body.taskType ? String(body.taskType) : undefined,
      topK: Math.min(15, Number(body.topK ?? 8)),
    });
    res.json({
      success: true,
      data: {
        intent: result.intent,
        capabilityTier: result.capabilityTier,
        layersUsed: result.layersUsed,
        retrievalMethods: result.retrievalMethods,
        chunkCount: result.chunks.length,
        confidence: result.confidence,
        latencyMs: result.latencyMs,
        chunks: result.chunks.slice(0, 5),
      },
    });
  } catch (err: any) {
    logger.error('auto_rag_retrieve_failed', { err: err?.message });
    res.status(500).json({ success: false, error: err?.message || 'auto-rag retrieve failed' });
  }
});

export { promptsRouter, ragCollectionsRouter };
