/**
 * NV-DOMAIN-PACK-001 — list / resolve multi-domain vertical packs.
 */
import { Router, type Request, type Response } from 'express';
import {
  getDomainPack,
  listDomainPacks,
  resolveActiveDomainPack,
  resolveDomainRagFixture,
} from '../config/jrx-domain-packs.js';

const router = Router();

router.get('/', (_req: Request, res: Response) => {
  const packs = listDomainPacks();
  const active = resolveActiveDomainPack();
  res.json({
    success: true,
    data: {
      activeDomain: active.id,
      packs: packs.map((p) => ({
        ...p,
        ragFixtureConfigured: Boolean(p.ragFixtureRelPath),
        ragFixturePresent: !!resolveDomainRagFixture(p),
      })),
      note: 'Set NYV_DOMAIN_PACK=legal|general|finance|healthcare to select vertical defaults. Legal is GA; others are scaffolds. RAG fixtures ship in-repo for CI soak (may be absent from gateway image cwd).',
    },
  });
});

router.get('/:id', (req: Request, res: Response) => {
  const pack = getDomainPack(String(req.params.id || ''));
  if (!pack) {
    res.status(404).json({ success: false, error: 'domain_pack_not_found' });
    return;
  }
  res.json({
    success: true,
    data: {
      ...pack,
      ragFixtureConfigured: Boolean(pack.ragFixtureRelPath),
      ragFixturePresent: !!resolveDomainRagFixture(pack),
      active: resolveActiveDomainPack().id === pack.id,
    },
  });
});

export default router;
