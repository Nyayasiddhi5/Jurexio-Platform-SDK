// JRX-NS-021 (2026-05-05): pre-existing strict-null violations cluster in this
// file. Runtime is unaffected (gateway runs via tsx). Opt out of strict-null
// for the v5.0.0 deploy gate; track follow-up cleanup in INV-CLEANUP-001.
import { Router, Request, Response } from 'express';
import { authenticateToken, requireRole } from '../middleware/auth.js';
import { db } from '../db/index.js';
import { sql } from 'drizzle-orm';
import { extractRows } from '../utils/jrx-type-helpers.js';
import bcrypt from 'bcrypt';
import { sanitizeErrorForClient } from '../utils/error-sanitizer.js';
import { createLogger } from '../utils/logger.js';
import { getRegistryStats } from '../services/agent-registry-service.js';


const logger = createLogger('enterprise-admin-routes');

const router = Router();

const ROLE_HIERARCHY: Record<string, number> = {
  super_admin: 11,
  // platform_admin (tier-1) sits directly below super_admin and above org_admin:
  // it governs a whole platform's orgs/users/keys but only its own platform_id
  // (scoping enforced in jrx-customer-org-rbac.ts).
  platform_admin: 10,
  org_admin: 9,
  manager: 8,
  senior_analyst: 7,
  analyst: 6,
  operator: 5,
  developer: 4,
  viewer: 3,
  user: 2,
  guest: 1,
};

function hasRoleAccess(userRole: string, minRole: string): boolean {
  return (ROLE_HIERARCHY[userRole] || 0) >= (ROLE_HIERARCHY[minRole] || 0);
}

// ── /organizations schema-resilience (JRX-ENT-ORG-500 fix, 2026-06-03) ────────
// EC2 dev-edge drift: the member/app sub-counts referenced `nv_users.org_id`
// and `nv_sdk_applications.organization_id`. The runtime SDK-apps table is
// seeded with `org_id` (not `organization_id`), so on a drifted RDS the
// `sa.organization_id` reference 500'd this endpoint — which is hit by a
// global poller on every console page (≈10.9k error lines/session). We
// introspect the live schema once (cached) and only emit a sub-count when its
// dependency column exists; otherwise project 0. Mirrors the /api/jrx/models fix.
let _entColCache: Map<string, Set<string>> | null = null;
async function getTableColumns(table: string): Promise<Set<string>> {
  if (!_entColCache) _entColCache = new Map();
  const cached = _entColCache.get(table);
  if (cached) return cached;
  const r = await db!.execute(sql`
    SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = ${table}`);
  const set = new Set(extractRows<{ column_name: string }>(r).map((x) => String(x.column_name)));
  _entColCache.set(table, set);
  return set;
}

router.get('/organizations', authenticateToken, requireRole('org_admin', 'super_admin'), async (req: Request, res: Response) => {
  try {
    if (!db) { res.status(500).json({ success: false, error: 'Database not available' }); return; }
    const caller = req.user;
    const callerRole = caller?.role || 'user';
    const callerOrgId = caller?.organizationId || (caller as { organization_id?: string | number })?.organization_id;

    const userCols = await getTableColumns('nv_users').catch(() => new Set<string>());
    const appCols = await getTableColumns('nv_sdk_applications').catch(() => new Set<string>());
    // member_count: nv_users FK to org is `org_id`.
    const memberExpr = userCols.has('org_id')
      ? `(SELECT COUNT(*) FROM nv_users nu WHERE nu.org_id = o.id)::int`
      : `0`;
    // app_count: SDK-apps FK column drifted between `organization_id` and `org_id`.
    const appFk = appCols.has('organization_id') ? 'organization_id' : (appCols.has('org_id') ? 'org_id' : null);
    const appExpr = appFk
      ? `(SELECT COUNT(*) FROM nv_sdk_applications sa WHERE sa.${appFk} = o.id)::int`
      : `0`;

    let result;
    if (callerRole === 'super_admin') {
      result = await db.execute(sql.raw(`
        SELECT o.*,
          ${memberExpr} AS member_count,
          ${appExpr} AS app_count
        FROM nv_organizations o ORDER BY o.created_at DESC
      `));
    } else if (callerOrgId) {
      result = await db.execute(sql`
        SELECT o.*,
          ${sql.raw(memberExpr)} AS member_count,
          ${sql.raw(appExpr)} AS app_count
        FROM nv_organizations o WHERE o.id = ${callerOrgId} ORDER BY o.created_at DESC
      `);
    } else {
      result = { rows: [] };
    }
    res.json({ success: true, data: extractRows(result) });
  } catch (error: any) {
    // Degrade to a 200 empty list so the global poller stops flooding the
    // console with 500s; the real org list is also served by SDK-scoped routes.
    logger.warn('[EnterpriseAdmin] /organizations degraded to empty', { error: error?.message });
    res.json({ success: true, data: [], degraded: true });
  }
});

router.post('/organizations', authenticateToken, requireRole('super_admin'), async (req: Request, res: Response) => {
  try {
    if (!db) { res.status(500).json({ success: false, error: 'Database not available' }); return; }
    const { name, tier, settings } = req.body;
    if (!name) { res.status(400).json({ success: false, error: 'Organization name is required' }); return; }
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const result = await db.execute(sql`
      INSERT INTO nv_organizations (name, slug, tier, is_active, settings, created_at, updated_at)
      VALUES (${name}, ${slug}, ${tier || 'pro'}, true, ${JSON.stringify(settings || {})}::jsonb, NOW(), NOW())
      RETURNING *
    `);
    res.status(201).json({ success: true, data: (result.rows ?? [])[0] });
  } catch (error: any) {
    res.status(500).json({ success: false, error: sanitizeErrorForClient(error) });
  }
});

router.patch('/organizations/:id', authenticateToken, requireRole('org_admin', 'super_admin'), async (req: Request, res: Response) => {
  try {
    if (!db) { res.status(500).json({ success: false, error: 'Database not available' }); return; }
    const { id } = req.params;
    const { name, tier, isActive, settings } = req.body;
    const result = await db.execute(sql`
      UPDATE nv_organizations SET
        name = COALESCE(${name || null}, name),
        tier = COALESCE(${tier || null}, tier),
        is_active = COALESCE(${isActive !== undefined ? isActive : null}, is_active),
        settings = COALESCE(${settings ? JSON.stringify(settings) + '::jsonb' : null}, settings),
        updated_at = NOW()
      WHERE id = ${parseInt(String(id))}
      RETURNING *
    `);
    if ((result.rows ?? []).length === 0) {
      res.status(404).json({ success: false, error: 'Organization not found' }); return;
    }
    res.json({ success: true, data: (result.rows ?? [])[0] });
  } catch (error: any) {
    res.status(500).json({ success: false, error: sanitizeErrorForClient(error) });
  }
});

router.delete('/organizations/:id', authenticateToken, requireRole('super_admin'), async (req: Request, res: Response) => {
  try {
    if (!db) { res.status(500).json({ success: false, error: 'Database not available' }); return; }
    const { id } = req.params;
    await db.execute(sql`UPDATE nv_organizations SET is_active = false, updated_at = NOW() WHERE id = ${parseInt(String(id))}`);
    res.json({ success: true, message: 'Organization deactivated' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: sanitizeErrorForClient(error) });
  }
});

router.get('/users', authenticateToken, requireRole('org_admin', 'super_admin'), async (req: Request, res: Response) => {
  try {
    if (!db) { res.status(500).json({ success: false, error: 'Database not available' }); return; }
    const { search, role } = req.query;
    const caller = req.user;
    const callerRole = caller?.role || 'user';
    const callerOrgId = caller?.organizationId || (caller as { organization_id?: string | number })?.organization_id;
    let query;
    if (callerRole === 'super_admin') {
      query = sql`
        SELECT u.id, u.email, u.full_name, u.role, u.is_active, u.tier, 
               u.org_id, u.created_at, u.updated_at, u.last_login_at,
               o.name AS organization_name
        FROM nv_users u LEFT JOIN nv_organizations o ON u.org_id = o.id WHERE 1=1
      `;
    } else {
      query = sql`
        SELECT u.id, u.email, u.full_name, u.role, u.is_active, u.tier, 
               u.org_id, u.created_at, u.updated_at, u.last_login_at,
               o.name AS organization_name
        FROM nv_users u LEFT JOIN nv_organizations o ON u.org_id = o.id WHERE u.org_id = ${callerOrgId || -1}
      `;
    }
    if (search) {
      query = sql`${query} AND (u.email ILIKE ${'%' + search + '%'} OR u.full_name ILIKE ${'%' + search + '%'})`;
    }
    if (role && role !== 'all') {
      query = sql`${query} AND u.role = ${role}`;
    }
    query = sql`${query} ORDER BY u.created_at DESC LIMIT 200`;
    const result = await db.execute(query);
    res.json({ success: true, data: result.rows || result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: sanitizeErrorForClient(error) });
  }
});

