#!/usr/bin/env -S npx tsx
/**
 * nv-sync-jurisdiction-agents.ts
 *
 * Legacy bulk sync for the pre-v5.1.0 multi-jurisdiction registry layout.
 *
 * DEPRECATED:
 *   Runtime registry loading now flows through
 *   `src/config/agent-registry-loader.ts` and `agent-registry-service.ts`,
 *   which materialize the active v5.1.0 registry (164 agents per primary
 *   jurisdiction) into `legal_agents` with composite IDs.
 *
 * Keep this script only for one-off historical backfills against the old
 * JSON bundle layout. Do not treat it as the canonical runtime loader.
 *
 * STANDARD: This script is the canonical pattern for all idempotent
 * data-sync scripts in the platform. The rules are:
 *
 *   1. NEVER use TRUNCATE / DELETE on tables that may have FK dependents
 *      or downstream history (configs, performance, personas, ROMA levels,
 *      audit logs, etc.).
 *   2. ALWAYS upsert: INSERT … ON CONFLICT (natural_key) DO UPDATE SET …,
 *      OR a SELECT-then-INSERT/UPDATE round-trip when the natural key is
 *      not a unique index.
 *   3. Mark stale rows as soft-deactivated (status='inactive' or
 *      is_active=false) instead of hard-deleting them. Hard deletion is
 *      reserved for explicit GDPR/PII deletion workflows.
 *   4. Wrap the sync in a single transaction (BEGIN…COMMIT) so partial
 *      failures roll back cleanly.
 *   5. Log a final summary: inserted / updated / soft-deactivated / errors.
 *
 * Apply this template to: nv-seed-agents.ts, sdk-data-seed-service.ts,
 * any future *-seed-* or *-sync-* scripts. Search for `TRUNCATE` in the
 * codebase before deploying — every occurrence outside of test fixtures is
 * a bug.
 *
 * Usage:
 *   npx tsx scripts/jrx-sync-jurisdiction-agents.ts            # sync all
 *   npx tsx scripts/jrx-sync-jurisdiction-agents.ts --dry-run  # preview only
 */

import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { normalizePgConnectionString } from '../src/utils/jrx-pg-url.js';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('FATAL: DATABASE_URL not set');
  process.exit(1);
}

const DRY_RUN = process.argv.includes('--dry-run');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REGISTRY_DIR = path.resolve(__dirname, '..', 'config', 'agent-registries');
const REGISTRIES = ['IN', 'UK', 'US', 'GC', 'SG', 'EU', 'Default'] as const;

interface RegistryAgent {
  id: string;
  originalAgentId?: string;
  name: string;
  version?: string;
  tier?: string;
  romaLevel?: string;
  practiceArea?: string;
  practiceAreaId?: number;
  category?: string;
  group?: string;
  module?: string;
  description?: string;
  jurisdiction?: string;
  jurisdictionName?: string;
  jurisdictionScope?: any;
  systemPrompt?: string;
  capabilities?: string[];
  tools?: string[];
  protocols?: string[];
  preferredModels?: string[];
  fallbackModels?: string[];
  supportedLanguages?: string[];
  status?: string;
  [k: string]: any;
}

interface LegalAgentRow {
  agent_id: string;
  name: string;
  version: string;
  tier: string;
  roma_level: string;
  category: string;
  practice_area: string | null;
  description: string | null;
  system_prompt: string;
  jurisdiction: string;            // primary jurisdiction (text column for back-compat)
  jurisdictions: string[];         // text[] column
  capabilities: string[];          // text[] column
  tools: string[];
  protocols: string[];
  preferred_models: string[];
  fallback_models: string[];
  supported_languages: string[];
  metadata: object;                // jsonb — full original payload
  status: 'active' | 'inactive';
}

function trunc(s: string | undefined | null, n: number): string | null {
  if (!s) return null;
  return s.length > n ? s.substring(0, n) : s;
}

const JURISDICTION_NAME_MAP: Record<string, string> = {
  IN: 'Republic of India',
  UK: 'United Kingdom of Great Britain and Northern Ireland',
  US: 'United States of America',
  GC: 'Gulf Cooperation Council (UAE, Saudi Arabia, Qatar, Kuwait, Bahrain, Oman)',
  SG: 'Republic of Singapore',
  EU: 'European Union (27 Member States)',
  DEFAULT: 'Default Multi-Jurisdiction',
};

