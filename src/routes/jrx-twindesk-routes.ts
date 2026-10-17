// JRX-NS-021 (2026-05-05): pre-existing strict-null cluster (gateway runs via tsx).
/**
 * TwinDesk™ REST Routes — /api/jrx/twindesk/*
 * Customer Digital Twin Product | Jurexio Enterprise Platform 312
 *
 * ENDPOINTS:
 *   POST   /twins                            Create digital twin
 *   GET    /twins                            List twins for org
 *   GET    /twins/:twinId                    Get twin
 *   PATCH  /twins/:twinId                    Update twin
 *   DELETE /twins/:twinId                    Delete twin
 *
 *   POST   /twins/:twinId/simulate           Run scenario simulation
 *   GET    /twins/:twinId/simulations        Get simulation history
 *
 *   POST   /twins/:twinId/chat               Chat with twin
 *
 *   POST   /twins/:twinId/benchmark          Run benchmark
 *   GET    /personas                         List available personas
 *   GET    /stats                            Service stats
 */

import { Router, Request, Response } from 'express';
import { z, ZodError } from 'zod';
import { authenticateToken } from '../middleware/auth.js';
import { twinDeskService } from '../services/twindesk/twindesk-service.js';
import { sanitizeErrorForClient } from '../utils/error-sanitizer.js';

const router = Router();
router.use(authenticateToken as any);

// task-224: caller's org scope. Falls back to a per-user pseudo-org so two
// users without an organizationId on their token are still isolated from each
// other (was previously hard-coded to '1', leaking every tenant's twins).
function getOrgId(req: Request): string {
  const user: any = req.user;
  const org = user?.organizationId ?? user?.orgId ?? user?.org_id;
  if (org !== undefined && org !== null && String(org).length > 0) return String(org);
  return `__user_${user?.id ?? 'anon'}__`;
}

// task-224: ownership guard. Returns the twin only if the caller owns it.
function loadOwnedTwin(req: Request, res: Response, mode: 'read' | 'write'): any | null {
  // @ts-expect-error NV-TS230 legacy typing gap (TS2345)
  const twin = twinDeskService.getTwin(req.params.twinId);
  if (!twin) {
    res.status(404).json({ success: false, error: 'Twin not found' });
    return null;
  }
  if (String(twin.orgId) !== getOrgId(req)) {
    if (mode === 'write') {
      res.status(403).json({ success: false, error: 'Forbidden: twin belongs to another organization' });
    } else {
      res.status(404).json({ success: false, error: 'Twin not found' });
    }
    return null;
  }
  return twin;
}

const PERSONAS = ['managing-partner', 'senior-litigator', 'compliance-head', 'corporate-counsel', 'custom'] as const;

// ── TWIN CRUD ─────────────────────────────────────────────────────────────────
router.post('/twins', async (req: Request, res: Response) => {
  try {
    const schema = z.object({
      name: z.string().min(2).max(100),
      persona: z.enum(PERSONAS),
      expertise: z.string().min(2).max(200),
      jurisdiction: z.string().optional().default('IN'),
      yearsExperience: z.number().int().min(1).max(50).optional(),
      riskTolerance: z.enum(['conservative', 'moderate', 'aggressive']).optional(),
      customPersonaPrompt: z.string().optional(),
      configuration: z.record(z.unknown()).optional(),
    });
    const input = schema.parse(req.body);
    const twin = twinDeskService.createTwin({ ...input, orgId: getOrgId(req) });
    res.status(201).json({ success: true, twin });
  } catch (err: any) {
    if (err instanceof ZodError) { res.status(400).json({ error: err.errors }); return; }
    res.status(500).json({ error: sanitizeErrorForClient(err) });
  }
});

router.get('/twins', (req: Request, res: Response) => {
  const twins = twinDeskService.listTwins(getOrgId(req));
  res.json({ success: true, twins, total: twins.length });
});

router.get('/twins/:twinId', (req: Request, res: Response) => {
  const twin = loadOwnedTwin(req, res, 'read');
  if (!twin) return;
  res.json({ success: true, twin });
});

router.patch('/twins/:twinId', async (req: Request, res: Response) => {
  try {
    if (!loadOwnedTwin(req, res, 'write')) return;
    // @ts-expect-error NV-TS230 legacy typing gap (TS2345)
    const twin = twinDeskService.updateTwin(req.params.twinId, req.body);
    if (!twin) { res.status(404).json({ success: false, error: 'Twin not found' }); return; }
    res.json({ success: true, twin });
  } catch (err: any) {
    res.status(500).json({ error: sanitizeErrorForClient(err) });
  }
});

