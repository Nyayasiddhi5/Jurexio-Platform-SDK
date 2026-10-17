#!/usr/bin/env bash
systemctl is-active jrx-api.service || true
systemctl status jrx-api.service --no-pager | head -15
curl -sS -m 5 -o /dev/null -w "healthz http=%{http_code}\n" http://127.0.0.1:8080/healthz || echo health_fail
journalctl -u jrx-api.service --since 10m --no-pager | tail -30
