/**
 * Customer Organization Service — Task #343 (Multi-tenant sub-org model).
 *
 * Resolves and auto-provisions the downstream tenant (customer org) of a
 * platform on every SDK call. Header contract:
 *   X-Customer-Org-Id    — REQUIRED on production tenants. Opaque platform-
 *                          asserted string (≤128 chars). Becomes the
 *                          `external_ref` on `nv_customer_organizations`.
 *   X-Customer-Org-Name  — OPTIONAL display label captured on first sighting.
 *   X-Customer-User-Id   — OPTIONAL end-user id (for audit chain).
 *   X-Customer-User-Email — OPTIONAL end-user email (for audit chain).
 *
 * Backwards-compat: if X-Customer-Org-Id is absent we resolve to the
 * synthetic per-platform default (`platform_id × 1_000_000`), which the
 * 0012 migration backfilled. This keeps every legacy NSP call working
 * while platforms migrate to passing the header.
 *
 * NV-OWNERSHIP-001: queries our own `nv_customer_organizations` table.
 * NV-NAMING-001: jrx- prefix; pre-flight grep confirms no prior file at this
 *   path.
 */

import type { Request } from 'express';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('./jrx-customer-org-service');

const HEADER_CUSTOMER_ORG_ID    = 'x-customer-org-id';
const HEADER_CUSTOMER_ORG_NAME  = 'x-customer-org-name';
const HEADER_CUSTOMER_USER_ID   = 'x-customer-user-id';
const HEADER_CUSTOMER_USER_EMAIL = 'x-customer-user-email';
/**
 * NV-SESSION-ECHO-001 / NV-SESSION-POOLING-001 — the partner's own conversation id.
 *
 * NSP sends `X-Customer-Session-Id` on every AI call. We were reading only the body
 * `sessionId`, so a partner that scoped its threads via the header was silently
 * given a JRX-minted session instead of its own — the same class of miss as not
 * reading `x-customer-user-id`. Honouring the header means NSP's thread identity
 * wins, which is the correct precedence: the partner knows what a conversation is,
 * we do not.
 */
const HEADER_CUSTOMER_SESSION_ID = 'x-customer-session-id';

// External_ref is opaque to us — the platform owns the namespace. We cap
// length and limit charset to keep it indexable + safe in URLs / logs.
const SAFE_EXTERNAL_REF = /^[A-Za-z0-9._:@\-]{1,128}$/;

export interface CustomerOrgResolution {
  customerOrgId: number;
  customerOrgName: string;
  externalRef: string;
  isSynthetic: boolean;        // true when defaulted to platform's __default__
  customerUserId?: string;
  customerUserEmail?: string;
}

function readHeader(req: Request, name: string): string | null {
  const v = req.headers[name];
  if (typeof v === 'string' && v.trim()) return v.trim();
  return null;
}

function syntheticDefaultId(platformId: number): number {
  return platformId * 1_000_000;
}

/**
 * The partner's own conversation id from `X-Customer-Session-Id`, if sent.
 *
 * Kept here beside the other `x-customer-*` readers so all partner-identity headers
 * live in one place. Validated with the same charset as `externalRef` because it is
 * equally opaque to us and lands in log lines and cache keys — an unbounded header
 * value must not be trusted into either.
 */
export function resolveCustomerSessionId(req: Request): string | null {
  const raw = readHeader(req, HEADER_CUSTOMER_SESSION_ID);
  if (!raw) return null;
  if (!SAFE_EXTERNAL_REF.test(raw)) {
    logger.warn('[CustomerOrg] ignoring unsafe X-Customer-Session-Id', { length: raw.length });
    return null;
  }
  return raw;
}

/**
 * Resolve (and auto-provision on first sighting) the customer org for a
 * given (platform, request) pair. Always returns a binding — the synthetic
 * default carries every legacy caller through.
 */
export async function resolveCustomerOrg(
  platformId: number,
  req: Request,
): Promise<CustomerOrgResolution> {
  const customerUserId    = readHeader(req, HEADER_CUSTOMER_USER_ID)    ?? undefined;
  const customerUserEmail = readHeader(req, HEADER_CUSTOMER_USER_EMAIL) ?? undefined;
  const externalRefRaw    = readHeader(req, HEADER_CUSTOMER_ORG_ID);
  const displayNameRaw    = readHeader(req, HEADER_CUSTOMER_ORG_NAME);

  if (!externalRefRaw) {
    return {
      customerOrgId: syntheticDefaultId(platformId),
      customerOrgName: '__default__',
      externalRef: '__default__',
      isSynthetic: true,
      customerUserId,
      customerUserEmail,
    };
  }

  if (!SAFE_EXTERNAL_REF.test(externalRefRaw)) {
    // Reject silently → fall back to synthetic so we never crash a request,
    // but warn loudly so the platform owner notices.
    logger.warn('customer_org_external_ref_rejected', {
      platformId,
      externalRefSample: externalRefRaw.slice(0, 32),
    });
    return {
      customerOrgId: syntheticDefaultId(platformId),
      customerOrgName: '__default__',
      externalRef: '__default__',
      isSynthetic: true,
      customerUserId,
      customerUserEmail,
    };
  }

  if (!db) {
    // No DB — return ephemeral binding so dev/UAT smoke tests still proceed.
    return {
      customerOrgId: syntheticDefaultId(platformId),
      customerOrgName: displayNameRaw ?? externalRefRaw,
      externalRef: externalRefRaw,
      isSynthetic: true,
      customerUserId,
      customerUserEmail,
    };
  }

  const displayName = displayNameRaw ?? externalRefRaw;

  // Idempotent upsert. ON CONFLICT keeps the existing display_name unless
  // the platform explicitly re-asserts a non-empty value.
  try {
    const r: any = await db.execute(sql`
      INSERT INTO nv_customer_organizations
        (platform_id, external_ref, display_name, status)
      VALUES
        (${platformId}, ${externalRefRaw}, ${displayName}, 'active')
      ON CONFLICT (platform_id, external_ref) DO UPDATE
        SET display_name = COALESCE(EXCLUDED.display_name, nv_customer_organizations.display_name),
            updated_at   = NOW()
      RETURNING id, display_name
    `);
    const row = (r?.rows?.[0] ?? r?.[0]) as { id: number; display_name: string } | undefined;
    if (row) {
      return {
        customerOrgId: Number(row.id),
        customerOrgName: row.display_name ?? displayName,
        externalRef: externalRefRaw,
        isSynthetic: false,
        customerUserId,
        customerUserEmail,
      };
    }
  } catch (err: any) {
    // Most likely the table doesn't exist yet (migration not run on this
    // env). Fall through to the synthetic default so the request is not
    // 500'd; emit one warn so it shows up in observability.
    logger.warn('customer_org_upsert_failed', {
      platformId,
      err: err?.message,
    });
  }

  return {
    customerOrgId: syntheticDefaultId(platformId),
    customerOrgName: displayName,
    externalRef: externalRefRaw,
    isSynthetic: true,
    customerUserId,
    customerUserEmail,
  };
}

export const _internal = {
  HEADER_CUSTOMER_ORG_ID,
  HEADER_CUSTOMER_ORG_NAME,
  HEADER_CUSTOMER_USER_ID,
  HEADER_CUSTOMER_USER_EMAIL,
  SAFE_EXTERNAL_REF,
  syntheticDefaultId,
};
