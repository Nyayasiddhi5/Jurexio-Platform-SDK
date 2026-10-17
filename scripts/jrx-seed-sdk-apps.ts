/**
 * Nyayavigya Platform 3.1.2 — Demo SDK Applications Seed
 * NYV-SCRIPT-SEED-SDK-001
 */

import { makePgSql } from './_pg-pool.js';
import { assertColumns } from './_assert-columns.js';
import * as dotenv from 'dotenv';

dotenv.config();
const sql = makePgSql();

// task #347: schema-drift guard — fail loud before any INSERT.
const REQUIRED_COLUMNS = {
  'public.nv_sdk_applications': ['id', 'name', 'app_type', 'jurisdiction', 'tier'],
} as const;

const SDK_APPS = [
  {
    id: 'nvsdkapp-demo-nsp-001',
    name: 'Nyayasiddhi Professional™ Integration',
    app_type: 'nyayasiddhi_professional',
    jurisdiction: 'IN',
    tier: 'pro'
  },
  {
    id: 'nvsdkapp-demo-nm-001',
    name: 'Nyayamitra Citizen App Integration',
    app_type: 'nyayamitra',
    jurisdiction: 'IN',
    tier: 'plus'
  },
  {
    id: 'nvsdkapp-demo-playground-001',
    name: 'SDK Playground (Developer Testing)',
    app_type: 'custom',
    jurisdiction: 'IN',
    tier: 'solo'
  },
  {
    id: 'nvsdkapp-demo-nyi-001',
    name: 'Nyayasiddhi Institutional™ Integration',
    app_type: 'nyayasiddhi_institutional',
    jurisdiction: 'IN',
    tier: 'enterprise'
  },
  {
    id: 'nvsdkapp-demo-academy-001',
    name: 'Nyayasiddhi Academy™ Integration',
    app_type: 'nyayasiddhi_academy',
    jurisdiction: 'IN',
    tier: 'pro'
  }
];

async function seedSdkApps() {
  await assertColumns(sql, './jrx-seed-sdk-apps', REQUIRED_COLUMNS);
  for (const app of SDK_APPS) {
    await sql`
      INSERT INTO nv_sdk_applications (id, name, app_type, jurisdiction, tier)
      VALUES (${app.id}, ${app.name}, ${app.app_type}, ${app.jurisdiction}, ${app.tier})
      ON CONFLICT (id) DO UPDATE
        SET name = EXCLUDED.name,
            app_type = EXCLUDED.app_type
    `;
    console.log(`    ✓ ${app.name} [${app.tier}]`);
  }
  console.log(`  ✓ ${SDK_APPS.length} SDK applications seeded`);
}

seedSdkApps().catch(console.error).finally(() => sql.end());
