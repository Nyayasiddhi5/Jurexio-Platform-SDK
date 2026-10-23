/**
 * NV-DRAFT-CHUNK-001 — multi-chunk plan for long complex agreements.
 *
 * When `complex_agreement` is requested at comprehensive tier or with >40K output
 * tokens, split generation into outline → operative clause(s) → boilerplate.
 */

import type { DraftDocumentType, DraftLengthTier } from '../config/jrx-draft-length-registry.js';
import { resolveDraftOutputTokens } from '../config/jrx-draft-length-registry.js';

export type DraftChunkPhase = 'outline' | 'operative' | 'boilerplate';

export interface DraftChunkPlan {
  phase: DraftChunkPhase;
  index: number;
  label: string;
  instruction: string;
  maxTokens: number;
}

export interface ChunkPlannerInput {
  prompt: string;
  documentType: DraftDocumentType;
  tier: DraftLengthTier;
  totalTokens: number;
  parameters?: Record<string, unknown>;
}

const COMPLEX_AGREEMENT_CHUNK_THRESHOLD = 40_000;

export function shouldUseChunkedDraftGeneration(input: {
  documentType: DraftDocumentType;
  tier: DraftLengthTier;
  totalTokens: number;
}): boolean {
  if (input.documentType !== 'complex_agreement') return false;
  if (input.tier === 'comprehensive') return true;
  return input.totalTokens > COMPLEX_AGREEMENT_CHUNK_THRESHOLD;
}

function partyContext(params?: Record<string, unknown>): string {
  if (!params) return '';
  const parts: string[] = [];
  for (const key of ['partyA', 'partyB', 'vendor', 'customer', 'buyer', 'seller']) {
    const v = params[key];
    if (v != null && String(v).trim()) parts.push(`${key}: ${String(v).trim()}`);
  }
  return parts.length ? `\nParties/context: ${parts.join('; ')}` : '';
}

export function planDraftChunks(input: ChunkPlannerInput): DraftChunkPlan[] {
  const basePrompt = String(input.prompt || '').trim();
  const ctx = partyContext(input.parameters);
  const total = Math.max(input.totalTokens, 8_000);
  const outlineTokens = Math.min(16_000, Math.floor(total * 0.2));
  const boilerplateTokens = Math.min(12_000, Math.floor(total * 0.15));
  const operativeBudget = Math.max(20_000, total - outlineTokens - boilerplateTokens);
  const operativeChunkTokens = Math.min(32_000, Math.floor(operativeBudget / 2));

  const outline: DraftChunkPlan = {
    phase: 'outline',
    index: 0,
    label: 'Outline — parties, recitals, definitions',
    instruction: [
      'Draft ONLY the opening structure for a complex commercial agreement (India law).',
      'Include: title, date line, party identification blocks, recitals/background, and a Definitions section.',
      'Use [[PLACEHOLDER: …]] for unknown particulars.',
      'Do NOT draft operative clauses, schedules, or execution blocks yet.',
      ctx,
      `\nUser brief:\n${basePrompt}`,
    ].join('\n'),
    maxTokens: outlineTokens,
  };

  const operative1: DraftChunkPlan = {
    phase: 'operative',
    index: 1,
    label: 'Operative clauses — part 1',
    instruction: [
      'Continue the complex agreement. Draft operative clauses PART 1 only:',
      'consideration/transaction, representations, covenants, and conditions precedent.',
      'Assume the outline (parties, recitals, definitions) already exists above this chunk.',
      'Number clauses consistently. Use [[PLACEHOLDER: …]] where facts are missing.',
      ctx,
      `\nUser brief:\n${basePrompt}`,
    ].join('\n'),
    maxTokens: operativeChunkTokens,
  };

  const operative2: DraftChunkPlan = {
    phase: 'operative',
    index: 2,
    label: 'Operative clauses — part 2',
    instruction: [
      'Continue the complex agreement. Draft operative clauses PART 2 only:',
      'indemnity, limitation of liability, confidentiality, IP, termination, dispute resolution, and general clauses.',
      'Do NOT repeat recitals/definitions. Do NOT add execution/witness blocks yet.',
      ctx,
      `\nUser brief:\n${basePrompt}`,
    ].join('\n'),
    maxTokens: operativeChunkTokens,
  };

  const boilerplate: DraftChunkPlan = {
    phase: 'boilerplate',
    index: 3,
    label: 'Boilerplate + execution block',
    instruction: [
      'Complete the complex agreement with boilerplate and execution sections only:',
      'notices, assignment, entire agreement, severability, governing law (India), schedules placeholder list,',
      'IN WITNESS WHEREOF execution block, signature lines, and witness blocks.',
      'Assume all operative clauses already exist above.',
      ctx,
      `\nUser brief:\n${basePrompt}`,
    ].join('\n'),
    maxTokens: boilerplateTokens,
  };

  return [outline, operative1, operative2, boilerplate];
}

export function resolveChunkedDraftPlan(body: Record<string, unknown>, prompt: string): {
  useChunks: boolean;
  documentType: DraftDocumentType;
  tier: DraftLengthTier;
  totalTokens: number;
  chunks: DraftChunkPlan[];
} | null {
  const params = body.parameters && typeof body.parameters === 'object'
    ? (body.parameters as Record<string, unknown>)
    : {};
  const options = body.options && typeof body.options === 'object'
    ? (body.options as Record<string, unknown>)
    : {};
  const resolution = resolveDraftOutputTokens({
    documentType: params.documentType ?? body.documentType,
    draftLength: options.draftLength ?? body.draftLength,
    taskType: body.taskType,
    prompt,
    parameters: params,
    options,
    body,
  });
  const useChunks = shouldUseChunkedDraftGeneration({
    documentType: resolution.documentType,
    tier: resolution.tier,
    totalTokens: resolution.tokens,
  });
  if (!useChunks) return null;
  return {
    useChunks: true,
    documentType: resolution.documentType,
    tier: resolution.tier,
    totalTokens: resolution.tokens,
    chunks: planDraftChunks({
      prompt,
      documentType: resolution.documentType,
      tier: resolution.tier,
      totalTokens: resolution.tokens,
      parameters: params,
    }),
  };
}
