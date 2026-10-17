#!/usr/bin/env bash
# GO embed accelerate deploy — stall-detector fix, full-speed resume, peak suspend, coverage API.
# Usage: cd Jurexio-Platform-SDK && npm run protect:secrets:ec2 && bash scripts/_nys-embed-accelerate-deploy.sh
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
# shellcheck disable=SC1091
source scripts/jrx-source-dev-deploy-env.sh

REMOTE_DIR="/opt/nyv/api"
REMOTE_SCRIPTS="${REMOTE_DIR}/scripts"

echo "=== 1/5 Build + S3 deploy index.mjs (localhost coverage auth) ==="
(cd jrx-search/artifacts/api-server && npm run build)
node jrx-search/scripts/upload-deploy.mjs --deploy

echo "=== 2/5 Upload worker scripts via SSM ==="
install_remote=$(mktemp)
{
  echo "#!/usr/bin/env bash"
  echo "set -euo pipefail"
  echo "mkdir -p ${REMOTE_SCRIPTS}"
  for pair in \
    "scripts/_phase-b-embed-resume.sh:${REMOTE_SCRIPTS}/_phase-b-embed-resume.sh" \
    "scripts/_phase-b-embed-resume-peak-cnr.sh:${REMOTE_SCRIPTS}/_phase-b-embed-resume-peak-cnr.sh" \
    "scripts/_phase-b-embed-pause.sh:${REMOTE_SCRIPTS}/_phase-b-embed-pause.sh" \
    "scripts/nys-embed-stall-detector.sh:${REMOTE_DIR}/jrx-embed-stall-detector.sh" \
    "jrx-search/artifacts/api-server/scripts/jrx-caselaw-embed-daily-monitor.sh:${REMOTE_DIR}/jrx-caselaw-embed-daily-monitor.sh"; do
    src="${ROOT}/${pair%%:*}"
    dest="${pair##*:}"
    echo "cat > ${dest} <<'SCRIPT_EOF'"
    cat "$src"
    echo "SCRIPT_EOF"
    echo "chmod +x ${dest}"
  done
  echo "curl -sS -m 10 -o /dev/null -w 'coverage_localhost http=%{http_code}\n' http://127.0.0.1:8080/api/caselaw/embedding/coverage"
} > "$install_remote"

bash "${ROOT}/scripts/_nys-ssm-run.sh" "$install_remote" "nys-embed-accelerate-scripts-$(date -u +%Y%m%dT%H%M%SZ)"
rm -f "$install_remote"

echo "=== 3/5 Reinstall cron (peak suspended) + full-speed resume ==="
bash "${ROOT}/scripts/_nys-embed-cnr-cron-install.sh"
bash "${ROOT}/scripts/_nys-ssm-run.sh" "${ROOT}/scripts/_phase-b-embed-resume.sh" "nys-embed-accelerate-resume-$(date -u +%Y%m%dT%H%M%SZ)"

echo "=== 4/5 Run daily coverage monitor ==="
bash "${ROOT}/scripts/_nys-ssm-run.sh" "${ROOT}/jrx-search/artifacts/api-server/scripts/jrx-caselaw-embed-daily-monitor.sh" "nys-embed-coverage-monitor-$(date -u +%Y%m%dT%H%M%SZ)"

echo "=== 5/5 Throughput baseline ==="
bash "${ROOT}/scripts/_nys-ssm-run.sh" "${ROOT}/scripts/_nys-embed-throughput-baseline.sh" "nys-embed-baseline-$(date -u +%Y%m%dT%H%M%SZ)"

echo "=== DEPLOY COMPLETE — re-run baseline in 30 min for rows/hour ==="
