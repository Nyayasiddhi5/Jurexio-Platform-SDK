#!/usr/bin/env python3
import json, os, urllib.request

def load_key():
    for line in open("/opt/nyv/api/.env"):
        if line.startswith("NYS_KNOWLEDGE_API_KEY="):
            return line.split("=", 1)[1].strip().strip('"').strip("'")

key = load_key()
bodies = [
    ("RJHC default", {"cnr": "RJHC010324382023", "options": {"includeDocuments": False}}),
    ("RJHC caseCreate", {"cnr": "RJHC010324382023", "options": {"profile": "caseCreate", "includeDocuments": False}}),
    ("TSWL dc", {"cnr": "TSWL000000742024", "options": {"includeDocuments": False}}),
    ("TSWL not_found", {"cnr": "TSWL010000012024", "options": {"includeDocuments": False}}),
]
for label, body in bodies:
    req = urllib.request.Request(
        "http://127.0.0.1:8080/api/cnr/resolve",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "X-API-Key": key},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=90) as resp:
            d = json.loads(resp.read().decode())
            data = d.get("data") or {}
            print(label, "http", resp.status, "success", d.get("success"), "status", data.get("status"),
                  "source", data.get("source"), "sourcesTried", data.get("sourcesTried"),
                  "caseCreate", "yes" if data.get("caseCreate") else "no", "err", d.get("error"))
    except urllib.error.HTTPError as e:
        d = json.loads(e.read().decode())
        print(label, "http", e.code, "err", d.get("error"))
