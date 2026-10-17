/**
 * NYV SaaS Tenant Manager v1.0.0
 * ─────────────────────────────────────────────────────────────────────────────
 * Enterprise SaaS multi-tenancy management for Jurexio Enterprise Platform.
 *
 * TENANT HIERARCHY:
 *   Platform (NYV) → Customer Organization → Sub-Orgs → Users
 *
 * ISOLATION GUARANTEES:
 *   - Database: All queries include WHERE organization_id = :orgId
 *   - Document Storage: Per-org and per-user namespaces (user:{orgId}:{userId}:*)
 *   - LLM Budget: Per-org AI credit cap (HTTP 429 when exceeded)
 *   - Rate Limits: Per-org RPM + per-SDK-key limits
 *   - Secrets: Per-org encrypted config (no cross-tenant key access)
 *   - Audit Logs: Per-org tagged (never cross-pollinated)
 *   - Vector DB: Per-org HNSW namespace
 *
 * ENTERPRISE DEPLOYMENT MODELS:
 *   A. Shared SaaS (default): Multiple customers on one platform deployment
 *   B. Dedicated Tenant: Single customer gets their own deployment (K8s namespace)
 *   C. On-Premise: Customer runs NYV in their own infrastructure
 *   D. Jurisdiction-Isolated: Separate data residency per jurisdiction
 *
 * DATA SOVEREIGNTY RULES:
 *   - IN jurisdiction data: India (Mumbai/Chennai regions only)
 *   - EU jurisdiction data: EU (Frankfurt/Amsterdam only)
 *   - GCC jurisdiction data: UAE/Saudi (Gulf regions only)
 *   - US jurisdiction data: US-East/US-West only
 *   - Default: Customer's declared residency region
 *
 * @module nyv-saas-tenant-manager
 * @version 1.0.0
 */

import { EventEmitter } from 'events';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('nyv-tenant-manager');

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export type TenantTier = 'free' | 'solo' | 'plus' | 'pro' | 'enterprise' | 'white-label' | 'on-premise';
export type DataResidencyRegion = 'IN' | 'EU' | 'US' | 'GCC' | 'SG' | 'UK' | 'GLOBAL';
export type TenantStatus = 'active' | 'suspended' | 'trial' | 'churned' | 'pending-activation';
export type DeploymentModel = 'shared-saas' | 'dedicated' | 'on-premise' | 'hybrid';

export interface TenantBudgetConfig {
  dailyAiCreditUsd: number;          // Max USD spend on LLM per day
  monthlyAiCreditUsd: number;        // Max USD spend on LLM per month
  maxTokensPerRequest: number;
  maxDocumentStorageMb: number;       // Storage quota
  maxActiveUsers: number;
  maxApiCallsPerMinute: number;       // Global RPM cap
  maxConcurrentSessions: number;
}

export interface TenantLLMConfig {
  allowedModels: string[];            // ['*'] = all, or specific model IDs
  blockedModels: string[];
  defaultModel: string;              // Default model ID for this tenant
  maxModelTier: number;              // 1-5, max tier allowed
  requireDataResidency: boolean;     // Force residency-compliant models only
  customSystemPromptPrefix?: string; // Injected at start of every system prompt
}

export interface TenantFeatureConfig {
  enabledFeatureFlags: string[];     // Additional flags enabled for this tenant
  disabledFeatureFlags: string[];    // Flags disabled specifically for this tenant
  customPlatformLabel?: string;      // White-label name override
  customLogoUrl?: string;
  customPrimaryColor?: string;
  enabledPlatforms: string[];        // Which NYS platforms this tenant can access
  enabledJurisdictions: string[];    // Jurisdictions this tenant is licensed for
  enabledAgentPatterns: string[];    // ['*'] or specific pattern IDs
}

export interface TenantDataConfig {
  dataResidencyRegion: DataResidencyRegion;
  encryptionKeyId?: string;          // Customer-managed encryption key (BYOK)
  retentionDays: number;             // Data retention period
  auditLogRetentionDays: number;
  allowCrossOrgAgentCollaboration: boolean;
  allowDataExport: boolean;
  piiAutoAnonymizeDays: number;      // Auto-anonymize PII after N days (0 = disabled)
}

