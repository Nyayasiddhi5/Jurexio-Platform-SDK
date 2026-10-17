#!/usr/bin/env python3
"""Neural nDCG soak on nysdev gateway (COHERE/CROSS_ENCODER already present)."""
from __future__ import annotations

import json
import subprocess
import sys
import time
from pathlib import Path

INSTANCE = "i-0df71e5ea1df8f588"
REGION = "ap-south-1"


def run(cmd: list[str]) -> str:
    return subprocess.check_output(cmd, text=True).strip()


def main() -> int:
    commands = [
        "bash -lc "
        + json.dumps(
            "set -euo pipefail; docker exec -e NYV_NDCG_REQUIRE_NEURAL=1 -e NYV_NDCG_MIN_DELTA=0 nyv-gateway sh -lc 'cd /app && npm run rag:ndcg'"
        )
    ]
    payload = {
        "DocumentName": "AWS-RunShellScript",
        "InstanceIds": [INSTANCE],
        "Parameters": {"commands": commands},
        "TimeoutSeconds": 300,
    }
    tmp = Path("/tmp/ssm-ndcg.json")
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
    for i in range(48):
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
            print(out[-4000:] if len(out) > 4000 else out)
            if err and err != "None":
                print("ERR:", err[-2000:], file=sys.stderr)
            return 0 if st == "Success" else 1
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