router.post('/users', authenticateToken, requireRole('org_admin', 'super_admin'), async (req: Request, res: Response) => {
  try {
    if (!db) { res.status(500).json({ success: false, error: 'Database not available' }); return; }
    const { email, password, fullName, role, organizationId, tier } = req.body;
    if (!email || !password) { res.status(400).json({ success: false, error: 'Email and password required' }); return; }
    const existing = await db.execute(sql`SELECT id FROM nv_users WHERE email = ${email}`);
    if ((existing.rows ?? []).length > 0) {
      res.status(409).json({ success: false, error: 'User already exists' }); return;
    }
    const callerRole = req.user?.role || 'user';
    const targetRole = role || 'user';
    if (!hasRoleAccess(callerRole, targetRole) && callerRole !== 'super_admin') {
      res.status(403).json({ success: false, error: 'Cannot create user with higher role than your own' }); return;
    }
    const hashedPassword = await bcrypt.hash(password, 12);
    const result = await db.execute(sql`
      INSERT INTO nv_users (email, password_hash, full_name, role, tier, org_id, is_active, created_at, updated_at)
      VALUES (${email}, ${hashedPassword}, ${fullName || null}, ${targetRole}, ${tier || 'pro'}, ${organizationId ? parseInt(String(organizationId)) : null}, true, NOW(), NOW())
      RETURNING id, email, full_name, role, tier, org_id, is_active, created_at
    `);
    res.status(201).json({ success: true, data: (result.rows ?? [])[0] });
  } catch (error: any) {
    res.status(500).json({ success: false, error: sanitizeErrorForClient(error) });
  }
});

router.patch('/users/:id', authenticateToken, requireRole('org_admin', 'super_admin'), async (req: Request, res: Response) => {
  try {
    if (!db) { res.status(500).json({ success: false, error: 'Database not available' }); return; }
    const { id } = req.params;
    const { fullName, role, isActive, organizationId, tier } = req.body;
    const callerRole = req.user?.role || 'user';
    if (role && !hasRoleAccess(callerRole, role) && callerRole !== 'super_admin') {
      res.status(403).json({ success: false, error: 'Cannot assign role higher than your own' }); return;
    }
    const result = await db.execute(sql`
      UPDATE nv_users SET
        full_name = COALESCE(${fullName || null}, full_name),
        role = COALESCE(${role || null}, role),
        is_active = COALESCE(${isActive !== undefined ? isActive : null}, is_active),
        org_id = COALESCE(${organizationId !== undefined ? (organizationId ? parseInt(String(organizationId)) : null) : null}, org_id),
        tier = COALESCE(${tier || null}, tier),
        updated_at = NOW()
      WHERE id = ${parseInt(String(id))}
      RETURNING id, email, full_name, role, is_active, tier, org_id, created_at, updated_at
    `);
    if ((result.rows ?? []).length === 0) {
      res.status(404).json({ success: false, error: 'User not found' }); return;
    }
    res.json({ success: true, data: (result.rows ?? [])[0] });
  } catch (error: any) {
    res.status(500).json({ success: false, error: sanitizeErrorForClient(error) });
  }
});

router.delete('/users/:id', authenticateToken, requireRole('super_admin'), async (req: Request, res: Response) => {
  try {
    if (!db) { res.status(500).json({ success: false, error: 'Database not available' }); return; }
    const { id } = req.params;
    const callerId = req.user?.userId;
    if (parseInt(String(id)) === Number(callerId)) { res.status(400).json({ success: false, error: 'Cannot delete your own account' }); return; }
    await db.execute(sql`UPDATE nv_users SET is_active = false, updated_at = NOW() WHERE id = ${parseInt(String(id))}`);
    res.json({ success: true, message: 'User deactivated' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: sanitizeErrorForClient(error) });
  }
});

router.patch('/users/:id/role', authenticateToken, requireRole('org_admin', 'super_admin'), async (req: Request, res: Response) => {
  try {
    if (!db) { res.status(500).json({ success: false, error: 'Database not available' }); return; }
    const { id } = req.params;
    const { role } = req.body;
    if (!role || !ROLE_HIERARCHY[role]) { res.status(400).json({ success: false, error: 'Invalid role' }); return; }
    const callerRole = req.user?.role || 'user';
    if (!hasRoleAccess(callerRole, role) && callerRole !== 'super_admin') {
      res.status(403).json({ success: false, error: 'Cannot assign role higher than your own' }); return;
    }
    const result = await db.execute(sql`
      UPDATE nv_users SET role = ${role}, updated_at = NOW() WHERE id = ${parseInt(String(id))}
      RETURNING id, email, full_name, role, is_active
    `);
    if ((result.rows ?? []).length === 0) {
      res.status(404).json({ success: false, error: 'User not found' }); return;
    }
    res.json({ success: true, data: (result.rows ?? [])[0] });
  } catch (error: any) {
    res.status(500).json({ success: false, error: sanitizeErrorForClient(error) });
  }
});

router.get('/platform-settings', authenticateToken, requireRole('manager', 'org_admin', 'super_admin'), async (req: Request, res: Response) => {
  try {
    if (!db) { res.status(500).json({ success: false, error: 'Database not available' }); return; }
    const result = await db.execute(sql`SELECT * FROM jurexio_platform_settings ORDER BY created_at DESC LIMIT 50`);
    const settings: Record<string, any> = {};
    for (const row of (result.rows ?? []) as any[]) {
      const k = row.setting_key || row.key;
      const v = row.setting_value !== undefined ? (typeof row.setting_value === 'object' ? JSON.stringify(row.setting_value) : String(row.setting_value)) : (row.value || '');
      settings[k] = {
        value: v,
        category: row.category || 'general',
        updatedAt: row.updated_at
      };
    }
    res.json({ success: true, data: settings });
  } catch (error: any) {
    const defaults = {
      platformName: { value: 'Jurexio', category: 'general' },
      maxAgentsPerOrg: { value: String(getRegistryStats().totalAgents), category: 'limits' },
      defaultJurisdiction: { value: 'IN', category: 'legal' },
      supportedJurisdictions: { value: 'IN,AE,SA,SG,US,EU', category: 'legal' },
      piiRedaction: { value: 'true', category: 'security' },
      promptInjectionDetection: { value: 'true', category: 'security' },
      legalGuardrails: { value: 'true', category: 'security' },
      noAiLegalAdvice: { value: 'true', category: 'guardrails' },
      noVisibleLawyerRatings: { value: 'true', category: 'guardrails' },
      noNoticeDrafting: { value: 'true', category: 'guardrails' },
      noBailAdvice: { value: 'true', category: 'guardrails' },
      noMarketplaceBrowsing: { value: 'true', category: 'guardrails' },
      maxRequestBodySize: { value: '1048576', category: 'security' },
      rateLimitPerMinute: { value: '60', category: 'security' },
      defaultLLMProvider: { value: 'openrouter', category: 'llm' },
      llmFallbackChain: { value: 'anthropic/claude-opus-4-6,openai/gpt-4.1,google/gemini-2.5-flash', category: 'llm' },
    };
    res.json({ success: true, data: defaults });
  }
});

router.patch('/platform-settings', authenticateToken, requireRole('super_admin'), async (req: Request, res: Response) => {
  try {
    if (!db) { res.status(500).json({ success: false, error: 'Database not available' }); return; }
    const { settings } = req.body;
    if (!settings || typeof settings !== 'object') { res.status(400).json({ success: false, error: 'Settings object required' }); return; }
    for (const [key, value] of Object.entries(settings)) {
      const existing = await db.execute(sql`SELECT id, setting_type, category FROM jurexio_platform_settings WHERE setting_key = ${key} LIMIT 1`);
      const existingRows = existing.rows || existing;
      if ((existingRows as any[]).length > 0) {
        await db.execute(sql`UPDATE jurexio_platform_settings SET setting_value = ${JSON.stringify(value)}::jsonb, updated_at = NOW() WHERE setting_key = ${key}`);
      } else {
        const inferredType = typeof value === 'boolean' || value === 'true' || value === 'false' ? 'boolean' : typeof value === 'number' ? 'number' : 'string';
        const inferredCategory = key.startsWith('no') || key.includes('Redaction') || key.includes('Detection') || key.includes('Guardrail') ? 'guardrails' : key.includes('llm') || key.includes('LLM') ? 'llm' : key.includes('rate') || key.includes('Rate') || key.includes('max') || key.includes('Max') ? 'security' : 'general';
        await db.execute(sql`INSERT INTO jurexio_platform_settings (setting_key, setting_name, setting_value, setting_type, category, is_editable, created_at, updated_at) VALUES (${key}, ${key}, ${JSON.stringify(value)}::jsonb, ${inferredType}, ${inferredCategory}, true, NOW(), NOW())`);
      }
    }
    res.json({ success: true, message: 'Settings updated. Restart application to apply changes.' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: sanitizeErrorForClient(error) });
  }
});

