#!/usr/bin/env bash
# Organize EC2 /opt/Nyayavigya + /opt/nyayavigya — archive old deploys, keep v5.0.0 layout.
set -euo pipefail

nv_b64_encode() {
  if printf '' | base64 -w0 >/dev/null 2>&1; then
    printf '%s' "$1" | base64 -w0
  else
    printf '%s' "$1" | base64 | tr -d '\n'
  fi
}

APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
source "$APP_ROOT/scripts/jrx-source-dev-deploy-env.sh"

KEEP_DEPLOYS="${NYV_EC2_KEEP_DEPLOY_DIRS:-3}"
ARCHIVE_MODE="${NYV_EC2_ARCHIVE_MODE:-move}" # move | tar | skip
WAIT_SECS="${NYV_EC2_LAYOUT_WAIT_SECS:-600}"
POLL_SECS=5

SCRIPT=$(mktemp)
cat > "$SCRIPT" <<EOS
set -euo pipefail
KEEP=${KEEP_DEPLOYS}
ARCHIVE_MODE=${ARCHIVE_MODE}
echo "[ec2-layout] Nyayavigya EC2 structure cleanup (keep \${KEEP} repo deploy dirs, archive=\${ARCHIVE_MODE})"
mkdir -p /opt/Nyayavigya/{sdk-dist/v5.0.0,sdk-dist/_archive,archive/deploys,archive/repo,logs}
mkdir -p /opt/nyayavigya/archive/deploys
ln -sfn v5.0.0 /opt/Nyayavigya/sdk-dist/current 2>/dev/null || true
if [[ -d /opt/nyayavigya/repo ]]; then
  dirs=()
  while IFS= read -r d; do dirs+=("\$d"); done < <(find /opt/nyayavigya/repo -mindepth 1 -maxdepth 1 -type d 2>/dev/null | sort)
  n=\${#dirs[@]}
  if (( n > KEEP )); then
    for ((i=0; i<n-KEEP; i++)); do
      base=\$(basename "\${dirs[i]}")
      case "\${ARCHIVE_MODE}" in
        tar)
          echo "[ec2-layout] tar archive repo dir \${base}"
          tar -czf "/opt/nyayavigya/archive/repo/\${base}.tar.gz" -C /opt/nyayavigya/repo "\${base}" 2>/dev/null || true
          rm -rf "\${dirs[i]}"
          ;;
        move)
          echo "[ec2-layout] move archive repo dir \${base}"
          mv "\${dirs[i]}" "/opt/nyayavigya/archive/repo/\${base}" 2>/dev/null || rm -rf "\${dirs[i]}"
          ;;
        skip)
          echo "[ec2-layout] skip archive (would remove \${base})"
          ;;
      esac
    done
  fi
fi
if [[ -f /opt/Nyayavigya/deploys.log ]]; then
  tail -500 /opt/Nyayavigya/deploys.log > /tmp/deploys.log.trim && mv /tmp/deploys.log.trim /opt/Nyayavigya/deploys.log
fi
cat > /opt/Nyayavigya/LAYOUT.md <<'LAYOUT'
# EC2 Nyayavigya layout (v5.0.0)

| Path | Purpose |
|------|---------|
| /opt/Nyayavigya/CURRENT_DEPLOY | Active deploy id + sha |
| /opt/Nyayavigya/LAST_GOOD_DEPLOY | Rollback target |
| /opt/Nyayavigya/secrets/.env.production | Production env (never in git) |
| /opt/Nyayavigya/sdk-dist/v5.0.0/ | Partner SDK tarballs + SHA256SUMS |
| /opt/Nyayavigya/sdk-dist/current | Symlink -> v5.0.0 |
| /opt/nyayavigya/repo/<deploy-id>/ | Extracted gateway source per deploy |
| /opt/nyayavigya/archive/repo/ | Archived deploy dirs |
| /opt/Nyayavigya/archive/ | Old deploy artifacts |
LAYOUT
echo "[ec2-layout] current deploy: \$(cat /opt/Nyayavigya/CURRENT_DEPLOY 2>/dev/null || echo unknown)"
echo "[ec2-layout] sdk-dist tarballs: \$(ls -1 /opt/Nyayavigya/sdk-dist/v5.0.0/*.tgz 2>/dev/null | wc -l)"
echo "[ec2-layout] DONE"
EOS

B64="$(nv_b64_encode "$(cat "$SCRIPT")")"
rm -f "$SCRIPT"

CMD_ID=$(aws ssm send-command \
  --region "$NYV_AWS_REGION" \
  --instance-ids "$NYV_EC2_INSTANCE_ID" \
  --document-name AWS-RunShellScript \
  --comment "ec2-layout-cleanup-v5.0.0" \
  --parameters "commands=[\"echo ${B64} | base64 -d | bash\"]" \
  --query Command.CommandId --output text)

echo "[ec2-layout] SSM ${CMD_ID}"
st=Pending
max=$((WAIT_SECS / POLL_SECS))
for _ in $(seq 1 "$max"); do
  st=$(aws ssm get-command-invocation --region "$NYV_AWS_REGION" --command-id "$CMD_ID" \
    --instance-id "$NYV_EC2_INSTANCE_ID" --query Status --output text 2>/dev/null || echo Pending)
  case "$st" in Success|Failed|Cancelled|TimedOut) break ;; *) sleep "$POLL_SECS" ;; esac
done
aws ssm get-command-invocation --region "$NYV_AWS_REGION" --command-id "$CMD_ID" \
  --instance-id "$NYV_EC2_INSTANCE_ID" --query '[Status,StandardOutputContent,StandardErrorContent]' --output text
[[ "$st" == Success ]] || exit 1
