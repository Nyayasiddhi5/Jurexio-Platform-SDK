#!/bin/bash
# NV-PRE-DEPLOY-SMOKE-004 (Session-13) — single-command OFF→ON→OFF orchestrator.
#
# Performs the full pre-deploy gate end-to-end without operator intervention:
#   1. Drop the canonical preflight file with all NYV_F_*=1 exports.
#   2. (Operator step recorded for audit)  Restart the NYV Gateway workflow
#      so it picks up the preflight via the dormant source-include guard in
#      scripts/jrx-start-dev.sh.
#   3. Run the 45-probe dispatcher in flag-ON mode (env-mirrored).
#   4. Delete the preflight file, restart gateway → verify default-OFF.
#   5. Run the 45-probe dispatcher in flag-OFF mode.
#   6. Print a single PRE-DEPLOY VERDICT line based on combined results.
#
# Workflow restarts must be issued by the caller (this script can't reach the
# Replit workflow API directly). For Replit dev: invoke the `restart_workflow`
# tool between steps 1→3 and 4→5. For local CI: pkill the gateway, the wrapper
# auto-restarts. Each orchestration step is logged so a reviewer can audit the
# OFF→ON→OFF cycle from the resulting audit JSON pair + this transcript.
#
# Usage:
#   bash scripts/jrx-pre-deploy-orchestrate.sh
#
# Env:
#   BASE_URL              default http://localhost:5000
#   NYV_SDK_KEY_NSP       required (NV-AUTH-HEADER-001 X-API-Key)
#   NYV_GATEWAY_RESTART   shell command the script invokes between phases.
#                         Defaults to a no-op + 5s pause + health check;
#                         caller may override with e.g. "pkill -f src/index.ts"
#                         or a custom restart hook.

set -uo pipefail

cd "$(dirname "$0")/.."

BASE="${BASE_URL:-http://localhost:5000}"
KEY="${NYV_SDK_KEY_NSP:-}"
RESTART_CMD="${NYV_GATEWAY_RESTART:-sleep 1}"

if [ -z "$KEY" ]; then
  echo "FATAL: NYV_SDK_KEY_NSP missing"; exit 2
fi

PREFLIGHT="scripts/jrx-preflight-flags-on.sh"
LOG="audit/pre-deploy-orchestrate-$(date -u +%Y%m%dT%H%M%SZ).log"
mkdir -p audit

log() { echo "[orch] $*" | tee -a "$LOG"; }

restart_and_wait() {
  log "restart phase → $1"
  eval "$RESTART_CMD" >> "$LOG" 2>&1 || true
  for i in $(seq 1 30); do
    code=$(curl -sS -o /dev/null -w "%{http_code}" "$BASE/health" 2>/dev/null || echo 000)
    if [ "$code" = "200" ]; then
      log "  gateway healthy after ${i}s"
      return 0
    fi
    sleep 1
  done
  log "  WARN: gateway did not return 200 within 30s (code=$code)"
}

cleanup() {
  if [ -f "$PREFLIGHT" ]; then
    log "cleanup: deleting preflight"
    rm -f "$PREFLIGHT"
  fi
}
trap cleanup EXIT

log "=== Phase 1: drop preflight (32 NYV_F_*=1 exports) ==="
cat > "$PREFLIGHT" <<'EOF'
#!/bin/bash
export NYV_F_AI_ORCH_KB=1 NYV_F_AI_ORCH_CONTEXT=1 NYV_F_AI_ORCH_MULTIMODAL_RAG=1 NYV_F_AI_ORCH_PLUGINS=1 NYV_F_AI_ORCH_ROMA=1 NYV_F_AI_ORCH_AGENT_SELECT=1 NYV_F_AI_ORCH_PROTOCOLS=1
export NYV_F_MULTIMODAL_AVATAR_UNITY=1 NYV_F_MULTIMODAL_AVATAR_CHATDOLL=1 NYV_F_MULTIMODAL_RAG_ADV=1 NYV_F_MULTIMODAL_3D_IMMERSIVE=1 NYV_F_MULTIMODAL_AVATAR_3D=1
export NYV_F_VOICE_STREAM_RT=1 NYV_F_VOICE_SYNTH=1 NYV_F_VOICE_ENHANCED=1
export NYV_F_WORKFLOW_AUTONOMOUS=1 NYV_F_WORKFLOW_CONTINUOUS=1 NYV_F_DOC_AI_CONVERT=1
export NYV_F_GOV_MAKER_CHECKER=1 NYV_F_GOV_SECURITY_MON=1 NYV_F_GOV_COST_OPT=1 NYV_F_GOV_CONCURRENCY=1 NYV_F_GOV_ORG_RATELIMIT=1
export NYV_F_LEGAL_PIPELINE_CHUNKER=1 NYV_F_LEGAL_PIPELINE_EMBEDDING=1 NYV_F_LEGAL_PIPELINE_RERANKER=1 NYV_F_LEGAL_PIPELINE_SUMMARIZER=1 NYV_F_LEGAL_PIPELINE_READABILITY=1
export NYV_F_COMPLIANCE_EU_AI_ACT=1 NYV_F_COMPLIANCE_PQC=1 NYV_F_COMPLIANCE_FEDERATED_PRIVACY=1
export NYV_F_INTERNAL_SURFACE=1
EOF
chmod +x "$PREFLIGHT"

