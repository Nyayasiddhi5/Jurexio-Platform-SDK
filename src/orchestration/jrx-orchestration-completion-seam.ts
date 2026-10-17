/**
 * NV-ORCH-COMPLETION-SEAM-001 — shared completion loop hook for Queen + specialist paths.
 */

import type { Request } from 'express';
import {
  buildPartnerCompletionEnvelope,
  parsePartnerContinuationInput,
  runOrchestrateCompletionLoop,
  type PartnerCompletionEnvelope,
} from '../services/jrx-ai-completion-loop.js';

export async function applyOrchestrationCompletionSeam(input: {
  req: Request;
  content: string;
  taskType?: string;
  userPrompt: string;
  requestId: string;
  documentType?: string;
  parameters?: Record<string, unknown>;
}): Promise<{ content: string; completion: PartnerCompletionEnvelope }> {
  const cont = parsePartnerContinuationInput(input.req);
  const loop = await runOrchestrateCompletionLoop({
    req: input.req,
    content: input.content,
    taskType: input.taskType,
    userPrompt: input.userPrompt,
    documentType: input.documentType,
    parameters: input.parameters,
    segmentIndex: cont.active ? cont.segmentIndex : 0,
  });

  const completion = buildPartnerCompletionEnvelope({
    content: loop.content,
    taskType: input.taskType,
    continuationCount: loop.continuationCount,
    segmentIndex: loop.segmentIndex,
    requestId: input.requestId,
  });

  return { content: loop.content, completion };
}
