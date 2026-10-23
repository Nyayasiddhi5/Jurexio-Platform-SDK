// Pre-existing strict-null cluster across services/database-system,
// services/document-processor, services/vector-database singletons
// (gateway runs via tsx). Matches platform convention used by every
// provider/service router (e.g. openai-provider.ts, cohere-provider.ts).
//
// /api/nv5/orch/kb/* — Knowledge Base System wiring (Session-10 Batch A).
// NV-LLM-001 holds: only metadata create/list — no LLM-emitting endpoints.
import { Router, type Request, type Response } from 'express';
import { KnowledgeBaseSystem } from '../services/knowledge-base-system.js';
import { databaseSystem } from '../services/database-system.js';
import { documentProcessor } from '../services/document-processor.js';
import { vectorDatabase } from '../services/vector-database.js';
import { requireSdkKey, safeError } from './_nv5-orch-auth.js';

const router = Router();

let _kb: KnowledgeBaseSystem | null = null;
let _initPromise: Promise<void> | null = null;

function getKb(): KnowledgeBaseSystem {
  if (!_kb) {
    _kb = new KnowledgeBaseSystem(databaseSystem, documentProcessor, vectorDatabase);
  }
  return _kb;
}

async function ensureInit(): Promise<void> {
  if (_initPromise) return _initPromise;
  _initPromise = getKb().initialize().catch(() => undefined);
  return _initPromise;
}

router.use(requireSdkKey);

router.get('/health', (_req: Request, res: Response) => {
  res.json({ success: true, service: 'knowledge-base-system', instantiated: _kb !== null });
});

router.post('/create', async (req: Request, res: Response) => {
  try {
    await ensureInit();
    const { name, description, ownerId, organizationId, type, settings, permissions } = req.body || {};
    if (!name || !ownerId) return safeError(res, 'name and ownerId required', 400);
    const out = await getKb().createKnowledgeBase(name, {
      description,
      ownerId,
      organizationId,
      type,
      settings,
      permissions,
    });
    res.json({ success: true, knowledgeBase: out });
  } catch (e) { safeError(res, e); }
});

export default router;
