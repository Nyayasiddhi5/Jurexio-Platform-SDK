#!/usr/bin/env bash
set +e
APP="$(docker exec nyv-gateway printenv DATABASE_URL 2>/dev/null)"; APP="${APP%\"}"; APP="${APP#\"}"
APP="$(echo "$APP" | sed -E 's/sslmode=no-verify/sslmode=require/; s/sslmode=verify-full/sslmode=require/')"
run() { docker run --rm --network host -e PGURL="$APP" postgres:16-alpine sh -c "psql \"\$PGURL\" -At -F'|' -c \"$1\"" 2>&1; }
echo "=== FTS: 'transfer pricing' (US IRC §482) ==="
run "SELECT jurisdiction, act_short_title, section_number, section_title FROM public.nv_statutes WHERE search_vector @@ plainto_tsquery('english','transfer pricing') LIMIT 3;"
echo "=== FTS: 'organised crime' (IN BNS §111) ==="
run "SELECT jurisdiction, act_short_title, section_number, section_title FROM public.nv_statutes WHERE search_vector @@ plainto_tsquery('english','organised crime syndicate') LIMIT 3;"
echo "=== FTS: 'appraisal rights' (US DGCL §262) ==="
run "SELECT jurisdiction, act_short_title, section_number, section_title FROM public.nv_statutes WHERE search_vector @@ plainto_tsquery('english','appraisal rights merger') LIMIT 3;"
echo "=== FTS: 'gig worker social security' (IN SS Code) ==="
run "SELECT jurisdiction, act_short_title, section_number, section_title FROM public.nv_statutes WHERE search_vector @@ plainto_tsquery('english','gig platform worker') LIMIT 3;"
