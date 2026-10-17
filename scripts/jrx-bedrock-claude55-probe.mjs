#!/usr/bin/env node
/**
 * NV-BEDROCK-CLAUDE55-PROBE-001 — InvokeModel matrix for Claude 5.5 family (no secrets logged).
 * Usage: node scripts/nv-bedrock-claude55-probe.mjs
 * EC2: docker exec nyv-gateway node /app/scripts/nv-bedrock-claude55-probe.mjs
 */
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

const REGIONS = (process.env.NYV_BEDROCK_PROBE_REGIONS || 'us-east-1,ap-south-1').split(',').map((s) => s.trim()).filter(Boolean);

const MODELS = [
  'global.anthropic.claude-haiku-5-5',
  'global.anthropic.claude-sonnet-5-5',
  'us.anthropic.claude-opus-5-5',
  'global.anthropic.claude-opus-5-5',
];

function bodyForModel(modelId) {
  const base = {
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: 64,
    messages: [{ role: 'user', content: 'Reply with exactly: BEDROCK_CLAUDE55_OK' }],
  };
  if (modelId.includes('haiku-5-5')) {
    return { ...base, thinking: { type: 'disabled' }, output_config: { effort: 'low' } };
  }
  return base;
}

async function probe(region, modelId) {
  const t0 = Date.now();
  try {
    const client = new BedrockRuntimeClient({ region });
    const out = await client.send(new InvokeModelCommand({
      modelId,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify(bodyForModel(modelId)),
    }));
    const parsed = JSON.parse(new TextDecoder().decode(out.body));
    const usage = parsed.usage || {};
    const text = (parsed.content || [])
      .filter((b) => b?.type === 'text')
      .map((b) => b.text)
      .join('')
      .slice(0, 40);
    return {
      region,
      modelId,
      http: '200',
      ms: Date.now() - t0,
      tokensIn: usage.input_tokens ?? 0,
      tokensOut: usage.output_tokens ?? 0,
      textPreviewLen: text.length,
    };
  } catch (e) {
    return {
      region,
      modelId,
      http: 'ERR',
      ms: Date.now() - t0,
      err: String(e?.name || e?.message || e).slice(0, 120),
    };
  }
}

const results = [];
for (const region of REGIONS) {
  for (const modelId of MODELS) {
    results.push(await probe(region, modelId));
  }
}

console.log(JSON.stringify({ probe: 'NV-BEDROCK-CLAUDE55-PROBE-001', results }, null, 2));
const ok = results.filter((r) => r.http === '200').length;
process.exit(ok > 0 ? 0 : 1);
