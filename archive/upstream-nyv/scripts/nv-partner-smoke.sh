#!/usr/bin/env bash
# nv-partner-smoke.sh — Partner integration smoke (core + NYS Knowledge Plane) per platform SKU.
#
# Usage:
#   cd nyayavigya-platform-312
#   npm run partner:smoke:local
#   npm run partner:smoke:ec2
#   NYV_PLATFORM=NSP npm run partner:smoke:ec2
#
# Shared-key mode (integration until production rotation):
#   If NYV_SDK_KEY_SHARED or NYV_SDK_SHARED_KEYS=1 is set, all SKUs use the same key
#   (SHARED → NSP → NYV_SDK_KEY). Do not log key values.

set -euo pipefail
cd "$(dirname "$0")/.."

if [[ -f .env ]] && [[ -z "${NYV_SDK_KEY_NSP:-}" ]] && [[ -z "${NYV_SDK_KEY_SHARED:-}" ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

# Optional shared integration env (gitignored)
if [[ -f ../.local/secrets/ecosystem-shared-integration.env ]]; then
  set -a
  # shellcheck disable=SC1091
  source ../.local/secrets/ecosystem-shared-integration.env
  set +a
elif [[ -f ../../.local/secrets/ecosystem-shared-integration.env ]]; then
  set -a
  # shellcheck disable=SC1091
  source ../../.local/secrets/ecosystem-shared-integration.env
  set +a
fi

case "${NV_TARGET:-}" in
  ec2|EC2|prod)
    BASE="${NV_BASE_URL:-https://api.nyayasiddhi.online}"
    ;;
  local|LOCAL|dev|"")
    BASE="${NV_BASE_URL:-http://127.0.0.1:5000}"
    ;;
  *)
    BASE="${NV_BASE_URL:-$NV_TARGET}"
    ;;
esac

BASE="${BASE%/}"
TIMEOUT="${NV_PARTNER_SMOKE_TIMEOUT:-120}"

PLATFORMS=(NSP NSPM NSI NSA NSM NYM JRX)
if [[ -n "${NYV_PLATFORM:-}" ]]; then
  PLATFORMS=("$NYV_PLATFORM")
fi

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

pass() { echo -e "${GREEN}PASS${NC} $*"; }
fail() { echo -e "${RED}FAIL${NC} $*"; FAILURES=$((FAILURES + 1)); }
warn() { echo -e "${YELLOW}WARN${NC} $*"; }

FAILURES=0
SKIPPED=0

# Prefer per-SKU key; fall back to shared integration key (same key for all platforms).
key_for() {
  local sku="$1"
  local var="NYV_SDK_KEY_${sku}"
  local v="${!var:-}"
  if [[ -n "$v" && "${NYV_SDK_SHARED_KEYS:-}" != "1" ]]; then
    printf '%s' "$v"
    return
  fi
  if [[ -n "${NYV_SDK_KEY_SHARED:-}" ]]; then
    printf '%s' "$NYV_SDK_KEY_SHARED"
    return
  fi
  if [[ "${NYV_SDK_SHARED_KEYS:-}" == "1" || -z "$v" ]]; then
    printf '%s' "${NYV_SDK_KEY_NSP:-${NYV_SDK_KEY:-${v}}}"
    return
  fi
  printf '%s' "$v"
}

