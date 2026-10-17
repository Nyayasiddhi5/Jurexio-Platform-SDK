/**
 * Customer Organization Admin Routes — Task #343.
 *
 * Mounted at: /api/jrx/sdk/customer-orgs
 *   POST   /          — platform upserts a customer org (idempotent on
 *                       (platform_id, external_ref)).
 *   GET    /          — platform lists its own customer orgs.
 *   GET    /:id/usage — usage / billing rollup for one customer org of the
 *                       calling platform.
 *
 * AUTH: SDK API key (sdkGatewayAuth) — every call resolves to a platform
 *       via `req.sdkContext.applicationId`. Cross-platform reads are
 *       impossible: the SQL filter is `platform_id = sdkContext.applicationId`.
 *
 * NV-AUTH-HEADER-001 compliant (X-API-Key only).
 * NV-API-CONTRACT-001: additive routes only.
 * NV-WIRING-001: imported and mounted in src/index.ts.
 */

import { Router, Request, Response } from 'express';
import { z, ZodError } from 'zod';
import { sql, eq } from 'drizzle-orm';
import { sdkGatewayAuth } from '../middleware/jrx-sdk-gateway.js';
import { db } from '../db/index.js';
import { sdkApplications } from '@shared/schema.js';
import { createLogger } from '../utils/logger.js';
import { sendApiError, safeError } from '../utils/jrx-api-error.js';
import {
  loadCustomerOrgLimits,
  loadEffectiveLimitsFor,
  loadTodaysUsageForCustomerOrg,
} from '../services/jrx-billing-tier-service.js';
import {
  isCustomerOrgTier,
  listCustomerOrgTierNames,
} from '../config/jrx-billing-tiers.js';

const router = Router();
const logger = createLogger('./jrx-customer-orgs');

router.use(sdkGatewayAuth);

/**
 * Admin-scope guard — Task #343 review fix.
 *
 * Customer-org admin endpoints are NOT for every SDK key. They mutate /
 * read across the platform's entire customer base, so they require an
 * SDK key with one of the admin scopes below (or a wildcard `*`). A
 * regular per-firm key issued through the developer portal will
 * authenticate via sdkGatewayAuth but be 403'd here.
 *
 * This is the application-tier echo of the contract documented in
 * `docs/canonical/04-sdk-and-api-canonical-2026-05-07.md` § 1 / § 18.
 */
const CUSTOMER_ORG_ADMIN_SCOPES = new Set([
  '*',
  'customer-orgs:admin',
  'customer-orgs:write',
  'admin',
]);

router.use((req: Request, res: Response, next): void => {
  const sdk = (req as any).sdkContext;
  const scopes: string[] = Array.isArray(sdk?.scopes) ? sdk.scopes : [];
  const ok = scopes.some((s) => CUSTOMER_ORG_ADMIN_SCOPES.has(s));
  if (!ok) {
    res.status(403).json({
      success: false,
      error: 'customer-org admin endpoints require an admin-scoped SDK key',
      code: 'CUSTOMER_ORG_ADMIN_SCOPE_REQUIRED',
      required_one_of: Array.from(CUSTOMER_ORG_ADMIN_SCOPES),
    });
    return;
  }
  next();
});

const SAFE_EXTERNAL_REF = /^[A-Za-z0-9._:@\-]{1,128}$/;

const CUSTOMER_ORG_STATUSES = ['active', 'suspended', 'archived'] as const;

