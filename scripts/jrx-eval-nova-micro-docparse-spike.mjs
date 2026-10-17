#!/usr/bin/env node
/**
 * NV-DOCPARSE-LLM-FALLBACK-001 — standalone Bedrock spike for the docparse
 * low-confidence recovery pass.
 *
 * Proves (NV-EXECUTE-BEFORE-CLAIM-001 / NV-VALIDATE-THE-PROBE-001) that Amazon
 * Nova Micro on Bedrock ap-south-1 answers a `toolConfig` (tool-schema) request
 * with a structured court-document field object — the exact contract
 * src/services/nv-docparse-llm-fallback.ts relies on. It does NOT touch the
 * running platform, DB, or any secret file; it only exercises the model.
 *
 * Usage:
 *   node scripts/nv-eval-nova-micro-docparse-spike.mjs [--model <id>] [--region <r>]
 *
 * Env (no secrets committed — supply at run time):
 *   AWS_REGION / NV_BEDROCK_REGION   Bedrock region (default: ap-south-1)
 *   NV_NOVA_MICRO_MODEL_ID           model / inference-profile id
 *                                    (default: apac.amazon.nova-micro-v1:0)
 *   Credentials — ANY of:
 *     AWS_BEARER_TOKEN_BEDROCK / BEDROCK_API_KEY      (Bedrock API key), OR
 *     AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY (+ AWS_SESSION_TOKEN), OR
 *     an EC2/instance IAM role (default credential provider chain).
 *   The gateway host (caselaw-worker / nysdev) already carries a Bedrock-enabled
 *   role, so this is best run there via SSM when local creds lack bedrock:Invoke*.
 *
 * Positive control: the run FAILS loudly unless stopReason === 'tool_use' AND the
 * returned tool input parses as an object — an impossible/empty shape means the
 * instrument (or model access) failed, not that Nova Micro "can't extract".
 */

const args = process.argv.slice(2);
function argOf(name, fallback) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

const REGION = argOf('--region', process.env.NV_BEDROCK_REGION || process.env.AWS_REGION || 'ap-south-1');
const MODEL_ID = argOf('--model', process.env.NV_NOVA_MICRO_MODEL_ID || 'apac.amazon.nova-micro-v1:0');

const SAMPLE_DOC = `IN THE HIGH COURT OF ANDHRA PRADESH AT AMARAVATI
Writ Petition (Criminal) No. 832 of 2023
CNR: APHC010000832023
Between:
  Sri Rama Rao S/o Venkata Rao ... PETITIONER
  vs.
  State of Andhra Pradesh & Ors. ... RESPONDENTS
Crime No. 45 of 2023, Vijayawada City Police Station.
Under Sections 420, 406 of the Indian Penal Code, 1860.
Counsel for Petitioner: Sri K. Subramanyam, Advocate.`;

const TOOL_SPEC = {
  name: 'extract_court_fields',
  description: 'Return only the Indian court-document metadata fields present verbatim in the text. Omit any field not found. Never guess.',
  inputSchema: {
    json: {
      type: 'object',
      properties: {
        cnr: { type: 'string' },
        court: { type: 'string' },
        case_type: { type: 'string' },
        case_year: { type: 'string' },
        filing_number: { type: 'string' },
        fir_number: { type: 'string' },
        police_station: { type: 'string' },
        statutes_invoked: { type: 'string' },
        petitioner: { type: 'string' },
        respondent: { type: 'string' },
        advocate: { type: 'string' },
        document_type: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
};

function resolveClientConfig() {
  const token =
    process.env.AWS_BEARER_TOKEN_BEDROCK ||
    process.env[`AWS_BEARER_TOKEN_BEDROCK_${REGION.toUpperCase().replace(/-/g, '_')}`] ||
    process.env.BEDROCK_API_KEY ||
    '';
  if (token) {
    return { region: REGION, token: { token }, authSchemePreference: ['httpBearerAuth'] };
  }
  return { region: REGION }; // default credential provider chain (env keys / IAM role)
}

async function main() {
  let BedrockRuntimeClient, ConverseCommand;
  try {
    ({ BedrockRuntimeClient, ConverseCommand } = await import('@aws-sdk/client-bedrock-runtime'));
  } catch (e) {
    console.error('FAIL: @aws-sdk/client-bedrock-runtime not installed —', e.message);
    process.exit(3);
  }

  const client = new BedrockRuntimeClient(resolveClientConfig());
  const cmd = new ConverseCommand({
    modelId: MODEL_ID,
    system: [
      {
        text: 'You are a precise Indian legal document field extractor. Use the extract_court_fields tool. Never invent facts, parties, citations, or numbers.',
      },
    ],
    messages: [
      {
        role: 'user',
        content: [{ text: `Extract the court-document fields from this text:\n\n${SAMPLE_DOC}` }],
      },
    ],
    toolConfig: {
      tools: [{ toolSpec: TOOL_SPEC }],
      toolChoice: { tool: { name: TOOL_SPEC.name } },
    },
    inferenceConfig: { maxTokens: 1024, temperature: 0 },
  });

  console.log(`=== nova-micro docparse spike — region=${REGION} model=${MODEL_ID} ===`);
  const t0 = Date.now();
  let resp;
  try {
    resp = await client.send(cmd);
  } catch (e) {
    console.error(`FAIL: Bedrock Converse error: ${e.name}: ${e.message}`);
    if (/AccessDenied|Unrecognized|not authorized|security token/i.test(String(e.message))) {
      console.error('HINT: local credentials likely lack bedrock:InvokeModel — re-run on the gateway host (EC2 role) via SSM.');
    }
    process.exit(2);
  }
  const latencyMs = Date.now() - t0;

  const stopReason = resp.stopReason;
  const usage = resp.usage || {};
  const blocks = resp.output?.message?.content || [];
  const toolUse = blocks.find((b) => b.toolUse)?.toolUse;

  console.log(`latencyMs=${latencyMs}`);
  console.log(`stopReason=${stopReason}`);
  console.log(`tokens_in=${usage.inputTokens ?? '?'} tokens_out=${usage.outputTokens ?? '?'}`);

  // Positive control — an impossible/empty shape means the instrument failed.
  if (stopReason !== 'tool_use' || !toolUse || typeof toolUse.input !== 'object') {
    console.error('FAIL: no tool_use block returned — instrument/model-access failure, not a Nova Micro extraction verdict.');
    console.error(JSON.stringify(blocks, null, 2).slice(0, 2000));
    process.exit(1);
  }

  const extracted = toolUse.input;
  const keys = Object.keys(extracted);
  console.log(`extracted_keys=${keys.length}`);
  console.log(JSON.stringify(extracted, null, 2));

  // Sanity: the CNR is in the sample verbatim; a correct extractor should surface it.
  const cnrOk = String(extracted.cnr || '').toUpperCase().includes('APHC010000832023');
  console.log(`cnr_recovered=${cnrOk}`);
  console.log('=== PASS: Nova Micro returned a structured tool object ===');
  process.exit(0);
}

main().catch((e) => {
  console.error('FAIL: unexpected —', e);
  process.exit(1);
});