http_code() {
  local method="$1" url="$2" key="${3:-}"
  local extra_args=()
  if [[ -n "$key" ]]; then
    extra_args+=(-H "X-API-Key: ${key}")
  fi
  if ((${#extra_args[@]})); then
    curl -sS -o /tmp/jrx-partner-smoke-body.json -w '%{http_code}' \
      --max-time "$TIMEOUT" \
      -X "$method" \
      "${extra_args[@]}" \
      -H 'Content-Type: application/json' \
      "$url" 2>/dev/null || echo "000"
  else
    curl -sS -o /tmp/jrx-partner-smoke-body.json -w '%{http_code}' \
      --max-time "$TIMEOUT" \
      -X "$method" \
      -H 'Content-Type: application/json' \
      "$url" 2>/dev/null || echo "000"
  fi
}

http_code_post_json() {
  local url="$1" key="$2" body="$3"
  local user_hdr="${4:-}"
  if [[ -n "$user_hdr" ]]; then
    curl -sS -o /tmp/jrx-partner-smoke-body.json -w '%{http_code}' \
      --max-time "$TIMEOUT" \
      -X POST \
      -H "X-API-Key: ${key}" \
      -H "Content-Type: application/json" \
      -H "$user_hdr" \
      -d "$body" \
      "$url" 2>/dev/null || echo "000"
  else
    curl -sS -o /tmp/jrx-partner-smoke-body.json -w '%{http_code}' \
      --max-time "$TIMEOUT" \
      -X POST \
      -H "X-API-Key: ${key}" \
      -H 'Content-Type: application/json' \
      -d "$body" \
      "$url" 2>/dev/null || echo "000"
  fi
}

body_has() {
  local needle="$1"
  grep -q "$needle" /tmp/jrx-partner-smoke-body.json 2>/dev/null
}

echo ""
echo "══════════════════════════════════════════════════════════════"
echo "  NYV Partner Smoke — target: ${BASE}"
echo "  Platforms: ${PLATFORMS[*]}"
echo "  Shared keys: ${NYV_SDK_SHARED_KEYS:-0} (SHARED set=$([ -n "${NYV_SDK_KEY_SHARED:-}" ] && echo yes || echo no))"
echo "══════════════════════════════════════════════════════════════"
echo ""

code=$(http_code GET "${BASE}/api/jrx/health" "")
if [[ "$code" == "200" ]]; then
  pass "[public] GET /api/jrx/health → ${code}"
else
  fail "[public] GET /api/jrx/health → ${code} (is gateway up?)"
fi

RESEARCH_BODY='{"query":"What is consideration under the Indian Contract Act?","jurisdiction":"IN"}'
ORCH_BODY='{"prompt":"In one sentence, what is Section 103 of the Bharatiya Nyaya Sanhita (BNS) about? Cite only if grounded.","agentId":"summarizer","jurisdiction":"IN","taskType":"legal-research","mode":"sync","enableRAG":true}'
KNOWLEDGE_BODY='{"query":"BNS section 103 murder","jurisdiction":"IN","topK":5}'

for sku in "${PLATFORMS[@]}"; do
  key=$(key_for "$sku")
  echo ""
  echo "── ${sku} ──────────────────────────────────────────"
  if [[ -z "$key" ]]; then
    warn "${sku}: no SDK key (set NYV_SDK_KEY_${sku} or NYV_SDK_KEY_SHARED / NYV_SDK_SHARED_KEYS=1) — skipping"
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  prefix="[${sku}]"

  code=$(http_code GET "${BASE}/api/jrx/gateway/health" "$key")
  if [[ "$code" == "200" ]]; then pass "${prefix} gateway/health → ${code}"; else fail "${prefix} gateway/health → ${code}"; fi

  code=$(http_code GET "${BASE}/api/jrx/v1/sdk/llm/catalog" "$key")
  if [[ "$code" == "200" ]]; then pass "${prefix} v1/sdk/llm/catalog → ${code}"; else fail "${prefix} v1/sdk/llm/catalog → ${code}"; fi

  code=$(http_code GET "${BASE}/api/jrx/gateway/agents" "$key")
  if [[ "$code" == "200" ]]; then pass "${prefix} gateway/agents → ${code}"; else fail "${prefix} gateway/agents → ${code}"; fi

  code=$(http_code_post_json "${BASE}/api/jrx/gateway/research/query" "$key" "$RESEARCH_BODY")
  if [[ "$code" == "200" ]]; then pass "${prefix} gateway/research/query → ${code}"; else fail "${prefix} gateway/research/query → ${code}"; fi

  # NYS Knowledge Plane
  code=$(http_code GET "${BASE}/api/jrx/knowledge/plane/health" "$key")
  if [[ "$code" == "200" ]]; then
    pass "${prefix} knowledge/plane/health → ${code}"
  elif [[ "$code" == "404" ]]; then
    warn "${prefix} knowledge/plane/health → 404 (flag off?)"
  else
    fail "${prefix} knowledge/plane/health → ${code}"
  fi

  code=$(http_code_post_json "${BASE}/api/jrx/knowledge/search" "$key" "$KNOWLEDGE_BODY")
  if [[ "$code" == "200" ]]; then
    if body_has 'nys_global' || body_has 'layersUsed' || body_has 'chunks'; then
      pass "${prefix} knowledge/search → ${code} (grounded body)"
    else
      pass "${prefix} knowledge/search → ${code}"
    fi
  else
    fail "${prefix} knowledge/search → ${code}"
  fi

  code=$(http_code GET "${BASE}/api/jrx/legal-work/tasks?jurisdiction=IN&limit=5" "$key")
  if [[ "$code" == "200" ]]; then pass "${prefix} legal-work/tasks → ${code}"; else fail "${prefix} legal-work/tasks → ${code}"; fi

  code=$(http_code_post_json "${BASE}/api/jrx/orchestrate" "$key" "$ORCH_BODY")
  if [[ "$code" == "200" ]]; then
    pass "${prefix} orchestrate (BNS golden) → ${code}"
  else
    fail "${prefix} orchestrate → ${code} (429 = rate limit; retry slower on EC2)"
  fi

  # NV-NSP-MIGRATION-001 — legal-draft-fast + documentType + draftLength + userId header
  DRAFT_FAST_BODY='{"prompt":"Draft one paragraph anticipatory bail prayer under BNSS.","taskType":"legal-draft-fast","jurisdiction":"IN","parameters":{"documentType":"bail_application"},"options":{"draftLength":"medium"},"maxTokens":512}'
  code=$(http_code_post_json "${BASE}/api/jrx/orchestrate" "$key" "$DRAFT_FAST_BODY" "X-NYV-User-Id: 90001")
  if [[ "$code" == "200" ]]; then
    if body_has 'specialist' || body_has '"content"'; then
      pass "${prefix} legal-draft-fast (documentType+draftLength+userId) → ${code}"
    else
      pass "${prefix} legal-draft-fast → ${code}"
    fi
  else
    fail "${prefix} legal-draft-fast → ${code}"
  fi

  # Partner India template catalog (approved-only; ≥1 comprehensive IN form)
  code=$(http_code GET "${BASE}/api/jrx/templates?jurisdiction=IN&approvedOnly=true&limit=20" "$key")
  if [[ "$code" == "200" ]]; then
    if body_has '"id"' || body_has '"templates"' || body_has 'partner_approved'; then
      pass "${prefix} templates IN approved → ${code}"
    else
      pass "${prefix} templates IN approved → ${code} (empty body OK if bootstrap pending)"
    fi
  elif [[ "$code" == "404" ]]; then
    warn "${prefix} templates → 404 (route flag?)"
  else
    fail "${prefix} templates → ${code}"
  fi

  # Multi-domain packs (NV-DOMAIN-PACK-001)
  code=$(http_code GET "${BASE}/api/jrx/domains" "$key")
  if [[ "$code" == "200" ]]; then
    if body_has '"legal"' || body_has 'activeDomain' || body_has 'packs'; then
      pass "${prefix} domains → ${code}"
    else
      pass "${prefix} domains → ${code}"
    fi
  elif [[ "$code" == "404" ]]; then
    warn "${prefix} domains → 404 (pre-deploy?)"
  else
    fail "${prefix} domains → ${code}"
  fi

  # CNR corpus resolve (judgment / Open Data — never live eCourts)
  code=$(http_code GET "${BASE}/api/jrx/v1/sdk/cnr/health" "$key")
  if [[ "$code" == "200" ]]; then
    pass "${prefix} cnr/health → ${code}"
  elif [[ "$code" == "404" ]]; then
    warn "${prefix} cnr/health → 404 (pre-deploy?)"
  else
    fail "${prefix} cnr/health → ${code}"
  fi

  # Patra Mitra document companion
  code=$(http_code GET "${BASE}/api/jrx/v1/sdk/patra-mitra/health" "$key")
  if [[ "$code" == "200" ]]; then
    if body_has 'patra-mitra' || body_has 'Patra' || body_has 'parse'; then
      pass "${prefix} patra-mitra/health → ${code}"
    else
      pass "${prefix} patra-mitra/health → ${code}"
    fi
  elif [[ "$code" == "404" ]]; then
    warn "${prefix} patra-mitra/health → 404 (pre-deploy?)"
  else
    fail "${prefix} patra-mitra/health → ${code}"
  fi

  # Matter Vault
  code=$(http_code GET "${BASE}/api/jrx/matter-vault/health" "$key")
  if [[ "$code" == "200" ]]; then
    pass "${prefix} matter-vault/health → ${code}"
  elif [[ "$code" == "404" ]]; then
    warn "${prefix} matter-vault/health → 404 (pre-deploy?)"
  else
    fail "${prefix} matter-vault/health → ${code}"
  fi
done

echo ""
echo "══════════════════════════════════════════════════════════════"
if [[ "$FAILURES" -eq 0 ]]; then
  echo -e "  ${GREEN}Result: PASS${NC} (failures=0, skipped=${SKIPPED})"
  exit 0
else
  echo -e "  ${RED}Result: FAIL${NC} (failures=${FAILURES}, skipped=${SKIPPED})"
  exit 1
fi
