/**
 * Admin Extras Routes (Task #178 / B2 + Task #188)
 *   GET   /api/jrx/admin/white-label       — current org white-label config (org_admin+)
 *   PATCH /api/jrx/admin/white-label       — update org white-label config (org_admin+, audited)
 *   GET   /api/jrx/admin/llm-budget        — per-org LLM budget + spend (org_admin+)
 *   PATCH /api/jrx/admin/llm-budget        — update per-org monthly LLM budget (org_admin+, audited)
 *   GET   /api/jrx/superadmin/llm-budget   — all-org budget rollup (super_admin only)
 *   GET   /api/jrx/db/schema               — table list + column counts (super_admin only)
 */
import { Router, Request, Response } from 'express';
import { sql } from 'drizzle-orm';
import { authenticateToken, requireRole } from '../middleware/jrx-auth.js';
import { db as _raw_db } from '../db/index.js';
import { lazyRequire } from '../utils/jrx-type-helpers.js';
const db = lazyRequire(() => _raw_db, 'db');
import { createLogger } from '../utils/logger.js';
import { appendAuditRecord } from '../middleware/jrx-sdk-tracking-middleware.js';

const logger = createLogger('./jrx-admin-extras');

const ORG_ADMIN_ROLES   = ['org_admin', 'admin', 'super_admin', 'owner'];
const SUPER_ADMIN_ROLES = ['super_admin'];

async function safeRows(query: any): Promise<any[]> {
  try {
    const r = await db.execute(query);
    return (r as any).rows ?? r ?? [];
  } catch (err: any) {
    logger.warn('admin_extras_query_failed', { err: err?.message });
    return [];
  }
}

// ── /api/jrx/admin/white-label ─────────────────────────────────────────────
const whiteLabelRouter = Router();
whiteLabelRouter.use(authenticateToken);

whiteLabelRouter.get('/', requireRole(...ORG_ADMIN_ROLES), async (req: Request, res: Response): Promise<void> => {
  const user = (req as any).user ?? {};
  const orgId = String(user.orgId ?? user.organizationId ?? '');
  const role  = String(user.role ?? '');
  const isSuperAdmin = role === 'super_admin';

  const overrideOrgId = isSuperAdmin && req.query.org_id ? String(req.query.org_id) : null;
  const effectiveOrgId = overrideOrgId ?? orgId;

  if (!effectiveOrgId) {
    res.status(400).json({
      success: false,
      error: 'org_context_required',
      message: 'This endpoint is org-scoped. super_admin without org context must pass ?org_id=.',
    });
    return;
  }

  const rows = await safeRows(
    sql`SELECT id, name, slug, tier, settings FROM nv_organizations WHERE id::text = ${effectiveOrgId} OR slug = ${effectiveOrgId} LIMIT 1`,
  );
  const org = rows[0] ?? null;
  const settings: any = org?.settings ?? {};
  const wl = settings.whiteLabel ?? settings.white_label ?? {};

  res.json({
    success: true,
    org_id: effectiveOrgId,
    org_name: org?.name ?? null,
    white_label: {
      enabled: !!(wl.enabled ?? wl.logo ?? wl.domain),
      logo_url: wl.logo_url ?? wl.logo ?? null,
      primary_color: wl.primary_color ?? wl.primaryColor ?? '#0A2A66',
      accent_color: wl.accent_color ?? wl.accentColor ?? '#D4A017',
      domain: wl.domain ?? null,
      brand_name: wl.brand_name ?? wl.brandName ?? org?.name ?? null,
      favicon_url: wl.favicon_url ?? null,
    },
    generatedAt: new Date().toISOString(),
  });
});

