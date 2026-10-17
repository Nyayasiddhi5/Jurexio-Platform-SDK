#!/usr/bin/env bash
set -uo pipefail
PY="${CASE_API_PYTHON:-/home/ubuntu/scripts/case_api/.venv/bin/python3}"
LOOKUP="${CASE_API_LOOKUP_DIR:-/home/ubuntu/scripts/case_api/_build/case_lookup_full}"
"$PY" <<'PY'
import json, os
import duckdb
lookup = os.environ.get("CASE_API_LOOKUP_DIR", "/home/ubuntu/scripts/case_api/_build/case_lookup_full")
con = duckdb.connect(":memory:")
con.execute(f"CREATE TABLE lk AS SELECT * FROM read_parquet('{lookup}/**/*.parquet', union_by_name=true) LIMIT 50000")
cols = [r[0] for r in con.execute("DESCRIBE lk").fetchall()]
print("ALL_COLS", json.dumps(cols))

if "diary_no" in cols:
    n = con.execute("SELECT count(*) FROM lk WHERE diary_no IS NOT NULL AND cast(diary_no AS VARCHAR) <> ''").fetchone()[0]
    print("DIARY_NO_SAMPLE", n)

# Deep extra key scan
rows = con.execute("""
  SELECT extra FROM lk WHERE extra IS NOT NULL LIMIT 200
""").fetchall()
all_keys = set()
pii_keys = set()
for (ex,) in rows:
    try:
        obj = ex if isinstance(ex, dict) else json.loads(ex) if isinstance(ex, str) else None
        if isinstance(obj, dict):
            for k, v in obj.items():
                all_keys.add(k)
                kl = k.lower()
                if any(x in kl for x in ("address", "phone", "email", "father", "diary", "act", "party", "pet", "res")):
                    if v and str(v) not in ("", "null", "[]", "{}"):
                        pii_keys.add(k)
    except Exception:
        pass
print("EXTRA_KEY_COUNT", len(all_keys))
print("EXTRA_PII_KEYS", json.dumps(sorted(pii_keys)[:40]))

# Sample SC diary from extra or diary_no
for q in [
    "SELECT cnr, court_level, diary_no FROM lk WHERE diary_no IS NOT NULL AND cast(diary_no AS VARCHAR) <> '' LIMIT 3",
    "SELECT cnr, court_level, json_extract_string(extra, '$.diary_no') AS d FROM lk WHERE json_extract_string(extra, '$.diary_no') IS NOT NULL LIMIT 3",
]:
    try:
        print("QUERY", q[:60], con.execute(q).fetchall())
    except Exception as e:
        print("QUERY_ERR", str(e)[:80])
PY
