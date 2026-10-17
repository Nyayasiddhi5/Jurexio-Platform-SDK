import { streamLLM } from '../src/services/intelligent-router/llm-orchestrator.js';
const start = Date.now();
let firstTokenAt = 0;
let total = 0;
let chunks = 0;
process.stdout.write('--- TRUE STREAMING TEST (Anthropic via NV-ROUTER-001) ---\n');
for await (const chunk of streamLLM({
  requestId: 'smoke-stream-' + Date.now(),
  systemPrompt: 'You are a senior Indian contracts lawyer.',
  userMessage: 'In ONE short paragraph (≤80 words), explain the doctrine of frustration of contract under Indian law.',
  routing: {
    agentId: 'contract-drafter',
    tier: 'pro',
    jurisdiction: 'IN',
    taskKind: 'legal_drafting',
  },
  maxTokens: 200,
  temperature: 0.3,
})) {
  if (firstTokenAt === 0) {
    firstTokenAt = Date.now() - start;
    process.stdout.write(`\n[time-to-first-token: ${firstTokenAt}ms]\n\n`);
  }
  total += chunk.length;
  chunks += 1;
  process.stdout.write(chunk);
}
process.stdout.write(`\n\n[stream complete: ${chunks} chunks, ${total} chars, total ${Date.now()-start}ms, TTFT ${firstTokenAt}ms]\n`);