// PATCH /api/jrx/admin/white-label — update current org's white-label settings
//
// Body (all optional, partial-update / merge semantics):
//   { enabled?, logo_url?, primary_color?, accent_color?, domain?,
//     brand_name?, favicon_url? }
//
// Writes to nv_organizations.settings.whiteLabel (jsonb merge) and appends a
// tamper-evident audit record via the nv_schema.nv_audit_logs hash chain.
whiteLabelRouter.patch('/', requireRole(...ORG_ADMIN_ROLES), async (req: Request, res: Response): Promise<void> => {
  const user = (req as any).user ?? {};
  const orgId = String(user.orgId ?? user.organizationId ?? '');
  const role  = String(user.role ?? '');
  const isSuperAdmin = role === 'super_admin';

  const overrideOrgId = isSuperAdmin && req.query.org_id ? String(req.query.org_id) : null;
  const effectiveOrgId = overrideOrgId ?? orgId;

  if (!effectiveOrgId) {
    res.status(400).json({
      success: false,
      error: 'org_context_required',
      message: 'super_admin must pass ?org_id= to target a specific tenant.',
    });
    return;
  }

  const body = (req.body ?? {}) as Record<string, any>;
  const ALLOWED = [
    'enabled', 'logo_url', 'primary_color', 'accent_color',
    'domain', 'brand_name', 'favicon_url',
  ];
  const patch: Record<string, any> = {};
  for (const k of ALLOWED) {
    if (k in body) patch[k] = body[k];
  }

  if (Object.keys(patch).length === 0) {
    res.status(400).json({
      success: false,
      error: 'empty_patch',
      message: `Provide at least one of: ${ALLOWED.join(', ')}.`,
    });
    return;
  }

  // Light validation
  const isHexColor = (v: any) => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);
  if ('primary_color' in patch && patch.primary_color && !isHexColor(patch.primary_color)) {
    res.status(400).json({ success: false, error: 'invalid_primary_color', message: 'Expected #RRGGBB.' });
    return;
  }
  if ('accent_color' in patch && patch.accent_color && !isHexColor(patch.accent_color)) {
    res.status(400).json({ success: false, error: 'invalid_accent_color', message: 'Expected #RRGGBB.' });
    return;
  }
  for (const urlField of ['logo_url', 'favicon_url']) {
    if (urlField in patch && patch[urlField] && typeof patch[urlField] !== 'string') {
      res.status(400).json({ success: false, error: `invalid_${urlField}`, message: 'Must be a string URL.' });
      return;
    }
  }
  if ('enabled' in patch) patch.enabled = !!patch.enabled;

  const orgRows = await safeRows(
    sql`SELECT id, settings FROM nv_organizations WHERE id::text = ${effectiveOrgId} OR slug = ${effectiveOrgId} LIMIT 1`,
  );
  const org = orgRows[0];
  if (!org) {
    res.status(404).json({ success: false, error: 'org_not_found' });
    return;
  }

  const settings: any = org.settings ?? {};
  const prevWl: any = settings.whiteLabel ?? settings.white_label ?? {};
  const nextWl = { ...prevWl, ...patch };
  const nextSettings = { ...settings, whiteLabel: nextWl };

  try {
    await db.execute(sql`
      UPDATE nv_organizations
      SET settings = ${JSON.stringify(nextSettings)}::jsonb,
          updated_at = NOW()
      WHERE id::text = ${String(org.id)}
    `);
  } catch (err: any) {
    logger.error('white_label_update_failed', { err: err?.message, orgId: effectiveOrgId });
    res.status(500).json({ success: false, error: 'update_failed', message: err?.message });
    return;
  }

  try {
    await appendAuditRecord({
      eventType: 'admin.white_label.update',
      payload: JSON.stringify({
        orgId: String(org.id),
        actorId: String(user.id ?? user.userId ?? 'unknown'),
        actorRole: role,
        before: prevWl,
        after: nextWl,
        patchKeys: Object.keys(patch),
      }),
    });
  } catch (err: any) {
    logger.error('white_label_audit_failed', { err: err?.message, orgId: effectiveOrgId });
    // Audit-chain integrity failure is operationally significant but the
    // settings change has already been persisted; surface a warning rather
    // than a 5xx so the operator sees the partial-success state.
    res.status(200).json({
      success: true,
      org_id: String(org.id),
      white_label: nextWl,
      audit_warning: err?.message ?? 'audit_chain_append_failed',
      generatedAt: new Date().toISOString(),
    });
    return;
  }

  res.json({
    success: true,
    org_id: String(org.id),
    white_label: nextWl,
    generatedAt: new Date().toISOString(),
  });
});

// ── /api/jrx/admin/llm-budget ──────────────────────────────────────────────
const llmBudgetRouter = Router();
llmBudgetRouter.use(authenticateToken);

