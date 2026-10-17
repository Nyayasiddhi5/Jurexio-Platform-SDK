#!/usr/bin/env bash
# NV-MEM-INSERT-DEBUG — pattern-only gateway/DB diagnostics (no secrets).
set -uo pipefail

GW=$(docker ps --format '{{.Names}}' | grep -i gateway | head -1)
echo "gateway_container=${GW:-missing}"

echo "=== DEPLOY ==="
cat /opt/nyayavigya/CURRENT_DEPLOY 2>/dev/null || echo "CURRENT_DEPLOY missing"

echo "=== TRIGGER: mini orchestrate turn (stores memory) ==="
CANON="/opt/Nyayavigya/secrets/.env.production"
KEY=$(grep -E '^NYV_SDK_KEY_NSP=' "$CANON" | head -1 | cut -d= -f2- | tr -d "\"'" | tr -d '\r\n')
SECRET="DEBUG-MEM-$(date +%s)"
curl -sS -m 90 -o /tmp/mem-debug-a.json -X POST \
  -H "X-API-Key: $KEY" -H "X-NYV-Platform: nsp" -H "X-NYV-Consent: granted" \
  -H "X-NYV-User-Id: 88421" -H "X-Customer-Session-Id: mem-debug-${SECRET}" \
  -H "Content-Type: application/json" \
  -d "{\"prompt\":\"Remember codeword ${SECRET}\",\"taskType\":\"legal-chat-fast\",\"jurisdiction\":\"IN\",\"enableMemory\":true}" \
  "https://api.nyayasiddhi.online/api/jrx/orchestrate" >/dev/null || true
grep -q '"success":true' /tmp/mem-debug-a.json && echo "turn_a=success" || echo "turn_a=fail"

if [[ -n "${GW:-}" ]]; then
  echo "=== GATEWAY Nv5TierMemoryService / saveMatterMemory errors (last 20) ==="
  docker logs "$GW" 2>&1 | grep -iE 'Nv5TierMemoryService|saveMatterMemory|Durable memory write|content_enc|pgp_sym|FieldEnc|refused-invalid' | tail -20 || echo "(no matches)"

  echo "=== DB schema via gateway node (content_enc column) ==="
  docker exec "$GW" node -e "
const { Client } = require('pg');
const url = process.env.DATABASE_URL;
if (!url) { console.log('DATABASE_URL missing in container'); process.exit(0); }
(async () => {
  const c = new Client({ connectionString: url });
  await c.connect();
  const cols = await c.query(\"SELECT column_name, data_type FROM information_schema.columns WHERE table_name='nv_matter_memory' ORDER BY ordinal_position\");
  console.log('columns=' + cols.rows.map(r => r.column_name + ':' + r.data_type).join(','));
  const ext = await c.query(\"SELECT extname FROM pg_extension WHERE extname='pgcrypto'\");
  console.log('pgcrypto=' + (ext.rows[0]?.extname || 'missing'));
  const fek = process.env.NYV_FIELD_ENCRYPTION_KEY || process.env.ENCRYPTION_KEY || '';
  console.log('field_key_len=' + fek.length);
  try {
    const rt = await c.query('SELECT pgp_sym_encrypt(\$1, \$2) IS NOT NULL AS ok', ['smoke', fek || 'dev-smoke-key']);
    console.log('pgp_sym_encrypt_smoke=' + rt.rows[0].ok);
  } catch (e) {
    console.log('pgp_sym_encrypt_smoke=fail msg=' + String(e.message).slice(0,160));
  }
  try {
    await c.query('BEGIN');
    const ins = await c.query(
      \"INSERT INTO nv_matter_memory (matter_id, user_id, memory_type, content, importance, metadata) VALUES (\$1, \$2, \$3, \$4, \$5, \$6) RETURNING id\",
      ['probe-matter', 88421, 'interaction', 'probe content', 0.5, '{}']
    );
    const id = ins.rows[0].id;
    await c.query('UPDATE nv_matter_memory SET content_enc = pgp_sym_encrypt(\$1, \$2) WHERE id = \$3', ['probe content', fek || 'dev-smoke-key', id]);
    await c.query('ROLLBACK');
    console.log('txn_roundtrip=ok');
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    console.log('txn_roundtrip=fail msg=' + String(e.message).slice(0,200));
  }
  try {
    const cnt = await c.query('SELECT count(*)::int AS n FROM nv_matter_memory WHERE user_id=88421');
    console.log('matter_rows_user_88421=' + cnt.rows[0].n);
  } catch (e) {
    console.log('count_fail=' + String(e.message).slice(0,80));
  }
  await c.end();
})().catch(e => { console.log('node_db_err=' + String(e.message).slice(0,160)); process.exit(0); });
" 2>&1 || echo "docker exec node failed"
fi

echo "=== PROBE DONE ==="
