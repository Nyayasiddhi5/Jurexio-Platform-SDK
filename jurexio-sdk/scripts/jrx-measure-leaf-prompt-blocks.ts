/**
 * NV-QUEEN-TOKEN-ATTRIBUTION-001 — split a Queen leaf's BILLED prompt into its
 * blocks by differencing the real assembler.
 *
 * Why this exists separately from `_ec2-queen-stage-attribution.sh`: the two
 * corpus-dependent blocks (Auto-RAG, memory) can only be sized on the live host,
 * but `buildAgentPrompt()` is pure template code over the registry, so it is
 * measurable here — and measuring it here avoids booting the whole gateway
 * singleton just to read one string.
 *
 * Method: call the real `buildAgentPrompt` twice with request prompts of known,
 * different lengths. The growth in output per unit of input reveals how many
 * times the fused Step-0 prompt is interpolated. Nothing is estimated.
 *
 * NV-SECRETS-001: prints lengths and block labels only. Never prompt content.
 */
import { QueenOrchestrator } from '../src/orchestration/jrx-queen-orchestrator.js';
import { getActiveAgents } from '../src/config/agent-registry-loader.js';
import { jurisdictionPromptResolver } from '../src/services/jrx-jurisdiction-prompt-resolver.js';

const TOK = (chars: number) => Math.ceil(chars / 4);

async function main() {
  const orch = QueenOrchestrator.getInstance() as unknown as {
    initialize: () => Promise<void>;
    buildAgentPrompt: (a: unknown, s: unknown, r: unknown) => string;
  };
  await orch.initialize();
  // resolveAgentSystemPrompt goes through the jurisdiction resolver, which
  // refuses to serve before init() — the gateway does this at startup.
  await jurisdictionPromptResolver.init();
  /* Raw registry entries, not the orchestrator's normalised Agent (its
   * normaliser lives on a module-private class). The fields buildAgentPrompt
   * reads — id / name / tier / romaLevel / tools / capabilities / systemPrompt —
   * are all present on the raw entry, so the assembled string is the real one;
   * only defaulted tier/romaLevel labels could differ, and those are a few
   * dozen chars. */
  const agents = getActiveAgents() as unknown as Array<Record<string, unknown>>;
  console.log(`agents loaded: ${agents.length}`);
  if (!agents.length) {
    console.log('FATAL: registry empty — cannot measure.');
    process.exit(1);
  }

  // Widest registry prompt = worst case leaf, which is what the probe observed.
  const agent = agents.reduce((a, b) =>
    String((b as { systemPrompt?: string }).systemPrompt ?? '').length >
    String((a as { systemPrompt?: string }).systemPrompt ?? '').length ? b : a);

  const subtask = {
    id: 'swarm-agent-0-probe',
    description: `Swarm agent 1: Independent exploration of ${'y'.repeat(50)}...`,
    type: 'analysis',
    estimatedComplexity: 'very_complex',
    dependencies: [],
  };

  const results: Array<{ n: number; total: number }> = [];
  for (const n of [0, 1000, 5000]) {
    const req = {
      prompt: 'q'.repeat(n),
      jurisdiction: 'IN',
      type: 'analysis',
      format: 'markdown',
    };
    const built = orch.buildAgentPrompt(agent, subtask, req);
    const at = built.indexOf('\n\nTASK: ');
    results.push({ n, total: built.length });
    console.log(JSON.stringify({
      requestPromptChars: n,
      totalChars: built.length,
      totalTokens: TOK(built.length),
      systemContextChars: at >= 0 ? at : null,
      systemContextTokens: at >= 0 ? TOK(at) : null,
      scaffoldPlusRequestChars: at >= 0 ? built.length - at : null,
    }));
  }

  const [a, b] = results;
  const growthPerChar = (b.total - a.total) / (b.n - a.n);
  console.log(`\ngrowth in leaf prompt per 1 char of fused Step-0 prompt: ${growthPerChar.toFixed(2)}x`);
  console.log(growthPerChar > 1.5
    ? 'MULTIPLE interpolation: the fused Step-0 prompt is echoed more than once per leaf.'
    : 'single interpolation.');
  console.log(`fixed cost per leaf (request-independent): ${a.total.toLocaleString()} chars = ${TOK(a.total).toLocaleString()} tok`);
  process.exit(0);
}

main().catch((e) => {
  console.log('FATAL', e instanceof Error ? e.message : String(e));
  process.exit(1);
});