const UpsertSchema = z.object({
  external_ref: z.string().regex(SAFE_EXTERNAL_REF,
    'external_ref must be 1-128 chars of [A-Za-z0-9._:@-]'),
  /**
   * task-385: platform_id is the SKU the customer was sold (NSP / NSPM /
   * NSI / NSA / NSM / NYM / JRX → row in sdk_applications). It is OPTIONAL
   * on the wire because the SDK-key auth path already pins it from the
   * key itself (sdkContext.applicationId) — passing a mismatched body
   * value in that path is rejected as a cross-platform spoof attempt.
   * On the JWT / Console path it becomes REQUIRED: the silent
   * "first-app-on-this-org" fallback was removed because an org that
   * owns >1 SKU could otherwise mis-bind the customer at random.
   */
  platform_id: z.number().int().positive().optional(),
  display_name: z.string().min(1).max(255).optional(),
  jurisdiction: z.string().max(10).optional(),
  /**
   * Customer-org billing tier on the calling platform. Must resolve to
   * an entry in `CUSTOMER_ORG_TIERS` (src/config/jrx-billing-tiers.ts) so
   * Jurexio can derive rate-limit / token-budget / agent ceilings for
   * this firm. Free-string values are rejected at 400 with the allowed
   * tier list, so partner platforms can't accidentally store
   * unenforceable tier names.
   */
  tier: z
    .string()
    .max(50)
    .refine((v) => isCustomerOrgTier(v), {
      message: `tier must be one of: ${listCustomerOrgTierNames().join(', ')}`,
    })
    .optional(),
  data_residency: z.string().max(20).optional(),
  /**
   * task-368: status is now an editable field on the upsert so the Console
   * detail-page inline edit (suspend / archive / reactivate) can flow
   * through the same endpoint instead of needing a separate PATCH route.
   * Additive only — omitting it preserves the existing row's status, and
   * a brand-new row still defaults to 'active' in the INSERT branch.
   */
  status: z.enum(CUSTOMER_ORG_STATUSES).optional(),
  /**
   * Optional per-customer-org overrides that win over the named tier's
   * defaults. Three states:
   *   - omitted  → keep whatever's stored (no-op COALESCE).
   *   - number   → set the override.
   *   - null     → CLEAR the override; revert to "inherit from tier".
   *
   * The clear-to-null path is what lets an admin take a firm OFF a
   * negotiated override without having to wipe-and-recreate the row.
   */
  rate_limit_per_minute: z.number().int().positive().max(1_000_000).nullable().optional(),
  daily_token_budget:    z.number().int().positive().max(1_000_000_000).nullable().optional(),
  monthly_token_budget:  z.number().int().positive().max(100_000_000_000).nullable().optional(),
  allowed_agents:        z.array(z.string().max(128)).max(256).nullable().optional(),
  metadata: z.record(z.unknown()).optional(),
});

/**
 * Resolve the calling identity to a single `platform_id` (= sdk_applications.id)
 * that owns customer orgs. Two paths:
 *
 *   1. SDK-key auth: `sdkContext.applicationId` is the platform itself
 *      (set by sdkGatewayAuth from the api-key row). Use it directly.
 *   2. JWT auth (Console): `sdkContext.applicationId` is 0 because the
 *      JWT bypass has no per-application context. For these we look up
 *      the platform that belongs to the user's `organizationId`. This
 *      lets a partner-platform org_admin (or a super_admin acting via
 *      their own org) view their customer firms from the Console without
 *      needing to copy-paste an SDK key. Cross-platform reads are still
 *      impossible: every downstream SQL filter uses the resolved
 *      platform_id, so a different org's admin would resolve to a
 *      different platform_id and see nothing of ours. Task-354.
 */
