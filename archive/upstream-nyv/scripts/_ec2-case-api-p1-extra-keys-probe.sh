#!/usr/bin/env bash
set -uo pipefail
PY="${CASE_API_PYTHON:-/home/ubuntu/scripts/case_api/.venv/bin/python3}"
LOOKUP="${CASE_API_LOOKUP_DIR:-/home/ubuntu/scripts/case_api/_build/case_lookup_full}"
echo "=== EXTRA KEYS + SC DIARY PROBE ==="
ls -la "$LOOKUP" 2>/dev/null | head -10
echo "---"
"$PY" <<'PY'
import json, os, glob
import duckdb
lookup = "/home/ubuntu/scripts/case_api/_build/case_lookup_full"
files = glob.glob(lookup + "/**/*.parquet", recursive=True)[:5]
print("PARQUET_FILES_SAMPLE", [f.split("/")[-1] for f in files], "total", len(glob.glob(lookup + "/**/*.parquet", recursive=True)))

con = duckdb.connect(":memory:")
con.execute(f"CREATE TABLE lk AS SELECT * FROM read_parquet('{lookup}/**/*.parquet', union_by_name=true)")

# All extra keys from 5000 rows
rows = con.execute("SELECT extra, court_level, cnr, case_number FROM lk WHERE extra IS NOT NULL LIMIT 5000").fetchall()
all_keys = {}
for ex, cl, cnr, cn in rows:
    try:
        obj = ex if isinstance(ex, dict) else json.loads(ex) if isinstance(ex, str) else None
        if isinstance(obj, dict):
            for k, v in obj.items():
                if v and str(v) not in ("", "null", "[]", "{}"):
                    all_keys[k] = all_keys.get(k, 0) + 1
    except Exception:
        pass
print("EXTRA_KEYS_FREQ", json.dumps(dict(sorted(all_keys.items(), key=lambda x: -x[1])[:30])))

# SC rows — diary pattern in case_number?
sc = con.execute("""
  SELECT cnr, case_number, court_level,
    json_extract_string(extra, '$.diary_no') AS ex_diary,
    left(cast(extra AS VARCHAR), 120) AS ex_head
  FROM lk WHERE court_level = 'SC' LIMIT 10
""").fetchall()
print("SC_SAMPLE", sc[:5])

# Acts hydration gap: acts_json empty but extra has acts
gap = con.execute("""
  SELECT count(*) FROM lk
  WHERE (acts_json IS NULL OR cast(acts_json AS VARCHAR) IN ('', '[]', 'null'))
    AND extra IS NOT NULL
    AND (
      json_extract(extra, '$.acts') IS NOT NULL
      OR json_extract(extra, '$.acts_sections') IS NOT NULL
      OR json_extract(extra, '$.acts_json') IS NOT NULL
    )
""").fetchone()[0]
print("ACTS_HYDRATE_CANDIDATES", gap)

# PII in extra nested
for key in ["petitioner_address", "pet_address", "petitioner_phone", "parties"]:
    try:
        n = con.execute(f"""
          SELECT count(*) FROM lk WHERE extra IS NOT NULL
            AND json_extract(extra, '$.{key}') IS NOT NULL
        """).fetchone()[0]
        print(f"EXTRA_{key}_count", n)
    except Exception as e:
        print(f"EXTRA_{key}_err", str(e)[:60])

# Year filter counts for 2026/2025
for y in [2026, 2025]:
    n = con.execute(f"""
      SELECT count(*) FROM lk
      WHERE extract(year from try_cast(coalesce(decision_date, filing_date) AS DATE)) = {y}
    """).fetchone()[0]
    print(f"YEAR_{y}_rows", n)
PY

# nysapi SC diary sample
pid=$(pgrep -f 'uvicorn.*8090' | head -1 || true)
KEY=""
[ -n "$pid" ] && [ -r "/proc/$pid/environ" ] && KEY=$(tr '\0' '\n' < "/proc/$pid/environ" | grep '^CASE_API_API_KEYS=' | head -1 | cut -d= -f2- | cut -d, -f1)
if [ "$(printf %s "$KEY" | wc -c)" -gt 8 ]; then
  tmp=$(mktemp)
  curl -sS -o "$tmp" -H "X-API-Key: $KEY" "http://127.0.0.1:8090/v1/cases?court_type=SC&diary_no=17329%2F2025&page_size=1" 2>/dev/null
  python3 - "$tmp" <<'PY'
import json,sys
d=json.load(open(sys.argv[1]))
c=(d.get("cases") or [{}])[0]
keys=[k for k in c.keys() if any(x in k.lower() for x in ("address","phone","email","father","diary","act","extra","party"))]
print("NYSAPI_DIARY_KEYS", keys)
print("NYSAPI_DIARY_sample", {k:c.get(k) for k in keys[:15]})
PY
  rm -f "$tmp"
fi
echo "=== DONE ==="
