#!/usr/bin/env bash
# Probe 6: per-court-tier full-text extraction, measuring real latency, payload
# size, cache behaviour, and whether the returned text is the judgment BODY.
# SC target Kesavananda failed the 20MB cap in probe 5 (35.8MB) — retest with
# Maneka Gandhi (SC), a real HC file, and a DC attempt.
set -uo pipefail
echo "PC1_ECHO=5150"
PID=$(systemctl show -p MainPID --value nyv-api.service)
KEY=$(tr '\0' '\n' < "/proc/$PID/environ" | grep -m1 '^NYS_SDK_API_KEYS=' | cut -d= -f2- | cut -d, -f1)
echo "PC2_KEY_LEN=${#KEY}"
[ "${#KEY}" -lt 16 ] && { echo "INSTRUMENT_FAILED_NO_KEY"; exit 1; }
B=http://127.0.0.1:8080/api

asearch() { # label json
  curl -s -o "/tmp/as_$1.json" -w "http=%{http_code} t=%{time_total}" \
    -H "X-API-Key: $KEY" -H 'Content-Type: application/json' \
    -X POST -d "$2" "$B/athena/search"
}

extract() { # label s3path
  local label="$1" s3p="$2"
  local T0=$(date +%s%3N)
  local m=$(curl -s -o "/tmp/ex_$label.json" -w "http=%{http_code} bytes=%{size_download} t=%{time_total}" \
    -H "X-API-Key: $KEY" -H 'Content-Type: application/json' \
    -X POST -d "{\"s3Path\":\"$s3p\"}" "$B/athena/extract")
  local T1=$(date +%s%3N)
  echo "### EXTRACT[$label] $m wall_ms=$((T1-T0))"
  node -e '
  const fs=require("fs"), f=process.argv[1];
  try{ const j=JSON.parse(fs.readFileSync(f,"utf8"));
    if(j.error){console.log("  ERROR="+j.error);}
    else{
      console.log("  s3Path="+j.s3Path);
      console.log("  byteSize="+j.byteSize+" textLength="+j.textLength+" ocrUsed="+j.ocrUsed+" cached="+j.cached);
      const t=(j.text||"");
      console.log("  --- head 700 ---"); console.log(t.slice(0,700).replace(/\n/g," | "));
      console.log("  --- tail 300 ---"); console.log(t.slice(-300).replace(/\n/g," | "));
    }
  }catch(e){console.log("  PARSE_ERR="+e.message);}
  ' "/tmp/ex_$label.json"
}

echo "=== 1. SC: Maneka Gandhi (1978) via Athena ==="
echo "$(asearch sc_maneka '{"q":"MANEKA GANDHI","archive":"sc","limit":5}')"
node -e '
const fs=require("fs");const j=JSON.parse(fs.readFileSync("/tmp/as_sc_maneka.json","utf8"));
console.log("bytesScanned="+j.bytesScanned+" est_usd="+j.estimatedCostUsd+" n="+(j.results||[]).length);
(j.results||[]).forEach(r=>console.log("  "+r.year+" | "+r.citation+" | "+r.title+" | "+r.s3_path));
if(j.results&&j.results[0])fs.writeFileSync("/tmp/p_sc.txt",j.results[0].s3_path);'
[ -s /tmp/p_sc.txt ] && extract sc_maneka "$(cat /tmp/p_sc.txt)"

echo "=== 1b. SC: a short 1950 judgment (small PDF, should extract cleanly) ==="
echo "$(asearch sc_1950 '{"q":"versus","archive":"sc","year":1950,"limit":5}')"
node -e '
const fs=require("fs");const j=JSON.parse(fs.readFileSync("/tmp/as_sc_1950.json","utf8"));
console.log("bytesScanned="+j.bytesScanned+" est_usd="+j.estimatedCostUsd+" n="+(j.results||[]).length);
(j.results||[]).forEach(r=>console.log("  "+r.year+" | "+r.citation+" | "+(r.title||"").slice(0,70)+" | "+r.s3_path));
if(j.results&&j.results[0])fs.writeFileSync("/tmp/p_sc50.txt",j.results[0].s3_path);'
[ -s /tmp/p_sc50.txt ] && extract sc_1950 "$(cat /tmp/p_sc50.txt)"

echo "=== 1c. CACHE re-fetch of the same SC path (expect cached=true, fast) ==="
[ -s /tmp/p_sc50.txt ] && extract sc_1950_again "$(cat /tmp/p_sc50.txt)"

echo "=== 2. HC full text ==="
echo "$(asearch hc '{"q":"bail","archive":"hc","year":2020,"limit":3}')"
node -e '
const fs=require("fs");const j=JSON.parse(fs.readFileSync("/tmp/as_hc.json","utf8"));
console.log("bytesScanned="+j.bytesScanned+" est_usd="+j.estimatedCostUsd+" n="+(j.results||[]).length);
(j.results||[]).forEach(r=>console.log("  "+r.year+" | cit="+r.citation+" | "+(r.title||"").slice(0,60)+" | "+r.s3_path));
if(j.results&&j.results[0])fs.writeFileSync("/tmp/p_hc.txt",j.results[0].s3_path);'
[ -s /tmp/p_hc.txt ] && extract hc "$(cat /tmp/p_hc.txt)"

echo "=== 3. HC without year filter — COST probe (is it an unpartitioned scan?) ==="
echo "$(asearch hc_noyear '{"q":"anticipatory bail","archive":"hc","limit":3}')"
node -e '
const fs=require("fs");const j=JSON.parse(fs.readFileSync("/tmp/as_hc_noyear.json","utf8"));
console.log("HC_NOYEAR bytesScanned="+j.bytesScanned+" est_usd="+j.estimatedCostUsd+" n="+(j.results||[]).length+" err="+(j.error||"none"));'

echo "=== 4. DC: is there any Athena table / s3 path for district courts? ==="
echo "$(asearch dc '{"q":"district","archive":"all","limit":3}')"
head -c 500 /tmp/as_dc.json; echo
echo "--- DC pdf_link shape from RDS is a PREFIX (tar dir), not a .pdf key. Test the guard: ---"
curl -s -o /tmp/dc_doc.json -w "http=%{http_code}\n" -H "X-API-Key: $KEY" \
  "$B/athena/document?s3Path=s3://indian-district-court-judgments/data/tar/year=2020/state=1/district=1/complex=1/"
head -c 300 /tmp/dc_doc.json; echo

echo "PROBE6_DONE=5150"