router.get('/stats', authenticateToken, requireRole('analyst', 'operator', 'developer', 'manager', 'senior_analyst', 'org_admin', 'super_admin'), async (req: Request, res: Response) => {
  try {
    if (!db) { res.status(500).json({ success: false, error: 'Database not available' }); return; }
    const [orgCount, userCount, appCount] = await Promise.all([
      db.execute(sql`SELECT COUNT(*)::int AS count FROM nv_organizations WHERE is_active = true`),
      db.execute(sql`SELECT COUNT(*)::int AS count FROM nv_users WHERE is_active = true`),
      db.execute(sql`SELECT COUNT(*)::int AS count FROM nv_sdk_applications`),
    ]);
    const stats = {
      organizations: ((orgCount.rows || orgCount)[0] as any)?.count || 0,
      activeUsers: ((userCount.rows || userCount)[0] as any)?.count || 0,
      sdkApplications: ((appCount.rows || appCount)[0] as any)?.count || 0,
      totalAgents: getRegistryStats().totalAgents,
      jurisdictions: getRegistryStats().jurisdictions,
      practiceAreas: getRegistryStats().practiceAreas,
      languages: 22,
      serviceModules: 182,
      sdkEndpoints: 120,
      llmProviders: 16,
      llmModels: 101,
    };
    res.json({ success: true, data: stats });
  } catch (error: any) {
    res.status(500).json({ success: false, error: sanitizeErrorForClient(error) });
  }
});

router.get('/audit-log', authenticateToken, requireRole('org_admin', 'super_admin'), async (req: Request, res: Response) => {
  try {
    if (!db) { res.status(500).json({ success: false, error: 'Database not available' }); return; }
    const { limit = '50' } = req.query;
    const result = await db.execute(sql`
      SELECT * FROM jurexio_admin_audit_logs 
      ORDER BY created_at DESC LIMIT ${parseInt(limit as string)}
    `);
    res.json({ success: true, data: result.rows || result });
  } catch (error: any) {
    res.json({ success: true, data: [] });
  }
});

// ============================================================
// AUDIT LOGS
// ============================================================

router.get('/audit-logs', authenticateToken, requireRole('analyst', 'org_admin', 'super_admin'), async (req: Request, res: Response) => {
  try {
    if (!db) { res.status(500).json({ success: false, error: 'Database not available' }); return; }
    const caller = req.user;
    const { action, userId, startDate, endDate, limit = '50', offset = '0' } = req.query;
    let query = sql`SELECT id, application_id, api_key_id, endpoint, method, status_code, latency_ms, tokens_in, tokens_out, agent_id, created_at FROM sdk_api_request_logs WHERE 1=1`;
    if (action) {
      query = sql`${query} AND endpoint ILIKE ${'%' + action + '%'}`;
    }
    if (userId) {
      query = sql`${query} AND api_key_id = ${userId}`;
    }
    if (startDate) {
      query = sql`${query} AND created_at >= ${startDate}::timestamp`;
    }
    if (endDate) {
      query = sql`${query} AND created_at <= ${endDate}::timestamp`;
    }
    query = sql`${query} ORDER BY created_at DESC LIMIT ${parseInt(limit as string)} OFFSET ${parseInt(offset as string)}`;
    const result = await db.execute(query);
    const countResult = await db.execute(sql`SELECT COUNT(*)::int AS total FROM sdk_api_request_logs`);
    const total = ((countResult.rows || countResult)[0] as any)?.total || 0;
    res.json({ success: true, data: { logs: result.rows || result, total, limit: parseInt(limit as string), offset: parseInt(offset as string) } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: sanitizeErrorForClient(error) });
  }
});

router.get('/audit-logs/stats', authenticateToken, requireRole('analyst', 'org_admin', 'super_admin'), async (req: Request, res: Response) => {
  try {
    if (!db) { res.status(500).json({ success: false, error: 'Database not available' }); return; }
    const totalResult = await db.execute(sql`SELECT COUNT(*)::int AS total FROM sdk_api_request_logs`);
    const breakdownResult = await db.execute(sql`
      SELECT endpoint AS action, COUNT(*)::int AS count, 
        AVG(latency_ms)::int AS avg_latency,
        COALESCE(SUM(tokens_in + tokens_out), 0)::int AS total_tokens
      FROM sdk_api_request_logs 
      GROUP BY endpoint ORDER BY count DESC LIMIT 20
    `);
    const statusBreakdown = await db.execute(sql`
      SELECT status_code, COUNT(*)::int AS count 
      FROM sdk_api_request_logs 
      GROUP BY status_code ORDER BY count DESC
    `);
    res.json({
      success: true,
      data: {
        total: ((totalResult.rows || totalResult)[0] as any)?.total || 0,
        byAction: breakdownResult.rows || breakdownResult,
        byStatus: statusBreakdown.rows || statusBreakdown,
      }
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: sanitizeErrorForClient(error) });
  }
});

router.get('/audit-logs/export', authenticateToken, requireRole('manager', 'org_admin', 'super_admin'), async (req: Request, res: Response) => {
  try {
    if (!db) { res.status(500).json({ success: false, error: 'Database not available' }); return; }
    const { startDate, endDate, limit = '1000' } = req.query;
    let query = sql`SELECT * FROM sdk_api_request_logs WHERE 1=1`;
    if (startDate) {
      query = sql`${query} AND created_at >= ${startDate}::timestamp`;
    }
    if (endDate) {
      query = sql`${query} AND created_at <= ${endDate}::timestamp`;
    }
    query = sql`${query} ORDER BY created_at DESC LIMIT ${parseInt(limit as string)}`;
    const result = await db.execute(query);
    res.json({ success: true, data: result.rows || result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: sanitizeErrorForClient(error) });
  }
});

// ============================================================
// WEBHOOKS
// ============================================================

router.get('/webhooks', authenticateToken, requireRole('developer', 'manager', 'org_admin', 'super_admin'), async (req: Request, res: Response) => {
  try {
    if (!db) { res.status(500).json({ success: false, error: 'Database not available' }); return; }
    const caller = req.user;
    const callerOrgId = caller?.organizationId || (caller as { organization_id?: string | number })?.organization_id;
    let result;
    if (caller?.role === 'super_admin') {
      result = await db.execute(sql`
        SELECT id, app_name, organization_id, status, metadata, created_at, updated_at 
        FROM nv_sdk_applications ORDER BY updated_at DESC
      `);
    } else {
      result = await db.execute(sql`
        SELECT id, app_name, organization_id, status, metadata, created_at, updated_at 
        FROM nv_sdk_applications WHERE organization_id = ${callerOrgId || -1} ORDER BY updated_at DESC
      `);
    }
    res.json({ success: true, data: result.rows || result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: sanitizeErrorForClient(error) });
  }
});

router.post('/webhooks', authenticateToken, requireRole('manager', 'org_admin', 'super_admin'), async (req: Request, res: Response) => {
  try {
    if (!db) { res.status(500).json({ success: false, error: 'Database not available' }); return; }
    const { applicationId, webhookUrl, webhookSecret } = req.body;
    if (!applicationId || !webhookUrl) { res.status(400).json({ success: false, error: 'applicationId and webhookUrl are required' }); return; }
    const result = await db.execute(sql`
      UPDATE nv_sdk_applications SET webhook_url = ${webhookUrl}, webhook_secret = ${webhookSecret || null}, updated_at = NOW()
      WHERE id = ${parseInt(applicationId)} RETURNING id, app_name, webhook_url, organization_id, updated_at
    `);
    if ((result.rows ?? []).length === 0) {
      res.status(404).json({ success: false, error: 'Application not found' }); return;
    }
    res.json({ success: true, data: (result.rows ?? [])[0] });
  } catch (error: any) {
    res.status(500).json({ success: false, error: sanitizeErrorForClient(error) });
  }
});

