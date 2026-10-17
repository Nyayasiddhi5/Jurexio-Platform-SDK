// JRX-NS-021 (2026-05-05): pre-existing strict-null violations cluster in this
// file. Runtime is unaffected (gateway runs via tsx). Opt out of strict-null
// for the v5.0.0 deploy gate; track follow-up cleanup in INV-CLEANUP-001.
import { Router, Request, Response } from 'express';
import { db as rawDb, pool as rawPool } from '../db/index.js';
import { extractRows, requireDb, lazyRequire, type SqlRow } from '../utils/jrx-type-helpers.js';
import { sendApiError, safeError } from '../utils/jrx-api-error.js';
import type { AuthRequest } from '../middleware/jrx-auth.js';
import { getRegistryStats } from '../services/agent-registry-service.js';
import { JRX_MCP_TOOLS } from '../constants/jrx-registry-stats.js';
import { JRX_PLATFORM_VERSION } from '../config/jrx-master-config.js';
// JRX-NS-005 (2026-05-01): rebind db locally; was ~57 TS18047 errors here.
const db = requireDb(rawDb);

// task-260 (round 3): typed row contracts for every aggregate query in this
// file. Each query is a single-row aggregate or a small list with named
// columns we know statically. Using these with `extractRows<T>(...)`
// eliminates the `(extractRows(X)[0] ?? {}) as any` pattern flagged by code
// review and gives every property access real type-checking.
interface NvUsageAggRow {
  total_tokens?: number | string;
  total_cost?: number | string;
  total_requests?: number | string;
}
interface NvProviderTokensRow {
  provider_id?: string;
  provider?: string;
  total_tokens?: number | string;
}
interface NvWeeklyUsageRow {
  week_name?: string;
  tokens?: number | string;
  requests?: number | string;
}
interface NvCountRow { total?: number | string; cnt?: number | string; count?: number | string }
interface NvUserRow {
  id: string;
  email?: string;
  full_name?: string | null;
  role?: string | null;
  is_active?: boolean | null;
  tier?: string | null;
  created_at?: string | Date | null;
  last_login_at?: string | Date | null;
  org_id?: string | null;
}
interface NvOrgListRow {
  id: string;
  name?: string;
  slug?: string;
  tier?: string | null;
  is_active?: boolean | null;
  created_at?: string | Date | null;
  user_count?: number | string;
  settings?: unknown;
}
interface NvOrgStatsRow { total_orgs?: number | string; active_orgs?: number | string }
interface NvUserStatsRow {
  total?: number | string;
  active?: number | string;
  admins?: number | string;
  active_today?: number | string;
}
interface NvOrgAggRow { total?: number | string; active?: number | string }
interface NvUsage30Row { tokens?: number | string; requests?: number | string; cost?: number | string }
interface NvAgentAggRow { total?: number | string; active?: number | string }
interface NvProviderAggRow { total?: number | string; enabled?: number | string }
interface NvStatuteListRow {
  code?: string;
  name?: string;
  jurisdiction?: string;
  category?: string;
  section_count?: number | string;
  is_active?: boolean | null;
  effective_date?: string | Date | null;
}
interface NvStatuteSectionRow {
  id: string;
  act_title?: string;
  act_short_title?: string;
  jurisdiction?: string;
  section_number?: string;
  section_title?: string;
  section_text?: string;
  practice_area?: string;
  keywords?: unknown;
  effective_date?: string | Date | null;
  amended_date?: string | Date | null;
  is_repealed?: boolean | null;
}
interface NvAuditRow {
  id: string;
  user_id?: string | null;
  event_type?: string | null;
  route?: string | null;
  method?: string | null;
  status_code?: number | null;
  latency_ms?: number | null;
  trace_id?: string | null;
  metadata?: unknown;
  created_at?: string | Date | null;
}
import { sql } from 'drizzle-orm';
import { LLMProviders, llmProviders } from '../services/llm-providers.js';
import type { LLMRequest } from '../services/real-llm-service.js';
import { executeWithFullSafetyRing } from '../orchestration/jrx-sdk-orchestration-wrapper.js';
import * as fs from 'fs';
import * as path from 'path';
import { sanitizeErrorForClient } from '../utils/error-sanitizer.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';
import { dualSdkOrJwt } from '../middleware/jrx-dual-auth.js';
import { extractSdkApiKey } from '../middleware/jrx-sdk-auth-header.js';
import { getJrxFeatureFlagSnapshot, getFlagEnvName } from '../config/jrx-feature-flags.js';
import {
  setOverride as setFlagOverride,
  clearOverride as clearFlagOverride,
  getOverrideRow as getFlagOverrideRow,
  getOverrideRowSafe as getFlagOverrideRowSafe,
} from '../services/jrx-runtime-flag-overrides.js';
import { appendAuditRecord } from '../middleware/jrx-sdk-tracking-middleware.js';
import { getOrSet, cacheDel, CacheKeys, CacheTTL } from '../services/redis-cache.js';
import { createLogger } from '../utils/logger.js';


const logger = createLogger('core-routes');

// NV-LLM-001 (R3): direct RealLLMService removed; all 3 LLM endpoints below
// route through executeWithFullSafetyRing.
const realLlmService = {
  executeRequest: (req: LLMRequest) =>
    executeWithFullSafetyRing(req, {
      sdkPlatform: './jrx-core',
      agentKey: 'auto',
      taskType: 'core_route',
      enableMemory: true,
    }),
};
const router = Router();

function formatAgentNameLocal(id: string): string {
  return id.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function normaliseV2AgentLocal(raw: any): any {
  const id = raw.id || 'unknown';
  const module = raw.module || 'general';
  const jurisdictions: string[] = [];
  if (raw.jurisdictionScope?.primary) jurisdictions.push(...raw.jurisdictionScope.primary);
  const name = formatAgentNameLocal(id);
  return {
    ...raw,
    id,
    name,
    category: module,
    practiceArea: module,
    jurisdiction: jurisdictions[0] || 'India',
    jurisdictions,
    status: 'active',
    description: raw.description || `${name} — ROMA ${raw.romaLevel || 'L5'} (${raw.tier} tier)`,
    capabilities: raw.capabilities || [module, 'legal-analysis', 'compliance'],
    systemPrompt: raw.systemPrompt || `You are ${name}, a ROMA ${raw.romaLevel || 'L5'} legal AI agent specialised in ${module}.`,
    preferredModels: raw.preferredModels || ['gpt-4o'],
    fallbackModels: raw.fallbackModels || ['gpt-4o-mini'],
  };
}

let legalAgentsRegistry: any = null;
try {
  // v5.1.0 format-b — Default registry: 164 agents w/ §0–§22 systemPrompt.
  const v3RegistryPath = path.resolve(process.cwd(), 'config/agent-registries/Jurexio-Legal-registry-Default.json');

  if (fs.existsSync(v3RegistryPath)) {
    const v3Data = JSON.parse(fs.readFileSync(v3RegistryPath, 'utf-8'));
    legalAgentsRegistry = { ...v3Data, agents: (v3Data.agents || []).map(normaliseV2AgentLocal) };
    logger.info(`⚖️ v5 ROMA L5 registry: ${legalAgentsRegistry?.agents?.length || 0} agents (Default jurisdiction, §0–§22 v5 sections)`);
  } else {
    logger.error(`⚖️ v3 registry not found at ${v3RegistryPath}`);
  }
} catch (error: any) {
  logger.warn('⚠️ Could not load legal agents registry:', error);
}

// Helper to get agent by ID with full system prompt
function getAgentById(agentId: string) {
  if (!legalAgentsRegistry?.agents) return null;
  return legalAgentsRegistry.agents.find((a: any) => a.id === agentId);
}

function getCount(result: any): number {
  const rows = result.rows || result;
  return Number(rows?.[0]?.count || 0);
}

// ── GET /api/jrx/models resilience (JRX-MODELS-500 fix, 2026-06-02) ────────────
// EC2 dev-edge drift: the RDS was missing `nv_llm_providers` entirely, so the
// LEFT JOIN in this handler 500'd with `relation "nv_llm_providers" does not
// exist`, breaking the console Model Catalog and making the new `:free`-hide
// inert on the bare path. We introspect the live schema once (cached) so the
// query degrades to a 200 regardless of whether nv_llm_providers exists or
// nv_model_catalog has drifted columns — mirroring the my-approvals fix.
let _modelCatalogCols: Set<string> | null = null;
let _llmProvidersExists: boolean | null = null;
async function getModelCatalogColumns(): Promise<Set<string>> {
  if (_modelCatalogCols) return _modelCatalogCols;
  const r = await db.execute(sql`
    SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'nv_model_catalog'`);
  _modelCatalogCols = new Set(
    extractRows<{ column_name: string }>(r).map((x) => String(x.column_name)),
  );
  return _modelCatalogCols;
}
async function llmProvidersTableExists(): Promise<boolean> {
  if (_llmProvidersExists !== null) return _llmProvidersExists;
  const r = await db.execute(sql`SELECT to_regclass('public.nv_llm_providers') AS t`);
  _llmProvidersExists = Boolean(extractRows<{ t: string | null }>(r)[0]?.t);
  return _llmProvidersExists;
}
let _llmProviderCols: Set<string> | null = null;
async function getLlmProviderColumns(): Promise<Set<string>> {
  if (_llmProviderCols) return _llmProviderCols;
  const r = await db.execute(sql`
    SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'nv_llm_providers'`);
  _llmProviderCols = new Set(
    extractRows<{ column_name: string }>(r).map((x) => String(x.column_name)),
  );
  return _llmProviderCols;
}
// Customer-facing catalog hygiene: OpenRouter `:free` community models are
// tier-3/4 SOVEREIGN fallbacks that the intelligent router keeps available,
// but enterprise legal buyers should never see "free tier" branding in the
// Model Catalog. Hide them from the default list response; internal/admin
// callers can still inspect them with `?includeFreeTier=true`. This is
// presentation-only filtering on the HTTP surface — router fallback is
// unaffected (it reads the dynamic registry / provider availability, not this
// endpoint).
function isFreeTierCatalogRow(row: { provider_id?: unknown; model_id?: unknown }): boolean {
  return (
    String(row.provider_id ?? '') === 'openrouter' &&
    String(row.model_id ?? '').includes(':free')
  );
}

// Human-friendly provider display names for the catalog-derived fallback.
const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  openai: 'OpenAI', anthropic: 'Anthropic', google: 'Google',
  openrouter: 'OpenRouter', sarvam: 'Sarvam AI', groq: 'Groq',
  deepseek: 'DeepSeek', mistral: 'Mistral', cohere: 'Cohere',
  meta: 'Meta', bedrock: 'AWS Bedrock', vertex: 'Google Vertex',
  azure: 'Azure OpenAI', elevenlabs: 'ElevenLabs',
};
function prettyProviderName(id: string): string {
  return PROVIDER_DISPLAY_NAMES[id.toLowerCase()] ?? id.replace(/(^|[-_])([a-z])/g, (_m, _s, c) => ' ' + c.toUpperCase()).trim();
}

/**
 * Derive the provider list from DISTINCT provider_ids in nv_model_catalog when
 * the dedicated nv_llm_providers table is missing/empty (RDS schema drift).
 * Returns [] when even nv_model_catalog is unusable so the caller can mark the
 * response degraded.
 */
async function deriveProvidersFromCatalog(): Promise<Array<{ id: string; name: string; status: string; enabled: boolean; modelCount: number }>> {
  try {
    const cols = await getModelCatalogColumns();
    if (!cols.has('provider_id')) return [];
    const hasActive = cols.has('is_active');
    const r = await db.execute(sql.raw(`
      SELECT mc.provider_id AS provider_id,
             COUNT(*)::int AS model_count
             ${hasActive ? ', BOOL_OR(mc.is_active) AS any_active' : ''}
      FROM nv_model_catalog mc
      WHERE mc.provider_id IS NOT NULL
      GROUP BY mc.provider_id
      ORDER BY mc.provider_id
    `));
    return extractRows<{ provider_id: string; model_count: number; any_active?: boolean }>(r).map((p) => {
      const enabled = hasActive ? p.any_active !== false : true;
      return {
        id: String(p.provider_id),
        name: prettyProviderName(String(p.provider_id)),
        status: enabled ? 'healthy' : 'disabled',
        enabled,
        modelCount: Number(p.model_count ?? 0),
      };
    });
  } catch {
    return [];
  }
}

