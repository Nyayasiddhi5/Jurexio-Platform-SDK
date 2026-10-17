#!/usr/bin/env bash
# NV-RDS-SC-ESCR-SHRINK-001 — compare SC/ESCR distinct CNRs between lookup snapshots (read-only).
set -uo pipefail

FROM_VER="${FROM_VER:-v_20260924T134911Z}"
TO_VER="${TO_VER:-v_20260924T163850Z}"
PART="${PART:-SC/ESCR}"

BASE=/home/ubuntu/scripts/case_api
PY="${BASE}/.venv/bin/python3"
TABLE_ROOT="${CASE_API_LOOKUP_TABLE_URI:-${BASE}/_build/case_lookup_full}"
RDS_PY="${BASE}/../data_rds/export_delta_for_rds.py"

echo "=== SC/ESCR SHRINK INVESTIGATE $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
echo "TABLE_ROOT=$TABLE_ROOT FROM=$FROM_VER TO=$TO_VER PART=$PART"

echo "--- shrink guard (export_delta_for_rds.py) ---"
if [ -f "$RDS_PY" ]; then
  grep -nE 'allow.shrink|REFUSING|distinct.*CNR|count_distinct|shrink' "$RDS_PY" | head -30
  echo "--- guard context ---"
  grep -n 'REFUSING' "$RDS_PY" | head -3 | while read -r line; do
    n=${line%%:*}
    sed -n "$((n - 8)),$((n + 25))p" "$RDS_PY"
  done
else
  echo "MISSING $RDS_PY"
fi

echo "--- _CURRENT published ---"
cat "$TABLE_ROOT/_CURRENT" 2>/dev/null || true

for v in "$FROM_VER" "$TO_VER"; do
  d="$TABLE_ROOT/$v"
  if [ -d "$d" ]; then
    echo "ON_DISK $v"
    # common partition layouts
    for p in "$d/$PART" "$d/SC/ESCR" "$d/court_level=SC/court_code=ESCR"; do
      [ -e "$p" ] && echo "  partition_path $p" && ls "$p" 2>/dev/null | head -5
    done
    find "$d" -maxdepth 4 -type d -name 'ESCR' 2>/dev/null | head -5 | sed 's/^/  escr_dir /'
  else
    echo "MISSING $v"
  fi
done

echo "--- duckdb distinct CNR diff ---"
"$PY" <<PY
import glob, json, os, sys
import duckdb

table_root = ${TABLE_ROOT@Q}
from_ver = ${FROM_VER@Q}
to_ver = ${TO_VER@Q}
part_label = ${PART@Q}

def resolve_glob(version: str) -> str:
    base = os.path.join(table_root, version)
    if not os.path.isdir(base):
        raise FileNotFoundError(base)
    # export_delta_for_rds partition key: court_level=SC / cnr_prefix=ESCR
    candidates = [
        os.path.join(base, "court_level=SC", "cnr_prefix=ESCR", "**", "*.parquet"),
        os.path.join(base, part_label, "**", "*.parquet"),
        os.path.join(base, "SC", "ESCR", "**", "*.parquet"),
        os.path.join(base, "court_level=SC", "court_code=ESCR", "**", "*.parquet"),
        os.path.join(base, "**", "ESCR", "**", "*.parquet"),
    ]
    for g in candidates:
        hits = glob.glob(g, recursive=True)
        if hits:
            # use parent dir glob for read_parquet
            if "court_level=" in g:
                return g.replace("/**/*.parquet", "/*.parquet")
            return g
    # fallback: any parquet under version mentioning SC path
    all_p = glob.glob(os.path.join(base, "**", "*.parquet"), recursive=True)
    escr = [p for p in all_p if "/SC/" in p or "court_level=SC" in p or "/ESCR/" in p]
    if not escr:
        raise FileNotFoundError(f"no parquet for {part_label} under {base} (total parquet {len(all_p)})")
    # directory containing escr files
    d = os.path.commonpath(escr)
    if d.endswith(".parquet"):
        d = os.path.dirname(d)
    return os.path.join(d, "**", "*.parquet")

con = duckdb.connect(":memory:")

def cnrs(version: str) -> set:
    g = resolve_glob(version)
    print(f"GLOB_{version}={g} files={len(glob.glob(g, recursive=True))}")
    q = f"""
      SELECT DISTINCT UPPER(TRIM(cnr)) AS cnr
      FROM read_parquet({g!r}, union_by_name=true)
      WHERE cnr IS NOT NULL AND TRIM(CAST(cnr AS VARCHAR)) != ''
    """
    rows = con.execute(q).fetchall()
    return {r[0] for r in rows if r[0]}

try:
    c_from = cnrs(from_ver)
    c_to = cnrs(to_ver)
except Exception as e:
    print("ERROR", type(e).__name__, e)
    sys.exit(2)

print(f"DISTINCT_CNR_{from_ver}={len(c_from)}")
print(f"DISTINCT_CNR_{to_ver}={len(c_to)}")
dropped = sorted(c_from - c_to)
added = sorted(c_to - c_from)
print(f"DROPPED_COUNT={len(dropped)} ADDED_COUNT={len(added)}")
print("DROPPED_CNRS=" + json.dumps(dropped))
if added:
    print("ADDED_CNRS=" + json.dumps(added[:20]) + (" ..." if len(added) > 20 else ""))

# duplicate CNR rows in TO (same cnr, multiple rows)
if dropped:
    g_to = resolve_glob(to_ver)
    for cnr in dropped[:10]:
        n = con.execute(
            f"SELECT count(*) FROM read_parquet({g_to!r}, union_by_name=true) WHERE UPPER(TRIM(cnr)) = ?",
            [cnr],
        ).fetchone()[0]
        print(f"TO_ROW_COUNT cnr={cnr} rows={n}")

# check if dropped CNRs appear elsewhere in TO snapshot (re-partition)
to_base = os.path.join(table_root, to_ver)
to_all_glob = os.path.join(to_base, "**", "*.parquet")
for cnr in dropped[:10]:
    n = con.execute(
        f"""
        SELECT count(*) FROM read_parquet({to_all_glob!r}, union_by_name=true)
        WHERE UPPER(TRIM(cnr)) = ?
        """,
        [cnr],
    ).fetchone()[0]
    if n:
        parts = con.execute(
            f"""
            SELECT court_level, court_code, state, district, count(*) AS n
            FROM read_parquet({to_all_glob!r}, union_by_name=true)
            WHERE UPPER(TRIM(cnr)) = ?
            GROUP BY 1,2,3,4 ORDER BY n DESC LIMIT 3
            """,
            [cnr],
        ).fetchall()
        print(f"TO_ELSEWHERE cnr={cnr} total_rows={n} sample_partitions={parts}")
    else:
        print(f"TO_ABSENT cnr={cnr}")

PY

echo "=== INVESTIGATE DONE ==="
