#!/usr/bin/env python3
import json, urllib.request

def read_key(path, name):
    for line in open(path):
        if line.startswith(name + "="):
            return line.split("=", 1)[1].strip().strip('"').strip("'")

key = read_key("/opt/Nyayavigya/secrets/.env.production", "NYV_SDK_KEY_NSP")
tests = [
    ("RJHC caseCreate", {"cnr": "RJHC010324382023", "options": {"profile": "caseCreate", "includeDocuments": False}, "claimEcourts": False}),
    ("TSWL dc", {"cnr": "TSWL000000742024", "claimEcourts": False}),
    ("TSWL not_found", {"cnr": "TSWL010000012024", "claimEcourts": False}),
]
for label, body in tests:
    req = urllib.request.Request(
        "https://api.nyayasiddhi.online/api/nv/v1/sdk/cnr/resolve",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "X-API-Key": key},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=90) as resp:
            d = json.loads(resp.read().decode())
            inner = d.get("data") if isinstance(d.get("data"), dict) else d
            cc = inner.get("caseCreate")
            print(label, "http", resp.status, "success", d.get("success"), "status", inner.get("status"),
                  "source", inner.get("source"), "sourcesTried", inner.get("sourcesTried"),
                  "caseCreate", "yes" if cc else "no", "err", d.get("error"))
    except urllib.error.HTTPError as e:
        d = json.loads(e.read().decode())
        print(label, "http", e.code, "err", d.get("error"))
