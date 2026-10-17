// JRX-NS-021 (2026-05-05): pre-existing strict-null cluster (gateway runs via tsx).
import { Router, Request, Response } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { identityExtractionService } from '../services/identity-extraction-service.js';
import { sanitizeErrorForClient } from '../utils/error-sanitizer.js';
import { createLogger } from '../utils/logger.js';


const logger = createLogger('identity-extraction-routes');

const router = Router();

router.post('/extract', authenticateToken, async (req: Request, res: Response) => {
  try {
    const user = req.user;
    const { documentId, documentType } = req.body;

    if (!documentId || !documentType) {
      res.status(400).json({ success: false, error: 'documentId and documentType are required' });
      return;
    }

    const validTypes = ['aadhaar', 'pan', 'passport', 'bar_certificate', 'voter_id', 'driving_license', 'business_registration', 'court_order'];
    if (!validTypes.includes(documentType)) {
      res.status(400).json({ success: false, error: `Invalid documentType. Must be one of: ${validTypes.join(', ')}` });
      return;
    }

    const result = await identityExtractionService.extractIdentityFields(
      documentId,
      // @ts-expect-error NV-TS230 legacy typing gap (TS18048,TS2345)
      user.id || user.userId,
      documentType,
      // @ts-expect-error NV-TS230 legacy typing gap (TS18048)
      user.organizationId
    );

    res.json({ success: true, data: result });
  } catch (error: any) {
    logger.error('[IdentityExtraction] Extract error:', error);
    res.status(500).json({ success: false, error: sanitizeErrorForClient(error) });
  }
});

router.get('/extractions', authenticateToken, async (req: Request, res: Response) => {
  try {
    const user = req.user;
    // @ts-expect-error NV-TS230 legacy typing gap (TS18048,TS2345)
    const extractions = await identityExtractionService.getUserExtractions(user.id || user.userId);
    res.json({ success: true, data: extractions });
  } catch (error: any) {
    logger.error('[IdentityExtraction] List error:', error);
    res.status(500).json({ success: false, error: sanitizeErrorForClient(error) });
  }
});

router.get('/extractions/:id', authenticateToken, async (req: Request, res: Response) => {
  try {
    const extraction = await identityExtractionService.getExtraction(parseInt(String(req.params.id)));
    if (!extraction) {
      res.status(404).json({ success: false, error: 'Extraction not found' });
      return;
    }
    res.json({ success: true, data: extraction });
  } catch (error: any) {
    logger.error('[IdentityExtraction] Get error:', error);
    res.status(500).json({ success: false, error: sanitizeErrorForClient(error) });
  }
});

router.post('/extractions/:id/review', authenticateToken, async (req: Request, res: Response) => {
  try {
    const user = req.user;
    const { correctedFields } = req.body;
    const result = await identityExtractionService.reviewExtraction(
      parseInt(String(req.params.id)),
      // @ts-expect-error NV-TS230 legacy typing gap (TS18048,TS2345)
      user.id || user.userId,
      correctedFields
    );
    res.json({ success: true, data: result });
  } catch (error: any) {
    logger.error('[IdentityExtraction] Review error:', error);
    res.status(500).json({ success: false, error: sanitizeErrorForClient(error) });
  }
});

router.post('/extractions/:id/apply', authenticateToken, async (req: Request, res: Response) => {
  try {
    const result = await identityExtractionService.applyToProfile(parseInt(String(req.params.id)));
    res.json({ success: true, data: result });
  } catch (error: any) {
    logger.error('[IdentityExtraction] Apply error:', error);
    res.status(500).json({ success: false, error: sanitizeErrorForClient(error) });
  }
});

export default router;
