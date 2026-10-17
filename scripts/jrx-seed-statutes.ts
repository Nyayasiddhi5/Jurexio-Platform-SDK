/**
 * Nyayavigya Platform 3.1.2 — Statute DB Seeder
 * NYV-SCRIPT-SEED-STATUTES
 * Seeds all 6 jurisdiction statute databases. Idempotent — safe to run multiple times.
 */

import { seedStatuteDatabase } from '../src/services/jrx-statute-seeding-service.js';

async function main() {
  console.log('\n══════════════════════════════════════════════════════');
  console.log('  Nyayavigya — Statute DB Seeding (All 6 Jurisdictions)');
  console.log('  IN | UK | US | EU | GCC | SG');
  console.log('══════════════════════════════════════════════════════\n');

  try {
    const result = await seedStatuteDatabase();
    console.log(`  ✓ Statute seeding complete:`);
    console.log(`    Total sections seeded: ${result.seeded}`);
    console.log(`    Jurisdictions:         ${result.jurisdictions.join(', ')}`);
    console.log(`    Status:                ${result.status}`);
    console.log('');
  } catch (err) {
    console.error('  ✗ Statute seeding failed:', err);
  }
  // Force-exit so the parent start script can proceed — the pg Pool keeps the
  // event loop alive otherwise (idle keepalive). Non-fatal either way.
  process.exit(0);
}

main();
