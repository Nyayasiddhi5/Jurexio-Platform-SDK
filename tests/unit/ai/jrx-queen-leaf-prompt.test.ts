/**
 * NV-TOKEN-BUDGET-001 (Queen leaf lane) — the guardrail test that would have
 * caught the defect measured in plan §12.2 at build time.
 *
 * Measured live on nysdev (deploy `2026-08-16T0910Z-aws-ssm`, forced-Queen probe):
 *
 * | Path                                    | Prompt tokens |
 * |-----------------------------------------|--------------:|
 * | Micro/FAQ path (Phase 3 target)         |         1,048 |
 * | Queen exploration leaf                  |    **19,938** |
 * | Queen exploration leaf                  |    **19,938** |
 * | Queen exploration leaf                  |        13,570 |
 * | Queen exploration leaf                  |    **19,936** |
 * | Queen synthesis leg                     |        11,696 |
 *
 * 89,610 prompt tokens across 7 completions. The budget module was fine — the
 * Queen never called it. These tests assert (a) a declared task class is
 * mandatory, (b) exploration is leaner than synthesis, and (c) the correctness
 * floor survives in EVERY tier, because a cheaper wrong answer is not a win.
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  budgetForQueenNode,
  getPromptBudget,
  resolveQueenNodePromptClass,
  isQueenLeafL0DowngradeEnabled,
  estimatePromptTokens,
} from '../../../src/config/jrx-prompt-budget.js';
import {
  assertDeclaredTaskClass,
  buildBudgetedQueenLeafPrompt,
  buildQueenLeafSystemPrompt,
} from '../../../src/orchestration/jrx-queen-leaf-prompt.js';
import { classifyQueenNodeRole } from '../../../src/orchestration/jrx-queen-node-role.js';
import { __clearAgentPromptBundleCache } from '../../../src/services/jrx-agent-prompt-bundle.js';

/**
 * A registry prompt of the shape the jurisdiction resolver returns: XML sections
 * with a large §0 constitution. §0's bulk is what makes the L0 turn-1 tier
 * ~6.5 k tokens on the live path, so the fixture has to be big enough for the
 * L0-vs-L1 difference to be measurable rather than notional.
 */
function registryPrompt(): string {
  const bulk = (label: string, n: number) =>
    Array.from({ length: n }, (_, i) => `${label} clause ${i + 1}: governance requirement text.`).join('\n');
  return [
    '<section_0_security_constitution>',
    'SECURITY CONSTITUTION — L4 untrusted input handling.',
    bulk('SEC', 220),
    '</section_0_security_constitution>',
    '<section_1_identity>',
    'ROLE IDENTITY: You are a Karnataka High Court criminal-side advocate agent.',
    bulk('ID', 12),
    '</section_1_identity>',
    '<section_2_core_mandate>',
    'CORE MANDATE: Advise on BNS/BNSS/BSA criminal procedure.',
    bulk('MAN', 12),
    '</section_2_core_mandate>',
    '<section_8_anti_hallucination>',
    'ANTI-HALLUCINATION: Never invent case names, citations or section numbers.',
    '</section_8_anti_hallucination>',
    '<section_retrieval_policy>',
    'RETRIEVAL POLICY: prefer NYS caselaw, then tenant RAG, then matter memory.',
    bulk('RET', 20),
    '</section_retrieval_policy>',
    ...Array.from({ length: 14 }, (_, i) => `<section_${i + 9}_governance>\n${bulk('GOV', 30)}\n</section_${i + 9}_governance>`),
  ].join('\n');
}

const BAIL_QUERY =
  'Is anticipatory bail available under BNSS 482 for a BNS 318(4) cheating case in Karnataka?';

const ENV_KEYS = [
  'NYV_PROMPT_BUDGET',
  'NYV_QUEEN_LEAF_L0_DOWNGRADE',
  'NYV_QUEEN_EXPLORATION_PROMPT_CLASS',
] as const;
let savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  __clearAgentPromptBundleCache();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k]!;
  }
});

