#!/bin/sh
# Install NYS-EMBED-STALL-DETECTOR-001 + timer, then PROVE it works in DRY-RUN before
# ever letting it restart a unit. Payload arrives base64 in $1 to survive SSM /bin/sh.
set -u
B64="$1"
echo "$B64" | base64 -d > /opt/nyv/api/jrx-embed-stall-detector.sh
chmod +x /opt/nyv/api/jrx-embed-stall-detector.sh
echo "installed: `stat -c '%s' /opt/nyv/api/jrx-embed-stall-detector.sh` bytes"
# The script uses bash arrays/regex — assert bash exists rather than assuming.
command -v bash >/dev/null || { echo "PROBE BROKEN: no bash"; exit 3; }
bash -n /opt/nyv/api/jrx-embed-stall-detector.sh && echo "syntax OK" || { echo "SYNTAX ERROR"; exit 3; }

cat > /etc/systemd/system/nyv-embed-stall-detector.service <<'UNIT'
[Unit]
Description=NYV NYS embed stall detector (NYS-EMBED-STALL-DETECTOR-001)
Documentation=file:///opt/Nyayavigya/docs/NYS-CORPUS-AND-EMBEDDING-MAP-2026-08-18.md
After=network-online.target

[Service]
Type=oneshot
WorkingDirectory=/opt/nyv/api
EnvironmentFile=-/opt/nyv/api/.env
# Start in DRY_RUN: it logs what it WOULD restart but changes nothing. Flipped to 0
# only after the log proves it reads staleness correctly and does not false-positive.
Environment=STALL_DRY_RUN=1
Environment=EMBED_STALE_SECS=1800
ExecStart=/bin/bash /opt/nyv/api/jrx-embed-stall-detector.sh
Nice=15
UNIT

cat > /etc/systemd/system/nyv-embed-stall-detector.timer <<'UNIT'
[Unit]
Description=Run the NYS embed stall detector every 10 minutes

[Timer]
OnBootSec=5min
OnUnitActiveSec=10min
AccuracySec=1min
Unit=nyv-embed-stall-detector.service

[Install]
WantedBy=timers.target
UNIT

systemctl daemon-reload
systemctl enable --now nyv-embed-stall-detector.timer >/dev/null 2>&1
echo "timer enabled: `systemctl is-active nyv-embed-stall-detector.timer`"

echo ""
echo "=== run it ONCE now (dry-run) and read the log ==="
systemctl start nyv-embed-stall-detector.service
sleep 12
echo "  service result: `systemctl show nyv-embed-stall-detector.service -p Result --value`"
echo "  --- /opt/nyv/embed-stall.log ---"
tail -12 /opt/nyv/embed-stall.log 2>/dev/null | sed 's/^/    /' || echo "    (no log yet)"

echo ""
echo "=== ACCEPTANCE: it must report OK (all advancing), not a false stall ==="
echo "  current real staleness for comparison:"
tail -1 /opt/nyv/embed-stall.log 2>/dev/null | sed 's/^/    /'
echo ""
echo "  next scheduled run: `systemctl list-timers nyv-embed-stall-detector.timer --no-pager 2>/dev/null | sed -n '2p' | cut -c1-80`"
