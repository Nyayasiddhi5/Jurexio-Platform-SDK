#!/usr/bin/env bash
# Quick redeploy stall-detector + resume after cooldown fix.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
source scripts/jrx-source-dev-deploy-env.sh
install=$(mktemp)
{
  echo "#!/usr/bin/env bash"
  echo "set -euo pipefail"
  echo "cat > /opt/nyv/api/jrx-embed-stall-detector.sh <<'EOF'"
  cat "${ROOT}/scripts/nys-embed-stall-detector.sh"
  echo "EOF"
  echo "chmod +x /opt/nyv/api/jrx-embed-stall-detector.sh"
  echo "cat > /opt/nyv/api/scripts/_phase-b-embed-resume.sh <<'EOF'"
  cat "${ROOT}/scripts/_phase-b-embed-resume.sh"
  echo "EOF"
  echo "chmod +x /opt/nyv/api/scripts/_phase-b-embed-resume.sh"
  echo "bash /opt/nyv/api/scripts/_phase-b-embed-resume.sh"
} > "$install"
bash scripts/_nys-ssm-run.sh "$install" "stall-cooldown-fix"
rm -f "$install"
