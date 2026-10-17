#!/usr/bin/env bash
# NV-SME-OPUS-OPENROUTER-001: idempotently set the non-secret feature flag
# NYV_ANTHROPIC_DIRECT_DISABLED=1 in the canonical production env so the next
# gateway recreate excludes the unfunded direct-Anthropic provider and leads
# with the working OpenRouter Opus route. Prints NO secret values.
set -euo pipefail
ENV_FILE="/opt/Nyayavigya/secrets/.env.production"
KEY="NYV_ANTHROPIC_DIRECT_DISABLED"
VAL="1"

if [ ! -f "$ENV_FILE" ]; then
  echo "FATAL: $ENV_FILE not found"; exit 1
fi

if grep -qE "^${KEY}=" "$ENV_FILE"; then
  CUR="$(grep -E "^${KEY}=" "$ENV_FILE" | head -1 | sed -E "s/^${KEY}=//")"
  if [ "$CUR" = "$VAL" ]; then
    echo "ALREADY_SET ${KEY}=${VAL}"
  else
    sudo sed -i -E "s|^${KEY}=.*|${KEY}=${VAL}|" "$ENV_FILE"
    echo "UPDATED ${KEY} -> ${VAL}"
  fi
else
  echo "${KEY}=${VAL}" | sudo tee -a "$ENV_FILE" >/dev/null
  echo "APPENDED ${KEY}=${VAL}"
fi

# Confirm presence (key + value only; no other env lines printed).
grep -E "^${KEY}=" "$ENV_FILE" | head -1
echo "DONE"
