#!/usr/bin/env bash
# Poll the background caselaw inventory probe.
echo "PC1_ECHO=5150"
echo "PROBE_RUNNING=$(pgrep -f _probe_caselaw.cjs >/dev/null && echo yes || echo no)"
echo "LOG_BYTES=$(wc -c < /tmp/nys_caselaw_inv.log 2>/dev/null || echo MISSING)"
echo "--- full log ---"
cat /tmp/nys_caselaw_inv.log 2>/dev/null || echo NO_LOG
