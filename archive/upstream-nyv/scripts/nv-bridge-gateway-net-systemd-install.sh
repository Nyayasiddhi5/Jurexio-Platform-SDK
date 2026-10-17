#!/usr/bin/env bash
# =============================================================================
# nv-bridge-gateway-net-systemd-install.sh
# NV-OPT+UAT-2026-05-09 P1 #7
#
# Installs a oneshot systemd unit that re-attaches `nyv-gateway` to the
# legacy `nyayavigya-platform-312_nyv-net` network (the one nginx upstream
# resolves "gateway" through). Runs after docker.service so the bridge is
# re-applied on every reboot — no more 502 outages from the per-deploy
# project-name network split.
#
# IDEMPOTENT — connect-if-not-already-connected, reload-nginx-if-running.
# Safe to run repeatedly. RUN ON EC2 ONCE, then enable.
#
# USAGE (on EC2, as root):
#   sudo bash /opt/nyayavigya/scripts/jrx-bridge-gateway-net-systemd-install.sh
# =============================================================================
set -euo pipefail

NET_NAME="nyayavigya-platform-312_nyv-net"
GATEWAY_NAME="nyv-gateway"
CONSOLE_NAME="nyv-console"
SCRIPT_PATH="/opt/nyayavigya/scripts/jrx-bridge-gateway-to-console-net.sh"
UNIT_PATH="/etc/systemd/system/nyv-gateway-bridge.service"

mkdir -p /opt/nyayavigya/scripts

cat > "${SCRIPT_PATH}" <<'SCRIPT'
#!/usr/bin/env bash
# Re-attach nyv-gateway to the legacy console network. Idempotent + tolerant
# of missing containers (no-op exit instead of failing the systemd unit).
# NV-OPT-CR-002 (2026-05-09 architect): drop set -e so partial state
# doesn't fail the unit; explicit checks + safe exits.
set -uo pipefail
NET="nyayavigya-platform-312_nyv-net"
GW="nyv-gateway"
CON="nyv-console"

# Wait up to 90s for the network + gateway. Console may legitimately be
# absent (admin-stopped), so wait_for_console is best-effort.
ready=0
for i in $(seq 1 90); do
  if docker network inspect "${NET}" >/dev/null 2>&1 \
     && docker inspect "${GW}" >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 1
done

if [ "${ready}" -ne 1 ]; then
  echo "[bridge] gateway or net not present after 90s — no-op (this is OK if gateway is intentionally stopped)"
  exit 0
fi

# Connect only if not already on the net.
if ! docker inspect "${GW}" --format '{{json .NetworkSettings.Networks}}' 2>/dev/null | grep -q "\"${NET}\""; then
  docker network connect --alias gateway "${NET}" "${GW}" 2>&1 | sed 's/^/[bridge] /' || true
  echo "[bridge] connected ${GW} → ${NET}"
else
  echo "[bridge] ${GW} already on ${NET}"
fi

# Reload nginx only if console is running. Tolerate console absent.
if docker inspect "${CON}" --format '{{.State.Running}}' 2>/dev/null | grep -q true; then
  docker exec "${CON}" nginx -s reload 2>&1 | sed 's/^/[bridge] /' || true
  echo "[bridge] nginx reload requested"
else
  echo "[bridge] console container absent or stopped — skipping nginx reload"
fi
exit 0
SCRIPT
chmod +x "${SCRIPT_PATH}"

cat > "${UNIT_PATH}" <<UNIT
[Unit]
Description=Nyayavigya — bridge gateway container to console legacy network
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
ExecStart=${SCRIPT_PATH}
RemainAfterExit=yes
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable nyv-gateway-bridge.service
echo ""
echo "✅ Installed:"
echo "   ${SCRIPT_PATH}"
echo "   ${UNIT_PATH}"
echo ""
echo "Test now: sudo systemctl start nyv-gateway-bridge.service && sudo systemctl status nyv-gateway-bridge.service"
echo "On reboot it will re-bridge gateway → ${NET_NAME} automatically."
