/**
 * Shared text extraction for docs-pipeline (PDF / DOCX / images via OCR).
 * Reuses the same converters as legal-chat attachments.
 */
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { extractTextFromSource, type SourceFormat } from '../jrx-document-converter-service.js';
import { nvOcrAdapterService, OcrProviderUnavailableError } from '../document-pipeline/jrx-got-ocr-adapter-service.js';

const EXT_TO_FORMAT: Record<string, SourceFormat> = {
  pdf: 'pdf', docx: 'docx', xlsx: 'xlsx', md: 'md', pptx: 'pptx',
  txt: 'txt', html: 'html', htm: 'html', rtf: 'rtf', csv: 'csv', odt: 'odt', json: 'txt',
};
const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp', 'tiff', 'tif', 'bmp', 'gif']);

export interface ExtractDocInput {
  content?: string;
  base64?: string;
  fileName?: string;
  mimeType?: string;
}

export interface ExtractDocResult {
  text: string;
  format: string;
  extractionMethod: 'text' | 'pdf-parse' | 'docx' | 'ocr' | 'xlsx' | 'utf8';
  bytes: number;
  warnings: string[];
}

function extFromName(fileName?: string, mimeType?: string): string {
  const fromName = (fileName?.split('.').pop() || '').toLowerCase();
  if (fromName) return fromName;
  const mimeMap: Record<string, string> = {
    'application/pdf': 'pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'text/plain': 'txt',
    'text/markdown': 'md',
    'image/png': 'png',
    'image/jpeg': 'jpg',
  };
  return mimeMap[mimeType || ''] || 'txt';
}

/**
 * Local Tesseract OCR — the offline last-resort engine. Used only when the
 * consolidated multi-provider adapter cannot extract text (no provider key /
 * every provider failed), so the SDK sync extract path degrades gracefully
 * instead of hard-failing.
 */
async function ocrImageBufferTesseract(buf: Buffer, fileName: string): Promise<{ text: string; warnings: string[] }> {
  const tmp = path.join(os.tmpdir(), `jrx-doc-ocr-${crypto.randomUUID()}${path.extname(fileName) || '.png'}`);
  await fs.writeFile(tmp, buf);
  try {
    const tess: any = await import('tesseract.js');
    const recognize = tess.default?.recognize || tess.recognize;
    const result = await recognize(tmp, 'eng');
    const text = String(result?.data?.text || '').trim();
    if (!text) {
      return { text: '', warnings: [`OCR returned no text for ${fileName}`] };
    }
    return { text, warnings: [] };
  } catch (err) {
    throw new Error(`OCR failed for ${fileName}: ${(err as Error).message}`);
  } finally {
    await fs.unlink(tmp).catch(() => undefined);
  }
}

/**
 * NV-DOC-OCR-SDK-UNIFY-001 — route SDK sync image OCR through the SAME
 * consolidated multi-provider adapter used by the async orchestrator and
 * legal-doc-analyze (Mistral OCR 4 / Gemini Flash / GOT-OCR / Azure → local
 * Tesseract). Previously this path was Tesseract-only, so a Console file
 * upload could get materially worse OCR than an async upload of the same file.
 * Fail-safe: if every external provider is unavailable we fall back to the
 * local Tesseract engine rather than hard-failing.
 */
async function ocrImageBuffer(
  buf: Buffer,
  fileName: string,
  mimeType: string,
): Promise<{ text: string; warnings: string[] }> {
  try {
    const result = await nvOcrAdapterService.ocrDocument(buf, mimeType, { language: 'en' });
    const text = String(result?.text || '').trim();
    if (text) {
      const warnings = result.provider === 'tesseract-local'
        ? []
        : [`OCR via ${result.provider} (${result.extractionMethod}, confidence ${result.confidence.toFixed(2)})`];
      return { text, warnings };
    }
    return { text: '', warnings: [`OCR returned no text for ${fileName} (provider ${result.provider})`] };
  } catch (err) {
    // Every configured provider failed (or none configured) — degrade to the
    // local offline engine so the SDK path still works without external keys.
    const reason = err instanceof OcrProviderUnavailableError
      ? `no OCR provider available (${err.message})`
      : (err as Error).message;
    const local = await ocrImageBufferTesseract(buf, fileName);
    return {
      text: local.text,
      warnings: [...local.warnings, `OCR provider cascade unavailable, used local Tesseract: ${reason}`],
    };
  }
}

