#!/usr/bin/env bash
set -uo pipefail
echo "=== CURRENT_DEPLOY ==="
cat /opt/Nyayavigya/CURRENT_DEPLOY 2>/dev/null || echo missing
echo "=== docker ps ==="
docker ps -a --format '{{.Names}} {{.Status}}' | grep nyv || true
echo "=== gateway image ==="
docker inspect nyv-gateway --format 'image={{.Config.Image}} started={{.State.StartedAt}} health={{.State.Health.Status}}' 2>/dev/null || true
echo "=== /api/jrx/health full ==="
curl -sS -m 10 http://127.0.0.1:5000/api/jrx/health 2>/dev/null | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    print('top status:', d.get('status'))
    svcs = d.get('services') or {}
    for k, v in sorted(svcs.items()):
        st = v.get('status') if isinstance(v, dict) else v
        print(f'  {k}: {st}')
        if isinstance(v, dict) and st != 'healthy':
            for kk, vv in v.items():
                if kk != 'status':
                    print(f'    {kk}: {vv}')
except Exception as e:
    print('parse error:', e)
    sys.stdin.seek(0)
" 2>/dev/null || curl -sS -m 10 http://127.0.0.1:5000/api/jrx/health | head -c 2000
echo ""
echo "=== /api/jrx/health/full ==="
curl -sS -m 15 http://127.0.0.1:5000/api/jrx/health/full 2>/dev/null | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    print('status:', d.get('status'))
    checks = d.get('checks') or d.get('services') or {}
    if isinstance(checks, dict):
        for k, v in sorted(checks.items()):
            if isinstance(v, dict):
                print(f'  {k}: {v.get(\"status\", v)}')
            else:
                print(f'  {k}: {v}')
except Exception as e:
    print('parse error:', e)
" 2>/dev/null || echo "(health/full failed)"
echo "=== docker health log ==="
docker inspect nyv-gateway --format '{{range .State.Health.Log}}{{.ExitCode}} {{.Output}}{{end}}' 2>/dev/null | tail -c 800 || true
echo ""
echo "=== recent errors in logs ==="
docker logs --tail 80 nyv-gateway 2>&1 | grep -iE 'error|fatal|unhealthy|503|fail' | tail -20 | sed 's/\(password\|secret\|key\)=[^ ]*/\1=<redacted>/gi' || true
