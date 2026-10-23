/**
 * NV-DOCPARSE-NSP-EVIDENCE-DEPICT-001 — bounded vision caption for case evidence (NSP-only).
 * Descriptive only — not medical diagnosis or legal conclusions.
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { createLogger } from '../utils/logger.js';
import { isJrxFeatureOn } from '../config/jrx-feature-flags.js';

const logger = createLogger('./jrx-docparse-nsp-evidence-depict');

const DEPICT_SCHEMA = z
  .object({
    depiction: z.string().max(2000),
    visible_text: z.string().max(1200).optional(),
    limitations: z.string().max(800),
    suggested_tags: z.array(z.string().max(64)).max(12).optional(),
    pii_flags: z.array(z.string().max(64)).max(8).optional(),
  })
  .strict();

export interface NspEvidenceDepictRequest {
  bytes: Buffer;
  fileName: string;
  mimeType?: string;
  pageNo?: number;
  /** Optional OCR / local visible text from NSP (never required). */
  localVisibleText?: string;
  userQuestion?: string;
  jurisdiction?: string;
  actor?: string;
}

export interface NspEvidenceDepictResponse {
  mode: 'nsp-evidence-depict';
  contentSha256: string;
  depiction: {
    text: string;
    limitations: string;
    suggestedTags: string[];
    piiFlags: string[];
    visibleText?: string;
  };
  model?: string;
  promptVersion: string;
}

const PROMPT_VERSION = 'evidence-depict-v1';

function toDataUrl(bytes: Buffer, mimeType?: string): string {
  const mime = mimeType && mimeType.startsWith('image/') ? mimeType : 'image/jpeg';
  return `data:${mime};base64,${bytes.toString('base64')}`;
}

export async function runNspEvidenceDepict(
  req: NspEvidenceDepictRequest,
): Promise<NspEvidenceDepictResponse> {
  if (!isJrxFeatureOn('docparseEvidenceDepict')) {
    throw new Error('DOCPARSE_EVIDENCE_DEPICT_DISABLED');
  }
  if (!req.bytes?.length) {
    throw new Error('Empty document bytes');
  }

  const contentSha256 = createHash('sha256').update(req.bytes).digest('hex');
  const dataUrl = toDataUrl(req.bytes, req.mimeType);
  const question = (req.userQuestion ?? 'What does this case document or image appear to show?').slice(0, 500);
  const ocrHint = req.localVisibleText?.trim().slice(0, 1500);

  const systemPrompt = [
    'You assist Indian legal case intake with factual visual description only.',
    'Use cautious language ("appears to show", "may depict").',
    'Do NOT diagnose medical conditions or state legal conclusions.',
    'Do NOT invent names, dates, or identifiers not visible.',
    'Return JSON only with keys: depiction, visible_text (optional), limitations, suggested_tags, pii_flags.',
  ].join(' ');

  const userPrompt = [
    question,
    ocrHint ? `\nOCR/local visible text (may be incomplete):\n${ocrHint}` : '',
    '\nDescribe what is visible for a lawyer reviewing case evidence.',
  ].join('');

  const { executeVisionJsonLlm } = await import('./jrx-vision-json-llm.js');
  let resp: { content: string; model: string };
  try {
    resp = await executeVisionJsonLlm({
      systemPrompt,
      userPrompt,
      imageDataUrl: dataUrl,
      maxTokens: 900,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.startsWith('VISION_LLM_UNAVAILABLE') || msg.includes('VISION_LLM_NO_')) {
      throw new Error('VISION_LLM_UNAVAILABLE');
    }
    throw err;
  }

  const raw = String(resp.content ?? '');
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    logger.warn('evidence depict: no json', { fileName: req.fileName, shaLen: contentSha256.length });
    throw new Error('EVIDENCE_DEPICT_PARSE_FAILED');
  }

  const parsed = DEPICT_SCHEMA.safeParse(JSON.parse(jsonMatch[0]));
  if (!parsed.success) {
    throw new Error('EVIDENCE_DEPICT_SCHEMA_FAILED');
  }

  logger.info('evidence depict done', {
    fileName: req.fileName,
    byteLen: req.bytes.length,
    model: resp?.model,
    actor: req.actor,
  });

  return {
    mode: 'nsp-evidence-depict',
    contentSha256,
    depiction: {
      text: parsed.data.depiction.trim(),
      limitations: parsed.data.limitations.trim(),
      suggestedTags: parsed.data.suggested_tags ?? [],
      piiFlags: parsed.data.pii_flags ?? [],
      visibleText: parsed.data.visible_text?.trim(),
    },
    model: resp?.model,
    promptVersion: PROMPT_VERSION,
  };
}
