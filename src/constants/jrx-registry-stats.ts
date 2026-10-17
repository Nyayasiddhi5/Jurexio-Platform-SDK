/**
 * NV Registry Stats — Single Source of Truth
 *
 * Static fallback constants for any place that cannot reach the live
 * `agent-registry-service` at render time (HTML templates, SDK headers,
 * service descriptors). All HTTP routes and runtime services SHOULD prefer
 * `getRegistryStats()` from `agent-registry-service` to read live values.
 *
 * Update path when registry totals change:
 *   1. Update §23-charter or jurisdiction registries.
 *   2. Run `npm run registry:verify-v5.1.0`.
 *   3. Update the constants below to match.
 *   4. Append a Project-Tracker.md row.
 *
 * Registry math (v5.1.0 format-b):
 *   164 canonical agents per file (Default + 6 jurisdiction overlays)
 *   Runtime loads Default first; optional overlay via NV_PRIMARY_JURISDICTION
 *   Archived v5.0.0 flat merge (1042) lives under archive/v5.0.0/ and is
 *   loaded ONLY when NV_REGISTRY_FORENSIC_MODE is set.
 */

import { MCP_REGISTRY_STATS } from '../data/jrx-mcp-tools-registry.js';

export const NYV_REGISTRY_TOTALS = {
  /** Total active agents in the runtime registry. */
  totalAgents: 164,
  /** Canonical user-facing jurisdictions available as overlays. */
  jurisdictions: 6,
  /** Practice areas covered across the registry. */
  practiceAreas: 9,
  /** Per-registry file agent count. */
  agentsPerJurisdiction: 164,
  /** Default-fallback agents. */
  defaultAgents: 164,
  /** Registry format / charter version. */
  registryFormat: 'v5.1.0-governed-execution-network-format-b' as const,
  /** Registry semver — bumped together with registryFormat. */
  registryVersion: '5.1.0' as const,
  /** §23 PII Charter coverage — v5 inherits §23 from v3-full-23section. */
  section23Coverage: 164,
} as const;

/** Historical flat-merge backup — forensic mode only (NV_REGISTRY_FORENSIC_MODE). */
export const NYV_ARCHIVED_REGISTRY = {
  totalAgentsFlat: 1042,
  registryVersion: '5.0.0' as const,
  archiveSubdir: 'archive/v5.0.0' as const,
  forensicEnvFlag: 'NV_REGISTRY_FORENSIC_MODE' as const,
} as const;

/** In-code MCP tool definitions (`src/data/jrx-mcp-tools-registry.ts`). */
export const NYV_MCP_TOOLS = {
  totalTools: MCP_REGISTRY_STATS.total,
  categories: MCP_REGISTRY_STATS.categories,
  version: MCP_REGISTRY_STATS.version,
} as const;

/** Swarm topology catalog (`nv-swarm-topology-service.ts`). */
export const NYV_TOPOLOGY_CATALOG = {
  totalTopologies: 107,
} as const;

export type NyvRegistryTotals = typeof NYV_REGISTRY_TOTALS;

/** Canonical jurisdiction codes (excludes DEFAULT). */
export const NYV_CANONICAL_JURISDICTIONS = ['IN', 'UK', 'GC', 'EU', 'US', 'SG'] as const;
export type NyvCanonicalJurisdiction = typeof NYV_CANONICAL_JURISDICTIONS[number];
