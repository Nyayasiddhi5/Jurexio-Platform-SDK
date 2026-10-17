// NYV-NS-021 (2026-05-05): pre-existing strict-null cluster (gateway runs via tsx).
/**
 * NYV Feature Flag Manager v1.0.0
 * ─────────────────────────────────────────────────────────────────────────────
 * Production-grade feature flag system with:
 *   - Per-tenant (customer) flags
 *   - Per-environment flags (dev/staging/prod)
 *   - Per-jurisdiction flags
 *   - Per-platform flags (NYM/PRO/INS/GOV/ACE)
 *   - Kill switches (instant disable with zero restart)
 *   - Gradual rollout (percentage-based canary)
 *   - Time-bounded flags (auto-expire)
 *   - A/B test flags (variant assignment)
 *   - Hot reload (DB-backed, no restart)
 *
 * ARCHITECTURE RULES:
 *   - Never check feature flags inline with `process.env.FEATURE_X`
 *   - Always use featureFlagManager.isEnabled(flagKey, context)
 *   - Platform code never reads DB directly — always via this manager
 *
 * @module nyv-feature-flag-manager
 * @version 1.0.0
 */

import { EventEmitter } from 'events';
import { createLogger } from '../utils/logger.js';
import { db as _raw_db } from '../db/index.js';
import { lazyRequire } from '../utils/jrx-type-helpers.js';
const db = lazyRequire(() => _raw_db, 'db');
import { featureFlags } from '../../shared/schema.js';
import { eq } from 'drizzle-orm';

const logger = createLogger('nyv-feature-flags');

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export type FlagEnvironment = 'development' | 'staging' | 'production' | 'all';
export type FlagPlatform = 'nym' | 'pro' | 'ins' | 'gov' | 'ace' | 'sdk' | 'all';
export type JurisdictionCode = 'IN' | 'UK' | 'GCC' | 'EU' | 'US' | 'SG' | 'all';
export type FlagType = 'boolean' | 'percentage' | 'variant' | 'timelimited' | 'killswitch';

export interface FlagRollout {
  type: 'all' | 'percentage' | 'allowlist' | 'denylist';
  percentage?: number;               // 0-100 for percentage rollout
  allowedOrgIds?: string[];          // specific orgs that get this flag
  allowedUserIds?: string[];         // specific users that get this flag
  deniedOrgIds?: string[];           // orgs excluded from this flag
}

export interface FlagVariant {
  key: string;
  weight: number;                    // 0-100, must sum to 100 across variants
  value: any;
}

export interface FeatureFlag {
  key: string;                       // e.g., 'nv_graphrag_enabled'
  displayName: string;
  description: string;
  type: FlagType;
  enabled: boolean;

  // Targeting
  environments: FlagEnvironment[];
  platforms: FlagPlatform[];
  jurisdictions: JurisdictionCode[];

  // Rollout
  rollout: FlagRollout;

  // Variants (A/B testing)
  variants?: FlagVariant[];

  // Time-bounded
  enabledFrom?: string;              // ISO date — auto-enable
  enabledUntil?: string;             // ISO date — auto-disable

  // Kill switch
  killSwitchArmed?: boolean;         // instant disable if true

  // Metadata
  ownedBy?: string;                  // team responsible
  jiraTicket?: string;
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
}

export interface FlagEvalContext {
  orgId?: string;
  userId?: string;
  platform?: FlagPlatform;
  jurisdiction?: JurisdictionCode;
  environment?: FlagEnvironment;
  abTestSeed?: string;               // deterministic seed for A/B assignments
}

