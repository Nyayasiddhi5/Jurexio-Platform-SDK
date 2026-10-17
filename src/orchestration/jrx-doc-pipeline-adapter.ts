/**
 * NV-DOC-PIPELINE-ADAPTER-001 — invoke AdaptiveRouter-selected document leaves
 * under the capability manifest, then optionally fall through to specialist LLM.
 */

import { capabilityManifest } from './capability-manifest.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('doc-pipeline-adapter');

export interface DocPipelineInvokeResult {
  invoked: boolean;
  capabilityId?: string;
  output?: unknown;
  content?: string;
  error?: string;
}

export async function tryInvokeDocPipelineLeaves(opts: {
  capabilityIds: string[];
  prompt: string;
  body: Record<string, unknown>;
  tenantId?: string;
  userId?: string;
  jurisdiction?: string;
  language?: string;
  requestId: string;
}): Promise<DocPipelineInvokeResult> {
  const ctx = {
    tenantId: opts.tenantId,
    userId: opts.userId,
    jurisdiction: opts.jurisdiction || 'IN',
    language: opts.language || 'en',
    requestId: opts.requestId,
    tier: 'pro' as const,
  };

  const text =
    (typeof opts.body.text === 'string' && opts.body.text)
    || (typeof opts.body.documentText === 'string' && opts.body.documentText)
    || opts.prompt;

  const filePath =
    (typeof opts.body.filePath === 'string' && opts.body.filePath)
    || (typeof opts.body.path === 'string' && opts.body.path)
    || undefined;

  const documentA =
    (typeof opts.body.documentA === 'string' && opts.body.documentA)
    || (typeof opts.body.textA === 'string' && opts.body.textA)
    || undefined;
  const documentB =
    (typeof opts.body.documentB === 'string' && opts.body.documentB)
    || (typeof opts.body.textB === 'string' && opts.body.textB)
    || undefined;

  for (const id of opts.capabilityIds) {
    try {
      // NV-OCR-ASYNC-001 — large OCR jobs should not block sync /orchestrate
      const pageCount = Number(opts.body.pageCount || opts.body.pages || 0);
      const fileBytes = Number(opts.body.fileSizeBytes || opts.body.sizeBytes || 0);
      const asyncThresholdPages = Number(process.env.JRX_OCR_ASYNC_MIN_PAGES || '25');
      const asyncThresholdBytes = Number(process.env.JRX_OCR_ASYNC_MIN_BYTES || String(8 * 1024 * 1024));
      const isOcrLeaf = id.includes('ocr') || /\bocr\b/i.test(opts.prompt);
      if (
        isOcrLeaf
        && (pageCount >= asyncThresholdPages || fileBytes >= asyncThresholdBytes)
        && opts.body.async !== true
        && opts.body.forceSync !== true
      ) {
        const msg = [
          '## Large document — async OCR recommended',
          '',
          `Detected ~${pageCount || '?'} pages / ${fileBytes || '?'} bytes. Sync orchestration is capped for quality; submit via Document AI Hub / DMS OCR queue (job timeout 600s) with \`async: true\`, then poll job status.`,
          '',
          'Pass `forceSync: true` only for urgent small batches.',
        ].join('\n');
        return { invoked: true, capabilityId: id, content: msg, output: { asyncRequired: true, pageCount, fileBytes } };
      }

      const input: Record<string, unknown> = {
        text,
        prompt: opts.prompt,
        query: opts.prompt,
        content: text,
        ...(filePath ? { filePath } : {}),
        ...(opts.body.op ? { op: opts.body.op } : {}),
        jurisdiction: opts.jurisdiction || 'IN',
        language: opts.language || 'en',
      };
      // Auto-op for sdk.document-pipeline when AdaptiveRouter selected compare/classify
      if (id === 'sdk.document-pipeline' && !input.op) {
        if (documentA && documentB) {
          input.op = 'compare';
          input.documentA = documentA;
          input.documentB = documentB;
        } else if (/\bcompar|\bdiff\b/i.test(opts.prompt)) {
          input.op = 'compare';
          if (documentA) input.documentA = documentA;
          if (documentB) input.documentB = documentB;
        } else if (/\bclassif/i.test(opts.prompt)) {
          input.op = 'classify';
        }
      }
      if (documentA) input.documentA = documentA;
      if (documentB) input.documentB = documentB;
      const out = await capabilityManifest.invoke(id, input, ctx as any);
      const content =
        typeof out === 'string'
          ? out
          : (out && typeof out === 'object' && 'content' in (out as any))
            ? String((out as any).content ?? '')
            : (out && typeof out === 'object' && 'text' in (out as any))
              ? String((out as any).text ?? '')
              : JSON.stringify(out ?? null);

      if (content && content !== 'null' && content !== '{}') {
        logger.info('[doc-pipeline] leaf invoked', { id, requestId: opts.requestId, len: content.length });
        return { invoked: true, capabilityId: id, output: out, content };
      }
    } catch (err: any) {
      logger.warn('[doc-pipeline] leaf invoke failed (try next)', {
        id, err: err?.message, requestId: opts.requestId,
      });
    }
  }

  return { invoked: false, error: 'no leaf produced content — fall through to specialist' };
}

export function docPipelineSystemPrompt(docTask?: string, language?: string): string {
  const lang = language && language !== 'en'
    ? ` Respond in language code "${language}" when the user wrote in that script.`
    : '';
  switch (docTask) {
    case 'ocr':
      return `You are Jurexio document OCR intelligence. Extract clean text, structure tables, note confidence. Jurisdiction-aware legal OCR.${lang}`;
    case 'parse':
      return `You are Jurexio legal document parser. Structure clauses, parties, dates, obligations.${lang}`;
    case 'embed':
      return `You are Jurexio embedding assistant. Produce chunk-ready summaries suitable for vector indexing.${lang}`;
    case 'classify':
      return `You are Jurexio document classifier. Return document type, practice area, risk tags, jurisdiction.${lang}`;
    case 'compare':
      return `You are Jurexio document comparison specialist. Diff clauses, risks, and material changes.${lang}`;
    case 'summarize':
      return `You are Jurexio legal summarizer. Produce executive summary, key holdings, and action items.${lang}`;
    case 'doc_analyze':
      return `You are Jurexio document risk analyst. Flag risks, missing clauses, compliance gaps.${lang}`;
    case 'multimodal':
      return `You are Jurexio multimodal legal assistant for voice/vision document tasks.${lang}`;
    case 'language':
      return `You are Jurexio multilingual legal assistant. Preserve legal meaning across languages.${lang}`;
    case 'extract':
      return `You are Jurexio legal extraction agent. Extract parties, citations, dates, amounts precisely.${lang}`;
    default:
      return `You are Jurexio document pipeline specialist. Be precise, structured, citation-aware.${lang}`;
  }
}
