#!/usr/bin/env python3
"""Runs ON the EC2 host. Applies residual SQL using RDS master secret. Never prints secrets."""
import json
import os
import subprocess
import sys

SQL_PATH = "/tmp/r-schema-b-residual.sql"


def main() -> int:
    if not os.path.exists(SQL_PATH):
        print("missing", SQL_PATH, file=sys.stderr)
        return 2
    subprocess.run(
        [
            "bash",
            "-lc",
            "command -v psql >/dev/null 2>&1 || (sudo DEBIAN_FRONTEND=noninteractive apt-get update -qq && sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq postgresql-client)",
        ],
        check=False,
    )
    secret = subprocess.check_output(
        [
            "aws",
            "secretsmanager",
            "get-secret-value",
            "--secret-id",
            "nyv-dev-edge-pg/rds/master",
            "--region",
            "ap-south-1",
            "--query",
            "SecretString",
            "--output",
            "text",
        ],
        text=True,
    )
    d = json.loads(secret)
    user = d.get("username") or d.get("user") or "postgres"
    password = d.get("password") or d.get("Password") or ""
    host = d.get("host") or d.get("hostname") or ""
    db = d.get("dbname") or d.get("database") or "nyayavigya"
    port = str(d.get("port") or 5432)
    if not host:
        host = subprocess.check_output(
            [
                "docker",
                "exec",
                "nyv-gateway",
                "node",
                "-e",
                "const u=process.env.DATABASE_URL||'';const m=u.match(/@([^:/]+)/);process.stdout.write(m?m[1]:'')",
            ],
            text=True,
        ).strip()
    print("applying_as", user, "host", host, "db", db, "pass_set", bool(password))
    if not host or not password:
        print("secret_keys", sorted(d.keys()), file=sys.stderr)
        return 2
    env = os.environ.copy()
    env["PGPASSWORD"] = password
    r = subprocess.run(
        [
            "psql",
            "-h",
            host,
            "-p",
            port,
            "-U",
            user,
            "-d",
            db,
            "-v",
            "ON_ERROR_STOP=1",
            "-f",
            SQL_PATH,
        ],
        env=env,
        capture_output=True,
        text=True,
    )
    sys.stdout.write(r.stdout)
    if r.returncode != 0:
        sys.stderr.write(r.stderr)
        return r.returncode
    r2 = subprocess.run(
        [
            "psql",
            "-h",
            host,
            "-p",
            port,
            "-U",
            user,
            "-d",
            db,
            "-c",
            "select to_regclass('nv_schema.nv_rag_coverage_audit') as rag, to_regclass('nv_schema.nv_bipa_consent_records') as bipa, to_regclass('nv_schema.nv_digital_twins') as twin, to_regclass('nv_schema.nv_biometric_artefacts') as bio;",
        ],
        env=env,
        capture_output=True,
        text=True,
    )
    sys.stdout.write(r2.stdout or r2.stderr)
    return r2.returncode


if __name__ == "__main__":
    raise SystemExit(main())