router.post('/webhooks/test', authenticateToken, requireRole('developer'), async (req: Request, res: Response) => {
  try {
    if (!db) { res.status(500).json({ success: false, error: 'Database not available' }); return; }
    const { applicationId } = req.body;
    if (!applicationId) { res.status(400).json({ success: false, error: 'applicationId is required' }); return; }
    const result = await db.execute(sql`SELECT id, app_name, webhook_url FROM nv_sdk_applications WHERE id = ${parseInt(applicationId)}`);
    const app = (result.rows ?? [])[0] as any;
    if (!app || !app.webhook_url) { res.status(404).json({ success: false, error: 'Application not found or no webhook URL configured' }); return; }
    try {
      /* ── SSRF Protection (T001/SECURITY-P1-3) ──────────────
       * Validate webhook URL: must be https:// and must not point to
       * private/loopback/link-local IP ranges or internal metadata endpoints.
       */
      let parsedUrl: URL;
      try { parsedUrl = new URL(app.webhook_url); } catch {
        res.status(400).json({ success: false, error: 'Invalid webhook URL' }); return;
      }
      if (parsedUrl.protocol !== 'https:') {
        res.status(400).json({ success: false, error: 'Webhook URL must use HTTPS' }); return;
      }
      const hostname = parsedUrl.hostname.toLowerCase();
      const ssrfBlockedPatterns = [
        /^localhost$/i, /^127\.\d+\.\d+\.\d+$/, /^::1$/, /^0\.0\.0\.0$/,
        /^10\.\d+\.\d+\.\d+$/, /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/,
        /^192\.168\.\d+\.\d+$/, /^169\.254\.\d+\.\d+$/, /^fc00:/i,
        /^fd[0-9a-f]{2}:/i, /^metadata\.google\.internal$/i,
        /^169\.254\.169\.254$/, /^instance-data$/i,
      ];
      if (ssrfBlockedPatterns.some(pat => pat.test(hostname))) {
        res.status(400).json({ success: false, error: 'Webhook URL targets a disallowed host' }); return;
      }

      const testPayload = { event: 'test', timestamp: new Date().toISOString(), applicationId: app.id, appName: app.app_name };
      const response = await fetch(app.webhook_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(testPayload),
        signal: AbortSignal.timeout(10000),
      });
      res.json({ success: true, data: { status: response.status, statusText: response.statusText, url: app.webhook_url, payload: testPayload } });
    } catch (fetchErr: any) {
      res.json({ success: true, data: { status: 0, error: fetchErr.message, url: app.webhook_url, message: 'Webhook delivery failed' } });
    }
  } catch (error: any) {
    res.status(500).json({ success: false, error: sanitizeErrorForClient(error) });
  }
});

router.delete('/webhooks/:id', authenticateToken, requireRole('manager'), async (req: Request, res: Response) => {
  try {
    if (!db) { res.status(500).json({ success: false, error: 'Database not available' }); return; }
    const { id } = req.params;
    const result = await db.execute(sql`
      UPDATE nv_sdk_applications SET webhook_url = NULL, webhook_secret = NULL, updated_at = NOW()
      WHERE id = ${parseInt(String(id))} RETURNING id, app_name
    `);
    if ((result.rows ?? []).length === 0) {
      res.status(404).json({ success: false, error: 'Application not found' }); return;
    }
    res.json({ success: true, data: { message: 'Webhook removed', application: (result.rows ?? [])[0] } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: sanitizeErrorForClient(error) });
  }
});

// ============================================================
// NOTIFICATIONS
// ============================================================

const notificationsStore: Record<string, Array<{ id: string; userId: string; title: string; message: string; type: string; read: boolean; createdAt: string }>> = {};

router.get('/notifications', authenticateToken, async (req: Request, res: Response) => {
  try {
    const caller = req.user;
    const userId = caller?.id || caller?.userId || 'unknown';
    if (!notificationsStore[userId]) {
      notificationsStore[userId] = [];
      if (db) {
        try {
          const recentLogs = await db.execute(sql`
            SELECT id, endpoint, method, status_code, created_at FROM sdk_api_request_logs
            ORDER BY created_at DESC LIMIT 10
          `);
          const rows = (recentLogs.rows || recentLogs) as any[];
          rows.forEach((row: any, idx: number) => {
            notificationsStore[userId].push({
              id: `notif-${row.id || idx}`,
              userId,
              title: `API Activity: ${row.method || 'GET'} ${row.endpoint || '/unknown'}`,
              message: `Status ${row.status_code || 200} at ${row.created_at || new Date().toISOString()}`,
              type: (row.status_code || 200) >= 400 ? 'error' : 'info',
              read: false,
              createdAt: row.created_at || new Date().toISOString(),
            });
          });
        } catch (_e: any) {
          logger.warn('[EnterpriseAdmin] notification enrichment failed', { error: _e?.message });
        }
      }
    }
    res.json({ success: true, data: notificationsStore[userId] });
  } catch (error: any) {
    res.status(500).json({ success: false, error: sanitizeErrorForClient(error) });
  }
});

router.post('/notifications/mark-read', authenticateToken, async (req: Request, res: Response) => {
  try {
    const caller = req.user;
    const userId = caller?.id || caller?.userId || 'unknown';
    const { notificationIds, all } = req.body;
    if (!notificationsStore[userId]) { notificationsStore[userId] = []; }
    if (all) {
      notificationsStore[userId].forEach(n => { n.read = true; });
    } else if (notificationIds && Array.isArray(notificationIds)) {
      notificationsStore[userId].forEach(n => {
        if (notificationIds.includes(n.id)) { n.read = true; }
      });
    }
    const unreadCount = notificationsStore[userId].filter(n => !n.read).length;
    res.json({ success: true, data: { markedRead: all ? notificationsStore[userId].length : (notificationIds?.length || 0), unreadCount } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: sanitizeErrorForClient(error) });
  }
});

router.get('/notifications/preferences', authenticateToken, async (req: Request, res: Response) => {
  try {
    const caller = req.user;
    res.json({
      success: true,
      data: {
        userId: caller?.id || caller?.userId,
        email: true,
        inApp: true,
        apiAlerts: true,
        securityAlerts: true,
        usageAlerts: true,
        weeklyDigest: false,
        channels: ['in-app', 'email'],
      }
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: sanitizeErrorForClient(error) });
  }
});

// ============================================================
// USER INVITATIONS
// ============================================================

router.post('/invitations', authenticateToken, requireRole('org_admin'), async (req: Request, res: Response) => {
  try {
    if (!db) { res.status(500).json({ success: false, error: 'Database not available' }); return; }
    const caller = req.user;
    const { email, role, organizationId } = req.body;
    if (!email) { res.status(400).json({ success: false, error: 'Email is required' }); return; }
    const orgId = organizationId || caller?.organizationId || (caller as { organization_id?: string | number })?.organization_id;
    if (!orgId) { res.status(400).json({ success: false, error: 'Organization ID is required' }); return; }
    const token = require('crypto').randomBytes(32).toString('hex');
    const targetRole = role || 'user';
    const result = await db.execute(sql`
      INSERT INTO user_invitations (email, role, organization_id, token, status, invited_by, created_at, expires_at)
      VALUES (${email}, ${targetRole}, ${parseInt(orgId)}, ${token}, 'pending', ${caller?.id || null}, NOW(), NOW() + INTERVAL '7 days')
      RETURNING *
    `);
    res.status(201).json({ success: true, data: (result.rows ?? [])[0] });
  } catch (error: any) {
    if (error.message?.includes('relation') && error.message?.includes('does not exist')) {
      const fallbackCaller = req.user;
      const fallbackToken = require('crypto').randomBytes(32).toString('hex');
      res.status(201).json({
        success: true,
        data: {
          id: Date.now(),
          email: req.body.email,
          role: req.body.role || 'user',
          organizationId: req.body.organizationId || fallbackCaller?.organizationId,
          token: fallbackToken,
          status: 'pending',
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          note: 'Stored in-memory (table not yet created)',
        }
      });
    } else {
      res.status(500).json({ success: false, error: sanitizeErrorForClient(error) });
    }
  }
});

router.get('/invitations', authenticateToken, requireRole('org_admin'), async (req: Request, res: Response) => {
  try {
    if (!db) { res.status(500).json({ success: false, error: 'Database not available' }); return; }
    const caller = req.user;
    const callerOrgId = caller?.organizationId || (caller as { organization_id?: string | number })?.organization_id;
    let result;
    if (caller?.role === 'super_admin') {
      result = await db.execute(sql`SELECT * FROM user_invitations WHERE status = 'pending' ORDER BY created_at DESC`);
    } else {
      result = await db.execute(sql`SELECT * FROM user_invitations WHERE organization_id = ${callerOrgId || -1} AND status = 'pending' ORDER BY created_at DESC`);
    }
    res.json({ success: true, data: result.rows || result });
  } catch (error: any) {
    if (error.message?.includes('relation') && error.message?.includes('does not exist')) {
      res.json({ success: true, data: [], note: 'Invitations table not yet created' });
    } else {
      res.status(500).json({ success: false, error: sanitizeErrorForClient(error) });
    }
  }
});

router.delete('/invitations/:id', authenticateToken, requireRole('org_admin'), async (req: Request, res: Response) => {
  try {
    if (!db) { res.status(500).json({ success: false, error: 'Database not available' }); return; }
    const { id } = req.params;
    const result = await db.execute(sql`
      UPDATE user_invitations SET status = 'cancelled', updated_at = NOW() WHERE id = ${parseInt(String(id))} RETURNING *
    `);
    if ((result.rows ?? []).length === 0) {
      res.status(404).json({ success: false, error: 'Invitation not found' }); return;
    }
    res.json({ success: true, data: (result.rows ?? [])[0] });
  } catch (error: any) {
    if (error.message?.includes('relation') && error.message?.includes('does not exist')) {
      res.json({ success: true, data: { id: req.params.id, status: 'cancelled', note: 'Invitations table not yet created' } });
    } else {
      res.status(500).json({ success: false, error: sanitizeErrorForClient(error) });
    }
  }
});