async function platformIdOrFail(
  req: Request,
  res: Response,
  /**
   * task-385: explicit platform_id from the request body (POST upsert
   * only). MUST be provided when there is no SDK-key context, since the
   * old "first sdk_applications row on this org" silent fallback would
   * mis-bind a customer at random for an org that owns multiple SKUs.
   * On the SDK-key path this MUST equal sdkContext.applicationId or be
   * omitted — anything else is treated as a cross-platform spoof.
   */
  bodyPlatformId?: number | null,
): Promise<number | null> {
  const sdk = (req as any).sdkContext;
  const sdkPlatformId = sdk?.applicationId;

  if (typeof sdkPlatformId === 'number' && sdkPlatformId > 0) {
    if (
      typeof bodyPlatformId === 'number' &&
      bodyPlatformId > 0 &&
      bodyPlatformId !== sdkPlatformId
    ) {
      res.status(403).json({
        success: false,
        error: 'platform_id in body does not match the SDK key — cross-platform onboarding is not allowed',
        code: 'CUSTOMER_ORG_PLATFORM_MISMATCH',
      });
      return null;
    }
    return sdkPlatformId;
  }

  // JWT bypass path — explicit body.platform_id is REQUIRED. We verify
  // it belongs to the caller's organisation so a Console super_admin
  // cannot bind a customer to an SDK app belonging to a different org.
  const orgId = sdk?.organizationId;
  if (db && typeof orgId === 'number' && orgId > 0) {
    if (typeof bodyPlatformId !== 'number' || bodyPlatformId <= 0) {
      res.status(400).json({
        success: false,
        error: 'platform_id is required — pick which product (SDK application) the customer was sold',
        code: 'CUSTOMER_ORG_PLATFORM_REQUIRED',
      });
      return null;
    }
    try {
      // Single round-trip: fetch the row by id AND verify ownership in
      // the same WHERE clause. This avoids the prior two-query / LIMIT-50
      // pattern, which would silently false-negative on orgs that own
      // more than 50 SDK applications. We still surface a 404 vs 403
      // distinction so the Console can show the right error to the user.
      const exists = await db
        .select({ id: sdkApplications.id, organizationId: sdkApplications.organizationId })
        .from(sdkApplications)
        .where(eq(sdkApplications.id, bodyPlatformId))
        .limit(1);
      const row = exists[0];
      if (!row) {
        res.status(404).json({
          success: false,
          error: 'platform_id does not reference any sdk_applications row',
          code: 'CUSTOMER_ORG_PLATFORM_NOT_FOUND',
        });
        return null;
      }
      if (row.organizationId !== orgId) {
        res.status(403).json({
          success: false,
          error: 'platform_id does not belong to your organisation',
          code: 'CUSTOMER_ORG_PLATFORM_NOT_OWNED',
        });
        return null;
      }
      return row.id;
    } catch (err: any) {
      logger.error('platform_id_resolve_failed', { orgId, bodyPlatformId, err: err?.message });
    }
  }

  res.status(401).json({
    success: false,
    error: 'Customer-org admin endpoints require an SDK platform key, or a JWT whose organisation owns an sdk_applications row',
    code: 'CUSTOMER_ORG_PLATFORM_REQUIRED',
  });
  return null;
}

/**
 * Resolve the calling identity to the same single platform used by the
 * read paths (GET / list, GET / usage, GET / usage/daily). For these
 * READ endpoints we keep the legacy "first SDK app on this org" pick
 * because they are scoped server-side to that platform_id and cannot
 * mis-bind data — the worst case is a Console user seeing the wrong
 * platform's customer list, which is a separate task to fix with a
 * proper platform-picker. The WRITE path (POST upsert) goes through
 * `platformIdOrFail` above which now demands an explicit body value.
 */
async function readPlatformIdOrFail(req: Request, res: Response): Promise<number | null> {
  const sdk = (req as any).sdkContext;
  const sdkPlatformId = sdk?.applicationId;
  if (typeof sdkPlatformId === 'number' && sdkPlatformId > 0) return sdkPlatformId;

  const orgId = sdk?.organizationId;
  if (db && typeof orgId === 'number' && orgId > 0) {
    try {
      const apps = await db
        .select({ id: sdkApplications.id })
        .from(sdkApplications)
        .where(eq(sdkApplications.organizationId, orgId))
        .limit(1);
      const resolved = apps[0]?.id;
      if (typeof resolved === 'number' && resolved > 0) return resolved;
    } catch (err: any) {
      logger.error('platform_id_resolve_failed', { orgId, err: err?.message });
    }
  }

  res.status(401).json({
    success: false,
    error: 'Customer-org admin endpoints require an SDK platform key, or a JWT whose organisation owns an sdk_applications row',
    code: 'CUSTOMER_ORG_PLATFORM_REQUIRED',
  });
  return null;
}