function mapAgent(a: RegistryAgent, jurisdictionCode: string): LegalAgentRow {
  const id = trunc(a.id, 100)!;
  const tier = (a.tier || 'solo').toLowerCase();
  const jurisdictionFullName = a.jurisdictionName || JURISDICTION_NAME_MAP[jurisdictionCode] || jurisdictionCode;
  const allJurisdictions: string[] = [jurisdictionFullName];
  if (Array.isArray(a.jurisdictionScope?.primary)) allJurisdictions.push(...a.jurisdictionScope.primary);
  if (Array.isArray(a.jurisdictionScope?.secondary)) allJurisdictions.push(...a.jurisdictionScope.secondary);
  const dedupJurisdictions = Array.from(new Set(allJurisdictions.map(String)));

  return {
    agent_id: id,
    name: trunc(a.name, 255) || id,
    version: trunc(a.version || '5.0.0', 50)!,
    tier: trunc(tier, 50)!,
    roma_level: trunc(a.romaLevel || 'L1', 10)!,
    category: trunc(a.category || a.practiceArea || 'general', 100)!,
    practice_area: trunc(a.practiceArea, 100),
    description: a.description || null,
    system_prompt: a.systemPrompt || '',
    jurisdiction: jurisdictionFullName,
    jurisdictions: dedupJurisdictions,
    capabilities: Array.isArray(a.capabilities) ? a.capabilities.map(String) : [],
    tools: Array.isArray(a.tools) ? a.tools.map(String) : [],
    protocols: Array.isArray(a.protocols) ? a.protocols.map(String) : [],
    preferred_models: Array.isArray(a.preferredModels) ? a.preferredModels.map(String) : [],
    fallback_models: Array.isArray(a.fallbackModels) ? a.fallbackModels.map(String) : [],
    supported_languages: Array.isArray(a.supportedLanguages) && a.supportedLanguages.length > 0
      ? a.supportedLanguages.map(String) : ['en'],
    metadata: {
      jurisdictionCode,
      originalAgentId: a.originalAgentId,
      practiceAreaId: a.practiceAreaId,
      group: a.group,
      module: a.module,
      slmBinding: a.slmBinding,
      securityLevel: a.securityLevel,
      digitalTwinCapable: a.digitalTwinCapable,
      voiceEnabled: a.voiceEnabled,
      tierMinimum: a.tierMinimum,
    },
    status: (a.status || 'active').toLowerCase() === 'active' ? 'active' : 'inactive',
  };
}

