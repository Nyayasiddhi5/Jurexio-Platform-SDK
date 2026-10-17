#!/bin/sh
# Decompose caselaw hybrid latency on nyv-caselaw-worker.
# Prefix is /api/caselaw/search and it requires auth; the app dir has pg for plans.
set -u
B=http://localhost:8080
Q="anticipatory%20bail%20economic%20offences"
# NYS_SDK_API_KEYS may be a comma/JSON list; take the first plausible token.
K=`grep -E '^NYS_SDK_API_KEYS=' /opt/nyv/api/.env 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'" | tr ',' '\n' | grep -oE '[A-Za-z0-9_.:-]{16,}' | head -1`
echo "key_len=`printf %s "$K" | wc -c`"

echo "=== control: an authed call must NOT be 401 and must be JSON ==="
code=`curl -sS -m 30 -o /tmp/c.json -w '%{http_code}' -H "X-API-Key: $K" "$B/api/caselaw/search?q=bail&limit=2&jurisdiction=IN"`
echo "  http=$code first60=`head -c 60 /tmp/c.json | tr -d '\n'`"
case "$code" in 200) : ;; *) echo "PROBE BROKEN: control not 200"; exit 3 ;; esac

echo ""
echo "=== A. mode=fts (rank+count only) x3 ==="
for i in 1 2 3; do
  curl -sS -m 90 -o /tmp/f.json -w "  fts run$i http=%{http_code} t=%{time_total}s\n" \
    -H "X-API-Key: $K" "$B/api/caselaw/search?q=$Q&limit=3&mode=fts&jurisdiction=IN"
done
python3 -c "import json;d=json.load(open('/tmp/f.json'));print('    method=%s total=%s n=%s'%(d.get('method'),d.get('total'),len(d.get('results') or [])))"

echo ""
echo "=== B. mode=hybrid (+ embed + vector + coverage, all serial) x3 ==="
for i in 1 2 3; do
  curl -sS -m 120 -o /tmp/h.json -w "  hyb run$i http=%{http_code} t=%{time_total}s\n" \
    -H "X-API-Key: $K" "$B/api/caselaw/search?q=$Q&limit=3&mode=hybrid&jurisdiction=IN"
done
python3 -c "
import json;d=json.load(open('/tmp/h.json'))
print('    method=%s total=%s'%(d.get('method'),d.get('total')))
print('    coverage=%s'%d.get('embeddingCoverage'))"

echo ""
echo "=== C. plans via node+pg from the app dir ==="
cat > /opt/nyv/api/_plan.mjs <<'JS'
import pg from 'pg';
const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl:{rejectUnauthorized:false} });
await c.connect();
const q = async (l, s) => { try { const r = await c.query(s);
  console.log(`  ${l}: ` + r.rows.map(x=>Object.values(x).join(' | ')).join('\n     ')); }
  catch(e){ console.log(`  ${l}: ERR ${String(e.message).slice(0,110)}`); } };
await q('est_rows',     "SELECT to_char(reltuples::bigint,'FM999,999,999') FROM pg_class WHERE relname='judgments'");
await q('embedded',     "SELECT to_char(count(*),'FM999,999,999') FROM judgments WHERE embedding IS NOT NULL");
await q('indexes',      "SELECT indexname||'  '||substr(indexdef,position('USING' in indexdef),52) FROM pg_indexes WHERE tablename='judgments' ORDER BY 1");
await q('active_now',   "SELECT count(*)||' active; '||count(*) FILTER (WHERE query ILIKE '%embedding%')||' on embedding' FROM pg_stat_activity WHERE state='active'");
for (const [l,s] of [
  ['PLAN vector KNN (hybrid path)', "EXPLAIN (ANALYZE,BUFFERS) SELECT id FROM judgments WHERE embedding IS NOT NULL ORDER BY embedding <=> (SELECT embedding FROM judgments WHERE embedding IS NOT NULL LIMIT 1) LIMIT 60"],
  ['PLAN capped count (fts path)',  "EXPLAIN (ANALYZE,BUFFERS) SELECT count(*)::int FROM (SELECT 1 FROM judgments WHERE search_tsv @@ websearch_to_tsquery('english','anticipatory bail economic offences') LIMIT 10000) c"],
]) { console.log(`  --- ${l} ---`);
  try { const r = await c.query(s); console.log(r.rows.map(x=>'     '+x['QUERY PLAN']).slice(0,11).join('\n')); }
  catch(e){ console.log('     ERR '+String(e.message).slice(0,140)); } }
await c.end();
JS
cd /opt/nyv/api && node --env-file=/opt/nyv/api/.env _plan.mjs 2>&1 | head -42
rm -f /opt/nyv/api/_plan.mjs