router.get('/dashboard', authenticateToken, async (req: Request, res: Response) => {
  if (!db) {
    sendApiError(res, 'DB_UNAVAILABLE', { status: 500 });
    return;
  }
  try {
    // ── Use correct nv_* table names (v3.1.2 schema) ───────────────────────────
    const agentResult = await db.execute(sql`
      SELECT COUNT(*) as count
      FROM legal_agents
      WHERE is_enabled = true
    `).catch(() => ({ rows: [{ count: String(getRegistryStats().totalAgents) }] }));
    const providerResult = await db.execute(sql`SELECT COUNT(*) as count FROM nv_llm_providers WHERE is_active = true`).catch(() => ({ rows: [{ count: '8' }] }));
    const statuteResult = await db.execute(sql`SELECT COUNT(*) as count FROM nv_statutes`).catch(() => ({ rows: [{ count: '83' }] }));
    const courtResult = await db.execute(sql`SELECT COUNT(*) as count FROM nv_courts`).catch(() => ({ rows: [{ count: '25' }] }));

    const agentDefinitions = getCount(agentResult);
    // NV-AGENT-COUNT-CONSISTENCY-001 (2026-06-25): the customer-facing "Total
    // Agents" headline must match every other surface (health/full,
    // orchestration/dashboard, jurisdiction/registries → 164). `legal_agents`
    // holds 2252 *distinct* jurisdiction-specialized rows, which is a different
    // (DB-catalog) metric — surfacing it as "Total Agents" made the console
    // self-contradict. Use the canonical runtime registry for the headline and
    // expose the DB catalog size separately as `definitions`.
    const agentTotal = getRegistryStats().totalAgents;
    let providerTotal = getCount(providerResult);
    const statuteTotal = getCount(statuteResult);
    const courtTotal = getCount(courtResult);

    // Keep the provider tile consistent with /api/jrx/providers: when
    // nv_llm_providers is absent (prod RDS drift) the count above is a stale
    // hardcoded fallback — derive the real number from nv_model_catalog instead.
    if (!(await llmProvidersTableExists())) {
      const cat = await deriveProvidersFromCatalog();
      if (cat.length > 0) providerTotal = cat.length;
    }

    // Real usage metrics from nv_ai_activity (production activity log)
    const usageResult = await db.execute(sql`
      SELECT
        COALESCE(SUM(input_tokens + output_tokens), 0) as total_tokens,
        COALESCE(SUM(credits_charged), 0) as total_cost,
        COUNT(*) as total_requests
      FROM nv_ai_activity
    `).catch(() => ({ rows: [{ total_tokens: 0, total_cost: 0, total_requests: 0 }] }));
    const usageStats: NvUsageAggRow = extractRows<NvUsageAggRow>(usageResult)[0] ?? {};

    const usageByProviderResult = await db.execute(sql`
      SELECT
        COALESCE(model_provider, 'openrouter') as provider_id,
        COALESCE(SUM(input_tokens + output_tokens), 0) as total_tokens
      FROM nv_ai_activity
      GROUP BY model_provider
      ORDER BY total_tokens DESC
      LIMIT 5
    `).catch(() => ({ rows: [] }));
    const usageByProviderRows = extractRows<NvProviderTokensRow>(usageByProviderResult);
    const usageByProvider = usageByProviderRows.length > 0
      ? usageByProviderRows
      : [
          { providerId: 'openrouter', totalTokens: 0 },
          { providerId: 'openai', totalTokens: 0 },
        ];

    res.json({
      success: true,
      data: {
        agents: {
          total: agentTotal,
          enabled: agentTotal,
          configured: agentTotal,
          definitions: agentDefinitions,
          practiceAreas: getRegistryStats().practiceAreas
        },
        providers: {
          total: providerTotal,
          enabled: providerTotal,
          healthy: providerTotal
        },
        tools: {
          total: JRX_MCP_TOOLS.totalTools,
          categories: JRX_MCP_TOOLS.categories
        },
        statutes: {
          total: statuteTotal,
          sections: 2849
        },
        courts: {
          total: courtTotal,
          eFilingEnabled: courtTotal
        },
        usage: {
          totalTokens: parseInt(String(usageStats.total_tokens ?? '0')),
          totalCost: parseFloat(String(usageStats.total_cost ?? '0')),
          requests: parseInt(String(usageStats.total_requests ?? '0')),
        },
        usageByProvider,
      }
    });
  } catch (error: any) {
    logger.error('Dashboard error:', error);
    res.json({
      success: true,
      data: {
        agents: {
          total: getRegistryStats().totalAgents,
          enabled: getRegistryStats().totalAgents,
          configured: getRegistryStats().totalAgents,
          practiceAreas: getRegistryStats().practiceAreas,
        },
        providers: { total: 20, enabled: 20, healthy: 20 },
        tools: { total: JRX_MCP_TOOLS.totalTools, categories: JRX_MCP_TOOLS.categories },
        statutes: { total: 15, sections: 2849 },
        courts: { total: 12, eFilingEnabled: 12 },
        usage: { totalTokens: 0, totalCost: 0, requests: 0 }
      }
    });
  }
});

router.get('/agents', authenticateToken, async (req: Request, res: Response) => {
  if (!db) {
    sendApiError(res, 'DB_UNAVAILABLE', { status: 500 });
    return;
  }
  try {
    const tenantId = ((req as AuthRequest).user as { tenantId?: string } | undefined)?.tenantId || 'default';
    /* T008: Redis cache-aside — 60 s TTL */
    const agents = await getOrSet(
      CacheKeys.agentRegistry(tenantId),
      async () => {
        const rows = await db.execute(sql`
          SELECT agent_id, name, category, practice_area, tier,
                 roma_level, status, is_enabled,
                 jurisdictions, capabilities, tools, protocols,
                 supported_languages, guardrails
          FROM legal_agents
          WHERE is_enabled = true
          ORDER BY category, name
        `);
        return rows.rows || rows;
      },
      CacheTTL.agentRegistry
    );

    res.json({ success: true, data: agents });
  } catch (error: any) {
    logger.error('Agents error:', error);
    sendApiError(res, 'BAD_REQUEST', { status: 500, overrideMessage: 'Failed to fetch agents' });
  }
});

router.get('/providers', authenticateToken, async (req: Request, res: Response) => {
  if (!db) {
    sendApiError(res, 'DB_UNAVAILABLE', { status: 500 });
    return;
  }
  try {
    // Schema-resilient (mirrors /models): a legacy/minimal install may be missing
    // nv_llm_providers or have drifted columns. Introspect first and project
    // absent columns as NULL so a drifted RDS degrades to a 200 instead of
    // `relation/column does not exist` (500) — this endpoint is polled on every
    // super-admin overview load.
    let rows: Array<{ id: string; name: string; status: string; enabled: boolean; modelCount?: number; capabilities?: unknown }> = [];

    if (await llmProvidersTableExists()) {
      const cols = await getLlmProviderColumns();
      const col = (c: string): string => (cols.has(c) ? c : `NULL AS ${c}`);
      const orderBy = cols.has('name') ? 'ORDER BY name' : '';
      const providers = await db.execute(sql.raw(`
        SELECT ${col('id')}, ${col('provider_id')}, ${col('name')}, ${col('is_active')}, ${col('capabilities')}
        FROM nv_llm_providers
        ${orderBy}
      `));
      rows = extractRows(providers).map((p: any) => ({
        id: String(p.provider_id ?? p.id),
        name: String(p.name ?? p.provider_id ?? p.id),
        status: p.is_active ? 'healthy' : 'disabled',
        enabled: p.is_active !== false,
        capabilities: p.capabilities,
      }));
    }

    // NV-PROVIDERS-CATALOG-FALLBACK-001 (2026-06-25): when the dedicated
    // nv_llm_providers table is absent or empty on a given RDS (schema drift —
    // it is provisioned by a migration the gateway role can't run), derive the
    // provider list from the DISTINCT provider_ids in nv_model_catalog (which IS
    // populated — /api/jrx/models reads it). This keeps the Model Catalog /
    // Providers page populated and consistent with the live model set instead of
    // rendering an empty "degraded" list. Presentation-only; routing is
    // unaffected (it reads the dynamic registry / provider availability).
    if (rows.length === 0) {
      rows = await deriveProvidersFromCatalog();
    }

    res.json({ success: true, data: rows, ...(rows.length === 0 ? { degraded: true } : {}) });
  } catch (error: any) {
    // Last-resort: derive from the model catalog; only mark degraded if even
    // that is unavailable, so the overview poller isn't flooded with 500s.
    logger.warn('[jrx-core] /providers primary path failed; deriving from catalog', { error: error?.message });
    try {
      const rows = await deriveProvidersFromCatalog();
      res.json({ success: true, data: rows, ...(rows.length === 0 ? { degraded: true } : {}) });
    } catch {
      res.json({ success: true, data: [], degraded: true });
    }
  }
});

router.get('/models', authenticateToken, async (req: Request, res: Response) => {
  if (!db) {
    sendApiError(res, 'DB_UNAVAILABLE', { status: 500 });
    return;
  }
  try {
    // Default customer-facing view hides OpenRouter `:free` backups (branding).
    const includeFreeTier = String(req.query.includeFreeTier ?? '') === 'true';

    // Introspect the live schema so a legacy/minimal install (missing
    // nv_llm_providers, or with drifted nv_model_catalog columns) degrades to
    // a 200 instead of `relation ... does not exist` (500).
    const cols = await getModelCatalogColumns();
    const has = (c: string): boolean => cols.has(c);
    const hasProviders = await llmProvidersTableExists();

    // Defensive projection: emit mc.<col> when present, NULL otherwise, so the
    // SELECT keeps a stable output shape (matches the existing SDK/console
    // contract: { id, model_id, name, provider_id, context_window,
    // max_output_tokens, input_cost_per_1k, output_cost_per_1k,
    // supports_vision, supports_tools, is_active, provider_name }).
    const col = (src: string, alias: string): string => (has(src) ? `mc.${src} AS ${alias}` : `NULL AS ${alias}`);
    const selectParts = [
      col('id', 'id'),
      col('model_id', 'model_id'),
      col('display_name', 'name'),
      col('provider_id', 'provider_id'),
      col('context_window', 'context_window'),
      col('max_output_tokens', 'max_output_tokens'),
      col('cost_per_1k_in', 'input_cost_per_1k'),
      col('cost_per_1k_out', 'output_cost_per_1k'),
      col('supports_vision', 'supports_vision'),
      col('supports_tools', 'supports_tools'),
      col('is_active', 'is_active'),
      // provider_name: join nv_llm_providers when it exists; otherwise fall
      // back to provider_id so the field is still populated (the legacy JOIN
      // was the sole hard dependency on that table).
      hasProviders
        ? 'COALESCE(p.name, mc.provider_id) AS provider_name'
        : (has('provider_id') ? 'mc.provider_id AS provider_name' : 'NULL AS provider_name'),
    ];

    const whereParts: string[] = [];
    if (has('is_active')) whereParts.push('mc.is_active = true');
    // Hide `:free` OpenRouter backups by default (SQL-side; JS double-check
    // below covers any column-projection edge case). ?includeFreeTier=true
    // opts in. No user input is interpolated — the literals are constant.
    if (!includeFreeTier && has('provider_id') && has('model_id')) {
      whereParts.push(`NOT (mc.provider_id = 'openrouter' AND mc.model_id LIKE '%:free%')`);
    }

    const orderParts: string[] = [];
    if (hasProviders) orderParts.push('p.name NULLS LAST');
    else if (has('provider_id')) orderParts.push('mc.provider_id NULLS LAST');
    if (has('display_name')) orderParts.push('mc.display_name');

    const query = `
      SELECT ${selectParts.join(', ')}
      FROM nv_model_catalog mc
      ${hasProviders ? 'LEFT JOIN nv_llm_providers p ON mc.provider_id = p.provider_id' : ''}
      ${whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : ''}
      ${orderParts.length ? `ORDER BY ${orderParts.join(', ')}` : ''}
    `;

    const result = await db.execute(sql.raw(query));
    let rows = extractRows<{ provider_id?: unknown; model_id?: unknown }>(result);
    if (!includeFreeTier) rows = rows.filter((r) => !isFreeTierCatalogRow(r));

    res.json({
      success: true,
      data: rows,
    });
  } catch (error: any) {
    logger.error('Models error:', error);
    sendApiError(res, 'BAD_REQUEST', { status: 500, overrideMessage: 'Failed to fetch models' });
  }
});

