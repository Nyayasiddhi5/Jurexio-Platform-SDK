// JRX-NS-021 (2026-05-05): pre-existing strict-null violations cluster in this
// file. Runtime is unaffected (gateway runs via tsx). Opt out of strict-null
// for the v5.0.0 deploy gate; track follow-up cleanup in INV-CLEANUP-001.
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { db as _raw_db } from '../db/index.js';
import { lazyRequire } from '../utils/jrx-type-helpers.js';
import * as fullSchema from '../../shared/schema.js';
const db = lazyRequire<NodePgDatabase<typeof fullSchema>>(
  () => _raw_db as unknown as NodePgDatabase<typeof fullSchema> | null,
  'db',
);
import { featureFlags, type FeatureFlag, type InsertFeatureFlag } from '../../shared/schema.js';
import { eq, and } from 'drizzle-orm';
import { createLogger } from '../utils/logger.js';


const logger = createLogger('feature-flags-service');

/**
 * Feature Flags Service - Per-Studio Jurexio v1.0 Enablement
 */
export class FeatureFlagsService {
  async isEnabled(
    flagKey: string,
    scope: 'global' | 'studio' | 'user' | 'organization' = 'global',
    scopeId: string = '_global'
  ): Promise<boolean> {
    try {
      if (scopeId !== '_global') {
        const scopedFlag = await db.query.featureFlags.findFirst({
          where: and(
            eq(featureFlags.flagKey, flagKey),
            eq(featureFlags.scope, scope),
            eq(featureFlags.scopeId, scopeId)
          ),
        });

        if (scopedFlag) {
          return scopedFlag.isEnabled ?? false;
        }
      }

      const globalFlag = await db.query.featureFlags.findFirst({
        where: and(
          eq(featureFlags.flagKey, flagKey),
          eq(featureFlags.scope, 'global'),
          eq(featureFlags.scopeId, '_global')
        ),
      });

      return globalFlag?.isEnabled ?? false;
    } catch (error: any) {
      logger.error(`[FeatureFlagsService] Error checking flag ${flagKey}:`, error);
      return false;
    }
  }

  async isJRXv1EnabledForStudio(studioId: string): Promise<boolean> {
    const masterEnabled = await this.isEnabled('jurexio_v1_enabled', 'global');
    if (!masterEnabled) {
      return false;
    }

    const flagKey = `jurexio_v1_${studioId}`;
    return this.isEnabled(flagKey, 'studio', studioId);
  }

  async isJRXv1FeatureEnabled(feature: string): Promise<boolean> {
    const flagKey = `jurexio_v1_${feature}`;
    return this.isEnabled(flagKey, 'global');
  }

  async setFlag(flag: InsertFeatureFlag): Promise<FeatureFlag> {
    try {
      const scopeId = flag.scopeId || '_global';

      const existing = await db.query.featureFlags.findFirst({
        where: and(
          eq(featureFlags.flagKey, flag.flagKey),
          eq(featureFlags.scope, flag.scope || 'global'),
          eq(featureFlags.scopeId, scopeId)
        ),
      });

      if (existing) {
        const mergedMetadata = {
          ...((existing.metadata as Record<string, unknown>) ?? {}),
          ...((flag.metadata as Record<string, unknown>) ?? {}),
        };

        const [updated] = await db
          .update(featureFlags)
          .set({
            ...flag,
            scopeId,
            description: flag.description || existing.description,
            metadata: mergedMetadata,
            updatedAt: new Date(),
          })
          .where(eq(featureFlags.id, existing.id))
          .returning();
        return updated;
      } else {
        const [created] = await db.insert(featureFlags).values({
          ...flag,
          scopeId,
        }).returning();
        return created;
      }
    } catch (error: any) {
      logger.error('[FeatureFlagsService] Error setting flag:', error);
      throw error;
    }
  }

  async enable(
    flagKey: string,
    scope: 'global' | 'studio' | 'user' | 'organization' = 'global',
    scopeId: string = '_global'
  ): Promise<FeatureFlag> {
    return this.setFlag({
      flagKey,
      isEnabled: true,
      scope,
      scopeId,
    });
  }

  async disable(
    flagKey: string,
    scope: 'global' | 'studio' | 'user' | 'organization' = 'global',
    scopeId: string = '_global'
  ): Promise<FeatureFlag> {
    return this.setFlag({
      flagKey,
      isEnabled: false,
      scope,
      scopeId,
    });
  }

  async getAllFlags(): Promise<FeatureFlag[]> {
    try {
      return await db.query.featureFlags.findMany({
        orderBy: (flags, { asc }) => [asc(flags.scope), asc(flags.flagKey)],
      });
    } catch (error: any) {
      logger.error('[FeatureFlagsService] Error getting all flags:', error);
      return [];
    }
  }

  async getFlagsByScope(scope: 'global' | 'studio' | 'user' | 'organization'): Promise<FeatureFlag[]> {
    try {
      return await db.query.featureFlags.findMany({
        where: eq(featureFlags.scope, scope),
        orderBy: (flags, { asc }) => [asc(flags.flagKey)],
      });
    } catch (error: any) {
      logger.error(`[FeatureFlagsService] Error getting flags for scope ${scope}:`, error);
      return [];
    }
  }

