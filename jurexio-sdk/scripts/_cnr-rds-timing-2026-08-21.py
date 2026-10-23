#!/usr/bin/env python3
"""RDS CNR timing probe on worker."""
import subprocess

def run(cmd, timeout=120):
    try:
        return subprocess.check_output(cmd, shell=True, stderr=subprocess.STDOUT, text=True, timeout=timeout)
    except subprocess.CalledProcessError as e:
        return e.output
    except Exception as e:
        return str(e)

script = r"""
set -a && source /opt/nyv/api/.env && set +a
echo "=== BACKGROUND JOBS ==="
pgrep -af 'backfill|ingest|fts|treatment|embed' || echo none
echo "=== PG ACTIVE QUERIES (judgments) ==="
psql "$DATABASE_URL" -c "SELECT pid, state, wait_event_type, left(query,80) q, now()-query_start age FROM pg_stat_activity WHERE query ILIKE '%judgments%' AND state != 'idle' ORDER BY query_start LIMIT 8;" 2>&1 || echo psql fail
echo "=== CNR INDEX ==="
psql "$DATABASE_URL" -c "SELECT indexname, indexdef FROM pg_indexes WHERE tablename='judgments' AND indexdef ILIKE '%cnr%';" 2>&1
echo "=== TIMED EXACT CNR LOOKUP ==="
for c in RJHC010324382023 TSWL000000742024 TSWL010000012024; do
  echo "-- $c --"
  psql "$DATABASE_URL" -c "\\timing on" -c "SELECT id, court_type, left(title,40) FROM judgments WHERE cnr='$c' LIMIT 1;" 2>&1
  psql "$DATABASE_URL" -c "\\timing on" -c "SELECT cnr FROM cnr_case_details WHERE cnr='$c' LIMIT 1;" 2>&1
done
echo "=== GLUE ROW COUNT ==="
aws glue get-table --database-name judgments_meta --name judgments_meta_hc_case_details --region ap-south-1 --query 'Table.Parameters.numRows' --output text 2>&1
"""

print(run(script))
