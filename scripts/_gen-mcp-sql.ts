import { NV_MCP_TOOLS_REGISTRY } from '../src/data/jrx-mcp-tools-registry.js';
import * as fs from 'fs';

const lines: string[] = ['BEGIN;'];
for (const t of NV_MCP_TOOLS_REGISTRY) {
  const tid = 'NYV-MCP-' + t.id.toUpperCase().replace(/[^A-Z0-9]+/g, '-') + '-001';
  const cfg = JSON.stringify({
    slug: t.id, category: t.category, jurisdictions: t.jurisdictions, inputSchema: t.inputSchema,
  }).replace(/'/g, "''");
  const name = t.name.replace(/'/g, "''");
  const desc = t.description.replace(/'/g, "''");
  lines.push(
    `INSERT INTO public.nv_mcp_tools(tool_id,name,description,tool_type,config,is_active) VALUES('${tid}','${name}','${desc}','${t.category}','${cfg}'::jsonb,true) ON CONFLICT(tool_id) DO UPDATE SET name=EXCLUDED.name,description=EXCLUDED.description,tool_type=EXCLUDED.tool_type,config=EXCLUDED.config,is_active=true;`,
  );
}
lines.push('COMMIT;');
fs.writeFileSync('/tmp/jrx-mcp-seed.sql', lines.join('\n'));
console.log('wrote', lines.length - 2, 'rows;', (fs.statSync('/tmp/jrx-mcp-seed.sql').size / 1024).toFixed(1), 'KB');