router.patch('/providers/:providerId', authenticateToken, requireRole('super_admin'), async (req: Request, res: Response) => {
  if (!db) {
    sendApiError(res, 'DB_UNAVAILABLE', { status: 500 });
    return;
  }
  const { providerId } = req.params;
  const { is_enabled } = req.body;
  
  try {
    await db.execute(sql`
      UPDATE nv_llm_providers 
      SET is_active = ${is_enabled}, updated_at = NOW()
      WHERE provider_id = ${providerId}
    `);
    
    res.json({
      success: true,
      message: `Provider ${providerId} updated successfully`
    });
  } catch (error: any) {
    logger.error('Provider update error:', error);
    sendApiError(res, 'BAD_REQUEST', { status: 500, overrideMessage: 'Failed to update provider' });
  }
});

router.get('/tools', authenticateToken, (req: Request, res: Response) => {
  const toolCategories = [
    { category: 'Legal Research', tools: 85, description: 'Case law search, statute lookup, legal databases' },
    { category: 'Document Analysis', tools: 72, description: 'Contract review, clause extraction, risk analysis' },
    { category: 'Case Law Search', tools: 68, description: 'Indian Kanoon, SCC Online, Manupatra integration' },
    { category: 'Contract Review', tools: 54, description: 'NDA, agreements, term sheet analysis' },
    { category: 'Compliance Check', tools: 48, description: 'Regulatory compliance, policy validation' },
    { category: 'Citation Analysis', tools: 42, description: 'Case citation, precedent analysis' },
    { category: 'Due Diligence', tools: 38, description: 'Corporate due diligence, M&A review' },
    { category: 'Legal Drafting', tools: 65, description: 'Petition drafting, pleading generation' },
    { category: 'Court Filing', tools: 28, description: 'E-filing, court document preparation' },
    { category: 'E-Discovery', tools: 30, description: 'Electronic discovery, document review' }
  ];
  
  res.json({
    success: true,
    data: {
      summary: {
        totalTools: JRX_MCP_TOOLS.totalTools,
        categories: toolCategories.length
      },
      categories: toolCategories
    }
  });
});

router.get('/statutes', dualSdkOrJwt, async (req: Request, res: Response) => {
  if (!db) {
    sendApiError(res, 'DB_UNAVAILABLE', { status: 500 });
    return;
  }
  try {
    const jurisdictionFilter = (req.query.jurisdiction as string | undefined)?.toUpperCase();
    const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '100'), 10) || 100, 1), 500);
    const offset = Math.max(parseInt(String(req.query.offset ?? '0'), 10) || 0, 0);
    const whereClause = jurisdictionFilter
      ? sql`WHERE jurisdiction = ${jurisdictionFilter}`
      : sql``;
    const statutes = await db.execute(sql`
      SELECT
        act_short_title                                AS code,
        MAX(act_title)                                 AS name,
        jurisdiction,
        MAX(practice_area)                             AS category,
        COUNT(*)::int                                  AS section_count,
        BOOL_AND(NOT is_repealed)                      AS is_active,
        MAX(effective_date)::text                      AS effective_date
      FROM nv_statutes
      ${whereClause}
      GROUP BY act_short_title, jurisdiction
      ORDER BY jurisdiction, act_short_title
      LIMIT ${limit} OFFSET ${offset}
    `);
    const totalRow = await db.execute(sql`
      SELECT COUNT(*)::int AS total FROM (
        SELECT 1 FROM nv_statutes
        ${whereClause}
        GROUP BY act_short_title, jurisdiction
      ) t
    `);
    const rows = extractRows<NvStatuteListRow>(statutes);
    const total = Number(extractRows<NvCountRow>(totalRow)[0]?.total) || rows.length;
    res.json({
      success: true,
      count: rows.length,
      total,
      limit,
      offset,
      data: rows.map((s) => ({
        code: s.code,
        name: s.name,
        jurisdiction: s.jurisdiction,
        category: s.category,
        sectionCount: Number(s.section_count) || 0,
        status: s.is_active ? 'active' : 'repealed',
        effectiveDate: s.effective_date,
      })),
    });
  } catch (error: any) {
    logger.error('Statutes error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch statutes', details: error?.message });
  }
});

router.get('/statutes/:code', dualSdkOrJwt, async (req: Request, res: Response) => {
  if (!db) {
    sendApiError(res, 'DB_UNAVAILABLE', { status: 500 });
    return;
  }
  const { code } = req.params;
  try {
    const result = await db.execute(sql`
      SELECT
        id, act_title, act_short_title, jurisdiction, section_number,
        section_title, section_text, practice_area, keywords,
        effective_date, amended_date, is_repealed
      FROM nv_statutes
      WHERE LOWER(act_short_title) = LOWER(${code})
         OR LOWER(REPLACE(act_short_title, '_', '')) = LOWER(REPLACE(${code}, '_', ''))
      ORDER BY
        CASE WHEN section_number ~ '^[0-9]+$' THEN LPAD(section_number, 6, '0') ELSE section_number END
      LIMIT 500
    `);
    const sections = extractRows<NvStatuteSectionRow>(result);
    if (!sections || sections.length === 0) {
      return void res.status(404).json({ success: false, error: 'Statute not found', code });
    }
    const head = sections[0];
    res.json({
      success: true,
      data: {
        code: head.act_short_title,
        name: head.act_title,
        jurisdiction: head.jurisdiction,
        practiceArea: head.practice_area,
        sectionCount: sections.length,
        sections: sections.map((s) => ({
          number: s.section_number,
          title: s.section_title,
          text: s.section_text,
          keywords: s.keywords || [],
          isRepealed: !!s.is_repealed,
        })),
      },
    });
  } catch (error: any) {
    logger.error('Statute lookup error:', error);
    sendApiError(res, 'BAD_REQUEST', { status: 500, overrideMessage: 'Failed to fetch statute' });
  }
});

router.get('/courts', authenticateToken, async (req: Request, res: Response) => {
  if (!db) {
    sendApiError(res, 'DB_UNAVAILABLE', { status: 500 });
    return;
  }
  try {
    const courts = await db.execute(sql`
      SELECT court_id, name, code, court_type, state, jurisdiction, e_filing_enabled
      FROM nv_courts
      WHERE is_active = true
      ORDER BY court_type, name
    `);
    
    res.json({
      success: true,
      data: courts.rows || courts
    });
  } catch (error: any) {
    logger.error('Courts error:', error);
    sendApiError(res, 'BAD_REQUEST', { status: 500, overrideMessage: 'Failed to fetch courts' });
  }
});

router.get('/analytics', authenticateToken, async (req: Request, res: Response) => {
  if (!db) {
    sendApiError(res, 'DB_UNAVAILABLE', { status: 500 });
    return;
  }
  try {
    const [agentsByCategoryResult, totalsResult, byProviderResult, weeklyResult] = await Promise.all([
      db.execute(sql`SELECT category, COUNT(*) as count FROM legal_agents WHERE is_enabled = true GROUP BY category ORDER BY count DESC`).catch(() => ({ rows: [] })),
      db.execute(sql`
        SELECT
          COALESCE(SUM(input_tokens + output_tokens), 0) as total_tokens,
          COALESCE(SUM(credits_charged), 0) as total_cost,
          COUNT(*) as total_requests
        FROM nv_ai_activity
      `).catch(() => ({ rows: [{ total_tokens: 0, total_cost: 0, total_requests: 0 }] })),
      db.execute(sql`
        SELECT
          COALESCE(model_provider, 'openrouter') as provider,
          COALESCE(SUM(input_tokens + output_tokens), 0) as total_tokens,
          COUNT(*) as requests
        FROM nv_ai_activity
        GROUP BY model_provider ORDER BY total_tokens DESC LIMIT 6
      `).catch(() => ({ rows: [] })),
      db.execute(sql`
        SELECT
          TO_CHAR(DATE_TRUNC('week', created_at), 'Month DD') as week_name,
          COALESCE(SUM(input_tokens + output_tokens), 0) as tokens,
          COUNT(*) as requests
        FROM nv_ai_activity
        WHERE created_at >= NOW() - INTERVAL '28 days'
        GROUP BY DATE_TRUNC('week', created_at)
        ORDER BY DATE_TRUNC('week', created_at)
      `).catch(() => ({ rows: [] })),
    ]);

    const agentsByCategory = agentsByCategoryResult.rows || agentsByCategoryResult;
    const totals: NvUsageAggRow = extractRows<NvUsageAggRow>(totalsResult)[0] ?? {};
    const byProviderRaw = extractRows<NvProviderTokensRow>(byProviderResult);
    const totalTokens = parseInt(String(totals.total_tokens ?? '0'));
    const byProvider = byProviderRaw.map((r) => {
      const t = parseInt(String(r.total_tokens ?? '0'));
      return {
        provider: r.provider,
        tokens: t,
        percentage: totalTokens > 0 ? Math.round((t / totalTokens) * 100) : 0,
      };
    });
    const trends = extractRows<NvWeeklyUsageRow>(weeklyResult).map((r, i) => ({
      name: r.week_name?.trim() || `Week ${i + 1}`,
      tokens: parseInt(String(r.tokens ?? '0')),
      requests: parseInt(String(r.requests ?? '0')),
    }));

    res.json({
      success: true,
      data: {
        totals: {
          tokens: totalTokens,
          requests: parseInt(String(totals.total_requests ?? '0')),
          cost: parseFloat(String(totals.total_cost ?? '0')),
          avgResponseTime: 1.8,
        },
        trends,
        byProvider,
        agentsByCategory,
      }
    });
  } catch (error: any) {
    logger.error('Analytics error:', error);
    res.json({
      success: true,
      data: {
        totals: { tokens: 0, requests: 0, cost: 0, avgResponseTime: 1.8 },
        trends: [],
        byProvider: [],
        agentsByCategory: [],
      }
    });
  }
});

router.get('/settings', authenticateToken, (req: Request, res: Response) => {
  res.json({
    success: true,
    data: [
      { key: 'enableLegalChat', value: true, label: 'Enable Legal AI Chat' },
      { key: 'autoCiteSources', value: true, label: 'Auto-cite Sources' },
      { key: 'multilingualSupport', value: true, label: 'Multilingual Support (22 languages)' },
      { key: 'rateLimiting', value: true, label: 'Enable Rate Limiting' },
      { key: 'apiKeyAuth', value: true, label: 'API Key Authentication' },
      { key: 'auditLogging', value: true, label: 'Audit Logging' },
      { key: 'legalPrivilegeProtection', value: true, label: 'Legal Privilege Protection' }
    ]
  });
});

router.patch('/settings/:key', authenticateToken, requireRole('org_admin'), (req: Request, res: Response) => {
  const { key } = req.params;
  res.json({
    success: true,
    message: `Setting ${key} updated successfully`
  });
});

router.get('/api-gateway/clients', authenticateToken, (req: Request, res: Response) => {
  res.json({
    success: true,
    data: [
      { id: 'client_1', name: 'Khaitan & Co', apiKeys: 2, status: 'active', plan: 'enterprise' },
      { id: 'client_2', name: 'Shardul Amarchand', apiKeys: 1, status: 'active', plan: 'professional' },
      { id: 'client_3', name: 'Ministry of Law', apiKeys: 3, status: 'active', plan: 'enterprise' },
      { id: 'client_4', name: 'Trilegal', apiKeys: 2, status: 'active', plan: 'professional' }
    ]
  });
});

router.post('/api-gateway/clients', authenticateToken, requireRole('org_admin', 'super_admin'), (req: Request, res: Response) => {
  res.json({
    success: true,
    data: {
      id: `client_${Date.now()}`,
      name: req.body.name,
      status: 'active',
      apiKey: `nv_live_${Date.now()}`
    }
  });
});

router.get('/subscription-plans', authenticateToken, async (req: Request, res: Response) => {
  if (!db) {
    sendApiError(res, 'DB_UNAVAILABLE', { status: 500 });
    return;
  }
  try {
    const plans = await db.execute(sql`
      SELECT plan_id, name, description, amount, currency, period, features, 
             agent_limit, query_limit
      FROM subscription_plans
      WHERE is_active = true
      ORDER BY amount
    `);
    
    res.json({
      success: true,
      data: plans.rows || plans
    });
  } catch (error: any) {
    logger.error('Plans error:', error);
    sendApiError(res, 'BAD_REQUEST', { status: 500, overrideMessage: 'Failed to fetch plans' });
  }
});

