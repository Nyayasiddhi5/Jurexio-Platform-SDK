// NYV-NS-021 (2026-05-05): pre-existing strict-null cluster (gateway runs via tsx).
/**
 * Jurexio Enterprise Platform — Platform Registry Routes
 * NYV-PLATFORMS-001
 *
 * Manages the Jurexio ecosystem platforms as SDK applications.
 * Each platform is an nv_sdk_application with platform_type set.
 *
 * Routes:
 *  GET    /api/jrx/platforms                    — list all registered platforms
 *  GET    /api/jrx/platforms/:id                — get single platform config
 *  POST   /api/jrx/platforms                    — register new platform
 *  PUT    /api/jrx/platforms/:id                — update platform config
 *  PATCH  /api/jrx/platforms/:id/status         — activate / suspend / maintenance
 *  PATCH  /api/jrx/platforms/:id/modules        — update module enablement
 *  PATCH  /api/jrx/platforms/:id/llm-config     — update LLM routing
 *  PATCH  /api/jrx/platforms/:id/rate-limits    — update rate limits
 *  PATCH  /api/jrx/platforms/:id/agents         — update allowed agents
 *  GET    /api/jrx/platforms/:id/usage          — usage metrics for platform
 *  DELETE /api/jrx/platforms/:id                — remove platform (soft delete)
 *
 * NYV-PLATFORMS-500 fix (2026-06-03): this router previously used the
 * `@neondatabase/serverless` HTTP driver (`neon(DATABASE_URL)`) directly. That
 * driver speaks Neon's SQL-over-HTTP protocol, which the EC2 dev-edge RDS host
 * does NOT serve — so EVERY query 500'd (`fetch failed` / non-Neon host), which
 * is why the Platform Registry showed 0 platforms and SDK Key Management was
 * stuck on "No platforms registered". We now use the canonical pooled `db`
 * (drizzle over the driver-aware pool in `src/db/index.ts`, which uses node-pg
 * on RDS) — the same handle every other working route uses (NV-DB-SCRIPT-001).
 *
 * It is ALSO schema-resilient: a minimal/legacy install (the base
 * `nv_sdk_applications` lacks the platform_type/modules_enabled/… columns) is
 * self-healed via idempotent `CREATE TABLE IF NOT EXISTS` + `ADD COLUMN IF NOT
 * EXISTS` (non-destructive, PK type preserved) and the 5 ecosystem platforms
 * are seeded once if the registry is empty. The list endpoint degrades to a
 * 200 (empty list) rather than 500 on any unexpected error.
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db/index.js';
import { sql } from 'drizzle-orm';
import { extractRows } from '../utils/jrx-type-helpers.js';
import { authenticateToken, requireRole } from '../middleware/jrx-auth.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('./jrx-platforms');
const router = Router();

// NV-RBAC-GAP-001: the ecosystem platform registry controls SDK app config —
// LLM routing, rate limits, allowed agents, activation/suspension. Mutations
// were mounted with NO auth (any caller could register/suspend/delete a
// platform or rewrite its LLM caps). Gate every write with auth + super_admin;
// the GET list/detail/usage reads stay open (already self-heal to 200).
const adminOnly = [authenticateToken, requireRole('super_admin')];

// ─── Validation Schemas ───────────────────────────────────────────────────────

const PlatformTypeEnum = z.enum([
  'nyayamitra',
  'nyayasiddhi-professional',
  'nsp-mobile',
  'nyayasiddhi-institution',
  'nyayasiddhi-ministry',
  'nyayasiddhi-academy',
  'custom',
]);

const ModulesSchema = z.object({
  clawdbot: z.boolean().optional(),
  openbot: z.boolean().optional(),
  automateai: z.boolean().optional(),
  twindesk: z.boolean().optional(),
  skillshop: z.boolean().optional(),
  nyayarag: z.boolean().optional(),
  doc_intelligence: z.boolean().optional(),
  voice_ai: z.boolean().optional(),
  hitl: z.boolean().optional(),
  sdk_intelligence: z.boolean().optional(),
});

const LlmConfigSchema = z.object({
  primary: z.string(),
  fallback: z.string(),
  budget_mode: z.enum(['minimal', 'balanced', 'premium']),
  monthly_cap_usd: z.number().positive(),
  alert_threshold_pct: z.number().min(1).max(100),
});

const RateLimitsSchema = z.object({
  requests_per_min: z.number().int().positive(),
  requests_per_hour: z.number().int().positive(),
  requests_per_day: z.number().int().positive(),
  tokens_per_day: z.number().int().positive(),
  max_concurrent: z.number().int().positive(),
});

const CreatePlatformSchema = z.object({
  name: z.string().min(2).max(255),
  display_name: z.string().min(2).max(255).optional(),
  platform_type: PlatformTypeEnum.optional().default('custom'),
  description: z.string().optional(),
  tier: z.string().optional().default('pro'),
  jurisdiction: z.string().optional().default('IN'),
  jurisdictions: z.array(z.string()).optional().default(['IN']),
  contact_email: z.string().email().optional(),
  environment: z.enum(['sandbox', 'production']).optional().default('sandbox'),
  modules_enabled: ModulesSchema.optional(),
  agents_allowed: z.array(z.string()).optional().default(['*']),
  llm_config: LlmConfigSchema.optional(),
  rate_limits_config: RateLimitsSchema.optional(),
});

// ─── Schema self-heal + ecosystem seed (NYV-PLATFORMS-500) ─────────────────────

let _ensured = false;
let _appCols: Set<string> | null = null;

async function getAppColumns(force = false): Promise<Set<string>> {
  if (_appCols && !force) return _appCols;
  const r = await db!.execute(sql`
    SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'nv_sdk_applications'`);
  _appCols = new Set(extractRows<{ column_name: string }>(r).map((x) => String(x.column_name)));
  return _appCols;
}

const ECOSYSTEM_SEED: Array<{
  name: string; display_name: string; platform_type: string; tier: string;
  jurisdiction: string; jurisdictions: string[]; environment: string;
  modules_enabled: Record<string, boolean>;
}> = [
  {
    name: 'Nyayamitra', display_name: 'Nyayamitra (Citizen Legal Aid)',
    platform_type: 'nyayamitra', tier: 'pro', jurisdiction: 'IN', jurisdictions: ['IN'],
    environment: 'production',
    modules_enabled: { clawdbot: true, openbot: false, automateai: false, twindesk: false, skillshop: false, nyayarag: true, doc_intelligence: true, voice_ai: true, hitl: true, sdk_intelligence: false },
  },
  {
    name: 'Jurexio Professional', display_name: 'Jurexio Professional (Practice Mgmt)',
    platform_type: 'nyayasiddhi-professional', tier: 'pro', jurisdiction: 'IN', jurisdictions: ['IN', 'UK', 'US', 'EU', 'GC', 'SG'],
    environment: 'production',
    modules_enabled: { clawdbot: false, openbot: false, automateai: true, twindesk: true, skillshop: true, nyayarag: true, doc_intelligence: true, voice_ai: true, hitl: true, sdk_intelligence: true },
  },
  {
    name: 'Jurexio Institutional', display_name: 'Jurexio Institutional (Enterprise GC)',
    platform_type: 'nyayasiddhi-institution', tier: 'enterprise', jurisdiction: 'IN', jurisdictions: ['IN', 'UK', 'US', 'EU', 'GC', 'SG'],
    environment: 'production',
    modules_enabled: { clawdbot: true, openbot: true, automateai: true, twindesk: true, skillshop: true, nyayarag: true, doc_intelligence: true, voice_ai: true, hitl: true, sdk_intelligence: true },
  },
  {
    name: 'Jurexio Academy', display_name: 'Jurexio Academy (Education)',
    platform_type: 'nyayasiddhi-academy', tier: 'plus', jurisdiction: 'IN', jurisdictions: ['IN', 'UK', 'US', 'EU', 'GC', 'SG'],
    environment: 'production',
    modules_enabled: { clawdbot: false, openbot: false, automateai: false, twindesk: false, skillshop: true, nyayarag: true, doc_intelligence: true, voice_ai: false, hitl: false, sdk_intelligence: false },
  },
  {
    name: 'Jurexio Ministry', display_name: 'Jurexio Ministry (Sovereign / Regulator)',
    platform_type: 'nyayasiddhi-ministry', tier: 'government', jurisdiction: 'IN', jurisdictions: ['IN'],
    environment: 'production',
    modules_enabled: { clawdbot: false, openbot: false, automateai: true, twindesk: false, skillshop: false, nyayarag: true, doc_intelligence: true, voice_ai: true, hitl: true, sdk_intelligence: true },
  },
];

/**
 * Idempotent, best-effort schema self-heal + ecosystem seed. Runs once per
 * process (cached). Never throws — on failure the list endpoint still degrades
 * to a 200 empty list. All DDL is non-destructive (IF NOT EXISTS) and the base
 * PK type (VARCHAR(36)) is preserved.
 */
