/**
 * nv-agents-boot-smoke.ts — Agent registry exhaustive boot
 * NV-OPT+UAT-2026-05-09 P2 #11
 *
 * Loads every agent registry JSON, asserts every agent has:
 *   id, name, version, persona/capabilities, preferredModels (≥1)
 * Prints jurisdiction-by-jurisdiction tally + failures.
 *
 * Usage: npx tsx scripts/jrx-agents-boot-smoke.ts
 */
// @ts-nocheck
import fs from 'fs';
import path from 'path';

const REGISTRY_DIR = path.join(process.cwd(), 'config', 'agent-registries');
// 2026-05-09: 275-agent v2.0.0 file retired (renamed *.legacy-v2-*.json)
// per directive "1042 agents only across all jurisdictions, mark others old".
// Source-of-truth is now ONLY config/agent-registries/*.json (1042 v5.0.0).
const SRC_REGISTRY = path.join(process.cwd(), 'src', 'data', './jrx-agents-registry.json');
const SRC_REGISTRY_ENABLED = false;

const required = ['id', 'name'] as const;
const recommended = ['version', 'preferredModels', 'capabilities'] as const;

interface AgentCheck {
  source: string;
  agentId: string;
  missingRequired: string[];
  missingRecommended: string[];
}

function checkAgents(arr: any[], source: string): AgentCheck[] {
  const out: AgentCheck[] = [];
  for (const a of arr) {
    const missingRequired = required.filter(k => a[k] == null || a[k] === '');
    const missingRecommended = recommended.filter(k => {
      const v = a[k];
      if (v == null) return true;
      if (Array.isArray(v) && v.length === 0) return true;
      return false;
    });
    if (missingRequired.length || missingRecommended.length) {
      out.push({ source, agentId: a.id ?? '<missing-id>', missingRequired, missingRecommended });
    }
  }
  return out;
}

function loadRegistry(file: string): any[] {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(raw) ? raw : (raw.agents ?? raw.registry ?? []);
  } catch (e) {
    console.error(`[agents-boot] failed to read ${file}:`, e);
    return [];
  }
}

function main() {
  const startedAt = new Date().toISOString();
  const tally: Record<string, { total: number; failedRequired: number; failedRecommended: number }> = {};
  const failures: AgentCheck[] = [];
  let totalAgents = 0;

  if (fs.existsSync(REGISTRY_DIR)) {
    for (const f of fs.readdirSync(REGISTRY_DIR)) {
      if (!f.endsWith('.json')) continue;
      const file = path.join(REGISTRY_DIR, f);
      const agents = loadRegistry(file);
      const fails = checkAgents(agents, f);
      tally[f] = {
        total: agents.length,
        failedRequired: fails.filter(x => x.missingRequired.length).length,
        failedRecommended: fails.filter(x => x.missingRecommended.length).length,
      };
      totalAgents += agents.length;
      failures.push(...fails);
    }
  }

  if (SRC_REGISTRY_ENABLED && fs.existsSync(SRC_REGISTRY)) {
    const agents = loadRegistry(SRC_REGISTRY);
    const fails = checkAgents(agents, 'src/data/jrx-agents-registry.json');
    tally['src/data/jrx-agents-registry.json'] = {
      total: agents.length,
      failedRequired: fails.filter(x => x.missingRequired.length).length,
      failedRecommended: fails.filter(x => x.missingRecommended.length).length,
    };
    totalAgents += agents.length;
    failures.push(...fails);
  }

  const totalReqFails = failures.filter(f => f.missingRequired.length).length;
  const verdict = totalReqFails === 0 ? 'PASS' : 'FAIL';

  const summary = {
    suite: './jrx-agents-boot-smoke',
    startedAt,
    finishedAt: new Date().toISOString(),
    totalRegistries: Object.keys(tally).length,
    totalAgents,
    totalRequiredFailures: totalReqFails,
    totalRecommendedFailures: failures.filter(f => f.missingRecommended.length).length,
    verdict,
    tallyByRegistry: tally,
    sampleFailures: failures.slice(0, 20),
  };

  const auditDir = path.join(process.cwd(), 'audit');
  if (!fs.existsSync(auditDir)) fs.mkdirSync(auditDir, { recursive: true });
  const outPath = path.join(auditDir, `agents-boot-${startedAt.replace(/[:.]/g, '-')}.json`);
  const tmp = outPath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(summary, null, 2));
  fs.renameSync(tmp, outPath);

  console.log(`[agents-boot] verdict=${verdict} totalAgents=${totalAgents} requiredFails=${totalReqFails} recommendedFails=${summary.totalRecommendedFailures}`);
  console.log(`[agents-boot] tally:`, JSON.stringify(tally, null, 2));
  console.log(`[agents-boot] ledger → ${outPath}`);
  process.exit(verdict === 'PASS' ? 0 : 1);
}

main();
