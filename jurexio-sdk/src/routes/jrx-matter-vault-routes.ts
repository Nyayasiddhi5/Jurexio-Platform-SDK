/**
 * NV-MATTER-VAULT-ROUTES-001 — /api/jrx/matter-vault/*
 * Harvey-style matter review: list/create/batch-upload/playbook (Postgres-backed).
 */
import { Router, type Request, type Response } from 'express';
import { dualSdkOrJwt } from '../middleware/jrx-dual-auth.js';
import {
  createMatterVault,
  getMatterVault,
  listMatterVaults,
  runMatterVaultPlaybook,
  uploadMatterVaultBatch,
  type BatchUploadItem,
} from '../services/jrx-matter-vault-service.js';
import { sendApiError, sendApiSuccess } from '../utils/jrx-api-error.js';

const router = Router();
router.use(dualSdkOrJwt);

function callerOrg(req: Request): string | undefined {
  return (
    (req as any).sdkContext?.organizationId ||
    (req as any).user?.orgId ||
    (req as any).user?.organizationId
  );
}

function callerUser(req: Request): string | undefined {
  return (req as any).sdkContext?.customerUserId || (req as any).user?.id;
}

/** GET /api/jrx/matter-vault — root list alias (NSP often omits /matters). */
router.get('/', async (req: Request, res: Response) => {
  const orgId = callerOrg(req);
  const matters = await listMatterVaults(orgId);
  sendApiSuccess(res, { matters, packs: matters, total: matters.length });
});

/** GET /api/jrx/matter-vault/packs — pack alias for matters (NSP Wave-C). */
router.get('/packs', async (req: Request, res: Response) => {
  const orgId = callerOrg(req);
  const matters = await listMatterVaults(orgId);
  sendApiSuccess(res, { packs: matters, matters, total: matters.length });
});

/** POST /api/jrx/matter-vault/packs */
router.post('/packs', async (req: Request, res: Response) => {
  try {
    const vault = await createMatterVault({
      name: req.body?.name || req.body?.title || 'Matter pack',
      matterRef: req.body?.matterRef || req.body?.packRef,
      description: req.body?.description,
      jurisdiction: req.body?.jurisdiction,
      defaultDepth: req.body?.defaultDepth ?? req.body?.depth,
      orgId: callerOrg(req),
      userId: callerUser(req),
    });
    res.status(201).json({ success: true, data: vault, pack: vault });
  } catch (e) {
    sendApiError(res, 'BAD_REQUEST', { overrideMessage: (e as Error).message });
  }
});

/** GET /api/jrx/matter-vault/packs/:packId */
router.get('/packs/:packId', async (req: Request, res: Response) => {
  const vault = await getMatterVault(String(req.params.packId), callerOrg(req));
  if (!vault) {
    sendApiError(res, 'NOT_FOUND', { overrideMessage: 'Matter pack not found' });
    return;
  }
  sendApiSuccess(res, vault);
});

/** POST /api/jrx/matter-vault/packs/:packId/documents — attach by storageRef or batch */
router.post('/packs/:packId/documents', async (req: Request, res: Response) => {
  const packId = String(req.params.packId);
  const existing = await getMatterVault(packId, callerOrg(req));
  if (!existing) {
    sendApiError(res, 'NOT_FOUND');
    return;
  }
  const documents = (req.body?.documents ?? req.body?.items ?? []) as BatchUploadItem[];
  if (!Array.isArray(documents) || documents.length === 0) {
    // Allow single storageRef attach
    if (req.body?.storageRef || req.body?.fileName) {
      documents.push({
        fileName: String(req.body.fileName || req.body.storageRef || 'document'),
        contentBase64: String(req.body.contentBase64 || ''),
        mimeType: req.body.mimeType,
        ...(req.body.storageRef ? { storageRef: String(req.body.storageRef) } as any : {}),
      });
    }
  }
  if (!documents.length) {
    sendApiError(res, 'BAD_REQUEST', { overrideMessage: 'documents[] or storageRef is required' });
    return;
  }
  try {
    const vault = await uploadMatterVaultBatch(packId, documents, {
      userId: callerUser(req),
      applicationId: (req as any).sdkContext?.applicationId,
      appType: (req as any).sdkContext?.appType,
      orgId: callerOrg(req),
    });
    res.status(202).json({ success: true, data: vault });
  } catch (e) {
    sendApiError(res, 'BAD_REQUEST', { overrideMessage: (e as Error).message });
  }
});

