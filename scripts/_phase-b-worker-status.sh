#!/usr/bin/env bash
# Phase B worker status — runs ON caselaw worker. Never echo secret values.
set -uo pipefail

echo "=== EMBED UNITS ==="
for u in jrx-caselaw-embed-loop@0 jrx-caselaw-embed-loop@1 jrx-caselaw-embed-loop@2 jrx-caselaw-embed-dc jrx-embed-statutes-loop; do
  st=$(systemctl is-active "$u" 2>/dev/null || echo "inactive")
  en=$(systemctl is-enabled "$u" 2>/dev/null || echo "disabled")
  echo "  $u active=$st enabled=$en"
done

echo "=== NYS index.mjs md5 ==="
for p in /opt/nyv/api/index.mjs /opt/nyv/api-server/index.mjs; do
  [ -f "$p" ] && md5sum "$p" && break
done

echo "=== DB COUNTS ==="
source /opt/nyv/api/.env 2>/dev/null || source /opt/nyv/.env 2>/dev/null || true
if [ -n "${DATABASE_URL:-}" ]; then
  echo -n "cnr_case_details: "
  psql "$DATABASE_URL" -tAc "SELECT count(*) FROM cnr_case_details" 2>/dev/null || echo "FAILED"
  echo -n "citation_edges: "
  psql "$DATABASE_URL" -tAc "SELECT count(*) FROM citation_edges" 2>/dev/null || echo "N/A"
  echo -n "nv_legal_graph_edges: "
  psql "$DATABASE_URL" -tAc "SELECT count(*) FROM nv_legal_graph_edges" 2>/dev/null || echo "N/A"
  echo -n "SC body_fts indexed: "
  psql "$DATABASE_URL" -tAc "SELECT count(*) FROM judgments WHERE court_type='sc' AND body_fts IS NOT NULL" 2>/dev/null || echo "FAILED"
  echo -n "SC total: "
  psql "$DATABASE_URL" -tAc "SELECT count(*) FROM judgments WHERE court_type='sc'" 2>/dev/null || echo "FAILED"
  echo -n "judgments_meta_hc_case_details (Athena check via RDS proxy): "
  psql "$DATABASE_URL" -tAc "SELECT 1" >/dev/null 2>&1 && echo "RDS connected" || echo "RDS failed"
else
  echo "DATABASE_URL not set"
fi

echo "=== HEALTH ==="
curl -sS -m 15 -o /dev/null -w "nyayasearch healthz http=%{http_code}\n" https://nyayasearch.jurexio.com/healthz

echo "=== PHASE B WORKER STATUS COMPLETE ==="