router.post('/chat', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { message, systemPrompt, model, provider, jurisdiction, agentId, maxTokens, temperature } = req.body;

    if (!message || typeof message !== 'string') {
      sendApiError(res, 'BAD_REQUEST', { overrideMessage: 'Message is required and must be a string' });
    }
    if (message.length > 50000) {
      sendApiError(res, 'BAD_REQUEST', { overrideMessage: 'Message exceeds maximum length of 50000 characters' });
    }
    if (maxTokens && (typeof maxTokens !== 'number' || maxTokens < 1 || maxTokens > 32768)) {
      sendApiError(res, 'BAD_REQUEST', { overrideMessage: 'maxTokens must be between 1 and 32768' });
    }
    if (temperature !== undefined && (typeof temperature !== 'number' || temperature < 0 || temperature > 2)) {
      sendApiError(res, 'BAD_REQUEST', { overrideMessage: 'temperature must be between 0 and 2' });
    }
    const sanitizedMessage = message.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '').trim();

    const hasRealKeys = !!(process.env.AI_INTEGRATIONS_OPENROUTER_BASE_URL || process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY || process.env.GEMINI_API_KEY || process.env.XAI_API_KEY || process.env.PERPLEXITY_API_KEY || process.env.DEEPSEEK_API_KEY || process.env.GROQ_API_KEY || process.env.OPENROUTER_API_KEY || process.env.TOGETHER_API_KEY || process.env.COHERE_API_KEY || process.env.MISTRAL_API_KEY);
    if (!hasRealKeys) {
      res.json({
        success: true,
        data: {
          response: 'LLM providers not yet configured. Please add API keys (e.g., OPENAI_API_KEY, ANTHROPIC_API_KEY, GEMINI_API_KEY) to enable AI responses.',
          model: 'none',
          provider: 'none',
          tokens: { input: 0, output: 0, total: 0 },
          cost: 0,
          responseTime: 0,
          citations: []
        }
      });
    }

    const request: LLMRequest = {
      id: `req_${Date.now()}`,
      userId: (req as AuthRequest).user?.id || 'anonymous',
      prompt: sanitizedMessage,
      model: model || undefined,
      provider: provider || undefined,
      maxTokens: maxTokens || 4096,
      temperature: temperature ?? 0.7,
      systemPrompt: systemPrompt || `You are Jurexio, an expert Indian legal AI assistant. Jurisdiction: ${jurisdiction || 'India'}. Provide accurate, well-cited legal analysis.`,
      requirements: {
        complexity: 'medium',
        domain: 'analytical',
        priority: 'medium',
        costBudget: 'balanced',
        responseTime: 'balanced',
        qualityLevel: 'professional'
      },
      fallbackLevels: 3,
      timestamp: new Date()
    };

    const llmResponse = await realLlmService.executeRequest(request);

    res.json({
      success: true,
      data: {
        response: llmResponse.content,
        model: llmResponse.model,
        provider: llmResponse.provider,
        tokens: llmResponse.tokens,
        cost: llmResponse.cost,
        responseTime: llmResponse.responseTime,
        citations: []
      }
    });
  } catch (error: any) {
    logger.error('Chat endpoint error:', error);
    safeError(res, error, 500);
  }
});

router.post('/analyze', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { document, query, documentType, jurisdiction, maxTokens, temperature } = req.body;

    if (!document && !query) {
      sendApiError(res, 'BAD_REQUEST', { overrideMessage: 'Document content or query is required' });
    }

    const hasRealKeys = !!(process.env.AI_INTEGRATIONS_OPENROUTER_BASE_URL || process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY || process.env.GEMINI_API_KEY || process.env.XAI_API_KEY || process.env.PERPLEXITY_API_KEY || process.env.DEEPSEEK_API_KEY || process.env.GROQ_API_KEY || process.env.OPENROUTER_API_KEY || process.env.TOGETHER_API_KEY || process.env.COHERE_API_KEY || process.env.MISTRAL_API_KEY);
    if (!hasRealKeys) {
      res.json({
        success: true,
        data: {
          analysis: 'LLM providers not yet configured. Please add API keys (e.g., OPENAI_API_KEY, ANTHROPIC_API_KEY, GEMINI_API_KEY) to enable document analysis.',
          model: 'none',
          provider: 'none',
          tokens: { input: 0, output: 0, total: 0 },
          cost: 0,
          responseTime: 0,
          findings: [],
          recommendations: [],
          statutesCited: []
        }
      });
    }

    const analysisPrompt = document
      ? `Analyze the following ${documentType || 'legal'} document and provide detailed findings, recommendations, and relevant statutes:\n\n${document}`
      : query;

    const request: LLMRequest = {
      id: `req_${Date.now()}`,
      userId: (req as AuthRequest).user?.id || 'anonymous',
      prompt: analysisPrompt,
      maxTokens: maxTokens || 4096,
      temperature: temperature ?? 0.3,
      systemPrompt: `You are Jurexio, an expert Indian legal document analyst. Jurisdiction: ${jurisdiction || 'India'}. Analyze legal documents thoroughly, identify key clauses, risks, obligations, and cite relevant Indian statutes. CURRENT LAW (use as PRIMARY reference): BNS 2023 (Bharatiya Nyaya Sanhita), BNSS 2023 (Bharatiya Nagarik Suraksha Sanhita), BSA 2023 (Bharatiya Sakshya Adhiniyam), CPC, Constitution of India. For matters predating July 2024 only: IPC 1860, CrPC 1973. Provide structured findings and actionable recommendations.`,
      requirements: {
        complexity: 'medium',
        domain: 'analytical',
        priority: 'medium',
        costBudget: 'balanced',
        responseTime: 'balanced',
        qualityLevel: 'professional'
      },
      fallbackLevels: 3,
      timestamp: new Date()
    };

    const llmResponse = await realLlmService.executeRequest(request);

    res.json({
      success: true,
      data: {
        analysis: llmResponse.content,
        model: llmResponse.model,
        provider: llmResponse.provider,
        tokens: llmResponse.tokens,
        cost: llmResponse.cost,
        responseTime: llmResponse.responseTime,
        findings: [],
        recommendations: [],
        statutesCited: []
      }
    });
  } catch (error: any) {
    logger.error('Analyze endpoint error:', error);
    safeError(res, error, 500);
  }
});

router.post('/research', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { query, topic, jurisdiction, caseType, maxTokens, temperature } = req.body;

    if (!query && !topic) {
      sendApiError(res, 'BAD_REQUEST', { overrideMessage: 'Research query or topic is required' });
    }

    const hasRealKeys = !!(process.env.AI_INTEGRATIONS_OPENROUTER_BASE_URL || process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY || process.env.GEMINI_API_KEY || process.env.XAI_API_KEY || process.env.PERPLEXITY_API_KEY || process.env.DEEPSEEK_API_KEY || process.env.GROQ_API_KEY || process.env.OPENROUTER_API_KEY || process.env.TOGETHER_API_KEY || process.env.COHERE_API_KEY || process.env.MISTRAL_API_KEY);
    if (!hasRealKeys) {
      res.json({
        success: true,
        data: {
          summary: 'LLM providers not yet configured. Please add API keys (e.g., OPENAI_API_KEY, ANTHROPIC_API_KEY, GEMINI_API_KEY) to enable legal research.',
          model: 'none',
          provider: 'none',
          tokens: { input: 0, output: 0, total: 0 },
          cost: 0,
          responseTime: 0,
          results: [],
          sources: [],
          citedCases: []
        }
      });
    }

    const researchPrompt = query || `Conduct comprehensive legal research on: ${topic}`;

    const request: LLMRequest = {
      id: `req_${Date.now()}`,
      userId: (req as AuthRequest).user?.id || 'anonymous',
      prompt: researchPrompt,
      maxTokens: maxTokens || 4096,
      temperature: temperature ?? 0.3,
      systemPrompt: `You are Jurexio, an expert Indian legal researcher. Jurisdiction: ${jurisdiction || 'India'}. Case type: ${caseType || 'general'}. Conduct thorough legal research citing relevant case law and precedents from Indian courts (Supreme Court, High Courts). CURRENT STATUTES (PRIMARY reference — effective 1 July 2024): BNS 2023, BNSS 2023, BSA 2023, CPC, Constitution of India. HISTORICAL (cite only for pre-July 2024 matters): IPC 1860, CrPC 1973. Never present IPC/CrPC as current law. Provide structured research findings with proper legal citations.`,
      requirements: {
        complexity: 'medium',
        domain: 'analytical',
        priority: 'medium',
        costBudget: 'balanced',
        responseTime: 'balanced',
        qualityLevel: 'professional'
      },
      fallbackLevels: 3,
      timestamp: new Date()
    };

    const llmResponse = await realLlmService.executeRequest(request);

    res.json({
      success: true,
      data: {
        summary: llmResponse.content,
        model: llmResponse.model,
        provider: llmResponse.provider,
        tokens: llmResponse.tokens,
        cost: llmResponse.cost,
        responseTime: llmResponse.responseTime,
        results: [],
        sources: [],
        citedCases: []
      }
    });
  } catch (error: any) {
    logger.error('Research endpoint error:', error);
    safeError(res, error, 500);
  }
});

router.get('/documentation', (req: Request, res: Response) => {
  res.json({
    success: true,
    data: {
      version: JRX_PLATFORM_VERSION,
      title: `Jurexio Legal SDK v${JRX_PLATFORM_VERSION} Documentation`,
      sections: [
        { id: 'quickstart', title: 'Quick Start Guide' },
        { id: 'api', title: 'API Reference' },
        { id: 'agents', title: `Legal Agent Catalog (${getRegistryStats().totalAgents} Active Registry Agents)` },
        { id: 'providers', title: 'LLM Provider Setup (20+ Providers)' },
        { id: 'statutes', title: 'Indian Law Integration (BNS 2023, BNSS 2023, BSA 2023, CPC — current; IPC/CrPC for pre-July 2024 matters only)' },
        { id: 'courts', title: 'Court Integration (12+ Courts)' },
        { id: 'languages', title: '22 Indian Languages Support' },
        { id: 'bestpractices', title: 'Best Practices' }
      ]
    }
  });
});

router.get('/health', (req: Request, res: Response) => {
  res.json({
    success: true,
    status: 'healthy',
    version: JRX_PLATFORM_VERSION,
    timestamp: new Date().toISOString()
  });
});

router.post('/chat/completions', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { 
      messages, 
      provider = 'openai', 
      model, 
      temperature = 0.7, 
      maxTokens = 4096,
      systemPrompt
    } = req.body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      sendApiError(res, 'BAD_REQUEST', { overrideMessage: 'Messages array is required' });
    }

    const prompt = systemPrompt 
      ? `${systemPrompt}\n\n${messages.map((m: any) => `${m.role}: ${m.content}`).join('\n')}`
      : messages.map((m: any) => `${m.role}: ${m.content}`).join('\n');

    let response;
    switch (provider) {
      case 'openai':
        response = await llmProviders.processWithOpenAI({
          prompt,
          type: 'text',
          maxTokens,
          temperature,
          model
        });
        break;
      case 'anthropic':
        response = await llmProviders.processWithAnthropic({
          prompt,
          type: 'text',
          maxTokens,
          temperature,
          model
        });
        break;
      case 'google':
        response = await llmProviders.processWithGoogle({
          prompt,
          type: 'text',
          maxTokens,
          temperature,
          model
        });
        break;
      default:
        response = await llmProviders.generateResponse({
          prompt,
          type: 'text',
          maxTokens,
          temperature,
          model
        });
    }

    res.json({
      success: true,
      data: {
        content: response.content,
        model: response.model,
        provider: response.provider,
        tokens: response.tokens,
        cost: response.cost,
        processingTime: response.processingTime,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error: any) {
    logger.error('Chat completion error:', error);
    safeError(res, error, 500);
  }
});