async function ensureSchemaAndSeed(): Promise<void> {
  if (_ensured || !db) return;
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS nv_sdk_applications (
        id              VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid()::text,
        name            VARCHAR(255) NOT NULL,
        app_type        VARCHAR(100) NOT NULL DEFAULT 'platform',
        jurisdiction    VARCHAR(10) NOT NULL DEFAULT 'IN',
        tier            VARCHAR(50) NOT NULL DEFAULT 'pro',
        is_active       BOOLEAN NOT NULL DEFAULT TRUE,
        settings        JSONB DEFAULT '{}',
        created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
      )`);

    const addColumns = [
      sql`ALTER TABLE nv_sdk_applications ADD COLUMN IF NOT EXISTS platform_type VARCHAR(60) DEFAULT 'custom'`,
      sql`ALTER TABLE nv_sdk_applications ADD COLUMN IF NOT EXISTS display_name VARCHAR(255)`,
      sql`ALTER TABLE nv_sdk_applications ADD COLUMN IF NOT EXISTS jurisdictions TEXT[] DEFAULT ARRAY['IN']`,
      sql`ALTER TABLE nv_sdk_applications ADD COLUMN IF NOT EXISTS environment VARCHAR(20) NOT NULL DEFAULT 'sandbox'`,
      sql`ALTER TABLE nv_sdk_applications ADD COLUMN IF NOT EXISTS contact_email VARCHAR(255)`,
      sql`ALTER TABLE nv_sdk_applications ADD COLUMN IF NOT EXISTS modules_enabled JSONB DEFAULT '{}'::jsonb`,
      sql`ALTER TABLE nv_sdk_applications ADD COLUMN IF NOT EXISTS agents_allowed TEXT[] DEFAULT ARRAY['*']`,
      sql`ALTER TABLE nv_sdk_applications ADD COLUMN IF NOT EXISTS llm_config JSONB DEFAULT '{}'::jsonb`,
      sql`ALTER TABLE nv_sdk_applications ADD COLUMN IF NOT EXISTS rate_limits_config JSONB DEFAULT '{}'::jsonb`,
      sql`ALTER TABLE nv_sdk_applications ADD COLUMN IF NOT EXISTS is_provisioned BOOLEAN NOT NULL DEFAULT FALSE`,
      sql`ALTER TABLE nv_sdk_applications ADD COLUMN IF NOT EXISTS key_expires_at TIMESTAMP`,
      sql`ALTER TABLE nv_sdk_applications ADD COLUMN IF NOT EXISTS org_id INTEGER DEFAULT 1`,
      sql`ALTER TABLE nv_sdk_applications ADD COLUMN IF NOT EXISTS owner_id INTEGER`,
    ];
    for (const stmt of addColumns) {
      await db.execute(stmt).catch((e: unknown) =>
        logger.warn('ensure column degraded', { error: e instanceof Error ? e.message : String(e) }),
      );
    }
    _appCols = null; // bust cache after DDL

    // Seed the ecosystem platforms only if none are registered yet (idempotent
    // per-name). Keeps the registry the canonical hub even on a fresh RDS.
    const cols = await getAppColumns();
    if (cols.has('platform_type')) {
      const ecoCountR = await db.execute(sql`
        SELECT COUNT(*)::int AS c FROM nv_sdk_applications
         WHERE platform_type IS NOT NULL AND platform_type <> 'custom'`);
      const ecoCount = Number(extractRows<{ c: number }>(ecoCountR)[0]?.c ?? 0);
      if (ecoCount === 0) {
        for (const p of ECOSYSTEM_SEED) {
          await db.execute(sql`
            INSERT INTO nv_sdk_applications (
              name, display_name, app_type, platform_type, jurisdiction, jurisdictions,
              tier, is_active, environment, modules_enabled, agents_allowed,
              is_provisioned, settings, created_at, updated_at
            )
            SELECT ${p.name}, ${p.display_name}, 'platform', ${p.platform_type},
                   ${p.jurisdiction}, ${p.jurisdictions}::text[], ${p.tier}, true,
                   ${p.environment}, ${JSON.stringify(p.modules_enabled)}::jsonb,
                   ARRAY['*']::text[], false, '{}'::jsonb, NOW(), NOW()
            WHERE NOT EXISTS (SELECT 1 FROM nv_sdk_applications WHERE name = ${p.name})
          `).catch((e: unknown) =>
            logger.warn('ecosystem seed row degraded', { name: p.name, error: e instanceof Error ? e.message : String(e) }),
          );
        }
        logger.info('Ecosystem platforms seeded', { count: ECOSYSTEM_SEED.length });
      }
    }
    _ensured = true;
  } catch (err: unknown) {
    logger.warn('ensureSchemaAndSeed degraded (will retry next request)', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatPlatform(row: Record<string, unknown>) {
  return {
    id: row.id,
    name: row.name,
    display_name: row.display_name || row.name,
    platform_type: row.platform_type || 'custom',
    description: row.description || '',
    tier: row.tier,
    jurisdiction: row.jurisdiction,
    jurisdictions: row.jurisdictions || ['IN'],
    status: row.is_active ? 'active' : 'inactive',
    is_active: row.is_active,
    is_provisioned: row.is_provisioned || false,
    environment: row.environment || 'sandbox',
    contact_email: row.contact_email || null,
    modules_enabled: row.modules_enabled || {},
    agents_allowed: row.agents_allowed || ['*'],
    llm_config: row.llm_config || {},
    rate_limits_config: row.rate_limits_config || {},
    settings: row.settings || {},
    org_id: row.org_id,
    owner_id: row.owner_id,
    key_expires_at: row.key_expires_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// ─── GET /api/jrx/platforms ───────────────────────────────────────────────────

router.get('/', async (req: Request, res: Response) => {
  if (!db) { res.json({ platforms: [], total: 0, limit: 50, offset: 0, degraded: true }); return; }
  try {
    await ensureSchemaAndSeed();
    const { platform_type, environment, is_active, limit = '50', offset = '0' } = req.query as Record<string, string>;
    const lim = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 500);
    const off = Math.max(parseInt(offset, 10) || 0, 0);

    const where: ReturnType<typeof sql>[] = [];
    if (platform_type) where.push(sql`platform_type = ${platform_type}`);
    if (environment) where.push(sql`environment = ${environment}`);
    if (is_active !== undefined) where.push(sql`is_active = ${is_active === 'true'}`);
    const whereClause = where.length
      ? sql`WHERE ${sql.join(where, sql` AND `)}`
      : sql``;

    const result = await db.execute(sql`
      SELECT * FROM nv_sdk_applications
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT ${lim} OFFSET ${off}
    `);
    const rows = extractRows<Record<string, unknown>>(result);

    const countResult = await db.execute(sql`SELECT COUNT(*)::int AS total FROM nv_sdk_applications`);
    const total = Number(extractRows<{ total: number }>(countResult)[0]?.total ?? rows.length);

    res.json({
      platforms: rows.map(formatPlatform),
      total,
      limit: lim,
      offset: off,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('GET /platforms degraded to empty', { error: msg });
    // Degrade to 200 (empty) so the console renders an empty-state, never a 500.
    res.json({ platforms: [], total: 0, limit: 50, offset: 0, degraded: true });
  }
});

// ─── GET /api/jrx/platforms/:id ───────────────────────────────────────────────

router.get('/:id', async (req: Request, res: Response) => {
  if (!db) { res.status(500).json({ error: 'Database not available' }); return; }
  try {
    await ensureSchemaAndSeed();
    const { id } = req.params;
    const result = await db.execute(sql`SELECT * FROM nv_sdk_applications WHERE id = ${id}`);
    const rows = extractRows<Record<string, unknown>>(result);
    if (!rows.length) {
      res.status(404).json({ error: 'NYV-PLAT-404: Platform not found', id });
      return;
    }
    const keyResult = await db.execute(sql`
      SELECT COUNT(*)::int as count FROM nv_api_keys
      WHERE app_id = ${id} AND is_active = true
    `).catch(() => ({ rows: [{ count: 0 }] }));
    const usageResult = await db.execute(sql`
      SELECT
        COUNT(*)::int as request_count,
        COALESCE(SUM(tokens_in + tokens_out), 0) as total_tokens,
        COALESCE(SUM(cost_usd), 0) as total_cost_usd
      FROM nv_sdk_usage_metrics
      WHERE app_id = ${id}
        AND recorded_at > NOW() - INTERVAL '30 days'
    `).catch(() => ({ rows: [{ request_count: 0, total_tokens: 0, total_cost_usd: 0 }] }));

    const platform = formatPlatform(rows[0]);
    const usage = extractRows<Record<string, unknown>>(usageResult)[0] || {};
    res.json({
      ...platform,
      active_key_count: Number(extractRows<{ count: number }>(keyResult)[0]?.count ?? 0),
      usage_30d: {
        request_count: parseInt(String(usage.request_count ?? 0), 10),
        total_tokens: parseInt(String(usage.total_tokens ?? 0), 10),
        total_cost_usd: parseFloat(String(usage.total_cost_usd ?? 0)),
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('GET /platforms/:id error', { error: msg });
    res.status(500).json({ error: 'NYV-PLAT-002: Failed to get platform', detail: msg });
  }
});

// ─── POST /api/jrx/platforms ──────────────────────────────────────────────────

router.post('/', adminOnly, async (req: Request, res: Response) => {
  if (!db) { res.status(500).json({ error: 'Database not available' }); return; }
  try {
    const parsed = CreatePlatformSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'NYV-PLAT-VAL-001: Validation failed', details: parsed.error.flatten() });
      return;
    }
    await ensureSchemaAndSeed();
    const d = parsed.data;

    const defaultModules = {
      clawdbot: false, openbot: false, automateai: false, twindesk: false,
      skillshop: false, nyayarag: true, doc_intelligence: true,
      voice_ai: false, hitl: false, sdk_intelligence: true,
    };
    const defaultLlm = {
      primary: 'claude-sonnet-4-5', fallback: 'gpt-4.1',
      budget_mode: 'balanced', monthly_cap_usd: 1000, alert_threshold_pct: 80,
    };
    const defaultRateLimits = {
      requests_per_min: 60, requests_per_hour: 2000,
      requests_per_day: 20000, tokens_per_day: 5000000, max_concurrent: 20,
    };

    const modules = JSON.stringify({ ...defaultModules, ...(d.modules_enabled ?? {}) });
    const llmCfg = JSON.stringify(d.llm_config ?? defaultLlm);
    const rateCfg = JSON.stringify(d.rate_limits_config ?? defaultRateLimits);
    const agentsAllowed = d.agents_allowed ?? ['*'];
    const jurisdictions = d.jurisdictions ?? ['IN'];

    const result = await db.execute(sql`
      INSERT INTO nv_sdk_applications (
        name, display_name, app_type, platform_type, jurisdiction, jurisdictions,
        tier, is_active, environment, contact_email,
        modules_enabled, agents_allowed, llm_config, rate_limits_config,
        is_provisioned, settings, created_at, updated_at
      ) VALUES (
        ${d.name}, ${d.display_name ?? d.name}, 'platform', ${d.platform_type},
        ${d.jurisdiction}, ${jurisdictions}::text[],
        ${d.tier}, true, ${d.environment},
        ${d.contact_email ?? null},
        ${modules}::jsonb, ${agentsAllowed}::text[],
        ${llmCfg}::jsonb, ${rateCfg}::jsonb,
        false,
        ${JSON.stringify({ description: d.description ?? '' })}::jsonb,
        NOW(), NOW()
      )
      RETURNING *
    `);
    const rows = extractRows<Record<string, unknown>>(result);
    logger.info('Platform registered', { id: rows[0]?.id, name: d.name, platform_type: d.platform_type });
    res.status(201).json(formatPlatform(rows[0] ?? {}));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('POST /platforms error', { error: msg });
    res.status(500).json({ error: 'NYV-PLAT-003: Failed to create platform', detail: msg });
  }
});

// ─── PUT /api/jrx/platforms/:id ───────────────────────────────────────────────

router.put('/:id', adminOnly, async (req: Request, res: Response) => {
  if (!db) { res.status(500).json({ error: 'Database not available' }); return; }
  try {
    const { id } = req.params;
    const { name, display_name, tier, jurisdiction, contact_email, environment } = req.body;

    const result = await db.execute(sql`
      UPDATE nv_sdk_applications
      SET
        name = COALESCE(${name ?? null}, name),
        display_name = COALESCE(${display_name ?? null}, display_name),
        tier = COALESCE(${tier ?? null}, tier),
        jurisdiction = COALESCE(${jurisdiction ?? null}, jurisdiction),
        contact_email = COALESCE(${contact_email ?? null}, contact_email),
        environment = COALESCE(${environment ?? null}, environment),
        updated_at = NOW()
      WHERE id = ${id}
      RETURNING *
    `);
    const rows = extractRows<Record<string, unknown>>(result);
    if (!rows.length) { res.status(404).json({ error: 'NYV-PLAT-404: Platform not found' }); return; }
    res.json(formatPlatform(rows[0]));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('PUT /platforms/:id error', { error: msg });
    res.status(500).json({ error: 'NYV-PLAT-004: Failed to update platform', detail: msg });
  }
});

// ─── PATCH /api/jrx/platforms/:id/status ─────────────────────────────────────

router.patch('/:id/status', adminOnly, async (req: Request, res: Response) => {
  if (!db) { res.status(500).json({ error: 'Database not available' }); return; }
  try {
    const { id } = req.params;
    const schema = z.object({ is_active: z.boolean() });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: 'NYV-PLAT-VAL-002: is_active boolean required' }); return; }

    const result = await db.execute(sql`
      UPDATE nv_sdk_applications
      SET is_active = ${parsed.data.is_active}, updated_at = NOW()
      WHERE id = ${id}
      RETURNING id, name, is_active, updated_at
    `);
    const rows = extractRows<Record<string, unknown>>(result);
    if (!rows.length) { res.status(404).json({ error: 'NYV-PLAT-404: Platform not found' }); return; }
    logger.info('Platform status updated', { id, is_active: parsed.data.is_active });
    res.json(rows[0]);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: 'NYV-PLAT-005: Failed to update status', detail: msg });
  }
});

// ─── PATCH /api/jrx/platforms/:id/modules ────────────────────────────────────

router.patch('/:id/modules', adminOnly, async (req: Request, res: Response) => {
  if (!db) { res.status(500).json({ error: 'Database not available' }); return; }
  try {
    const { id } = req.params;
    const parsed = ModulesSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: 'NYV-PLAT-VAL-003: Invalid modules payload' }); return; }

    const result = await db.execute(sql`
      UPDATE nv_sdk_applications
      SET modules_enabled = COALESCE(modules_enabled, '{}'::jsonb) || ${JSON.stringify(parsed.data)}::jsonb,
          updated_at = NOW()
      WHERE id = ${id}
      RETURNING id, name, modules_enabled
    `);
    const rows = extractRows<Record<string, unknown>>(result);
    if (!rows.length) { res.status(404).json({ error: 'NYV-PLAT-404: Platform not found' }); return; }
    logger.info('Platform modules updated', { id, modules: parsed.data });
    res.json(rows[0]);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: 'NYV-PLAT-006: Failed to update modules', detail: msg });
  }
});

// ─── PATCH /api/jrx/platforms/:id/llm-config ─────────────────────────────────

router.patch('/:id/llm-config', adminOnly, async (req: Request, res: Response) => {
  if (!db) { res.status(500).json({ error: 'Database not available' }); return; }
  try {
    const { id } = req.params;
    const parsed = LlmConfigSchema.partial().safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: 'NYV-PLAT-VAL-004: Invalid LLM config' }); return; }

    const result = await db.execute(sql`
      UPDATE nv_sdk_applications
      SET llm_config = COALESCE(llm_config, '{}'::jsonb) || ${JSON.stringify(parsed.data)}::jsonb,
          updated_at = NOW()
      WHERE id = ${id}
      RETURNING id, name, llm_config
    `);
    const rows = extractRows<Record<string, unknown>>(result);
    if (!rows.length) { res.status(404).json({ error: 'NYV-PLAT-404: Platform not found' }); return; }
    res.json(rows[0]);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: 'NYV-PLAT-007: Failed to update LLM config', detail: msg });
  }
});

// ─── PATCH /api/jrx/platforms/:id/rate-limits ────────────────────────────────

router.patch('/:id/rate-limits', adminOnly, async (req: Request, res: Response) => {
  if (!db) { res.status(500).json({ error: 'Database not available' }); return; }
  try {
    const { id } = req.params;
    const parsed = RateLimitsSchema.partial().safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: 'NYV-PLAT-VAL-005: Invalid rate limits' }); return; }

    const result = await db.execute(sql`
      UPDATE nv_sdk_applications
      SET rate_limits_config = COALESCE(rate_limits_config, '{}'::jsonb) || ${JSON.stringify(parsed.data)}::jsonb,
          updated_at = NOW()
      WHERE id = ${id}
      RETURNING id, name, rate_limits_config
    `);
    const rows = extractRows<Record<string, unknown>>(result);
    if (!rows.length) { res.status(404).json({ error: 'NYV-PLAT-404: Platform not found' }); return; }
    res.json(rows[0]);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: 'NYV-PLAT-008: Failed to update rate limits', detail: msg });
  }
});

// ─── PATCH /api/jrx/platforms/:id/agents ─────────────────────────────────────

router.patch('/:id/agents', adminOnly, async (req: Request, res: Response) => {
  if (!db) { res.status(500).json({ error: 'Database not available' }); return; }
  try {
    const { id } = req.params;
    const schema = z.object({ agents_allowed: z.array(z.string()) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: 'NYV-PLAT-VAL-006: agents_allowed array required' }); return; }

    const result = await db.execute(sql`
      UPDATE nv_sdk_applications
      SET agents_allowed = ${parsed.data.agents_allowed}::text[],
          updated_at = NOW()
      WHERE id = ${id}
      RETURNING id, name, agents_allowed
    `);
    const rows = extractRows<Record<string, unknown>>(result);
    if (!rows.length) { res.status(404).json({ error: 'NYV-PLAT-404: Platform not found' }); return; }
    res.json(rows[0]);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: 'NYV-PLAT-009: Failed to update agents', detail: msg });
  }
});

// ─── GET /api/jrx/platforms/:id/usage ────────────────────────────────────────

router.get('/:id/usage', async (req: Request, res: Response) => {
  if (!db) { res.status(500).json({ error: 'Database not available' }); return; }
  try {
    const { id } = req.params;
    const { days = '30' } = req.query as Record<string, string>;
    const daysInt = Math.min(parseInt(days, 10) || 30, 365);

    const dailyResult = await db.execute(sql`
      SELECT
        DATE_TRUNC('day', recorded_at) as day,
        COUNT(*)::int as requests,
        COALESCE(SUM(tokens_in), 0) as tokens_in,
        COALESCE(SUM(tokens_out), 0) as tokens_out,
        COALESCE(SUM(cost_usd), 0) as cost_usd,
        AVG(latency_ms) as avg_latency_ms
      FROM nv_sdk_usage_metrics
      WHERE app_id = ${id}
        AND recorded_at > NOW() - (${daysInt} || ' days')::interval
      GROUP BY day
      ORDER BY day DESC
    `).catch(() => ({ rows: [] }));

    const totalsResult = await db.execute(sql`
      SELECT
        COUNT(*)::int as total_requests,
        COALESCE(SUM(tokens_in + tokens_out), 0) as total_tokens,
        COALESCE(SUM(cost_usd), 0) as total_cost_usd,
        AVG(latency_ms) as avg_latency_ms,
        COUNT(DISTINCT DATE_TRUNC('day', recorded_at))::int as active_days
      FROM nv_sdk_usage_metrics
      WHERE app_id = ${id}
        AND recorded_at > NOW() - (${daysInt} || ' days')::interval
    `).catch(() => ({ rows: [{}] }));

    const t = extractRows<Record<string, unknown>>(totalsResult)[0] || {};
    res.json({
      platform_id: id,
      period_days: daysInt,
      summary: {
        total_requests: parseInt(String(t.total_requests ?? 0), 10),
        total_tokens: parseInt(String(t.total_tokens ?? 0), 10),
        total_cost_usd: parseFloat(String(t.total_cost_usd ?? 0)).toFixed(4),
        avg_latency_ms: parseFloat(String(t.avg_latency_ms ?? 0)).toFixed(1),
        active_days: parseInt(String(t.active_days ?? 0), 10),
      },
      daily: extractRows(dailyResult),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: 'NYV-PLAT-010: Failed to get usage', detail: msg });
  }
});

// ─── DELETE /api/jrx/platforms/:id ───────────────────────────────────────────

router.delete('/:id', adminOnly, async (req: Request, res: Response) => {
  if (!db) { res.status(500).json({ error: 'Database not available' }); return; }
  try {
    const { id } = req.params;
    const result = await db.execute(sql`
      UPDATE nv_sdk_applications
      SET is_active = false, updated_at = NOW()
      WHERE id = ${id}
      RETURNING id, name, is_active
    `);
    const rows = extractRows<Record<string, unknown>>(result);
    if (!rows.length) { res.status(404).json({ error: 'NYV-PLAT-404: Platform not found' }); return; }
    logger.info('Platform deactivated', { id });
    res.json({ message: 'Platform deactivated', platform: rows[0] });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: 'NYV-PLAT-011: Failed to deactivate platform', detail: msg });
  }
});

export default router;
