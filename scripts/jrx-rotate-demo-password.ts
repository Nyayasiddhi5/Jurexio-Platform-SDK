#!/usr/bin/env tsx
/**
 * NYV-OPS-PW-ROTATE-001 (2026-05-01)
 *
 * Rotate the demo-account password across all 9 demo accounts in the
 * gateway database (6 @demo.nyayavigya.in + 3 @demo.nyayasiddhi.online,
 * 9th account list set in task-145 / 2026-05-11). Idempotent. Reads new
 * password from NV_NEW_DEMO_PASSWORD (>= 12 chars). Prints success/fail
 * per account.
 *
 * Usage:
 *   NV_NEW_DEMO_PASSWORD='<new-secure-pw>' npx tsx scripts/jrx-rotate-demo-password.ts
 *
 * After running:
 *   1. Update NV_DEMO_PASSWORD in Replit Secrets (Replit dev)
 *   2. Update SSM Parameter Store entry /nyv/dev/demo-password (EC2 dev)
 *   3. Update CI secret NV_DEMO_PASSWORD (GitHub Actions / Bitbucket)
 *   4. Distribute to operators via 1Password / Vaultwarden
 *
 * NEVER commit the new password — this script only consumes it from env.
 */

import { makePgSql } from './_pg-pool.js';
import * as dotenv from 'dotenv';
import bcrypt from 'bcrypt';

dotenv.config();

// task-145 (2026-05-11): added the 3 console-demo @demo.nyayasiddhi.online
// accounts (org_id=1) so the demo team's console login restores along with
// the API/SDK demo accounts. The platform super_admin (admin@nyayavigya.in)
// stays in the list because end-to-end demo flows historically log in as it
// for governance/admin tabs.
const DEMO_EMAILS = [
  'admin@nyayavigya.in',
  'dev@demo.nyayavigya.in',
  'analyst@demo.nyayavigya.in',
  'operator@demo.nyayavigya.in',
  'manager@demo.nyayavigya.in',
  'user@demo.nyayavigya.in',
  'superadmin@demo.nyayasiddhi.online',
  'admin@demo.nyayasiddhi.online',
  'sme@demo.nyayasiddhi.online',
];

async function main() {
  const newPw = process.env.NV_NEW_DEMO_PASSWORD;
  if (!newPw || newPw.length < 12) {
    console.error(
      'NYV-ROTATE-MISSING-PW: NV_NEW_DEMO_PASSWORD env var (>= 12 chars) required.',
    );
    process.exit(1);
  }

  const sql = makePgSql();
  const hash = await bcrypt.hash(newPw, 12);

  console.log(`Rotating ${DEMO_EMAILS.length} demo accounts…`);
  let ok = 0;
  let fail = 0;
  for (const email of DEMO_EMAILS) {
    try {
      const rows = await sql`
        UPDATE nv_users
           SET password_hash = ${hash},
               updated_at    = now()
         WHERE email = ${email}
        RETURNING id, email
      `;
      if (rows.length === 0) {
        console.warn(`  [skip] ${email} — not found`);
        fail += 1;
      } else {
        console.log(`  [ok]   ${email} (id=${rows[0].id})`);
        ok += 1;
      }
    } catch (err) {
      console.error(`  [err]  ${email} — ${(err as Error).message}`);
      fail += 1;
    }
  }
  console.log(`\nDone. ok=${ok} fail=${fail}`);
  if (fail > 0) process.exit(2);
}

main().catch((err) => {
  console.error('NYV-ROTATE-FATAL:', err);
  process.exit(1);
});
