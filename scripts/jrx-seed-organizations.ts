/**
 * Nyayavigya Platform 3.1.2 — Demo Organizations Seed
 * NYV-SCRIPT-SEED-ORGS-001
 */

import { makePgSql } from './_pg-pool.js';
import { assertColumns } from './_assert-columns.js';
import * as dotenv from 'dotenv';

dotenv.config();
const sql = makePgSql();

// task #347: schema-drift guard — fail loud before any INSERT.
const REQUIRED_COLUMNS = {
  'public.nv_organizations': ['name', 'slug', 'tier', 'is_active'],
} as const;

const DEMO_ORGS = [
  { name: 'Nyayavigya Technologies',          slug: 'nyayavigya-tech',  tier: 'enterprise' },
  { name: 'Demo Law Firm (Pro)',               slug: 'demo-law-firm-pro', tier: 'pro'        },
  { name: 'Demo Legal Department (Plus)',      slug: 'demo-legal-dept',  tier: 'plus'       },
  { name: 'Demo Bar Association (Enterprise)', slug: 'demo-bar-assoc',   tier: 'enterprise' },
];

async function seedOrganizations() {
  await assertColumns(sql, './jrx-seed-organizations', REQUIRED_COLUMNS);
  for (const org of DEMO_ORGS) {
    await sql`
      INSERT INTO nv_organizations (name, slug, tier, is_active)
      VALUES (${org.name}, ${org.slug}, ${org.tier}, true)
      ON CONFLICT (slug) DO UPDATE
        SET name = EXCLUDED.name,
            tier = EXCLUDED.tier,
            is_active = true
    `;
    console.log(`    ✓ ${org.name} [${org.tier}]`);
  }
  console.log(`  ✓ ${DEMO_ORGS.length} organizations seeded`);
}

seedOrganizations().catch(console.error).finally(() => sql.end());
