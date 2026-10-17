/**
 * Maps intelligent-router MODEL_CATALOG (SSoT) → ModelRegistryEntry shape for
 * GET /api/jrx/models and console pickers. Write/admin paths still use
 * nyv-dynamic-model-registry for hot-reload overrides.
 */
import type { ModelRegistryEntry, RegistryStats } from '../../config/nyv-dynamic-model-registry.js';
import { MODEL_CATALOG, isProviderAvailable } from './model-catalog.js';
import type { ModelEntry } from './router-types.js';

function tierFromQuality(legalQuality: number): 1 | 2 | 3 | 4 | 5 {
  if (legalQuality >= 95) return 1;
  if (legalQuality >= 85) return 2;
  if (legalQuality >= 70) return 3;
  if (legalQuality >= 50) return 4;
  return 5;
}

function jurisdictionsFromFit(m: ModelEntry): string[] {
  const fit = m.jurisdictionFit;
  if (!fit || typeof fit !== 'object') return ['GLOBAL'];
  return Object.keys(fit);
}

export function modelCatalogEntryToRegistry(m: ModelEntry): ModelRegistryEntry {
  const tier = tierFromQuality(m.legalQuality ?? m.generalQuality ?? 50);
  const jurisdictions = jurisdictionsFromFit(m);
  const providerAvailable = (() => {
    try { return isProviderAvailable(m.provider); } catch { return false; }
  })();

  return {
    id: m.id,
    displayName: m.displayName,
    description: m.notes,
    version: '1.0.0',
    type: 'llm',
    provider: m.provider,
    providerModelId: m.id,
    apiKeyEnvVar: '',
    capabilities: {
      supportsStreaming: m.capabilities.streaming,
      supportsVision: m.capabilities.vision,
      supportsJsonMode: m.capabilities.json,
      supportsToolCalling: m.capabilities.functionCalling,
      supportsFunctionCalling: m.capabilities.functionCalling,
      supportsAudio: false,
      supportsReasoningChain: m.capabilities.reasoning,
      supportedLanguages: ['*'],
      supportedJurisdictions: jurisdictions,
      maxContextTokens: m.contextWindow,
      maxOutputTokens: m.maxOutput,
    },
    cost: {
      costPer1kInputTokens: (m.costInPer1M ?? 0) / 1000,
      costPer1kOutputTokens: (m.costOutPer1M ?? 0) / 1000,
      currency: 'USD',
      billingEntity: m.provider,
    },
    routing: {
      priority: m.isLatest ? 1 : 10,
      tier,
      allowedQueryTypes: ['*'],
      blockedQueryTypes: [],
      preferredForJurisdictions: jurisdictions,
      requiredForJurisdictions: [],
    },
    health: {
      healthCheckIntervalMs: 0,
      circuitBreakerThreshold: 5,
      circuitBreakerResetMs: 60_000,
      timeoutMs: 120_000,
      maxRetries: 2,
    },
    enabled: providerAvailable,
    enabledInEnvironments: ['all'],
    releasedAt: '2026-05-01',
    tags: [
      ...(m.isLatest ? ['latest'] : []),
      ...(m.isFree ? ['free'] : []),
      ...(m.preferredFor ?? []),
    ],
    notes: m.notes,
    addedAt: '2026-05-01',
    // Console snake_case compatibility (ModelCatalog.tsx reads both shapes)
    ...( {
      provider_id: m.provider,
      provider_name: m.provider,
      is_active: providerAvailable,
      input_cost_per_1k: (m.costInPer1M ?? 0) / 1000,
    } as Record<string, unknown> ),
  } as ModelRegistryEntry;
}

export function listModelCatalogAsRegistry(): ModelRegistryEntry[] {
  return MODEL_CATALOG.map(modelCatalogEntryToRegistry);
}

export function modelCatalogRegistryStats(): RegistryStats {
  const models = listModelCatalogAsRegistry();
  const byType = { llm: models.length, slm: 0, lrm: 0, embedding: 0, vision: 0, speech: 0 } as RegistryStats['byType'];
  const byTier = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } as RegistryStats['byTier'];
  const byProvider: Record<string, number> = {};
  const byJurisdiction: Record<string, number> = {};

  for (const m of models) {
    byTier[m.routing.tier] = (byTier[m.routing.tier] ?? 0) + 1;
    byProvider[m.provider] = (byProvider[m.provider] ?? 0) + 1;
    for (const j of m.capabilities.supportedJurisdictions) {
      byJurisdiction[j] = (byJurisdiction[j] ?? 0) + 1;
    }
  }

  return {
    totalModels: models.length,
    enabledModels: models.filter((m) => m.enabled).length,
    byType,
    byTier,
    byJurisdiction,
    byProvider,
  };
}
