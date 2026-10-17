import { makePgSql } from './_pg-pool.js';
import bcrypt from 'bcrypt';

const sql = makePgSql();
const EMAIL = 'demouser@nyayavigya.in';
const PASSWORD = 'demouser123';

async function main() {
  const hash = await bcrypt.hash(PASSWORD, 12);
  const rows = await sql`
    INSERT INTO nv_users (email, password_hash, full_name, role, tier, is_active)
    VALUES (${EMAIL}, ${hash}, 'Demo SME User', 'sme', 'enterprise', true)
    ON CONFLICT (email) DO UPDATE
       SET password_hash = EXCLUDED.password_hash,
           full_name = EXCLUDED.full_name,
           role = 'sme', tier = 'enterprise', is_active = true
    RETURNING id, email, role, tier, org_id
  `;
  console.log('user:', rows[0]);
  const uid = rows[0].id;
  const allocs = await sql`
    INSERT INTO nv_sme_allocations (sme_user_id, allocated_by_user_id, scope, is_active, created_at)
    VALUES (${uid}, ${uid}, ${JSON.stringify({jurisdictions:['IN','UK','US','EU','SG','GC']})}::jsonb, true, NOW())
    ON CONFLICT DO NOTHING RETURNING id
  `.catch((e: any) => { console.warn('alloc skip:', e.message); return []; });
  console.log('allocation:', allocs);
}
main().catch(e=>{console.error(e);process.exit(1);}).finally(()=>sql.end());