describe('NV-TOKEN-BUDGET-001 — a Queen dispatch MUST declare a task class', () => {
  it('fails loudly when prompt assembly is reached with no policy', async () => {
    await expect(
      // The measured defect, expressed as a call: assembly with no declared class.
      buildQueenLeafSystemPrompt({
        agentId: 'agent-1',
        registrySystemPrompt: registryPrompt(),
        promptBlob: BAIL_QUERY,
        policy: undefined as never,
      }),
    ).rejects.toThrow(/NV-TOKEN-BUDGET-001/);
  });

  it('fails loudly on an unrecognised task class rather than defaulting wide', () => {
    // Silently falling back to the widest tier is exactly how 19,938 happened.
    expect(() =>
      assertDeclaredTaskClass({ taskClass: 'unbudgeted' } as never, 'test-site'),
    ).toThrow(/NV-TOKEN-BUDGET-001/);
    expect(() => assertDeclaredTaskClass(undefined, 'test-site')).toThrow(/declared task class/);
  });

  it('every classified Queen node resolves to a real budget — no undefined class', () => {
    for (const type of [
      'swarm_exploration',
      'swarm_aggregation',
      'research',
      'analysis',
      'retrieval',
      'final_synthesis',
      '',
    ]) {
      const role = classifyQueenNodeRole({ type });
      const policy = budgetForQueenNode({ role, prompt: BAIL_QUERY });
      expect(getPromptBudget(policy.taskClass), type).toBeDefined();
      expect(policy.budget.maxPromptTokens, type).toBeGreaterThan(0);
      expect(policy.reason, type).toBeTruthy();
    }
  });
});

describe('NV-TOKEN-BUDGET-001 — exploration is lean, synthesis is wide (plan §8.5)', () => {
  it('puts an exploration leaf on a lean tier and the synthesis leg on research+', () => {
    const leaf = budgetForQueenNode({ role: 'exploration', prompt: BAIL_QUERY });
    const synth = budgetForQueenNode({ role: 'synthesis', prompt: BAIL_QUERY });

    expect(leaf.taskClass).toBe('chat');
    expect(leaf.overlayDepth).toBe('compact');
    expect(leaf.leanActiveLayer).toBe(true);

    expect(synth.taskClass).toBe('research');
    expect(synth.overlayDepth).toBe('full');
    expect(synth.budget.maxPromptTokens).toBeGreaterThan(leaf.budget.maxPromptTokens);
  });

  it('floors the synthesis leg at research even for a one-line question', () => {
    // It merges N agents' evidence, so its assembled prompt is wide legitimately.
    expect(resolveQueenNodePromptClass({ role: 'synthesis', prompt: 'bail?' })).toBe('research');
  });

  it('keeps a declared drafting intent on the drafting tier on both legs', () => {
    // Ambiguity must resolve toward MORE context, never less.
    expect(
      resolveQueenNodePromptClass({ role: 'synthesis', taskKind: 'legal_drafting', prompt: BAIL_QUERY }),
    ).toBe('drafting');
    // An exploration leaf is clamped, but never below the chat tier.
    expect(
      resolveQueenNodePromptClass({ role: 'exploration', taskKind: 'legal_drafting', prompt: BAIL_QUERY }),
    ).toBe('chat');
  });

  it('never starves an exploration leaf below chat, even on misconfiguration', () => {
    // A decomposed subtask instruction is usually SHORT, so the natural class is
    // `micro_faq` (600 tok). Clamping to a ceiling alone would have starved
    // leaves rather than made them lean — hence the `chat` floor.
    expect(resolveQueenNodePromptClass({ role: 'exploration', prompt: 'bail?' })).toBe('chat');
    for (const bad of ['micro_faq', 'classify', 'nonsense', '']) {
      process.env.NYV_QUEEN_EXPLORATION_PROMPT_CLASS = bad;
      expect(resolveQueenNodePromptClass({ role: 'exploration', prompt: BAIL_QUERY }), bad).toBe('chat');
    }
  });

  it('lets ops widen the exploration ceiling so a research leaf keeps research', () => {
    const RESEARCH_LEAF = 'Research the precedent position on anticipatory bail under BNSS 482.';
    // Default ceiling clamps it to the lean tier…
    expect(resolveQueenNodePromptClass({ role: 'exploration', prompt: RESEARCH_LEAF })).toBe('chat');
    // …and raising the ceiling lets it keep its naturally-classified tier.
    process.env.NYV_QUEEN_EXPLORATION_PROMPT_CLASS = 'research';
    expect(resolveQueenNodePromptClass({ role: 'exploration', prompt: RESEARCH_LEAF })).toBe('research');
  });

  it('restores pre-Phase-3 behaviour when NYV_PROMPT_BUDGET=0 (A/B escape hatch)', () => {
    process.env.NYV_PROMPT_BUDGET = '0';
    const leaf = budgetForQueenNode({ role: 'exploration', prompt: BAIL_QUERY });
    expect(leaf.enforced).toBe(false);
    expect(leaf.overlayDepth).toBe('full');
    expect(leaf.leanActiveLayer).toBe(false);
    expect(leaf.allowFullConstitution).toBe(true);
  });
});

