#!/usr/bin/env bash
# NV-OCR-DEPS-PROBE-001 — verify pdftoppm, tesseract, tessdata on nysdev (read-only).
set -euo pipefail

echo "=== NYV OCR dependency probe (nysdev) ==="
echo "host=$(hostname -s 2>/dev/null || hostname)"
echo "utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"

check_bin() {
  local name="$1"
  if command -v "$name" >/dev/null 2>&1; then
    echo "bin_${name}=present version=$("$name" --version 2>&1 | head -1 | tr -d '\r')"
  else
    echo "bin_${name}=MISSING"
  fi
}

check_bin pdftoppm
check_bin tesseract

TESSDATA=""
if [ -n "${TESSDATA_PREFIX:-}" ] && [ -d "${TESSDATA_PREFIX}" ]; then
  TESSDATA="${TESSDATA_PREFIX}"
else
  for alt in \
    /usr/share/tesseract-ocr/5/tessdata \
    /usr/share/tesseract-ocr/4.00/tessdata \
    /usr/share/tesseract-ocr/tessdata \
    /usr/local/share/tessdata; do
    if [ -d "$alt" ]; then TESSDATA="$alt"; break; fi
  done
fi

if [ -n "$TESSDATA" ] && [ -d "$TESSDATA" ]; then
  eng="$TESSDATA/eng.traineddata"
  hin="$TESSDATA/hin.traineddata"
  if [ -f "$eng" ]; then echo "tessdata_eng=present"; else echo "tessdata_eng=MISSING"; fi
  if [ -f "$hin" ]; then echo "tessdata_hin=present"; else echo "tessdata_hin=MISSING"; fi
  echo "tessdata_dir=$TESSDATA count=$(find "$TESSDATA" -maxdepth 1 -name '*.traineddata' 2>/dev/null | wc -l | tr -d ' ')"
else
  echo "tessdata_eng=MISSING"
  echo "tessdata_hin=MISSING"
  echo "tessdata_dir=MISSING"
fi

# Node-side OCR packages inside gateway container path (informational)
for p in /opt/nyv/api/node_modules/tesseract.js/package.json \
         /opt/Nyayavigya/node_modules/tesseract.js/package.json; do
  if [ -f "$p" ]; then echo "node_tesseract_js=present path=$p"; fi
done

echo "=== probe complete ==="
