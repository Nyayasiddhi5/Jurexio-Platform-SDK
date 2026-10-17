#!/usr/bin/env bash
set -uo pipefail
HERE=/home/ubuntu/scripts/data_rds
PY=/home/ubuntu/scripts/case_api/.venv/bin/python
echo "=== EXPORT COMPLETE CHECK ==="
"$PY" - <<'PY'
import os, glob
HERE = "/home/ubuntu/scripts/data_rds"
done = len(glob.glob(os.path.join(HERE, "_export/work/done-*.json")))
csv = len(glob.glob(os.path.join(HERE, "_export/cases_csv/**/*.csv.gz"), recursive=True))
print("done_markers", done)
print("csv_gz", csv)
PY
ls -1 "$HERE/_export/work"/pending-* 2>/dev/null | wc -l || echo 0 pending
echo "=== DONE ==="
