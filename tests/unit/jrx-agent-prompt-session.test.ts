/**
 * NV-AGENT-PROMPT-SESSION-001 — load-once layered prompt tests.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  parseAgentPromptBundle,
  assembleLayeredAgentSystemPrompt,
  buildActiveAgentLayer,
  AGENT_PROMPT_SESSION_MARKER,
  __clearAgentPromptBundleCache,
} from '../../src/services/jrx-agent-prompt-bundle.js';
import {
  beginPromptConstitutionTurn,
  mintEcosystemPromptSessionId,
  __clearPromptConstitutionMemory,
} from '../../src/services/jrx-prompt-session-store.js';
import { JrxPromptCompiler } from '../../src/services/jrx-prompt-compiler.js';

function fakeRegistryPrompt(agentName: string, agentId: string, mandate: string): string {
  return [
    '<section_0_security_constitution>',
    '§0 SECURITY CONSTITUTION',
    'X'.repeat(5000),
    '</section_0_security_constitution>',
    '<section_1_identity>',
    '§1 ROLE IDENTITY',
    `Agent: ${agentName}`,
    `ID: ${agentId}`,
    '</section_1_identity>',
    '<section_2_core_mandate>',
    '§2 CORE MANDATE',
    `Primary Objective: ${mandate}`,
    '</section_2_core_mandate>',
    '<section_8_anti_hallucination>',
    '§8 ANTI-HALLUCINATION Never invent citations.',
    '</section_8_anti_hallucination>',
    '<section_retrieval_policy>',
    '§ RETRIEVAL POLICY NYS Knowledge Plane FIRST',
    '</section_retrieval_policy>',
  ].join('\n');
}

describe('NV-AGENT-PROMPT-SESSION-001', () => {
  beforeEach(() => {
    __clearAgentPromptBundleCache();
    __clearPromptConstitutionMemory();
  });

  it('parses identity and mandate distinctly per agent', () => {
    const a = parseAgentPromptBundle(fakeRegistryPrompt('Contract Drafting Agent', 'A-001', 'Generates commercial contracts'), 'A-001');
    const b = parseAgentPromptBundle(fakeRegistryPrompt('NDA Drafting Agent', 'A-002', 'Produces NDAs'), 'A-002');
    expect(a.identity).toContain('Contract Drafting Agent');
    expect(b.identity).toContain('NDA Drafting Agent');
    expect(a.mandate).toContain('commercial contracts');
    expect(b.mandate).toContain('Produces NDAs');
    expect(a.hash).not.toBe(b.hash);
    expect(buildActiveAgentLayer(a)).toContain(AGENT_PROMPT_SESSION_MARKER);
    expect(buildActiveAgentLayer(a)).toContain('Contract Drafting Agent');
  });

  it('Turn 1 includes full §0; Turn 2+ keeps identity/mandate without full §0 body', () => {
    const full = fakeRegistryPrompt('Contract Drafting Agent', 'A-001', 'Generates commercial contracts');
    const t1 = assembleLayeredAgentSystemPrompt({
      fullRegistryPrompt: full,
      agentId: 'A-001',
      mode: 'turn1_full',
      turnNumber: 1,
      taskOverlay: 'L2 task: draft SPA',
    });
    expect(t1.systemPrompt).toContain('§0 SECURITY CONSTITUTION');
    expect(t1.systemPrompt).toContain('X'.repeat(100));
    expect(t1.systemPrompt).toContain('Contract Drafting Agent');
    expect(t1.systemPrompt).toContain('L2 task: draft SPA');
    expect(t1.mode).toBe('turn1_full');

    const t2 = assembleLayeredAgentSystemPrompt({
      fullRegistryPrompt: full,
      agentId: 'A-001',
      mode: 'turn2_plus',
      turnNumber: 2,
      taskOverlay: 'L2 task: revise clause',
    });
    expect(t2.systemPrompt).toContain('Contract Drafting Agent');
    expect(t2.systemPrompt).toContain('Generates commercial contracts');
    expect(t2.systemPrompt).toContain(AGENT_PROMPT_SESSION_MARKER);
    expect(t2.systemPrompt).not.toContain('X'.repeat(100));
    expect(t2.bytes).toBeLessThan(t1.bytes);
  });

  it('single_shot uses L1 binding not mid-§0 truncate', () => {
    const full = fakeRegistryPrompt('Research Agent', 'A-050', 'Compares jurisdictions');
    const shot = assembleLayeredAgentSystemPrompt({
      fullRegistryPrompt: full,
      agentId: 'A-050',
      mode: 'single_shot',
      taskOverlay: 'research BNS 103',
    });
    expect(shot.systemPrompt).toContain('Research Agent');
    expect(shot.systemPrompt).toContain('CONSTITUTION BINDING');
    expect(shot.systemPrompt).not.toContain('X'.repeat(2000));
  });

  it('session store: first turn full, second turn2_plus', async () => {
    const full = fakeRegistryPrompt('Contract Drafting Agent', 'A-001', 'Generates commercial contracts');
    const bundle = parseAgentPromptBundle(full, 'A-001');
    const t1 = await beginPromptConstitutionTurn({
      sessionId: 'sess-test-1',
      agentId: 'A-001',
      jurisdiction: 'IN',
      promptHash: bundle.hash,
    });
    expect(t1.mode).toBe('turn1_full');
    expect(t1.turnNumber).toBe(1);
    const t2 = await beginPromptConstitutionTurn({
      sessionId: 'sess-test-1',
      agentId: 'A-001',
      jurisdiction: 'IN',
      promptHash: bundle.hash,
    });
    expect(t2.mode).toBe('turn2_plus');
    expect(t2.turnNumber).toBe(2);
  });

  it('mintEcosystemPromptSessionId is stable per platform/org/user/day', () => {
    const a = mintEcosystemPromptSessionId({ platform: 'NSP', userId: 'u1', orgId: 'o1' });
    const b = mintEcosystemPromptSessionId({ platform: 'NSP', userId: 'u1', orgId: 'o1' });
    expect(a).toBe(b);
    expect(a).toMatch(/^jrx-sess-nsp-/);
    const explicit = mintEcosystemPromptSessionId({
      platform: 'NSP',
      explicitSessionId: 'partner-sess-99',
    });
    expect(explicit).toBe('partner-sess-99');
  });

  it('prompt compiler XML path: turn1 full then turn2 compressed with identity', () => {
    const full = fakeRegistryPrompt('Contract Drafting Agent', 'A-001', 'Generates commercial contracts');
    const compiler = new JrxPromptCompiler({ enableCompression: true, compressionStartTurn: 2 });
    const r1 = compiler.compile(full, 'sess-c1', 'A-001', 'draft SPA', 'IN');
    expect(r1.compressionApplied).toBe(false);
    expect(r1.compiledPrompt).toContain('Contract Drafting Agent');
    expect(r1.compiledPrompt).toContain('X'.repeat(50));
    expect(r1.compressionStrategies).toContain('xml-turn1-full-constitution');

    const r2 = compiler.compile(full, 'sess-c1', 'A-001', 'revise SPA', 'IN');
    expect(r2.compressionApplied).toBe(true);
    expect(r2.compiledPrompt).toContain('Contract Drafting Agent');
    expect(r2.compiledPrompt).toContain('Generates commercial contracts');
    expect(r2.compiledPrompt).not.toContain('X'.repeat(100));
    expect(r2.tokensSaved).toBeGreaterThan(0);
  });
});