describe('NV-TOKEN-BUDGET-001 — measured reduction in assembled leaf prompt', () => {
  const base = {
    agentId: './jrx-criminal-karnataka',
    registrySystemPrompt: registryPrompt(),
    promptBlob: BAIL_QUERY,
    jurisdiction: 'IN',
  };

  it('an exploration leaf assembles materially fewer tokens than the pre-fix path', async () => {
    // Pre-fix = the exact shape the orchestrator used: full overlay, non-lean L1.
    process.env.NYV_PROMPT_BUDGET = '0';
    const before = await buildBudgetedQueenLeafPrompt({ ...base, role: 'exploration' });
    delete process.env.NYV_PROMPT_BUDGET;
    __clearAgentPromptBundleCache();
    const after = await buildBudgetedQueenLeafPrompt({ ...base, role: 'exploration' });

    expect(after.systemPromptTokens).toBeLessThan(before.systemPromptTokens);
    expect(after.taskClass).toBe('chat');
    expect(after.overlayTokens).toBeLessThan(before.overlayTokens);
  });

  it('an exploration leaf assembles fewer tokens than the synthesis leg', async () => {
    const leaf = await buildBudgetedQueenLeafPrompt({ ...base, role: 'exploration' });
    __clearAgentPromptBundleCache();
    const synth = await buildBudgetedQueenLeafPrompt({ ...base, role: 'synthesis' });
    expect(leaf.systemPromptTokens).toBeLessThan(synth.systemPromptTokens);
  });

  it('withholds the L0 constitution from an exploration leaf only when the flag is on', async () => {
    const resolveTurn = async () => ({ mode: 'turn1_full' as const, turnNumber: 1 });

    const withL0 = await buildBudgetedQueenLeafPrompt({
      ...base,
      role: 'exploration',
      sessionId: 'sess-1',
      resolveTurn,
    });
    expect(isQueenLeafL0DowngradeEnabled()).toBe(false);
    expect(withL0.l0Downgraded).toBe(false);
    expect(withL0.assemblyMode).toBe('turn1_full');

    process.env.NYV_QUEEN_LEAF_L0_DOWNGRADE = '1';
    __clearAgentPromptBundleCache();
    const withoutL0 = await buildBudgetedQueenLeafPrompt({
      ...base,
      role: 'exploration',
      sessionId: 'sess-1',
      resolveTurn,
    });
    expect(withoutL0.l0Downgraded).toBe(true);
    expect(withoutL0.assemblyMode).toBe('single_shot');
    // This is the single largest remaining term on the leaf path.
    expect(withoutL0.systemPromptTokens).toBeLessThan(withL0.systemPromptTokens / 2);
  });

  it('never withholds L0 from the synthesis leg, flag on or off', async () => {
    process.env.NYV_QUEEN_LEAF_L0_DOWNGRADE = '1';
    const synth = await buildBudgetedQueenLeafPrompt({
      ...base,
      role: 'synthesis',
      sessionId: 'sess-1',
      resolveTurn: async () => ({ mode: 'turn1_full' as const, turnNumber: 1 }),
    });
    expect(synth.l0Downgraded).toBe(false);
    expect(synth.assemblyMode).toBe('turn1_full');
  });
});