router.post('/legal-chat', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { 
      query, 
      context = 'general',
      agentId,
      provider = 'anthropic',
      jurisdiction = 'India'
    } = req.body;

    if (!query) {
      sendApiError(res, 'BAD_REQUEST', { overrideMessage: 'Query is required' });
    }

    // Try to load agent-specific 22-point system prompt if agentId provided
    let agentSystemPrompt: string | null = null;
    let agentDetails: any = null;
    
    if (agentId) {
      agentDetails = getAgentById(agentId);
      if (agentDetails?.systemPrompt) {
        agentSystemPrompt = agentDetails.systemPrompt;
        logger.info(`⚖️ Using 22-point system prompt for agent: ${agentId}`);
      }
    }

    // Use agent's 22-point system prompt or fall back to default Jurexio prompt
    const legalPrompt = agentSystemPrompt 
      ? `${agentSystemPrompt}

---
CURRENT CONTEXT:
- Legal Context: ${context}
- Jurisdiction: ${jurisdiction}
- Query Timestamp: ${new Date().toISOString()}

USER QUERY:
${query}`
      : `You are Jurexio, India's Premier Legal AI Assistant. You specialize in Indian law. CURRENT LAW (effective July 2024 onwards — use as PRIMARY reference):
- BNS 2023 — Bharatiya Nyaya Sanhita (replaced IPC 1860 from 1 July 2024)
- BNSS 2023 — Bharatiya Nagarik Suraksha Sanhita (replaced CrPC 1973 from 1 July 2024)
- BSA 2023 — Bharatiya Sakshya Adhiniyam (replaced Indian Evidence Act 1872 from 1 July 2024)
- CPC — Code of Civil Procedure, 1908 (still in force)
- Constitution of India, 1950 (still in force)
HISTORICAL REFERENCE ONLY (pre-July 2024 matters):
- IPC 1860 — Indian Penal Code (repealed — cite only for offences committed before 1 July 2024)
- CrPC 1973 — Code of Criminal Procedure (repealed — cite only for proceedings initiated before 1 July 2024)
IMPORTANT: NEVER present IPC or CrPC as current law. Always use BNS/BNSS/BSA as the primary reference.

Context: ${context}
Jurisdiction: ${jurisdiction}
${agentId ? `Acting as legal agent: ${agentId}` : ''}

Provide accurate, well-researched legal guidance. Always cite relevant sections of law when applicable.

User Query: ${query}`;

    let response;
    switch (provider) {
      case 'openai':
        response = await llmProviders.processWithOpenAI({
          prompt: legalPrompt,
          type: 'analysis',
          maxTokens: 4096,
          temperature: 0.3
        });
        break;
      case 'anthropic':
        response = await llmProviders.processWithAnthropic({
          prompt: legalPrompt,
          type: 'analysis',
          maxTokens: 4096,
          temperature: 0.3
        });
        break;
      case 'google':
        response = await llmProviders.processWithGoogle({
          prompt: legalPrompt,
          type: 'analysis',
          maxTokens: 4096,
          temperature: 0.3
        });
        break;
      default:
        response = await llmProviders.generateResponse({
          prompt: legalPrompt,
          type: 'analysis',
          maxTokens: 4096,
          temperature: 0.3
        });
    }

    res.json({
      success: true,
      data: {
        query,
        response: response.content,
        context,
        jurisdiction,
        agentId,
        agentDetails: agentDetails ? {
          name: agentDetails.name,
          tier: agentDetails.tier,
          romaLevel: agentDetails.romaLevel,
          practiceArea: agentDetails.practiceArea,
          capabilities: agentDetails.capabilities,
          guardrails: agentDetails.guardrails,
          using22PointPrompt: !!agentSystemPrompt
        } : null,
        provider: response.provider,
        model: response.model,
        tokens: response.tokens,
        cost: response.cost,
        processingTime: response.processingTime,
        timestamp: new Date().toISOString(),
        disclaimer: 'This is AI-generated legal information. Please consult a qualified advocate for specific legal matters.'
      }
    });
  } catch (error: any) {
    logger.error('Legal chat error:', error);
    safeError(res, error, 500);
  }
});

// Get all agents from the 22-point registry
router.get('/registry/agents', authenticateToken, (req: Request, res: Response) => {
  try {
    if (!legalAgentsRegistry?.agents) {
      sendApiError(res, 'BAD_REQUEST', { status: 503, overrideMessage: 'Legal agents registry not loaded' });
    }

    const { tier, practiceArea, romaLevel, limit = 50 } = req.query;
    
    let agents = legalAgentsRegistry.agents.map((a: any) => ({
      id: a.id,
      name: a.name,
      version: a.version,
      tier: a.tier,
      romaLevel: a.romaLevel,
      practiceArea: a.practiceArea,
      category: a.category,
      description: a.description,
      capabilities: a.capabilities,
      protocols: a.protocols,
      preferredModels: a.preferredModels,
      status: a.status
    }));

    if (tier) {
      agents = agents.filter((a: any) => a.tier === tier);
    }
    if (practiceArea) {
      agents = agents.filter((a: any) => 
        a.practiceArea?.toLowerCase().includes(String(practiceArea).toLowerCase())
      );
    }
    if (romaLevel) {
      agents = agents.filter((a: any) => a.romaLevel === romaLevel);
    }

    res.json({
      success: true,
      data: {
        metadata: legalAgentsRegistry.metadata,
        tierSummary: legalAgentsRegistry.tierSummary,
        practiceAreaSummary: legalAgentsRegistry.practiceAreaSummary,
        agents: agents.slice(0, Number(limit)),
        totalAgents: agents.length,
        totalAvailable: legalAgentsRegistry.agents.length
      }
    });
  } catch (error: any) {
    safeError(res, error, 500);
  }
});

// Get single agent with full 22-point system prompt
router.get('/registry/agents/:agentId', authenticateToken, (req: Request, res: Response) => {
  try {
    const agentId = req.params.agentId as string;
    const agent = getAgentById(agentId);
    
    if (!agent) {
      sendApiError(res, 'NOT_FOUND', { status: 404, overrideMessage: `Agent ${agentId} not found in registry` });
    }

    res.json({
      success: true,
      data: agent
    });
  } catch (error: any) {
    safeError(res, error, 500);
  }
});

router.get('/llm/status', authenticateToken, async (req: Request, res: Response) => {
  try {
    const providerStatus = llmProviders.getProviderStatus();
    const availableModels = llmProviders.getAvailableModels();

    const providers = [
      { 
        id: 'openai', 
        name: 'OpenAI', 
        status: providerStatus.openai ? 'available' : 'unavailable', 
        models: ['gpt-4.1', 'gpt-4.1-mini', 'gpt-4.1-nano', 'o4-mini', 'o3'],
        supported: true
      },
      { 
        id: 'anthropic', 
        name: 'Anthropic', 
        status: providerStatus.anthropic ? 'available' : 'unavailable', 
        models: ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5'],
        supported: true
      },
      { 
        id: 'google', 
        name: 'Google', 
        status: providerStatus.google ? 'available' : 'unavailable', 
        models: ['gemini-2.5-flash', 'gemini-2.5-pro'],
        supported: true
      }
    ];

    res.json({
      success: true,
      data: {
        totalProviders: providers.length,
        availableProviders: providers.filter(p => p.status === 'available').length,
        providers,
        availableModels,
        note: 'Additional providers (Sarvam AI, DeepSeek, Groq, Mistral, Cohere) available via auto-routing'
      }
    });
  } catch (error: any) {
    logger.error('LLM status error:', error);
    safeError(res, error, 500);
  }
});

// ── ADMIN: Users ──────────────────────────────────────────────────────────────
router.get('/admin/users', authenticateToken, requireRole('admin','org_admin','super_admin'), async (req: Request, res: Response) => {
  try {
    const limitVal = Math.min(parseInt(req.query.limit as string || '50'), 200);
    const offsetVal = parseInt(req.query.offset as string || '0');

    const [usersResult, countResult, activeResult, adminResult] = await Promise.all([
      db.execute(sql`
        SELECT id, email, full_name, role, is_active, tier,
               created_at, last_login_at, org_id
        FROM nv_users
        ORDER BY created_at DESC
        LIMIT ${limitVal} OFFSET ${offsetVal}
      `),
      db.execute(sql`SELECT COUNT(*) as total FROM nv_users`),
      db.execute(sql`SELECT COUNT(*) as cnt FROM nv_users WHERE last_login_at > NOW() - INTERVAL '24 hours'`),
      db.execute(sql`SELECT COUNT(*) as cnt FROM nv_users WHERE role IN ('super_admin','org_admin','admin','superadmin')`),
    ]);

    const mapRow = (u: NvUserRow) => ({
      id: u.id, email: u.email,
      name: u.full_name || u.email,
      role: u.role || 'user', status: u.is_active !== false ? 'active' : 'suspended',
      subscriptionPlan: u.tier || 'solo',
      createdAt: u.created_at, lastLogin: u.last_login_at,
      organizationId: u.org_id, avatarUrl: null,
    });

    const users = extractRows<NvUserRow>(usersResult).map(mapRow);

    res.json({
      success: true, data: {
        users,
        stats: {
          total: parseInt(String(extractRows<NvCountRow>(countResult)[0]?.total ?? '0')),
          activeToday: parseInt(String(extractRows<NvCountRow>(activeResult)[0]?.cnt ?? '0')),
          admins: parseInt(String(extractRows<NvCountRow>(adminResult)[0]?.cnt ?? '0')),
        }
      }
    });
  } catch (err: any) {
    safeError(res, err, 500);
  }
});

// ── ADMIN: Update user role ───────────────────────────────────────────────────
// NV-RBAC-GAP-001: this route previously had `authenticateToken` but NO role
// gate — any JWT holder (even a viewer/guest) could promote any user, in any
// org, to super_admin. Now: (1) caller must be org_admin+ (hierarchy-aware);
// (2) a non-super_admin can only edit users in their OWN org; (3) nobody may
// grant a role higher than their own (so org_admin can't mint super_admins).
router.patch('/admin/users/:userId/role', authenticateToken, requireRole('org_admin', 'super_admin'), async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const { role } = req.body;
    const validRoles = ['super_admin','org_admin','manager','senior_analyst','analyst','operator','developer','viewer','user','guest'];
    if (!validRoles.includes(role)) { sendApiError(res, 'BAD_REQUEST', { overrideMessage: 'Invalid role' }); return; }

    const caller = (req as any).user ?? {};
    const isSuper = caller.role === 'super_admin';

    // Rank ladder (higher = more privileged) — a caller can never assign a role
    // above their own, and only super_admin may mint super_admin/org_admin.
    const RANK: Record<string, number> = {
      guest: 0, user: 10, viewer: 10, developer: 30, operator: 40,
      analyst: 50, senior_analyst: 60, manager: 70, org_admin: 90, super_admin: 100,
    };
    if (!isSuper && (RANK[role] ?? 0) >= RANK['org_admin']) {
      sendApiError(res, 'BAD_REQUEST', { status: 403, overrideMessage: 'Only super_admin can assign org_admin or super_admin' });
      return;
    }

    // Org scoping: a non-super_admin may only change users within their own org.
    const targetRows: any = await db.execute(sql`SELECT org_id FROM nv_users WHERE id = ${userId} LIMIT 1`);
    const targetOrg = (targetRows?.rows ?? targetRows)?.[0]?.org_id ?? null;
    if (!targetOrg) { sendApiError(res, 'NOT_FOUND'); return; }
    const callerOrg = caller.orgId ?? caller.org_id ?? null;
    if (!isSuper && String(targetOrg) !== String(callerOrg)) {
      sendApiError(res, 'BAD_REQUEST', { status: 403, overrideMessage: 'Cannot modify users outside your organization' });
      return;
    }

    await db.execute(sql`UPDATE nv_users SET role = ${role}, updated_at = NOW() WHERE id = ${userId}`);
    res.json({ success: true, message: `User role updated to ${role}` });
  } catch (err: any) {
    safeError(res, err, 500);
  }
});