// GET /api/jrx/sdk/customer-orgs/me/platforms — list the platforms the
// caller can target on the upsert. Drives the Console "Product / SKU"
// Select; without a non-empty list the form is blocked from submission
// (task-385). For SDK-key auth this is exactly the one platform the key
// is bound to; for JWT auth it is every sdk_applications row owned by
// the caller's organisation.
router.get('/me/platforms', async (req: Request, res: Response): Promise<void> => {
  if (!db) {
    res.status(503).json({ success: false, error: 'Database unavailable', code: 'DB_UNAVAILABLE' });
    return;
  }
  const sdk = (req as any).sdkContext;
  const sdkPlatformId = sdk?.applicationId;
  const orgId = sdk?.organizationId;
  try {
    let rows: Array<{ id: number; app_name: string; app_type: string; jurisdiction: string | null }>; 
    if (typeof sdkPlatformId === 'number' && sdkPlatformId > 0) {
      const r: any = await db.execute(sql`
        SELECT id, app_name, app_type, jurisdiction
          FROM sdk_applications
         WHERE id = ${sdkPlatformId}
         LIMIT 1
      `);
      rows = (r?.rows ?? r ?? []) as any[];
    } else if (typeof orgId === 'number' && orgId > 0) {
      // No LIMIT — orgs may own arbitrarily many SDK applications and a
      // silent cap would hide products from the picker, re-introducing
      // the "I can't find my SKU" version of the bug task #385 closes.
      const r: any = await db.execute(sql`
        SELECT id, app_name, app_type, jurisdiction
          FROM sdk_applications
         WHERE organization_id = ${orgId}
         ORDER BY id
      `);
      rows = (r?.rows ?? r ?? []) as any[];
    } else {
      res.status(401).json({
        success: false,
        error: 'Customer-org admin endpoints require an SDK platform key, or a JWT whose organisation owns an sdk_applications row',
        code: 'CUSTOMER_ORG_PLATFORM_REQUIRED',
      });
      return;
    }
    res.json({
      success: true,
      data: {
        items: rows.map((r) => ({
          id: r.id,
          app_name: r.app_name,
          app_type: r.app_type,
          jurisdiction: r.jurisdiction,
        })),
      },
    });
  } catch (err: any) {
    logger.error('me_platforms_failed', { err: err?.message });
    res.status(500).json({ success: false, error: 'Failed to list platforms', code: 'CUSTOMER_ORG_ME_PLATFORMS_FAILED' });
  }
});

