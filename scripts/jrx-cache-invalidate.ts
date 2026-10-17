#!/usr/bin/env tsx
/**
 * Ops CLI: clear stale cached LLM answers when laws or templates change.
 *
 * Backs Task #66: when a statute is amended, a system prompt is corrected,
 * or a template is fixed, ops needs an immediate way to invalidate the
 * affected per-agent cache buckets — waiting for the 24h cold-tier TTL is
 * not acceptable for a legal product.
 *
 * Usage:
 *   # Clear one tenant × jurisdiction × agent triple
 *   npx tsx scripts/jrx-cache-invalidate.ts agent \
 *     --tenant-id=acme --jurisdiction=IN --agent-id=litigation
 *
 *   # Clear every cached answer for a jurisdiction (e.g. amended Act)
 *   npx tsx scripts/jrx-cache-invalidate.ts jurisdiction --jurisdiction=IN
 *
 *   # Clear every cached answer for one agent across all tenants
 *   npx tsx scripts/jrx-cache-invalidate.ts jurisdiction \
 *     --jurisdiction=IN --agent-id=compliance
 *
 *   # Clear every cached answer for one tenant in one jurisdiction
 *   npx tsx scripts/jrx-cache-invalidate.ts jurisdiction \
 *     --jurisdiction=US --tenant-id=acme
 *
 * Exits non-zero on usage errors so it's safe to wrap in shell pipelines.
 *
 * IMPORTANT: this CLI talks to the *in-process* cache singleton, so it must
 * be run inside the same Node process that hosts the gateway (e.g. via a
 * `kubectl exec` into the running pod). For external invalidation use the
 * `/api/jrx/gateway/cache/admin/invalidate-*` HTTP endpoints, which are
 * audited the same way and work across pods.
 */

import { lmCacheService } from '../src/services/lm-cache-service.js';
import {
  buildAgentCacheNamespace,
  matchAgentCacheNamespace,
} from '../src/services/jrx-cache-namespace.js';
import { appendAuditRecord } from '../src/middleware/jrx-sdk-tracking-middleware.js';

interface ParsedArgs {
  command: 'agent' | 'jurisdiction' | null;
  tenantId?: string;
  jurisdiction?: string;
  agentId?: string;
  actor?: string;
  reason?: string;
  help: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = { command: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') {
      out.help = true;
      continue;
    }
    if (arg === 'agent' || arg === 'jurisdiction') {
      out.command = arg;
      continue;
    }
    const m = arg.match(/^--([a-z-]+)(?:=(.*))?$/);
    if (!m) continue;
    const key = m[1];
    const value = m[2] ?? argv[++i];
    switch (key) {
      case 'tenant-id': out.tenantId = value; break;
      case 'jurisdiction': out.jurisdiction = value; break;
      case 'agent-id': out.agentId = value; break;
      case 'actor': out.actor = value; break;
      case 'reason': out.reason = value; break;
    }
  }
  return out;
}

function printUsage(): void {
  process.stdout.write(
    [
      './jrx-cache-invalidate — clear stale per-agent LLM cache entries (Task #66)',
      '',
      'Usage:',
      '  npx tsx scripts/jrx-cache-invalidate.ts agent --tenant-id=ID --jurisdiction=CODE --agent-id=ID',
      '  npx tsx scripts/jrx-cache-invalidate.ts jurisdiction --jurisdiction=CODE [--tenant-id=ID] [--agent-id=ID]',
      '',
      'Optional flags (recommended for audit):',
      '  --actor="alice@ops"   — who triggered the clear',
      '  --reason="IPC §302 amendment 2026-04"  — why it was triggered',
      '',
    ].join('\n'),
  );
}

async function recordAudit(params: {
  action: 'invalidate-agent' | 'invalidate-jurisdiction';
  filter: Record<string, unknown>;
  count: number;
  namespaces: string[];
  actor?: string;
  reason?: string;
}): Promise<void> {
  try {
    await appendAuditRecord({
      eventType: `cache_invalidate:cli:${params.action}`,
      payload: JSON.stringify({
        actor: params.actor || process.env.USER || 'cli',
        reason: params.reason ?? null,
        source: 'cli',
        filter: params.filter,
        result: { count: params.count, namespaces: params.namespaces },
        at: new Date().toISOString(),
      }),
    });
  } catch (err: any) {
    if (err?.name === 'AuditChainBrokenError') throw err;
    process.stderr.write(`[warn] audit append failed: ${err?.message || err}\n`);
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help || !args.command) {
    printUsage();
    process.exit(args.help ? 0 : 1);
  }

  if (args.command === 'agent') {
    if (!args.agentId) {
      process.stderr.write('error: --agent-id is required for `agent` command\n');
      process.exit(2);
    }
    const namespace = buildAgentCacheNamespace({
      tenantId: args.tenantId,
      jurisdiction: args.jurisdiction,
      agentId: args.agentId,
    });
    const count = await lmCacheService.invalidateNamespace(namespace);
    await recordAudit({
      action: 'invalidate-agent',
      filter: {
        tenantId: args.tenantId ?? null,
        jurisdiction: args.jurisdiction ?? null,
        agentId: args.agentId,
      },
      count,
      namespaces: count > 0 ? [namespace] : [],
      actor: args.actor,
      reason: args.reason,
    });
    process.stdout.write(JSON.stringify({
      action: 'invalidate-agent',
      namespace,
      invalidated: count,
    }, null, 2) + '\n');
    return;
  }

  // command === 'jurisdiction'
  if (!args.jurisdiction) {
    process.stderr.write('error: --jurisdiction is required for `jurisdiction` command\n');
    process.exit(2);
  }

  const filter = {
    tenantId: args.tenantId,
    jurisdiction: args.jurisdiction,
    agentId: args.agentId,
  };
  const predicate = matchAgentCacheNamespace(filter);
  const { count, namespaces } = await lmCacheService.invalidateMatching(predicate);

  await recordAudit({
    action: 'invalidate-jurisdiction',
    filter: {
      jurisdiction: args.jurisdiction,
      tenantId: args.tenantId ?? null,
      agentId: args.agentId ?? null,
    },
    count,
    namespaces,
    actor: args.actor,
    reason: args.reason,
  });

  process.stdout.write(JSON.stringify({
    action: 'invalidate-jurisdiction',
    filter: {
      jurisdiction: args.jurisdiction.toUpperCase(),
      tenantId: args.tenantId ?? null,
      agentId: args.agentId ?? null,
    },
    invalidated: count,
    namespaces,
  }, null, 2) + '\n');
}

main().catch((err) => {
  process.stderr.write(`fatal: ${err?.message || err}\n`);
  process.exit(1);
});