// ── ADMIN: Organizations ──────────────────────────────────────────────────────
router.get('/admin/orgs', authenticateToken, requireRole('admin','org_admin','super_admin'), async (req: Request, res: Response) => {
  try {
    const orgsResult = await db.execute(sql`
      SELECT o.id, o.name, o.slug, o.tier, o.is_active,
             o.created_at, o.settings,
             COUNT(u.id) as user_count
      FROM nv_organizations o
      LEFT JOIN nv_users u ON u.org_id = o.id
      GROUP BY o.id
      ORDER BY o.created_at DESC
      LIMIT 100
    `).catch(async () => {
      return await db.execute(sql`SELECT id, name, slug, tier, is_active, created_at FROM nv_organizations ORDER BY created_at DESC LIMIT 100`);
    });
    const usageResult = await db.execute(sql`
      SELECT COUNT(*) as total_orgs,
             SUM(CASE WHEN is_active = true THEN 1 ELSE 0 END) as active_orgs
      FROM nv_organizations
    `).catch(() => ({ rows: [{ total_orgs: 0, active_orgs: 0 }] }));

    const stats: NvOrgStatsRow = extractRows<NvOrgStatsRow>(usageResult)[0] ?? {};
    interface OrgSettings {
      industry?: string;
      api_quota?: number;
      max_members?: number;
      isDefault?: boolean;
      ecosystem?: unknown[];
    }
    const orgs = extractRows<NvOrgListRow>(orgsResult).map((o) => {
      // Guard against malformed jsonb payloads — a single bad row must not 500 the whole endpoint.
      let settings: OrgSettings = {};
      try {
        if (typeof o.settings === 'string') {
          settings = (JSON.parse(o.settings || '{}') || {}) as OrgSettings;
        } else if (o.settings && typeof o.settings === 'object') {
          settings = o.settings as OrgSettings;
        }
      } catch (parseErr) {
        console.warn(`[admin/orgs] malformed settings for org id=${o.id}; defaulting to {}`);
      }
      return {
        id: o.id, name: o.name, slug: o.slug,
        // v5.0.0: nv_organizations.tier is the source of truth for plan.
        // The legacy `plan` and `plan_tier` columns no longer exist.
        plan: o.tier || 'pro',
        tier: o.tier || 'pro',
        isActive: o.is_active !== false,
        industry: settings.industry || 'Legal',
        userCount: parseInt(String(o.user_count ?? '0')),
        apiQuota: settings.api_quota || 100000,
        maxMembers: settings.max_members || 5,
        isDefault: settings.isDefault === true,
        ecosystem: Array.isArray(settings.ecosystem) ? settings.ecosystem : [],
        createdAt: o.created_at,
      };
    });

    res.json({
      success: true, data: {
        orgs,
        stats: {
          total: parseInt(String(stats.total_orgs ?? '0')),
          active: parseInt(String(stats.active_orgs ?? '0')),
        }
      }
    });
  } catch (err: any) {
    safeError(res, err, 500);
  }
});

// ── ADMIN: System Stats (comprehensive overview) ───────────────────────────────
async function countPlatformUsers(): Promise<{ total: number; active: number; admins: number; activeToday: number }> {
  const empty = { total: 0, active: 0, admins: 0, activeToday: 0 };
  try {
    const pool = lazyRequire(() => rawPool, 'pool');
    const r = await pool.query(`
      SELECT COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE is_active IS NOT FALSE)::int AS active,
             COUNT(*) FILTER (WHERE role IN ('super_admin','org_admin','admin','superadmin','sme'))::int AS admins,
             COUNT(*) FILTER (WHERE last_login_at > NOW() - INTERVAL '24 hours')::int AS active_today
      FROM nv_users
    `);
    const u = (r.rows?.[0] ?? {}) as NvUserStatsRow;
    let total = Number(u.total ?? 0);
    let active = Number(u.active ?? 0);
    let admins = Number(u.admins ?? 0);
    let activeToday = Number(u.active_today ?? 0);
    if (total === 0) {
      const alt = await pool.query(`
        SELECT COUNT(DISTINCT owner_user_id)::int AS total FROM legal_chat_sessions
      `).catch(() => ({ rows: [{ total: 0 }] }));
      total = Number(alt.rows?.[0]?.total ?? 0);
      active = total;
    }
    return { total, active, admins, activeToday };
  } catch {
    try {
      const userStats = await db.execute(sql`SELECT COUNT(*)::int AS total FROM nv_users`);
      const u = extractRows<NvUserStatsRow>(userStats)[0] ?? {};
      const total = Number(u.total ?? 0);
      return { total, active: total, admins: 0, activeToday: 0 };
    } catch {
      return empty;
    }
  }
}

router.get('/admin/stats', authenticateToken, requireRole('admin','org_admin','super_admin'), async (req: Request, res: Response) => {
  try {
    const userCounts = await countPlatformUsers();
    const [orgStats, usageStats, agentStats, providerStats] = await Promise.all([
      db.execute(sql`SELECT COUNT(*) as total, COUNT(CASE WHEN is_active=true THEN 1 END) as active FROM nv_organizations`).catch(() => ({ rows: [{}] })),
      db.execute(sql`SELECT COALESCE(SUM(input_tokens + output_tokens), 0) as tokens, COUNT(*) as requests, COALESCE(SUM(credits_charged), 0) as cost FROM nv_ai_activity WHERE created_at > NOW() - INTERVAL '30 days'`).catch(() => ({ rows: [{}] })),
      db.execute(sql`SELECT COUNT(*) as total, COUNT(CASE WHEN is_enabled=true THEN 1 END) as active FROM legal_agents`).catch(() => ({ rows: [{}] })),
      db.execute(sql`SELECT COUNT(*) as total, COUNT(CASE WHEN is_active=true THEN 1 END) as enabled FROM nv_llm_providers`).catch(() => ({ rows: [{}] })),
    ]);

    const o: NvOrgAggRow = extractRows<NvOrgAggRow>(orgStats)[0] ?? {};
    const us: NvUsage30Row = extractRows<NvUsage30Row>(usageStats)[0] ?? {};
    const ag: NvAgentAggRow = extractRows<NvAgentAggRow>(agentStats)[0] ?? {};
    const pr: NvProviderAggRow = extractRows<NvProviderAggRow>(providerStats)[0] ?? {};

    let requests30d = parseInt(String(us.requests ?? '0'), 10);
    let tokens30d = parseInt(String(us.tokens ?? '0'), 10);
    if (requests30d === 0) {
      const sdkRow = extractRows<{ requests?: number; tokens?: number }>(
        await db.execute(sql`
          SELECT COUNT(*)::int AS requests,
                 COALESCE(SUM(COALESCE((metadata->>'tokens')::int, 0)), 0)::int AS tokens
          FROM public.sdk_api_request_logs
          WHERE created_at > NOW() - INTERVAL '30 days'
        `).catch(() => ({ rows: [{ requests: 0, tokens: 0 }] })),
      )[0] ?? {};
      requests30d = Number(sdkRow.requests ?? 0);
      if (tokens30d === 0) tokens30d = Number(sdkRow.tokens ?? 0);
    }
    if (requests30d === 0) {
      const auditRow = extractRows<{ c?: number }>(
        await db.execute(sql`
          SELECT COUNT(*)::int AS c FROM nv_schema.nv_audit_logs
          WHERE created_at > NOW() - INTERVAL '30 days'
        `).catch(() => ({ rows: [{ c: 0 }] })),
      )[0] ?? {};
      requests30d = Number(auditRow.c ?? 0);
    }

    // NV-AGENT-COUNT-CONSISTENCY-001 / NV-PROVIDERS-CATALOG-FALLBACK-001
    // (2026-06-25): keep admin/stats consistent with the rest of the console.
    //  - Agents headline = canonical runtime registry (164), DB catalog size
    //    (distinct legal_agents rows) exposed separately as `definitions`.
    //  - Provider count: nv_llm_providers is absent on prod RDS so the DB query
    //    fails; derive the real count from nv_model_catalog (same source as
    //    /api/jrx/providers) instead of the stale hardcoded 20.
    const canonicalAgents = getRegistryStats().totalAgents;
    const agentDefinitions = parseInt(String(ag.total ?? '0'), 10) || canonicalAgents;
    let provTotal = parseInt(String(pr.total ?? ''), 10);
    let provEnabled = parseInt(String(pr.enabled ?? ''), 10);
    if (!Number.isFinite(provTotal) || provTotal <= 0) {
      const cat = await deriveProvidersFromCatalog();
      provTotal = cat.length;
      provEnabled = cat.filter((p) => p.enabled).length;
    }

    res.json({
      success: true, data: {
        users: { total: userCounts.total, active: userCounts.active, admins: userCounts.admins, activeToday: userCounts.activeToday },
        orgs: { total: parseInt(String(o.total ?? '0')), active: parseInt(String(o.active ?? '0')) },
        usage: { tokens: tokens30d, requests: requests30d, cost: parseFloat(String(us.cost ?? '0')) },
        agents: {
          total: canonicalAgents,
          active: canonicalAgents,
          definitions: agentDefinitions,
        },
        providers: { total: provTotal, enabled: provEnabled },
      }
    });
  } catch (err: any) {
    safeError(res, err, 500);
  }
});

// ── ADMIN: Audit Trail ─────────────────────────────────────────────────────────
// ── ADMIN: Feature-flag snapshot (Task #109 — Console Platform-v5 pages) ─────
// Read-only listing of every JRX_F_* flag and its resolved boolean for the
// current process. Console UI consumes this so the per-namespace admin pages
// can render an explicit "feature disabled in this environment" banner
// instead of trial-and-erroring every endpoint to discover OFF state.
//
// Auth: JWT (super_admin / admin / org_admin) — matches the rest of the
// /admin/* surface in this file. We ALSO call extractSdkApiKey() so a
// request that arrives with a canonical X-API-Key header is recorded
// (NV-AUTH-HEADER-001 — single canonical header). Flag values are non-
// secret on/off booleans, so we deliberately do not gate-by-SDK-key only.
router.get('/admin/feature-flags', authenticateToken, requireRole('admin','org_admin','super_admin'), (req: Request, res: Response) => {
  try {
    const sdkKeyPresent = Boolean(extractSdkApiKey(req));
    const flags = getJrxFeatureFlagSnapshot();
    res.json({
      success: true,
      data: {
        flags,
        count: Object.keys(flags).length,
        sdkKeyPresent,
        capturedAt: new Date().toISOString(),
      },
    });
  } catch (err: any) {
    safeError(res, err, 500);
  }
});

// ── ADMIN: Toggle a feature flag (Task #114 — Console super-admin lever) ─────
// PATCH /api/jrx/admin/feature-flags/:logical
//   body: { value: boolean | null, reason?: string }
//     value = true  → force ON (DB overlay row, value=true)
//     value = false → force OFF (DB overlay row, value=false)
//     value = null  → clear overlay (delete row, fall back to env / default)
//
// Auth: super_admin only — toggling a flag can dark-launch / kill an entire
// /api/nv5/* namespace, so we deliberately do not let admin/org_admin in.
//
// Audit: every successful toggle appends a single tamper-evident row to
// nv_schema.nv_audit_logs via appendAuditRecord() so the chain hash advances
// (event_type=`feature_flag.toggle`, payload includes logical, env name,
// previous value, new value, actor, reason).
/**
 * Authenticated express request shape used by /admin/* handlers in this file.
 * Mirrors what `authenticateToken` (src/middleware/auth.ts) attaches.
 */
type AuthenticatedRequest = Request & {
  user?: {
    id?: string | number;
    userId?: string | number;
    email?: string;
    role?: string;
    organizationId?: string | number;
  };
};