// POST /api/jrx/sdk/customer-orgs — upsert (idempotent)
router.post('/', async (req: Request, res: Response): Promise<void> => {
  if (!db) {
    res.status(503).json({ success: false, error: 'Database unavailable', code: 'DB_UNAVAILABLE' });
    return;
  }
  // task-385: parse the body BEFORE platform resolution so the explicit
  // body.platform_id can drive the resolver. ZodError is caught below.
  let body: z.infer<typeof UpsertSchema>;
  try {
    body = UpsertSchema.parse(req.body ?? {});
  } catch (err) {
    if (err instanceof ZodError) {
      res.status(400).json({ success: false, error: 'invalid body', detail: err.errors });
      return;
    }
    throw err;
  }
  const platformId = await platformIdOrFail(req, res, body.platform_id ?? null);
  if (platformId == null) return;
  try {
    // task-368 (code-review fix): the INSERT branch needs a non-null
    // display_name (NOT NULL column with no DB default), so we fall back
    // to external_ref for brand-new rows. The UPDATE branch must NOT
    // use this fallback — otherwise a status/tier-only edit from the
    // Console would silently rewrite the display_name to the
    // external_ref. We pass the user-supplied value as a separate
    // nullable parameter (`patchDisplayName`) and COALESCE against the
    // existing column so omitted fields keep their stored value. The
    // same pattern is now applied to every editable field for safety.
    const insertDisplay = body.display_name ?? body.external_ref;
    const patchDisplayName  = body.display_name   ?? null;
    const patchJurisdiction = body.jurisdiction   ?? null;
    const patchTier         = body.tier           ?? null;
    const patchDataResid    = body.data_residency ?? null;
    const patchStatus       = body.status         ?? null;
    // Distinguish "omit" (preserve) from "null" (clear). For the three
    // numeric overrides we forward the raw value (number | null | undefined)
    // and let the SQL CASE pick the right branch. For allowed_agents we
    // JSON-stringify on a real array, pass an explicit JSON 'null' string
    // to clear (CASE handles it), or leave undefined to preserve.
    const hasRate    = Object.prototype.hasOwnProperty.call(body, 'rate_limit_per_minute');
    const hasDaily   = Object.prototype.hasOwnProperty.call(body, 'daily_token_budget');
    const hasMonthly = Object.prototype.hasOwnProperty.call(body, 'monthly_token_budget');
    const hasAgents  = Object.prototype.hasOwnProperty.call(body, 'allowed_agents');
    const patchRate    = body.rate_limit_per_minute ?? null;
    const patchDaily   = body.daily_token_budget    ?? null;
    const patchMonthly = body.monthly_token_budget  ?? null;
    const patchAgents  = body.allowed_agents == null ? null : JSON.stringify(body.allowed_agents);
    const r: any = await db.execute(sql`
      INSERT INTO nv_customer_organizations
        (platform_id, external_ref, display_name, jurisdiction, tier,
         data_residency, status,
         rate_limit_per_minute, daily_token_budget, monthly_token_budget,
         allowed_agents, metadata)
      VALUES
        (${platformId}, ${body.external_ref}, ${insertDisplay},
         ${body.jurisdiction ?? 'IN'}, ${body.tier ?? 'standard'},
         ${body.data_residency ?? 'IN'}, ${body.status ?? 'active'},
         ${patchRate}, ${patchDaily}, ${patchMonthly},
         ${JSON.stringify(body.allowed_agents ?? [])}::jsonb,
         ${JSON.stringify(body.metadata ?? {})}::jsonb)
      ON CONFLICT (platform_id, external_ref) DO UPDATE
        SET display_name          = COALESCE(${patchDisplayName}, nv_customer_organizations.display_name),
            jurisdiction          = COALESCE(${patchJurisdiction}, nv_customer_organizations.jurisdiction),
            tier                  = COALESCE(${patchTier}, nv_customer_organizations.tier),
            data_residency        = COALESCE(${patchDataResid}, nv_customer_organizations.data_residency),
            status                = COALESCE(${patchStatus}, nv_customer_organizations.status),
            rate_limit_per_minute = CASE WHEN ${hasRate}    THEN ${patchRate}::int  ELSE nv_customer_organizations.rate_limit_per_minute END,
            daily_token_budget    = CASE WHEN ${hasDaily}   THEN ${patchDaily}::int ELSE nv_customer_organizations.daily_token_budget    END,
            monthly_token_budget  = CASE WHEN ${hasMonthly} THEN ${patchMonthly}::int ELSE nv_customer_organizations.monthly_token_budget END,
            allowed_agents        = CASE WHEN ${hasAgents}  THEN COALESCE(${patchAgents}::jsonb, '[]'::jsonb) ELSE nv_customer_organizations.allowed_agents END,
            metadata              = nv_customer_organizations.metadata || EXCLUDED.metadata,
            updated_at            = NOW()
      RETURNING id, platform_id, external_ref, display_name, jurisdiction, tier,
                data_residency, status,
                rate_limit_per_minute, daily_token_budget, monthly_token_budget,
                allowed_agents, metadata, created_at, updated_at
    `);
    const row = (r?.rows?.[0] ?? r?.[0]) ?? null;
    res.status(200).json({ success: true, data: row });
  } catch (err: any) {
    if (err instanceof ZodError) {
      res.status(400).json({ success: false, error: 'invalid body', detail: err.errors });
      return;
    }
    logger.error('customer_org_upsert_failed', { platformId, err: err?.message });
    res.status(500).json({ success: false, error: 'Failed to upsert customer org', code: 'CUSTOMER_ORG_UPSERT_FAILED' });
  }
});