/** GET /api/jrx/matter-vault/matters */
router.get('/matters', async (req: Request, res: Response) => {
  const orgId = callerOrg(req);
  const matters = await listMatterVaults(orgId);
  sendApiSuccess(res, { matters, total: matters.length });
});

/** POST /api/jrx/matter-vault/matters */
router.post('/matters', async (req: Request, res: Response) => {
  try {
    const vault = await createMatterVault({
      name: req.body?.name,
      matterRef: req.body?.matterRef,
      description: req.body?.description,
      jurisdiction: req.body?.jurisdiction,
      defaultDepth: req.body?.defaultDepth ?? req.body?.depth,
      orgId: callerOrg(req),
      userId: callerUser(req),
    });
    res.status(201).json({ success: true, data: vault });
  } catch (e) {
    sendApiError(res, 'BAD_REQUEST', { overrideMessage: (e as Error).message });
  }
});

/** GET /api/jrx/matter-vault/matters/:vaultId */
router.get('/matters/:vaultId', async (req: Request, res: Response) => {
  const vault = await getMatterVault(String(req.params.vaultId), callerOrg(req));
  if (!vault) {
    sendApiError(res, 'NOT_FOUND', { overrideMessage: 'Matter vault not found' });
    return;
  }
  sendApiSuccess(res, vault);
});

/** POST /api/jrx/matter-vault/matters/:vaultId/upload-batch */
router.post('/matters/:vaultId/upload-batch', async (req: Request, res: Response) => {
  const vaultId = String(req.params.vaultId);
  const existing = await getMatterVault(vaultId, callerOrg(req));
  if (!existing) {
    sendApiError(res, 'NOT_FOUND');
    return;
  }

  const documents = (req.body?.documents ?? req.body?.items ?? []) as BatchUploadItem[];
  if (!Array.isArray(documents) || documents.length === 0) {
    sendApiError(res, 'BAD_REQUEST', { overrideMessage: 'documents[] is required' });
    return;
  }

  try {
    const vault = await uploadMatterVaultBatch(vaultId, documents, {
      userId: callerUser(req),
      applicationId: (req as any).sdkContext?.applicationId,
      appType: (req as any).sdkContext?.appType,
      orgId: callerOrg(req),
    });
    res.status(202).json({ success: true, data: vault });
  } catch (e) {
    sendApiError(res, 'BAD_REQUEST', { overrideMessage: (e as Error).message });
  }
});

/** POST /api/jrx/matter-vault/matters/:vaultId/run-playbook */
router.post('/matters/:vaultId/run-playbook', async (req: Request, res: Response) => {
  const vaultId = String(req.params.vaultId);
  const orgId = callerOrg(req);
  const existing = await getMatterVault(vaultId, orgId);
  if (!existing) {
    sendApiError(res, 'NOT_FOUND');
    return;
  }

  try {
    const vault = await runMatterVaultPlaybook(
      vaultId,
      {
        playbookId: req.body?.playbookId,
        documentText: req.body?.documentText,
        tenantId: orgId,
        probeRag: req.body?.probeRag,
        ragQuery: req.body?.ragQuery,
        depth: req.body?.depth,
      },
      orgId,
    );
    sendApiSuccess(res, vault);
  } catch (e) {
    sendApiError(res, 'BAD_REQUEST', { overrideMessage: (e as Error).message });
  }
});

/** GET /api/jrx/matter-vault/health */
router.get('/health', (_req: Request, res: Response) => {
  sendApiSuccess(res, {
    service: 'matter-vault',
    status: 'operational',
    persistence: 'nv_schema.nv_matter_vaults',
    capabilities: ['list', 'create', 'upload-batch', 'run-playbook', 'depth-tiers'],
    integrations: ['edj', 'tenant-rag', 'contract-playbooks'],
  });
});

export default router;
