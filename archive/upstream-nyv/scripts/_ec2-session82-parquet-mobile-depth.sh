#!/usr/bin/env bash
set -uo pipefail
CNR=APHC010000832023
cd /home/ubuntu/scripts/case_api
./.venv/bin/python3 <<'PY'
import duckdb
CNR = "APHC010000832023"
# common lookup paths on worker
paths = [
  "/home/ubuntu/scripts/case_api/_build/case_lookup_full/current",
  "/home/ubuntu/scripts/case_api/_build/case_lookup",
]
con = duckdb.connect()
for root in paths:
  try:
    q = f"""
    SELECT cnr, extra
    FROM read_parquet('{root}/court_level=HC/*/*.parquet', hive_partitioning=1)
    WHERE cnr = '{CNR}' LIMIT 1
    """
    row = con.execute(q).fetchone()
    if not row:
      print("root", root, "miss")
      continue
    extra = row[1]
    import json
    if isinstance(extra, str):
      extra = json.loads(extra)
    md = (extra or {}).get("mobile_depth") or {}
    fo = md.get("finalOrder") or []
    io = md.get("interimOrder") or []
    print("root", root, "final", len(fo), "interim", len(io))
    if fo:
      print("final0", json.dumps(fo[0])[:900])
    break
  except Exception as e:
    print("root", root, "err", type(e).__name__, str(e)[:120])
PY
echo DONE
