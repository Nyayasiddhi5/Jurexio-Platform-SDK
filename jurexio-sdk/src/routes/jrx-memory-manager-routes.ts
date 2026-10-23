// JRX-NS-021 (2026-05-05): pre-existing TS errors (gateway runs via tsx).
/**
 * Jurexio Memory Manager API Routes — Platform 3.1.2
 * JRX-ROUTE-MEMORY-001
 *
 * Mounted at: /api/jrx/memory
 *
 * POST   /api/jrx/memory/remember          — Store a memory entry
 * POST   /api/jrx/memory/recall            — Retrieve memories (query)
 * DELETE /api/jrx/memory/flush/:userId     — DPDPA: flush all memories for user
 * GET    /api/jrx/memory/stats             — Memory tier statistics + heap pressure
 * GET    /api/jrx/memory/export/:userId    — Export all memories for user
 * POST   /api/jrx/memory/import            — Import memory entries
 * POST   /api/jrx/memory/agent/publish     — Agent publishes memories to session
 * GET    /api/jrx/memory/agent/recall/:sessionId — Agent reads shared session memories
 * GET    /api/jrx/memory/health            — Service health
 */

import { Router } from 'express';
import { z } from 'zod';
import { nvMemoryManager } from '../services/jrx-memory-manager.js';
import { authenticateToken } from '../middleware/jrx-auth.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('./jrx-memory-routes');
const router = Router();

// ────────────────────────────────────────────────────────────────────────────
// Validation Schemas
// ────────────────────────────────────────────────────────────────────────────

const MemoryTierSchema = z.enum(['session', 'longterm', 'social']);
const MemoryTypeSchema = z.enum(['fact', 'preference', 'interaction', 'document', 'agent', 'jurisdiction', 'skill']);

const RememberBodySchema = z.object({
  content:      z.string().min(1).max(50_000),
  type:         MemoryTypeSchema,
  tier:         MemoryTierSchema.optional(),
  sessionId:    z.string().optional(),
  orgId:        z.string().optional(),
  agentId:      z.string().optional(),
  jurisdiction: z.string().optional(),
  tags:         z.array(z.string()).optional(),
  ttlSec:       z.number().int().positive().optional(),
  metadata:     z.record(z.unknown()).optional(),
});

const RecallBodySchema = z.object({
  userId:       z.string().optional(),
  orgId:        z.string().optional(),
  sessionId:    z.string().optional(),
  agentId:      z.string().optional(),
  tiers:        z.array(MemoryTierSchema).optional(),
  types:        z.array(MemoryTypeSchema).optional(),
  tags:         z.array(z.string()).optional(),
  jurisdiction: z.string().optional(),
  query:        z.string().optional(),
  limit:        z.number().int().min(1).max(200).optional(),
  minRelevance: z.number().min(0).max(1).optional(),
});

const AgentPublishBodySchema = z.object({
  agentId:   z.string(),
  sessionId: z.string(),
  entries: z.array(z.object({
    content:      z.string(),
    type:         MemoryTypeSchema,
    userId:       z.string(),
    tier:         MemoryTierSchema.optional(),
    jurisdiction: z.string().optional(),
    tags:         z.array(z.string()).optional(),
    relevanceScore: z.number().optional(),
    accessCount:    z.number().optional(),
    metadata:     z.record(z.unknown()).optional(),
  })),
});

// ────────────────────────────────────────────────────────────────────────────
// Routes
// ────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/jrx/memory/remember
 * Store a memory entry for the authenticated user.
 */
router.post('/remember', authenticateToken, async (req, res, next) => {
  try {
    const user = (req as any).user;
    const body = RememberBodySchema.parse(req.body);

    const entry = await nvMemoryManager.remember({
      userId: user.id ?? user.userId,
      content: body.content ?? '',
      type: body.type ?? 'fact',
      ...body,
    });

    res.status(201).json({
      success: true,
      entry: {
        id:        entry.id,
        tier:      entry.tier,
        type:      entry.type,
        createdAt: entry.createdAt,
        expiresAt: entry.expiresAt,
      },
    });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'VALIDATION_ERROR', details: err.errors });
    }
    next(err);
  }
});

/**
 * POST /api/jrx/memory/recall
 * Query memories across tiers.
 */
router.post('/recall', authenticateToken, async (req, res, next) => {
  try {
    const user = (req as any).user;
    const body = RecallBodySchema.parse(req.body);

    const memories = await nvMemoryManager.recall({
      ...body,
      userId: body.userId ?? user.id ?? user.userId,
    });

    res.json({
      success: true,
      count: memories.length,
      memories,
    });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'VALIDATION_ERROR', details: err.errors });
    }
    next(err);
  }
});

/**
 * DELETE /api/jrx/memory/flush/:userId
 * DPDPA / GDPR right to erasure — flush all memories for a user.
 * Requires admin or the user themselves.
 */
