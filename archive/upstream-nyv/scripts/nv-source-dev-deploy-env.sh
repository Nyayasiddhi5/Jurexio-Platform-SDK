#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKSPACE_ROOT="$(cd "$APP_ROOT/.." && pwd)"
PROD_ENV="$WORKSPACE_ROOT/product Documents/env.production"
SECRETS_DIR="$WORKSPACE_ROOT/.local/secrets"

# Keep files stored here at chmod 600 per AGENTS.md.

mkdir -p "$SECRETS_DIR"
chmod 700 "$SECRETS_DIR" 2>/dev/null || true

load_exact_keys() {
  local env_file="$1"
  shift
  [ -f "$env_file" ] || return 0
  # Windows Python needs a Windows path; Git Bash provides wslpath/cygpath.
  local win_env_file
  win_env_file="$(wslpath -w "$env_file" 2>/dev/null || echo "$env_file")"

  eval "$(python3 - "$win_env_file" "$@" <<'PY2'
import pathlib
import shlex
import sys

path = pathlib.Path(sys.argv[1])
keys = sys.argv[2:]
text = path.read_text().replace('\r', '')
values = {}
for raw_line in text.splitlines():
    line = raw_line.strip()
    if not line or line.startswith('#') or '=' not in line:
        continue
    key, value = line.split('=', 1)
    key = key.strip()
    if key not in keys or key in values:
        continue
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
        value = value[1:-1]
    values[key] = value
for key in keys:
    if key in values:
        print(f'export {key}={shlex.quote(values[key])}')
PY2
)"
}

aws_keys_valid() {
  python3 - <<'PY2'
import os, sys
aid = os.environ.get("AWS_ACCESS_KEY_ID", "")
sec = os.environ.get("AWS_SECRET_ACCESS_KEY", "")
ok = aid.startswith("AKIA") and len(aid) == 20 and len(sec) == 40 and not sec.startswith("#")
sys.exit(0 if ok else 1)
PY2
}

load_prefix_keys() {
  local env_file="$1"
  local prefix="$2"
  [ -f "$env_file" ] || return 0
  local win_env_file
  win_env_file="$(wslpath -w "$env_file" 2>/dev/null || echo "$env_file")"

  eval "$(python3 - "$win_env_file" "$prefix" <<'PY2'
import pathlib
import shlex
import sys

path = pathlib.Path(sys.argv[1])
prefix = sys.argv[2]
text = path.read_text().replace('\r', '')
for raw_line in text.splitlines():
    line = raw_line.strip()
    if not line or line.startswith('#') or '=' not in line:
        continue
    key, value = line.split('=', 1)
    key = key.strip()
    if not key.startswith(prefix):
        continue
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
        value = value[1:-1]
    print(f'export {key}={shlex.quote(value)}')
PY2
)"
}

resolve_documented_instance_id() {
  local win_script win_doc
  win_script="$(wslpath -w "$APP_ROOT/scripts/deploy-aws-ssm.sh" 2>/dev/null || echo "$APP_ROOT/scripts/deploy-aws-ssm.sh")"
  win_doc="$(wslpath -w "$WORKSPACE_ROOT/README.md" 2>/dev/null || echo "$WORKSPACE_ROOT/README.md")"
  python3 - "$win_script" "$win_doc" <<'PY2'
import pathlib
import re
import sys

pattern = re.compile(r'\bi-[A-Za-z0-9]+\b')
for name in sys.argv[1:]:
    path = pathlib.Path(name)
    if not path.exists():
        continue
    match = pattern.search(path.read_text())
    if match:
        print(match.group(0))
        raise SystemExit(0)
PY2
}

if [ ! -f "$PROD_ENV" ]; then
  echo "missing deploy env file: $PROD_ENV" >&2
  return 1 2>/dev/null || exit 1
fi

load_exact_keys "$PROD_ENV" AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_REGION AWS_S3_BUCKET

if ! aws_keys_valid; then
  # env.production often ships SSM placeholders; dev deploy uses nested .env keys.
  load_exact_keys "$APP_ROOT/.env" AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_REGION AWS_S3_BUCKET
fi

if [ -z "${NYV_AWS_REGION:-}" ] && [ -n "${AWS_REGION:-}" ]; then
  export NYV_AWS_REGION="$AWS_REGION"
fi

if [ -z "${NYV_DEPLOY_BUCKET:-}" ] && [ -n "${AWS_S3_BUCKET:-}" ]; then
  export NYV_DEPLOY_BUCKET="$AWS_S3_BUCKET"
fi

if [ -z "${NYV_EC2_INSTANCE_ID:-}" ]; then
  documented_instance_id="$(resolve_documented_instance_id || true)"
  if [ -n "$documented_instance_id" ]; then
    export NYV_EC2_INSTANCE_ID="$documented_instance_id"
  fi
fi

for candidate in "$SECRETS_DIR/deploy-bundle.env" "$SECRETS_DIR/runtime.env"; do
  if [ -f "$candidate" ]; then
  load_prefix_keys "$candidate" NYV_SDK_KEY_
    load_prefix_keys "$candidate" NV_UAT_
    load_prefix_keys "$candidate" UAT_
    break
  fi
done

: "${AWS_ACCESS_KEY_ID:?missing AWS_ACCESS_KEY_ID in product Documents/env.production}"
: "${AWS_SECRET_ACCESS_KEY:?missing AWS_SECRET_ACCESS_KEY in product Documents/env.production}"
: "${NYV_AWS_REGION:?missing NYV_AWS_REGION or AWS_REGION in product Documents/env.production}"
: "${NYV_DEPLOY_BUCKET:?missing NYV_DEPLOY_BUCKET or AWS_S3_BUCKET in product Documents/env.production}"
: "${NYV_EC2_INSTANCE_ID:?missing NYV_EC2_INSTANCE_ID and no documented default found}"

base_count=0
for name in AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY NYV_AWS_REGION NYV_DEPLOY_BUCKET NYV_EC2_INSTANCE_ID; do
  if [ -n "${!name:-}" ]; then
    base_count=$((base_count + 1))
  fi
done
sdk_count="$(env | awk -F= '/^NYV_SDK_KEY_/ {count++} END {print count + 0}')"

echo "dev deploy env loaded ($((base_count + sdk_count)) vars)"
