#!/bin/bash
# NYS Knowledge Plane RDS corpus audit — counts only, never prints DSN.
set -euo pipefail
ENVF=/opt/nyv/api/.env
if [[ ! -f "$ENVF" ]]; then
  echo "NO_ENV at $ENVF"
  exit 1
fi
# Extract DATABASE_URL without printing it (do not source .env — $ in passwords breaks)
DATABASE_URL=$(grep -E '^DATABASE_URL=' "$ENVF" | head -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//")
export DATABASE_URL
python3 <<'PY'
import os, json
import psycopg2

url = os.environ["DATABASE_URL"]
conn = psycopg2.connect(url)
cur = conn.cursor()

def q(sql):
    try:
        cur.execute(sql)
        cols = [d[0] for d in cur.description]
        return [dict(zip(cols, r)) for r in cur.fetchall()]
    except Exception as e:
        conn.rollback()
        return [{"error": str(e)[:200]}]

out = {}
out["db"] = q("select current_database() as db, inet_server_addr()::text as host")
out["schemas"] = q(
    "select nspname from pg_namespace where nspname not like 'pg_%' and nspname<>'information_schema' order by 1"
)
out["key_tables"] = q("""
  select table_schema, table_name
  from information_schema.tables
  where table_name ~* '(caselaw|statute|template|legal_task|checklist|act|amendment|order|document|embed)'
    and table_schema not like 'pg_%'
  order by 1,2
  limit 150
""")

candidates = [
    ("caselaw_documents", "select count(*)::bigint as n from caselaw_documents"),
    ("caselaw_embedded", "select count(*)::bigint as n from caselaw_documents where embedding is not null"),
    ("statute_sections", "select count(*)::bigint as n from statute_sections"),
    ("statutes", "select count(*)::bigint as n from statutes"),
    ("templates", "select count(*)::bigint as n from templates"),
    ("legal_tasks", "select count(*)::bigint as n from legal_tasks"),
    ("legal_templates", "select count(*)::bigint as n from legal_templates"),
    ("checklists", "select count(*)::bigint as n from checklists"),
]
for name, sql in candidates:
    out[name] = q(sql)

# Jurisdiction breakdowns (best-effort)
out["statute_sections_by_jur"] = q(
    "select jurisdiction::text as jurisdiction, count(*)::bigint as n from statute_sections group by 1 order by 2 desc"
)
out["statutes_by_jur"] = q(
    "select jurisdiction::text as jurisdiction, count(*)::bigint as n from statutes group by 1 order by 2 desc"
)
out["templates_by_jur"] = q(
    "select coalesce(jurisdiction::text, jurisdiction_scope::text, 'unknown') as jurisdiction, count(*)::bigint as n from templates group by 1 order by 2 desc"
)
out["legal_tasks_by_scope"] = q(
    "select jurisdiction_scope::text as jurisdiction_scope, count(*)::bigint as n from legal_tasks group by 1 order by 2 desc"
)

# Distinct acts / codes if columns exist
out["distinct_acts_statute_sections"] = q("""
  select jurisdiction::text as jurisdiction, count(distinct coalesce(act_id::text, act_code, act_name, title))::bigint as acts
  from statute_sections group by 1 order by 2 desc
""")
out["columns_statute_sections"] = q("""
  select column_name, data_type from information_schema.columns
  where table_name='statute_sections' order by ordinal_position limit 40
""")
out["columns_templates"] = q("""
  select column_name, data_type from information_schema.columns
  where table_name='templates' order by ordinal_position limit 40
""")
out["columns_legal_tasks"] = q("""
  select column_name, data_type from information_schema.columns
  where table_name='legal_tasks' order by ordinal_position limit 40
""")
out["columns_caselaw"] = q("""
  select column_name, data_type from information_schema.columns
  where table_name='caselaw_documents' order by ordinal_position limit 40
""")

print(json.dumps(out, indent=2, default=str))
cur.close()
conn.close()
PY
