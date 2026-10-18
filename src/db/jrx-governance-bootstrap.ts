/**
 * JRX-BOOTSTRAP-GOV-001 — idempotent governance schema + protocol_registry on empty RDS.
 */

import { sql } from 'drizzle-orm';
import { db as _rawDb } from './index.js';
import { lazyRequire } from '../utils/jrx-type-helpers.js';
import {
  LEGACY_GOVERNANCE_PG_SCHEMA,
  resolveGovernancePgSchemaName,
} from '../../shared/pg-governance-namespace.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('jrx-governance-bootstrap');
const db = lazyRequire(() => _rawDb, 'db');

function ddlForSchema(schema: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(schema)) {
    throw new Error(`[jrx-governance-bootstrap] invalid schema: ${schema}`);
  }
  return `
CREATE SCHEMA IF NOT EXISTS ${schema};
CREATE TABLE IF NOT EXISTS ${schema}.protocol_registry (
  id varchar(36) PRIMARY KEY DEFAULT (gen_random_uuid())::text,
  protocol_name varchar(255) NOT NULL,
  protocol_version varchar(50) NOT NULL DEFAULT '1.0',
  status varchar(50) NOT NULL DEFAULT 'initialized',
  config_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  activated_by varchar(255),
  depends_on jsonb NOT NULL DEFAULT '[]'::jsonb,
  activated_at timestamptz,
  health_status varchar(50) DEFAULT 'unknown',
  last_health_check timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS protocol_registry_protocol_name_key
  ON ${schema}.protocol_registry (protocol_name);
CREATE INDEX IF NOT EXISTS idx_protocol_registry_status
  ON ${schema}.protocol_registry (status);
`;
}

/**
 * Ensures `protocol_registry` exists in the active governance schema (and legacy
 * `nv_schema` when the active schema is `jrx_schema`) so manifest bootstrap
 * succeeds on a fresh RDS before drizzle-kit push has been run.
 */
export async function ensureGovernanceBootstrap(): Promise<void> {
  const primary = resolveGovernancePgSchemaName();
  await db.execute(sql.raw(ddlForSchema(primary)));
  if (primary !== LEGACY_GOVERNANCE_PG_SCHEMA) {
    try {
      await db.execute(sql.raw(ddlForSchema(LEGACY_GOVERNANCE_PG_SCHEMA)));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.warn('[jrx-governance-bootstrap] legacy nv_schema DDL skipped', { error: msg });
    }
  }
  logger.info('[jrx-governance-bootstrap] protocol_registry ready', { schema: primary });
}
