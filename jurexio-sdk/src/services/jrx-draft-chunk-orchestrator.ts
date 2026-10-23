/**
 * NV-DRAFT-CHUNK-001 — execute multi-chunk complex_agreement generation on legal-draft-fast path.
 */

import { executeWithFullSafetyRing } from '../orchestration/jrx-sdk-orchestration-wrapper.js';
import type { DraftChunkPlan } from './jrx-draft-chunk-planner.js';
import {
  extractDefinitionsRegistry,
  stitchDraftChunks,
  type DraftChunkResult,
  type SharedDefinitionsRegistry,
} from './jrx-draft-chunk-stitcher.js';
import type { DraftDocumentType } from '../config/jrx-draft-length-registry.js';

export interface ChunkedDraftExecutionInput {
  requestId: string;
  userId: string;
  tenantId?: string;
  prompt: string;
  systemPrompt?: string;
  taskType?: string;
  jurisdiction?: string;
  tier?: string;
  agentKey?: string;
  chunks: DraftChunkPlan[];
  documentType: DraftDocumentType;
  enableRAG?: boolean;
  enableMemory?: boolean;
  enableCoT?: boolean;
  enableHallucinationCheck?: boolean;
  enableCitationVerification?: boolean;
  matterId?: string;
  ragDocumentIds?: string[];
}

export interface ChunkedDraftExecutionResult {
  content: string;
  model?: string;
  provider?: string;
  tokens: { prompt: number; completion: number; total: number };
  responseTime: number;
  orchestration?: Record<string, unknown>;
  metadata: {
    chunked: true;
    chunkCount: number;
    appendedClosure: boolean;
    phases: string[];
    definitionsCount: number;
  };
}

export async function executeChunkedDraftGeneration(
  input: ChunkedDraftExecutionInput,
): Promise<ChunkedDraftExecutionResult> {
  const started = Date.now();
  const chunkResults: DraftChunkResult[] = [];
  let priorContext = '';
  let definitionsRegistry: SharedDefinitionsRegistry = { terms: [] };
  let totalPrompt = 0;
  let totalCompletion = 0;
  let lastModel: string | undefined;
  let lastProvider: string | undefined;
  let lastOrchestration: Record<string, unknown> | undefined;

  for (const plan of input.chunks) {
    const registryBlock = definitionsRegistry.terms.length
      ? [
          'SHARED DEFINITIONS REGISTRY (use consistently — do not redefine):',
          definitionsRegistry.terms.map((t) => `- "${t}"`).join('\n'),
          '',
        ].join('\n')
      : '';
    const chunkPrompt = priorContext
      ? [
          'PRIOR DRAFT CONTEXT (do not repeat verbatim — continue consistently):',
          priorContext.slice(-12_000),
          '',
          registryBlock,
          plan.instruction,
        ].join('\n')
      : [registryBlock, plan.instruction].filter(Boolean).join('\n');

    const wrapped = await executeWithFullSafetyRing(
      {
        id: `${input.requestId}-chunk-${plan.index}`,
        userId: input.userId,
        prompt: chunkPrompt,
        systemPrompt: input.systemPrompt || 'You are an expert Indian commercial contract drafter.',
        maxTokens: plan.maxTokens,
        timestamp: new Date(),
        requirements: {
          complexity: 'complex',
          domain: 'analytical',
          priority: 'high',
          costBudget: 'premium',
          responseTime: 'balanced',
          qualityLevel: 'expert',
        },
        fallbackLevels: 5,
      },
      {
        sdkPlatform: './jrx-orchestration',
        ctx: { tenantId: input.tenantId, userId: input.userId },
        agentKey: input.agentKey || 'auto',
        jurisdiction: input.jurisdiction || 'IN',
        taskType: input.taskType,
        tier: input.tier,
        enableHallucinationCheck: input.enableHallucinationCheck,
        enableCitationVerification: input.enableCitationVerification,
        enableRAG: input.enableRAG,
        enableMemory: input.enableMemory,
        enableCoT: input.enableCoT,
        matterId: input.matterId,
        ragDocumentIds: input.ragDocumentIds,
      },
    );

    const content = String(wrapped.content || '').trim();
    chunkResults.push({ plan, content });
    const extracted = extractDefinitionsRegistry(content);
    if (extracted.terms.length) {
      definitionsRegistry = {
        terms: [...new Set([...definitionsRegistry.terms, ...extracted.terms])],
      };
    }
    priorContext = chunkResults.map((c) => c.content).join('\n\n');

    const tok = wrapped.tokens as Record<string, number> | undefined;
    totalPrompt += tok?.prompt ?? tok?.input ?? 0;
    totalCompletion += tok?.completion ?? tok?.output ?? 0;
    lastModel = wrapped.model;
    lastProvider = wrapped.provider;
    lastOrchestration = wrapped.orchestration as unknown as Record<string, unknown> | undefined;
  }

  const stitched = stitchDraftChunks(chunkResults, input.documentType, definitionsRegistry);
  return {
    content: stitched.content,
    model: lastModel,
    provider: lastProvider,
    tokens: {
      prompt: totalPrompt,
      completion: totalCompletion,
      total: totalPrompt + totalCompletion,
    },
    responseTime: Date.now() - started,
    orchestration: lastOrchestration,
    metadata: {
      chunked: true,
      chunkCount: stitched.chunkCount,
      appendedClosure: stitched.appendedClosure,
      phases: input.chunks.map((c) => c.phase),
      definitionsCount: stitched.definitionsRegistry.terms.length,
    },
  };
}