llmBudgetRouter.get('/', requireRole(...ORG_ADMIN_ROLES), async (req: Request, res: Response): Promise<void> => {
  const user = (req as any).user ?? {};
  const orgId = String(user.orgId ?? user.organizationId ?? '');
  const role  = String(user.role ?? '');
  const isSuperAdmin = role === 'super_admin';

  // Strict tenant scoping: per-org spend MUST be scoped to a single org.
  // super_admin may pass ?org_id= to inspect a specific tenant; the
  // all-org rollup lives at /api/jrx/superadmin/llm-budget.
  const overrideOrgId = isSuperAdmin && req.query.org_id ? String(req.query.org_id) : null;
  const effectiveOrgId = overrideOrgId ?? orgId;

  if (!effectiveOrgId) {
    res.status(400).json({
      success: false,
      error: 'org_context_required',
      message: 'This endpoint is org-scoped. super_admin without org context must pass ?org_id= or use /api/jrx/superadmin/llm-budget.',
    });
    return;
  }

  const since = sql`NOW() - INTERVAL '30 days'`;
  const usage = await safeRows(sql`
    SELECT
      COALESCE(SUM(input_tokens), 0)::bigint  AS input_tokens,
      COALESCE(SUM(output_tokens), 0)::bigint AS output_tokens,
      COALESCE(SUM(credits_charged), 0)::bigint AS credits_charged,
      COUNT(*)::int AS calls
    FROM nv_ai_activity
    WHERE created_at >= ${since}
      AND org_id = ${effectiveOrgId}
  `);
  const u = usage[0] ?? { input_tokens: 0, output_tokens: 0, credits_charged: 0, calls: 0 };

  const orgRows = await safeRows(
    sql`SELECT settings FROM nv_organizations WHERE id::text = ${effectiveOrgId} OR slug = ${effectiveOrgId} LIMIT 1`,
  );
  const settings: any = orgRows[0]?.settings ?? {};
  const budget = Number(settings.llm_budget_monthly ?? settings.llmBudgetMonthly ?? 0);

  const totalTokens = Number(u.input_tokens) + Number(u.output_tokens);
  const spend = Number(u.credits_charged);

  res.json({
    success: true,
    org_id: effectiveOrgId,
    window_days: 30,
    budget_credits: budget,
    spend_credits: spend,
    remaining_credits: budget > 0 ? Math.max(0, budget - spend) : null,
    utilization_pct: budget > 0 ? Math.round((spend / budget) * 100) : null,
    usage: {
      input_tokens: Number(u.input_tokens),
      output_tokens: Number(u.output_tokens),
      total_tokens: totalTokens,
      calls: Number(u.calls),
    },
    generatedAt: new Date().toISOString(),
  });
});

// PATCH /api/jrx/admin/llm-budget — set the per-org monthly LLM budget (credits)
//
// Body: { budget_credits: number }   (>= 0; integer; 0 disables the cap)
llmBudgetRouter.patch('/', requireRole(...ORG_ADMIN_ROLES), async (req: Request, res: Response): Promise<void> => {
  const user = (req as any).user ?? {};
  const orgId = String(user.orgId ?? user.organizationId ?? '');
  const role  = String(user.role ?? '');
  const isSuperAdmin = role === 'super_admin';

  const overrideOrgId = isSuperAdmin && req.query.org_id ? String(req.query.org_id) : null;
  const effectiveOrgId = overrideOrgId ?? orgId;

  if (!effectiveOrgId) {
    res.status(400).json({
      success: false,
      error: 'org_context_required',
      message: 'super_admin must pass ?org_id= to target a specific tenant.',
    });
    return;
  }

  const body = (req.body ?? {}) as Record<string, any>;
  const raw = body.budget_credits ?? body.llm_budget_monthly ?? body.llmBudgetMonthly;
  if (raw === undefined || raw === null || raw === '') {
    res.status(400).json({ success: false, error: 'missing_budget_credits' });
    return;
  }
  const budget = Number(raw);
  if (!Number.isFinite(budget) || budget < 0 || !Number.isInteger(budget)) {
    res.status(400).json({
      success: false,
      error: 'invalid_budget_credits',
      message: 'Must be a non-negative integer (0 disables the cap).',
    });
    return;
  }

  const orgRows = await safeRows(
    sql`SELECT id, settings FROM nv_organizations WHERE id::text = ${effectiveOrgId} OR slug = ${effectiveOrgId} LIMIT 1`,
  );
  const org = orgRows[0];
  if (!org) {
    res.status(404).json({ success: false, error: 'org_not_found' });
    return;
  }

  const settings: any = org.settings ?? {};
  const prev = Number(settings.llm_budget_monthly ?? settings.llmBudgetMonthly ?? 0);
  const nextSettings = { ...settings, llm_budget_monthly: budget };

  try {
    await db.execute(sql`
      UPDATE nv_organizations
      SET settings = ${JSON.stringify(nextSettings)}::jsonb,
          updated_at = NOW()
      WHERE id::text = ${String(org.id)}
    `);
  } catch (err: any) {
    logger.error('llm_budget_update_failed', { err: err?.message, orgId: effectiveOrgId });
    res.status(500).json({ success: false, error: 'update_failed', message: err?.message });
    return;
  }

  try {
    await appendAuditRecord({
      eventType: 'admin.llm_budget.update',
      payload: JSON.stringify({
        orgId: String(org.id),
        actorId: String(user.id ?? user.userId ?? 'unknown'),
        actorRole: role,
        before_credits: prev,
        after_credits: budget,
      }),
    });
  } catch (err: any) {
    logger.error('llm_budget_audit_failed', { err: err?.message, orgId: effectiveOrgId });
    res.status(200).json({
      success: true,
      org_id: String(org.id),
      budget_credits: budget,
      previous_budget_credits: prev,
      audit_warning: err?.message ?? 'audit_chain_append_failed',
      generatedAt: new Date().toISOString(),
    });
    return;
  }

  res.json({
    success: true,
    org_id: String(org.id),
    budget_credits: budget,
    previous_budget_credits: prev,
    generatedAt: new Date().toISOString(),
  });
});

