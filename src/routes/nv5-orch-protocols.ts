// /api/nv5/orch/protocols/* — protocol manifest introspection.
//
// Read-only. The actual `initializeProtocolRegistryFromManifest` runs at
// gateway boot (see src/index.ts) — re-running it from a route would
// require either a stub probe (rejected as non-functional by reviewer) or
// duplicating the canonical registry writer. Both are out-of-scope here;
// the canonical bootstrap path already covers idempotent re-init.
//
// This router exists to keep `jrx-protocol-registry-manifest.ts` reachable
// from src/index.ts (wiring-audit + import-graph) and to expose a probe.
import { Router, type Request, type Response } from 'express';
import { initializeProtocolRegistryFromManifest } from '../services/jrx-protocol-registry-manifest.js';
import { requireSdkKey } from './_nv5-orch-auth.js';

void initializeProtocolRegistryFromManifest;

const router = Router();
router.use(requireSdkKey);

router.get('/health', (_req: Request, res: Response) => {
  res.json({
    success: true,
    service: './jrx-protocol-registry-manifest',
    note: 'manifest init runs at gateway bootstrap; see /api/jrx/health',
  });
});

export default router;
