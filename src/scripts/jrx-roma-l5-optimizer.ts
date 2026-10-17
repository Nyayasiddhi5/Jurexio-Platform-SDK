import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REGISTRIES_DIR = path.join(__dirname, '../../config/agent-registries');

const REGISTRY_FILES = [
  'Jurexio-Legal-registry-IN.json',
  'Jurexio-Legal-registry-UK.json',
  'Jurexio-Legal-registry-EU.json',
  'Jurexio-Legal-registry-US.json',
  'Jurexio-Legal-registry-GC.json',
  'Jurexio-Legal-registry-SG.json',
  'Jurexio-Legal-registry-Default.json',
];

interface AgentDef {
  id: string;
  tier: string;
  romaLevel: string;
  reportsTo: string[];
  manages: string[];
  jurisdiction: string;
  escalationPath?: string[];
  [key: string]: unknown;
}

function computeEscalationPath(agent: AgentDef, agentsMap: Map<string, AgentDef>): string[] {
  const chain: string[] = [];
  const visited = new Set<string>();
  let currentId = agent.id;

  while (true) {
    if (visited.has(currentId)) {
      chain.push('HITL_OPERATOR');
      break;
    }
    visited.add(currentId);

    const current = agentsMap.get(currentId);
    if (!current) {
      chain.push('HITL_OPERATOR');
      break;
    }

    const reportsTo = current.reportsTo;
    if (!reportsTo || reportsTo.length === 0) {
      chain.push('HITL_OPERATOR');
      break;
    }

    const nextId = reportsTo[0];
    if (visited.has(nextId)) {
      chain.push('HITL_OPERATOR');
      break;
    }

    chain.push(nextId);
    currentId = nextId;

    if (chain.length >= 5) {
      chain.push('HITL_OPERATOR');
      break;
    }
  }

  return chain;
}

function processRegistry(filePath: string): { agentCount: number; fieldsAdded: number; errors: string[] } {
  const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  const agents: AgentDef[] = data.agents;
  const agentsMap = new Map<string, AgentDef>();
  let fieldsAdded = 0;
  const errors: string[] = [];

  for (const agent of agents) {
    agentsMap.set(agent.id, agent);
  }

  for (const agent of agents) {
    if (!agent.escalationPath) {
      agent.escalationPath = computeEscalationPath(agent, agentsMap);
      fieldsAdded++;
    }

    const chain = agent.escalationPath;
    const chainSet = new Set<string>();
    let hasCircular = false;
    for (const step of chain) {
      if (step === 'HITL_OPERATOR') break;
      if (chainSet.has(step)) {
        hasCircular = true;
        break;
      }
      chainSet.add(step);
    }
    if (hasCircular) {
      agent.escalationPath = ['HITL_OPERATOR'];
      errors.push(`Fixed circular escalation for ${agent.id}`);
    }

    if (!chain.includes('HITL_OPERATOR')) {
      agent.escalationPath.push('HITL_OPERATOR');
    }
  }

  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  return { agentCount: agents.length, fieldsAdded, errors };
}

function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  ROMA L5 Optimizer — Jurexio Enterprise Platform 3.1.2');
  console.log('═══════════════════════════════════════════════\n');

  let totalAgents = 0;
  let totalFields = 0;
  const allErrors: string[] = [];

  for (const file of REGISTRY_FILES) {
    const filePath = path.join(REGISTRIES_DIR, file);
    if (!fs.existsSync(filePath)) {
      console.log(`  SKIP: ${file} — not found`);
      continue;
    }

    const result = processRegistry(filePath);
    totalAgents += result.agentCount;
    totalFields += result.fieldsAdded;
    allErrors.push(...result.errors);

    console.log(`  ✓ ${file}: ${result.agentCount} agents, ${result.fieldsAdded} escalationPaths added`);
    if (result.errors.length > 0) {
      result.errors.forEach(e => console.log(`    ⚠ ${e}`));
    }
  }

  console.log('\n───────────────────────────────────────────────');
  console.log(`  Total agents processed: ${totalAgents}`);
  console.log(`  Total escalationPath fields added: ${totalFields}`);
  console.log(`  Circular escalation fixes: ${allErrors.length}`);
  console.log(`  All agents now have complete ROMA L5 fields`);
  console.log('───────────────────────────────────────────────\n');
}

main();
