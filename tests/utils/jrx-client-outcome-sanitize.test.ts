import { describe, expect, it } from 'vitest';
import {
  sanitizeOrchestrationContentForClient,
  sanitizeOrchestrationErrorForClient,
  sanitizeOrchestrationPayloadForClient,
} from '../../src/utils/jrx-client-outcome-sanitize.js';

describe('NV-CLIENT-OUTCOME-SANITIZE-001', () => {
  it('strips Orchestrated Response chrome and Failed Branches', () => {
    const leaked = `# Orchestrated Response

**Request**: § RETRIEVAL POLICY (MANDATORY — do not skip layers) Jurisdiction focus: IN
**Pattern**: swarm
**Agents Used**: 4 (succeeded: 1, failed: 3)
**Algorithm**: SWARM

---

\`\`\`json
{"agentId":"A-037","agentName":"Sanctions Screening Agent","matterId":"MISSING_MATTER_ID","patternUsed":"P9","output":"**MEMORANDUM: BSA vs IEA**\\n\\nShort answer here.","auditId":"IL-SYNTH-1","grpoSignals":{}}
\`\`\`

---

## ⚠️ Failed Branches (3)
· **swarm-agent-0** (agent=Queen Orchestration Engine): Error: policy: per-node timeout after 120000ms
`;

    const out = sanitizeOrchestrationContentForClient(leaked);
    expect(out).toContain('MEMORANDUM: BSA vs IEA');
    expect(out).toContain('Short answer here');
    expect(out).not.toContain('Orchestrated Response');
    expect(out).not.toContain('Failed Branches');
    expect(out).not.toContain('RETRIEVAL POLICY');
    expect(out).not.toContain('Sanctions Screening Agent');
    expect(out).not.toContain('swarm-agent');
    expect(out).not.toContain('per-node timeout');
    expect(out).not.toContain('grpoSignals');
  });

  it('strips model thinking blocks from content', () => {
    const leaked = `<thinking>
First I will consider BNSS section 482.
Then I will draft the prayer.
</thinking>

**PRAYER:** It is prayed that bail be granted.

Let me think about this for a moment.
**ISSUE:** Anticipatory bail under BNSS.`;

    const out = sanitizeOrchestrationContentForClient(leaked);
    expect(out).toContain('**PRAYER:**');
    expect(out).toContain('**ISSUE:**');
    expect(out).not.toContain('<thinking>');
    expect(out).not.toContain('First I will consider');
    expect(out).not.toMatch(/let me think/i);
  });

  it('removes chainOfThought and nested orchestration wrapper from payloads', () => {
    const payload = sanitizeOrchestrationPayloadForClient({
      content: 'Hello counsel',
      chainOfThought: { steps: ['step 1', 'step 2'], strategy: 'zero_shot_cot', confidence: 0.9 },
      orchestration: {
        agentId: 'A-1',
        pattern: 'callJurexio',
        chainOfThought: { steps: ['hidden'], strategy: 'zero_shot_cot' },
        timings: { totalMs: 1200 },
      },
      explainability: { reasoningSteps: ['internal'], confidence: 0.8 },
    });

    expect(payload.chainOfThought).toBeUndefined();
    expect(payload.orchestration).toBeUndefined();
    expect(payload.explainability).toBeUndefined();
  });

  it('removes diagnostic fields from API payloads', () => {
    const payload = sanitizeOrchestrationPayloadForClient({
      content: '# Orchestrated Response\n\n**Pattern**: swarm\n\nHello counsel',
      executions: [{ agentId: 'x' }],
      taskDecomposition: { algorithm: 'SWARM' },
      agentsUsed: 4,
      orchestrationPattern: 'swarm',
      routing: { path: 'queen', reason: 'queen_depth_required', primaryCapabilityIds: ['a'] },
      provider: 'queen-orchestrator',
      cost: { path: 'queen-swarm', provider: 'queen-orchestrator', tokens: { total: 1 } },
    });

    expect(payload.content).toContain('Hello counsel');
    expect(payload.content).not.toContain('Orchestrated Response');
    expect(payload.executions).toBeUndefined();
    expect(payload.taskDecomposition).toBeUndefined();
    expect(payload.agentsUsed).toBeUndefined();
    expect(payload.orchestrationPattern).toBeUndefined();
    expect((payload.routing as any).reason).toBe('processed');
    expect(payload.provider).toBe('nyayavigya');
  });

  it('maps orchestration errors to generic client messages', () => {
    expect(sanitizeOrchestrationErrorForClient(new Error('policy: per-node timeout after 120000ms')))
      .toMatch(/too long|retry/i);
    expect(sanitizeOrchestrationErrorForClient(new Error('Queen Orchestration Engine failed')))
      .toMatch(/Unable to complete|retry/i);
    expect(sanitizeOrchestrationErrorForClient('swarm agent execution failed'))
      .toMatch(/Unable to complete|retry/i);
  });
});
