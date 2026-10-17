#!/usr/bin/env bash
# Install NSP CNR peak/off-peak embed cron on caselaw-worker (SSM). No docker prune.
# Usage: cd nyayavigya-platform-312 && npm run protect:secrets:ec2 && bash scripts/_nys-embed-cnr-cron-install.sh
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
# shellcheck disable=SC1091
source scripts/jrx-source-dev-deploy-env.sh

REMOTE_DIR="/opt/nyv/api/scripts"
SCRIPTS=(
  _phase-b-embed-resume-peak-cnr.sh
  _phase-b-embed-resume-throttled.sh
  _phase-b-embed-resume.sh
  _phase-b-embed-pause.sh
)

install_remote=$(mktemp)
{
  echo "#!/usr/bin/env bash"
  echo "set -euo pipefail"
  echo "mkdir -p ${REMOTE_DIR}"
  for s in "${SCRIPTS[@]}"; do
    echo "cat > ${REMOTE_DIR}/${s} <<'SCRIPT_EOF'"
    cat "${ROOT}/scripts/${s}"
    echo "SCRIPT_EOF"
    echo "chmod +x ${REMOTE_DIR}/${s}"
  done
  cat <<'CRON_BODY'
mkdir -p /etc/cron.d
tee /etc/cron.d/nys-embed-cnr-schedule >/dev/null <<'EOF'
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/sbin:/bin:/usr/sbin:/usr/bin
CRON_TZ=Asia/Kolkata
# PEAK throttle suspended 2026-09-03 GO (24h full-speed backfill). Re-enable:
# 0 10 * * * root /bin/bash -c 'echo "=== PEAK $(date -Is) ===" >> /var/log/nys-embed-cnr-schedule.log; /opt/nyv/api/scripts/_phase-b-embed-resume-peak-cnr.sh >> /var/log/nys-embed-cnr-schedule.log 2>&1'
0 20 * * * root /bin/bash -c 'echo "=== OFFPEAK $(date -Is) ===" >> /var/log/nys-embed-cnr-schedule.log; /opt/nyv/api/scripts/_phase-b-embed-resume.sh >> /var/log/nys-embed-cnr-schedule.log 2>&1'
EOF
chmod 644 /etc/cron.d/nys-embed-cnr-schedule
touch /var/log/nys-embed-cnr-schedule.log
echo "=== CRON INSTALLED ==="
cat /etc/cron.d/nys-embed-cnr-schedule
CRON_BODY
} > "$install_remote"

bash "${ROOT}/scripts/_nys-ssm-run.sh" "$install_remote" "nys-embed-cnr-cron-install-$(date -u +%Y%m%dT%H%M%SZ)"
rm -f "$install_remote"
