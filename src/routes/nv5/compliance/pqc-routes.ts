// /api/nv5/compliance/pqc/* — Post-Quantum Cryptography service. Exposes
// keygen + sign-shape capability listing for ops verification. The full
// hybrid sign/verify flow remains in code-path use only (called from
// audit-chain commit + signed-response paths). Admin-scoped.
import { Router, type Request, type Response } from 'express';
import { nvPqcService } from '../../../services/security/jrx-pqc-service.js';
import { requireSdkKeyOnly, requireScope, safeError } from '../_auth.js';

const router = Router();

router.get('/capabilities', requireSdkKeyOnly, requireScope('admin'), (_req: Request, res: Response) => {
  res.json({
    success: true,
    service: './jrx-pqc',
    primitives: ['kem (ML-KEM/Kyber)', 'dsa (ML-DSA/Dilithium)', 'sphincs+', 'hybrid (classical+pqc)'],
    operations: ['kemKeygen', 'kemEncapsulate', 'kemDecapsulate',
                 'dsaKeygen', 'dsaSign', 'dsaVerify',
                 'sphincsSign', 'sphincsVerify',
                 'hybridSign', 'hybridVerify'],
    note: 'Full hybrid sign/verify is invoked from audit-chain commit + signed-response paths.',
  });
});

router.get('/ready', requireSdkKeyOnly, requireScope('admin'), async (_req: Request, res: Response) => {
  try {
    await nvPqcService.ready();
    res.json({ success: true, ready: true });
  } catch (e) { safeError(res, e); }
});

router.post('/kem-keygen', requireSdkKeyOnly, requireScope('admin'), async (_req: Request, res: Response) => {
  try {
    const pair = await nvPqcService.kemKeygen();
    res.json({
      success: true,
      publicKeyB64: pair.publicKey.toString('base64'),
      secretKeyB64: pair.secretKey.toString('base64'),
      publicKeyBytes: pair.publicKey.length,
      secretKeyBytes: pair.secretKey.length,
    });
  } catch (e) { safeError(res, e); }
});

router.post('/dsa-keygen', requireSdkKeyOnly, requireScope('admin'), async (_req: Request, res: Response) => {
  try {
    const pair = await nvPqcService.dsaKeygen();
    res.json({
      success: true,
      publicKeyB64: pair.publicKey.toString('base64'),
      secretKeyB64: pair.secretKey.toString('base64'),
      publicKeyBytes: pair.publicKey.length,
      secretKeyBytes: pair.secretKey.length,
    });
  } catch (e) { safeError(res, e); }
});

export default router;
