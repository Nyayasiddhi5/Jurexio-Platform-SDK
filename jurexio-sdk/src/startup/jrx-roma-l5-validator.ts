import fs from 'fs';
import path from 'path';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('roma-l5-validator');

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

const ROMA_L5_FIELDS = [
  'romaLevel', 'quantumReady', 'guardrails', 'supportedLanguages',
  'capabilities', 'tools', 'compliance', 'version', 'escalationPath',
];

const IN_SPECIFIC_TOOLS = ['aadhaar-verify', 'pan-lookup', 'sebi-api'];

interface ValidationResult {
  jurisdiction: string;
  agentCount: number;
  validCount: number;
  errors: string[];
}

export function validateRomaL5(): { valid: boolean; results: ValidationResult[] } {
  const results: ValidationResult[] = [];
  let allValid = true;

  for (const file of REGISTRY_FILES) {
    const filePath = path.join(REGISTRIES_DIR, file);
    if (!fs.existsSync(filePath)) continue;

    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const agents = data.agents || [];
    const jurisdiction = agents[0]?.jurisdiction || file;
    const errors: string[] = [];
    let validCount = 0;

    for (const agent of agents) {
      let agentValid = true;
      for (const field of ROMA_L5_FIELDS) {
        if (!(field in agent) || agent[field] === null || agent[field] === undefined) {
          errors.push(`${agent.id}: missing ${field}`);
          agentValid = false;
        }
      }

      if (agent.escalationPath && Array.isArray(agent.escalationPath)) {
        const pathSet = new Set<string>();
        for (const step of agent.escalationPath) {
          if (step === 'HITL_OPERATOR') break;
          if (pathSet.has(step)) {
            errors.push(`${agent.id}: circular escalation detected in path`);
            agentValid = false;
            break;
          }
          pathSet.add(step);
        }
        if (!agent.escalationPath.includes('HITL_OPERATOR')) {
          errors.push(`${agent.id}: escalationPath missing HITL_OPERATOR terminal`);
          agentValid = false;
        }
      }

      if (jurisdiction !== 'IN' && jurisdiction !== 'Default' && agent.tools) {
        for (const tool of IN_SPECIFIC_TOOLS) {
          if (agent.tools.includes(tool)) {
            errors.push(`${agent.id}: non-IN agent has IN-specific tool '${tool}'`);
          }
        }
      }

      if (agent.compliance) {
        if ((jurisdiction === 'IN' || jurisdiction === 'GC') && !agent.compliance.dpdpApplicable) {
          errors.push(`${agent.id}: IN/GC agent should have dpdpApplicable=true`);
        }
        if ((jurisdiction === 'EU' || jurisdiction === 'UK') && !agent.compliance.gdprApplicable) {
          errors.push(`${agent.id}: EU/UK agent should have gdprApplicable=true`);
        }
      }

      if (agentValid) validCount++;
    }

    if (errors.length > 0) allValid = false;
    results.push({ jurisdiction, agentCount: agents.length, validCount, errors });
  }

  for (const r of results) {
    logger.info('[RomaL5Validator] jurisdiction summary', {
      service: 'RomaL5Validator',
      jurisdiction: r.jurisdiction,
      agents: r.agentCount,
      valid: r.validCount,
      errors: r.errors.length,
    });
  }

  if (!allValid) {
    const totalErrors = results.reduce((sum, r) => sum + r.errors.length, 0);
    logger.warn('ROMA L5 validation completed with warnings', {
      service: 'RomaL5Validator',
      status: 'WARNINGS',
      totalErrors,
    });
  } else {
    logger.info('All agents pass ROMA L5 validation', { service: 'RomaL5Validator', status: 'PASSED' });
  }

  return { valid: allValid, results };
}
