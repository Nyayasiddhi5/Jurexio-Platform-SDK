#!/usr/bin/env npx tsx

import * as fs from 'node:fs';
import {
  getActiveAgents,
  getAgent,
  getRegistryConfig,
  resetRegistryLoaderCache,
  resolveAgentId,
} from '../src/config/agent-registry-loader.js';
import { getAliasMapPath } from '../src/config/registry-paths.js';

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function main(): void {
  resetRegistryLoaderCache();

  const agents = getActiveAgents();
  const romaDistribution = agents.reduce<Record<string, number>>((acc, agent) => {
    const key = String(agent.romaLevel || 'UNKNOWN');
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  const aliasPayload = JSON.parse(fs.readFileSync(getAliasMapPath(), 'utf-8')) as {
    aliases?: Record<string, string>;
    aliasCount?: number;
  };
  const aliasMap = aliasPayload.aliases || {};
  const keyAgents = ['A-029', 'A-057', 'A-064', 'A-127', 'A-134', 'Q-001'];

  assert(agents.length === 164, `Expected 164 active agents, found ${agents.length}`);
  for (const agentId of keyAgents) {
    assert(Boolean(getAgent(agentId)), `Missing required agent ${agentId}`);
  }

  const legacyAliasChecks = Object.entries(aliasMap).slice(0, 5).map(([legacyId, canonicalId]) => ({
    legacyId,
    canonicalId,
    resolvedId: resolveAgentId(legacyId),
  }));

  console.log(
    JSON.stringify(
      {
        registry: getRegistryConfig(),
        activeAgentCount: agents.length,
        aliasCount: aliasPayload.aliasCount ?? Object.keys(aliasMap).length,
        romaDistribution,
        keyAgents: keyAgents.map(agentId => ({
          agentId,
          exists: Boolean(getAgent(agentId)),
        })),
        legacyAliasChecks,
      },
      null,
      2,
    ),
  );
}

main();