router.delete('/twins/:twinId', (req: Request, res: Response) => {
  if (!loadOwnedTwin(req, res, 'write')) return;
  // @ts-expect-error NV-TS230 legacy typing gap (TS2345)
  const deleted = twinDeskService.deleteTwin(req.params.twinId);
  if (!deleted) { res.status(404).json({ success: false, error: 'Twin not found' }); return; }
  res.json({ success: true, message: 'Twin deleted' });
});

// ── SIMULATION ────────────────────────────────────────────────────────────────
router.post('/twins/:twinId/simulate', async (req: Request, res: Response) => {
  try {
    if (!loadOwnedTwin(req, res, 'write')) return;
    const schema = z.object({
      scenario: z.string().min(5).max(200),
      task: z.string().min(10).max(2000),
      context: z.record(z.unknown()).optional(),
      numOutcomes: z.number().int().min(2).max(5).optional(),
    });
    const input = schema.parse(req.body);
    // @ts-expect-error NV-TS230 legacy typing gap (TS2322)
    const simulation = twinDeskService.simulate({ twinId: req.params.twinId, ...input });
    res.json({ success: true, simulation });
  } catch (err: any) {
    if (err instanceof ZodError) { res.status(400).json({ error: err.errors }); return; }
    if ((err as Error).message?.includes('not found')) { res.status(404).json({ error: (err as Error).message }); return; }
    res.status(500).json({ error: sanitizeErrorForClient(err) });
  }
});

router.get('/twins/:twinId/simulations', (req: Request, res: Response) => {
  if (!loadOwnedTwin(req, res, 'read')) return;
  const limit = parseInt(String(req.query.limit ?? '20'), 10);
  // @ts-expect-error NV-TS230 legacy typing gap (TS2345)
  const simulations = twinDeskService.getSimulations(req.params.twinId, limit);
  res.json({ success: true, simulations, total: simulations.length });
});

// ── CHAT ─────────────────────────────────────────────────────────────────────
router.post('/twins/:twinId/chat', async (req: Request, res: Response) => {
  try {
    if (!loadOwnedTwin(req, res, 'write')) return;
    const schema = z.object({
      message: z.string().min(1).max(5000),
      sessionId: z.string().optional(),
      context: z.record(z.unknown()).optional(),
    });
    const input = schema.parse(req.body);
    // @ts-expect-error NV-TS230 legacy typing gap (TS2322)
    const response = twinDeskService.chat({ twinId: req.params.twinId, ...input });
    res.json({ success: true, ...response });
  } catch (err: any) {
    if (err instanceof ZodError) { res.status(400).json({ error: err.errors }); return; }
    if ((err as Error).message?.includes('not found')) { res.status(404).json({ error: (err as Error).message }); return; }
    res.status(500).json({ error: sanitizeErrorForClient(err) });
  }
});

// ── BENCHMARK ─────────────────────────────────────────────────────────────────
// @ts-expect-error NV-TS230 legacy typing gap (TS7030)
router.post('/twins/:twinId/benchmark', (req: Request, res: Response) => {
  try {
    if (!loadOwnedTwin(req, res, 'write')) return;
    // @ts-expect-error NV-TS230 legacy typing gap (TS2345)
    const result = twinDeskService.benchmark(req.params.twinId);
    res.json({ success: true, ...result });
  } catch (err: any) {
    if ((err as Error).message?.includes('not found')) return res.status(404).json({ error: (err as Error).message });
    res.status(500).json({ error: sanitizeErrorForClient(err) });
  }
});

// ── PERSONAS + STATS ──────────────────────────────────────────────────────────
router.get('/personas', (_req: Request, res: Response) => {
  res.json({
    success: true,
    personas: [
      { id: 'managing-partner', label: 'Managing Partner', description: 'Risk-conscious, settlement-first, commercial focus', suitedFor: ['M&A', 'Cross-border disputes', 'Board advisory'] },
      { id: 'senior-litigator', label: 'Senior Litigator', description: 'Aggressive, discovery-first, litigation as leverage', suitedFor: ['Commercial litigation', 'Writ petitions', 'Appellate'] },
      { id: 'compliance-head', label: 'Chief Compliance Officer', description: 'Prevention-first, regulatory engagement, documentation-heavy', suitedFor: ['SEBI', 'RBI', 'DPDPA', 'Internal investigations'] },
      { id: 'corporate-counsel', label: 'Corporate Counsel', description: 'Commercially pragmatic, speed over perfection, deal-focused', suitedFor: ['Corporate governance', 'M&A DD', 'Contract negotiation'] },
      { id: 'custom', label: 'Custom Persona', description: 'Fully configurable persona with custom prompt', suitedFor: ['Any domain'] },
    ],
  });
});

router.get('/stats', (_req: Request, res: Response) => {
  res.json({ success: true, ...twinDeskService.getServiceStats() });
});

export default router;
