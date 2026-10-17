#!/usr/bin/env bash
set -euo pipefail
PDF="/opt/Nyayavigya/repo/2026-10-07T0844Z-aws-ssm-fbe45dde/packages/docparse-sdk/test/fixtures/type_CAUSE_LIST.pdf"
file "$PDF" || true
pdftoppm -png -f 1 -l 1 -singlefile "$PDF" /tmp/t 2>&1 || true
ls -la /tmp/t* 2>&1 || true
