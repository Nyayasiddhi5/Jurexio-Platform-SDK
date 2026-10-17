#!/usr/bin/env bash
# =============================================================================
# bootstrap-fresh-ec2.sh — first-boot host bootstrap (idempotent).
#
# Runs on a freshly provisioned EC2 host. The Terraform `ec2_host` module's
# cloud-init already installs docker + awscli + ssm-agent; this script does
# everything ABOVE that line: host hardening, EBS data-disk mount, directory
# layout, ECR login, image pull, .env, DB schema bootstrap (--full), compose
# up, health gate, and a structured bootstrap-report at the end.
#
# Usage:
#   bash scripts/bootstrap-fresh-ec2.sh prod          # full bootstrap
#   bash scripts/bootstrap-fresh-ec2.sh prod --skip-harden  # for re-runs
#
# Re-running is safe: every step is idempotent and produces the same report.
# =============================================================================
set -euo pipefail

ENV="${1:-prod}"
case "$ENV" in prod|staging) ;; *) echo "usage: $0 <prod|staging> [--skip-harden]" >&2; exit 2 ;; esac
shift || true
SKIP_HARDEN=0; SKIP_DBPUSH=0
for arg in "$@"; do
  case "$arg" in
    --skip-harden) SKIP_HARDEN=1 ;;
    --skip-db-push) SKIP_DBPUSH=1 ;;
  esac
done

REGION="${AWS_REGION:-ap-south-1}"
ACCOUNT="${NYV_ACCOUNT_ID:-789925699169}"
ECR_REGISTRY="${ACCOUNT}.dkr.ecr.${REGION}.amazonaws.com"
REPO_DIR="/opt/nyayavigya/repo/nyayavigya-platform-312"
COMPOSE="docker-compose.ecosystem.yml"
[ "$ENV" = "staging" ] && COMPOSE="docker-compose.staging.yml"
DATA_DEV="${NYV_DATA_DEV:-/dev/nvme1n1}"   # second EBS volume from Terraform
DATA_MOUNT="/opt/nyayavigya/data"
REPORT="/opt/nyayavigya/logs/bootstrap-report-$(date -u +%Y%m%dT%H%M%SZ).log"

LOG()  { printf "[bootstrap %s] %s\n" "$(date -u +%H:%M:%S)" "$*" | tee -a "$REPORT"; }
DIE()  { printf "FATAL: %s\n" "$*" | tee -a "$REPORT" >&2; exit 1; }

sudo mkdir -p /opt/nyayavigya/logs
sudo chown -R "$USER:$USER" /opt/nyayavigya/logs
: > "$REPORT"

LOG "===== bootstrap start (env=$ENV  region=$REGION) ====="

# ── 1. Verify prerequisites ──────────────────────────────────────────────────
LOG "[1/8] verifying prerequisites"
for c in docker aws curl jq tar rsync awk sed lsblk; do
  command -v "$c" >/dev/null || DIE "$c not installed"
done
sg docker -c 'docker info' >/dev/null 2>&1 || DIE "docker not running or user not in 'docker' group"

# ── 2. Host hardening (sshd / ufw / fail2ban / unattended-upgrades) ──────────
if [ "$SKIP_HARDEN" = "0" ]; then
  LOG "[2/8] hardening host (sshd, ufw, fail2ban, unattended-upgrades)"
  sudo DEBIAN_FRONTEND=noninteractive apt-get update -y >>"$REPORT" 2>&1
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y \
    ufw fail2ban unattended-upgrades apt-listchanges >>"$REPORT" 2>&1

  # sshd: no root login, no password auth, only key auth
  SSHD=/etc/ssh/sshd_config
  sudo sed -i \
    -e 's/^#\?PermitRootLogin.*/PermitRootLogin no/' \
    -e 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' \
    -e 's/^#\?ChallengeResponseAuthentication.*/ChallengeResponseAuthentication no/' \
    -e 's/^#\?KbdInteractiveAuthentication.*/KbdInteractiveAuthentication no/' \
    -e 's/^#\?X11Forwarding.*/X11Forwarding no/' \
    -e 's/^#\?MaxAuthTries.*/MaxAuthTries 3/' \
    "$SSHD"
  sudo systemctl restart ssh || sudo systemctl restart sshd

  # ufw: deny all in, allow 22 (SSM-only in SG; this is belt+braces) + 80/443
  sudo ufw --force reset >>"$REPORT" 2>&1
  sudo ufw default deny incoming
  sudo ufw default allow outgoing
  sudo ufw allow 22/tcp comment 'ssh (SG should restrict source)'
  sudo ufw allow 80/tcp comment 'http -> caddy'
  sudo ufw allow 443/tcp comment 'https -> caddy'
  sudo ufw --force enable

  # fail2ban: enable sshd jail with sane defaults
  sudo tee /etc/fail2ban/jail.d/sshd-nyv.conf >/dev/null <<'F2B'
[sshd]
enabled  = true
port     = ssh
maxretry = 4
findtime = 10m
bantime  = 1h
F2B
  sudo systemctl enable --now fail2ban

  # unattended-upgrades: security only, auto-reboot Sunday 04:00
  sudo tee /etc/apt/apt.conf.d/52nyayavigya-auto >/dev/null <<'AUC'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "04:00";
AUC
  sudo systemctl enable --now unattended-upgrades
  LOG "       hardening complete"
else
  LOG "[2/8] hardening SKIPPED (--skip-harden)"
fi

