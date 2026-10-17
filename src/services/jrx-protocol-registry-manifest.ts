// JRX-NS-021 (2026-05-05): pre-existing TS errors (gateway runs via tsx).
/**
 * JRX-PROTOCOL-MANIFEST-001 (Task #32 round 7)
 *
 * Standalone module that binds every capability from the SSoT
 * `capabilityManifest` into `nv_schema.protocol_registry` so the protocol
 * registry surface is **manifest-initialized** at boot — the same way
 * `NvToolExecutionService.executeFromManifest` is. After this runs, every
 * catalog capability is callable via one registry contract and external
 * observers can reconstruct the catalog by reading the registry.
 *
 * Extracted from `jrx-orchestration-services.ts` (which has a circular
 * dependency with `jrx-client`) so this code path can be unit-tested
 * without dragging the entire orchestration-services module graph.
 */

import { db as _raw_db } from '../db/index.js';
import { lazyRequire } from '../utils/jrx-type-helpers.js';
const db = lazyRequire(() => _raw_db, 'db');
import { sql } from 'drizzle-orm';
import { capabilityManifest } from '../orchestration/capability-manifest.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('protocol-registry-manifest');

export interface RegisterProtocolFn {
  (params: {
    protocolName: string;
    protocolVersion?: string;
    status?: string;
    config?: unknown;
    activatedBy?: string;
    dependsOn?: string[];
  }): Promise<{ id: string }>;
}

export interface ProtocolRegistryInitResult {
  registered: number;
  skipped: number;
  total: number;
}

/**
 * Idempotent: for each capability in the manifest, ensures a
 * `protocol_registry` row exists with the manifest descriptor as config.
 */
export async function initializeProtocolRegistryFromManifest(
  registerProtocol: RegisterProtocolFn,
): Promise<ProtocolRegistryInitResult> {
  const all = capabilityManifest.list();
  let registered = 0;
  let skipped = 0;
  for (const cap of all) {
    const protocolName = `CAP_${cap.id}`;
    const existing = await db.execute(
      sql`SELECT id FROM nv_schema.protocol_registry WHERE protocol_name = ${protocolName}`,
    );
    if ((existing.rows || []).length > 0) {
      skipped++;
      continue;
    }
    await registerProtocol({
      protocolName,
      protocolVersion: '1.0',
      status: 'active',
      config: {
        capabilityId: cap.id,
        displayName: cap.displayName,
        category: cap.category,
        tiers: cap.tiers,
        supportedJurisdictions: cap.supportedJurisdictions,
        supportedPatterns: cap.supportedPatterns,
        costClass: cap.costClass,
        safetyClass: cap.safetyClass,
        source: cap.source,
        tags: cap.tags,
      },
      dependsOn: [`category:${cap.category}`],
      activatedBy: 'system:manifest',
    });
    registered++;
  }
  logger.info('[ProtocolRegistry] manifest binding complete', {
    total: all.length,
    registered,
    skipped,
  });
  return { registered, skipped, total: all.length };
}
