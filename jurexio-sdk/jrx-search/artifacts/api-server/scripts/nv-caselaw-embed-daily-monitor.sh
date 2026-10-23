#!/bin/bash
# Daily caselaw embed coverage snapshot (no secrets in the log).
set -u
OUT_DIR="${OUT_DIR:-/opt/nyv}"
LATEST="${OUT_DIR}/embed-coverage-latest.json"
JSONL="${OUT_DIR}/embed-coverage-daily.jsonl"
ENV_FILE="${ENV_FILE:-/opt/nyv/api/.env}"
URL="${COVERAGE_URL:-http://127.0.0.1:8080/api/caselaw/embedding/coverage}"
TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
KEYFILE="$(mktemp /tmp/nyv-cov-key.XXXXXX)"
chmod 600 "${KEYFILE}"

python3 - "${ENV_FILE}" "${KEYFILE}" <<'PY'
import pathlib, sys
src, dest = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
wanted = (
    "NYS_SDK_API_KEYS", "NYS_KNOWLEDGE_API_KEY", "MCP_TOKEN", "NYV_SDK_KEY",
)
if not src.is_file():
    raise SystemExit(0)
vals = {}
for line in src.read_text(errors="replace").splitlines():
    line = line.strip()
    if line.startswith("export "):
        line = line[7:].strip()
    if not line or line.startswith("#") or "=" not in line:
        continue
    k, _, v = line.partition("=")
    vals[k.strip()] = v.strip().strip("'").strip('"')
for k in wanted:
    v = vals.get(k, "")
    if v:
        dest.write_text(v.split(",", 1)[0].strip())
        break
PY

HDR=()
if [ -s "${KEYFILE}" ]; then
  KEY="$(cat "${KEYFILE}")"
  HDR=(-H "X-API-Key: ${KEY}" -H "Authorization: Bearer ${KEY}")
  unset KEY
fi
rm -f "${KEYFILE}"

# Cold cache can take ~240s for exact COUNT(*); 20s caused daily monitor http=0.
HTTP=$(curl -sS -o /tmp/nyv-embed-cov.json -w "%{http_code}" --max-time 600 "${HDR[@]}" "${URL}" || echo 000)
python3 - "${TS}" "${HTTP}" "${LATEST}" "${JSONL}" <<'PY'
import json, sys, pathlib
ts, http, latest, jsonl = sys.argv[1], sys.argv[2], pathlib.Path(sys.argv[3]), pathlib.Path(sys.argv[4])
body = {}
try:
    body = json.loads(pathlib.Path("/tmp/nyv-embed-cov.json").read_text())
except Exception:
    body = {}
row = {
    "ts": ts,
    "http": int(http) if str(http).isdigit() else 0,
    "coveragePct": body.get("coveragePct"),
    "embedded": body.get("embedded"),
    "total": body.get("total"),
    "unembedded": body.get("unembedded"),
    "slo": (body.get("slo") or {}).get("overallStatus"),
    "scopes": [
        {"scope": s.get("scope"), "totalEmbedded": s.get("totalEmbedded"), "stale": s.get("stale")}
        for s in (body.get("scopes") or [])[:20]
    ],
}
latest.parent.mkdir(parents=True, exist_ok=True)
latest.write_text(json.dumps(row, indent=2) + "\n")
with jsonl.open("a") as f:
    f.write(json.dumps(row) + "\n")
print(json.dumps({"ok": row["http"] == 200, "coveragePct": row["coveragePct"], "slo": row["slo"], "embedded": row["embedded"], "total": row["total"]}))
PY