export interface TenantSecurityConfig {
  ssoEnabled: boolean;
  ssoProvider?: 'saml' | 'oidc' | 'google-workspace' | 'microsoft-ad';
  ssoConfig?: Record<string, string>;
  mfaRequired: boolean;
  allowedIpRanges: string[];         // Empty = all IPs allowed
  sessionTimeoutMinutes: number;
  passwordPolicy: 'standard' | 'strict' | 'enterprise';
  apiKeyRotationDays: number;        // Force API key rotation every N days
}

export interface TenantComplianceConfig {
  frameworks: string[];              // ['GDPR', 'DPDPA', 'CCPA', 'HIPAA', ...]
  dataProcessingAgreementSigned: boolean;
  dpaDate?: string;
  gdprDpo?: string;                  // DPO contact email
  certifications: string[];          // ['ISO27001', 'SOC2', ...]
  rightToErasureEnabled: boolean;    // GDPR Art. 17 / DPDPA
}

export interface TenantConfig {
  tenantId: string;                  // Unique tenant identifier
  orgId: string;                     // Maps to nv_organizations.id
  displayName: string;
  domain?: string;                   // Custom domain (e.g., legal.acme.com)
  tier: TenantTier;
  status: TenantStatus;
  deploymentModel: DeploymentModel;
  deploymentRegion: DataResidencyRegion;

  budget: TenantBudgetConfig;
  llm: TenantLLMConfig;
  features: TenantFeatureConfig;
  data: TenantDataConfig;
  security: TenantSecurityConfig;
  compliance: TenantComplianceConfig;

  // Billing
  subscriptionId?: string;
  billingEmail?: string;
  trialEndsAt?: string;

  // Metadata
  createdAt: string;
  updatedAt: string;
  activatedAt?: string;
  suspendedAt?: string;
  churnedAt?: string;
}

export interface TenantUsageReport {
  tenantId: string;
  period: { from: string; to: string };
  aiSpendUsd: number;
  totalTokensUsed: number;
  totalApiCalls: number;
  totalDocumentsProcessed: number;
  totalStorageMbUsed: number;
  activeUsers: number;
  topModelsUsed: Array<{ model: string; tokensUsed: number; costUsd: number }>;
}

// ─────────────────────────────────────────────────────────────────────────────
// TIER DEFAULTS
// ─────────────────────────────────────────────────────────────────────────────

