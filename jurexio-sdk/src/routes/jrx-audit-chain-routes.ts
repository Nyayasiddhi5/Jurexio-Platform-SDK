/**
 * Audit Chain Routes — Demo G1A (task-297, 2026-05-13).
 * v3 (2026-06-16): unified read via jrx-audit-chain-read.ts.
 */
import { Router, Request, Response } from 'express';
import { authenticateToken, requireRole } from '../middleware/jrx-auth.js';
import { createLogger } from '../utils/logger.js';
import {
  fetchAuditChainRecordById,
  fetchAuditChainRecords,
  verifyHashChainRecord,
  resolveAuditReadScope,
} from '../services/jrx-audit-chain-read.js';

const logger = createLogger('./jrx-audit-chain-routes');
const router = Router();

// NV-AUDIT-TENANT-SCOPE-001: cross-org audit reads are super_admin ONLY.
// Tenant-scope resolution is delegated to resolveAuditReadScope() in
// jrx-audit-chain-read.ts (single source of truth) so the list and detail
// endpoints can never diverge.
const ALLOWED_JUR = new Set(['US', 'IN', 'EU', 'UK', 'GC', 'SG']);

router.get('/chain', authenticateToken, async (req: Request, res: Response) => {
  const limit = Math.min(Math.max(Number(req.query.limit ?? 100) || 100, 1), 500);
  const offset = Math.max(Number(req.query.offset ?? 0) || 0, 0);
  const rawJur = (req.query.jurisdiction as string | undefined)?.trim()?.toUpperCase();
  const jurisdiction = rawJur && rawJur !== 'ALL' && ALLOWED_JUR.has(rawJur) ? rawJur : null;

  const scope = resolveAuditReadScope((req as any).user, (req.query.orgId as string | undefined) ?? null);
  if (scope.ok === false) {
    res.status(scope.status).json({ success: false, error: scope.error });
    return;
  }

  try {
    const { records, total } = await fetchAuditChainRecords({
      limit,
      offset,
      effectiveOrg: scope.effectiveOrg,
      jurisdiction,
    });

    res.json({
      success: true,
      data: {
        records,
        total,
        limit,
        offset,
        scope: { orgId: scope.effectiveOrg, allOrgs: scope.effectiveOrg === null, jurisdiction },
        provider: 'unified-audit-read',
      },
    });
  } catch (err: any) {
    logger.error('audit_chain_failed', { err: String(err) });
    res.status(500).json({ success: false, error: 'Failed to read audit chain.' });
  }
});

router.get('/chain/verify', authenticateToken, requireRole('analyst', 'manager', 'org_admin', 'admin', 'super_admin'), async (_req: Request, res: Response) => {
  try {
    const { runHashChainVerification } = await import('../services/hash-chain-verifier.js') as any;
    const result = await runHashChainVerification();
    res.json({ success: true, data: result });
  } catch (err: any) {
    logger.error('audit_chain_verify_failed', { err: String(err) });
    res.status(500).json({ success: false, error: 'Verification failed.' });
  }
});

router.get('/chain/:id', authenticateToken, async (req: Request, res: Response) => {
  const id = String(req.params.id || '').trim();
  if (!id) { res.status(400).json({ success: false, error: 'id required' }); return; }

  try {
    const record = await fetchAuditChainRecordById(id);
    if (!record) { res.status(404).json({ success: false, error: 'not found' }); return; }

    // NV-AUDIT-TENANT-SCOPE-001: resolve the caller's permitted scope. A
    // non-super-admin is hard-scoped to its own org; if the row belongs to a
    // different org the read is denied (cross-tenant leak prevention).
    const detailScope = resolveAuditReadScope((req as any).user, null);
    if (detailScope.ok === false) {
      res.status(detailScope.status).json({ success: false, error: detailScope.error });
      return;
    }
    if (detailScope.effectiveOrg !== null && record.orgId && record.orgId !== detailScope.effectiveOrg) {
      res.status(403).json({ success: false, error: 'cross-tenant read denied' });
      return;
    }

    let verified = false;
    let expectedHash = '';
    if (record.source === 'hash_chain' && record.recordHash) {
      const v = verifyHashChainRecord({
        id: String(record.id),
        previousHash: record.previousHash,
        recordHash: record.recordHash,
        eventType: record.eventType,
        payload: record.metadata,
        createdAt: record.createdAt,
      });
      verified = v.verified;
      expectedHash = v.expectedHash;
    }

    res.json({
      success: true,
      data: { record, verified, expectedHash: expectedHash || undefined },
    });
  } catch (err: any) {
    logger.error('audit_chain_detail_failed', { err: String(err) });
    res.status(500).json({ success: false, error: 'Failed to read audit row.' });
  }
});

export { router as auditChainRoutes };
export default router;
