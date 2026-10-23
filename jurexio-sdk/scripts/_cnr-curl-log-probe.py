#!/usr/bin/env python3
import json, subprocess, re

def key():
    for line in open("/opt/nyv/api/.env"):
        for k in ("NYS_KNOWLEDGE_API_KEY=", "NYS_SDK_API_KEYS="):
            if line.startswith(k):
                return line.split("=", 1)[1].strip().strip('"').split(",")[0]
    return ""

k = key()
print("KEY_LEN", len(k))
for cnr in ["RJHC010324382023", "TSWL000000742024"]:
    r = subprocess.run(
        ["curl", "-sS", "-m", "60", "-X", "POST",
         "-H", "Content-Type: application/json",
         "-H", f"X-API-Key: {k}",
         "-d", json.dumps({"cnr": cnr, "options": {"includeDocuments": False}}),
         "http://127.0.0.1:8080/api/cnr/resolve"],
        capture_output=True, text=True,
    )
    try:
        d = json.loads(r.stdout)
        data = d.get("data") or {}
        print(cnr, "curl", "success=", d.get("success"), "status=", data.get("status"),
              "source=", data.get("source"), "err=", d.get("error"))
    except Exception:
        print(cnr, "raw", r.stdout[:200])

log = subprocess.check_output(
    "journalctl -u nyv-api --no-pager -n 5 2>/dev/null | grep cnr | tail -2",
    shell=True, text=True,
)
print("LOG", log.strip())
