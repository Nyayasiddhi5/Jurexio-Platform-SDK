-- ============================================================================
-- Jurexio 3.1.2 / SDK 5.0.0 — ONE-CLICK BOOTSTRAP DATABASE SCRIPT
-- ============================================================================
-- This script is the master entry point for a fresh deployable database.
-- It is composed of three layers:
--   1. SCHEMA   — sourced from scripts/jurexio-312-db-dump.sql (1290 lines, 83 tables)
--   2. MASTER DATA — seeded via scripts/jrx-seed-all.ts which fans out to:
--        jrx-seed-jurisdictions.ts, jrx-seed-statutes.ts, jrx-seed-llm-providers.ts,
--        jrx-seed-models.ts, jrx-seed-mcp-tools.ts, jrx-seed-feature-flags.ts,
--        jrx-seed-organizations.ts, jrx-seed-users.ts, jrx-seed-sdk-apps.ts,
--        jrx-seed-sdk-keys.ts, jrx-seed-agents.ts
--   3. AGENT REGISTRIES — JSON registries from src/data/jurisdiction-registries/
--        + master agent system-prompts from config/agents/agents-master.json
--        loaded by agent-registry-service at boot.
--
-- USAGE (one click):
--   bash scripts/one-click-deploy.sh bootstrap-db
--
-- USAGE (manual):
--   psql "$DATABASE_URL" -f scripts/jurexio-312-db-dump.sql
--   tsx  scripts/jrx-seed-all.ts
-- ============================================================================

\echo '=== STAGE 1: SCHEMA (83 tables) ==='
\i scripts/jurexio-312-db-dump.sql

\echo '=== STAGE 2: MASTER DATA SEED (programmatic) ==='
-- Run from shell after this file:
--   pnpm tsx scripts/jrx-seed-all.ts
--
-- This seeds:
--   - 6 jurisdictions (IN, UK, US, EU, GC, SG) with statutes
--   - 305 statute sections (BNS/BNSS/BSA, IPC/CrPC/IEA, UK Acts, USC, EU Reg, GCC, SG)
--   - 23 LLM providers + 15 models in nv_model_catalog
--   - 502 MCP tools in nv_mcp_tools
--   - All feature flags
--   - 1 default super-admin organisation + admin user (creds via env)
--   - 5 SDK apps for Nyayasiddhi platforms (NYM, JRX-PRO, JRX-INS, JRX-ACE, JRX-MIN)
--   - 5 SDK keys (one per platform; secrets are SHA-256 hashed; raw keys printed once)
--   - 1043 agents loaded from JSON registries with 22-section personas + system prompts

\echo '=== STAGE 3: VERIFICATION ==='
-- Verify table count
SELECT COUNT(*) AS table_count FROM information_schema.tables
 WHERE table_schema='public' AND table_name LIKE 'nv_%';

-- Verify agent rows
SELECT COUNT(*) AS agents_loaded FROM nv_agents;

-- Verify SDK apps for the 5 platforms
SELECT app_id, name, platform_type, tier, jurisdiction
  FROM nv_sdk_apps
 ORDER BY platform_type;

-- Verify model catalog
SELECT provider_id, model_id, tier FROM nv_model_catalog ORDER BY tier, provider_id;

-- Verify jurisdictions
SELECT jurisdiction_code, name, statute_count FROM nv_jurisdictions ORDER BY jurisdiction_code;

\echo '=== BOOTSTRAP COMPLETE ==='
