/**
 * NV-ROUTER-001 smoke test.
 * Runs three real LLM calls through the orchestrator and prints routing decisions,
 * which model was actually called, fallback level, latency, and a token sample.
 */
import { orchestrateLLM } from '../src/services/intelligent-router/llm-orchestrator.js';

async function run() {
  const cases = [
    {
      label: 'enterprise · IN · contract drafting (Claude expected)',
      input: {
        requestId: 'smoke-1',
        systemPrompt: 'You are a senior commercial drafter. Be terse.',
        userMessage: 'Draft a one-sentence confidentiality clause for a SaaS NDA between two Indian companies.',
        maxTokens: 200,
        temperature: 0.2,
        routing: {
          agentId: 'contract-drafter',
          tier: 'enterprise',
          jurisdiction: 'IN',
          taskKind: 'legal_drafting',
          userId: 'smoke-user',
          organizationId: 'smoke-org',
        },
      },
    },
    {
      label: 'solo · US · cheap classification (gpt-4.1-mini expected)',
      input: {
        requestId: 'smoke-2',
        systemPrompt: 'Classify the deadline category in one word.',
        userMessage: 'Statute of limitations for breach of written contract in California.',
        maxTokens: 50,
        temperature: 0,
        routing: {
          agentId: 'deadline-calculator',
          tier: 'solo',
          jurisdiction: 'US',
          taskKind: 'classification',
          userId: 'smoke-user',
        },
      },
    },
    {
      label: 'pro · UK · CoT reasoning',
      input: {
        requestId: 'smoke-3',
        systemPrompt: 'Reason step by step.',
        userMessage: 'Two paragraphs: explain the doctrine of frustration in English contract law.',
        maxTokens: 300,
        temperature: 0.3,
        routing: {
          agentId: 'senior-litigation-strategist',
          tier: 'pro',
          jurisdiction: 'UK',
          taskKind: 'chain_of_thought',
          userId: 'smoke-user',
          requireReasoning: true,
        },
      },
    },
  ];

  for (const c of cases) {
    console.log('\n==============================================');
    console.log(c.label);
    console.log('----------------------------------------------');
    const out = await orchestrateLLM(c.input as any);
    console.log(JSON.stringify({
      primary: out.routerDecision.primary,
      sequence: out.routerDecision.sequence.slice(0, 5),
      pickedModel: out.model,
      provider: out.provider,
      fallbackLevel: out.fallbackLevel,
      isSimulation: out.isSimulation,
      latencyMs: out.latencyMs,
      tokens: { in: out.tokensIn, out: out.tokensOut },
      costUsd: Number(out.costUsd.toFixed(6)),
      attempts: out.attempts.map(a => ({ id: a.modelId, ok: a.ok, ms: a.latencyMs, err: a.error?.slice(0, 80) })),
      contentSample: out.content.slice(0, 220),
    }, null, 2));
  }
}

run().catch((e) => { console.error('SMOKE FAIL', e); process.exit(1); });
