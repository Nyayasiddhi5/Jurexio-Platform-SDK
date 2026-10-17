import type { Request, Response, NextFunction } from 'express';

export interface LegacyDeprecationOptions {
  sunsetDate: string;
  surface: string;
  link?: string;
}

export function legacyDeprecationHeader(opts: LegacyDeprecationOptions) {
  const { sunsetDate, surface, link } = opts;
  const sunsetDateObj = new Date(sunsetDate + 'T00:00:00Z');
  const sunsetHttpDate = sunsetDateObj.toUTCString();
  const warning = `299 - "Deprecated surface ${surface} reads/writes legacy nv_api_keys/nv_sdk_applications tables; v3.2 will remove these tables on ${sunsetDate}. Migrate to nv_sdk_keys (NYV-NS-016, see docs/NYV-DEPLOYMENT.md §legacy-sdk-keys-deprecation)."`;

  return function legacyDeprecationMiddleware(_req: Request, res: Response, next: NextFunction): void {
    res.setHeader('Deprecation', 'true');
    res.setHeader('Sunset', sunsetHttpDate);
    res.setHeader('Warning', warning);
    if (link) {
      res.setHeader('Link', `<${link}>; rel="deprecation"; type="text/markdown"`);
    }
    res.setHeader('X-NYV-Deprecated-Surface', surface);
    res.setHeader('X-NYV-Sunset-Version', 'v3.2');
    next();
  };
}

export const LEGACY_SDK_KEYS_DEPRECATION = legacyDeprecationHeader({
  sunsetDate: '2026-08-01',
  surface: 'legacy-sdk-keys',
  link: 'https://api.jurexio.example/docs/NYV-DEPLOYMENT.md#legacy-sdk-keys-deprecation',
});
