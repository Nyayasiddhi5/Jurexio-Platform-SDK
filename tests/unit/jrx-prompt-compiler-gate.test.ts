/**
 * NV-PROMPT-COMPILER-GATE-001 — proves whether the NYV_SPECIALIST_PROMPT_COMPILER
 * flag can ever fire for the 164 XML registry agents.
 *
 * The gate in nv-client.ts is:
 *     !/<section_1_identity>/i.test(effectiveSystemPrompt)
 *          && process.env.NYV_SPECIALIST_PROMPT_COMPILER === '1'
 *
 * `effectiveSystemPrompt` at that point is the output of
 * assembleLayeredAgentSystemPrompt(), which embeds bundle.identity verbatim —
 * i.e. the literal <section_1_identity> element. So the negated test is false and
 * the compiler is unreachable for any registry agent, flag set or not.
 *
 * This matters because the flag was proposed as the highest-value quality lever.
 * It is not: it is dead for the 164 agents and only touches non-XML agents.
 */

import { describe, it, expect } from 'vitest';
import {
  parseAgentPromptBundle,
  buildActiveAgentLayer,
  assembleLayeredAgentSystemPrompt,
} from '../../src/services/jrx-agent-prompt-bundle.js';

const REGISTRY = [
  '<section_0_security_constitution>§0 SECURITY. UNTRUSTED DATA.</section_0_security_constitution>',
  '<section_1_identity>§1 ROLE IDENTITY. Agent: Test.</section_1_identity>',
  '<section_2_core_mandate>§2 CORE MANDATE.</section_2_core_mandate>',
].join('\n\n');

describe('NV-PROMPT-COMPILER-GATE-001', () => {
  const gateWouldFire = (prompt: string) => !/<section_1_identity>/i.test(prompt);

  it('the layered L1 prompt embeds the literal <section_1_identity> element', () => {
    const bundle = parseAgentPromptBundle(REGISTRY, 'test-01');
    expect(buildActiveAgentLayer(bundle, {})).toMatch(/<section_1_identity>/i);
  });

  it('so the compiler gate is CLOSED for registry agents on single-shot', () => {
    const assembled = assembleLayeredAgentSystemPrompt({
      fullRegistryPrompt: REGISTRY,
      agentId: 'test-01',
      mode: 'single_shot',
    });
    expect(gateWouldFire(assembled.systemPrompt)).toBe(false);
  });

  it('and closed on turn1_full and turn2_plus as well', () => {
    for (const mode of ['turn1_full', 'turn2_plus'] as const) {
      const a = assembleLayeredAgentSystemPrompt({
        fullRegistryPrompt: REGISTRY,
        agentId: 'test-01',
        mode,
      });
      expect(gateWouldFire(a.systemPrompt)).toBe(false);
    }
  });

  it('the gate only opens for a non-XML (platform-internal) agent prompt', () => {
    expect(gateWouldFire('You are a helpful legal assistant.')).toBe(true);
  });
});
