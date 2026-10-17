#!/usr/bin/env bash
# NV-TEXTRACT-IAM-PROBE-001 — AnalyzeDocument via instance role (ap-south-1), metrics only.
set -euo pipefail
DEP="$(cat /opt/Nyayavigya/CURRENT_DEPLOY)"
LIVE="/opt/Nyayavigya/repo/${DEP}"
PDF="$(find "$LIVE" -path '*/docparse-sdk/test/fixtures/type_CAUSE_LIST.pdf' | head -1)"
[ -f "$PDF" ] || { echo FATAL_no_pdf; exit 1; }
echo "fixture=$(basename "$PDF") bytes=$(wc -c < "$PDF")"
PNG="/tmp/jrx-textract-page.png"
rm -f "$PNG"
pdftoppm -png -f 1 -l 1 -singlefile "$PDF" /tmp/jrx-textract-page
[ -f "$PNG" ] || { echo FATAL_rasterize; exit 1; }
echo "raster_png_bytes=$(wc -c < "$PNG")"
python3 - <<PY
import json, time
from pathlib import Path
try:
    import boto3
except ImportError:
    print("FATAL boto3_missing")
    raise SystemExit(1)
png = Path("$PNG").read_bytes()
t0 = time.time()
client = boto3.client("textract", region_name="ap-south-1")
out = client.analyze_document(
    Document={"Bytes": png},
    FeatureTypes=["TABLES", "FORMS", "LAYOUT"],
)
ms = int((time.time() - t0) * 1000)
blocks = out.get("Blocks") or []
lines = [b for b in blocks if b.get("BlockType") == "LINE" and b.get("Text")]
words = [b for b in blocks if b.get("BlockType") == "WORD"]
text = "\n".join(b["Text"] for b in lines[:20])
print(f"iam_probe_ms={ms}")
print(f"block_count={len(blocks)} line_count={len(lines)} word_count={len(words)}")
print(f"text_sample_len={len(text)} sample={text[:120]!r}")
PY
