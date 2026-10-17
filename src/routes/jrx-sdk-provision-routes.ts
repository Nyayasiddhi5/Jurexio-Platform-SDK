// NYV-NS-021 (2026-05-05): pre-existing TS errors (gateway runs via tsx).
/**
 * Jurexio Enterprise Platform 3.1.2 — SDK Provision Routes
 * NYV-SDK-PROVISION-001
 *
 * SDK initialization handshake — called by a Jurexio platform on startup.
 * Validates the SDK API key and returns the full configuration payload.
 *
 * Routes:
 *  POST /api/jrx/sdk/provision              — SDK initialization handshake
 *  GET  /api/jrx/sdk/provision/config       — Get current platform config (auth required)
 *  POST /api/jrx/sdk/provision/validate     — Validate key without full provision
 *  POST /api/jrx/sdk/provision/health       — Platform self-report health ping
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import { neon } from '@neondatabase/serverless';
import { createLogger } from '../utils/logger.js';
import { sdkGatewayAuth } from '../middleware/sdk-gateway.js';
import { tenantIsolation } from '../middleware/jrx-tenant-isolation.js';
import { authenticateToken, requireRole } from '../middleware/jrx-auth.js';
import { LEGACY_SDK_KEYS_DEPRECATION } from '../middleware/legacy-deprecation-header.js';
// NV-AUTH-HEADER-001 (2026-05-10): canonical SDK API-key extractor.
import { extractSdkApiKey } from '../middleware/jrx-sdk-auth-header.js';

const logger = createLogger('sdk-provision');
const router = Router();

function getSql() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL not configured');
  return neon(url);
}

function hashKey(rawKey: string): string {
  return crypto.createHash('sha256').update(rawKey).digest('hex');
}

// ─── POST /api/jrx/sdk/provision ─────────────────────────────────────────────

const ProvisionSchema = z.object({
  platform_id: z.string().optional(),
  platform_type: z.string().optional(),
  sdk_version: z.string().optional(),
  runtime: z.string().optional(),
  reported_env: z.string().optional(),
});

router.post('/provision', LEGACY_SDK_KEYS_DEPRECATION, sdkGatewayAuth, tenantIsolation, async (req: Request, res: Response) => {
  try {
    const sql = getSql();
    const parsed = ProvisionSchema.safeParse(req.body);
    const meta = parsed.success ? parsed.data : {};

    // NV-AUTH-HEADER-001 (2026-05-10): use the canonical extractor so this
    // route accepts X-API-Key (primary) and Authorization: Bearer <key>
    // (fallback) identically. Prior to 2026-05-10 this route only parsed
    // the Bearer header, which silently broke X-API-Key callers.
    const rawKey = extractSdkApiKey(req) ?? '';
    const keyHash = hashKey(rawKey);

    // Look up the application via key hash
    const keyRows = await sql`
      SELECT
        k.id as key_id, k.app_id, k.key_type, k.scopes, k.is_active as key_active,
        k.expires_at, k.last_used_at,
        a.id, a.name, a.display_name, a.platform_type, a.tier, a.jurisdiction,
        a.jurisdictions, a.is_active, a.environment, a.modules_enabled,
        a.agents_allowed, a.llm_config, a.rate_limits_config, a.settings,
        a.is_provisioned, a.org_id, a.contact_email
      FROM nv_api_keys k
      JOIN nv_sdk_applications a ON k.app_id = a.id
      WHERE k.key_hash = ${keyHash} AND k.is_active = true
    `;

    if (!keyRows.length) {
      // NYV-NS-012 (2026-05-01): explicit `return` closes CWE-285 — without it
      // the handler kept executing after the 401 response and either threw
      // ERR_HTTP_HEADERS_SENT or hit the DB with an undefined row.
      res.status(401).json({ error: 'NYV-PROV-401: Invalid or revoked SDK key' });
      return;
    }

    const row = keyRows[0];

    if (!row.is_active) {
      res.status(403).json({ error: 'NYV-PROV-403: Platform is suspended' });
      return;
    }

    // Check key expiry
    if (row.expires_at && new Date(row.expires_at as string) < new Date()) {
      res.status(401).json({
        error: 'NYV-PROV-401: SDK key expired',
        expired_at: row.expires_at,
        action: 'Please rotate your SDK key via the Jurexio Enterprise Console',
      });
      return;
    }

    // Update last_used_at and mark provisioned
    await sql`
      UPDATE nv_api_keys SET last_used_at = NOW() WHERE id = ${row.key_id as string}
    `;
    await sql`
      UPDATE nv_sdk_applications
      SET is_provisioned = true, updated_at = NOW()
      WHERE id = ${row.app_id as string}
    `;

    // Fetch active agent list
    const agentRows = await sql`
      SELECT agent_id, name, category, jurisdiction, capabilities, tier_required
      FROM nv_agents
      WHERE is_active = true
      LIMIT 149
    `;

    // Compute capability set from modules
    const modules = (row.modules_enabled as Record<string, boolean>) ?? {};
    const capabilities: string[] = [];
    if (modules.nyayarag) capabilities.push('legal_research', 'rag_query');
    if (modules.doc_intelligence) capabilities.push('document_classify', 'document_extract', 'ocr');
    if (modules.clawdbot) capabilities.push('chatbot_build', 'chatbot_deploy');
    if (modules.openbot) capabilities.push('multichannel_publish', 'whatsapp', 'slack', 'teams');
    if (modules.automateai) capabilities.push('workflow_build', 'dag_execute');
    if (modules.twindesk) capabilities.push('digital_twin', 'simulation');
    if (modules.skillshop) capabilities.push('skills_marketplace', 'skill_execute');
    if (modules.voice_ai) capabilities.push('stt', 'tts', 'voice_chat');
    if (modules.hitl) capabilities.push('hitl_escalate', 'human_review');
    if (modules.sdk_intelligence) capabilities.push('dashboard_insights', 'case_risk', 'portfolio_risk', 'outcome_predict');
    capabilities.push('completions', 'agents_execute', 'memory', 'audit');

    const allowedAgents = row.agents_allowed as string[];
    const filteredAgents = allowedAgents.includes('*')
      ? agentRows
      : agentRows.filter(a => allowedAgents.includes(a.agent_id as string));

    const llmCfg = (row.llm_config as Record<string, unknown>) ?? {};
    const rateCfg = (row.rate_limits_config as Record<string, unknown>) ?? {};

    logger.info('SDK provision handshake complete', {
      app_id: row.app_id,
      platform_type: row.platform_type,
      environment: row.environment,
      sdk_version: meta.sdk_version,
    });

    res.json({
      provision_status: 'ready',
      platform: {
        id: row.app_id,
        name: row.name,
        display_name: row.display_name || row.name,
        platform_type: row.platform_type,
        tier: row.tier,
        jurisdiction: row.jurisdiction,
        jurisdictions: row.jurisdictions,
        environment: row.environment,
        org_id: row.org_id,
      },
      modules_enabled: modules,
      capabilities,
      agents: {
        total: filteredAgents.length,
        list: filteredAgents.map(a => ({
          id: a.agent_id,
          name: a.name,
          category: a.category,
          jurisdiction: a.jurisdiction,
          tier_required: a.tier_required,
        })),
      },
      llm_routing: {
        primary: llmCfg.primary ?? 'claude-sonnet-4-5',
        fallback: llmCfg.fallback ?? 'gpt-4.1',
        budget_mode: llmCfg.budget_mode ?? 'balanced',
        monthly_cap_usd: llmCfg.monthly_cap_usd ?? 1000,
        alert_threshold_pct: llmCfg.alert_threshold_pct ?? 80,
      },
      rate_limits: {
        requests_per_min: rateCfg.requests_per_min ?? 60,
        requests_per_hour: rateCfg.requests_per_hour ?? 2000,
        requests_per_day: rateCfg.requests_per_day ?? 20000,
        tokens_per_day: rateCfg.tokens_per_day ?? 5000000,
        max_concurrent: rateCfg.max_concurrent ?? 20,
      },
      guardrails: {
        pii_redaction: true,
        prompt_enforcement: true,
        response_enforcement: true,
        audit_logging: true,
        jurisdiction_check: true,
      },
      sdk_endpoints: {
        base_url: `${process.env.NYV_PUBLIC_URL ?? ''}/api/nv`,
        completions: '/api/jrx/completions',
        agents: '/api/jrx/agents',
        intelligence: '/api/jrx/v1/sdk/intelligence',
        gateway: '/api/jrx/gateway',
        rag: '/api/jrx/rag',
        documents: '/api/jrx/documents',
        memory: '/api/jrx/memory',
        patterns: '/api/jrx/patterns',
      },
      provisioned_at: new Date().toISOString(),
      key_expires_at: row.expires_at ?? null,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('SDK provision error', { error: msg });
    res.status(500).json({ error: 'NYV-PROV-500: Provision failed', detail: msg });
  }
});

// ─── POST /api/jrx/sdk/provision/validate ────────────────────────────────────

// NYV-AUDIT-F9 (2026-05-05): rewritten to query CANONICAL v5 tables
// (public.sdk_app_api_keys + public.sdk_applications) instead of legacy
// (nv_api_keys + nv_sdk_applications, which only hold the 14 pre-v5 keys).
// All 7 v5 SDK keys (NSP, NSPM, NSI, NSM, NSA, NYM, JRX) live in the canonical
// tables; calling /provision/validate against a v5 key with the legacy SQL
// returned `{valid:false,reason:"Key not found"}` even for known-good keys.
// `key_type` is derived from key_prefix (`nyv_live_*`=live, `nyv_test_*`=test).
// `environment` is derived from metadata.environment with sensible default.
router.post('/provision/validate', async (req: Request, res: Response) => {
  try {
    const sql = getSql();
    const schema = z.object({ api_key: z.string().min(20) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'NYV-PROV-VAL-001: api_key required' });

    const keyHash = hashKey(parsed.data.api_key);
    // NYV-AUDIT-F11 (2026-05-05): explicit ::int casts for booleans because
    // @neondatabase/serverless returns Postgres BOOLEAN as the literal value
    // false for true rows under the http-fetch transport (verified 2026-05-05:
    // `SELECT is_active FROM sdk_app_api_keys WHERE id=1` → false in neon,
    // → 't' in psql for the SAME row). Drizzle is unaffected. Casting to int
    // ensures a deterministic 1/0 wire value the client can compare safely.
    const rows = await sql`
      SELECT k.id,
             (k.is_active)::int AS is_active_int,
             k.expires_at, k.key_prefix, k.scopes,
             a.app_name, a.app_type, a.metadata,
             COALESCE(a.status, 'active') AS app_status
      FROM public.sdk_app_api_keys k
      JOIN public.sdk_applications a ON k.application_id = a.id
      WHERE k.key_hash = ${keyHash}
    `;

    if (!rows.length) return res.json({ valid: false, reason: 'Key not found' });
    const r = rows[0];
    if (Number(r.is_active_int) !== 1) return res.json({ valid: false, reason: 'Key revoked' });
    if (r.app_status !== 'active') return res.json({ valid: false, reason: 'Platform suspended' });
    if (r.expires_at && new Date(r.expires_at as string) < new Date()) {
      return res.json({ valid: false, reason: 'Key expired', expired_at: r.expires_at });
    }

    const keyType = (r.key_prefix as string)?.startsWith('nyv_live_') ? 'live'
                   : (r.key_prefix as string)?.startsWith('nyv_test_') ? 'test' : 'unknown';
    const env = (r.metadata as any)?.environment ?? (keyType === 'live' ? 'production' : 'sandbox');

    return res.json({
      valid: true,
      platform_name: r.app_name,
      platform_type: r.app_type,
      environment: env,
      key_type: keyType,
      scopes: r.scopes ?? [],
      expires_at: r.expires_at ?? null,
    });
  } catch (err: unknown) {
    // NYV-PROV-VAL-DEFENSIVE-001 (2026-05-07): /provision/validate exists for one
    // purpose — answer "is this key valid, yes or no?". An internal exception
    // (e.g. @neondatabase/serverless processQueryResult crash on edge-case
    // result shapes — observed when a non-key string is hashed and the lookup
    // returns 0 rows in a way the http-fetch parser stumbles on) MUST NOT leak
    // as HTTP 500. Treat it the same as "key not found" so callers get a stable
    // 200 + {valid:false} contract regardless of upstream library bugs.
    const msg = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : '';
    logger.warn('NYV-PROV-VAL-EXC: treating validation exception as invalid key', { error: msg, stack });
    return res.json({ valid: false, reason: 'Key not validatable' });
  }
});

// ─── POST /api/jrx/sdk/provision/health ──────────────────────────────────────

router.post('/provision/health', sdkGatewayAuth, tenantIsolation, async (req: Request, res: Response) => {
  try {
    // NYV-AUDIT-F5 (2026-05-05): forward-compatible. Allow extra fields so
    // future SDK versions can ship richer health payloads without triggering
    // false 400s at the gateway.
    const schema = z.object({
      status: z.enum(['healthy', 'degraded', 'down']),
      uptime_seconds: z.number().optional(),
      sdk_version: z.string().optional(),
      active_connections: z.number().optional(),
    }).passthrough();
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: 'NYV-PROV-VAL-002: Invalid health payload' }); return; }

    logger.info('Platform health ping received', { body: parsed.data });
    res.json({
      acknowledged: true,
      server_time: new Date().toISOString(),
      message: `Platform health status "${parsed.data.status}" recorded`,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: 'NYV-PROV-500: Health ping failed', detail: msg });
  }
});

// ─── POST /api/jrx/sdk/create-app — Single-Click SDK App Creation ────────────

const CreateAppSchema = z.object({
  name: z.string().min(3).max(100),
  display_name: z.string().min(3).max(200).optional(),
  platform_type: z.enum(['nyayamitra', 'professional', 'institutional', 'academy', 'ministry']).default('professional'),
  tier: z.enum(['free', 'solo', 'plus', 'pro', 'enterprise', 'internal']).default('pro'),
  jurisdiction: z.enum(['IN', 'UK', 'GC', 'EU', 'US', 'SG']).default('IN'),
  contact_email: z.string().email(),
  org_name: z.string().optional(),
  modules: z.object({
    nyayarag: z.boolean().default(true),
    doc_intelligence: z.boolean().default(true),
    clawdbot: z.boolean().default(false),
    openbot: z.boolean().default(false),
    automateai: z.boolean().default(false),
    twindesk: z.boolean().default(false),
    skillshop: z.boolean().default(false),
    voice_ai: z.boolean().default(false),
    hitl: z.boolean().default(true),
    sdk_intelligence: z.boolean().default(true),
  }).optional(),
  // NYV-NS-013 (2026-05-01) — explicit opt-in for wildcard scopes; only
  // honored when caller is super_admin. Default scopes are least-privilege.
  scopes: z.array(z.string().min(1).max(64)).max(32).optional(),
  wildcard_override: z.boolean().optional(),
});

// NYV-NS-013 (2026-05-01) — least-privilege defaults matching the runtime
// scope set documented in SDK-DEV-EC2-ACCESS §10.1.
const DEFAULT_CREATE_APP_SCOPES = ['agents:read', 'agents:execute', 'research:read'];

router.post('/create-app', LEGACY_SDK_KEYS_DEPRECATION, authenticateToken, requireRole('developer', 'org_admin', 'super_admin', 'admin'), async (req: Request, res: Response) => {
  try {
    const parsed = CreateAppSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'NYV-CREATE-VAL-001: Invalid app creation payload',
        validation: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    const { name, display_name, platform_type, tier, jurisdiction, contact_email, org_name, modules } = parsed.data;
    const requestedScopes = parsed.data.scopes;
    const wildcardOverride = parsed.data.wildcard_override === true;

    const userRole = (req as any).user?.role ?? '';
    const restrictedTiers = ['enterprise', 'internal'];
    if (restrictedTiers.includes(tier) && !['super_admin', 'admin'].includes(userRole)) {
      res.status(403).json({
        error: 'NYV-CREATE-AUTHZ-001: Insufficient privileges for requested tier',
        detail: `Tier "${tier}" requires super_admin or admin role`,
      });
      // NYV-NS-012 (2026-05-01) — explicit return closes the CWE-285
      // broken-access-control bug: prior code kept executing and minted
      // a real key + DB row despite responding 403 to the caller.
      return;
    }

    // NYV-NS-013 (2026-05-01) — wildcard scopes are an opt-in superpower.
    // Only super_admin can opt in, and only when wildcard_override === true.
    let resolvedScopes: string[];
    if (wildcardOverride) {
      if (userRole !== 'super_admin') {
        res.status(403).json({
          error: 'NYV-CREATE-AUTHZ-002: wildcard_override requires super_admin',
          detail: 'Only super_admin may mint keys with wildcard scopes',
        });
        return;
      }
      resolvedScopes = ['*'];
    } else if (Array.isArray(requestedScopes) && requestedScopes.length > 0) {
      // Caller supplied explicit scopes — honor them, but block the wildcard.
      if (requestedScopes.includes('*')) {
        res.status(400).json({
          error: 'NYV-CREATE-VAL-002: bare "*" scope rejected',
          detail: 'Use wildcard_override:true (super_admin only) to mint a wildcard key',
        });
        return;
      }
      resolvedScopes = requestedScopes;
    } else {
      resolvedScopes = [...DEFAULT_CREATE_APP_SCOPES];
    }

    const sqlDb = getSql();
    const appId = crypto.randomUUID();
    const keyId = crypto.randomUUID();
    const createdBy = (req as any).user?.id ?? null;

    const prefix = tier === 'free' ? 'nyv_test_sk_' : 'nyv_live_sk_';
    const rawKey = `${prefix}${crypto.randomBytes(32).toString('hex')}`;
    const keyHash = hashKey(rawKey);

    const defaultModules = {
      nyayarag: true, doc_intelligence: true, clawdbot: false,
      openbot: false, automateai: false, twindesk: false,
      skillshop: false, voice_ai: false, hitl: true, sdk_intelligence: true,
    };
    const enabledModules = modules ?? defaultModules;

    const allJurisdictions = ['IN', 'UK', 'GC', 'EU', 'US', 'SG'];
    const agentsAllowed = ['*'];

    const defaultRateLimits = {
      free: { rpm: 10, rpd: 500 },
      solo: { rpm: 20, rpd: 2000 },
      plus: { rpm: 40, rpd: 5000 },
      pro: { rpm: 60, rpd: 20000 },
      enterprise: { rpm: 600, rpd: 200000 },
      internal: { rpm: 9999, rpd: 999999 },
    };

    const jurisdictionsArr = `{${allJurisdictions.join(',')}}`;
    const agentsAllowedArr = `{${agentsAllowed.join(',')}}`;
    // NYV-NS-013 (2026-05-01) — was hardcoded to '{*}' (wildcard everything),
    // now uses the caller-aware resolvedScopes set built above.
    const scopesArr = `{${resolvedScopes.join(',')}}`;

    await sqlDb`
      INSERT INTO nv_sdk_applications (
        id, name, display_name, app_type, platform_type, tier, jurisdiction,
        jurisdictions, contact_email, is_active, environment,
        modules_enabled, agents_allowed, rate_limits_config, is_provisioned,
        created_at, updated_at
      ) VALUES (
        ${appId}, ${name}, ${display_name ?? name}, ${platform_type}, ${platform_type}, ${tier}, ${jurisdiction},
        ${jurisdictionsArr}::text[], ${contact_email}, true, ${tier === 'free' ? 'sandbox' : 'production'},
        ${JSON.stringify(enabledModules)}::jsonb, ${agentsAllowedArr}::text[], ${JSON.stringify(defaultRateLimits[tier])}::jsonb, true,
        NOW(), NOW()
      )
    `;

    await sqlDb`
      INSERT INTO nv_api_keys (
        id, app_id, key_hash, key_prefix, name, permissions, is_active,
        created_at
      ) VALUES (
        ${keyId}, ${appId}, ${keyHash},
        ${rawKey.substring(0, 16)}, ${tier === 'free' ? 'test-key' : 'live-key'}, ${scopesArr}::text[], true,
        NOW()
      )
    `;

    // ── NYV-NS-002 (2026-05-01) ─────────────────────────────────────────
    // DUAL-WRITE to the canonical tables that nv-sdk-gateway middleware
    // actually reads (sdk_applications + sdk_app_api_keys). Without this,
    // every key minted here is INVISIBLE at runtime. The legacy inserts
    // above are kept for backwards compat with the keylife routes; both
    // sets are reconciled by drizzle/0006_unify_sdk_key_tables.sql, and
    // the legacy tables are slated for drop post-GA.
    let canonicalAppId: number | null = null;
    try {
      const canonicalApp = await sqlDb`
        INSERT INTO sdk_applications (
          app_name, app_type, description, client_id,
          client_secret_hash, client_secret_prefix, jurisdiction,
          status, metadata, created_at, updated_at
        ) VALUES (
          ${name}, ${platform_type},
          ${`Provisioned via single-click (legacy_uuid=${appId})`},
          ${`legacy_${appId.replace(/-/g, '')}`},
          ${keyHash}, ${rawKey.substring(0, 8)}, ${jurisdiction},
          'active',
          ${JSON.stringify({ tier, modules_enabled: enabledModules, legacy_uuid: appId })}::jsonb,
          NOW(), NOW()
        )
        ON CONFLICT (client_id) DO UPDATE SET updated_at = NOW()
        RETURNING id
      `;
      canonicalAppId = (canonicalApp[0] as { id: number } | undefined)?.id ?? null;

      if (canonicalAppId !== null) {
        await sqlDb`
          INSERT INTO sdk_app_api_keys (
            application_id, key_hash, key_prefix, name,
            scopes, is_active, created_at
          ) VALUES (
            ${canonicalAppId}, ${keyHash}, ${rawKey.substring(0, 16)},
            ${tier === 'free' ? 'test-key' : 'live-key'},
            ${JSON.stringify(resolvedScopes)}::jsonb,
            true, NOW()
          )
          ON CONFLICT (key_hash) DO NOTHING
        `;
        await sqlDb`
          INSERT INTO nyv_sdk_legacy_id_map (legacy_uuid, canonical_id, table_name)
            VALUES (${appId}, ${canonicalAppId}, 'sdk_applications')
            ON CONFLICT (legacy_uuid) DO NOTHING
        `.catch(() => { /* mapping table may not exist on pre-0006 envs */ });
      }
    } catch (dualErr: unknown) {
      const dualMsg = dualErr instanceof Error ? dualErr.message : String(dualErr);
      logger.error('NYV-NS-002 canonical dual-write failed (legacy insert succeeded)', {
        appId, error: dualMsg,
      });
    }

    logger.info('Single-click SDK app created', {
      appId, canonicalAppId, name, tier, jurisdiction, platform_type,
    });

    // NYV-NS-014 (2026-05-01) — quickstart block was returning the marketing
    // host (api.nyayavigya.in), the wrong execute path (no :agentId segment),
    // and the wrong body field (`task` instead of `prompt`). Now derived from
    // the live request and matches what /agents/:id/execute actually accepts.
    const proto = (req.headers['x-forwarded-proto'] as string)?.split(',')[0]?.trim() || req.protocol || 'https';
    const host = (req.headers['x-forwarded-host'] as string) || req.get('host') || 'localhost:5000';
    const liveBaseUrl = `${proto}://${host}`;

    res.status(201).json({
      success: true,
      app_id: appId,
      canonical_app_id: canonicalAppId,
      api_key: rawKey,
      key_type: tier === 'free' ? 'test' : 'live',
      scopes: resolvedScopes,
      provision_status: 'ready',
      platform: {
        name,
        display_name: display_name ?? name,
        platform_type,
        tier,
        jurisdiction,
        jurisdictions: allJurisdictions,
        modules_enabled: enabledModules,
        rate_limits: defaultRateLimits[tier],
        agents_allowed: '*',
        total_agents: 1043,
      },
      quickstart: {
        base_url: liveBaseUrl,
        auth_header: 'Authorization: Bearer <api_key>   (or x-api-key: <api_key>)',
        provision_endpoint: 'POST /api/jrx/sdk/provision',
        provision_validate: 'POST /api/jrx/sdk/provision/validate',
        agents_list: 'GET /api/jrx/gateway/agents',
        agent_execute: 'POST /api/jrx/gateway/agents/:agentId/execute   (body: { prompt, jurisdiction })',
        research_query: 'POST /api/jrx/gateway/research/query   (body: { query, jurisdiction })',
        sdk_download: `GET ${liveBaseUrl}/downloads/sdk/client-sdk/5.0.0.tgz`,
        npm_package: '@jurexio/client-sdk',
        package_version: '5.0.0',
        docs: 'See docs/v3.1.2/SDK-DEV-EC2-ACCESS-2026-05-01.md and SDK-RELEASE-2026-05-03.md',
        example: `import { NyvClient } from '@jurexio/client-sdk';\nconst nyv = new NyvClient({ apiKey: '${rawKey.substring(0, 20)}...', baseUrl: '${liveBaseUrl}' });\nconst result = await nyv.agents.execute({ agentId: 'contract-specialist', prompt: 'Review this NDA', jurisdiction: '${jurisdiction}' });`,
      },
      created_at: new Date().toISOString(),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('SDK app creation failed', { error: msg });
    res.status(500).json({ error: 'NYV-CREATE-500: App creation failed', detail: msg });
  }
});

export default router;