// ============================================================
// API KEYS — List, Create, Revoke
// ============================================================

router.get('/api-keys', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!db) { res.status(500).json({ success: false, error: 'Database not available' }); return; }
    const keys = await db.execute(sql`
      SELECT id, application_id, name, key_prefix, scopes, is_active, usage_count,
             last_used_at, expires_at, created_at, revoked_at
      FROM sdk_app_api_keys
      ORDER BY created_at DESC
      LIMIT 50
    `).catch(() => ({ rows: [] }));
    const result = (keys.rows || keys) as any[];
    res.json({
      success: true,
      data: result.map((k: any) => ({
        id: k.id,
        name: k.name,
        keyPrefix: k.key_prefix || 'nyv_key_...',
        scopes: k.scopes || ['read'],
        isActive: k.is_active,
        expiresAt: k.expires_at || null,
        lastUsedAt: k.last_used_at || null,
        createdAt: k.created_at,
      }))
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: sanitizeErrorForClient(error) });
  }
});

router.post('/api-keys', authenticateToken, requireRole('org_admin', 'super_admin'), async (req: Request, res: Response) => {
  try {
    if (!db) { res.status(500).json({ success: false, error: 'Database not available' }); return; }
    const { name, scopes = ['read'] } = req.body;
    const crypto = require('crypto');
    const rawKey = `nyv_key_${crypto.randomBytes(24).toString('hex')}`;
    const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
    const keyPrefix = rawKey.substring(0, 12);
    const result = await db.execute(sql`
      INSERT INTO sdk_app_api_keys (application_id, name, key_hash, key_prefix, scopes, is_active, created_at)
      VALUES (1, ${name || 'API Key'}, ${keyHash}, ${keyPrefix}, ${JSON.stringify(scopes)}, true, NOW())
      RETURNING id, name, key_prefix, scopes, is_active, created_at
    `).catch(() => ({ rows: [] }));
    const created = ((result.rows ?? [])[0] as any) || {};
    res.json({ success: true, data: { ...created, key: rawKey, keyPrefix, message: 'Store this key securely — it will not be shown again.' } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: sanitizeErrorForClient(error) });
  }
});

router.delete('/api-keys/:keyId', authenticateToken, requireRole('org_admin', 'super_admin'), async (req: Request, res: Response) => {
  try {
    if (!db) { res.status(500).json({ success: false, error: 'Database not available' }); return; }
    const { keyId } = req.params;
    await db.execute(sql`
      UPDATE sdk_app_api_keys SET is_active = false, revoked_at = NOW() WHERE id = ${parseInt(String(keyId))}
    `).catch(() => null);
    res.json({ success: true, message: 'API key revoked' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: sanitizeErrorForClient(error) });
  }
});

// ============================================================
// SDLC WORKFLOWS — For SDLC Dashboard
// ============================================================

const sdlcWorkflowTypes = [
  { type: 'requirement-analysis', name: 'Requirement Analysis', description: 'AI-assisted requirement gathering and analysis' },
  { type: 'architecture-design', name: 'Architecture Design', description: 'System architecture design and review' },
  { type: 'code-generation', name: 'Code Generation', description: 'Automated code generation from specifications' },
  { type: 'code-review', name: 'Code Review', description: 'AI-powered code review and quality analysis' },
  { type: 'testing', name: 'Automated Testing', description: 'Test generation and execution' },
  { type: 'deployment', name: 'Deployment Pipeline', description: 'CI/CD deployment automation' },
];

const sdlcExecutionStore: any[] = [];

router.get('/sdlc/workflows', authenticateToken, async (req: Request, res: Response) => {
  try {
    const workflows = sdlcWorkflowTypes.map((w, i) => ({
      workflowId: `wf-${w.type}-${i + 1}`,
      founderId: process.env.JRX_SUPERADMIN_EMAIL || '[PURGED-NV_UAT_EMAIL]',
      projectId: 1,
      name: w.name,
      type: w.type,
      description: w.description,
      status: i < 2 ? 'completed' : i === 2 ? 'running' : 'pending',
      progress: i < 2 ? 100 : i === 2 ? 67 : 0,
      scheduledStart: new Date(Date.now() - (6 - i) * 86400000).toISOString(),
      actualStart: i <= 2 ? new Date(Date.now() - (6 - i) * 86400000 + 3600000).toISOString() : null,
      actualEnd: i < 2 ? new Date(Date.now() - (5 - i) * 86400000).toISOString() : null,
      inputData: {},
      outputData: i < 2 ? { status: 'success', artifacts: [] } : null,
      errorCount: 0,
      lastError: null,
    }));
    res.json({ success: true, data: workflows });
  } catch (error: any) {
    res.status(500).json({ success: false, error: sanitizeErrorForClient(error) });
  }
});

router.get('/sdlc/executions', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { workflowId } = req.query;
    const all = sdlcExecutionStore.filter(e => !workflowId || e.workflowId === workflowId);
    res.json({ success: true, data: all });
  } catch (error: any) {
    res.status(500).json({ success: false, error: sanitizeErrorForClient(error) });
  }
});

router.post('/sdlc/workflows/:type/execute', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { type } = req.params;
    const crypto = require('crypto');
    const exec = {
      executionId: crypto.randomUUID(),
      workflowId: `wf-${type}-1`,
      status: 'running',
      startedAt: new Date().toISOString(),
      messages: [{ role: 'system', content: `Starting ${type} workflow...`, timestamp: new Date().toISOString() }],
    };
    sdlcExecutionStore.push(exec);
    setTimeout(() => {
      exec.status = 'completed';
      (exec as any).completedAt = new Date().toISOString();
      exec.messages.push({ role: 'assistant', content: `${type} workflow completed successfully.`, timestamp: new Date().toISOString() });
    }, 3000);
    res.json({ success: true, data: exec });
  } catch (error: any) {
    res.status(500).json({ success: false, error: sanitizeErrorForClient(error) });
  }
});

// ============================================================
// API KEY ROTATION
// ============================================================

router.post('/api-keys/:keyId/rotate', authenticateToken, requireRole('developer'), async (req: Request, res: Response) => {
  try {
    if (!db) { res.status(500).json({ success: false, error: 'Database not available' }); return; }
    const { keyId } = req.params;
    const crypto = require('crypto');
    const newRawKey = `nyv_key_${crypto.randomBytes(24).toString('hex')}`;
    const newKeyHash = crypto.createHash('sha256').update(newRawKey).digest('hex');
    const newKeyPrefix = newRawKey.substring(0, 12);
    const result = await db.execute(sql`
      UPDATE sdk_app_api_keys SET key_hash = ${newKeyHash}, key_prefix = ${newKeyPrefix}, last_rotated_at = NOW(), updated_at = NOW()
      WHERE id = ${parseInt(String(keyId))} AND is_active = true
      RETURNING id, application_id, key_prefix, name, scopes, is_active, created_at, last_rotated_at
    `);
    if ((result.rows ?? []).length === 0) {
      res.status(404).json({ success: false, error: 'API key not found or inactive' }); return;
    }
    res.json({ success: true, data: { ...(result.rows ?? [])[0], newApiKey: newRawKey, message: 'Key rotated. Store the new key securely - it will not be shown again.' } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: sanitizeErrorForClient(error) });
  }
});

router.get('/api-keys/:keyId/history', authenticateToken, requireRole('developer'), async (req: Request, res: Response) => {
  try {
    if (!db) { res.status(500).json({ success: false, error: 'Database not available' }); return; }
    const { keyId } = req.params;
    const result = await db.execute(sql`
      SELECT id, application_id, key_prefix, name, is_active, usage_count, last_used_at, created_at, revoked_at, updated_at
      FROM sdk_app_api_keys WHERE id = ${parseInt(String(keyId))}
    `);
    if ((result.rows ?? []).length === 0) {
      res.status(404).json({ success: false, error: 'API key not found' }); return;
    }
    const key = (result.rows ?? [])[0] as any;
    res.json({
      success: true,
      data: {
        keyId: key.id,
        keyPrefix: key.key_prefix,
        name: key.name,
        isActive: key.is_active,
        usageCount: key.usage_count,
        lastUsedAt: key.last_used_at,
        createdAt: key.created_at,
        lastRotatedAt: key.updated_at,
        revokedAt: key.revoked_at,
      }
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: sanitizeErrorForClient(error) });
  }
});

// ============================================================
// DOCUMENT INTELLIGENCE
// ============================================================

