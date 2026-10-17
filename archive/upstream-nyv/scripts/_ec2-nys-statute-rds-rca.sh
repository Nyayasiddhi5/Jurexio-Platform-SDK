#!/bin/bash
# NYS caselaw-worker RCA: RDS statutes + compare + model-call flags. Never echo secrets.
set -euo pipefail
echo "=== SERVICE ==="
systemctl is-active nyv-api || true
curl -sS -m 8 http://127.0.0.1:8080/api/healthz || true
echo

echo "=== FLAGS (presence) ==="
python3 - <<'PY'
from pathlib import Path
p=Path("/opt/nyv/api/.env")
keys=["AUTH_REQUIRED","AI_PROVIDER","ANTHROPIC_MODEL","BEDROCK_REGION","NYV_MODEL_CALL_URL",
      "NYV_MODEL_CALL_TIMEOUT_MS","CASELAW_BACKEND","NYS_SDK_API_KEYS","NYS_KNOWLEDGE_API_KEY",
      "MCP_TOKEN"]
text=p.read_text(errors="replace") if p.exists() else ""
vals={}
for line in text.splitlines():
    if not line or line.startswith("#") or "=" not in line: continue
    k,v=line.split("=",1)
    vals[k.strip()]=v.strip().strip('"').strip("'")
for k in keys:
    v=vals.get(k,"")
    if not v:
        print(f"{k}=UNSET")
    elif "KEY" in k or "TOKEN" in k or "URL" in k:
        print(f"{k}=SET len={len(v)} prefix={v[:8] if 'URL' in k else v[:4]}")
    else:
        print(f"{k}={v}")
print("env_file_exists", p.exists(), "bytes", p.stat().st_size if p.exists() else 0)
PY

echo "=== RDS STATUTE COUNTS ==="
python3 - <<'PY'
from pathlib import Path
import os, json
vals={}
for line in Path("/opt/nyv/api/.env").read_text(errors="replace").splitlines():
    if not line or line.startswith("#") or "=" not in line: continue
    k,v=line.split("=",1)
    vals[k.strip()]=v.strip().strip('"').strip("'")
url=vals.get("DATABASE_URL") or vals.get("NYV_DATABASE_URL") or ""
if not url:
    print("NO_DATABASE_URL")
    raise SystemExit(0)
os.environ["PGSSLMODE"]="require"
# Use psycopg2 or psql
import subprocess, tempfile
sql='''
SELECT count(*) AS n FROM statutes;
SELECT code, count(*) AS n,
       count(*) FILTER (WHERE mapped_sections IS NOT NULL AND mapped_sections::text NOT IN ('[]','null')) AS mapped_n,
       count(*) FILTER (WHERE embedding IS NOT NULL) AS emb_n
FROM statutes GROUP BY code ORDER BY n DESC LIMIT 20;
SELECT mapped_code, count(*) FROM statutes WHERE code IN ('BNSS','BSA','BNS','IPC','CRPC','CrPC') GROUP BY mapped_code ORDER BY 2 DESC;
SELECT id, code, section, mapped_code, mapped_sections, left(heading,80)
FROM statutes WHERE code='IPC' AND upper(section)='302' LIMIT 3;
SELECT id, code, section, mapped_code, mapped_sections, left(heading,80)
FROM statutes WHERE code IN ('BNSS','CRPC','CrPC') AND (upper(section)='438' OR upper(section)='482') LIMIT 8;
'''
# never print url
env=os.environ.copy()
env["DATABASE_URL"]=url
r=subprocess.run(["psql", url, "-v", "ON_ERROR_STOP=1", "-c", "SELECT 1"], capture_output=True, text=True, env=env, timeout=20)
if r.returncode!=0:
    err=(r.stderr or r.stdout or "")[:200]
    err=" ".join(err.replace(url, "[redacted]").split())
    print("psql_connect_fail", err)
    raise SystemExit(0)
cmds=[
 "SELECT count(*) AS statutes_n FROM statutes",
 "SELECT code, count(*) n, count(*) FILTER (WHERE COALESCE(mapped_sections::text,'[]') NOT IN ('[]','null')) mapped_n, count(*) FILTER (WHERE embedding IS NOT NULL) emb_n FROM statutes GROUP BY 1 ORDER BY n DESC LIMIT 20",
 "SELECT mapped_code, count(*) n FROM statutes WHERE code IN ('BNSS','BSA','BNS','IPC','CRPC','CrPC') GROUP BY 1 ORDER BY n DESC",
 "SELECT code, section, mapped_code, mapped_sections::text, left(heading,70) FROM statutes WHERE code='IPC' AND upper(section)='302'",
 "SELECT code, section, mapped_code, mapped_sections::text, left(heading,70) FROM statutes WHERE code IN ('BNSS','CRPC','CrPC') AND upper(section) IN ('438','482')",
]
for c in cmds:
    print("---", c[:90])
    r=subprocess.run(["psql", url, "-v", "ON_ERROR_STOP=1", "-P", "pager=off", "-c", c], capture_output=True, text=True, env=env, timeout=30)
    out=(r.stdout or "") + (("\n"+r.stderr) if r.returncode else "")
    print(out.replace(url,"[redacted]")[:2500])
PY

echo "=== LOCAL COMPARE WITH MACHINE KEY ==="
python3 - <<'PY'
from pathlib import Path
import urllib.request, json
vals={}
for line in Path("/opt/nyv/api/.env").read_text(errors="replace").splitlines():
    if not line or line.startswith("#") or "=" not in line: continue
    k,v=line.split("=",1)
    vals[k.strip()]=v.strip().strip('"').strip("'")
keys=(vals.get("NYS_SDK_API_KEYS") or vals.get("NYS_KNOWLEDGE_API_KEY") or "").split(",")
key=keys[0].strip() if keys else ""
paths=[
 "/api/statutes/compare/ipc-bns?section=302",
 "/api/statutes/compare/ipc-bns?section=420",
 "/api/statutes/compare/old-new?from=CrPC&section=438",
 "/api/statutes/compare/old-new?from=CRPC&section=438",
 "/api/statutes/compare/old-new?from=IRPC&section=438",
 "/api/statutes/search?q=IPC+302&limit=3",
 "/api/statutes/embedding/coverage",
]
for path in paths:
    req=urllib.request.Request("http://127.0.0.1:8080"+path, headers={"Accept":"application/json","X-API-Key":key,"Authorization":"Bearer "+key})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            body=r.read().decode()[:800]
            d=json.loads(body) if body.startswith("{") or body.startswith("[") else {"raw":body}
            print(path, "HTTP", r.status, "found=", d.get("found"), "n=", len(d.get("bnsMatches") or d.get("matches") or d.get("results") or []), "method=", d.get("method"), "err=", str(d.get("error") or "")[:80])
            if d.get("ipc"):
                print("  ipc mapped", d["ipc"].get("mappedSections"), "heading", str(d["ipc"].get("heading"))[:70])
            if d.get("matches"):
                print("  match0", d["matches"][0].get("code"), d["matches"][0].get("section"), str(d["matches"][0].get("heading"))[:70])
            if d.get("coveragePct") is not None:
                print("  coverage", d.get("coveragePct"), "total", d.get("total"))
    except Exception as e:
        print(path, "FAIL", str(e)[:200])
PY

echo "=== RECENT API ERRORS ==="
journalctl -u nyv-api --since "12 hours ago" --no-pager 2>/dev/null | grep -Ei 'error|fail|timeout|statute|compare|AUTH|embedding|bedrock' | tail -40 || true
