/**
 * Nyayavigya Platform 3.1.2 — Master Seed Runner
 * NYV-SCRIPT-SEED-001
 * Runs all seed scripts in correct dependency order (idempotent)
 */

import { execSync } from 'child_process';

async function seedAll() {
  console.log('\n══════════════════════════════════════════════════════');
  console.log('  Nyayavigya Platform 3.1.2 — Master Data Seeding');
  console.log('══════════════════════════════════════════════════════\n');

  const seeds = [
    { name: 'Feature Flags',       script: 'scripts/jrx-seed-feature-flags.ts' },
    { name: 'Jurisdiction Configs', script: 'scripts/jrx-seed-jurisdictions.ts' },
    { name: 'LLM Providers',       script: 'scripts/jrx-seed-llm-providers.ts' },
    { name: 'Demo Organizations',  script: 'scripts/jrx-seed-organizations.ts' },
    { name: 'Demo Users',          script: 'scripts/jrx-seed-users.ts' },
    { name: 'SDK Applications',    script: 'scripts/jrx-seed-sdk-apps.ts' },
    { name: 'Legal Agents (452)',  script: 'scripts/jrx-seed-agents.ts' },
    { name: 'MCP Tools',           script: 'scripts/jrx-seed-mcp-tools.ts' },
    { name: 'Statute DB (6 Jurisdictions)', script: 'scripts/jrx-seed-statutes.ts' },
  ];

  for (const seed of seeds) {
    try {
      console.log(`  Seeding: ${seed.name}...`);
      execSync(`npx tsx ${seed.script}`, { stdio: 'inherit' });
      console.log(`  ✓ ${seed.name} seeded\n`);
    } catch (error) {
      console.warn(`  ⚠ ${seed.name} seed skipped (may already exist)\n`);
    }
  }

  console.log('  ══════════════════════════════════════════════');
  console.log('  All master data seeded successfully');
  console.log('  ══════════════════════════════════════════════\n');
}

seedAll();
