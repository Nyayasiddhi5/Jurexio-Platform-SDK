#!/usr/bin/env bash
# Probe 5: END-TO-END live verification of the on-demand full-judgment path.
#   /athena/status  → config reachable
#   /caselaw/search → locate a real judgment + its s3Path/pdf_link identifier
#   /athena/document→ presigned URL for that identifier
#   /athena/extract → the actual judgment TEXT (the thing under test)
#
# The API key is read from the running service's environ and used only inside
# this host-local script; it is never printed (length only).
set -uo pipefail
echo "PC1_ECHO=5150"
PID=$(systemctl show -p MainPID --value nyv-api.service)
KEY=$(tr '\0' '\n' < "/proc/$PID/environ" | grep -m1 '^NYS_SDK_API_KEYS=' | cut -d= -f2- | cut -d, -f1)
echo "PC2_KEY_LEN=${#KEY}"
if [ "${#KEY}" -lt 16 ]; then echo "INSTRUMENT_FAILED_NO_KEY"; exit 1; fi
B=http://127.0.0.1:8080/api

hit() { # label method path [json-body]
  local label="$1" method="$2" path="$3" body="${4:-}"
  local out="/tmp/out_${label}.json"
  if [ "$method" = "GET" ]; then
    m=$(curl -s -o "$out" -w "http=%{http_code} bytes=%{size_download} t=%{time_total}" \
        -H "X-API-Key: $KEY" "$B$path")
  else
    m=$(curl -s -o "$out" -w "http=%{http_code} bytes=%{size_download} t=%{time_total}" \
        -H "X-API-Key: $KEY" -H 'Content-Type: application/json' \
        -X "$method" -d "$body" "$B$path")
  fi
  echo "### $label $method $path -> $m"
  head -c 900 "$out"; echo
}

echo "=== A. Athena config as the server sees it ==="
hit status GET "/athena/status"

echo "=== B. Locate real judgments (RDS metadata) ==="
hit sc_kesav GET "/caselaw/search?jurisdiction=IN&q=KESAVANANDA%20BHARATI&courtType=sc&limit=3&mode=fts"
hit sc_maneka GET "/caselaw/search?jurisdiction=IN&q=MANEKA%20GANDHI&courtType=sc&limit=3&mode=fts"

echo "=== C. Athena metadata search (SC scope; measures bytesScanned) ==="
hit athena_sc POST "/athena/search" '{"q":"Kesavananda","archive":"sc","limit":5}'
echo "=== C2. Athena metadata search with year partition filter ==="
hit athena_sc_year POST "/athena/search" '{"q":"Kesavananda","archive":"sc","year":1973,"limit":5}'
echo "=== C3. Athena HC scope (cost check) ==="
hit athena_hc POST "/athena/search" '{"q":"bail","archive":"hc","year":2020,"limit":3}'

echo "=== D. Extract s3_path from the Athena SC result and fetch FULL TEXT ==="
node -e '
const fs=require("fs");
try{
  const j=JSON.parse(fs.readFileSync("/tmp/out_athena_sc.json","utf8"));
  const r=(j.results||[]).filter(x=>x.s3_path);
  console.log("ATHENA_RESULT_COUNT="+(j.results||[]).length+" WITH_S3PATH="+r.length);
  console.log("BYTES_SCANNED="+j.bytesScanned+" EST_USD="+j.estimatedCostUsd);
  if(r[0]) fs.writeFileSync("/tmp/s3path.txt", r[0].s3_path);
  (j.results||[]).slice(0,5).forEach(x=>console.log("  ROW "+JSON.stringify(x)));
}catch(e){console.log("PARSE_ERR="+e.message);}
'
if [ -s /tmp/s3path.txt ]; then
  S3P=$(cat /tmp/s3path.txt)
  echo "S3_PATH_UNDER_TEST=$S3P"
  hit doc GET "/athena/document?s3Path=$S3P"
  echo "--- EXTRACT (the on-demand full-text call) ---"
  T0=$(date +%s%3N)
  curl -s -o /tmp/out_extract.json -w "http=%{http_code} bytes=%{size_download} t=%{time_total}\n" \
    -H "X-API-Key: $KEY" -H 'Content-Type: application/json' \
    -X POST -d "{\"s3Path\":\"$S3P\"}" "$B/athena/extract"
  T1=$(date +%s%3N)
  echo "EXTRACT_WALL_MS=$((T1-T0))"
  node -e '
  const fs=require("fs");
  try{
    const j=JSON.parse(fs.readFileSync("/tmp/out_extract.json","utf8"));
    if(j.error){console.log("EXTRACT_ERROR="+j.error);}
    else{
      console.log("EXTRACT_s3Path="+j.s3Path);
      console.log("EXTRACT_byteSize="+j.byteSize+" textLength="+j.textLength+" ocrUsed="+j.ocrUsed+" cached="+j.cached);
      console.log("--- FIRST 1200 CHARS OF JUDGMENT BODY ---");
      console.log((j.text||"").slice(0,1200));
      console.log("--- LAST 400 CHARS ---");
      console.log((j.text||"").slice(-400));
    }
  }catch(e){console.log("PARSE_ERR="+e.message);}
  '
else
  echo "NO_S3PATH_FROM_ATHENA — falling back to RDS pdf_link"
fi
echo "PROBE5_DONE=5150"
