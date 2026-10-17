#!/bin/bash
# Caselaw worker: RDS via node pg + local compare JSON. No secret echo.
set -euo pipefail
cd /opt/nyv/api
echo "=== NODE PG COUNTS ==="
node --input-type=module <<'JS'
import fs from 'fs';
const env = Object.fromEntries(fs.readFileSync('/opt/nyv/api/.env','utf8').split(/\n/).filter(l=>l && !l.startsWith('#') && l.includes('=')).map(l=>{const i=l.indexOf('='); return [l.slice(0,i).trim(), l.slice(i+1).trim().replace(/^["']|["']$/g,'')];}));
const url = env.DATABASE_URL || env.NYV_DATABASE_URL;
if (!url) { console.log('NO_DATABASE_URL'); process.exit(0); }
let pg;
try { pg = await import('pg'); } catch {
  try { pg = await import('/opt/nyv/api/node_modules/pg/lib/index.js'); } catch (e) {
    console.log('no_pg_module', String(e).slice(0,80));
    process.exit(0);
  }
}
const { Client } = pg;
const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();
const q = async (sql) => {
  const r = await c.query(sql);
  console.log(JSON.stringify(r.rows).slice(0, 2500));
};
await q('SELECT count(*)::int AS n FROM statutes');
await q(`SELECT code, count(*)::int AS n,
  count(*) FILTER (WHERE COALESCE(mapped_sections::text,'[]') NOT IN ('[]','null'))::int AS mapped_n,
  count(*) FILTER (WHERE embedding IS NOT NULL)::int AS emb_n
  FROM statutes GROUP BY 1 ORDER BY n DESC LIMIT 20`);
await q(`SELECT mapped_code, count(*)::int AS n FROM statutes
  WHERE code IN ('BNSS','BSA','BNS','IPC','CRPC','CrPC') GROUP BY 1 ORDER BY n DESC`);
await q(`SELECT code, section, mapped_code, mapped_sections, left(heading,80) AS heading
  FROM statutes WHERE code='IPC' AND upper(section)='302'`);
await q(`SELECT code, section, mapped_code, mapped_sections, left(heading,80) AS heading
  FROM statutes WHERE code IN ('BNSS','CRPC','CrPC') AND upper(section) IN ('438','482')`);
await q(`SELECT code, section, mapped_code, mapped_sections, left(heading,80) AS heading
  FROM statutes WHERE code='BNSS' AND mapped_code IN ('CrPC','CRPC') AND mapped_sections::text ILIKE '%438%' LIMIT 5`);
await c.end();
JS

echo "=== LOCAL COMPARE JSON ==="
python3 - <<'PY'
from pathlib import Path
import urllib.request, json
vals={}
for line in Path("/opt/nyv/api/.env").read_text(errors="replace").splitlines():
    if not line or line.startswith("#") or "=" not in line: continue
    k,v=line.split("=",1)
    vals[k.strip()]=v.strip().strip('"').strip("'")
key=(vals.get("NYS_SDK_API_KEYS") or "").split(",")[0].strip()
def hit(path, method="GET", body=None):
    req=urllib.request.Request("http://127.0.0.1:8080"+path, data=(body.encode() if body else None), method=method,
        headers={"Accept":"application/json","X-API-Key":key,"Authorization":"Bearer "+key, **({"Content-Type":"application/json"} if body else {})})
    try:
        with urllib.request.urlopen(req, timeout=25) as r:
            d=json.loads(r.read().decode())
            print(method, path, "HTTP", r.status, "keys", list(d)[:12], "found", d.get("found"),
                  "bns", len(d.get("bnsMatches") or []), "matches", len(d.get("matches") or []),
                  "err", str(d.get("error") or "")[:80])
            if d.get("ipc"): print("  ipc mapped", d["ipc"].get("mappedSections"), d["ipc"].get("heading","")[:60])
            if d.get("bnsMatches"): print("  bns0", d["bnsMatches"][0].get("section"), d["bnsMatches"][0].get("heading","")[:60])
            if d.get("matches"): print("  m0", d["matches"][0].get("code"), d["matches"][0].get("section"), d["matches"][0].get("heading","")[:60])
            if d.get("results") is not None: print("  search n", len(d.get("results") or []), "method", d.get("method"), "total", d.get("total"))
            if d.get("steps") is not None: print("  retrieve steps", [s.get("tool") or s.get("intent") for s in (d.get("steps") or [])][:8], "llm", d.get("llmRequired"))
    except Exception as e:
        print(method, path, "FAIL", str(e)[:220])
hit("/api/statutes/compare/ipc-bns?section=302")
hit("/api/statutes/compare/old-new?from=CrPC&section=438")
hit("/api/statutes/compare/old-new?from=CRPC&section=438")
hit("/api/statutes/search?q=IPC+302&limit=3")
hit("/api/statutes/embedding/coverage")
hit("/api/statutes/compare/ipc-bns", "POST", '{"section":"302"}')
hit("/api/retrieve", "POST", '{"query":"What replaced IPC 302?"}')
PY

echo "=== JOURNAL CHAT/BEDROCK ==="
journalctl -u nyv-api --since "24 hours ago" --no-pager 2>/dev/null | grep -Ei 'error|fail|timeout|ValidationException|Throttl|nova|compare|retrieve' | tail -30 || true
