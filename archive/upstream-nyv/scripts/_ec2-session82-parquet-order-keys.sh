#!/usr/bin/env bash
set -uo pipefail
cd /home/ubuntu/scripts/case_api
./.venv/bin/python3 <<'PY'
import duckdb, json
CNR = "APHC010000832023"
root = "/home/ubuntu/scripts/case_api/_build/case_lookup_full/current"
con = duckdb.connect()
row = con.execute(f"""
  SELECT extra FROM read_parquet('{root}/court_level=HC/*/*.parquet', hive_partitioning=1)
  WHERE cnr = '{CNR}' LIMIT 1
""").fetchone()
extra = row[0]
if isinstance(extra, str):
  extra = json.loads(extra)
md = extra.get("mobile_depth") or {}
for label, arr in [("finalOrder", md.get("finalOrder")), ("interimOrder", md.get("interimOrder"))]:
  if not arr:
    continue
  print(label, "keys", list(arr[0].keys()))
  print(label, "0", json.dumps(arr[0]))
# try display_pdf with cino + caseno from case row
fo = md.get("finalOrder")[0]
caseno = fo.get("caseno")
# registration from case top-level in same parquet row?
row2 = con.execute(f"""
  SELECT cnr, case_type, registration_number, registration_no, filing_number, extra
  FROM read_parquet('{root}/court_level=HC/*/*.parquet', hive_partitioning=1)
  WHERE cnr = '{CNR}' LIMIT 1
""").fetchone()
print("parquet cols", row2[:5] if row2 else None)
PY
echo DONE
