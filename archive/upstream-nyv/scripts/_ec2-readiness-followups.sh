#!/bin/sh
# Two follow-ups from the readiness sweep. Do NOT assume: read the bodies.
#  (1) docs summarize returned 400 — is it a required-field contract, or a break?
#  (2) legal NER returned 270 bytes in 44ms — too fast for an LLM. Real or a stub?
CANON=/opt/Nyayavigya/secrets/.env.production
K=`grep -E '^NYV_SDK_KEY_NSP=' "$CANON" | head -1 | cut -d= -f2- | tr -d '"' | tr -d "\r\n"`
if [ `printf %s "$K" | wc -c` -lt 16 ]; then echo "PROBE BROKEN"; exit 3; fi
B=https://api.nyayasiddhi.online
HDR='-H "Content-Type: application/json"'

echo "=== 1a. docs summarize with {text} — the 400 body verbatim ==="
curl -sS -m 60 -X POST -H "X-API-Key: $K" -H "X-NYV-Platform: nsp" -H "X-NYV-Consent: granted" \
  -H "Content-Type: application/json" \
  -d '{"text":"Agreement between A and B, Rs 50 lakh, 24 months.","jurisdiction":"IN"}' \
  "$B/api/jrx/sdk/docs-pipeline/documents/summarize"; echo

echo "=== 1b. same call with {content} instead of {text} ==="
curl -sS -m 120 -o /tmp/s2.json -w "http=%{http_code} t=%{time_total}s bytes=%{size_download}\n" -X POST \
  -H "X-API-Key: $K" -H "X-NYV-Platform: nsp" -H "X-NYV-Consent: granted" \
  -H "Content-Type: application/json" \
  -d '{"content":"Agreement between A and B for supply of goods worth Rs 50 lakh, term 24 months, governed by Indian law. Disputes to arbitration at Hyderabad.","jurisdiction":"IN"}' \
  "$B/api/jrx/sdk/docs-pipeline/documents/summarize"
head -c 400 /tmp/s2.json; echo

echo "=== 1c. and with {documentText} ==="
curl -sS -m 120 -o /tmp/s3.json -w "http=%{http_code} t=%{time_total}s bytes=%{size_download}\n" -X POST \
  -H "X-API-Key: $K" -H "X-NYV-Platform: nsp" -H "X-NYV-Consent: granted" \
  -H "Content-Type: application/json" \
  -d '{"documentText":"Agreement between A and B for supply of goods worth Rs 50 lakh, term 24 months.","jurisdiction":"IN"}' \
  "$B/api/jrx/sdk/docs-pipeline/documents/summarize"
head -c 300 /tmp/s3.json; echo

echo "=== 2. legal NER — full body (44ms is too fast for an LLM) ==="
curl -sS -m 60 -o /tmp/ner.json -w "http=%{http_code} t=%{time_total}s\n" -X POST \
  -H "X-API-Key: $K" -H "X-NYV-Platform: nsp" -H "X-NYV-Consent: granted" \
  -H "Content-Type: application/json" \
  -d '{"text":"Ram Kumar filed a petition under BNSS 482 before the Telangana High Court on 12 March 2025 against Meridian Textiles Pvt Ltd for Rs 47,00,000.","jurisdiction":"IN"}' \
  "$B/api/jrx/intelligence/legal-ner"
cat /tmp/ner.json; echo
python3 - <<'PY'
import json
try:
    d = json.load(open('/tmp/ner.json'))
except Exception as e:
    print('NER body not JSON:', e); raise SystemExit
data = d.get('data') if isinstance(d, dict) else None
print('VERDICT: entities found =', 0 if not data else (len(data) if isinstance(data, list) else
      sum(len(v) for v in data.values() if isinstance(v, list))))
PY
