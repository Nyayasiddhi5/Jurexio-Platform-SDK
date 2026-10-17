#!/usr/bin/env python3
"""Apply R-SCHEMA-B residual SQL on nysdev via S3 + SSM (no secret echo)."""
from __future__ import annotations

import json
import subprocess
import sys
import time
from pathlib import Path

INSTANCE = "i-0df71e5ea1df8f588"
REGION = "ap-south-1"
BUCKET = "nyayavigya-sdk-devapp"
ROOT = Path(__file__).resolve().parents[1]
SQL = ROOT / "migrations" / "2026-07-31-r-schema-b-residual.sql"


def run(cmd: list[str]) -> str:
    return subprocess.check_output(cmd, text=True).strip()


def main() -> int:
    if not SQL.exists():
        print("missing", SQL, file=sys.stderr)
        return 2
    stamp = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
    key = f"ops/r-schema-b-residual-{stamp}.sql"
    run(["aws", "s3", "cp", str(SQL), f"s3://{BUCKET}/{key}", "--region", REGION])
    print("uploaded", f"s3://{BUCKET}/{key}")

    node_apply = (
        "const {Client}=require('pg');const fs=require('fs');"
        "(async()=>{const u=process.env.DATABASE_URL;if(!u)throw new Error('no DATABASE_URL');"
        "const c=new Client({connectionString:u,ssl:{rejectUnauthorized:false}});"
        "await c.connect();await c.query(fs.readFileSync('/tmp/r-schema-b-residual.sql','utf8'));"
        "const r=await c.query(\"select to_regclass('nv_schema.nv_rag_coverage_audit')::text as rag,"
        " to_regclass('nv_schema.nv_bipa_consent_records')::text as bipa,"
        " to_regclass('nv_schema.nv_digital_twins')::text as twin,"
        " to_regclass('nv_schema.nv_biometric_artefacts')::text as bio\");"
        "console.log(JSON.stringify(r.rows[0]));await c.end();"
        "})().catch(e=>{console.error(e);process.exit(1);});"
    )
    commands = [
        "bash -lc " + json.dumps(
            " && ".join(
                [
                    "set -euo pipefail",
                    f"aws s3 cp s3://{BUCKET}/{key} /tmp/r-schema-b-residual.sql",
                    "docker cp /tmp/r-schema-b-residual.sql nyv-gateway:/tmp/r-schema-b-residual.sql",
                    f"docker exec nyv-gateway node -e {json.dumps(node_apply)}",
                ]
            )
        )
    ]
    payload = {
        "DocumentName": "AWS-RunShellScript",
        "InstanceIds": [INSTANCE],
        "Parameters": {"commands": commands},
        "TimeoutSeconds": 180,
    }
    tmp = Path("/tmp/ssm-schema-b.json")
    tmp.write_text(json.dumps(payload))
    cmd_id = run(
        [
            "aws",
            "ssm",
            "send-command",
            "--cli-input-json",
            f"file://{tmp}",
            "--region",
            REGION,
            "--query",
            "Command.CommandId",
            "--output",
            "text",
        ]
    )
    print("SSM", cmd_id)
    for i in range(36):
        time.sleep(5)
        st = run(
            [
                "aws",
                "ssm",
                "get-command-invocation",
                "--command-id",
                cmd_id,
                "--instance-id",
                INSTANCE,
                "--region",
                REGION,
                "--query",
                "Status",
                "--output",
                "text",
            ]
        )
        print(f"try={i+1} status={st}")
        if st not in ("Pending", "InProgress", "Delayed"):
            out = run(
                [
                    "aws",
                    "ssm",
                    "get-command-invocation",
                    "--command-id",
                    cmd_id,
                    "--instance-id",
                    INSTANCE,
                    "--region",
                    REGION,
                    "--query",
                    "StandardOutputContent",
                    "--output",
                    "text",
                ]
            )
            err = run(
                [
                    "aws",
                    "ssm",
                    "get-command-invocation",
                    "--command-id",
                    cmd_id,
                    "--instance-id",
                    INSTANCE,
                    "--region",
                    REGION,
                    "--query",
                    "StandardErrorContent",
                    "--output",
                    "text",
                ]
            )
            print(out)
            if err and err != "None":
                print("ERR:", err, file=sys.stderr)
            return 0 if st == "Success" else 1
    print("timeout", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
