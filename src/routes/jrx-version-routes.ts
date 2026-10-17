// JRX-NS-021 (2026-05-05): pre-existing TS errors (gateway runs via tsx).
/**
 * JRX Version Management Routes
 * /api/jrx/versions/*
 * ─────────────────────────────────────────────────────────────────────────────
 * REST API for module versioning, changelog, and deployment history.
 *
 * @module jrx-version-routes
 */

import { Router, Request, Response } from 'express';
import { versionManager, ModuleId } from '../services/jrx-deployment-version-manager.js';
import { authenticateToken, requireRole } from '../middleware/jrx-auth.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('./jrx-version-routes');
const router = Router();

// NV-RBAC-GAP-001: version bump / rollback / deployment-record are deploy-control
// writes (they shape what the deployment-status surface reports). Gate them with
// auth + super_admin; GET version/changelog/history reads stay open.
const adminOnly = [authenticateToken, requireRole('super_admin')];

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/jrx/versions
// Platform version and all module versions
// ─────────────────────────────────────────────────────────────────────────────
router.get('/', (_req: Request, res: Response) => {
  res.json({ success: true, data: versionManager.getPlatformVersion() });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/jrx/versions/changelog
// Full platform changelog (all modules)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/changelog', (_req: Request, res: Response) => {
  const markdown = versionManager.generateChangelog();
  res.setHeader('Content-Type', 'text/markdown');
  res.send(markdown);
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/jrx/versions/modules
// All module versions
// ─────────────────────────────────────────────────────────────────────────────
router.get('/modules', (_req: Request, res: Response) => {
  const modules = versionManager.getAllModules();
  res.json({
    success: true,
    data: {
      modules,
      total: modules.length,
      stable: modules.filter(m => m.status === 'stable').length,
      canRollback: modules.filter(m => m.canRollback).length,
    },
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/jrx/versions/modules/:moduleId
// Single module version + changelog
// ─────────────────────────────────────────────────────────────────────────────
router.get('/modules/:moduleId', (req: Request, res: Response) => {
  const module = versionManager.getModule(req.params.moduleId as ModuleId);
  if (!module) {
    res.status(404).json({ success: false, error: `Module not found: ${req.params.moduleId}` });
  }
  res.json({ success: true, data: module });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/jrx/versions/modules/:moduleId/changelog
// Module-specific changelog in markdown
// ─────────────────────────────────────────────────────────────────────────────
router.get('/modules/:moduleId/changelog', (req: Request, res: Response) => {
  const module = versionManager.getModule(req.params.moduleId as ModuleId);
  if (!module) {
    res.status(404).json({ success: false, error: `Module not found: ${req.params.moduleId}` });
  }
  const markdown = versionManager.generateChangelog(req.params.moduleId as ModuleId);
  res.setHeader('Content-Type', 'text/markdown');
  res.send(markdown);
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/jrx/versions/modules/:moduleId/bump
// Bump module version (admin only)
// Body: { type: 'major'|'minor'|'patch', description: '...' }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/modules/:moduleId/bump', adminOnly, (req: Request, res: Response) => {
  const { type, description } = req.body;
  if (!type || !['major', 'minor', 'patch'].includes(type)) {
    res.status(400).json({ success: false, error: 'type must be major|minor|patch' });
  }
  if (!description) {
    res.status(400).json({ success: false, error: 'description is required' });
  }
  try {
    const module = versionManager.bump(req.params.moduleId as ModuleId, type, description);
    res.json({ success: true, data: module });
  } catch (err: any) {
    res.status(404).json({ success: false, error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/jrx/versions/modules/:moduleId/rollback
// Rollback a module to previous version (admin only)
// Body: { reason: '...', initiatedBy: '...' }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/modules/:moduleId/rollback', adminOnly, (req: Request, res: Response) => {
  const { reason, initiatedBy } = req.body;
  if (!reason) { res.status(400).json({ success: false, error: 'reason is required' }); return; }
  try {
    versionManager.rollback(
      req.params.moduleId as ModuleId,
      reason,
      initiatedBy ?? req.user?.email ?? 'api',
    );
    logger.warn(`[VersionRoutes] Rollback triggered: ${req.params.moduleId} — ${reason}`);
    res.json({
      success: true,
      data: {
        module: req.params.moduleId,
        rolled_back: true,
        current: versionManager.getModule(req.params.moduleId as ModuleId),
      },
    });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/jrx/versions/deployments
// Deployment history
// ─────────────────────────────────────────────────────────────────────────────
router.get('/deployments', (req: Request, res: Response) => {
  const { moduleId } = req.query;
  const history = versionManager.getDeploymentHistory(moduleId as ModuleId | undefined);
  res.json({ success: true, data: history });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/jrx/versions/deployments
// Record a new deployment
// ─────────────────────────────────────────────────────────────────────────────
router.post('/deployments', adminOnly, (req: Request, res: Response) => {
  const { moduleId, fromVersion, toVersion, strategy, env, deployedBy } = req.body;
  if (!moduleId || !toVersion) {
    res.status(400).json({ success: false, error: 'moduleId and toVersion are required' });
  }
  try {
    const record = versionManager.recordDeployment({
      env: env ?? 'staging',
      moduleId,
      fromVersion: fromVersion ?? 'unknown',
      toVersion,
      strategy: strategy ?? 'rolling',
      deployedBy: deployedBy ?? req.user?.email ?? 'api',
    });
    res.status(201).json({ success: true, data: record });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

export { router as versionRoutes };