// GET /api/jrx/sdk/customer-orgs — list (platform-scoped)
router.get('/', async (req: Request, res: Response): Promise<void> => {
  const platformId = await readPlatformIdOrFail(req, res);
  if (platformId == null) return;
  if (!db) {
    res.status(503).json({ success: false, error: 'Database unavailable', code: 'DB_UNAVAILABLE' });
    return;
  }
  const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 50)));
  const offset = Math.max(0, Number(req.query.offset ?? 0));
  const status = req.query.status ? String(req.query.status) : null;
  try {
    // task-354 (2026-05-13): `last_seen_at` is the activity-derived
    // timestamp the Console "Last seen" column wants — MAX(created_at)
    // from sdk_api_request_logs for this (platform, customer_org). The
    // subquery is COALESCE'd to the org's `updated_at` so the column
    // never renders blank for a freshly-onboarded firm with zero traffic.
    // Wrapped in a `to_regclass` guard so envs that haven't migrated the
    // sdk_api_request_logs.customer_org_id column yet still get a
    // working list (last_seen_at falls back to updated_at).
    const r: any = await db.execute(sql`
      SELECT o.id, o.platform_id, o.external_ref, o.display_name, o.jurisdiction, o.tier,
             o.data_residency, o.status, o.metadata, o.created_at, o.updated_at,
             COALESCE(
               (SELECT MAX(l.created_at) FROM sdk_api_request_logs l
                WHERE l.application_id = o.platform_id
                  AND l.customer_org_id = o.id),
               o.updated_at
             ) AS last_seen_at
      FROM nv_customer_organizations o
      WHERE o.platform_id = ${platformId}
        AND (${status}::text IS NULL OR o.status = ${status})
      ORDER BY o.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `).catch(async () => db!.execute(sql`
      SELECT o.id, o.platform_id, o.external_ref, o.display_name, o.jurisdiction, o.tier,
             o.data_residency, o.status, o.metadata, o.created_at, o.updated_at,
             o.updated_at AS last_seen_at
      FROM nv_customer_organizations o
      WHERE o.platform_id = ${platformId}
        AND (${status}::text IS NULL OR o.status = ${status})
      ORDER BY o.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `));
    const rows = (r?.rows ?? r ?? []) as any[];
    const c: any = await db.execute(sql`
      SELECT COUNT(*)::int AS n FROM nv_customer_organizations
      WHERE platform_id = ${platformId}
        AND (${status}::text IS NULL OR status = ${status})
    `);
    const total = (c?.rows?.[0]?.n ?? c?.[0]?.n ?? 0) as number;
    res.json({ success: true, data: { items: rows, total, limit, offset } });
  } catch (err: any) {
    logger.error('customer_org_list_failed', { platformId, err: err?.message });
    res.status(500).json({ success: false, error: 'Failed to list customer orgs', code: 'CUSTOMER_ORG_LIST_FAILED' });
  }
});

// GET /api/jrx/sdk/customer-orgs/:id/usage — per-customer-org rollup
router.get('/:id/usage', async (req: Request, res: Response): Promise<void> => {
  const platformId = await readPlatformIdOrFail(req, res);
  if (platformId == null) return;
  if (!db) {
    res.status(503).json({ success: false, error: 'Database unavailable', code: 'DB_UNAVAILABLE' });
    return;
  }
  const customerOrgId = Number(req.params.id);
  if (!Number.isInteger(customerOrgId) || customerOrgId <= 0) {
    sendApiError(res, 'BAD_REQUEST', { overrideMessage: 'invalid customer org id' });
    return;
  }
  try {
    // Cross-tenant guard: the customer org MUST belong to the calling
    // platform. Without this filter an NSP key could read NSI usage.
    // task-368: include tier / jurisdiction / data_residency so the
    // Console detail-page inline-edit panel can hydrate from authoritative
    // backend state. Without these fields the EditPanel defaulted tier to
    // 'standard' and would have silently downgraded an enterprise firm
    // on the next save.
    const own: any = await db.execute(sql`
      SELECT id, external_ref, display_name, status, tier, jurisdiction, data_residency
      FROM nv_customer_organizations
      WHERE id = ${customerOrgId} AND platform_id = ${platformId}
      LIMIT 1
    `);
    const ownRow = (own?.rows?.[0] ?? own?.[0]) as any;
    if (!ownRow) {
      res.status(404).json({ success: false, error: 'customer org not found for this platform', code: 'CUSTOMER_ORG_NOT_FOUND' });
      return;
    }

    // Rollups are best-effort: each table is queried with COALESCE so a
    // missing column (env not yet migrated) returns 0 rather than 500.
    //
    // task-354 (2026-05-13): both queries are now constrained to the
    // last 30 days to match the Console label "Last 30-day usage rollup"
    // and the task spec's per-firm 30-day window. The boundary uses
    // `recorded_at` for sdk_usage_metering (the metering table's own
    // bucket timestamp) and `created_at` for sdk_api_request_logs.
    const usage: any = await db.execute(sql`
      SELECT
        COALESCE(SUM(tokens_in), 0)::bigint  AS tokens_in,
        COALESCE(SUM(tokens_out), 0)::bigint AS tokens_out,
        COALESCE(SUM(cost_usd), 0)::float    AS cost_usd,
        COALESCE(SUM(request_count), 0)::int AS request_count
      FROM sdk_usage_metering
      WHERE application_id = ${platformId}
        AND customer_org_id = ${customerOrgId}
        AND recorded_at >= NOW() - INTERVAL '30 days'
    `).catch(() => ({ rows: [{ tokens_in: 0, tokens_out: 0, cost_usd: 0, request_count: 0 }] }));
    const usageRow = (usage?.rows?.[0] ?? usage?.[0]) ?? {};

    const requests: any = await db.execute(sql`
      SELECT COUNT(*)::int AS n,
             COUNT(*) FILTER (WHERE status_code >= 400)::int AS errors
      FROM sdk_api_request_logs
      WHERE application_id = ${platformId}
        AND customer_org_id = ${customerOrgId}
        AND created_at >= NOW() - INTERVAL '30 days'
    `).catch(() => ({ rows: [{ n: 0, errors: 0 }] }));
    const reqRow = (requests?.rows?.[0] ?? requests?.[0]) ?? {};

    res.json({
      success: true,
      data: {
        customer_org: ownRow,
        // Effective limits hint so Console / partner UIs don't have to
        // round-trip to /:id/limits when rendering the rollup screen.
        limits_endpoint: `/api/jrx/sdk/customer-orgs/${customerOrgId}/limits`,
        usage: {
          tokens_in:     Number(usageRow.tokens_in     ?? 0),
          tokens_out:    Number(usageRow.tokens_out    ?? 0),
          cost_usd:      Number(usageRow.cost_usd      ?? 0),
          request_count: Number(usageRow.request_count ?? reqRow.n ?? 0),
          error_count:   Number(reqRow.errors          ?? 0),
        },
        generated_at: new Date().toISOString(),
      },
    });
  } catch (err: any) {
    logger.error('customer_org_usage_failed', { platformId, customerOrgId, err: err?.message });
    res.status(500).json({ success: false, error: 'Failed to load usage rollup', code: 'CUSTOMER_ORG_USAGE_FAILED' });
  }
});

