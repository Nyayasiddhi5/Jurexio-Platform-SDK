/**
 * Jurexio White-Label Service v3.1.2
 * JRX-SVC-WHITE-LABEL-001
 *
 * Enables SDK partners to deploy fully white-labeled legal AI products
 * under their own brand — powered by the Jurexio intelligence core.
 *
 * White-Label Configuration includes:
 *   - Brand identity: logo, colors, typography, domain
 *   - Feature toggles per partner
 *   - Agent subset selection (which of 1042 agents are exposed)
 *   - Jurisdiction restriction (limit to specific jurisdictions)
 *   - Custom SLM binding preferences
 *   - Co-branding vs full white-label modes
 *   - Revenue sharing configuration
 *
 * Supported White-Label Products:
 *   - Jurexio Professional™ (law firm SaaS)
 *   - Jurexio Citizen (citizen legal aid)
 *   - Jurexio Institutional™ (enterprise)
 *   - Jurexio Ministry™ (government)
 *   - Jurexio Academy™ (education)
 *   - Custom SDK integrations (developer partners)
 */

import { logger } from '../../utils/logger.js';

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

export type WhiteLabelMode = 'full-white-label' | 'co-branded' | 'powered-by';
export type WhiteLabelTier = 'starter' | 'professional' | 'enterprise' | 'sovereign';

export interface BrandConfig {
  name: string;                      // Partner brand name
  logoUrl?: string;                  // Custom logo URL
  primaryColor: string;              // Hex color
  secondaryColor: string;            // Hex color
  accentColor?: string;
  fontFamily?: string;
  tagline?: string;
  domain?: string;                   // Custom domain (e.g., legal.partnercompany.com)
  supportEmail?: string;
  privacyPolicyUrl?: string;
  termsOfServiceUrl?: string;
}

export interface FeatureToggleConfig {
  voiceAssistant: boolean;
  multilingualSupport: boolean;
  documentDrafting: boolean;
  caseManagement: boolean;
  analyticsAndReporting: boolean;
  apiAccess: boolean;
  whatsappIntegration: boolean;
  mobileApp: boolean;
  avatarAssistant: boolean;
  quantumEncryption: boolean;
  digitalTwin: boolean;
  eFiling: boolean;
  hitlWorkflows: boolean;
}

export interface WhiteLabelConfig {
  id: string;
  partnerId: string;
  partnerName: string;
  mode: WhiteLabelMode;
  tier: WhiteLabelTier;
  brand: BrandConfig;
  features: FeatureToggleConfig;
  allowedJurisdictions: string[];    // e.g., ['IN', 'SG']
  allowedAgentIds?: string[];        // Subset of 1042 agents, undefined = all
  allowedPracticeAreas?: string[];
  slmBindingOverride?: string;       // Force specific SLM
  maxConcurrentUsers: number;
  maxMonthlyApiCalls: number;
  revenueSharePercentage: number;    // 0–100
  customEndpointPrefix: string;      // e.g., '/api/legalai' for partner
  ssoConfig?: {
    provider: 'saml' | 'oidc' | 'oauth2';
    entityId?: string;
    metadataUrl?: string;
    clientId?: string;
  };
  webhookConfig?: {
    url: string;
    secret: string;
    events: string[];
  };
  status: 'active' | 'trial' | 'suspended' | 'terminated';
  trialEndsAt?: Date;
  contractedUntil?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface WhiteLabelUsageStats {
  partnerId: string;
  period: string;                    // 'YYYY-MM'
  totalApiCalls: number;
  totalTokensUsed: number;
  activeUsers: number;
  topFeatures: string[];
  jurisdictionBreakdown: Record<string, number>;
  revenueGenerated: number;
  revenueShare: number;
}

// ──────────────────────────────────────────────────────────────────────────────
// Default feature sets by tier
// ──────────────────────────────────────────────────────────────────────────────

const TIER_FEATURES: Record<WhiteLabelTier, FeatureToggleConfig> = {
  starter: {
    voiceAssistant: false, multilingualSupport: false, documentDrafting: true,
    caseManagement: false, analyticsAndReporting: false, apiAccess: true,
    whatsappIntegration: false, mobileApp: false, avatarAssistant: false,
    quantumEncryption: false, digitalTwin: false, eFiling: false, hitlWorkflows: false,
  },
  professional: {
    voiceAssistant: true, multilingualSupport: true, documentDrafting: true,
    caseManagement: true, analyticsAndReporting: true, apiAccess: true,
    whatsappIntegration: true, mobileApp: true, avatarAssistant: false,
    quantumEncryption: false, digitalTwin: false, eFiling: true, hitlWorkflows: true,
  },
  enterprise: {
    voiceAssistant: true, multilingualSupport: true, documentDrafting: true,
    caseManagement: true, analyticsAndReporting: true, apiAccess: true,
    whatsappIntegration: true, mobileApp: true, avatarAssistant: true,
    quantumEncryption: true, digitalTwin: true, eFiling: true, hitlWorkflows: true,
  },
  sovereign: {
    voiceAssistant: true, multilingualSupport: true, documentDrafting: true,
    caseManagement: true, analyticsAndReporting: true, apiAccess: true,
    whatsappIntegration: true, mobileApp: true, avatarAssistant: true,
    quantumEncryption: true, digitalTwin: true, eFiling: true, hitlWorkflows: true,
  },
};

// ──────────────────────────────────────────────────────────────────────────────
// White-Label Service
// ──────────────────────────────────────────────────────────────────────────────

export class WhiteLabelService {
  private static instance: WhiteLabelService;
  private readonly configs = new Map<string, WhiteLabelConfig>();
  private readonly usageStats = new Map<string, WhiteLabelUsageStats[]>();