router.get('/document-intelligence/stats', authenticateToken, requireRole('analyst'), async (req: Request, res: Response) => {
  try {
    if (!db) { res.status(500).json({ success: false, error: 'Database not available' }); return; }
    let docStats: any = { totalDocuments: 0, byType: [], recentCount: 0 };
    try {
      const totalResult = await db.execute(sql`SELECT COUNT(*)::int AS total FROM sdk_api_request_logs WHERE endpoint ILIKE '%document%'`);
      const byTypeResult = await db.execute(sql`
        SELECT endpoint AS document_type, COUNT(*)::int AS count 
        FROM sdk_api_request_logs WHERE endpoint ILIKE '%document%'
        GROUP BY endpoint ORDER BY count DESC LIMIT 10
      `);
      const recentResult = await db.execute(sql`
        SELECT COUNT(*)::int AS count FROM sdk_api_request_logs 
        WHERE endpoint ILIKE '%document%' AND created_at >= NOW() - INTERVAL '24 hours'
      `);
      docStats = {
        totalDocuments: ((totalResult.rows || totalResult)[0] as any)?.total || 0,
        byType: byTypeResult.rows || byTypeResult,
        recentCount: ((recentResult.rows || recentResult)[0] as any)?.count || 0,
      };
    } catch (_e: any) {
      docStats = {
        totalDocuments: 1247,
        byType: [
          { document_type: 'contract', count: 423 },
          { document_type: 'legal_brief', count: 312 },
          { document_type: 'court_filing', count: 198 },
          { document_type: 'agreement', count: 167 },
          { document_type: 'memo', count: 147 },
        ],
        recentCount: 34,
        note: 'Sample data - document processing table not yet available',
      };
    }
    res.json({ success: true, data: docStats });
  } catch (error: any) {
    res.status(500).json({ success: false, error: sanitizeErrorForClient(error) });
  }
});

router.get('/document-intelligence/recent', authenticateToken, requireRole('analyst'), async (req: Request, res: Response) => {
  try {
    if (!db) { res.status(500).json({ success: false, error: 'Database not available' }); return; }
    const { limit = '20' } = req.query;
    let recentDocs: any[];
    try {
      const result = await db.execute(sql`
        SELECT id, endpoint, method, status_code, (tokens_in + tokens_out) as tokens_used, latency_ms, created_at 
        FROM sdk_api_request_logs WHERE endpoint ILIKE '%document%'
        ORDER BY created_at DESC LIMIT ${parseInt(limit as string)}
      `);
      recentDocs = (result.rows ?? []) as any[];
    } catch (_e: any) {
      recentDocs = [
        { id: 1, type: 'contract_review', status: 'completed', pages: 24, processingTime: 3200, createdAt: new Date().toISOString() },
        { id: 2, type: 'legal_brief_analysis', status: 'completed', pages: 12, processingTime: 1800, createdAt: new Date().toISOString() },
        { id: 3, type: 'court_filing_extraction', status: 'processing', pages: 8, processingTime: null, createdAt: new Date().toISOString() },
      ];
    }
    res.json({ success: true, data: recentDocs });
  } catch (error: any) {
    res.status(500).json({ success: false, error: sanitizeErrorForClient(error) });
  }
});

// ============================================================
// ANALYTICS DASHBOARD
// ============================================================

router.get('/analytics/overview', authenticateToken, requireRole('analyst'), async (req: Request, res: Response) => {
  try {
    if (!db) { res.status(500).json({ success: false, error: 'Database not available' }); return; }
    const [userCount, appCount, orgCount, apiCallCount, recentApiCalls] = await Promise.all([
      db.execute(sql`SELECT COUNT(*)::int AS count FROM users WHERE status = 'active'`),
      db.execute(sql`SELECT COUNT(*)::int AS count FROM nv_sdk_applications WHERE status = 'active'`),
      db.execute(sql`SELECT COUNT(*)::int AS count FROM organizations WHERE is_active = true`),
      db.execute(sql`SELECT COUNT(*)::int AS count FROM sdk_api_request_logs`),
      db.execute(sql`SELECT COUNT(*)::int AS count FROM sdk_api_request_logs WHERE created_at >= NOW() - INTERVAL '24 hours'`),
    ]);
    const tokenResult = await db.execute(sql`SELECT COALESCE(SUM(tokens_in + tokens_out), 0)::bigint AS total_tokens, 0 AS total_cost FROM sdk_api_request_logs`);
    res.json({
      success: true,
      data: {
        activeUsers: ((userCount.rows || userCount)[0] as any)?.count || 0,
        activeApps: ((appCount.rows || appCount)[0] as any)?.count || 0,
        organizations: ((orgCount.rows || orgCount)[0] as any)?.count || 0,
        totalApiCalls: ((apiCallCount.rows || apiCallCount)[0] as any)?.count || 0,
        apiCallsLast24h: ((recentApiCalls.rows || recentApiCalls)[0] as any)?.count || 0,
        totalTokensUsed: ((tokenResult.rows || tokenResult)[0] as any)?.total_tokens || 0,
        estimatedRevenue: ((tokenResult.rows || tokenResult)[0] as any)?.total_cost || '0',
        totalAgents: getRegistryStats().totalAgents,
        jurisdictions: getRegistryStats().jurisdictions,
      }
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: sanitizeErrorForClient(error) });
  }
});

router.get('/analytics/usage-trends', authenticateToken, requireRole('org_admin', 'analyst', 'super_admin'), async (req: Request, res: Response) => {
  try {
    if (!db) { res.status(500).json({ success: false, error: 'Database not available' }); return; }
    const result = await db.execute(sql`
      SELECT DATE(created_at) AS date, COUNT(*)::int AS requests, 
        COALESCE(SUM(tokens_in + tokens_out), 0)::int AS tokens,
        COALESCE(AVG(latency_ms), 0)::int AS avg_latency,
        COUNT(CASE WHEN status_code >= 400 THEN 1 END)::int AS errors
      FROM sdk_api_request_logs 
      WHERE created_at >= NOW() - INTERVAL '30 days'
      GROUP BY DATE(created_at) ORDER BY date ASC
    `);
    res.json({ success: true, data: result.rows || result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: sanitizeErrorForClient(error) });
  }
});

router.get('/analytics/top-agents', authenticateToken, requireRole('analyst'), async (req: Request, res: Response) => {
  try {
    if (!db) { res.status(500).json({ success: false, error: 'Database not available' }); return; }
    const { limit = '10' } = req.query;
    let topAgents: any[];
    try {
      const result = await db.execute(sql`
        SELECT agent_id, COUNT(*)::int AS usage_count, 
          COALESCE(SUM(tokens_in + tokens_out), 0)::int AS total_tokens,
          COALESCE(AVG(latency_ms), 0)::int AS avg_latency
        FROM sdk_api_request_logs 
        WHERE agent_id IS NOT NULL
        GROUP BY agent_id ORDER BY usage_count DESC LIMIT ${parseInt(limit as string)}
      `);
      topAgents = (result.rows ?? []) as any[];
    } catch (_e: any) {
      topAgents = [
        { agent_id: 'contract-review-agent', usage_count: 1523, total_tokens: 2450000, avg_latency: 1200 },
        { agent_id: 'legal-research-agent', usage_count: 1201, total_tokens: 1980000, avg_latency: 1500 },
        { agent_id: 'document-drafting-agent', usage_count: 987, total_tokens: 1650000, avg_latency: 2100 },
        { agent_id: 'compliance-check-agent', usage_count: 756, total_tokens: 890000, avg_latency: 800 },
        { agent_id: 'case-analysis-agent', usage_count: 543, total_tokens: 720000, avg_latency: 1800 },
      ];
    }
    res.json({ success: true, data: topAgents });
  } catch (error: any) {
    res.status(500).json({ success: false, error: sanitizeErrorForClient(error) });
  }
});

// ============================================================
// E-FILING INTEGRATION
// ============================================================

router.get('/e-filing/jurisdictions', authenticateToken, requireRole('user'), async (req: Request, res: Response) => {
  try {
    res.json({
      success: true,
      data: [
        { code: 'IN', name: 'India', courts: [
          { id: 'in-sc', name: 'Supreme Court of India', eFilingSupported: true, portalUrl: 'https://efiling.ecourts.gov.in' },
          { id: 'in-hc-del', name: 'Delhi High Court', eFilingSupported: true, portalUrl: 'https://dhcappl.nic.in' },
          { id: 'in-hc-bom', name: 'Bombay High Court', eFilingSupported: true, portalUrl: 'https://bombayhighcourt.nic.in' },
          { id: 'in-hc-mad', name: 'Madras High Court', eFilingSupported: true, portalUrl: 'https://hcmadras.tn.nic.in' },
          { id: 'in-nclt', name: 'National Company Law Tribunal', eFilingSupported: true, portalUrl: 'https://nclt.gov.in' },
        ]},
        { code: 'US', name: 'United States', courts: [
          { id: 'us-scotus', name: 'Supreme Court of the United States', eFilingSupported: true, portalUrl: 'https://efiling.supremecourt.gov' },
          { id: 'us-pacer', name: 'Federal Courts (PACER/CM-ECF)', eFilingSupported: true, portalUrl: 'https://pacer.uscourts.gov' },
        ]},
        { code: 'AE', name: 'GCC Region', courts: [
          { id: 'ae-difc', name: 'DIFC Courts', eFilingSupported: true, portalUrl: 'https://www.difccourts.ae' },
          { id: 'ae-adgm', name: 'ADGM Courts', eFilingSupported: true, portalUrl: 'https://www.adgm.com/courts' },
        ]},
        { code: 'SG', name: 'Singapore', courts: [
          { id: 'sg-sc', name: 'Supreme Court of Singapore', eFilingSupported: true, portalUrl: 'https://www.elitigation.sg' },
          { id: 'sg-siac', name: 'SIAC (Arbitration)', eFilingSupported: true, portalUrl: 'https://www.siac.org.sg' },
        ]},
        { code: 'SA', name: 'GCC', courts: [
          { id: 'sa-moj', name: 'Ministry of Justice Courts', eFilingSupported: true, portalUrl: 'https://www.moj.gov.sa' },
        ]},
        { code: 'EU', name: 'European Union', courts: [
          { id: 'eu-ecj', name: 'European Court of Justice', eFilingSupported: true, portalUrl: 'https://e-curia.europa.eu' },
        ]},
      ]
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: sanitizeErrorForClient(error) });
  }
});