// GET /api/jrx/sdk/customer-orgs/:id/usage/daily — daily 30-day series
//
// task-369 (2026-05-13): the existing /usage endpoint returns a single
// 30-day rollup. Partner platforms billing downstream firms want a
// day-by-day series so they can spot spikes / churn / anomalies without
// exporting raw logs. This endpoint aggregates the same two source
// tables (sdk_usage_metering, sdk_api_request_logs) bucketed by
// `date_trunc('day', ...)` and LEFT JOINed against a `generate_series`
// of the last `days` days so the output array always has one row per
// day (zeros where no traffic).
router.get('/:id/usage/daily', async (req: Request, res: Response): Promise<void> => {
  const platformId = await readPlatformIdOrFail(req, res);
  if (platformId == null) return;
  if (!db) {
    res.status(503).json({ success: false, error: 'Database unavailable', code: 'DB_UNAVAILABLE' });
    return;
  }
  const customerOrgId = Number(req.params.id);
  if (!Number.isInteger(customerOrgId) || customerOrgId <= 0) {
    sendApiError(res, 'BAD_REQUEST', { overrideMessage: 'invalid customer org id' });
    return;
  }
  const days = Math.min(90, Math.max(1, Number(req.query.days ?? 30)));
  try {
    // Cross-tenant guard — same as /usage.
    const own: any = await db.execute(sql`
      SELECT id FROM nv_customer_organizations
      WHERE id = ${customerOrgId} AND platform_id = ${platformId}
      LIMIT 1
    `);
    const ownRow = (own?.rows?.[0] ?? own?.[0]) as any;
    if (!ownRow) {
      res.status(404).json({ success: false, error: 'customer org not found for this platform', code: 'CUSTOMER_ORG_NOT_FOUND' });
      return;
    }

    // generate_series gives us a stable 30-row spine (UTC day buckets);
    // each source table is left-joined and aggregated separately so
    // missing days render as zeros rather than gaps in the chart.
    const series: any = await db.execute(sql`
      WITH spine AS (
        SELECT generate_series(
          date_trunc('day', NOW() - (${days - 1} || ' days')::interval),
          date_trunc('day', NOW()),
          INTERVAL '1 day'
        )::date AS day
      ),
      reqs AS (
        SELECT date_trunc('day', created_at)::date AS day,
               COUNT(*)::int                                       AS request_count,
               COUNT(*) FILTER (WHERE status_code >= 400)::int     AS error_count
        FROM sdk_api_request_logs
        WHERE application_id = ${platformId}
          AND customer_org_id = ${customerOrgId}
          AND created_at >= NOW() - (${days} || ' days')::interval
        GROUP BY 1
      ),
      meter AS (
        SELECT date_trunc('day', recorded_at)::date AS day,
               COALESCE(SUM(tokens_in), 0)::bigint  AS tokens_in,
               COALESCE(SUM(tokens_out), 0)::bigint AS tokens_out,
               COALESCE(SUM(cost_usd), 0)::float    AS cost_usd
        FROM sdk_usage_metering
        WHERE application_id = ${platformId}
          AND customer_org_id = ${customerOrgId}
          AND recorded_at >= NOW() - (${days} || ' days')::interval
        GROUP BY 1
      )
      SELECT to_char(s.day, 'YYYY-MM-DD')          AS day,
             COALESCE(r.request_count, 0)::int     AS request_count,
             COALESCE(r.error_count,   0)::int     AS error_count,
             COALESCE(m.tokens_in,     0)::bigint  AS tokens_in,
             COALESCE(m.tokens_out,    0)::bigint  AS tokens_out,
             COALESCE(m.cost_usd,      0)::float   AS cost_usd
      FROM spine s
      LEFT JOIN reqs  r ON r.day = s.day
      LEFT JOIN meter m ON m.day = s.day
      ORDER BY s.day ASC
    `);

    const rows = (series?.rows ?? series ?? []) as any[];
    const points = rows.map((r) => ({
      day:           String(r.day),
      request_count: Number(r.request_count ?? 0),
      error_count:   Number(r.error_count   ?? 0),
      tokens_in:     Number(r.tokens_in     ?? 0),
      tokens_out:    Number(r.tokens_out    ?? 0),
      cost_usd:      Number(r.cost_usd      ?? 0),
    }));

    res.json({
      success: true,
      data: {
        customer_org_id: customerOrgId,
        days,
        points,
        generated_at: new Date().toISOString(),
      },
    });
  } catch (err: any) {
    logger.error('customer_org_usage_daily_failed', { platformId, customerOrgId, err: err?.message });
    res.status(500).json({ success: false, error: 'Failed to load daily usage series', code: 'CUSTOMER_ORG_USAGE_DAILY_FAILED' });
  }
});

