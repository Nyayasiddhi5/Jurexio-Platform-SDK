#!/usr/bin/env bash
# Probe 1: instrument validation + environment discovery on the NYS host.
# Positive controls are printed FIRST so an empty/garbled output is obviously
# an instrument failure rather than a platform failure.
echo "PC1_ECHO=5150"
echo "PC2_HOST=$(hostname)"
echo "PC3_DATE=$(date -u +%FT%TZ)"
echo "--- systemd units ---"
systemctl list-units --type=service --no-pager --plain 2>/dev/null | grep -Ei "nys|caselaw|api" || echo "NO_MATCHING_UNITS"
echo "--- listening ports ---"
(ss -ltnp 2>/dev/null || netstat -ltnp 2>/dev/null) | grep -E "LISTEN" | head -20
echo "--- app dir candidates ---"
for d in /opt/nys /opt/nys-api /srv/nys /home/ec2-user/jrx-search /opt/jrx-search; do
  [ -d "$d" ] && echo "DIR_EXISTS=$d"
done
ls -d /opt/*/ /srv/*/ 2>/dev/null | head -20
echo "--- env var NAMES only (no values) ---"
for f in /etc/nys.env /etc/nys/api.env /opt/nys/.env /etc/default/nys; do
  if [ -f "$f" ]; then
    echo "ENVFILE=$f"
    grep -oE "^[A-Z0-9_]+=" "$f" | sed 's/=$//' | sort | tr '\n' ' '
    echo
  fi
done
echo "--- unit files ---"
systemctl cat nys-api 2>/dev/null | head -40 || echo "NO_UNIT_nys-api"
