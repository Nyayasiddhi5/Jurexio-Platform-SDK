import { db } from '../src/db/index.js';
import { sql } from 'drizzle-orm';
(async () => {
  const a = await db.execute(sql`SELECT COUNT(*)::int AS c FROM nv_schema.nv_audit_logs`);
  console.log('nv_schema.nv_audit_logs:', JSON.stringify((a as any).rows));
  const d = await db.execute(sql`SELECT id, event_type, LEFT(previous_hash,12) AS prev, LEFT(record_hash,12) AS rec, created_at FROM nv_schema.nv_audit_logs ORDER BY created_at DESC LIMIT 5`);
  console.log('latest 5:', JSON.stringify((d as any).rows, null, 2));
  process.exit(0);
})().catch(e => { console.error(e?.message || e); process.exit(1); });