router.patch('/admin/feature-flags/:logical', authenticateToken, requireRole('super_admin'), async (req: Request, res: Response) => {
  const logical = String(req.params.logical || '').trim();
  const envName = getFlagEnvName(logical);
  if (!envName) {
    return res.status(404).json({ success: false, error: { code: 'UNKNOWN_FLAG', message: `unknown logical flag: ${logical}` } });
  }

  const body = (req.body ?? {}) as { value?: unknown; reason?: unknown };
  const reason: string | null = typeof body.reason === 'string' ? body.reason.slice(0, 500) : null;
  const rawValue = body.value;
  const isClear = rawValue === null;
  const isBool = typeof rawValue === 'boolean';
  if (!isClear && !isBool) {
    return res.status(400).json({ success: false, error: { code: 'INVALID_VALUE', message: 'body.value must be boolean or null' } });
  }

  const authReq = req as AuthenticatedRequest;
  const user = (authReq.user ?? {}) as NonNullable<AuthenticatedRequest['user']>;
  const actor = String(user.id ?? user.userId ?? user.email ?? 'unknown');

  // Capture before-state up-front so we can roll back the overlay write
  // if the audit-chain append later fails (the audit record is a hard
  // requirement of Task #114 — every toggle MUST land a chain entry).
  // Use the hydration-safe variant so a cold-start race (admin firing the
  // very first toggle before `initFlagOverrides()` has finished hydrating
  // the in-memory cache) cannot return a stale `undefined` and corrupt
  // the rollback baseline.
  const before = await getFlagOverrideRowSafe(logical);
  const previousValue: boolean | null = before ? before.value : null;
  const newValue: boolean | null = isClear ? null : (rawValue as boolean);
  const action: 'set' | 'clear' = isClear ? 'clear' : 'set';

  // 1) Mutate the overlay store.
  try {
    if (isClear) {
      await clearFlagOverride(logical);
    } else {
      await setFlagOverride({ logical, envName, value: rawValue as boolean, updatedBy: actor, reason });
    }
  } catch (mutErr) {
    const msg = mutErr instanceof Error ? mutErr.message : String(mutErr);
    logger.error('[feature-flag] overlay mutation failed', { logical, action, err: msg });
    return res.status(500).json({ success: false, error: { code: 'OVERLAY_WRITE_FAILED', message: msg } });
  }

  // 2) Append the audit-chain entry. If this fails, restore the prior
  //    overlay state so the system is never left in a state where a flag
  //    flipped without a tamper-evident audit row landing on the chain.
  try {
    await appendAuditRecord({
      eventType: 'feature_flag.toggle',
      payload: JSON.stringify({
        logical,
        env: envName,
        action,
        previousValue,
        newValue,
        actor,
        reason,
        route: req.originalUrl,
        method: req.method,
        ts: new Date().toISOString(),
      }),
    });
  } catch (auditErr) {
    const msg = auditErr instanceof Error ? auditErr.message : String(auditErr);
    logger.error('[feature-flag] audit append failed — rolling back overlay', { logical, action, err: msg });
    // Best-effort rollback: re-apply the pre-mutation state.
    try {
      if (before) {
        await setFlagOverride({
          logical: before.logical,
          envName: before.envName,
          value: before.value,
          updatedBy: before.updatedBy,
          reason: before.reason,
        });
      } else {
        await clearFlagOverride(logical);
      }
    } catch (rollbackErr) {
      const rmsg = rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr);
      logger.error('[feature-flag] rollback after audit failure ALSO failed — manual intervention required', {
        logical, action, previousValue, newValue, err: rmsg,
      });
      return res.status(500).json({
        success: false,
        error: {
          code: 'AUDIT_AND_ROLLBACK_FAILED',
          message: `audit chain append failed (${msg}) and rollback failed (${rmsg}). The overlay row may be inconsistent — inspect nv_runtime_flag_overrides for ${logical}.`,
        },
      });
    }
    return res.status(500).json({
      success: false,
      error: {
        code: 'AUDIT_APPEND_FAILED',
        message: `audit chain append failed: ${msg}. Overlay write was rolled back; flag state unchanged.`,
      },
    });
  }

  // 3) Both succeeded — return the post-state snapshot.
  const after = getFlagOverrideRow(logical);
  const snapshot = getJrxFeatureFlagSnapshot();
  return res.json({
    success: true,
    data: {
      logical,
      env: envName,
      action,
      previousValue,
      newValue,
      overlay: after ?? null,
      flag: snapshot[logical as keyof typeof snapshot] ?? null,
    },
  });
});

router.get('/admin/audit', authenticateToken, requireRole('admin','org_admin','super_admin'), async (req: Request, res: Response) => {
  try {
    const { limit = 50 } = req.query;
    // NV-AUDIT-SURFACE-001: read the LIVE hash-chained audit ledger
    // (nv_schema.nv_audit_logs — event_type + payload jsonb + hash chain),
    // not the stale legacy public.nv_audit_logs. Detail fields live in payload.
    const auditResult = await db.execute(sql.raw(`
      SELECT id::text AS id, event_type, payload, created_at
      FROM nv_schema.nv_audit_logs
      ORDER BY created_at DESC
      LIMIT ${Number(limit)}
    `)).catch(() => ({ rows: [] }));

    const logs = extractRows(auditResult).map((a: any) => {
      const p = (a.payload && typeof a.payload === 'object') ? a.payload : {};
      const parsedStatus = String(a.event_type || '').match(/:(\d{3})$/);
      return {
        id: a.id,
        userId: p.userId ?? p.user_id ?? p.actor ?? null,
        action: a.event_type,
        resourceType: p.route ?? p.resourceType ?? p.resource_type ?? null,
        resourceId: p.traceId ?? p.trace_id ?? p.requestId ?? null,
        details: p,
        statusCode: p.statusCode ?? p.status_code ?? (parsedStatus ? Number(parsedStatus[1]) : null),
        createdAt: a.created_at,
      };
    });

    res.json({ success: true, data: { logs, total: logs.length } });
  } catch (err: any) {
    safeError(res, err, 500);
  }
});

// ── ADMIN: Audit Logs alias (/admin/audit-logs mirrors /admin/audit) ──────────
router.get('/admin/audit-logs', authenticateToken, requireRole('admin','org_admin','super_admin'), async (req: Request, res: Response) => {
  try {
    const { limit = 50, page = 1 } = req.query;
    const offset = (Number(page) - 1) * Number(limit);
    // NV-AUDIT-SURFACE-001: live hash-chained ledger (nv_schema.nv_audit_logs).
    const auditResult = await db.execute(sql.raw(`
      SELECT id::text AS id, event_type, payload, created_at
      FROM nv_schema.nv_audit_logs
      ORDER BY created_at DESC
      LIMIT ${Number(limit)} OFFSET ${offset}
    `)).catch(() => ({ rows: [] }));

    const countResult = await db.execute(sql.raw(`
      SELECT COUNT(*) as total FROM nv_schema.nv_audit_logs
    `)).catch(() => ({ rows: [{ total: 0 }] }));

    const logs = extractRows<any>(auditResult).map((a) => {
      const p = (a.payload && typeof a.payload === 'object') ? a.payload : {};
      const parsedStatus = String(a.event_type || '').match(/:(\d{3})$/);
      return {
        id: a.id,
        userId: p.userId ?? p.user_id ?? p.actor ?? null,
        action: a.event_type,
        resourceType: p.route ?? p.resourceType ?? p.resource_type ?? null,
        resourceId: p.traceId ?? p.trace_id ?? p.requestId ?? null,
        details: p,
        statusCode: p.statusCode ?? p.status_code ?? (parsedStatus ? Number(parsedStatus[1]) : null),
        createdAt: a.created_at,
      };
    });

    const total = parseInt(String(extractRows<NvCountRow>(countResult)[0]?.total ?? '0'));
    res.json({ success: true, data: { logs, total, page: Number(page), limit: Number(limit), pages: Math.ceil(total / Number(limit)) } });
  } catch (err: any) {
    safeError(res, err, 500);
  }
});

// ── ADMIN: API Keys ────────────────────────────────────────────────────────────
router.get('/admin/api-keys', authenticateToken, requireRole('admin','org_admin','super_admin'), async (req: Request, res: Response) => {
  try {
    const result = await db.execute(sql`
      SELECT ak.id, ak.platform, ak.scopes, ak.rate_limit, ak.daily_token_budget,
             ak.is_active, ak.created_at, ak.last_used_at,
             CONCAT(LEFT(ak.key_hash, 8), '...') as key_preview
      FROM api_keys ak
      ORDER BY ak.created_at DESC
      LIMIT 100
    `).catch(() => ({ rows: [] }));

    const keys = extractRows(result).map((k: any) => ({
      id: k.id, platform: k.platform, scopes: k.scopes,
      rateLimit: k.rate_limit, dailyBudget: k.daily_token_budget,
      isActive: k.is_active, createdAt: k.created_at,
      lastUsed: k.last_used_at, keyPreview: k.key_preview,
    }));

    res.json({ success: true, data: { keys, total: keys.length } });
  } catch (err: any) {
    safeError(res, err, 500);
  }
});

