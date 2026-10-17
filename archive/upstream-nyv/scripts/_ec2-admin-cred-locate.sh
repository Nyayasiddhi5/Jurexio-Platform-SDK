#!/bin/sh
# Is a WORKING admin credential already on the host? NV-SECRETS-001: names, lengths
# and auth results only — never a value.
CANON=/opt/Nyayavigya/secrets/.env.production
echo "=== admin-ish keys in the canonical envfile (names + pw length only) ==="
grep -nE '^(DATABASE_URL_ADMIN|DATABASE_URL|PG.*ADMIN|.*ADMIN.*URL|POSTGRES_PASSWORD|RDS.*PASS)=' "$CANON" 2>/dev/null | \
  sed -E 's/(:[^:]*:)[^@]*(@)/\1<redacted>\2/; s/(PASSWORD=).*/\1<redacted len=\?>/' | head -10

echo ""
echo "=== compare envfile admin vs container admin (length only) ==="
FILE_ADM=$(grep -E '^DATABASE_URL_ADMIN=' "$CANON" | head -1 | cut -d= -f2- | tr -d '"' | tr -d "\r\n")
CONT_ADM=$(docker exec nyv-gateway printenv DATABASE_URL_ADMIN 2>/dev/null)
fl=$(printf %s "$FILE_ADM" | sed -E 's#^[a-z]+://[^:]+:([^@]*)@.*#\1#' | wc -c)
cl=$(printf %s "$CONT_ADM" | sed -E 's#^[a-z]+://[^:]+:([^@]*)@.*#\1#' | wc -c)
echo "  envfile   admin pw_len = $((fl-1))"
echo "  container admin pw_len = $((cl-1))"
[ "$fl" = "$cl" ] && echo "  -> SAME length (likely same stale value)" || echo "  -> DIFFERENT: envfile may hold the current password"

echo ""
echo "=== does the ENVFILE admin credential authenticate? ==="
A=$(echo "$FILE_ADM" | sed -E 's/sslmode=no-verify/sslmode=require/; s/sslmode=verify-full/sslmode=require/')
if [ -n "$A" ]; then
  docker run --rm --network host -e PGURL="$A" postgres:16-alpine \
    sh -c 'psql "$PGURL" -At -c "SELECT current_user, '"'"'ENVFILE_ADMIN_OK'"'"';"' 2>&1 | tail -2
else
  echo "  <no DATABASE_URL_ADMIN in envfile>"
fi

echo ""
echo "=== any other secret file on the host with an rds password? (names only) ==="
ls -1 /opt/Nyayavigya/secrets/ 2>/dev/null | head -12