async function main() {
  const pool = new Pool({ connectionString: normalizePgConnectionString(DATABASE_URL) });
  const allRows: LegalAgentRow[] = [];

  console.log('═══════════════════════════════════════════════════════');
  console.log(`  nv-sync-jurisdiction-agents (UPSERT + soft-deactivate)`);
  console.log(`  Target table: legal_agents (canonical source of truth)`);
  console.log(`  Mode: ${DRY_RUN ? 'DRY-RUN (no writes)' : 'WRITE'}`);
  console.log('═══════════════════════════════════════════════════════');

  for (const j of REGISTRIES) {
    const file = path.join(REGISTRY_DIR, `Nyayavigya-Legal-registry-${j}.json`);
    if (!fs.existsSync(file)) {
      console.warn(`  ⚠ ${j}: file not found, skipping`);
      continue;
    }
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    const agents: RegistryAgent[] = Array.isArray(data.agents)
      ? data.agents
      : Object.values(data.agents || {});
    const code = (j === 'Default') ? 'DEFAULT' : j;
    let mapped = 0;
    for (const a of agents) {
      try { allRows.push(mapAgent(a, code)); mapped++; }
      catch (e: any) { console.warn(`  ⚠ ${code}: skipped ${a.id} — ${e.message}`); }
    }
    console.log(`  ✓ ${code}: ${mapped} agents loaded from registry`);
  }
  console.log(`  Total in-memory rows: ${allRows.length}`);

  // De-duplicate by agent_id (registry IDs are jurisdiction-prefixed and should be unique).
  const seen = new Set<string>();
  const dedup: LegalAgentRow[] = [];
  let dropped = 0;
  for (const r of allRows) {
    if (seen.has(r.agent_id)) { dropped++; continue; }
    seen.add(r.agent_id);
    dedup.push(r);
  }
  if (dropped > 0) console.log(`  ⚠ De-duplicated ${dropped} cross-jurisdiction id collisions`);

  if (DRY_RUN) {
    console.log('');
    console.log('  DRY-RUN: would upsert', dedup.length, 'rows. Exiting.');
    await pool.end();
    return;
  }

  console.log('');
  console.log('═══════════════════════════════════════════════════════');
  console.log('  Reconciling DB (UPSERT + soft-deactivate)');
  console.log('═══════════════════════════════════════════════════════');

  const client = await pool.connect();
  let inserted = 0;
  let updated = 0;
  let deactivated = 0;
  const errors: string[] = [];
  try {
    await client.query('BEGIN');

    const before = await client.query('SELECT COUNT(*)::int AS n FROM legal_agents');
    console.log(`  Before: ${before.rows[0].n} rows in legal_agents`);

    // Track which agent_ids exist in the registry — anything in the DB but
    // not in this set will be soft-deactivated (status='inactive').
    const registryIds = new Set(dedup.map(r => r.agent_id));

    // ─── UPSERT loop ────────────────────────────────────────────────
    // Pattern: SELECT id WHERE agent_id = $1 → UPDATE if found, else INSERT.
    // This is the canonical pattern used by unified-jurisdiction-sync.ts.
    for (const r of dedup) {
      try {
        const existing = await client.query(
          'SELECT id FROM legal_agents WHERE agent_id = $1 LIMIT 1',
          [r.agent_id],
        );
        if (existing.rows.length > 0) {
          await client.query(
            `UPDATE legal_agents SET
               name = $2, version = $3, tier = $4, roma_level = $5,
               category = $6, practice_area = $7, description = $8,
               system_prompt = $9, jurisdiction = $10,
               jurisdictions = $11, capabilities = $12,
               tools = $13, protocols = $14,
               preferred_models = $15, fallback_models = $16,
               supported_languages = $17, status = $18,
               updated_at = NOW()
             WHERE agent_id = $1`,
            [
              r.agent_id, r.name, r.version, r.tier, r.roma_level,
              r.category, r.practice_area, r.description,
              r.system_prompt, r.jurisdiction,
              r.jurisdictions, r.capabilities,
              r.tools, r.protocols,
              r.preferred_models, r.fallback_models,
              r.supported_languages, r.status,
            ],
          );
          updated++;
        } else {
          await client.query(
            `INSERT INTO legal_agents (
               agent_id, name, version, tier, roma_level,
               category, practice_area, description,
               system_prompt, jurisdiction, jurisdictions,
               capabilities, tools, protocols,
               preferred_models, fallback_models, supported_languages,
               status, created_at, updated_at
             ) VALUES (
               $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
               $12, $13, $14, $15, $16, $17, $18, NOW(), NOW()
             )`,
            [
              r.agent_id, r.name, r.version, r.tier, r.roma_level,
              r.category, r.practice_area, r.description,
              r.system_prompt, r.jurisdiction, r.jurisdictions,
              r.capabilities, r.tools, r.protocols,
              r.preferred_models, r.fallback_models, r.supported_languages,
              r.status,
            ],
          );
          inserted++;
        }
      } catch (e: any) {
        errors.push(`${r.agent_id}: ${e.message}`);
      }
    }

    // ─── SOFT-DEACTIVATE stale rows (no hard DELETE) ────────────────
    if (registryIds.size > 0) {
      const dbIdsResult = await client.query('SELECT agent_id FROM legal_agents WHERE status = $1', ['active']);
      const staleIds: string[] = [];
      for (const row of dbIdsResult.rows) {
        if (!registryIds.has(row.agent_id)) staleIds.push(row.agent_id);
      }
      if (staleIds.length > 0) {
        // Use ANY() to deactivate in a single statement.
        const r = await client.query(
          `UPDATE legal_agents SET status = 'inactive', updated_at = NOW()
           WHERE agent_id = ANY($1::text[])`,
          [staleIds],
        );
        deactivated = r.rowCount || 0;
      }
    }

    await client.query('COMMIT');
    console.log(`  ✓ Transaction committed`);
  } catch (e: any) {
    await client.query('ROLLBACK');
    console.error(`  ✗ Transaction rolled back: ${e.message}`);
    throw e;
  } finally {
    client.release();
  }

  console.log('');
  console.log('═══════════════════════════════════════════════════════');
  console.log('  Summary');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`  Inserted:        ${inserted}`);
  console.log(`  Updated:         ${updated}`);
  console.log(`  Soft-deactivated:${deactivated}`);
  console.log(`  Errors:          ${errors.length}`);
  if (errors.length > 0) errors.slice(0, 5).forEach(e => console.log(`    ✗ ${e}`));

  const totalRow = await pool.query("SELECT status, COUNT(*)::int AS n FROM legal_agents GROUP BY status");
  console.log(`  DB after:`);
  for (const r of totalRow.rows) console.log(`    ${r.status}: ${r.n}`);

  await pool.end();
  console.log(`  ✓ Sync complete`);
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
