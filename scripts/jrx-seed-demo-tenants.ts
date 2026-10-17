#!/usr/bin/env tsx
/**
 * jrx-seed-demo-tenants.ts — 2026-05-09
 *
 * Per directive: "create 2 or 3 org id and use it for testing".
 * Idempotent seed of 3 demo tenants + 9 users (3 roles × 3 orgs) into
 * public.nv_organizations + public.nv_users.
 *
 * Tenants:
 *   1. Demo Law Firm IN  (slug: demo-law-firm-in,  tier: pro)        — for NSP-IN testing
 *   2. Demo Corporate US (slug: demo-corporate-us, tier: enterprise) — for NSI-US testing
 *   3. Demo Citizen IN   (slug: demo-citizen-in,   tier: solo)       — for NYM-IN testing
 *
 * Users per org: admin / lawyer / viewer with bcrypt-hashed `Demo@2026!`.
 *
 * Re-runnable: ON CONFLICT DO NOTHING on (slug) + (email).
 */
import { Pool } from 'pg';
import bcrypt from 'bcrypt';
import { normalizePgConnectionString } from '../src/utils/jrx-pg-url.js';
import { assertColumns } from './_assert-columns.js';

// task #347: schema-drift guard — fail loud before any INSERT.
const REQUIRED_COLUMNS = {
  'public.nv_organizations': ['id', 'name', 'slug', 'tier', 'is_active', 'settings'],
  'public.nv_users': [
    'id', 'email', 'password_hash', 'full_name', 'role', 'tier',
    'org_id', 'is_active',
  ],
} as const;

const PASSWORD = 'Demo@2026!';

const ORGS = [
  { slug: 'demo-law-firm-in',   name: 'Demo Law Firm (IN)',  tier: 'pro' },
  { slug: 'demo-corporate-us',  name: 'Demo Corporate (US)', tier: 'enterprise' },
  { slug: 'demo-citizen-in',    name: 'Demo Citizen (IN)',   tier: 'solo' },
] as const;

const USERS_PER_ORG = [
  { suffix: 'admin',  role: 'admin',  full_name: 'Demo Admin'  },
  { suffix: 'lawyer', role: 'lawyer', full_name: 'Demo Lawyer' },
  { suffix: 'viewer', role: 'viewer', full_name: 'Demo Viewer' },
] as const;

async function main() {
  // Prefer BYPASSRLS admin URL — runtime DATABASE_URL is nv_app with RLS and
  // cannot INSERT users without app.current_org_id (product-readiness 10K).
  const url =
    process.env.DATABASE_URL_ADMIN ||
    process.env.JRX_DATABASE_URL_ADMIN ||
    process.env.JRX_DATABASE_URL ||
    process.env.DATABASE_URL;
  if (!url) { console.error('DATABASE_URL_ADMIN / DATABASE_URL not set'); process.exit(1); }

  const pool = new Pool({ connectionString: normalizePgConnectionString(url), ssl: url.includes('localhost') ? false : { rejectUnauthorized: false } });
  // Best-effort: disable session RLS when connected as a non-bypass role.
  try {
    await pool.query(`SELECT set_config('app.nyv_rls_enforce', 'false', false)`);
    await pool.query(`SELECT set_config('row_security', 'off', false)`);
  } catch { /* admin role may not need this */ }
  await assertColumns(pool, './jrx-seed-demo-tenants', REQUIRED_COLUMNS);
  const hash = await bcrypt.hash(PASSWORD, 10);

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  JRX Demo Tenant Seed — 2026-05-09');
  console.log('═══════════════════════════════════════════════════════════════');

  const result: any = { orgs: [], users: [], skipped: { orgs: 0, users: 0 } };

  for (const org of ORGS) {
    const ins = await pool.query(
      `INSERT INTO public.nv_organizations(name, slug, tier, is_active, settings)
       VALUES ($1,$2,$3,true,'{"demo":true,"created_by":"./jrx-seed-demo-tenants"}'::jsonb)
       ON CONFLICT (slug) DO UPDATE SET name=EXCLUDED.name
       RETURNING id, name, slug, tier`,
      [org.name, org.slug, org.tier]
    );
    const o = ins.rows[0];
    result.orgs.push(o);
    console.log(`  org: ${o.slug.padEnd(22)} id=${o.id} tier=${o.tier}`);

    for (const u of USERS_PER_ORG) {
      const email = `${u.suffix}@${org.slug}.demo.jurexio.test`;
      const ui = await pool.query(
        `INSERT INTO public.nv_users(email, password_hash, full_name, role, tier, org_id, is_active)
         VALUES ($1,$2,$3,$4,$5,$6,true)
         ON CONFLICT (email) DO UPDATE SET org_id=EXCLUDED.org_id, password_hash=EXCLUDED.password_hash, role=EXCLUDED.role
         RETURNING id, email, role, org_id`,
        [email, hash, u.full_name, u.role, org.tier, o.id]
      );
      result.users.push(ui.rows[0]);
      console.log(`    user: ${u.role.padEnd(7)} ${email}`);
    }
  }

  console.log('───────────────────────────────────────────────────────────────');
  console.log(`  ✓ orgs: ${result.orgs.length} | users: ${result.users.length}`);
  console.log(`  password (all demo users): ${PASSWORD}`);
  console.log(`  endpoint: POST /api/jrx/auth/login {email, password}`);
  console.log('═══════════════════════════════════════════════════════════════');

  await pool.end();
}

main().catch(e => { console.error('SEED ERROR:', e); process.exit(1); });
