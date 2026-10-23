/**
 * NV-PARTNER-INDIA-SCOPE-001 — After dualSdkOrJwt / sdkGatewayAuth, lock NSP & NYM
 * requests to jurisdiction=IN (templates, knowledge, intelligence, orchestrate).
 */

import type { Request, Response, NextFunction } from 'express';
import { applyIndiaOnlyScopeToRequest, isIndiaOnlyPartner } from '../utils/jrx-partner-platform.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('./jrx-partner-india-scope');

export function partnerIndiaScopeMiddleware(req: Request, _res: Response, next: NextFunction): void {
  if (isIndiaOnlyPartner(req)) {
    applyIndiaOnlyScopeToRequest(req);
    logger.debug('[partner-india-scope] forced jurisdiction=IN', {
      path: req.path,
      platform: (req as Request & { sdkContext?: { partnerPlatformCode?: string; platformUatLabel?: string } }).sdkContext
        ?.partnerPlatformCode
        || (req as Request & { sdkContext?: { platformUatLabel?: string } }).sdkContext?.platformUatLabel,
    });
  }
  next();
}
