#!/usr/bin/env bash
# NV-RDS-DAILY-FAIL-001 — bulk reconcile (documented equivalent of rds_daily --full-scan).
# Worker rds_daily.sh has no --full-scan flag; use export_cases_for_rds.py per RDS_GAP_2026-09-12.md.
set -euo pipefail
exec bash "$(dirname "$0")/_ec2-rds-full-reconcile-kickoff.sh"
