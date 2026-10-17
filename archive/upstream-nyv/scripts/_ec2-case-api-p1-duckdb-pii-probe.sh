#!/usr/bin/env bash
# NV-CASE-API-P1-001 — fast DuckDB PII column probe (schema + sample only).
set -uo pipefail
echo "=== P1 DUCKDB PII PROBE $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="

PY="${CASE_API_PYTHON:-/home/ubuntu/scripts/case_api/.venv/bin/python3}"
LOOKUP="${CASE_API_LOOKUP_DIR:-/home/ubuntu/scripts/case_api/_build/case_lookup_full}"
echo "python=$PY lookup=$LOOKUP"

export CASE_API_LOOKUP_DIR="$LOOKUP"
"$PY" <<'PY'
import glob, json, os, sys
try:
    import duckdb
except ImportError:
    print("DUCKDB_IMPORT skip"); sys.exit(0)

lookup = os.environ.get("CASE_API_LOOKUP_DIR", "/home/ubuntu/scripts/case_api/_build/case_lookup_full")
if not os.path.exists(lookup):
    print("DUCKDB_NO_FILES"); sys.exit(0)

con = duckdb.connect(":memory:")
glob_pat = lookup + "/**/*.parquet"
try:
    con.execute(f"CREATE TABLE lk AS SELECT * FROM read_parquet('{glob_pat}', union_by_name=true) LIMIT 50000")
except Exception as e:
    print("DUCKDB_READ_ERR", str(e)[:160]); sys.exit(0)

cols = [r[0] for r in con.execute("DESCRIBE lk").fetchall()]
print("DUCKDB_COL_COUNT", len(cols))
pii_keys = [c for c in cols if any(x in c.lower() for x in (
    "diary", "address", "phone", "email", "father", "acts", "extra", "parties"
))]
print("DUCKDB_PII_COLS", json.dumps(pii_keys))

for col in ["diary_no", "petitioner_address", "respondent_address", "acts_json", "acts_sections", "extra"]:
    if col in cols:
        n = con.execute(f"""
            SELECT count(*) FROM lk WHERE {col} IS NOT NULL
              AND cast({col} AS VARCHAR) NOT IN ('', 'null', '[]', '{{}}')
        """).fetchone()[0]
        print(f"DUCKDB_SAMPLE_{col}_nonempty", n)

if "extra" in cols:
    rows = con.execute("""
        SELECT extra FROM lk WHERE extra IS NOT NULL
          AND cast(extra AS VARCHAR) NOT IN ('', 'null', '{}', '[]')
        LIMIT 5
    """).fetchall()
    for i, (ex,) in enumerate(rows):
        try:
            obj = json.loads(ex) if isinstance(ex, str) else ex
            if isinstance(obj, dict):
                keys = [k for k in obj.keys() if any(x in k.lower() for x in ("address", "phone", "email", "father", "act", "party"))]
                print(f"DUCKDB_EXTRA_KEYS_{i}", json.dumps(keys[:15]))
        except Exception:
            print(f"DUCKDB_EXTRA_KEYS_{i}", "parse_err")

for date_col in ["decision_date", "filing_date"]:
    if date_col in cols:
        yrs = con.execute(f"""
            SELECT extract(year from try_cast({date_col} AS DATE)) AS y, count(*) AS n
            FROM lk WHERE {date_col} IS NOT NULL
            GROUP BY 1 ORDER BY 1 DESC LIMIT 5
        """).fetchall()
        print(f"DUCKDB_{date_col}_YEARS", yrs)

con.close()
print("=== P1 DUCKDB PROBE DONE ===")
PY
