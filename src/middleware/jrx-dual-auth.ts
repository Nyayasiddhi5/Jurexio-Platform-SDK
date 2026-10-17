/**
 * Dual-auth middleware — accepts EITHER an SDK API key (X-API-Key) OR a JWT
 * (Authorization: Bearer <jwt>). Tries SDK key first; if absent, falls back
 * to authenticateToken.
 *
 * Session-15 v15 TASK-B (NV-AGUI-DUAL-AUTH-2026-05-11) — lets partner SDK
 * clients open the AG-UI streaming endpoint without first minting a JWT,
 * while keeping the existing JWT path for the internal Console UI.
 *
 * NV-AUTH-HEADER-001 compliant: uses extractSdkApiKey for the SDK path and
 * delegates to authenticateToken for the JWT path. No new accepted headers.
 *
 * NV-CONSOLE-JWT-DUAL-001 (2026-08-13): extractSdkApiKey() returns ANY Bearer
 * token (including Console JWTs). Routing every Bearer through sdkGatewayAuth
 * made agent-registry / swarm / intelligence Console pages 401 when the JWT
 * role was outside INTERNAL_JWT_ROLES (tryJwtBypass fail → API_KEY_INVALID).
 * Only treat X-API-Key or Bearer `nyv_*` as SDK keys; JWT Bearers use authenticateToken.
 */

import { Request, Response, NextFunction } from 'express';
import {
  extractSdkApiKey,
  SDK_AUTH_HEADER_LC,
  isSdkBearerCredential,
} from './jrx-sdk-auth-header.js';
import { sdkGatewayAuth } from './jrx-sdk-gateway.js';
import { authenticateToken } from './jrx-auth.js';

export { isSdkBearerCredential } from './jrx-sdk-auth-header.js';

export const dualSdkOrJwt = (req: Request, res: Response, next: NextFunction): void => {
  const sdkKey = extractSdkApiKey(req);
  if (sdkKey) {
    const viaXApiKey =
      typeof req.headers[SDK_AUTH_HEADER_LC] === 'string' &&
      String(req.headers[SDK_AUTH_HEADER_LC]).trim().length > 0;
    // X-API-Key → always SDK path. Bearer → SDK only when nyv_* (not JWT).
    if (viaXApiKey || isSdkBearerCredential(sdkKey)) {
      sdkGatewayAuth(req, res, next);
      return;
    }
  }
  authenticateToken(req, res, next);
};
