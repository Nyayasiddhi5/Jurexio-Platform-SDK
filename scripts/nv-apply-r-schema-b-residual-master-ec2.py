#!/usr/bin/env python3
"""Apply R-SCHEMA-B residual DDL using RDS master secret on EC2 (values never printed)."""
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


def aws(*args: str) -> str:
    return subprocess.check_output(["aws", *args], text=True).strip()


def wait_ssm(cmd_id: str) -> tuple[str, str, str]:
    for i in range(48):
        time.sleep(5)
        st = aws(
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
        )
        print(f"try={i+1} status={st}")
        if st not in ("Pending", "InProgress", "Delayed"):
            out = aws(
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
            )
            err = aws(
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
            )
            return st, out, err
    return "Timeout", "", "timeout"


def send(commands: list[str], timeout: int = 300) -> str:
    payload = {
        "DocumentName": "AWS-RunShellScript",
        "InstanceIds": [INSTANCE],
        "TimeoutSeconds": timeout,
        "Parameters": {"commands": commands},
    }
    tmp = Path("/tmp/ssm-schema-master.json")
    tmp.write_text(json.dumps(payload))
    return aws(
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
    )


def main() -> int:
    if not SQL.exists():
        print("missing", SQL, file=sys.stderr)
        return 2
    stamp = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
    key = f"ops/r-schema-b-residual-{stamp}.sql"
    aws("s3", "cp", str(SQL), f"s3://{BUCKET}/{key}", "--region", REGION)
    print("uploaded", f"s3://{BUCKET}/{key}")

    # Remote script: load master secret on box, apply with psql, print only regclass checks
    remote = f"""
set -euo pipefail
aws s3 cp s3://{BUCKET}/{key} /tmp/r-schema-b-residual.sql
command -v psql >/dev/null 2>&1 || sudo DEBIAN_FRONTEND=noninteractive apt-get update -qq && sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq postgresql-client
python3 <<'PY'
import json, os, subprocess, sys
secret = subprocess.check_output(
  ['aws','secretsmanager','get-secret-value','--secret-id','nyv-dev-edge-pg/rds/master','--region','ap-south-1','--query','SecretString','--output','text'],
  text=True,
)
d = json.loads(secret)
user = d.get('username') or d.get('user') or 'postgres'
password = d.get('password') or d.get('Password') or ''
host = d.get('host') or d.get('hostname') or ''
db = d.get('dbname') or d.get('database') or d.get('dbInstanceIdentifier') or 'nyayavigya'
port = str(d.get('port') or 5432)
if not host:
  # fallback: parse from gateway DATABASE_URL host
  host = subprocess.check_output(
    ['docker','exec','nyv-gateway','node','-e',"const u=process.env.DATABASE_URL||'';const m=u.match(/@([^:/]+)/);process.stdout.write(m?m[1]:'')"],
    text=True,
  ).strip()
if not host or not password:
  print('missing host or password fields in secret shape; keys=', sorted(d.keys()), file=sys.stderr)
  sys.exit(2)
print('applying as', user, '@', host, '/', db)
env = os.environ.copy()
env['PGPASSWORD'] = password
r = subprocess.run(
  ['psql','-h',host,'-p',port,'-U',user,'-d',db,'-v','ON_ERROR_STOP=1','-f','/tmp/r-schema-b-residual.sql'],
  env=env, capture_output=True, text=True,
)
sys.stdout.write(r.stdout)
if r.returncode != 0:
  sys.stderr.write(r.stderr)
  sys.exit(r.returncode)
r2 = subprocess.run(
  ['psql','-h',host,'-p',port,'-U',user,'-d',db,'-c',
   "select to_regclass('nv_schema.nv_rag_coverage_audit') as rag, to_regclass('nv_schema.nv_bipa_consent_records') as bipa, to_regclass('nv_schema.nv_digital_twins') as twin, to_regclass('nv_schema.nv_biometric_artefacts') as bio;"],
  env=env, capture_output=True, text=True,
)
sys.stdout.write(r2.stdout or r2.stderr)
sys.exit(r2.returncode)
PY
"""
    cmd_id = send(["bash -lc " + json.dumps(remote)])
    print("SSM", cmd_id)
    st, out, err = wait_ssm(cmd_id)
    print(out[-4000:] if len(out) > 4000 else out)
    if err and err.strip() not in ("", "None"):
        # scrub possible secret leaks
        scrubbed = err
        for token in ("password", "PWD", "PGPASSWORD"):
            if token.lower() in scrubbed.lower():
                scrubbed = "[redacted stderr]"
                break
        print("ERR:", scrubbed[-1500:], file=sys.stderr)
    return 0 if st == "Success" else 1


if __name__ == "__main__":
    raise SystemExit(main())
