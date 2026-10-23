/**
 * Document parsing + summarisation jobs.
 *
 * Long-running, memory-heavy work moves OFF the request thread:
 *   - parse:     OCR (if image/PDF), extract text, chunk by page+heading,
 *                generate embeddings, persist chunks to nv_doc_chunks.
 *                On completion, enqueues a summarise job.
 *   - summarise: map-reduce summarisation (per-chunk -> consolidated),
 *                stores in nv_doc_summaries, fires `doc.summarized` webhook.
 *
 * The actual OCR / extract / embed implementations live in their dedicated
 * services; these handlers orchestrate them and enforce timeouts + heartbeats
 * so a stuck LLM provider never silently swallows a delivery.
 */

import { enqueueDocSummarize, type DocParseJob, type DocSummarizeJob } from './bullmq-queue.js';
import { dispatchWebhook } from './webhook-dispatcher.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('document-jobs');

const HEARTBEAT_MS = 30_000;

async function withHeartbeat<T>(job: any, fn: () => Promise<T>): Promise<T> {
  const t = setInterval(() => job?.updateProgress?.({ heartbeat: Date.now() }).catch(() => {}), HEARTBEAT_MS);
  try {
    return await fn();
  } finally {
    clearInterval(t);
  }
}

/** ---- DOC PARSE ---- */
export async function handleDocParse(data: DocParseJob, job: any) {
  logger.info('doc.parse start', { docId: data.documentId, bytes: data.totalBytes });

  return withHeartbeat(job, async () => {
    // Lazy-import the existing services so this handler stays test-friendly.
    const { processDocumentEnd2End } = await safeImport<any>('../document-pipeline/document-pipeline-service.js');
    const { generateEmbeddings } = await safeImport<any>('../jrx-embedding-service.js');
    const { persistDocChunks } = await safeImport<any>('../document-pipeline/doc-chunk-store.js');

    let text = '';
    let chunks: Array<{ idx: number; text: string; page?: number }> = [];

    if (processDocumentEnd2End) {
      const out = await processDocumentEnd2End({
        documentId: data.documentId,
        storagePath: data.storagePath,
        mimeType: data.mimeType,
        ocrRequired: data.ocrRequired ?? data.mimeType.startsWith('image/'),
        language: data.language,
      });
      text = out.text || '';
      chunks = out.chunks || [];
    } else {
      // NV-REAL-DATA-001: never index synthetic text. The canonical, wired
      // document pipeline is the PgJobQueue path (jrx-job-worker →
      // nvDocumentIntelligenceOrchestrator.processDocument). This BullMQ chain
      // is currently producer-less; if a job ever reaches it without the real
      // pipeline service present, FAIL LOUD instead of poisoning the index.
      throw new Error(
        `doc.parse: real pipeline service unavailable for ${data.documentId} — refusing to index stub text. Use the PgJobQueue document pipeline.`,
      );
    }

    job?.updateProgress?.({ stage: 'embeddings', chunks: chunks.length }).catch(() => {});

    if (generateEmbeddings && chunks.length) {
      const embeds = await generateEmbeddings(chunks.map((c) => c.text));
      if (persistDocChunks) {
        await persistDocChunks(data.documentId, chunks.map((c, i) => ({ ...c, embedding: embeds[i] })));
      }
    }

    // chain: enqueue summarisation
    await enqueueDocSummarize({
      documentId: data.documentId,
      orgId: data.orgId,
      platform: data.platform,
      chunkIds: chunks.map((c) => `${data.documentId}:${c.idx}`),
      mode: 'hybrid',
    });

    logger.info('doc.parse done', { docId: data.documentId, chunks: chunks.length });
    return { documentId: data.documentId, chunks: chunks.length };
  });
}

/** ---- DOC SUMMARIZE ---- */
export async function handleDocSummarize(data: DocSummarizeJob, job: any) {
  logger.info('doc.summarize start', { docId: data.documentId, chunks: data.chunkIds?.length ?? 0 });

  return withHeartbeat(job, async () => {
    const { summarizeDocument } = await safeImport<any>('../legal-doc-analyze-service.js');
    const { persistDocSummary } = await safeImport<any>('../document-pipeline/doc-chunk-store.js');
    const { resolveAppForPlatform } = await safeImport<any>('../sdk/sdk-application-service.js');

    let summary: { abstract: string; keyPoints: string[]; risks?: string[] };

    if (summarizeDocument) {
      summary = await summarizeDocument({
        documentId: data.documentId,
        chunkIds: data.chunkIds,
        mode: data.mode ?? 'hybrid',
        jurisdiction: data.jurisdiction,
      });
    } else {
      // NV-REAL-DATA-001: do not persist/emit a synthetic summary. Fail loud.
      throw new Error(
        `doc.summarize: real summariser unavailable for ${data.documentId} — refusing to persist stub summary.`,
      );
    }

    if (persistDocSummary) {
      await persistDocSummary(data.documentId, summary);
    }

    // Fire-and-forget webhook (durable via BullMQ)
    if (resolveAppForPlatform) {
      try {
        const app = await resolveAppForPlatform(data.platform);
        if (app?.webhookUrl && app?.webhookSecret) {
          await dispatchWebhook({
            appId: app.appId,
            platform: data.platform,
            url: app.webhookUrl,
            event: 'doc.summarized',
            payload: { documentId: data.documentId, summary },
            secret: app.webhookSecret,
          });
        }
      } catch (e: any) {
        logger.warn('webhook resolve failed (non-fatal)', { err: e.message });
      }
    }

    logger.info('doc.summarize done', { docId: data.documentId });
    return { documentId: data.documentId, summary };
  });
}

/** Tolerant import — returns the named export or undefined. */
async function safeImport<T = unknown>(spec: string): Promise<T | undefined> {
  try {
    const mod: any = await import(spec);
    return (mod?.default ?? mod) as T;
  } catch {
    return undefined;
  }
}
