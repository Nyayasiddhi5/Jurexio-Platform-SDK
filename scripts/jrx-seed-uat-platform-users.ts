#!/usr/bin/env tsx
/**
 * Seed platform UAT users (super_admin + sme) for product-readiness Legal Chat / flags.
 * Uses DATABASE_URL_ADMIN (BYPASSRLS). Idempotent on email.
 */
import { Pool } from 'pg';
import bcrypt from 'bcrypt';
import { normalizePgConnectionString } from '../src/utils/jrx-pg-url.js';

const DEMO_PW = process.env.NV_DEMO_PASSWORD || process.env.NV_UAT_PLATFORM_PASSWORD || '';
const USERS = [
  {
    email: 'admin@jurexio.com',
    password: process.env.NV_UAT_ADMIN_PASSWORD || process.env.UAT_ADMIN_PASSWORD || DEMO_PW || 'Jrx!UAT#Admin@2026#A1',
    full_name: 'Platform Super Admin',
    role: 'super_admin',
    tier: 'enterprise',
  },
  {
    email: 'legalchat-admin-uat@jurexio.com',
    password: process.env.NV_UAT_ADMIN_PASSWORD || process.env.UAT_ADMIN_PASSWORD || DEMO_PW || 'Jrx!UAT#Admin@2026#A1',
    full_name: 'UAT Platform Admin',
    role: 'super_admin',
    tier: 'enterprise',
  },
  {
    email: 'legalchat-sme-a-uat@jurexio.com',
    password: process.env.NV_UAT_SME_PASSWORD || process.env.UAT_SME_PASSWORD || DEMO_PW || 'Jrx!UAT#SmeA@2026#B2',
    full_name: 'UAT SME A',
    role: 'sme',
    tier: 'pro',
  },
  {
    email: 'legalchat-sme-b-uat@jurexio.com',
    password: process.env.NV_UAT_SME_B_PASSWORD || process.env.UAT_SME_B_PASSWORD || DEMO_PW || 'Jrx!UAT#SmeB@2026#C3',
    full_name: 'UAT SME B',
    role: 'sme',
    tier: 'pro',
  },
];

async function main() {
  const url =
    process.env.DATABASE_URL_ADMIN ||
    process.env.JRX_DATABASE_URL_ADMIN ||
    process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL_ADMIN required');

  const pool = new Pool({
    connectionString: normalizePgConnectionString(url),
    ssl: url.includes('localhost') ? false : { rejectUnauthorized: false },
  });

  // Ensure org 1 exists for platform users
  await pool.query(`
    INSERT INTO public.nv_organizations(id, name, slug, tier, is_active, settings)
    VALUES (1, 'Jurexio Platform', 'jurexio-platform', 'enterprise', true, '{"platform":true}'::jsonb)
    ON CONFLICT (id) DO NOTHING
  `).catch(async () => {
    await pool.query(`
      INSERT INTO public.nv_organizations(name, slug, tier, is_active, settings)
      VALUES ('Jurexio Platform', 'jurexio-platform', 'enterprise', true, '{"platform":true}'::jsonb)
      ON CONFLICT (slug) DO NOTHING
    `);
  });

  const org = await pool.query(`SELECT id FROM public.nv_organizations WHERE slug='jurexio-platform' OR id=1 ORDER BY id LIMIT 1`);
  const orgId = org.rows[0]?.id ?? 1;

  for (const u of USERS) {
    const hash = await bcrypt.hash(u.password, 10);
    await pool.query(
      `INSERT INTO public.nv_users(email, password_hash, full_name, role, tier, org_id, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,true)
       ON CONFLICT (email) DO UPDATE SET
         password_hash=EXCLUDED.password_hash,
         role=EXCLUDED.role,
         tier=EXCLUDED.tier,
         full_name=EXCLUDED.full_name,
         org_id=EXCLUDED.org_id,
         is_active=true
       RETURNING id, email, role`,
      [u.email, hash, u.full_name, u.role, u.tier, orgId],
    );
    console.log(`  ✓ ${u.email} [${u.role}/${u.tier}]`);
  }

  // SME allocation for Legal Chat access (best-effort)
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS legal_chat_sme_allocations (
        id SERIAL PRIMARY KEY,
        user_id INTEGER,
        email VARCHAR(255),
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    for (const u of USERS.filter((x) => x.role === 'sme')) {
      const row = await pool.query(`SELECT id FROM public.nv_users WHERE email=$1`, [u.email]);
      const uid = row.rows[0]?.id;
      if (uid) {
        await pool.query(
          `INSERT INTO legal_chat_sme_allocations(user_id, email, is_active)
           SELECT $1::text, $2, true
           WHERE NOT EXISTS (SELECT 1 FROM legal_chat_sme_allocations WHERE email=$2)`,
          [String(uid), u.email],
        );
      }
    }
    console.log('  ✓ SME allocations ensured');
  } catch (e: any) {
    console.log(`  ! SME allocation table: ${e.message?.slice(0, 80)}`);
  }

  await pool.end();
  console.log('UAT platform users seeded.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