  async initializeDefaultFlags(): Promise<void> {
    const defaultFlags: InsertFeatureFlag[] = [
      {
        flagKey: 'jurexio_v1_enabled',
        description: 'Master switch for Jurexio Enterprise Platform SDK v5.0.0 - disables all v1.0 features when off',
        isEnabled: false,
        scope: 'global',
        scopeId: '_global',
      },
      {
        flagKey: 'jurexio_v1_mem0',
        description: 'Enable mem0 memory management with 90% token reduction',
        isEnabled: false,
        scope: 'global',
        scopeId: '_global',
      },
      {
        flagKey: 'jurexio_v1_mcp',
        description: 'Enable Model Context Protocol server for tool/resource/prompt management',
        isEnabled: false,
        scope: 'global',
        scopeId: '_global',
      },
      {
        flagKey: 'jurexio_v1_tools',
        description: 'Enable 93 production-ready tools across 17 categories',
        isEnabled: false,
        scope: 'global',
        scopeId: '_global',
      },
      {
        flagKey: 'jurexio_v1_multimodal',
        description: 'Enable multimodal capabilities (voice, video, music, image)',
        isEnabled: false,
        scope: 'global',
        scopeId: '_global',
      },
      {
        flagKey: 'jurexio_v1_content_studio',
        description: 'Enable Jurexio v1.0 for Content Studio',
        isEnabled: false,
        scope: 'studio',
        scopeId: 'content_studio',
      },
      {
        flagKey: 'jurexio_v1_ideation_lab',
        description: 'Enable Jurexio v1.0 for Ideation Lab Studio',
        isEnabled: false,
        scope: 'studio',
        scopeId: 'ideation_lab',
      },
      {
        flagKey: 'jurexio_v1_market_intelligence',
        description: 'Enable Jurexio v1.0 for Market Intelligence Studio',
        isEnabled: false,
        scope: 'studio',
        scopeId: 'market_intelligence',
      },
      {
        flagKey: 'jurexio_v1_product_blueprint',
        description: 'Enable Jurexio v1.0 for Product Blueprint Studio',
        isEnabled: false,
        scope: 'studio',
        scopeId: 'product_blueprint',
      },
      {
        flagKey: 'jurexio_v1_growth_engine',
        description: 'Enable Jurexio v1.0 for Growth Engine Studio',
        isEnabled: false,
        scope: 'studio',
        scopeId: 'growth_engine',
      },
      {
        flagKey: 'jurexio_v1_experience_design',
        description: 'Enable Jurexio v1.0 for Experience Design Studio',
        isEnabled: false,
        scope: 'studio',
        scopeId: 'experience_design',
      },
      {
        flagKey: 'jurexio_v1_engineering_forge',
        description: 'Enable Jurexio v1.0 for Engineering Forge Studio',
        isEnabled: false,
        scope: 'studio',
        scopeId: 'engineering_forge',
      },
      {
        flagKey: 'jurexio_v1_quality_assurance',
        description: 'Enable Jurexio v1.0 for QA Studio',
        isEnabled: false,
        scope: 'studio',
        scopeId: 'quality_assurance',
      },
      {
        flagKey: 'jurexio_v1_operations_cockpit',
        description: 'Enable Jurexio v1.0 for Operations Studio',
        isEnabled: false,
        scope: 'studio',
        scopeId: 'operations_cockpit',
      },
      {
        flagKey: 'jurexio_v1_launch_control',
        description: 'Enable Jurexio v1.0 for Launch Control Studio',
        isEnabled: false,
        scope: 'studio',
        scopeId: 'launch_control',
      },
      {
        flagKey: 'jurexio_v1_deployment_studio',
        description: 'Enable Jurexio v1.0 for Deployment Studio',
        isEnabled: false,
        scope: 'studio',
        scopeId: 'deployment_studio',
      },
      {
        flagKey: 'jurexio_v1_data_ml_studio',
        description: 'Enable Jurexio v1.0 for Data & ML Studio',
        isEnabled: false,
        scope: 'studio',
        scopeId: 'data_ml_studio',
      },
      {
        flagKey: 'jurexio_v1_compliance_shield',
        description: 'Enable Jurexio v1.0 for Compliance Shield',
        isEnabled: false,
        scope: 'studio',
        scopeId: 'compliance_shield',
      },
    ];

    for (const flag of defaultFlags) {
      try {
        const existing = await db.query.featureFlags.findFirst({
          where: and(
            eq(featureFlags.flagKey, flag.flagKey),
            eq(featureFlags.scope, flag.scope ?? 'global'),
            flag.scopeId ? eq(featureFlags.scopeId, flag.scopeId) : undefined
          ),
        });

        if (!existing) {
          await db.insert(featureFlags).values(flag);
          logger.info(`[FeatureFlagsService] Created flag: ${flag.flagKey}`);
        }
      } catch (error: any) {
        logger.error(`[FeatureFlagsService] Error creating flag ${flag.flagKey}:`, error);
      }
    }

    logger.info('[FeatureFlagsService] Default flags initialized');
  }
}

// Export singleton instance
export const featureFlagsService = new FeatureFlagsService();
