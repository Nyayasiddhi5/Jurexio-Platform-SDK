// JRX-NS-021 (2026-05-05): pre-existing strict-null cluster (gateway runs via tsx).
import { db as _raw_db } from '../../db/index.js';
import { lazyRequire } from '../../utils/jrx-type-helpers.js';
const db = lazyRequire(() => _raw_db, 'db');
import { sdkApplications, sdkAppApiKeys, sdkAppAgentAllocations } from '@shared/schema.js';
import { eq } from 'drizzle-orm';
import crypto from 'crypto';
import { SDK_CONFIG, PLATFORM_VERSION } from '../../config/platform-config.js';
import { createLogger } from '../../utils/logger.js';


const logger = createLogger('sdk-seed');

// @ts-expect-error NV-TS230 legacy typing gap (TS2339)
const { jurexio-citizen: NYAYAMITRA_CONFIG, nyayasiddhiLite: NYAYASIDDHI_CONFIG } = SDK_CONFIG.seed;

function hashSecret(secret: string): string {
  return crypto.createHash('sha256').update(secret).digest('hex');
}

const NYAYAMITRA_AGENTS = [
  { agentId: 'consumer-intake-agent', agentName: 'Consumer Legal Intake Agent', practiceArea: 'consumer_protection', priority: 10 },
  { agentId: 'pii-redaction-agent', agentName: 'PII Redaction Agent', practiceArea: 'data_privacy', priority: 9 },
  { agentId: 'jurisdiction-router', agentName: 'Jurisdiction Router Agent', practiceArea: 'general', priority: 8 },
  { agentId: 'document-classifier', agentName: 'Document Classifier Agent', practiceArea: 'general', priority: 7 },
  { agentId: 'legal-faq-agent', agentName: 'Legal FAQ Agent', practiceArea: 'consumer_protection', priority: 6 },
];

const NYAYASIDDHI_LITE_AGENTS = [
  { agentId: 'case-analysis-agent', agentName: 'Case Analysis Agent', practiceArea: 'litigation', priority: 10 },
  { agentId: 'legal-research-agent', agentName: 'Legal Research Agent', practiceArea: 'general', priority: 9 },
  { agentId: 'document-drafting-agent', agentName: 'Document Drafting Agent', practiceArea: 'general', priority: 9 },
  { agentId: 'contract-review-agent', agentName: 'Contract Review Agent', practiceArea: 'corporate', priority: 8 },
  { agentId: 'precedent-search-agent', agentName: 'Precedent Search Agent', practiceArea: 'litigation', priority: 8 },
  { agentId: 'citation-agent', agentName: 'Citation Analysis Agent', practiceArea: 'general', priority: 7 },
  { agentId: 'compliance-check-agent', agentName: 'Compliance Check Agent', practiceArea: 'regulatory', priority: 7 },
  { agentId: 'timeline-agent', agentName: 'Case Timeline Agent', practiceArea: 'litigation', priority: 6 },
];