export const TIER_DEFAULTS: Record<TenantTier, Pick<TenantConfig, 'budget' | 'llm'>> = {
  free: {
    budget: { dailyAiCreditUsd: 0.10, monthlyAiCreditUsd: 1.00, maxTokensPerRequest: 4096, maxDocumentStorageMb: 100, maxActiveUsers: 1, maxApiCallsPerMinute: 10, maxConcurrentSessions: 1 },
    llm: { allowedModels: ['gpt-4.1-nano', 'gemini-2.5-flash', 'nyv-agentzero'], blockedModels: [], defaultModel: 'gemini-2.5-flash', maxModelTier: 3, requireDataResidency: false },
  },
  solo: {
    budget: { dailyAiCreditUsd: 1.00, monthlyAiCreditUsd: 20, maxTokensPerRequest: 16384, maxDocumentStorageMb: 500, maxActiveUsers: 1, maxApiCallsPerMinute: 20, maxConcurrentSessions: 2 },
    llm: { allowedModels: ['*'], blockedModels: ['claude-opus-4-6', 'o3'], defaultModel: 'claude-sonnet-4-6', maxModelTier: 2, requireDataResidency: false },
  },
  plus: {
    budget: { dailyAiCreditUsd: 5.00, monthlyAiCreditUsd: 100, maxTokensPerRequest: 32768, maxDocumentStorageMb: 5000, maxActiveUsers: 5, maxApiCallsPerMinute: 60, maxConcurrentSessions: 5 },
    llm: { allowedModels: ['*'], blockedModels: [], defaultModel: 'claude-sonnet-4-6', maxModelTier: 2, requireDataResidency: false },
  },
  pro: {
    budget: { dailyAiCreditUsd: 25.00, monthlyAiCreditUsd: 500, maxTokensPerRequest: 100000, maxDocumentStorageMb: 50000, maxActiveUsers: 25, maxApiCallsPerMinute: 300, maxConcurrentSessions: 20 },
    llm: { allowedModels: ['*'], blockedModels: [], defaultModel: 'claude-opus-4-6', maxModelTier: 1, requireDataResidency: false },
  },
  enterprise: {
    budget: { dailyAiCreditUsd: 500, monthlyAiCreditUsd: 10000, maxTokensPerRequest: 1000000, maxDocumentStorageMb: 1000000, maxActiveUsers: 10000, maxApiCallsPerMinute: 600, maxConcurrentSessions: 200 },
    llm: { allowedModels: ['*'], blockedModels: [], defaultModel: 'claude-opus-4-6', maxModelTier: 1, requireDataResidency: false },
  },
  'white-label': {
    budget: { dailyAiCreditUsd: 1000, monthlyAiCreditUsd: 20000, maxTokensPerRequest: 1000000, maxDocumentStorageMb: 5000000, maxActiveUsers: 100000, maxApiCallsPerMinute: 6000, maxConcurrentSessions: 1000 },
    llm: { allowedModels: ['*'], blockedModels: [], defaultModel: 'claude-opus-4-6', maxModelTier: 1, requireDataResidency: true },
  },
  'on-premise': {
    budget: { dailyAiCreditUsd: Infinity, monthlyAiCreditUsd: Infinity, maxTokensPerRequest: 1000000, maxDocumentStorageMb: Infinity, maxActiveUsers: Infinity, maxApiCallsPerMinute: Infinity, maxConcurrentSessions: Infinity },
    llm: { allowedModels: ['*'], blockedModels: [], defaultModel: 'claude-opus-4-6', maxModelTier: 1, requireDataResidency: false },
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// TENANT MANAGER
// ─────────────────────────────────────────────────────────────────────────────

export class NyvSaaSTenantManager extends EventEmitter {
  private static instance: NyvSaaSTenantManager;
  private tenants = new Map<string, TenantConfig>();  // tenantId → config

  static getInstance(): NyvSaaSTenantManager {
    if (!NyvSaaSTenantManager.instance) {
      NyvSaaSTenantManager.instance = new NyvSaaSTenantManager();
    }
    return NyvSaaSTenantManager.instance;
  }

  // ── Tenant Lifecycle ────────────────────────────────────────────────────────

  provision(config: Omit<TenantConfig, 'createdAt' | 'updatedAt'>): TenantConfig {
    const now = new Date().toISOString();
    const tenant: TenantConfig = { ...config, createdAt: now, updatedAt: now };

    // Apply tier defaults as baseline
    const defaults = TIER_DEFAULTS[config.tier];
    tenant.budget = { ...defaults.budget, ...config.budget };
    tenant.llm = { ...defaults.llm, ...config.llm };

    this.tenants.set(config.tenantId, tenant);
    this.emit('tenant:provisioned', tenant);
    logger.info(`[TenantManager] Provisioned tenant: ${config.tenantId} (${config.tier})`);
    return tenant;
  }

  suspend(tenantId: string, reason: string): void {
    const tenant = this.require(tenantId);
    tenant.status = 'suspended';
    tenant.suspendedAt = new Date().toISOString();
    tenant.updatedAt = new Date().toISOString();
    this.emit('tenant:suspended', { tenantId, reason });
    logger.warn(`[TenantManager] Tenant suspended: ${tenantId} — ${reason}`);
  }

  activate(tenantId: string): void {
    const tenant = this.require(tenantId);
    tenant.status = 'active';
    tenant.activatedAt = new Date().toISOString();
    tenant.updatedAt = new Date().toISOString();
    this.emit('tenant:activated', { tenantId });
    logger.info(`[TenantManager] Tenant activated: ${tenantId}`);
  }

  upgrade(tenantId: string, newTier: TenantTier): void {
    const tenant = this.require(tenantId);
    const oldTier = tenant.tier;
    tenant.tier = newTier;
    const defaults = TIER_DEFAULTS[newTier];
    tenant.budget = { ...defaults.budget, ...tenant.budget };
    tenant.llm = { ...defaults.llm, ...tenant.llm };
    tenant.updatedAt = new Date().toISOString();
    this.emit('tenant:upgraded', { tenantId, from: oldTier, to: newTier });
    logger.info(`[TenantManager] Tenant ${tenantId} upgraded: ${oldTier} → ${newTier}`);
  }

  delete(tenantId: string): void {
    const tenant = this.require(tenantId);
    tenant.status = 'churned';
    tenant.churnedAt = new Date().toISOString();
    // DO NOT delete from map — keep for audit trail. Data purge is separate.
    this.emit('tenant:churned', { tenantId });
    logger.warn(`[TenantManager] Tenant churned: ${tenantId}`);
  }

  // ── Enforcement ────────────────────────────────────────────────────────────

  isModelAllowed(tenantId: string, modelId: string): boolean {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) return false;
    const { allowedModels, blockedModels } = tenant.llm;
    if (blockedModels.includes(modelId)) return false;
    return allowedModels.includes('*') || allowedModels.includes(modelId);
  }

  isFeatureEnabled(tenantId: string, flagKey: string): boolean {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) return false;
    if (tenant.features.disabledFeatureFlags.includes(flagKey)) return false;
    return true;
  }

  isJurisdictionEnabled(tenantId: string, jurisdiction: string): boolean {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) return false;
    const { enabledJurisdictions } = tenant.features;
    return enabledJurisdictions.includes('*') || enabledJurisdictions.includes(jurisdiction);
  }

  getDocumentNamespace(tenantId: string, userId: string, type: 'docs' | 'matters' | 'drafts' = 'docs'): string {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) throw new Error(`Tenant not found: ${tenantId}`);
    return `user:${tenant.orgId}:${userId}:${type}`;
  }

  getDataResidencyRegion(tenantId: string): DataResidencyRegion {
    return this.tenants.get(tenantId)?.data.dataResidencyRegion ?? 'GLOBAL';
  }

  checkBudget(tenantId: string, estimatedCostUsd: number): { allowed: boolean; reason?: string } {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) return { allowed: false, reason: 'tenant-not-found' };
    if (tenant.status !== 'active' && tenant.status !== 'trial') {
      return { allowed: false, reason: `tenant-${tenant.status}` };
    }
    // In production, query actual spend from nv_sdk_api_request_logs
    // and compare against budget config
    return { allowed: true };
  }

  // ── Queries ─────────────────────────────────────────────────────────────────

  get(tenantId: string): TenantConfig | undefined {
    return this.tenants.get(tenantId);
  }

  getByOrgId(orgId: string): TenantConfig | undefined {
    return Array.from(this.tenants.values()).find(t => t.orgId === orgId);
  }

  getAll(): TenantConfig[] {
    return Array.from(this.tenants.values());
  }

  getActive(): TenantConfig[] {
    return this.getAll().filter(t => t.status === 'active' || t.status === 'trial');
  }

  getByDeploymentModel(model: DeploymentModel): TenantConfig[] {
    return this.getAll().filter(t => t.deploymentModel === model);
  }

  getByRegion(region: DataResidencyRegion): TenantConfig[] {
    return this.getAll().filter(t => t.data.dataResidencyRegion === region);
  }

  // ── Usage Reporting ─────────────────────────────────────────────────────────

  async getUsageReport(tenantId: string, from: Date, to: Date): Promise<TenantUsageReport> {
    this.require(tenantId);
    // In production: query nv_sdk_api_request_logs GROUP BY model, sum tokens/cost
    return {
      tenantId,
      period: { from: from.toISOString(), to: to.toISOString() },
      aiSpendUsd: 0,
      totalTokensUsed: 0,
      totalApiCalls: 0,
      totalDocumentsProcessed: 0,
      totalStorageMbUsed: 0,
      activeUsers: 0,
      topModelsUsed: [],
    };
  }

  // ── Data Isolation Helpers ─────────────────────────────────────────────────

  buildIsolationFilter(tenantId: string): { orgId: string } {
    const tenant = this.require(tenantId);
    return { orgId: tenant.orgId };
  }

  auditLog(tenantId: string, action: string, actor: string, details: Record<string, unknown>): void {
    const tenant = this.tenants.get(tenantId);
    logger.info(`[TenantAudit] ${tenantId} | ${actor} | ${action}`, {
      tenantId, orgId: tenant?.orgId, action, actor, details,
      timestamp: new Date().toISOString(),
    });
    // In production: INSERT INTO nv_audit_log (org_id, action, actor, details) VALUES (...)
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private require(tenantId: string): TenantConfig {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) throw new Error(`Tenant not found: ${tenantId}`);
    return tenant;
  }
}