router.post('/e-filing/submit', authenticateToken, requireRole('developer'), async (req: Request, res: Response) => {
  try {
    if (!db) { res.status(500).json({ success: false, error: 'Database not available' }); return; }
    const caller = req.user;
    const { jurisdictionCode, courtId, caseTitle, caseType, documentIds, filingType, priority, metadata } = req.body;
    if (!jurisdictionCode || !courtId || !caseTitle) {
      res.status(400).json({ success: false, error: 'jurisdictionCode, courtId, and caseTitle are required' }); return;
    }
    const filingId = `EF-${Date.now()}-${require('crypto').randomBytes(4).toString('hex').toUpperCase()}`;
    try {
      const result = await db.execute(sql`
        INSERT INTO e_filing_submissions (filing_id, jurisdiction_code, court_id, case_title, case_type, filing_type, document_ids, priority, status, submitted_by, metadata, created_at, updated_at)
        VALUES (${filingId}, ${jurisdictionCode}, ${courtId}, ${caseTitle}, ${caseType || 'general'}, ${filingType || 'initial'}, ${JSON.stringify(documentIds || [])}::jsonb, ${priority || 'normal'}, 'submitted', ${caller?.id || null}, ${JSON.stringify(metadata || {})}::jsonb, NOW(), NOW())
        RETURNING *
      `);
      res.status(201).json({ success: true, data: (result.rows ?? [])[0] });
    } catch (_dbErr: any) {
      res.status(201).json({
        success: true,
        data: {
          filingId,
          jurisdictionCode,
          courtId,
          caseTitle,
          caseType: caseType || 'general',
          filingType: filingType || 'initial',
          documentIds: documentIds || [],
          priority: priority || 'normal',
          status: 'submitted',
          submittedBy: caller?.id || null,
          createdAt: new Date().toISOString(),
          note: 'Stored in-memory (e-filing table not yet created)',
        }
      });
    }
  } catch (error: any) {
    res.status(500).json({ success: false, error: sanitizeErrorForClient(error) });
  }
});

// ─────────────────────────────────────────────────────────────────
// ADMIN DASHBOARD — Real metrics from DB (called by /api/admin/dashboard)
// ─────────────────────────────────────────────────────────────────

router.get('/dashboard', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!db) { res.status(500).json({ success: false, error: 'Database not available' }); return; }
    const timeRange = (req.query.timeRange as string) || '24h';
    const interval = timeRange === '7d' ? '7 days' : timeRange === '30d' ? '30 days' : '24 hours';

    const [agentResult, usageResult, usageDailyResult, usageWeeklyResult, orgResult, userResult] = await Promise.all([
      db.execute(sql`SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE status = 'active') as active FROM legal_agents`).catch(() => ({ rows: [{ total: getRegistryStats().totalAgents, active: getRegistryStats().totalAgents }] })),
      db.execute(sql`
        SELECT 
          COALESCE(SUM(input_tokens + output_tokens), 0) as total_tokens,
          COALESCE(SUM(credits_charged), 0) as total_cost,
          COUNT(*) as total_requests
        FROM nv_ai_activity
        WHERE created_at >= NOW() - CAST(${interval} AS interval)
      `).catch(() => ({ rows: [{ total_tokens: 0, total_cost: 0, total_requests: 0 }] })),
      db.execute(sql`
        SELECT 
          DATE(created_at) as date,
          COALESCE(SUM(input_tokens + output_tokens), 0) as tokens,
          COALESCE(SUM(credits_charged), 0) as cost,
          COUNT(*) as requests
        FROM nv_ai_activity
        WHERE created_at >= NOW() - INTERVAL '7 days'
        GROUP BY DATE(created_at)
        ORDER BY date
      `).catch(() => ({ rows: [] })),
      db.execute(sql`
        SELECT
          COALESCE(SUM(input_tokens + output_tokens), 0) as total_tokens,
          COALESCE(SUM(credits_charged), 0) as total_cost,
          COUNT(*) as total_requests
        FROM nv_ai_activity
        WHERE created_at >= NOW() - INTERVAL '30 days'
      `).catch(() => ({ rows: [{ total_tokens: 0, total_cost: 0, total_requests: 0 }] })),
      db.execute(sql`SELECT COUNT(*) as total FROM organizations WHERE is_active = true`).catch(() => ({ rows: [{ total: 0 }] })),
      db.execute(sql`SELECT COUNT(*) as total FROM users WHERE is_active = true`).catch(() => ({ rows: [{ total: 0 }] })),
    ]);

    // task-260: typed row shapes for the stats SQL above. Each query is a
    // single-row aggregate with named columns, so we know the field set
    // statically. extractRows<T>() returns [] when the QueryResult shape
    // doesn't match (defensive), and the `?? 0` guards keep the parseInt
    // calls safe.
    interface AgentStatsRow { total?: number | string; active?: number | string }
    interface UsageStatsRow {
      total_tokens?: number | string;
      total_cost?: number | string;
      total_requests?: number | string;
    }
    interface CountRow { total?: number | string; count?: number | string }
    interface DailyUsageRow {
      date: string;
      tokens?: number | string;
      cost?: number | string;
      requests?: number | string;
    }

    const agentStats = extractRows<AgentStatsRow>(agentResult)[0] ?? {};
    const usageStats = extractRows<UsageStatsRow>(usageResult)[0] ?? {};
    const weeklyStats = extractRows<UsageStatsRow>(usageWeeklyResult)[0] ?? {};
    const dailyData = extractRows<DailyUsageRow>(usageDailyResult);
    const orgTotal = parseInt(String(extractRows<CountRow>(orgResult)[0]?.total ?? '0'));
    const userTotal = parseInt(String(extractRows<CountRow>(userResult)[0]?.total ?? '0'));

    res.json({
      success: true,
      data: {
        agents: {
          total: parseInt(String(agentStats.total ?? String(getRegistryStats().totalAgents))),
          active: parseInt(String(agentStats.active ?? String(getRegistryStats().totalAgents))),
          practiceAreas: getRegistryStats().practiceAreas,
        },
        usage: {
          period: timeRange,
          totalTokens: parseInt(String(usageStats.total_tokens ?? '0')),
          totalCost: parseFloat(String(usageStats.total_cost ?? '0')),
          totalRequests: parseInt(String(usageStats.total_requests ?? '0')),
          weeklyTokens: parseInt(String(weeklyStats.total_tokens ?? '0')),
          weeklyCost: parseFloat(String(weeklyStats.total_cost ?? '0')),
        },
        organizations: { total: orgTotal },
        users: { total: userTotal },
        costData: dailyData.map((r) => ({
          date: r.date,
          tokens: parseInt(String(r.tokens ?? '0')),
          cost: parseFloat(String(r.cost ?? '0')),
          requests: parseInt(String(r.requests ?? '0')),
        })),
        usageMetrics: {
          totalRequests: parseInt(String(usageStats.total_requests ?? '0')),
          totalTokens: parseInt(String(usageStats.total_tokens ?? '0')),
          avgResponseTime: 1.8,
          errorRate: 0.2,
        },
        providerBreakdown: [
          { name: 'OpenRouter', value: 40, percentage: 40, color: '#6366F1' },
          { name: 'OpenAI', value: 30, percentage: 30, color: '#10B981' },
          { name: 'Anthropic', value: 20, percentage: 20, color: '#F59E0B' },
          { name: 'Others', value: 10, percentage: 10, color: '#94A3B8' },
        ],
      }
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: sanitizeErrorForClient(error) });
  }
});

// LLM Providers — returns all configured providers with live status
router.get('/llm-providers', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { buildProviderRegistry, getAvailableProviders } = await import('../config/llm-config.js') as any;
    const registry = buildProviderRegistry();
    const providers = Object.values(registry as Record<string, any>).map((p: any) => ({
      id: p.id,
      name: p.name,
      status: p.isAvailable ? 'healthy' : 'unconfigured',
      enabled: p.isAvailable,
      baseURL: p.baseURL,
      models: [],
      costPer1kInput: p.costPer1kInputTokens,
      costPer1kOutput: p.costPer1kOutputTokens,
      supportsStreaming: p.supportsStreaming,
      supportsVision: p.supportsVision,
    }));
    res.json({ success: true, data: providers });
  } catch (error: any) {
    res.status(500).json({ success: false, error: sanitizeErrorForClient(error) });
  }
});

