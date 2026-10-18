/**
 * JRX-PG-GOV-SCHEMA-001 — Postgres governance namespace (Drizzle + runtime SQL)
 *
 * Greenfield Jurexio Enterprise RDS uses `jrx_schema`. Legacy shared jrx-prod RDS
 * used `nv_schema`. Set `JRX_PG_SCHEMA=nv_schema` to keep legacy parity; default
 * is `jrx_schema` for new Option B databases.
 */

import { pgSchema } from 'drizzle-orm/pg-core';

export const LEGACY_GOVERNANCE_PG_SCHEMA = 'nv_schema';
export const DEFAULT_GOVERNANCE_PG_SCHEMA = 'jrx_schema';

export function resolveGovernancePgSchemaName(): string {
  const raw = process.env.JRX_PG_SCHEMA?.trim();
  if (raw) return raw;
  return DEFAULT_GOVERNANCE_PG_SCHEMA;
}

export const governancePgSchema = pgSchema(resolveGovernancePgSchemaName());

/** Back-compat Drizzle handle (name is historical; schema is env-driven). */
export const nvSchema = governancePgSchema;

/** Schemas to probe on read during cutover (primary first). */
export function governancePgSchemasForRead(): string[] {
  const primary = resolveGovernancePgSchemaName();
  if (primary === LEGACY_GOVERNANCE_PG_SCHEMA) {
    return [primary];
  }
  return [primary, LEGACY_GOVERNANCE_PG_SCHEMA];
}
