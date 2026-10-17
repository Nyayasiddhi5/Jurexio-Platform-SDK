#!/usr/bin/env python3
import json, subprocess

def key():
    for line in open("/opt/nyv/api/.env"):
        for k in ("NYS_KNOWLEDGE_API_KEY=", "NYS_SDK_API_KEYS="):
            if line.startswith(k):
                return line.split("=", 1)[1].strip().strip('"').split(",")[0]
    return ""

k = key()
body = json.dumps({"cnr": "RJHC010324382023", "options": {"profile": "caseCreate", "includeDocuments": False}})
r = subprocess.run(["curl","-sS","-m","90","-w","\nhttp_code=%{http_code} time=%{time_total}s","-X","POST",
    "-H","Content-Type: application/json","-H",f"X-API-Key: {k}","-d",body,
    "http://127.0.0.1:8080/api/cnr/resolve"], capture_output=True, text=True)
lines = r.stdout.strip().split("\n")
meta = lines[-1] if lines else ""
raw = "\n".join(lines[:-1])
try:
    d = json.loads(raw)
    data = d.get("data") or {}
    cc = data.get("caseCreate") or {}
    print("success", d.get("success"), "status", data.get("status"), "source", data.get("source"))
    print("sourcesTried", data.get("sourcesTried"))
    print("caseCreate", "yes" if cc else "no", "timeline", len(cc.get("timeline") or []))
    print("err", d.get("error"))
except Exception as e:
    print("parse_err", e, raw[:300])
print(meta)