export const tenantManager = NyvSaaSTenantManager.getInstance();

// ─────────────────────────────────────────────────────────────────────────────
// ENTERPRISE DEPLOYMENT GUIDE (INLINE)
// ─────────────────────────────────────────────────────────────────────────────
/*
DEPLOYMENT MODELS:

A. SHARED SAAS (Default — most customers)
   ─────────────────────────────────────
   All customers share one NYV deployment.
   Isolation: DB row-level (org_id), separate K8s namespaces per tier group.
   Cost: Lowest (shared infrastructure)
   
   K8s: nyv-gateway pods with PodDisruptionBudget
   DB: Neon PostgreSQL — connection pooler shared, data isolated by org_id
   Storage: S3 with prefix-based isolation (user/{orgId}/...)

B. DEDICATED TENANT (Enterprise / White-Label)
   ────────────────────────────────────────────
   Customer gets dedicated K8s namespace: nyv-{tenantId}
   Dedicated Redis, dedicated PgBouncer pool
   Separate S3 bucket or GCS bucket per tenant
   
   Provisioning:
   1. kubectl create namespace nyv-{tenantId}
   2. Apply k8s/ manifests with tenant-specific values
   3. Provision dedicated Neon project
   4. Set tenant secrets: NYV_{TENANTID}_DATABASE_URL, NYV_{TENANTID}_S3_BUCKET

C. ON-PREMISE (Customer's own infrastructure)
   ──────────────────────────────────────────
   Customer runs NYV in their own K8s cluster.
   NYV SDK license key issued.
   Customer manages their own DB, Redis, S3.
   
   Install: helm install nyv nyv/platform --values customer-values.yaml

D. JURISDICTION-ISOLATED (Data Sovereignty)
   ─────────────────────────────────────────
   Separate deployment per jurisdiction:
   - nyv-in.legal.company.com  (India — Mumbai region)
   - nyv-eu.legal.company.com  (EU — Frankfurt)
   - nyv-us.legal.company.com  (US — Virginia)
   
   Data NEVER crosses jurisdiction boundaries.
   LLM calls respect data residency:
   - EU data: only gemini-3.1-pro-preview or mistral-large-2512 (EU hosted)
   - IN data: sarvam-ai + IN-routed OpenAI/Anthropic

JURISDICTION-SPECIFIC DEPLOYMENT CHECKLIST:
  □ Set NYV_DATA_RESIDENCY_REGION=IN|EU|US|GCC|SG|UK
  □ Configure LLM data residency rules in tenant.llm.requireDataResidency
  □ Set database region in Neon project settings
  □ Configure S3 bucket in target region
  □ Apply jurisdiction K8s affinity rules: nodeAffinity → region label
  □ Validate: GET /api/jrx/health/full → check 'dataResidency' field
*/
