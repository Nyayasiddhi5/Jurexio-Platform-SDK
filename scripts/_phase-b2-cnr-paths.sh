#!/usr/bin/env bash
# List pino-related files on worker for symlink chain fix
set -uo pipefail
ls -la /opt/nyv/api/*.mjs 2>/dev/null | head -20
echo "=== pino-pretty ==="
ls -la /opt/nyv/api/pino-pretty.mjs 2>/dev/null || echo "missing"
grep -o '/Users/vamsit[^'"'"'\"]*' /opt/nyv/api/ingest-cnr-case-details.mjs 2>/dev/null | sort -u | head -20
