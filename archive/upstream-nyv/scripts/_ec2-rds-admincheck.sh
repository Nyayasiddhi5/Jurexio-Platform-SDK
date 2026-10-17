#!/usr/bin/env bash
set +e
APP="$(docker exec nyv-gateway printenv DATABASE_URL 2>/dev/null)"
ADM="$(docker exec nyv-gateway printenv DATABASE_URL_ADMIN 2>/dev/null)"
norm() { echo "$1" | sed -E 's/sslmode=no-verify/sslmode=require/; s/sslmode=verify-full/sslmode=require/; s/sslmode=verify-ca/sslmode=require/'; }
APP="$(norm "${APP%\"}")"; ADM="$(norm "${ADM%\"}")"
echo "APP_URL_LEN=${#APP}  ADMIN_URL_LEN=${#ADM}"
chk() {
  local u="$1" lbl="$2"
  [ -z "$u" ] && { echo "$lbl: (not set)"; return; }
  docker run --rm --network host -e PGURL="$u" postgres:16-alpine \
    sh -c "psql \"\$PGURL\" -At -F '|' -v ON_ERROR_STOP=0 -c \"SELECT current_user, has_schema_privilege(current_user,'public','CREATE'), has_schema_privilege(current_user,'nv_schema','CREATE'), rolsuper FROM pg_roles WHERE rolname=current_user;\"" 2>&1 | sed "s/^/$lbl: /"
}
chk "$APP" "APP"
chk "$ADM" "ADMIN"
echo "=== statutes + scoped flags counts (app) ==="
docker run --rm --network host -e PGURL="$APP" postgres:16-alpine sh -c 'psql "$PGURL" -At -F "|" -c "SELECT (SELECT count(*) FROM nv_statutes) statutes, (SELECT count(*) FROM scoped_feature_flags) flags, (SELECT count(*) FROM nv_jurisdiction_profiles) juris_profiles;"' 2>&1
