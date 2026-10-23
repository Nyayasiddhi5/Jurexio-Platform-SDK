#!/usr/bin/env python3
"""Live CNR probe — no secret values in stdout."""
import json
import os
import re
import subprocess
import sys
import urllib.request

CNRS = [
    ("RJHC010324382023", "caseCreate"),
    ("RJHC010324382023", "default"),
    ("TSWL000000742024", "default"),
    ("TSWL010000012024", "default"),
]


def read_key_from_env_file(path: str, key: str) -> str:
    with open(path, encoding="utf-8") as f:
        for line in f:
            if line.startswith(f"{key}="):
                return line.split("=", 1)[1].strip().strip('"').strip("'").strip("\r\n")
    return ""


def curl_json(url: str, body: dict, headers: dict, timeout: int = 90):
    data = json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        raw = e.read().decode(errors="replace")
        try:
            return e.code, json.loads(raw)
        except json.JSONDecodeError:
            return e.code, {"error": raw[:200]}
    except Exception as e:
        return 0, {"error": str(e)}


def probe_nyv(api_key: str):
    api = "https://api.nyayasiddhi.online"
    print(f"=== NYV GATEWAY {api} ===")
    for cnr, prof in CNRS:
        body = {"cnr": cnr, "claimEcourts": False}
        if prof == "caseCreate":
            body["options"] = {"profile": "caseCreate", "includeDocuments": False}
        code, d = curl_json(
            f"{api}/api/nv/v1/sdk/cnr/resolve",
            body,
            {"Content-Type": "application/json", "X-API-Key": api_key},
        )
        inner = d.get("data") if isinstance(d.get("data"), dict) else d
        cc = inner.get("caseCreate") if inner else None
        print(
            f"NYV|{cnr}|{prof}|http={code}|success={d.get('success')}|status={inner.get('status') if inner else None}|"
            f"source={inner.get('source') if inner else None}|sourcesTried={inner.get('sourcesTried') if inner else None}|"
            f"matched={inner.get('matched') if inner else None}|found={inner.get('found') if inner else None}|"
            f"courtType={inner.get('courtType') if inner else None}|sourceArchive={inner.get('sourceArchive') if inner else None}|"
            f"caseCreate={'yes' if cc else 'no'}|timeline={len(cc.get('timeline') or []) if cc else 0}|"
            f"claimEcourts={inner.get('claimEcourts') if inner else None}|err={d.get('error') or (inner or {}).get('message')}"
        )


def probe_nys(api_key: str):
    api = "http://127.0.0.1:8080"
    print(f"=== NYS WORKER {api} ===")
    for cnr, prof in CNRS:
        body = {"cnr": cnr}
        if prof == "caseCreate":
            body["options"] = {"profile": "caseCreate", "includeDocuments": False}
        code, d = curl_json(
            f"{api}/api/cnr/resolve",
            body,
            {"Content-Type": "application/json", "X-API-Key": api_key},
        )
        inner = d.get("data") if isinstance(d.get("data"), dict) else d
        cc = inner.get("caseCreate") if inner else None
        print(
            f"NYS|{cnr}|{prof}|http={code}|success={d.get('success')}|status={inner.get('status') if inner else None}|"
            f"source={inner.get('source') if inner else None}|sourcesTried={inner.get('sourcesTried') if inner else None}|"
            f"caseCreate={'yes' if cc else 'no'}|timeline={len(cc.get('timeline') or []) if cc else 0}|"
            f"err={d.get('error')}"
        )


def probe_rds():
    print("=== RDS DIRECT ===")
    db_url = os.environ.get("DATABASE_URL", "")
    if not db_url:
        print("RDS|skip|no DATABASE_URL")
        return
    try:
        import psycopg2
    except ImportError:
        print("RDS|skip|no psycopg2")
        return
    cnrs = ["RJHC010324382023", "TSWL000000742024", "TSWL010000012024"]
    conn = psycopg2.connect(db_url, sslmode="require")
    cur = conn.cursor()
    for cnr in cnrs:
        cur.execute("SELECT id, court_type, title FROM judgments WHERE cnr = %s LIMIT 1", (cnr,))
        j = cur.fetchone()
        cur.execute("SELECT cnr FROM cnr_case_details WHERE cnr = %s LIMIT 1", (cnr,))
        d = cur.fetchone()
        print(
            f"RDS|{cnr}|judgments={1 if j else 0}|cnr_case_details={1 if d else 0}|"
            f"court={j[1] if j else ''}|title={(j[2] or '')[:50] if j else ''}"
        )
    cur.close()
    conn.close()


def probe_athena_env():
    print("=== ATHENA ENV ===")
    for k in [
        "ATHENA_TABLE_HC_CASE_DETAILS",
        "ATHENA_TABLE_HC",
        "ATHENA_DATABASE",
        "ATHENA_TABLE",
        "ATHENA_OUTPUT_S3",
    ]:
        print(f"ENV|{k}={os.environ.get(k, 'unset')}")


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "nyv"
    if mode == "nyv":
        canon = "/opt/Nyayavigya/secrets/.env.production"
        key = read_key_from_env_file(canon, "NYV_SDK_KEY_NSP")
        if not key:
            print("ERROR|no NYV_SDK_KEY_NSP")
            sys.exit(1)
        probe_nyv(key)
    elif mode == "nys":
        env_path = "/opt/nyv/api/.env"
        if os.path.isfile(env_path):
            for line in open(env_path, encoding="utf-8"):
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    os.environ.setdefault(k, v.strip().strip('"').strip("'"))
        key = os.environ.get("NYS_KNOWLEDGE_API_KEY") or (os.environ.get("NYS_SDK_API_KEYS") or "").split(",")[0]
        if not key:
            print("ERROR|no NYS API key")
            sys.exit(1)
        probe_athena_env()
        probe_nys(key)
        probe_rds()
    else:
        print(f"unknown mode {mode}")
        sys.exit(1)


if __name__ == "__main__":
    main()