log "=== Phase 2: restart gateway (flags ON via dormant source-include) ==="
restart_and_wait "flags ON"

log "=== Phase 3: flag-ON dispatcher ==="
. "$PREFLIGHT"
ON_OUT=$(npx tsx scripts/jrx-smoke-batches-a-j.ts 2>&1)
echo "$ON_OUT" | tee -a "$LOG"
ON_AUDIT=$(echo "$ON_OUT" | grep -oE 'audit/pre-deploy-batches-a-j-[^ ]+\.json' | tail -1)
ON_PASS=$(echo "$ON_OUT" | grep -oE 'Result: [0-9]+ PASS' | head -1 | grep -oE '[0-9]+')
ON_FAIL=$(echo "$ON_OUT" | grep -oE '/ [0-9]+ FAIL' | head -1 | grep -oE '[0-9]+')

log "=== Phase 4: delete preflight + restart (revert to default-OFF) ==="
rm -f "$PREFLIGHT"
restart_and_wait "flags OFF"

log "=== Phase 5: flag-OFF dispatcher ==="
unset $(grep -oE 'NYV_F_[A-Z_]+' "$LOG" | sort -u | tr '\n' ' ') 2>/dev/null || true
OFF_OUT=$(npx tsx scripts/jrx-smoke-batches-a-j.ts 2>&1)
echo "$OFF_OUT" | tee -a "$LOG"
OFF_AUDIT=$(echo "$OFF_OUT" | grep -oE 'audit/pre-deploy-batches-a-j-[^ ]+\.json' | tail -1)
OFF_PASS=$(echo "$OFF_OUT" | grep -oE 'Result: [0-9]+ PASS' | head -1 | grep -oE '[0-9]+')
OFF_FAIL=$(echo "$OFF_OUT" | grep -oE '/ [0-9]+ FAIL' | head -1 | grep -oE '[0-9]+')

log "=== Phase 6: verdict ==="
log "  flag-ON  audit: $ON_AUDIT  ($ON_PASS PASS / $ON_FAIL FAIL)"
log "  flag-OFF audit: $OFF_AUDIT ($OFF_PASS PASS / $OFF_FAIL FAIL)"

echo "" | tee -a "$LOG"
echo "============================================================" | tee -a "$LOG"
echo " SCOPE NOTE: this orchestrator covers ONLY the Batches A-J" | tee -a "$LOG"
echo " wiring gate (the new /api/nv5/* surface). It does NOT run" | tee -a "$LOG"
echo " the legacy /api/jrx/gateway/* real-LLM UAT or the 7-platform" | tee -a "$LOG"
echo " deep-AI smoke. A global pre-deploy GO requires BOTH this" | tee -a "$LOG"
echo " wiring gate AND those legacy gates to be green." | tee -a "$LOG"
echo "============================================================" | tee -a "$LOG"

if [ "${ON_FAIL:-1}" = "0" ] && [ "${OFF_FAIL:-1}" = "0" ]; then
  log "Batch wiring gate: GREEN (Batches A-J only)"
  echo "Batch wiring gate: GREEN (Batches A-J only)"
  echo "Global pre-deploy verdict: PENDING — operator must combine with legacy /api/jrx/* gates (#117 LLM UAT, #118 deep-AI smoke) before issuing a global GO/NO-GO."
  exit 0
else
  log "Batch wiring gate: RED → Global pre-deploy verdict: NO-GO"
  echo "Batch wiring gate: RED"
  echo "Global pre-deploy verdict: NO-GO (Batches A-J wiring failed; legacy /api/jrx/* gates not even evaluated)"
  exit 1
fi