describe('NV-TOKEN-BUDGET-001 — correctness floor survives EVERY tier', () => {
  /**
   * The non-negotiables. Phase 3 asserts these per tier on the specialist path;
   * the Queen leaf path must be held to the identical bar, because a cheaper
   * wrong answer is not a win.
   */
  const FLOOR: Array<[string, RegExp]> = [
    ['jurisdiction grounding (BNS/BNSS/BSA · India)', /BNS|BNSS|BSA|India/i],
    ['citation discipline', /cite|citation/i],
    ['no fabrication', /invent|fabricat|hallucinat/i],
    ['counsel boundary', /advocate|counsel|pleading/i],
  ];

  const cases: Array<{ label: string; role: 'exploration' | 'synthesis'; l0Downgrade: boolean }> = [
    { label: 'exploration (lean tier)', role: 'exploration', l0Downgrade: false },
    { label: 'exploration (lean tier + L0 downgrade)', role: 'exploration', l0Downgrade: true },
    { label: 'synthesis (wide tier)', role: 'synthesis', l0Downgrade: false },
  ];

  for (const c of cases) {
    it(`retains every correctness-critical instruction — ${c.label}`, async () => {
      if (c.l0Downgrade) process.env.NYV_QUEEN_LEAF_L0_DOWNGRADE = '1';
      __clearAgentPromptBundleCache();
      const assembled = await buildBudgetedQueenLeafPrompt({
        agentId: './jrx-criminal-karnataka',
        registrySystemPrompt: registryPrompt(),
        promptBlob: 'Draft an anticipatory bail application under BNSS 482 for a BNS 318(4) case.',
        jurisdiction: 'IN',
        role: c.role,
        sessionId: 'sess-floor',
        resolveTurn: async () => ({ mode: 'turn1_full' as const, turnNumber: 1 }),
      });
      for (const [name, re] of FLOOR) {
        expect(assembled.systemPrompt, `${c.label} — ${name}`).toMatch(re);
      }
      // Query-matched statute pack: grounding, not boilerplate. It supplies the
      // actual section under discussion and must never be traded for tokens.
      expect(assembled.systemPrompt, `${c.label} — query-matched BNSS pack`).toMatch(/BNSS/);
      // Agent identity must survive: a leaf that forgets who it is answers as a
      // generic advocate, which is the NV-LEGAL-INTEL-FORCE-001 regression.
      expect(assembled.systemPrompt, `${c.label} — agent identity`).toMatch(
        /ROLE IDENTITY|CONSTITUTION BINDING/i,
      );
    });
  }

  it('keeps the anti-hallucination section verbatim in the lean L1 tier', async () => {
    process.env.NYV_QUEEN_LEAF_L0_DOWNGRADE = '1';
    const leaf = await buildBudgetedQueenLeafPrompt({
      agentId: './jrx-criminal-karnataka',
      registrySystemPrompt: registryPrompt(),
      promptBlob: BAIL_QUERY,
      jurisdiction: 'IN',
      role: 'exploration',
      sessionId: 'sess-ah',
      resolveTurn: async () => ({ mode: 'turn1_full' as const, turnNumber: 1 }),
    });
    expect(leaf.systemPrompt).toContain('Never invent case names, citations or section numbers');
  });

  it('platform-internal (non-XML) agents still receive the grounded overlay', async () => {
    const internal = await buildBudgetedQueenLeafPrompt({
      agentId: 'queen.internal',
      registrySystemPrompt: 'You are a platform-internal routing helper.',
      promptBlob: BAIL_QUERY,
      jurisdiction: 'IN',
      role: 'exploration',
    });
    expect(internal.assemblyMode).toBe('legal-intel-merge');
    for (const [name, re] of FLOOR) {
      expect(internal.systemPrompt, `internal — ${name}`).toMatch(re);
    }
  });

  it('a non-IN jurisdiction still gets explicit jurisdiction grounding', async () => {
    const uk = await buildBudgetedQueenLeafPrompt({
      agentId: './jrx-uk-agent',
      registrySystemPrompt: registryPrompt(),
      promptBlob: 'What is the limitation period for a contract claim?',
      jurisdiction: 'UK',
      role: 'exploration',
    });
    expect(uk.systemPrompt).toMatch(/JURISDICTION: UK/);
    expect(uk.systemPrompt).toMatch(/counsel/i);
  });

  it('reports its own token accounting so the harness measures, not estimates', async () => {
    const leaf = await buildBudgetedQueenLeafPrompt({
      agentId: './jrx-criminal-karnataka',
      registrySystemPrompt: registryPrompt(),
      promptBlob: BAIL_QUERY,
      jurisdiction: 'IN',
      role: 'exploration',
    });
    expect(leaf.systemPromptTokens).toBe(estimatePromptTokens(leaf.systemPrompt));
    expect(leaf.budgetTokens).toBe(getPromptBudget(leaf.taskClass).maxPromptTokens);
  });
});