export async function extractDocumentText(input: ExtractDocInput): Promise<ExtractDocResult> {
  const warnings: string[] = [];
  const fileName = input.fileName || 'document.txt';
  const ext = extFromName(fileName, input.mimeType);

  if (input.content && typeof input.content === 'string' && !input.base64) {
    const trimmed = input.content.trim();
    if (!trimmed) throw new Error('Empty document content');
    return {
      text: trimmed,
      format: EXT_TO_FORMAT[ext] || 'txt',
      extractionMethod: 'text',
      bytes: Buffer.byteLength(trimmed, 'utf-8'),
      warnings,
    };
  }

  let buf: Buffer;
  if (input.base64) {
    buf = Buffer.from(input.base64.replace(/^data:[^;]+;base64,/, ''), 'base64');
  } else if (input.content) {
    buf = Buffer.from(input.content, 'utf-8');
  } else {
    throw new Error('Provide content (text) or base64 (binary document)');
  }

  if (buf.length === 0) throw new Error('Empty document payload');

  if (IMAGE_EXTS.has(ext)) {
    const imageMime = input.mimeType || `image/${ext === 'jpg' ? 'jpeg' : ext === 'tif' ? 'tiff' : ext}`;
    const { text, warnings: ocrWarn } = await ocrImageBuffer(buf, fileName, imageMime);
    warnings.push(...ocrWarn);
    if (!text) throw new Error(`OCR produced no readable text from ${fileName}`);
    return { text, format: 'image', extractionMethod: 'ocr', bytes: buf.length, warnings };
  }

  const fmt = EXT_TO_FORMAT[ext];
  if (fmt) {
    const text = await extractTextFromSource({ buffer: buf }, fmt);
    if (text.startsWith('[') && text.includes('requires') && text.endsWith(']')) {
      throw new Error(text.replace(/^\[|\]$/g, ''));
    }
    const trimmed = text.trim();
    // NV-DOC-OCR-SCANNED-PDF-001: digital layer thin/empty → vision OCR cascade
    // (same adapter as JWT document orchestrator: Mistral/Gemini/GOT/Azure/Tesseract).
    const looksScannedPdf =
      fmt === 'pdf'
      && (
        !trimmed
        || trimmed.length < 80
        || (trimmed.length < 400 && /[\x00-\x08]/.test(trimmed) === false && !/\b(section|clause|whereas|plaintiff|defendant|agreement)\b/i.test(trimmed))
      );
    if (looksScannedPdf) {
      try {
        const ocr = await nvOcrAdapterService.ocrDocument(
          buf,
          input.mimeType || 'application/pdf',
          { language: 'en' },
        );
        const ocrText = String(ocr?.text || '').trim();
        if (ocrText.length > trimmed.length) {
          warnings.push(
            `Scanned/image PDF: OCR via ${ocr.provider} (${ocr.extractionMethod}) replaced thin text layer (${trimmed.length}→${ocrText.length} chars)`,
          );
          return {
            text: ocrText,
            format: fmt,
            extractionMethod: 'ocr',
            bytes: buf.length,
            warnings,
          };
        }
        if (!trimmed && ocrText) {
          return {
            text: ocrText,
            format: fmt,
            extractionMethod: 'ocr',
            bytes: buf.length,
            warnings: [...warnings, `OCR via ${ocr.provider}`],
          };
        }
      } catch (ocrErr: any) {
        warnings.push(`PDF OCR fallback failed: ${ocrErr?.message || ocrErr}`);
      }
    }
    if (!trimmed) throw new Error(`No text extracted from ${fileName} (${fmt})`);
    const method = fmt === 'pdf' ? 'pdf-parse' : fmt === 'docx' ? 'docx' : fmt === 'xlsx' ? 'xlsx' : 'utf8';
    return { text: trimmed, format: fmt, extractionMethod: method, bytes: buf.length, warnings };
  }

  const text = buf.toString('utf-8').trim();
  if (!text) throw new Error(`Unsupported format .${ext} — no text extracted`);
  warnings.push(`Unknown extension .${ext}; decoded as UTF-8`);
  return { text, format: ext, extractionMethod: 'utf8', bytes: buf.length, warnings };
}
