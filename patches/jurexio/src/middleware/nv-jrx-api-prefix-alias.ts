/**
 * NV-JRX-API-ALIAS-001 — rewrite `/api/jrx/*` → `/api/nv/*` before route matching.
 * Internal handlers remain on the Nyayavigya mount; Jurexio partners call `/api/jrx/`.
 */
import type { Request, Response, NextFunction } from 'express';
import {
  JRX_PUBLIC_API_PREFIX,
  NYV_INTERNAL_API_PREFIX,
} from '../config/jrx-api-prefix.js';

function rewriteJrxPath(path: string): string {
  if (!path.startsWith(JRX_PUBLIC_API_PREFIX)) return path;
  const suffix = path.slice(JRX_PUBLIC_API_PREFIX.length);
  return `${NYV_INTERNAL_API_PREFIX}${suffix}`;
}

/** When `NYV_DISABLE_JRX_ALIAS=1`, alias is off (NYV-only debugging). Default: on. */
export function isJrxApiAliasEnabled(): boolean {
  return (process.env.NYV_DISABLE_JRX_ALIAS ?? '').trim() !== '1';
}

export function nvJrxApiPrefixAlias(): (
  req: Request,
  res: Response,
  next: NextFunction,
) => void {
  return (req, res, next) => {
    if (!isJrxApiAliasEnabled()) {
      next();
      return;
    }

    const rewrittenUrl = rewriteJrxPath(req.url);
    if (rewrittenUrl !== req.url) {
      req.url = rewrittenUrl;
      res.setHeader('X-JRX-Api-Alias', '1');
    }

    if (typeof req.originalUrl === 'string') {
      const rewrittenOriginal = rewriteJrxPath(req.originalUrl);
      if (rewrittenOriginal !== req.originalUrl) {
        req.originalUrl = rewrittenOriginal;
      }
    }

    next();
  };
}

export { rewriteJrxPath };