# ── 3. EBS data disk mount ───────────────────────────────────────────────────
LOG "[3/8] EBS data disk: $DATA_DEV -> $DATA_MOUNT"
if [ -b "$DATA_DEV" ]; then
  if ! lsblk -no FSTYPE "$DATA_DEV" | grep -q ext4; then
    LOG "       formatting $DATA_DEV ext4"
    sudo mkfs.ext4 -F -L nyv-data "$DATA_DEV" >>"$REPORT" 2>&1
  else
    LOG "       $DATA_DEV already ext4 — skipping mkfs"
  fi
  sudo mkdir -p "$DATA_MOUNT"
  if ! mountpoint -q "$DATA_MOUNT"; then sudo mount "$DATA_DEV" "$DATA_MOUNT"; fi
  if ! grep -q "LABEL=nyv-data" /etc/fstab; then
    echo "LABEL=nyv-data $DATA_MOUNT ext4 defaults,nofail 0 2" | sudo tee -a /etc/fstab >/dev/null
    LOG "       added /etc/fstab entry"
  fi
  sudo chown -R "$USER:$USER" "$DATA_MOUNT"
else
  LOG "       WARN: $DATA_DEV not present — assuming root volume only (acceptable for staging)"
fi

# ── 4. Directory layout ──────────────────────────────────────────────────────
LOG "[4/8] /opt/nyayavigya layout"
sudo mkdir -p /opt/nyayavigya/{releases,incoming,logs,repo}
sudo chown -R "$USER:$USER" /opt/nyayavigya

# ── 5. ECR login + image pull ────────────────────────────────────────────────
LOG "[5/8] ECR login + image pull"
aws ecr get-login-password --region "$REGION" \
  | sg docker -c "docker login --username AWS --password-stdin $ECR_REGISTRY" \
  >>"$REPORT" 2>&1 \
  || DIE "ecr login failed — check IAM instance role + region"

TAG="${NYV_IMAGE_TAG:-latest}"
[ "$ENV" = "staging" ] && TAG="${NYV_IMAGE_TAG:-staging}"
PULLED=0; SKIPPED=0
for repo in nyv-gateway nyv-console nyv-nym-app nyv-nsp-app nyv-nsi-app nyv-nsa-app nyv-nsm-app; do
  if sg docker -c "docker pull $ECR_REGISTRY/$repo:$TAG" >>"$REPORT" 2>&1; then
    PULLED=$((PULLED+1)); LOG "       pulled $repo:$TAG"
  else
    SKIPPED=$((SKIPPED+1)); LOG "       skipped $repo:$TAG (not in ECR yet)"
  fi
done

# ── 6. .env (minimal) ────────────────────────────────────────────────────────
LOG "[6/8] writing minimal .env"
[ -d "$REPO_DIR" ] || DIE "Repo not found at $REPO_DIR — extract a deploy tarball or git-clone first."
ENV_FILE="$REPO_DIR/.env"
[ "$ENV" = "staging" ] && ENV_FILE="$REPO_DIR/.env.staging"
if [ ! -f "$ENV_FILE" ]; then
  cat > "$ENV_FILE" <<EOF
NYV_ENV=$ENV
AWS_REGION=$REGION
NYV_SECRETS_BACKEND=aws-secrets-manager
NYV_SECRETS_PREFIX=nyayavigya/$ENV/gateway
NYV_IMAGE_TAG=$TAG
NYV_DATA_DIR=$DATA_MOUNT
EOF
  LOG "       wrote $ENV_FILE"
else
  LOG "       $ENV_FILE exists — leaving as-is"
fi

# ── 7. Bring stack up + DB bootstrap ────────────────────────────────────────
LOG "[7/8] docker compose up"
cd "$REPO_DIR"
sg docker -c "docker compose -f $COMPOSE --env-file $(basename $ENV_FILE) pull" >>"$REPORT" 2>&1 || true
sg docker -c "docker compose -f $COMPOSE --env-file $(basename $ENV_FILE) up -d" >>"$REPORT" 2>&1

if [ "$SKIP_DBPUSH" = "0" ]; then
  LOG "       running db:push inside gateway-a (idempotent schema sync)"
  if ! sg docker -c "docker compose -f $COMPOSE exec -T gateway-a pnpm run db:push" >>"$REPORT" 2>&1; then
    LOG "       WARN: db:push failed — see $REPORT (may be expected on first boot before secrets resolve)"
  fi
fi

# ── 8. Health gate ───────────────────────────────────────────────────────────
LOG "[8/8] health gate (up to 90s on /health)"
HEALTHY=0
for i in $(seq 1 18); do
  CODE=$(curl -s -o /dev/null -w '%{http_code}' -m 5 http://127.0.0.1/health || echo 000)
  if [ "$CODE" = "200" ]; then HEALTHY=1; LOG "       healthy after ${i}x5s"; break; fi
  sleep 5
done

# ── Bootstrap report ─────────────────────────────────────────────────────────
{
  echo ""
  echo "===== bootstrap report ====="
  echo "env:                 $ENV"
  echo "region:              $REGION"
  echo "tag:                 $TAG"
  echo "images_pulled:       $PULLED"
  echo "images_skipped:      $SKIPPED"
  echo "hardening_applied:   $([ $SKIP_HARDEN = 0 ] && echo yes || echo no)"
  echo "ebs_mounted:         $(mountpoint -q $DATA_MOUNT && echo yes || echo no)"
  echo "compose_file:        $COMPOSE"
  echo "health_200:          $([ $HEALTHY = 1 ] && echo yes || echo no)"
  echo "report_file:         $REPORT"
  echo "============================"
} | tee -a "$REPORT"

if [ "$HEALTHY" = "1" ]; then
  LOG "bootstrap complete — see $REPORT"
  exit 0
else
  DIE "Gateway never became healthy — review $REPORT and 'docker compose logs gateway-a'"
fi