// GET /api/jrx/sdk/customer-orgs/:id/limits — effective limits for ONE
// customer org (= min(platform tier, customer-org tier+overrides) on
// every dimension). Used by partner-platform billing surfaces and by
// the Console limits panel.
router.get('/:id/limits', async (req: Request, res: Response): Promise<void> => {
  const platformId = await platformIdOrFail(req, res);
  if (platformId == null) return;
  const customerOrgId = Number(req.params.id);
  if (!Number.isInteger(customerOrgId) || customerOrgId <= 0) {
    sendApiError(res, 'BAD_REQUEST', { overrideMessage: 'invalid customer org id' });
    return;
  }
  try {
    // Cross-tenant guard via expectedPlatformId — loadCustomerOrgLimits
    // returns null when the row's platform_id differs.
    const own = await loadCustomerOrgLimits(customerOrgId, platformId);
    if (!own) {
      res.status(404).json({
        success: false,
        error: 'customer org not found for this platform',
        code: 'CUSTOMER_ORG_NOT_FOUND',
      });
      return;
    }
    const view = await loadEffectiveLimitsFor(platformId, customerOrgId);
    if (!view) {
      sendApiError(res, 'BAD_REQUEST', { status: 500, overrideMessage: 'platform record missing for sdk_application' });
      return;
    }
    const usage = await loadTodaysUsageForCustomerOrg(platformId, customerOrgId);
    res.json({
      success: true,
      data: {
        platform: view.platform,
        customer_org: view.customerOrg,
        effective: view.effective,
        usage_today: usage,
        generated_at: new Date().toISOString(),
      },
    });
  } catch (err: any) {
    logger.error('customer_org_limits_failed', { platformId, customerOrgId, err: err?.message });
    res.status(500).json({ success: false, error: 'Failed to load limits', code: 'CUSTOMER_ORG_LIMITS_FAILED' });
  }
});

export default router;