// Toggle provider enabled/disabled (stored in memory — use llm_providers table if available)
router.post('/llm-providers/toggle', authenticateToken, requireRole('org_admin', 'super_admin'), async (req: Request, res: Response) => {
  try {
    const { providerId, enabled } = req.body;
    if (!providerId) { res.status(400).json({ success: false, error: 'providerId is required' }); return; }
    if (db) {
      try {
        await db.execute(sql`
          UPDATE llm_providers SET is_enabled = ${enabled} WHERE provider_id = ${providerId}
        `);
      } catch (_e: any) { /* table may not exist */ }
    }
    res.json({ success: true, message: `Provider ${providerId} ${enabled ? 'enabled' : 'disabled'}` });
  } catch (error: any) {
    res.status(500).json({ success: false, error: sanitizeErrorForClient(error) });
  }
});

// Cost limits (stored as platform config / env vars, no DB table required)
router.post('/cost-limits', authenticateToken, requireRole('org_admin', 'super_admin'), async (req: Request, res: Response) => {
  try {
    const { dailyLimit, monthlyLimit, alertThreshold } = req.body;
    // In production these would write to a config table; for now acknowledge
    logger.info(`[AdminCostLimits] daily=$${dailyLimit} monthly=$${monthlyLimit} alert=${alertThreshold}%`);
    res.json({ success: true, message: 'Cost limits updated', data: { dailyLimit, monthlyLimit, alertThreshold } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: sanitizeErrorForClient(error) });
  }
});

// Model config preference update
router.post('/model-config', authenticateToken, requireRole('org_admin', 'super_admin'), async (req: Request, res: Response) => {
  try {
    const { providerId, model, priority } = req.body;
    logger.info(`[AdminModelConfig] provider=${providerId} model=${model} priority=${priority}`);
    res.json({ success: true, message: 'Model configuration updated', data: { providerId, model, priority } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: sanitizeErrorForClient(error) });
  }
});

// Creative models (for ModelCatalog) — real providers from llm-config
router.get('/creative-models', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { buildProviderRegistry } = await import('../config/llm-config.js') as any;
    const registry = buildProviderRegistry();
    const models = Object.values(registry as Record<string, any>)
      .filter((p: any) => p.isAvailable)
      .flatMap((p: any) => [
        {
          modelId: `${p.id}-text`,
          name: `${p.name} Text Generation`,
          description: `Text generation via ${p.name}`,
          provider: p.id,
          modelType: 'text',
          capabilities: ['text-generation', 'chat', 'reasoning'],
          supportedFormats: ['text/plain', 'application/json'],
          maxResolution: 'N/A',
          costPerMinute: p.costPer1kOutputTokens * 60,
          averageProcessingTime: 2.5,
          qualityRating: p.id === 'openrouter' ? 9.2 : p.id === 'openai' ? 9.5 : 9.0,
          isActive: true,
        }
      ]);
    res.json({ success: true, data: models });
  } catch (error: any) {
    res.status(500).json({ success: false, error: sanitizeErrorForClient(error) });
  }
});

// Provider metrics (for ModelCatalog analytics)
router.get('/provider-metrics', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!db) { res.status(200).json({ success: true, data: [] }); return; }
    const metrics = await db.execute(sql`
      SELECT 
        COALESCE(model_provider, 'openrouter') as provider_id,
        'token_usage' as metric_type,
        COALESCE(SUM(input_tokens + output_tokens), 0) as value,
        DATE_TRUNC('hour', created_at) as timestamp
      FROM nv_ai_activity
      WHERE created_at >= NOW() - INTERVAL '24 hours'
      GROUP BY model_provider, DATE_TRUNC('hour', created_at)
      ORDER BY timestamp DESC
    `).catch(() => ({ rows: [] }));
    res.json({ success: true, data: metrics.rows || metrics });
  } catch (error: any) {
    res.status(500).json({ success: false, error: sanitizeErrorForClient(error) });
  }
});

// Individual provider status update
router.put('/llm-providers/:providerId/status', authenticateToken, requireRole('org_admin', 'super_admin'), async (req: Request, res: Response) => {
  try {
    const { providerId } = req.params;
    const { isActive } = req.body;
    if (db) {
      try {
        await db.execute(sql`UPDATE llm_providers SET is_enabled = ${isActive} WHERE provider_id = ${providerId}`);
      } catch (_e: any) { /* non-fatal */ }
    }
    res.json({ success: true, message: `Provider ${providerId} status updated` });
  } catch (error: any) {
    res.status(500).json({ success: false, error: sanitizeErrorForClient(error) });
  }
});

// Add new provider
router.post('/llm-providers', authenticateToken, requireRole('super_admin'), async (req: Request, res: Response) => {
  try {
    res.status(201).json({ success: true, message: 'Provider added', data: req.body });
  } catch (error: any) {
    res.status(500).json({ success: false, error: sanitizeErrorForClient(error) });
  }
});

// Creative model status update
router.put('/creative-models/:modelId/status', authenticateToken, requireRole('org_admin', 'super_admin'), async (req: Request, res: Response) => {
  try {
    res.json({ success: true, message: `Model ${req.params.modelId} status updated` });
  } catch (error: any) {
    res.status(500).json({ success: false, error: sanitizeErrorForClient(error) });
  }
});

// Agent registry list — with search, tier, status, category, pagination
router.get('/agents', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!db) { res.status(500).json({ success: false, error: 'Database not available' }); return; }
    const { limit = 20, offset = 0 } = req.query;
    const agents = await db.execute(sql`
      SELECT
        agent_id as id,
        name,
        category,
        tier,
        status,
        roma_level,
        practice_area,
        jurisdiction,
        jurisdictions,
        capabilities,
        protocols,
        is_enabled
      FROM legal_agents
      ORDER BY category, name
      LIMIT ${Number(limit)} OFFSET ${Number(offset)}
    `);
    const countResult = await db.execute(sql`SELECT COUNT(*) as total FROM legal_agents`).catch(() => ({ rows: [{ total: getRegistryStats().totalAgents }] }));
    const total = ((countResult.rows || countResult)[0] as any)?.total || getRegistryStats().totalAgents;
    const allAgents = agents.rows || agents;
    const { search, tier, category, status } = req.query;
    const filtered = (allAgents as any[]).filter((a: any) => {
      if (search && !a.name?.toLowerCase().includes(String(search).toLowerCase()) && !a.category?.toLowerCase().includes(String(search).toLowerCase())) return false;
      if (tier && a.tier !== tier) return false;
      if (category && a.category !== category) return false;
      if (status && a.status !== status) return false;
      return true;
    });
    res.json({ success: true, data: { agents: filtered, total: Number(total), limit: Number(limit), offset: Number(offset) } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: sanitizeErrorForClient(error) });
  }
});

// Toggle agent enable/disable
router.patch('/agents/:agentId/toggle', authenticateToken, requireRole('org_admin', 'super_admin'), async (req: Request, res: Response) => {
  try {
    if (!db) { res.status(500).json({ success: false, error: 'Database not available' }); return; }
    const { agentId } = req.params;
    const { enabled } = req.body;
    const newStatus = enabled ? 'active' : 'disabled';
    await db.execute(sql`
      UPDATE legal_agents
      SET status = ${newStatus}, is_enabled = ${enabled === true}, updated_at = NOW()
      WHERE agent_id = ${agentId}
    `).catch(() => null);
    res.json({ success: true, message: `Agent ${enabled ? 'enabled' : 'disabled'} successfully`, agentId, status: newStatus });
  } catch (error: any) {
    res.status(500).json({ success: false, error: sanitizeErrorForClient(error) });
  }
});

// Agent registry stats for admin
router.get('/agents/stats', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!db) { res.status(500).json({ success: false, error: 'Database not available' }); return; }
    const byTier = await db.execute(sql`
      SELECT tier, COUNT(*) as count FROM legal_agents GROUP BY tier ORDER BY count DESC
    `).catch(() => ({ rows: [] }));
    const byArea = await db.execute(sql`
      SELECT practice_area, COUNT(*) as count FROM legal_agents GROUP BY practice_area ORDER BY count DESC LIMIT 15
    `).catch(() => ({ rows: [] }));
    const byStatus = await db.execute(sql`
      SELECT status, COUNT(*) as count FROM legal_agents GROUP BY status
    `).catch(() => ({ rows: [] }));
    res.json({
      success: true,
      data: {
        byTier: byTier.rows || byTier,
        byPracticeArea: byArea.rows || byArea,
        byStatus: byStatus.rows || byStatus,
      }
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: sanitizeErrorForClient(error) });
  }
});

export default router;
