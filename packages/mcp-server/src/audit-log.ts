/**
 * Structured audit logging for MCP tool invocations.
 * Writes JSON lines to stderr (default) or a file when JRX_MCP_AUDIT_LOG is set.
 */

import { appendFileSync } from 'node:fs';

export interface AuditEntry {
  ts: string;
  event: 'tool_list' | 'tool_call' | 'tool_error';
  toolId: string;
  sku?: string;
  latencyMs?: number;
  ok: boolean;
  error?: string;
  sessionId?: string;
}

export class AuditLogger {
  constructor(private readonly filePath: string | null) {}

  log(entry: Omit<AuditEntry, 'ts'>): void {
    const line = JSON.stringify({ ...entry, ts: new Date().toISOString() });
    if (this.filePath) {
      try {
        appendFileSync(this.filePath, `${line}\n`, 'utf8');
      } catch (err) {
        process.stderr.write(`${line}\n`);
        process.stderr.write(`[mcp-server] audit file write failed: ${String(err)}\n`);
      }
    } else {
      process.stderr.write(`${line}\n`);
    }
  }
}