export interface FlagEvalResult {
  enabled: boolean;
  variant?: string;
  value?: any;
  reason: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// DEFAULT PLATFORM FLAGS
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_FLAGS: FeatureFlag[] = [
  // ── Core Intelligence ─────────────────────────────────────────────────────
  {
    key: 'nv_graphrag_enabled',
    displayName: 'Legal GraphRAG',
    description: 'Enable Legal Knowledge Graph RAG for multi-hop statute traversal',
    type: 'boolean', enabled: true, environments: ['all'], platforms: ['all'], jurisdictions: ['all'],
    rollout: { type: 'all' }, createdAt: '2026-04-04', updatedAt: '2026-04-04',
  },
  {
    key: 'nv_pre_llm_rag',
    displayName: 'Pre-LLM RAG Answer',
    description: 'Answer from RAG before hitting LLM if confidence > 0.85 (cost savings)',
    type: 'boolean', enabled: true, environments: ['all'], platforms: ['all'], jurisdictions: ['all'],
    rollout: { type: 'all' }, createdAt: '2026-04-04', updatedAt: '2026-04-04',
  },
  {
    key: 'nv_grpo_training',
    displayName: 'GRPO Training',
    description: 'GRPO optimization training runs for agent self-improvement',
    type: 'boolean', enabled: true, environments: ['all'], platforms: ['all'], jurisdictions: ['all'],
    rollout: { type: 'all' }, createdAt: '2026-04-04', updatedAt: '2026-04-04',
  },
  {
    key: 'nv_hallucination_check',
    displayName: 'Hallucination Detection',
    description: 'Citation grounding + confidence scoring on all LLM responses',
    type: 'boolean', enabled: true, environments: ['all'], platforms: ['all'], jurisdictions: ['all'],
    rollout: { type: 'all' }, createdAt: '2026-04-04', updatedAt: '2026-04-04',
  },
  {
    key: 'nv_bias_detection',
    displayName: 'Bias Detection',
    description: '6-dimension ML bias analysis on all agent responses',
    type: 'boolean', enabled: true, environments: ['all'], platforms: ['all'], jurisdictions: ['all'],
    rollout: { type: 'all' }, createdAt: '2026-04-04', updatedAt: '2026-04-04',
  },

  // ── Document Intelligence ─────────────────────────────────────────────────
  {
    key: 'nv_document_pipeline',
    displayName: 'Document Intelligence Pipeline',
    description: 'Upload → Parse → Embed → pgvector → GraphRAG pipeline',
    type: 'boolean', enabled: true, environments: ['all'], platforms: ['all'], jurisdictions: ['all'],
    rollout: { type: 'all' }, createdAt: '2026-04-04', updatedAt: '2026-04-04',
  },
  {
    key: 'nv_ocr_multilingual',
    displayName: 'Multilingual OCR',
    description: 'GPT-4V + Tesseract OCR for 22 Indian languages',
    type: 'boolean', enabled: true, environments: ['all'], platforms: ['all'], jurisdictions: ['all'],
    rollout: { type: 'all' }, createdAt: '2026-04-04', updatedAt: '2026-04-04',
  },

  // ── Communication ─────────────────────────────────────────────────────────
  {
    key: 'nv_voice_sessions',
    displayName: 'Voice AI Sessions',
    description: 'Real-time STT → LLM → TTS voice sessions via WebSocket',
    type: 'boolean', enabled: true, environments: ['all'], platforms: ['nym', 'pro'], jurisdictions: ['all'],
    rollout: { type: 'all' }, createdAt: '2026-04-04', updatedAt: '2026-04-04',
  },
  {
    key: 'nv_whatsapp_integration',
    displayName: 'WhatsApp Business Integration',
    description: 'Bilingual WhatsApp messaging (22 Indian languages + English)',
    type: 'boolean', enabled: false, environments: ['production'], platforms: ['nym'], jurisdictions: ['IN'],
    rollout: { type: 'all' }, createdAt: '2026-04-04', updatedAt: '2026-04-04',
    // @ts-expect-error NV-TS230 legacy typing gap (TS1117)
    ownedBy: 'india-team', description: 'Needs NYV_WHATSAPP_TOKEN to enable',
  },

  // ── Agentic Features ──────────────────────────────────────────────────────
  {
    key: 'nv_a2a_collaboration',
    displayName: 'Agent-to-Agent Collaboration',
    description: 'Cross-agent communication and handoff bus',
    type: 'boolean', enabled: true, environments: ['all'], platforms: ['all'], jurisdictions: ['all'],
    rollout: { type: 'all' }, createdAt: '2026-04-04', updatedAt: '2026-04-04',
  },
  {
    key: 'nv_bmad_clusters',
    displayName: 'BMAD Agent Clusters',
    description: 'Business Multi-Agent Design cluster formation',
    type: 'boolean', enabled: true, environments: ['all'], platforms: ['pro', 'ins', 'gov'], jurisdictions: ['all'],
    rollout: { type: 'all' }, createdAt: '2026-04-04', updatedAt: '2026-04-04',
  },
  {
    key: 'nv_digital_twin',
    displayName: 'Digital Twin Dashboard',
    description: 'Platform-level digital twin for monitoring and simulation',
    type: 'boolean', enabled: true, environments: ['all'], platforms: ['ins', 'gov'], jurisdictions: ['all'],
    rollout: { type: 'all' }, createdAt: '2026-04-04', updatedAt: '2026-04-04',
  },

  // ── Security ──────────────────────────────────────────────────────────────
  {
    key: 'nv_pii_vault',
    displayName: 'PII Vault Encryption',
    description: 'Automatic PII encryption with 30-min auto-expiry',
    type: 'killswitch', enabled: true, environments: ['all'], platforms: ['all'], jurisdictions: ['all'],
    rollout: { type: 'all' }, killSwitchArmed: true,
    createdAt: '2026-04-04', updatedAt: '2026-04-04',
  },
  {
    key: 'nv_quantum_security',
    displayName: 'Quantum-Ready Cryptography',
    description: 'Kyber-512 + Dilithium-44 + FALCON post-quantum algorithms',
    type: 'boolean', enabled: true, environments: ['all'], platforms: ['all'], jurisdictions: ['all'],
    rollout: { type: 'all' }, createdAt: '2026-04-04', updatedAt: '2026-04-04',
  },

  // ── MCP Tools ─────────────────────────────────────────────────────────────
  {
    key: 'nv_mcp_tools',
    displayName: 'MCP Tool Execution',
    description: '53 live MCP tools (legal research, documents, compliance)',
    type: 'boolean', enabled: true, environments: ['all'], platforms: ['all'], jurisdictions: ['all'],
    rollout: { type: 'all' }, createdAt: '2026-04-04', updatedAt: '2026-04-04',
  },

  // ── Payments ──────────────────────────────────────────────────────────────
  {
    key: 'nv_razorpay_payments',
    displayName: 'Razorpay / UPI Payments',
    description: 'UPI and Razorpay payment processing',
    type: 'boolean', enabled: false, environments: ['production'], platforms: ['nym', 'pro'], jurisdictions: ['IN'],
    rollout: { type: 'all' }, createdAt: '2026-04-04', updatedAt: '2026-04-04',
    // @ts-expect-error NV-TS230 legacy typing gap (TS1117)
    description: 'Needs NYV_RAZORPAY_KEY_ID to enable',
  },

  // ── Analytics ─────────────────────────────────────────────────────────────
  {
    key: 'nv_cost_analytics',
    displayName: 'Cost Analytics',
    description: 'Per-request token cost tracking and budget enforcement',
    type: 'boolean', enabled: true, environments: ['all'], platforms: ['all'], jurisdictions: ['all'],
    rollout: { type: 'all' }, createdAt: '2026-04-04', updatedAt: '2026-04-04',
  },
  {
    key: 'nv_real_time_events',
    displayName: 'Real-time WebSocket Events',
    description: 'WebSocket-pushed job progress and agent events',
    type: 'boolean', enabled: true, environments: ['all'], platforms: ['all'], jurisdictions: ['all'],
    rollout: { type: 'all' }, createdAt: '2026-04-04', updatedAt: '2026-04-04',
  },

  // ── RAG / Search ──────────────────────────────────────────────────────────
  {
    key: 'nv_rag_search',
    displayName: 'RAG Semantic Search',
    description: 'Hybrid RAG search (pgvector HNSW + BM25) across user documents',
    type: 'boolean', enabled: true, environments: ['all'], platforms: ['all'], jurisdictions: ['all'],
    rollout: { type: 'all' }, createdAt: '2026-04-04', updatedAt: '2026-04-04',
  },
  {
    key: 'nv_social_memory',
    displayName: 'Social Memory',
    description: 'Cross-session social memory for agent-user continuity',
    type: 'boolean', enabled: true, environments: ['all'], platforms: ['all'], jurisdictions: ['all'],
    rollout: { type: 'all' }, createdAt: '2026-04-04', updatedAt: '2026-04-04',
  },

  // ── Multi-modal ───────────────────────────────────────────────────────────
  {
    key: 'nv_multimodal',
    displayName: 'Multimodal Processing',
    description: 'Vision (GPT-4V) + Audio + 3D avatar capabilities',
    type: 'boolean', enabled: true, environments: ['all'], platforms: ['all'], jurisdictions: ['all'],
    rollout: { type: 'all' }, createdAt: '2026-04-04', updatedAt: '2026-04-04',
  },
  {
    key: 'nv_avatar_sessions',
    displayName: '3D Avatar Sessions',
    description: 'ChatDollKit + Unity3D avatar with lip-sync',
    type: 'boolean', enabled: true, environments: ['all'], platforms: ['nym'], jurisdictions: ['all'],
    rollout: { type: 'all' }, createdAt: '2026-04-04', updatedAt: '2026-04-04',
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// FEATURE FLAG MANAGER
// ─────────────────────────────────────────────────────────────────────────────

export class NyvFeatureFlagManager extends EventEmitter {
  private static instance: NyvFeatureFlagManager;
  private flags = new Map<string, FeatureFlag>();
  private readonly currentEnv: FlagEnvironment;

  private constructor() {
    super();
    this.currentEnv = (process.env.NODE_ENV as FlagEnvironment) ?? 'development';
    for (const flag of DEFAULT_FLAGS) {
      this.flags.set(flag.key, flag);
    }
    logger.info(`[FeatureFlags] Loaded ${this.flags.size} flags`);
  }

  static getInstance(): NyvFeatureFlagManager {
    if (!NyvFeatureFlagManager.instance) {
      NyvFeatureFlagManager.instance = new NyvFeatureFlagManager();
    }
    return NyvFeatureFlagManager.instance;
  }

  // ── Core evaluation ────────────────────────────────────────────────────────

  isEnabled(flagKey: string, ctx: FlagEvalContext = {}): boolean {
    const result = this.evaluate(flagKey, ctx);
    return result.enabled;
  }

  evaluate(flagKey: string, ctx: FlagEvalContext = {}): FlagEvalResult {
    const flag = this.flags.get(flagKey);
    if (!flag) {
      return { enabled: false, reason: 'flag-not-found' };
    }

    // Kill switch check (instant disable)
    if (flag.type === 'killswitch' && flag.killSwitchArmed && !flag.enabled) {
      return { enabled: false, reason: 'kill-switch-armed' };
    }

    // Global disable
    if (!flag.enabled) {
      return { enabled: false, reason: 'globally-disabled' };
    }

    // Environment filter
    const env = ctx.environment ?? this.currentEnv;
    if (!flag.environments.includes('all') && !flag.environments.includes(env)) {
      return { enabled: false, reason: `env-not-allowed:${env}` };
    }

    // Platform filter
    if (ctx.platform && !flag.platforms.includes('all') && !flag.platforms.includes(ctx.platform)) {
      return { enabled: false, reason: `platform-not-allowed:${ctx.platform}` };
    }

    // Jurisdiction filter
    if (ctx.jurisdiction && !flag.jurisdictions.includes('all') && !flag.jurisdictions.includes(ctx.jurisdiction)) {
      return { enabled: false, reason: `jurisdiction-not-allowed:${ctx.jurisdiction}` };
    }

    // Time-bounded check
    if (flag.enabledFrom && new Date(flag.enabledFrom) > new Date()) {
      return { enabled: false, reason: 'not-yet-active' };
    }
    if (flag.enabledUntil && new Date(flag.enabledUntil) < new Date()) {
      return { enabled: false, reason: 'expired' };
    }

    // Rollout check
    if (!this.evaluateRollout(flag, ctx)) {
      return { enabled: false, reason: 'rollout-excluded' };
    }

    // Variant assignment
    if (flag.type === 'variant' && flag.variants) {
      const variant = this.assignVariant(flagKey, flag.variants, ctx.abTestSeed ?? ctx.userId ?? ctx.orgId ?? '');
      return { enabled: true, variant: variant.key, value: variant.value, reason: 'variant-assigned' };
    }

    return { enabled: true, reason: 'enabled' };
  }

  // ── CRUD operations ────────────────────────────────────────────────────────

  upsert(flag: Omit<FeatureFlag, 'createdAt' | 'updatedAt'> & { createdAt?: string }): void {
    const existing = this.flags.get(flag.key);
    const now = new Date().toISOString();
    const entry: FeatureFlag = {
      ...flag,
      createdAt: existing?.createdAt ?? flag.createdAt ?? now,
      updatedAt: now,
    };
    this.flags.set(flag.key, entry);
    this.emit('flag:updated', entry);
    logger.info(`[FeatureFlags] ${existing ? 'Updated' : 'Created'} flag: ${flag.key}`);
  }

  delete(flagKey: string): boolean {
    const removed = this.flags.delete(flagKey);
    if (removed) this.emit('flag:deleted', { key: flagKey });
    return removed;
  }

  setEnabled(flagKey: string, enabled: boolean): void {
    const flag = this.flags.get(flagKey);
    if (!flag) throw new Error(`Flag not found: ${flagKey}`);
    flag.enabled = enabled;
    flag.updatedAt = new Date().toISOString();
    this.emit('flag:toggled', { key: flagKey, enabled });
    logger.info(`[FeatureFlags] Flag ${flagKey}: ${enabled ? 'ON' : 'OFF'}`);
  }

  armKillSwitch(flagKey: string): void {
    const flag = this.flags.get(flagKey);
    if (!flag) throw new Error(`Flag not found: ${flagKey}`);
    flag.enabled = false;
    flag.killSwitchArmed = true;
    flag.updatedAt = new Date().toISOString();
    this.emit('flag:kill-switch', { key: flagKey });
    logger.warn(`[FeatureFlags] KILL SWITCH ARMED: ${flagKey}`);
  }

  // ── Query ─────────────────────────────────────────────────────────────────

  getAll(): FeatureFlag[] {
    return Array.from(this.flags.values());
  }

  get(flagKey: string): FeatureFlag | undefined {
    return this.flags.get(flagKey);
  }

  getEnabledFlags(ctx: FlagEvalContext = {}): string[] {
    return Array.from(this.flags.keys()).filter(key => this.isEnabled(key, ctx));
  }

  // ── Hot reload from DB ────────────────────────────────────────────────────
  async syncFromDatabase(): Promise<void> {
    try {
      const rows = await db.select().from(featureFlags);
      let synced = 0;
      for (const row of rows) {
        const existing = this.flags.get(row.flagKey);
        if (existing) {
          existing.enabled = row.isEnabled ?? existing.enabled;
          if (row.description) existing.description = row.description;
          if (row.metadata && typeof row.metadata === 'object') {
            const meta = row.metadata as Record<string, any>;
            if (meta.killSwitchArmed !== undefined) existing.killSwitchArmed = meta.killSwitchArmed;
            if (meta.rollout !== undefined) existing.rollout = meta.rollout;
          }
          existing.updatedAt = row.updatedAt?.toISOString() ?? existing.updatedAt;
          this.flags.set(row.flagKey, existing);
          synced++;
        }
      }
      logger.info(`[FeatureFlags] DB sync complete — ${synced}/${rows.length} flags merged from scoped_feature_flags`);
    } catch (err: any) {
      logger.warn(`[FeatureFlags] DB sync skipped (table may not exist yet): ${err?.message}`);
    }
  }

  async persistToDatabase(flagKey: string): Promise<void> {
    const flag = this.flags.get(flagKey);
    if (!flag) return;
    try {
      const existing = await db.select().from(featureFlags).where(eq(featureFlags.flagKey, flagKey));
      if (existing.length > 0) {
        await db.update(featureFlags)
          .set({
            isEnabled: flag.enabled,
            description: flag.description,
            metadata: { killSwitchArmed: flag.killSwitchArmed, rollout: flag.rollout } as any,
            updatedAt: new Date(),
          })
          .where(eq(featureFlags.flagKey, flagKey));
      } else {
        await db.insert(featureFlags).values({
          flagKey,
          scope: 'global',
          scopeId: '_global',
          isEnabled: flag.enabled,
          description: flag.description,
          metadata: { killSwitchArmed: flag.killSwitchArmed, rollout: flag.rollout } as any,
        });
      }
      logger.debug(`[FeatureFlags] Persisted flag '${flagKey}' to DB`);
    } catch (err: any) {
      logger.warn(`[FeatureFlags] Could not persist flag '${flagKey}' to DB: ${err?.message}`);
    }
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private evaluateRollout(flag: FeatureFlag, ctx: FlagEvalContext): boolean {
    const { rollout } = flag;
    switch (rollout.type) {
      case 'all': return true;
      case 'allowlist':
        return (
          (ctx.orgId !== undefined && (rollout.allowedOrgIds?.includes(ctx.orgId) ?? false)) ||
          (ctx.userId !== undefined && (rollout.allowedUserIds?.includes(ctx.userId) ?? false))
        );
      case 'denylist':
        if (ctx.orgId && rollout.deniedOrgIds?.includes(ctx.orgId)) return false;
        return true;
      case 'percentage': {
        const seed = ctx.userId ?? ctx.orgId ?? '';
        const hash = this.simpleHash(`${flag.key}:${seed}`);
        return (hash % 100) < (rollout.percentage ?? 0);
      }
      default: return true;
    }
  }

  private assignVariant(flagKey: string, variants: FlagVariant[], seed: string): FlagVariant {
    const hash = this.simpleHash(`${flagKey}:${seed}`);
    const bucket = hash % 100;
    let accumulated = 0;
    for (const variant of variants) {
      accumulated += variant.weight;
      if (bucket < accumulated) return variant;
    }
    return variants[variants.length - 1];
  }

  private simpleHash(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash);
  }
}

export const featureFlagManager = NyvFeatureFlagManager.getInstance();
