#!/usr/bin/env bash
# EC2 P0 diagnostic — prints key presence only, never values.
set -euo pipefail
CANON="/opt/Nyayavigya/secrets/.env.production"
echo "=== env key presence (no values) ==="
for k in NV_DEMO_PASSWORD DATABASE_URL DATABASE_URL_ADMIN NYV_SENTRY_DSN SENTRY_DSN \
  NYV_SDK_KEY_NSP NYV_SDK_KEY_NSPM NYV_SDK_KEY_NSI NYV_SDK_KEY_NSA NYV_SDK_KEY_NSM NYV_SDK_KEY_NYM NYV_SDK_KEY_JRX; do
  if grep -qE "^${k}=.+" "$CANON" 2>/dev/null; then
    vlen=$(grep -E "^${k}=" "$CANON" | head -1 | cut -d= -f2- | tr -d "\"'" | wc -c | tr -d ' ')
    echo "  $k: set (len~$vlen)"
  else
    echo "  $k: MISSING"
  fi
done
echo "=== sentry dsn shape ==="
dsn=$(grep -E "^(NYV_SENTRY_DSN|SENTRY_DSN)=" "$CANON" | head -1 | cut -d= -f2- | tr -d "\"'" || true)
if [ -z "$dsn" ]; then
  echo "  no dsn"
else
  case "$dsn" in
    https://*@sentry.io/*) echo "  valid pattern" ;;
    *) echo "  INVALID pattern (causes degraded)" ;;
  esac
fi
echo "=== docker ps ==="
docker ps --format '{{.Names}} {{.Status}}' | grep -E 'nyv-' || true
echo "=== admin user count (via gateway container) ==="
docker exec nyv-gateway npx tsx -e "
import * as dotenv from 'dotenv';
import pg from 'pg';
dotenv.config({ path: '/app/.env' });
const url = process.env.DATABASE_URL_ADMIN || process.env.DATABASE_URL;
if (!url) { console.log('  no DATABASE_URL'); process.exit(0); }
const pool = new pg.Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });
pool.query('SELECT COUNT(*)::int AS c FROM nv_users WHERE email=\$1', ['admin@nyayavigya.in'])
  .then(r => { console.log('  admin count=' + r.rows[0].c); return pool.end(); })
  .catch(e => { console.log('  query err: ' + e.message); return pool.end(); });
" 2>&1 || echo "  query failed"
