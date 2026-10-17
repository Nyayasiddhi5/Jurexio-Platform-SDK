#!/usr/bin/env bash
# NV-TEXTRACT-DIRECT-PROBE-001 — call textractOcrPageBytes inside nyv-gateway (no secrets).
set -euo pipefail
DEP="$(cat /opt/Nyayavigya/CURRENT_DEPLOY)"
LIVE="/opt/Nyayavigya/repo/${DEP}"
PDF="$(find "$LIVE" -path '*/docparse-sdk/test/fixtures/type_CAUSE_LIST.pdf' | head -1)"
[ -n "$PDF" ] || { echo FATAL_no_fixture; exit 1; }
echo "fixture=$(basename "$PDF") bytes=$(wc -c < "$PDF")"
echo "NYV_F_TEXTRACT=$(docker exec nyv-gateway printenv NYV_F_TEXTRACT 2>/dev/null || echo unset)"
docker exec -e NYV_F_TEXTRACT=1 nyv-gateway node --input-type=module -e '
import { readFileSync } from "node:fs";
const pdf = process.argv[1];
const { textractOcrPageBytes, textractRegion } = await import("/app/dist/services/document-pipeline/jrx-textract-ocr-service.js");
const buf = readFileSync(pdf);
const t0 = Date.now();
const r = await textractOcrPageBytes(buf);
const sample = (r?.text || "").slice(0, 80).replace(/\n/g, " ");
console.log(JSON.stringify({
  region: textractRegion(),
  ms: Date.now() - t0,
  hit: Boolean(r),
  provider: r?.provider ?? null,
  blockCount: r?.blockCount ?? 0,
  meanConf: r?.meanConf ?? 0,
  textLen: r?.text?.length ?? 0,
  textSample: sample,
}));
' "$PDF"
echo "=== LOG GREP textract (5m) ==="
docker logs nyv-gateway --since 5m 2>&1 | grep -i textract | tail -10 || echo log_grep=empty