export async function seedSdkApplications(): Promise<void> {
  try {
    const existing = await db.select({ id: sdkApplications.id })
      .from(sdkApplications)
      .where(eq(sdkApplications.clientId, NYAYAMITRA_CONFIG.clientId))
      .limit(1);

    if (existing.length > 0) {
      logger.info('  SDK seed data already exists, skipping');
      return;
    }

    const jurexio-citizenSecret = `${SDK_CONFIG.credentials.clientSecretPrefix}${crypto.randomBytes(24).toString('hex')}`;
    const [jurexio-citizenApp] = await db.insert(sdkApplications).values({
      organizationId: SDK_CONFIG.seed.defaultOrganizationId,
      appName: NYAYAMITRA_CONFIG.appName,
      appType: NYAYAMITRA_CONFIG.appType,
      description: NYAYAMITRA_CONFIG.description,
      clientId: NYAYAMITRA_CONFIG.clientId,
      clientSecretHash: hashSecret(jurexio-citizenSecret),
      clientSecretPrefix: jurexio-citizenSecret.substring(0, 12),
      allowedAgents: NYAYAMITRA_AGENTS.map(a => a.agentId),
      llmConfig: { provider: SDK_CONFIG.defaults.provider, model: 'auto', maxTokens: NYAYAMITRA_CONFIG.maxTokensPerRequest, temperature: NYAYAMITRA_CONFIG.temperature },
      rateLimitPerMinute: NYAYAMITRA_CONFIG.rateLimitPerMinute,
      dailyTokenBudget: NYAYAMITRA_CONFIG.dailyTokenBudget,
      monthlyTokenBudget: NYAYAMITRA_CONFIG.monthlyTokenBudget,
      allowedOrigins: SDK_CONFIG.defaults.allowedOrigins,
      jurisdiction: NYAYAMITRA_CONFIG.jurisdiction,
      metadata: { platform: NYAYAMITRA_CONFIG.metadataPlatform, version: PLATFORM_VERSION, tier: SDK_CONFIG.seed.metadataTier },
      status: 'active',
    }).returning();

    const nyayasiddhiSecret = `${SDK_CONFIG.credentials.clientSecretPrefix}${crypto.randomBytes(24).toString('hex')}`;
    const [nyayasiddhiApp] = await db.insert(sdkApplications).values({
      organizationId: SDK_CONFIG.seed.defaultOrganizationId,
      appName: NYAYASIDDHI_CONFIG.appName,
      appType: NYAYASIDDHI_CONFIG.appType,
      description: NYAYASIDDHI_CONFIG.description,
      clientId: NYAYASIDDHI_CONFIG.clientId,
      clientSecretHash: hashSecret(nyayasiddhiSecret),
      clientSecretPrefix: nyayasiddhiSecret.substring(0, 12),
      allowedAgents: NYAYASIDDHI_LITE_AGENTS.map(a => a.agentId),
      llmConfig: { provider: SDK_CONFIG.defaults.provider, model: 'auto', maxTokens: SDK_CONFIG.defaults.maxTokensPerRequest, temperature: SDK_CONFIG.defaults.temperature },
      rateLimitPerMinute: NYAYASIDDHI_CONFIG.rateLimitPerMinute,
      dailyTokenBudget: NYAYASIDDHI_CONFIG.dailyTokenBudget,
      monthlyTokenBudget: NYAYASIDDHI_CONFIG.monthlyTokenBudget,
      allowedOrigins: SDK_CONFIG.defaults.allowedOrigins,
      jurisdiction: NYAYASIDDHI_CONFIG.jurisdiction,
      metadata: { platform: NYAYASIDDHI_CONFIG.metadataPlatform, version: PLATFORM_VERSION, tier: SDK_CONFIG.seed.metadataTier },
      status: 'active',
    }).returning();

    const jurexio-citizenKey = `${SDK_CONFIG.credentials.apiKeyPrefix}${crypto.randomBytes(24).toString('hex')}`;
    await db.insert(sdkAppApiKeys).values({
      applicationId: jurexio-citizenApp.id,
      keyHash: hashSecret(jurexio-citizenKey),
      keyPrefix: jurexio-citizenKey.substring(0, 16),
      name: `${NYAYAMITRA_CONFIG.appName} Production Key`,
      scopes: ['agents:read', 'agents:execute', 'documents:read', 'usage:read'],
      isActive: true,
    });

    const nyayasiddhiKey = `${SDK_CONFIG.credentials.apiKeyPrefix}${crypto.randomBytes(24).toString('hex')}`;
    await db.insert(sdkAppApiKeys).values({
      applicationId: nyayasiddhiApp.id,
      keyHash: hashSecret(nyayasiddhiKey),
      keyPrefix: nyayasiddhiKey.substring(0, 16),
      name: `${NYAYASIDDHI_CONFIG.appName} Production Key`,
      scopes: ['agents:read', 'agents:execute', 'documents:read', 'documents:write', 'research:read', 'usage:read'],
      isActive: true,
    });

    for (const agent of NYAYAMITRA_AGENTS) {
      await db.insert(sdkAppAgentAllocations).values({
        applicationId: jurexio-citizenApp.id,
        ...agent,
        dailyTokenLimit: NYAYAMITRA_CONFIG.defaultAgentTokenLimit,
        isActive: true,
      });
    }

    for (const agent of NYAYASIDDHI_LITE_AGENTS) {
      await db.insert(sdkAppAgentAllocations).values({
        applicationId: nyayasiddhiApp.id,
        ...agent,
        dailyTokenLimit: NYAYASIDDHI_CONFIG.defaultAgentTokenLimit,
        isActive: true,
      });
    }

    logger.info(`  Jurexio Citizen registered (ID: ${jurexio-citizenApp.id}, agents: ${NYAYAMITRA_AGENTS.length})`);
    logger.info(`  Jurexio Lite registered (ID: ${nyayasiddhiApp.id}, agents: ${NYAYASIDDHI_LITE_AGENTS.length})`);
    logger.info('  Note: API keys generated but not displayed (use Console API to create new keys)');
  } catch (error: any) {
    if (error?.message?.includes('duplicate key') || error?.message?.includes('already exists')) {
      logger.info('  SDK seed data already exists, skipping');
      return;
    }
    logger.error('  SDK seed failed:', error?.message || error);
  }
}
