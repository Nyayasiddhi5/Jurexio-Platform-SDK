/**
 * Jurexio Platform 3.1.2 — MCP Tools Seed
 * JRX-SCRIPT-SEED-MCP-001 (rewritten 2026-05-08 for P1 #6)
 *
 * Seeds `public.nv_mcp_tools` from the canonical 530-tool registry at
 * `src/data/jrx-mcp-tools-registry.ts` (NV_MCP_TOOLS_REGISTRY). Replaces
 * the prior 10-row hardcoded list. Idempotent via ON CONFLICT.
 *
 * Run:    npx tsx scripts/jrx-seed-mcp-tools.ts
 * Dry:    DRY_RUN=1 npx tsx scripts/jrx-seed-mcp-tools.ts
 */

import { makePgSql } from './_pg-pool.js';
import { assertColumns } from './_assert-columns.js';
import * as dotenv from 'dotenv';
import { NV_MCP_TOOLS_REGISTRY } from '../src/data/jrx-mcp-tools-registry.js';

dotenv.config();
const sql = makePgSql();

// task #347: schema-drift guard — fail loud before any INSERT.
const REQUIRED_COLUMNS = {
  'public.nv_mcp_tools': [
    'tool_id', 'name', 'description', 'tool_type', 'config', 'is_active',
  ],
} as const;
const DRY = process.env.DRY_RUN === '1';

function toolIdFor(id: string): string {
  return `JRX-MCP-${id.toUpperCase().replace(/[^A-Z0-9]+/g, '-')}-001`;
}

async function seedMcpTools(): Promise<void> {
  const tools = NV_MCP_TOOLS_REGISTRY;
  console.log(`  Found ${tools.length} MCP tools in registry`);
  if (DRY) {
    console.log('  DRY_RUN=1 — printing first 3 only');
    for (const t of tools.slice(0, 3)) {
      console.log(`    INSERT ${toolIdFor(t.id)} (${t.category}) — ${t.name}`);
    }
    return;
  }

  await assertColumns(sql, './jrx-seed-mcp-tools', REQUIRED_COLUMNS);
  let inserted = 0;
  let updated = 0;
  for (const t of tools) {
    const tool_id = toolIdFor(t.id);
    const config = JSON.stringify({
      slug: t.id,
      category: t.category,
      jurisdictions: t.jurisdictions,
      inputSchema: t.inputSchema,
    });
    const r = await sql`
      INSERT INTO public.nv_mcp_tools (tool_id, name, description, tool_type, config, is_active)
      VALUES (${tool_id}, ${t.name}, ${t.description}, ${t.category}, ${config}::jsonb, true)
      ON CONFLICT (tool_id) DO UPDATE
        SET name        = EXCLUDED.name,
            description = EXCLUDED.description,
            tool_type   = EXCLUDED.tool_type,
            config      = EXCLUDED.config,
            is_active   = true
      RETURNING (xmax = 0) AS inserted
    `;
    if (r[0]?.inserted) inserted++;
    else updated++;
  }
  console.log(`  ✓ MCP tools seeded — ${inserted} inserted, ${updated} updated, ${tools.length} total`);
}

seedMcpTools()
  .catch((e) => {
    console.error('  ✗ seed failed:', e);
    process.exitCode = 1;
  })
  .finally(() => sql.end());
