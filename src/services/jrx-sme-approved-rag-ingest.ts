/**
 * Promote SME-approved LegalChat Q&A pairs into the searchable RAG corpus.
 * Fires when rubric average score meets threshold (default 0.85 / 4.25 on 1–5 scale).
 */
import { createLogger } from '../utils/logger.js';
import { ingestKnowledgeChunk } from './rag-service.js';
import { embedAndStore, type JurisdictionCode } from './jrx-rag-live-service.js';

const logger = createLogger('./jrx-sme-approved-rag');

const APPROVAL_THRESHOLD = Number(process.env.JRX_SME_RAG_APPROVAL_THRESHOLD || '0.85');

const NAMESPACE_BY_JURIS: Record<string, string> = {
  IN: 'in-sme-approved',
  UK: 'uk-sme-approved',
  US: 'us-sme-approved',
  EU: 'eu-sme-approved',
  SG: 'sg-sme-approved',
  GC: 'gc-sme-approved',
  GLOBAL: 'global-sme-approved',
};

const LIVE_JURIS: Record<string, JurisdictionCode> = {
  IN: 'IN', UK: 'UK', US: 'US', EU: 'EU', SG: 'SG', GC: 'GCC', GLOBAL: 'IN',
};

export async function ingestApprovedChatToRag(opts: {
  orchestrationId: string;
  jurisdiction: string;
  taskKind: string;
  prompt: string;
  response: string;
  avgScore: number;
  smeUserId: number;
  feedbackId?: number | string;
  ratings?: Record<string, unknown>;
}): Promise<{ ingested: boolean; reason?: string }> {
  if (opts.avgScore < APPROVAL_THRESHOLD) {
    return { ingested: false, reason: 'below_threshold' };
  }
  if (!opts.response?.trim() || opts.response.length < 40) {
    return { ingested: false, reason: 'response_too_short' };
  }

  const jur = String(opts.jurisdiction || 'GLOBAL').toUpperCase();
  const namespace = NAMESPACE_BY_JURIS[jur] || NAMESPACE_BY_JURIS.GLOBAL;
  const liveJur = LIVE_JURIS[jur] || 'IN';
  const title = `SME-approved ${opts.taskKind} (${jur}) — ${opts.orchestrationId.slice(0, 8)}`;
  const content = [
    `Question: ${opts.prompt.trim()}`,
    '',
    `Approved answer (SME verified, score ${(opts.avgScore * 100).toFixed(0)}%):`,
    opts.response.trim(),
    '',
    `Task: ${opts.taskKind} | Jurisdiction: ${jur} | Orchestration: ${opts.orchestrationId}`,
  ].join('\n');

  try {
    await ingestKnowledgeChunk({
      source: `legalchat:sme:${opts.smeUserId}`,
      title,
      content,
      jurisdiction: jur === 'GLOBAL' ? 'IN' : jur,
      domain: opts.taskKind || 'sme_approved',
      citationRef: `SME-APPROVED-${opts.orchestrationId}`,
    });

    await embedAndStore(
      content,
      {
        contentType: 'sme_approved',
        orchestrationId: opts.orchestrationId,
        taskKind: opts.taskKind,
        smeUserId: opts.smeUserId,
        avgScore: opts.avgScore,
        feedbackId: opts.feedbackId,
        source: 'legalchat_feedback',
      },
      namespace,
      liveJur,
    );

    logger.info('SME-approved chat ingested to RAG', {
      orchestrationId: opts.orchestrationId,
      jurisdiction: jur,
      avgScore: opts.avgScore,
    });
    return { ingested: true };
  } catch (e) {
    logger.warn('SME-approved RAG ingest failed', { error: (e as Error).message });
    return { ingested: false, reason: (e as Error).message };
  }
}
