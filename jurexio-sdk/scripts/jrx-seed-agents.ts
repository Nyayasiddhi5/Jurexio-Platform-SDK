/**
 * Jurexio Platform 3.1.2 — Legal Agent Registry Seed
 * JRX-SCRIPT-SEED-AGENTS-001
 *
 * Loads all legal agents from jrx-agents-registry.json into nv_agents table.
 * Agent IDs follow JRX-AGT-{CATEGORY}-{NNN} format.
 * This script is idempotent — safe to run multiple times.
 *
 * NV-AGENT-REGISTRY-MERGE-2026-05-11 (task-135): src/data/jrx-agents-registry.json
 * is the auto-merged flat file produced by scripts/jrx-build-flat-registry.ts
 * from the 7 canonical per-jurisdiction registries under
 * config/agent-registries/Jurexio-Legal-registry-{Default,IN,UK,US,GC,EU,SG}.json.
 * Current merged count is 1,042 agents (148 Default + 6 × 149 jurisdictions),
 * matching the figure in replit.md. The "452" historical comment was stale.
 */

import { makePgSql } from './_pg-pool.js';
import { assertColumns } from './_assert-columns.js';

// task #347: schema-drift guard — fail loud before any INSERT.
const REQUIRED_COLUMNS = {
  'public.nv_agents': [
    'id', 'name', 'category', 'description', 'jurisdiction', 'statutes',
    'capabilities', 'default_model', 'tier_required', 'language_support', 'is_active',
  ],
} as const;
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import * as dotenv from 'dotenv';

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const sql = makePgSql();

async function seedAgents() {
  const registryPath = resolve(__dirname, '../src/data/jrx-agents-registry.json');

  let registry: any;
  try {
    const raw = readFileSync(registryPath, 'utf-8');
    registry = JSON.parse(raw);
  } catch (error) {
    // NV-AGENT-REGISTRY-MERGE-2026-05-11 (task-135): if the merged flat
    // file is missing, log a single clear warning and exit 0 instead of
    // throwing — boot must not regress. Operator rebuilds via
    // `npx tsx scripts/jrx-build-flat-registry.ts` and re-runs seed:agents.
    console.warn(
      '  ⚠ JRX-SEED-SKIP-AGENTS: jrx-agents-registry.json missing or unreadable. ' +
        'Run `npx tsx scripts/jrx-build-flat-registry.ts` to regenerate from the ' +
        'config/agent-registries/Jurexio-Legal-registry-*.json sources, ' +
        'then re-run `npm run seed:agents`. Skipping cleanly so boot can continue.',
    );
    console.warn(`    underlying error: ${error instanceof Error ? error.message : String(error)}`);
    void sql.end();
    process.exit(0);
  }

  const agents = Array.isArray(registry) ? registry : (registry.agents || []);
  console.log(`  Found ${agents.length} agents to seed...`);

  let inserted = 0;
  let updated = 0;

  await assertColumns(sql, './jrx-seed-agents', REQUIRED_COLUMNS);

  for (const agent of agents) {
    const id = agent.id || agent.key || `JRX-AGT-UNKNOWN-${inserted}`;
    const name = agent.name || 'Unnamed Agent';
    const category = agent.category || agent.type || 'general';
    const description = agent.description || agent.desc || '';
    const jurisdiction = agent.jurisdiction || agent.jurisdictions || ['IN'];
    const statutes = agent.statutes || agent.legalReferences || [];
    const capabilities = agent.capabilities || agent.skills || [];
    const defaultModel = agent.default_model || agent.defaultModel || agent.model || 'gpt-4o';
    const tier = agent.tier_required || agent.tierRequired || agent.tier || 'solo';
    const languageSupport = agent.language_support || agent.languages || ['en'];

    const result = await sql`
      INSERT INTO nv_agents (
        id, name, category, description, jurisdiction, statutes,
        capabilities, default_model, tier_required, language_support, is_active
      )
      VALUES (
        ${id}, ${name}, ${category}, ${description},
        ${Array.isArray(jurisdiction) ? jurisdiction : [jurisdiction]},
        ${Array.isArray(statutes) ? statutes : []},
        ${Array.isArray(capabilities) ? capabilities : []},
        ${defaultModel}, ${tier},
        ${Array.isArray(languageSupport) ? languageSupport : ['en']},
        true
      )
      ON CONFLICT (id) DO UPDATE
        SET name = EXCLUDED.name,
            category = EXCLUDED.category,
            description = EXCLUDED.description,
            default_model = EXCLUDED.default_model,
            tier_required = EXCLUDED.tier_required,
            updated_at = NOW()
      RETURNING id
    `;

    if (result.length > 0) {
      inserted++;
      if (inserted % 50 === 0) {
        console.log(`    ... ${inserted}/${agents.length} agents seeded`);
      }
    }
  }

  // NV-AGENT-REGISTRY-MERGE-2026-05-11 (task-135): log the actual seed
  // count + per-source breakdown when the merged-flat metadata is present,
  // so deploy logs reconcile against the canonical 1,042 figure.
  const meta = registry?.metadata;
  if (meta?.sourceCounts) {
    console.log(`    source breakdown: ${JSON.stringify(meta.sourceCounts)}`);
    console.log(`    metadata.totalAgents=${meta.totalAgents}`);
  }
  console.log(`  ✓ ${inserted} agents seeded into nv_agents table (registry total=${agents.length})`);
}

seedAgents().catch(console.error).finally(() => sql.end());