  private constructor() {
    logger.info('[WhiteLabel] White-Label Service initialized');
  }

  static getInstance(): WhiteLabelService {
    if (!WhiteLabelService.instance) {
      WhiteLabelService.instance = new WhiteLabelService();
    }
    return WhiteLabelService.instance;
  }

  /**
   * Create a new white-label partner configuration.
   */
  createPartnerConfig(input: Omit<WhiteLabelConfig, 'id' | 'createdAt' | 'updatedAt' | 'features'> & { features?: Partial<FeatureToggleConfig> }): WhiteLabelConfig {
    const id = `wl-${input.tier}-${Date.now()}-${crypto.randomUUID().substring(0, 6)}`;
    const tierFeatures = TIER_FEATURES[input.tier];
    const config: WhiteLabelConfig = {
      ...input,
      id,
      features: { ...tierFeatures, ...(input.features || {}) },
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.configs.set(id, config);
    logger.info('[WhiteLabel] Partner configured', { id, partner: input.partnerName, tier: input.tier });
    return config;
  }

  /**
   * Get partner configuration by ID.
   */
  getConfig(id: string): WhiteLabelConfig | undefined {
    return this.configs.get(id);
  }

  /**
   * Get configuration by custom endpoint prefix.
   */
  getConfigByEndpoint(prefix: string): WhiteLabelConfig | undefined {
    return Array.from(this.configs.values()).find(c => c.customEndpointPrefix === prefix);
  }

  /**
   * Validate if a feature is enabled for a partner.
   */
  isFeatureEnabled(partnerId: string, feature: keyof FeatureToggleConfig): boolean {
    const config = Array.from(this.configs.values()).find(c => c.partnerId === partnerId);
    if (!config) return false;
    if (config.status !== 'active' && config.status !== 'trial') return false;
    return config.features[feature] ?? false;
  }

  /**
   * Validate if a jurisdiction is allowed for a partner.
   */
  isJurisdictionAllowed(partnerId: string, jurisdiction: string): boolean {
    const config = Array.from(this.configs.values()).find(c => c.partnerId === partnerId);
    if (!config) return false;
    return config.allowedJurisdictions.includes(jurisdiction);
  }

  /**
   * Get brand config for a partner (used to render partner-branded UI).
   */
  getBrandConfig(partnerId: string): BrandConfig | null {
    const config = Array.from(this.configs.values()).find(c => c.partnerId === partnerId);
    return config?.brand || null;
  }

  /**
   * Record API usage for revenue tracking.
   */
  recordUsage(partnerId: string, calls: number, tokens: number, jurisdiction: string): void {
    const period = new Date().toISOString().slice(0, 7);
    const key = `${partnerId}:${period}`;
    const existing = this.usageStats.get(partnerId) || [];
    const periodStats = existing.find(s => s.period === period);

    if (periodStats) {
      periodStats.totalApiCalls += calls;
      periodStats.totalTokensUsed += tokens;
      periodStats.jurisdictionBreakdown[jurisdiction] = (periodStats.jurisdictionBreakdown[jurisdiction] || 0) + calls;
    } else {
      const config = Array.from(this.configs.values()).find(c => c.partnerId === partnerId);
      const rate = (config?.revenueSharePercentage || 20) / 100;
      existing.push({
        partnerId, period,
        totalApiCalls: calls, totalTokensUsed: tokens,
        activeUsers: 0, topFeatures: [], jurisdictionBreakdown: { [jurisdiction]: calls },
        revenueGenerated: tokens * 0.001,     // $0.001 per 1k tokens (simplified)
        revenueShare: tokens * 0.001 * rate,
      });
    }
    this.usageStats.set(partnerId, existing);
  }

  /**
   * Get usage statistics for a partner.
   */
  getUsageStats(partnerId: string, period?: string): WhiteLabelUsageStats[] {
    const all = this.usageStats.get(partnerId) || [];
    return period ? all.filter(s => s.period === period) : all;
  }

  /**
   * Suspend a partner (e.g., overdue payment).
   */
  suspendPartner(id: string, reason: string): void {
    const config = this.configs.get(id);
    if (!config) return;
    config.status = 'suspended';
    config.updatedAt = new Date();
    this.configs.set(id, config);
    logger.warn('[WhiteLabel] Partner suspended', { id, partner: config.partnerName, reason });
  }

  /**
   * Get all active partners.
   */
  getAllActiveConfigs(): WhiteLabelConfig[] {
    return Array.from(this.configs.values()).filter(c => c.status === 'active' || c.status === 'trial');
  }

  healthCheck(): { status: 'healthy'; totalPartners: number; activePartners: number } {
    const all = Array.from(this.configs.values());
    return {
      status: 'healthy',
      totalPartners: all.length,
      activePartners: all.filter(c => c.status === 'active').length,
    };
  }
}

export const whiteLabelService = WhiteLabelService.getInstance();