// ── /api/jrx/superadmin/llm-budget ─────────────────────────────────────────
const superadminLlmBudgetRouter = Router();
superadminLlmBudgetRouter.use(authenticateToken);

superadminLlmBudgetRouter.get('/', requireRole(...SUPER_ADMIN_ROLES), async (_req: Request, res: Response): Promise<void> => {
  const since = sql`NOW() - INTERVAL '30 days'`;
  const perOrg = await safeRows(sql`
    SELECT
      COALESCE(org_id, 'unassigned') AS org_id,
      COALESCE(SUM(input_tokens), 0)::bigint  AS input_tokens,
      COALESCE(SUM(output_tokens), 0)::bigint AS output_tokens,
      COALESCE(SUM(credits_charged), 0)::bigint AS credits_charged,
      COUNT(*)::int AS calls
    FROM nv_ai_activity
    WHERE created_at >= ${since}
    GROUP BY org_id
    ORDER BY credits_charged DESC
    LIMIT 200
  `);

  const totalSpend  = perOrg.reduce((s: number, r: any) => s + Number(r.credits_charged || 0), 0);
  const totalTokens = perOrg.reduce((s: number, r: any) => s + Number(r.input_tokens || 0) + Number(r.output_tokens || 0), 0);
  const totalCalls  = perOrg.reduce((s: number, r: any) => s + Number(r.calls || 0), 0);

  res.json({
    success: true,
    window_days: 30,
    rollup: {
      orgs: perOrg.length,
      total_spend_credits: totalSpend,
      total_tokens: totalTokens,
      total_calls: totalCalls,
    },
    per_org: perOrg.map((r: any) => ({
      org_id: r.org_id,
      input_tokens: Number(r.input_tokens),
      output_tokens: Number(r.output_tokens),
      credits_charged: Number(r.credits_charged),
      calls: Number(r.calls),
    })),
    generatedAt: new Date().toISOString(),
  });
});

// ── /api/jrx/db/schema ─────────────────────────────────────────────────────
const dbSchemaRouter = Router();
dbSchemaRouter.use(authenticateToken);

dbSchemaRouter.get('/', requireRole(...SUPER_ADMIN_ROLES), async (_req: Request, res: Response): Promise<void> => {
  const rows = await safeRows(sql`
    SELECT table_schema, table_name, COUNT(*)::int AS column_count
    FROM information_schema.columns
    WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
    GROUP BY table_schema, table_name
    ORDER BY table_schema, table_name
  `);

  const bySchema: Record<string, number> = {};
  for (const r of rows) bySchema[r.table_schema] = (bySchema[r.table_schema] || 0) + 1;

  res.json({
    success: true,
    total_tables: rows.length,
    schemas: bySchema,
    tables: rows.map((r: any) => ({
      schema: r.table_schema,
      table: r.table_name,
      columns: Number(r.column_count),
    })),
    generatedAt: new Date().toISOString(),
  });
});

export { whiteLabelRouter, llmBudgetRouter, superadminLlmBudgetRouter, dbSchemaRouter };
