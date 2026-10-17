#!/usr/bin/env bash
LOG="${1:-/var/log/nys-ops/cnr-index-sync-20260922T085001Z.log}"
wc -l "$LOG" 2>/dev/null || true
tail -40 "$LOG" 2>/dev/null || echo "missing $LOG"