router.delete('/flush/:userId', authenticateToken, async (req, res, next) => {
  try {
    const requester = (req as any).user;
    const { userId } = req.params;

    const isSelf  = (requester.id ?? requester.userId) === userId;
    const isAdmin = ['admin', 'super_admin'].includes(requester.role ?? '');

    if (!isSelf && !isAdmin) {
      res.status(403).json({ error: 'FORBIDDEN', message: 'You can only flush your own memories.' });
    }

    // @ts-expect-error NV-TS230 legacy typing gap (TS2345)
    const result = await nvMemoryManager.flushUser(userId);

    logger.info('[MemoryRoutes] DPDPA flush executed', { userId, by: requester.id, result });

    res.json({
      success: true,
      message: `All memories flushed for user ${userId} (DPDPA compliant)`,
      ...result,
    });
  } catch (err: any) {
    next(err);
  }
});

/**
 * GET /api/jrx/memory/stats
 * Memory tier statistics and heap pressure status.
 */
router.get('/stats', authenticateToken, (_req, res, next) => {
  try {
    const stats = nvMemoryManager.getStats();
    res.json({ success: true, stats });
  } catch (err: any) {
    next(err);
  }
});

/**
 * GET /api/jrx/memory/export/:userId
 * Export all memories for a user (admin only or self).
 */
router.get('/export/:userId', authenticateToken, async (req, res, next) => {
  try {
    const requester = (req as any).user;
    const { userId } = req.params;

    const isSelf  = (requester.id ?? requester.userId) === userId;
    const isAdmin = ['admin', 'super_admin', 'developer'].includes(requester.role ?? '');

    if (!isSelf && !isAdmin) {
      res.status(403).json({ error: 'FORBIDDEN' });
    }

    // @ts-expect-error NV-TS230 legacy typing gap (TS2345)
    const memories = await nvMemoryManager.export(userId);
    res.json({ success: true, count: memories.length, memories });
  } catch (err: any) {
    next(err);
  }
});

/**
 * POST /api/jrx/memory/import
 * Import memory entries (agent snapshot restore). Admin only.
 */
router.post('/import', authenticateToken, async (req, res, next) => {
  try {
    const requester = (req as any).user;
    if (!['admin', 'super_admin', 'developer'].includes(requester.role ?? '')) {
      res.status(403).json({ error: 'FORBIDDEN', message: 'Memory import requires admin role.' });
    }

    const { entries } = req.body;
    if (!Array.isArray(entries)) {
      res.status(400).json({ error: 'VALIDATION_ERROR', message: 'entries must be an array' });
    }

    const count = await nvMemoryManager.import(entries);
    res.json({ success: true, imported: count });
  } catch (err: any) {
    next(err);
  }
});

/**
 * POST /api/jrx/memory/agent/publish
 * An agent publishes memory entries to a shared session memory space.
 */
router.post('/agent/publish', authenticateToken, async (req, res, next) => {
  try {
    const body = AgentPublishBodySchema.parse(req.body);

    const publishEntries = body.entries.map(e => ({
      ...e,
      userId: e.userId ?? body.agentId,
      content: e.content ?? '',
      type: e.type ?? 'fact',
      tier: (e.tier ?? 'session') as 'session' | 'longterm' | 'social',
      orgId: undefined as string | undefined,
      sessionId: undefined as string | undefined,
      agentId: undefined as string | undefined,
      jurisdiction: e.jurisdiction,
      tags: e.tags ?? [],
      relevanceScore: e.relevanceScore ?? 1.0,
      accessCount: e.accessCount ?? 0,
      metadata: e.metadata ?? {},
    }));

    await nvMemoryManager.agentPublish(body.agentId, body.sessionId, publishEntries);

    res.status(201).json({
      success: true,
      published: body.entries.length,
      agentId: body.agentId,
      sessionId: body.sessionId,
    });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'VALIDATION_ERROR', details: err.errors });
    }
    next(err);
  }
});

/**
 * GET /api/jrx/memory/agent/recall/:sessionId
 * Retrieve all agent-published memories for a session.
 */
router.get('/agent/recall/:sessionId', authenticateToken, async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const { agentId } = req.query as { agentId?: string };

    // @ts-expect-error NV-TS230 legacy typing gap (TS2345)
    const memories = await nvMemoryManager.agentRecall(sessionId, agentId);

    res.json({
      success: true,
      sessionId,
      count: memories.length,
      memories,
    });
  } catch (err: any) {
    next(err);
  }
});

/**
 * GET /api/jrx/memory/health
 * Service health for the memory manager.
 */
router.get('/health', (_req, res) => {
  try {
    const stats = nvMemoryManager.getStats();
    const healthy = stats.pressure.status !== 'critical';

    res.status(healthy ? 200 : 503).json({
      status: healthy ? 'healthy' : 'degraded',
      pressure: stats.pressure.status,
      heapPct: stats.pressure.heapPct,
      sessionEntries: stats.session.entries,
      sessionHitRate: stats.session.hitRate,
      longtermEntries: stats.longterm.entries,
      socialEntries: stats.social.entries,
    });
  } catch (err: any) {
    res.status(503).json({ status: 'error', error: (err as Error).message });
  }
});

export default router;
