import { db } from '../src/db/index.js';
import { sql } from 'drizzle-orm';
import crypto from 'crypto';

(async () => {
  const r = await db.execute(sql`SELECT id, event_type, payload, previous_hash, record_hash, created_at FROM nv_schema.nv_audit_logs ORDER BY created_at ASC LIMIT 2`);
  const rows = (r as any).rows as any[];
  for (const rec of rows) {
    console.log('--- record', rec.id);
    console.log('  event_type type=', typeof rec.event_type, 'val=', JSON.stringify(rec.event_type));
    console.log('  payload type=', typeof rec.payload, 'isObj=', typeof rec.payload === 'object');
    console.log('  payload sample:', JSON.stringify(rec.payload).slice(0, 100));
    console.log('  previous_hash:', rec.previous_hash);
    console.log('  record_hash:  ', rec.record_hash);
    console.log('  created_at type=', typeof rec.created_at, 'val=', rec.created_at instanceof Date ? rec.created_at.toISOString() : rec.created_at);

    const canonicalPayload = (() => {
      try {
        const parsed = typeof rec.payload === 'string' ? JSON.parse(rec.payload) : rec.payload;
        return JSON.stringify(parsed);
      } catch { return typeof rec.payload === 'string' ? rec.payload : JSON.stringify(rec.payload); }
    })();
    const createdAtStr = typeof rec.created_at === 'string' ? rec.created_at : rec.created_at.toISOString();
    const expected = crypto.createHash('sha256')
      .update(`${rec.id}\x00${rec.previous_hash}\x00${rec.event_type}\x00${canonicalPayload}\x00${createdAtStr}`)
      .digest('hex');
    console.log('  canonical payload bytes:', canonicalPayload);
    console.log('  createdAt str used:    ', JSON.stringify(createdAtStr));
    console.log('  expected vs stored: match=', expected === rec.record_hash, '  exp=', expected.slice(0, 16), 'act=', rec.record_hash.slice(0, 16));
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