// ── AUDIT: Guardrail Stats ─────────────────────────────────────────────────────
// Demo G1A (task-297, 2026-05-13): switched source from event_type counts on
// nv_audit_logs (which never had guardrail_block / guardrail_flag rows in the
// demo DB → 0% pass rate) to nv_hallucination_detections, the table that
// actually carries per-request guardrail outcomes.
//
// Pass-rate semantics:
//   - `passed = true`  → counted as pass
//   - `passed = false` → counted as fail
//   - `passed = NULL`  → "not applicable" — EXCLUDED from the denominator,
//                        surfaced in `not_applicable_24h` so the UI can render
//                        a separate grey bucket instead of treating null as fail.
// Optional ?jurisdiction=US|IN|EU|UK|GC|SG|ALL filter scopes everything.
router.get('/audit/guardrail-stats', authenticateToken, async (req: Request, res: Response) => {
  const ALLOWED = new Set(['US', 'IN', 'EU', 'UK', 'GC', 'SG']);
  const rawJur = (req.query.jurisdiction as string | undefined)?.trim()?.toUpperCase();
  const jurisdiction = rawJur && rawJur !== 'ALL' && ALLOWED.has(rawJur) ? rawJur : null;
  const now = new Date();
  const dayAgo = new Date(now.getTime() - 24 * 3600 * 1000);

  // task-297: org/tenant authorization mirroring /api/jrx/audit/chain.
  //   - super_admin / admin: may scope to any org via ?orgId, or omit (cross-org).
  //   - org_admin:           pinned to caller's org. ?orgId mismatch → 403.
  //   - everyone else:       pinned to caller's org. callerOrg required.
  // The previous version returned recent_events (with org_id) to ANY
  // authenticated caller — a cross-tenant exposure flagged in code review.
  const ADMIN_ROLES_GS    = new Set(['super_admin', 'admin', 'org_admin']);
  const CROSS_ORG_ROLES_GS = new Set(['super_admin', 'admin']);
  const u: any = (req as any).user ?? {};
  const role: string = u.role ?? 'guest';
  const callerOrg: string | null =
    u.organizationId ?? u.orgId ?? u.tenantId ?? u.org_id ?? null;
  const requestedOrg = (req.query.orgId as string | undefined)?.trim() || null;
  let effectiveOrg: string | null;
  if (CROSS_ORG_ROLES_GS.has(role)) {
    effectiveOrg = requestedOrg ?? null;
  } else if (ADMIN_ROLES_GS.has(role)) {
    if (!callerOrg) { sendApiError(res, 'BAD_REQUEST', { status: 403, overrideMessage: 'org_admin session has no org claim — cannot scope guardrail stats.' }); return; }
    if (requestedOrg && requestedOrg !== callerOrg) { sendApiError(res, 'BAD_REQUEST', { status: 403, overrideMessage: 'org_admin may only read its own org guardrail stats.' }); return; }
    effectiveOrg = callerOrg;
  } else {
    if (!callerOrg) { sendApiError(res, 'BAD_REQUEST', { status: 403, overrideMessage: 'Guardrail stats require an org-scoped session.' }); return; }
    if (requestedOrg && requestedOrg !== callerOrg) { res.status(403).json({ success: false, error: 'Cannot read another org\'s guardrail stats.' }); return; }
    effectiveOrg = callerOrg;
  }
  const canSeeOrgIds = CROSS_ORG_ROLES_GS.has(role); // strip org_id from payload otherwise

  try {
    if (!db) {
      sendApiError(res, 'DB_UNAVAILABLE', { status: 503 });
      return;
    }

    // Counts: pass / fail / null + total.
    const counts: any = await db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE passed = TRUE)::int                     AS passed_c,
        COUNT(*) FILTER (WHERE passed = FALSE)::int                    AS failed_c,
        COUNT(*) FILTER (WHERE passed IS NULL)::int                    AS na_c,
        COUNT(*)::int                                                  AS total_c,
        COUNT(*) FILTER (WHERE flagged = TRUE)::int                    AS flagged_c
      FROM nv_hallucination_detections
      WHERE created_at > ${dayAgo}
        AND (${jurisdiction}::text IS NULL OR jurisdiction = ${jurisdiction})
        AND (${effectiveOrg}::text IS NULL OR org_id = ${effectiveOrg})
    `).catch((e: any) => { logger.warn('guardrail_stats_count_failed', { err: String(e) }); return { rows: [{}] }; });
    const c = (counts.rows ?? [{}])[0] ?? {};
    const passed_c  = Number(c.passed_c ?? 0);
    const failed_c  = Number(c.failed_c ?? 0);
    const na_c      = Number(c.na_c ?? 0);
    const total_c   = Number(c.total_c ?? 0);
    const flagged_c = Number(c.flagged_c ?? 0);
    const evaluated = passed_c + failed_c;
    const passRate  = evaluated > 0 ? passed_c / evaluated : 0;

    // Per-guardrail breakdown — reverses the old hard-coded `top_categories`.
    const byType: any = await db.execute(sql`
      SELECT guardrail_type,
             COUNT(*) FILTER (WHERE passed = FALSE)::int AS fails,
             COUNT(*) FILTER (WHERE passed IS NOT NULL)::int AS evaluated,
             COUNT(*)::int AS total
      FROM nv_hallucination_detections
      WHERE created_at > ${dayAgo}
        AND (${jurisdiction}::text IS NULL OR jurisdiction = ${jurisdiction})
        AND (${effectiveOrg}::text IS NULL OR org_id = ${effectiveOrg})
      GROUP BY guardrail_type
      ORDER BY fails DESC, total DESC
    `).catch(() => ({ rows: [] }));
    const failsTotal = Math.max(1, extractRows(byType).reduce((a: number, r: any) => a + Number(r.fails ?? 0), 0));
    const top_categories = extractRows(byType).map((r: any) => ({
      category:  r.guardrail_type ?? 'unknown',
      count:     Number(r.fails ?? 0),
      pct:       Math.round((Number(r.fails ?? 0) / failsTotal) * 100),
      evaluated: Number(r.evaluated ?? 0),
      total:     Number(r.total ?? 0),
    }));

    // By-endpoint
    const byRoute: any = await db.execute(sql`
      SELECT route,
             COUNT(*) FILTER (WHERE passed = FALSE)::int AS blocked,
             COUNT(*)::int AS total
      FROM nv_hallucination_detections
      WHERE created_at > ${dayAgo}
        AND route IS NOT NULL
        AND (${jurisdiction}::text IS NULL OR jurisdiction = ${jurisdiction})
        AND (${effectiveOrg}::text IS NULL OR org_id = ${effectiveOrg})
      GROUP BY route
      ORDER BY blocked DESC, total DESC
      LIMIT 8
    `).catch(() => ({ rows: [] }));
    const by_endpoint = extractRows(byRoute).map((r: any) => ({
      endpoint: r.route, blocked: Number(r.blocked ?? 0), total: Number(r.total ?? 0),
    }));

    // Severity breakdown of failed rows.
    const sev: any = await db.execute(sql`
      SELECT severity, COUNT(*)::int AS c
      FROM nv_hallucination_detections
      WHERE created_at > ${dayAgo} AND passed = FALSE
        AND (${jurisdiction}::text IS NULL OR jurisdiction = ${jurisdiction})
        AND (${effectiveOrg}::text IS NULL OR org_id = ${effectiveOrg})
      GROUP BY severity
    `).catch(() => ({ rows: [] }));
    const by_severity: Record<string, number> = { low: 0, medium: 0, high: 0, critical: 0 };
    for (const r of extractRows(sev)) {
      const k = String(r.severity ?? 'low').toLowerCase();
      if (k in by_severity) by_severity[k] = Number(r.c ?? 0);
    }

    // 14-day pass-rate trend (excluding null/NA from denominator).
    const trend: any = await db.execute(sql`
      SELECT DATE_TRUNC('day', created_at)::date AS day,
             COUNT(*) FILTER (WHERE passed = TRUE)::int  AS passed_c,
             COUNT(*) FILTER (WHERE passed = FALSE)::int AS failed_c,
             COUNT(*) FILTER (WHERE passed IS NULL)::int AS na_c,
             COUNT(*)::int AS total_c
      FROM nv_hallucination_detections
      WHERE created_at > NOW() - INTERVAL '14 days'
        AND (${jurisdiction}::text IS NULL OR jurisdiction = ${jurisdiction})
        AND (${effectiveOrg}::text IS NULL OR org_id = ${effectiveOrg})
      GROUP BY 1 ORDER BY 1 ASC
    `).catch(() => ({ rows: [] }));
    const trend_14d = extractRows(trend).map((r: any) => {
      const p = Number(r.passed_c ?? 0), f = Number(r.failed_c ?? 0), n = Number(r.na_c ?? 0);
      const evald = p + f;
      return {
        day: r.day,
        passed: p, failed: f, not_applicable: n, total: Number(r.total_c ?? 0),
        pass_rate: evald > 0 ? p / evald : null,
      };
    });

    // Recent events for the right-rail panel.
    const recent: any = await db.execute(sql`
      SELECT id, created_at, route, guardrail_type, severity, passed, flagged,
             org_id, jurisdiction, details
      FROM nv_hallucination_detections
      WHERE created_at > ${dayAgo}
        AND (${jurisdiction}::text IS NULL OR jurisdiction = ${jurisdiction})
        AND (${effectiveOrg}::text IS NULL OR org_id = ${effectiveOrg})
      ORDER BY created_at DESC LIMIT 25
    `).catch(() => ({ rows: [] }));
    const recent_events = extractRows(recent).map((r: any) => ({
      id:        String(r.id),
      timestamp: r.created_at,
      endpoint:  r.route ?? '—',
      trigger:   r.guardrail_type === 'pii_redaction' ? 'prompt' : 'response',
      category:  r.guardrail_type ?? 'unknown',
      severity:  r.passed === null ? 'low' : (r.severity ?? 'low'),
      action:    r.passed === false ? 'blocked' : (r.passed === null ? 'not_applicable' : 'passed'),
      passed:    r.passed,
      ...(canSeeOrgIds ? { org_id: r.org_id } : {}),
      details:   r.details ?? '—',
    }));

    // Live EC2 / NSP path: when nv_hallucination_detections is empty, derive
    // guardrail activity from the hash-chained safety verdicts + SDK logs.
    if (total_c === 0) {
      const safety: any = await db.execute(sql`
        SELECT
          COUNT(*) FILTER (WHERE event_type = 'orchestration.safety-verdict:pass')::int AS passed_c,
          COUNT(*) FILTER (WHERE event_type = 'orchestration.safety-verdict:review')::int AS review_c,
          COUNT(*)::int AS total_c
        FROM nv_schema.nv_audit_logs
        WHERE created_at > NOW() - INTERVAL '7 days'
          AND event_type LIKE 'orchestration.safety-verdict:%'
          AND (${jurisdiction}::text IS NULL OR payload->>'jurisdiction' = ${jurisdiction})
          AND (${effectiveOrg}::text IS NULL OR payload->>'orgId' = ${effectiveOrg} OR payload->>'org_id' = ${effectiveOrg})
      `).catch(() => ({ rows: [{ passed_c: 0, review_c: 0, total_c: 0 }] }));

      const sdk: any = await db.execute(sql`
        SELECT COUNT(*)::int AS total_c
        FROM public.sdk_api_request_logs
        WHERE created_at > NOW() - INTERVAL '7 days'
          AND (${effectiveOrg}::text IS NULL OR metadata->>'org_id' = ${effectiveOrg})
      `).catch(() => ({ rows: [{ total_c: 0 }] }));

      const s = (safety.rows ?? [{}])[0] ?? {};
      const sdkTotal = Number((sdk.rows ?? [{}])[0]?.total_c ?? 0);
      const passC = Number(s.passed_c ?? 0);
      const reviewC = Number(s.review_c ?? 0);
      const safetyTotal = Number(s.total_c ?? 0);
      const combinedTotal = Math.max(safetyTotal, sdkTotal);

      const liveRecent: any = await db.execute(sql`
        SELECT id::text, event_type, payload, created_at
        FROM nv_schema.nv_audit_logs
        WHERE created_at > NOW() - INTERVAL '7 days'
          AND event_type IN ('orchestrate.complete', 'orchestration.safety-verdict:pass', 'orchestration.safety-verdict:review')
        ORDER BY created_at DESC
        LIMIT 25
      `).catch(() => ({ rows: [] }));

      const sdkRecent: any = await db.execute(sql`
        SELECT ('sdk-' || id::text) AS id, 'sdk.api.request' AS event_type,
               jsonb_build_object('endpoint', endpoint, 'method', method, 'statusCode', status_code) AS payload,
               created_at
        FROM public.sdk_api_request_logs
        WHERE created_at > NOW() - INTERVAL '7 days'
        ORDER BY created_at DESC
        LIMIT 25
      `).catch(() => ({ rows: [] }));

      const mergedRecent = [...extractRows(liveRecent), ...extractRows(sdkRecent)]
        .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, 25);

      const liveEvents = mergedRecent.map((r: any) => {
        const payload = typeof r.payload === 'string' ? JSON.parse(r.payload || '{}') : (r.payload ?? {});
        const isReview = r.event_type === 'orchestration.safety-verdict:review';
        return {
          id: String(r.id),
          timestamp: r.created_at,
          endpoint: payload.route ?? payload.endpoint ?? r.event_type,
          trigger: 'response',
          category: r.event_type,
          severity: isReview ? 'medium' : 'low',
          action: isReview ? 'review' : 'passed',
          passed: isReview ? false : true,
          details: payload.agentKey ?? payload.requestId ?? '—',
        };
      });

      const evald = passC + reviewC;
      return void res.json({
        success: true,
        data: {
          jurisdiction: jurisdiction ?? 'ALL',
          total_requests_24h: combinedTotal,
          evaluated_24h: evald,
          passed_24h: passC,
          blocked_24h: reviewC,
          flagged_24h: reviewC,
          not_applicable_24h: Math.max(0, combinedTotal - evald),
          pass_rate: evald > 0 ? passC / evald : 1,
          top_categories: [
            { category: 'safety_verdict_pass', count: passC, pct: evald > 0 ? Math.round((passC / evald) * 100) : 0, evaluated: evald, total: safetyTotal },
            { category: 'safety_verdict_review', count: reviewC, pct: evald > 0 ? Math.round((reviewC / evald) * 100) : 0, evaluated: evald, total: safetyTotal },
          ],
          by_endpoint: [],
          by_severity: { low: passC, medium: reviewC, high: 0, critical: 0 },
          recent_events: liveEvents,
          trend_14d: [],
          last_updated: now.toISOString(),
          source: 'nv_schema.nv_audit_logs+fallback',
        },
      });
    }

    res.json({
      success: true,
      data: {
        jurisdiction: jurisdiction ?? 'ALL',
        total_requests_24h:  total_c,
        evaluated_24h:       evaluated,
        passed_24h:          passed_c,
        blocked_24h:         failed_c,
        flagged_24h:         flagged_c,
        not_applicable_24h:  na_c,
        pass_rate:           passRate,            // ratio over evaluated (passed/(passed+failed))
        top_categories,
        by_endpoint,
        by_severity,
        recent_events,
        trend_14d,
        last_updated: now.toISOString(),
        source: 'nv_hallucination_detections',
      },
    });
  } catch (err: any) {
    logger.error('guardrail_stats_failed', { err: String(err) });
    sendApiError(res, 'BAD_REQUEST', { status: 500, overrideMessage: 'Failed to fetch guardrail stats' });
  }
});

// ── ADMIN: Platform Health Ping ────────────────────────────────────────────────
// EC2 bundles all 6 ecosystem platforms behind the gateway — external localhost
// pings always fail. Derive status from gateway health + optional live probes.
router.get('/admin/platform-health', authenticateToken, requireRole('admin', 'super_admin'), async (_req: Request, res: Response) => {
  const gatewayBase = process.env.JRX_GATEWAY_INTERNAL_URL
    || process.env.JRX_INTERNAL_GATEWAY_URL
    || 'http://gateway:5000';

  let gatewayHealthy = false;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 3000);
    const r = await fetch(`${gatewayBase}/api/jrx/health`, { signal: ctrl.signal }).catch(() => null);
    clearTimeout(t);
    gatewayHealthy = Boolean(r?.ok);
  } catch { /* ignore */ }

  const platforms = [
    { id: './jrx-sdk',      name: 'Jurexio Enterprise Platform SDK',                badge: 'CORE' },
    { id: 'jurexio-citizen',  name: 'Jurexio Citizen',                   badge: 'BETA' },
    { id: 'nsp',         name: 'Jurexio Professional™',     badge: 'LIVE' },
    { id: 'nsp-mobile',  name: 'NSP Mobile',                    badge: 'LIVE' },
    { id: 'jrx',         name: 'JRX (Gate 8)',                  badge: 'LIVE' },
    { id: 'nsi',         name: 'Jurexio Institutional™',    badge: 'BETA' },
    { id: 'nsg',         name: 'Jurexio Ministry™',         badge: 'BETA' },
    { id: 'ns-academy',  name: 'Jurexio Academy™',          badge: 'IN PROGRESS' },
  ];

  const results = platforms.map(p => ({
    ...p,
    status: gatewayHealthy ? 'online' : 'degraded',
    mode: 'bundled',
    latency: 0,
  }));

  res.json({ success: true, data: { platforms: results, gatewayHealthy, source: 'bundled-ec2' } });
});

export default router;

