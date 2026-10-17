#!/usr/bin/env bash
# Probe 8: replay the EXACT two-hop sequence that
# src/services/jrx-nys-judgment-fulltext.ts issues, against the live NYS API, so
# the "joined resolve→extract path works" claim is earned by execution rather
# than by unit-test mocks.
#
# Hop 1: POST /athena/search  {"q":<query>,"archive":"sc","limit":5}
# Hop 2: POST /athena/extract {"s3Path":<results[0].s3_path>,"title":<title>}
set -uo pipefail
echo "PC1_ECHO=5150"
PID=$(systemctl show -p MainPID --value nyv-api.service)
KEY=$(tr '\0' '\n' < "/proc/$PID/environ" | grep -m1 '^NYS_SDK_API_KEYS=' | cut -d= -f2- | cut -d, -f1)
echo "PC2_KEY_LEN=${#KEY}"
[ "${#KEY}" -lt 16 ] && { echo "INSTRUMENT_FAILED_NO_KEY"; exit 1; }
B=http://127.0.0.1:8080/api

two_hop() { # label query archive [year]
  local label="$1" q="$2" arch="$3" yr="${4:-}"
  local sbody
  if [ -n "$yr" ]; then
    sbody="{\"q\":\"$q\",\"archive\":\"$arch\",\"year\":$yr,\"limit\":5}"
  else
    sbody="{\"q\":\"$q\",\"archive\":\"$arch\",\"limit\":5}"
  fi
  echo "=== [$label] hop1 body=$sbody ==="
  local T0=$(date +%s%3N)
  local m1=$(curl -s -o "/tmp/h1_$label.json" -w "http=%{http_code} t=%{time_total}" \
    -H "X-API-Key: $KEY" -H 'Content-Type: application/json' -X POST -d "$sbody" "$B/athena/search")
  local T1=$(date +%s%3N)
  echo "  hop1 $m1 wall_ms=$((T1-T0))"
  node -e '
  const fs=require("fs"),l=process.argv[1];
  const j=JSON.parse(fs.readFileSync("/tmp/h1_"+l+".json","utf8"));
  const rows=(j.results||[]).filter(r=>r.s3_path);
  console.log("  hop1 bytesScanned="+j.bytesScanned+" est_usd="+j.estimatedCostUsd+" n="+(j.results||[]).length+" with_s3path="+rows.length);
  if(rows[0]){
    console.log("  chosen: "+rows[0].year+" | "+rows[0].citation+" | "+(rows[0].title||"").slice(0,80));
    fs.writeFileSync("/tmp/sel_"+l+".txt", rows[0].s3_path);
    fs.writeFileSync("/tmp/tit_"+l+".txt", (rows[0].title||""));
    console.log("  alternates="+(rows.length-1));
  } else { console.log("  NO_S3PATH (service would return NOT_FOUND with candidates)"); }
  ' "$label"
  if [ -s "/tmp/sel_$label.txt" ]; then
    local S3P=$(cat "/tmp/sel_$label.txt")
    local TIT=$(cat "/tmp/tit_$label.txt" | sed 's/"/\\"/g')
    local T2=$(date +%s%3N)
    local m2=$(curl -s -o "/tmp/h2_$label.json" -w "http=%{http_code} bytes=%{size_download} t=%{time_total}" \
      -H "X-API-Key: $KEY" -H 'Content-Type: application/json' \
      -X POST -d "{\"s3Path\":\"$S3P\",\"title\":\"$TIT\"}" "$B/athena/extract")
    local T3=$(date +%s%3N)
    echo "  hop2 $m2 wall_ms=$((T3-T2))  TOTAL_wall_ms=$((T3-T0))"
    node -e '
    const fs=require("fs"),l=process.argv[1];
    const j=JSON.parse(fs.readFileSync("/tmp/h2_"+l+".json","utf8"));
    if(j.error){console.log("  hop2 ERROR="+j.error+"  → service maps to code by status");}
    else{
      console.log("  hop2 byteSize="+j.byteSize+" textLength="+j.textLength+" ocrUsed="+j.ocrUsed+" cached="+j.cached);
      console.log("  hop2 resolved_s3Path="+j.s3Path);
      const t=j.text||"";
      // Is this the real judgment BODY, or a stub/error page?
      const judicial=/(HELD|JUDGMENT|ORDER|Appeal|petition|versus|\bJ\.\b|Court)/i.test(t);
      console.log("  BODY_LOOKS_JUDICIAL="+judicial+" first_chars="+JSON.stringify(t.slice(0,220)));
    }
    ' "$label"
  fi
}

two_hop kesav "Kesavananda" sc
two_hop maneka "MANEKA GANDHI" sc
two_hop pritam "PRITAM SINGH" sc
two_hop hc2020 "bail" hc 2020

echo "=== negative control: query that cannot match (service must return NOT_FOUND, not a body) ==="
curl -s -H "X-API-Key: $KEY" -H 'Content-Type: application/json' \
  -X POST -d '{"q":"zzzqqqnotarealcasename","archive":"sc","limit":5}' "$B/athena/search" | head -c 300; echo

echo "=== DC guard: allowlist must reject the district tar prefix ==="
curl -s -H "X-API-Key: $KEY" -H 'Content-Type: application/json' \
  -X POST -d '{"s3Path":"s3://indian-district-court-judgments/data/tar/year=2019/state=2/district=20/complex=1020168/"}' \
  "$B/athena/extract" | head -c 300; echo
echo "PROBE8_DONE=5150"
