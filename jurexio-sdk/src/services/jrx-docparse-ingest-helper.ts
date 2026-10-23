/**
 * NV-DOCPARSE-INGEST-001 — resolve binary ingest context from partner request bodies
 * so every upload path can pass bytes into extractCourtDocumentFields / docparse.
 */
import type { CourtDocExtractOptions } from './jrx-court-document-fields.js';

/** Max documents in one docparse batch (zip supports batch run(); cap for API safety). */
export const DOCPARSE_BATCH_DOC_LIMIT = 5;

export interface IngestFileSpec {
  bytes: Buffer;
  fileName: string;
  mimeType?: string;
}

export interface IngestBinaryContext {
  /** Primary file for single-doc paths. */
  primary?: IngestFileSpec;
  /** Optional multi-document batch (capped at DOCPARSE_BATCH_DOC_LIMIT). */
  batch: IngestFileSpec[];
}

function decodeBase64Payload(raw: string): Buffer {
  const cleaned = raw.replace(/^data:[^;]+;base64,/, '').trim();
  if (!cleaned) return Buffer.alloc(0);
  return Buffer.from(cleaned, 'base64');
}

function specFromBodyFields(
  body: Record<string, unknown>,
  keys: { base64?: string; fileName?: string; mimeType?: string },
): IngestFileSpec | undefined {
  const b64 = keys.base64 ? body[keys.base64] : undefined;
  if (typeof b64 !== 'string' || !b64.trim()) return undefined;
  const bytes = decodeBase64Payload(b64);
  if (!bytes.length) return undefined;
  const fileName =
    (typeof body[keys.fileName || 'fileName'] === 'string' && String(body[keys.fileName || 'fileName']))
    || (typeof body.documentFileName === 'string' && String(body.documentFileName))
    || 'document.pdf';
  const mimeType =
    (keys.mimeType && typeof body[keys.mimeType] === 'string' ? String(body[keys.mimeType]) : undefined)
    || (typeof body.mimeType === 'string' ? String(body.mimeType) : undefined)
    || (typeof body.documentMimeType === 'string' ? String(body.documentMimeType) : undefined);
  return { bytes, fileName, mimeType };
}

/**
 * Resolve bytes from common partner body shapes (base64, documentBase64, documents[]).
 */
export function resolveIngestBytes(body: unknown): IngestBinaryContext {
  const record = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const batch: IngestFileSpec[] = [];

  const pushSpec = (spec: IngestFileSpec | undefined): void => {
    if (!spec?.bytes?.length) return;
    if (batch.some((b) => b.fileName === spec.fileName && b.bytes.length === spec.bytes.length)) return;
    if (batch.length < DOCPARSE_BATCH_DOC_LIMIT) batch.push(spec);
  };

  pushSpec(specFromBodyFields(record, { base64: 'base64' }));
  pushSpec(specFromBodyFields(record, { base64: 'documentBase64', fileName: 'fileName' }));
  pushSpec(specFromBodyFields(record, { base64: 'documentBytes', fileName: 'fileName' }));

  const docsRaw = record.documents;
  if (Array.isArray(docsRaw)) {
    for (const item of docsRaw) {
      if (!item || typeof item !== 'object') continue;
      const d = item as Record<string, unknown>;
      const b64 = typeof d.base64 === 'string' ? d.base64 : typeof d.content === 'string' ? d.content : undefined;
      if (!b64) continue;
      const bytes = decodeBase64Payload(b64);
      if (!bytes.length) continue;
      pushSpec({
        bytes,
        fileName: typeof d.fileName === 'string' ? d.fileName : typeof d.name === 'string' ? d.name : 'document.pdf',
        mimeType: typeof d.mimeType === 'string' ? d.mimeType : typeof d.mime === 'string' ? d.mime : undefined,
      });
    }
  }

  return {
    primary: batch[0],
    batch,
  };
}

/** Build court-field extract options from resolved ingest context. */
export function toCourtDocExtractOptions(
  ctx: IngestBinaryContext,
  extras?: { batchId?: string; actor?: string },
): CourtDocExtractOptions | undefined {
  if (!ctx.primary?.bytes?.length) return undefined;
  return {
    bytes: ctx.primary.bytes,
    fileName: ctx.primary.fileName,
    mimeType: ctx.primary.mimeType,
    batchId: extras?.batchId,
    actor: extras?.actor,
    documents: ctx.batch.length > 1 ? ctx.batch : undefined,
  };
}
