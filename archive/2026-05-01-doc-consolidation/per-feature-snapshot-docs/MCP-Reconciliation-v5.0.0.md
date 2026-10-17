# MCP Reconciliation v5.0.0 — Tools vs Capabilities

**Status**: DEV-LIVE-READY (T-DLR-10)
**Owner**: Platform / Orchestration
**Last reseed**: see `Project-Tracker.md` row tagged `T-DLR-11`

---

## TL;DR

Three distinct registries exist in the v5.0.0 platform. Each one is the source
of truth for a different layer; this doc explains how they map to each other so
operators do not confuse them.

| Registry | Source-of-truth | Count | Purpose |
| -------- | --------------- | ----- | ------- |
| **MCP Legal Tools registry** | `src/data/nv-mcp-tools-registry.ts` (`NV_MCP_TOOLS_REGISTRY`) | **502** | The fine-grained legal-tool universe (court lookups, statute fetchers, identity verifiers, …) addressable via `POST /api/nv/v1/mcp/tools/:toolId/execute`. In-code; no DB row required to be discoverable. |
| **Capability Manifest** | `src/orchestration/capability-manifest.ts` (`capabilityManifest`) | **102** | Coarse capability surface used by the orchestrator and `nv_schema.protocol_registry`. Each capability covers ≥1 MCP tool plus first-party adapters (RAG, memory, audit, HITL, …). |
| **`nv_mcp_tools` (DB)** | `nv_mcp_tools` table | **10** | Demo / curated subset seeded by `scripts/nv-seed-mcp-tools.ts` so the Console MCP catalog page renders something on a fresh install. Not authoritative; the in-code registry is. |

## How the layers connect

```
                  ┌─────────────────────────────────────────┐
                  │ src/data/nv-mcp-tools-registry.ts (502) │ ◀─── in-code SSoT
                  └────────────┬────────────────────────────┘
                               │  loaded at boot by mcp-tool-registry.ts
                               ▼
        ┌────────────────────────────────────────────┐
        │ POST /api/nv/v1/mcp/tools/:toolId/execute  │  ◀── runtime entry point
        └────────────────────────────────────────────┘
                               ▲
                               │  exposed as a CapabilityDescriptor
                               │  for category ∈ { tools, document-pipeline,
                               │  intelligence, security, … }
                               │
              ┌──────────────────────────────────┐
              │  capabilityManifest.list() (102) │ ◀── orchestrator SSoT
              └──────────────┬───────────────────┘
                             │ initializeProtocolRegistryFromManifest()
                             ▼
               ┌────────────────────────────────┐
               │ nv_schema.protocol_registry    │ ◀── DB observability surface
               │  (102 rows post-reseed)        │
               └────────────────────────────────┘
```

## Tool-categories breakdown (top 11 from the in-code registry)

```
 95  identity / verification
 81  compliance / corporate
 59  document
 44  legal_research
 42  research
 38  analysis
 38  financial
 36  employment
 30  search
 22  tax
 20  verification
```

(Sourced from `rg "category:" src/data/nv-mcp-tools-registry.ts` — full breakdown lives in the registry file.)

## Capability-manifest breakdown by category (102 total)

```
 13  tools                    8  agent-orchestration
 11  intelligence             7  rag
 10  workflow                 7  document-pipeline
  9  memory                   7  compliance
  6  security                 5  safety
  3  vector                   2  audit / monitoring / omnichannel /
  2  simulation                  white-label
  1  hitl / metering / multimodal / protocol / streaming / skills
```

(Sourced from `nv_schema.protocol_registry` after the T-DLR-11 reseed.)

## What "reconciliation" means in v5.0.0

For DEV-LIVE-READY we explicitly chose to **not** materialize all 502 MCP tools
into `nv_mcp_tools`. The reasoning:

1. The MCP execution endpoint reads the in-code registry directly — DB rows are
   not required for the tool to be callable.
2. The `nv_mcp_tools` table is consumed only by the Console MCP catalog page,
   where surfacing 500+ rows is noise. The 10 curated entries cover the demo
   surface.
3. Treating capabilities (102) as the "registry" the platform binds to means
   the orchestrator's protocol surface stays small and stable; tool variations
   are an implementation detail of each capability.

## Reseed runbook

```bash
# 1. Verify counts
psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM nv_mcp_tools;"
psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM nv_schema.protocol_registry;"

# 2. Reseed the protocol registry from the manifest (idempotent ON CONFLICT)
npx tsx scripts/nv-reseed-protocol-registry.ts

# 3. (Optional) reseed the demo MCP rows
npx tsx scripts/nv-seed-mcp-tools.ts
```

## Open follow-ups (not in DLR scope)

- **T-PROD-MCP-EXPOSE**: decide whether to surface all 502 tools as a
  searchable catalog API (separate from `nv_mcp_tools`).
- **T-PROD-MCP-VERSIONING**: per-tool semantic version + deprecation lifecycle
  (currently each tool has an optional `version: '1.0'` string with no
  enforcement).
