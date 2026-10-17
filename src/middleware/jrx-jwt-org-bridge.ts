import { Request, Response, NextFunction } from 'express';
import { resolveCustomerOrg } from '../services/jrx-customer-org-service.js';

/**
 * Bridge a Console JWT identity into a minimal `req.sdkContext` so SDK-shaped
 * route handlers (which expect `sdkContext.organizationId` / `customerOrgId`)
 * also work for Console JWT callers.
 *
 * Task #343: extended to honour the X-Customer-Org-Id family of headers
 * when present, so a platform-admin Console session can scope a request to
 * one of its downstream customer orgs the same way an SDK key call would.
 */
export async function bridgeJwtOrgToSdkContext(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const u: any = (req as any).user;
  const sdk: any = (req as any).sdkContext;
  if (!sdk && u && (u.organizationId != null || u.orgId != null)) {
    const orgId = Number(u.organizationId ?? u.orgId);
    const h = req.headers;
    const customerOrgName =
      (typeof h['x-customer-org-name'] === 'string' && (h['x-customer-org-name'] as string).trim()) || undefined;
    const customerUserId =
      (typeof h['x-customer-user-id'] === 'string' && (h['x-customer-user-id'] as string).trim()) || undefined;
    const customerUserEmail =
      (typeof h['x-customer-user-email'] === 'string' && (h['x-customer-user-email'] as string).trim()) || undefined;

    // Task #343 review fix: actually RESOLVE the concrete customer_org_id
    // (not just the external_ref) so downstream tenant-scoped queries can
    // filter by the same numeric id used in the SDK-key flow. The Console
    // JWT carries `organizationId` which IS the platform_id in our model.
    let customerOrgId: number | undefined;
    let customerOrgExternalRef: string | undefined;
    let customerOrgIsSynthetic = true;
    try {
      const resolved = await resolveCustomerOrg(orgId, req as any);
      customerOrgId = resolved.customerOrgId;
      customerOrgExternalRef = resolved.externalRef;
      customerOrgIsSynthetic = resolved.isSynthetic;
    } catch {
      // fail-soft: leave customerOrgId undefined, downstream will fall
      // through to legacy single-tenant scoping with a warn-level log.
    }

    (req as any).sdkContext = {
      organizationId: orgId,
      platformId: orgId,
      platformOrgId: orgId,
      platform: 'console',
      source: 'jwt-bridge',
      customerOrgId,
      customerOrgExternalRef,
      customerOrgName,
      customerOrgIsSynthetic,
      customerUserId,
      customerUserEmail,
    };
  }
  next();
}
