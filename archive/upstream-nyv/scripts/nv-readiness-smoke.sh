#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${1:-http://localhost:5000/api/nv}"
SDK_KEY="${NV_READINESS_SDK_KEY:-}"
EXPECT_AGENTS="${NV_READINESS_EXPECT_AGENTS:-164}"
EXPECT_REGISTRY_VERSION="${NV_READINESS_EXPECT_REGISTRY_VERSION:-5.1.0}"

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing required command: $1" >&2
    exit 2
  }
}

need_cmd curl
need_cmd node

curl_json() {
  local url="$1"
  if [[ -n "$SDK_KEY" ]]; then
    curl -fsS -H "X-API-Key: ${SDK_KEY}" "$url"
  else
    curl -fsS "$url"
  fi
}

echo "== Nyayavigya readiness smoke =="
echo "Base URL: ${BASE_URL}"

HEALTH_JSON="$(curl_json "${BASE_URL}/health")"
FULL_JSON="$(curl_json "${BASE_URL}/health/full")"
AGENTS_JSON="$(curl_json "${BASE_URL}/agents")"

REGISTRY_JSON=""
if [[ -n "$SDK_KEY" ]]; then
  REGISTRY_JSON="$(curl_json "${BASE_URL}/gateway/agents/registry-version")"
else
  echo "Skipping /gateway/agents/registry-version check: set NV_READINESS_SDK_KEY to include authenticated registry validation."
fi

node - "$HEALTH_JSON" "$FULL_JSON" "$AGENTS_JSON" "$REGISTRY_JSON" "$EXPECT_AGENTS" "$EXPECT_REGISTRY_VERSION" <<'NODE'
const [healthRaw, fullRaw, agentsRaw, registryRaw, expectAgentsRaw, expectRegistryVersionRaw] = process.argv.slice(2);
const expectAgents = Number(expectAgentsRaw);
const expectRegistryVersion = String(expectRegistryVersionRaw || '5.1.0');

const health = JSON.parse(healthRaw);
const full = JSON.parse(fullRaw);
const agents = JSON.parse(agentsRaw);
const registry = registryRaw ? JSON.parse(registryRaw) : null;

const healthTotal = Number(health.totalAgents ?? health.agents?.totalAgents ?? 0);
const fullTotal = Number(full.totalAgents ?? full.platform?.agents ?? 0);
const agentsTotal = Number(
  agents?.data?.registryTotal
  ?? agents?.data?.total
  ?? agents?.totalAgents
  ?? 0
);
const registryTotal = registry ? Number(registry?.data?.totalAgents ?? 0) : null;

const healthVersion = String(health.registryVersion ?? '');
const fullVersion = String(full.registryVersion ?? full.platform?.registryVersion ?? '');
const registryVersion = registry ? String(registry?.data?.canonicalVersion ?? '') : null;

const platformVersionHealth = String(health.version ?? '');
const platformVersionFull = String(full.version ?? '');

const failures = [];

if (!healthVersion || !fullVersion || healthVersion !== fullVersion) {
  failures.push(`registryVersion mismatch: health=${healthVersion || 'missing'} full=${fullVersion || 'missing'}`);
}

if (!healthTotal || !fullTotal || healthTotal !== fullTotal) {
  failures.push(`totalAgents mismatch: health=${healthTotal} full=${fullTotal}`);
}

if (!agentsTotal || agentsTotal !== healthTotal) {
  failures.push(`agents endpoint mismatch: agents=${agentsTotal} health=${healthTotal}`);
}

if (!platformVersionHealth || !platformVersionFull || platformVersionHealth !== platformVersionFull) {
  failures.push(`platform version mismatch: health=${platformVersionHealth || 'missing'} full=${platformVersionFull || 'missing'}`);
}

if (registry) {
  if (!registryVersion || registryVersion !== healthVersion) {
    failures.push(`registry-version endpoint mismatch: registry=${registryVersion || 'missing'} health=${healthVersion || 'missing'}`);
  }
  if (!registryTotal || registryTotal !== healthTotal) {
    failures.push(`registry-version total mismatch: registry=${registryTotal} health=${healthTotal}`);
  }
}

if (Number.isFinite(expectAgents) && expectAgents > 0) {
  if (healthTotal !== expectAgents) {
    failures.push(
      `totalAgents=${healthTotal} does not match v5.1.0 expectation (${expectAgents}); ` +
      `legacy forensic flat backup is 1042 — set NV_REGISTRY_FORENSIC_MODE=0 for runtime truth`,
    );
  }
}

if (expectRegistryVersion && healthVersion && healthVersion !== expectRegistryVersion) {
  failures.push(
    `registryVersion=${healthVersion || 'missing'} does not match expected ${expectRegistryVersion}`,
  );
}

console.log(`health.version=${platformVersionHealth}`);
console.log(`health.registryVersion=${healthVersion}`);
console.log(`health.totalAgents=${healthTotal}`);
console.log(`full.version=${platformVersionFull}`);
console.log(`full.registryVersion=${fullVersion}`);
console.log(`full.totalAgents=${fullTotal}`);
console.log(`agents.total=${agentsTotal}`);

if (registry) {
  console.log(`registry.canonicalVersion=${registryVersion}`);
  console.log(`registry.totalAgents=${registryTotal}`);
}

if (failures.length) {
  console.error('\nFAIL');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('\nPASS');
NODE
