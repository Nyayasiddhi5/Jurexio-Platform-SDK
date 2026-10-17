/**
 * Nyayavigya Platform 3.1.2 — Demo Users Seed
 * NYV-SCRIPT-SEED-USERS-001
 * Seeds demo users with various roles (idempotent)
 */

import { makePgSql } from './_pg-pool.js';
import { assertColumns } from './_assert-columns.js';
import * as bcrypt from 'bcrypt';
import * as dotenv from 'dotenv';

dotenv.config();

const sql = makePgSql(process.env.DATABASE_URL_ADMIN || process.env.DATABASE_URL);
// NYV-SECURITY-DOC-CREDS-001: demo password is operator-managed.
// Set NV_DEMO_PASSWORD before running this seed (Replit Secret in dev,
// SSM Parameter Store in EC2). NV-SEED-LOG-AND-SKIP-2026-05-11 (task-135):
// boot must not regress when the secret is absent on first deploy — log a
// single clear warning and exit 0 instead of throwing an unhandled Error
// that pollutes deployment logs every boot/seed cycle. Operators rotate
// the secret + re-run `npm run seed:all` once it lands.
const DEMO_PASSWORD = process.env.NV_DEMO_PASSWORD;
const MIN_DEMO_PW_LEN = process.env.NODE_ENV === 'development' ? 8 : 12;
if (!DEMO_PASSWORD || DEMO_PASSWORD.length < MIN_DEMO_PW_LEN) {
  console.warn(
    `  ⚠ NYV-SEED-SKIP-PW: NV_DEMO_PASSWORD not set (or < ${MIN_DEMO_PW_LEN} chars). ` +
      'Skipping demo-user seed cleanly — set the secret and re-run ' +
      '`npm run seed:all` (or `npx tsx scripts/jrx-seed-users.ts`) to populate nv_users.',
  );
  // Close the pool we just opened so the process exits clean.
  void sql.end();
  process.exit(0);
}

const DEMO_USERS = [
  { email: 'admin@nyayavigya.in',         name: 'SDK Administrator',  role: 'super_admin',    tier: 'enterprise' },
  { email: 'dev@demo.nyayavigya.in',      name: 'Demo Developer',     role: 'developer',      tier: 'pro' },
  { email: 'analyst@demo.nyayavigya.in',  name: 'Demo Analyst',       role: 'analyst',        tier: 'plus' },
  { email: 'operator@demo.nyayavigya.in', name: 'Demo Operator',      role: 'operator',       tier: 'pro' },
  { email: 'manager@demo.nyayavigya.in',  name: 'Demo Manager',       role: 'manager',        tier: 'enterprise' },
  { email: 'user@demo.nyayavigya.in',     name: 'Demo User',          role: 'user',           tier: 'solo' },
];

// task #347: schema-drift guard — fail loud before any INSERT.
const REQUIRED_COLUMNS = {
  'public.nv_users': ['email', 'password_hash', 'full_name', 'role', 'tier', 'org_id', 'is_active'],
} as const;

async function seedUsers() {
  console.log('  Seeding demo users...');
  await assertColumns(sql, './jrx-seed-users', REQUIRED_COLUMNS);
  const hash = await bcrypt.hash(DEMO_PASSWORD!, 12);

  for (const user of DEMO_USERS) {
    await sql`
      INSERT INTO nv_users (email, password_hash, full_name, role, tier, org_id, is_active)
      VALUES (${user.email}, ${hash}, ${user.name}, ${user.role}, ${user.tier}, 1, true)
      ON CONFLICT (email) DO UPDATE
        SET password_hash = EXCLUDED.password_hash,
            role = EXCLUDED.role,
            tier = EXCLUDED.tier,
            full_name = EXCLUDED.full_name,
            org_id = COALESCE(nv_users.org_id, 1),
            is_active = true
    `;
    console.log(`    ✓ ${user.email} [${user.role}/${user.tier}]`);
  }

  console.log(`  ✓ ${DEMO_USERS.length} demo users seeded`);
  // NV-SEC-2026-05-08 (hounddog CRITICAL PASSWORD): never echo the demo
  // password to stdout. Operators read it from the DEMO_PASSWORD env-var
  // (or the sealed secret vault) directly.
  console.log(`  Password for all demo users: <set via DEMO_PASSWORD env-var; not logged>`);
}

seedUsers().catch(console.error).finally(() => sql.end());
