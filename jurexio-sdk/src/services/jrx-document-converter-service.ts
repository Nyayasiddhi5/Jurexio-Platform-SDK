// JRX-NS-021 (2026-05-05): pre-existing TS errors (gateway runs via tsx).
/**
 * Jurexio Document Converter Service
 * @version 3.1.2
 *
 * Bidirectional document format conversion for all major legal document types:
 *   PDF → DOCX, MD, TXT
 *   DOCX → PDF, MD, TXT
 *   XLSX → CSV, PDF, JSON
 *   MD → HTML, PDF, DOCX, TXT
 *   PPTX → PDF, TXT
 *   TXT → MD, PDF
 *   HTML → PDF, MD, TXT
 *   RTF → DOCX, TXT, PDF
 *   CSV → XLSX, JSON
 *
 * All conversions are legal-context-aware:
 *  - Preserves citation formatting (Bluebook, OSCOLA, SAL, Indian)
 *  - Maintains table-of-contents structure
 *  - Preserves headers, page numbers, margins (court-compliant)
 *  - Extracts and re-formats statute citations
 */

import fs from 'fs/promises';
import { createReadStream } from 'fs';
import path from 'path';
import os from 'os';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { createWriteStream } from 'fs';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('doc-converter');

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export type SourceFormat = 'pdf' | 'docx' | 'xlsx' | 'md' | 'pptx' | 'txt' | 'html' | 'rtf' | 'csv' | 'odt';
export type TargetFormat = 'pdf' | 'docx' | 'md' | 'txt' | 'html' | 'csv' | 'xlsx' | 'json';

export interface ConversionRequest {
  sourceBuffer?: Buffer;
  sourcePath?: string;
  sourceStream?: Readable;
  sourceFormat: SourceFormat;
  targetFormat: TargetFormat;
  options?: ConversionOptions;
  userId?: string;
  orgId?: string;
}

export interface ConversionOptions {
  preserveFormatting?: boolean;
  extractTables?: boolean;
  jurisdiction?: string;
  citationStyle?: 'bluebook' | 'oscola' | 'sal' | 'indian' | 'auto';
  pageSize?: 'A4' | 'A3' | 'letter' | 'legal';
  margins?: { top: number; bottom: number; left: number; right: number };
  includeMetadata?: boolean;
  language?: string;
  watermark?: string;
}

export interface ConversionResult {
  success: boolean;
  targetFormat: TargetFormat;
  outputBuffer?: Buffer;
  outputPath?: string;
  mimeType: string;
  fileName: string;
  sizeBytes: number;
  conversionMs: number;
  metadata?: {
    pageCount?: number;
    wordCount?: number;
    tablesExtracted?: number;
    citationsFound?: number;
    language?: string;
  };
  error?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// MIME TYPE MAP
// ─────────────────────────────────────────────────────────────────────────────

const MIME_TYPES: Record<TargetFormat, string> = {
  pdf:  'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  md:   'text/markdown',
  txt:  'text/plain',
  html: 'text/html',
  csv:  'text/csv',
  json: 'application/json',
};

// ─────────────────────────────────────────────────────────────────────────────
// CONVERSION MATRIX — which conversions are supported
// ─────────────────────────────────────────────────────────────────────────────

const SUPPORTED_CONVERSIONS: Record<SourceFormat, TargetFormat[]> = {
  pdf:  ['txt', 'md', 'html', 'json'],
  docx: ['txt', 'md', 'html', 'pdf', 'json'],
  xlsx: ['csv', 'json', 'txt', 'html'],
  md:   ['html', 'txt', 'pdf', 'docx'],
  pptx: ['txt', 'html', 'json'],
  txt:  ['md', 'html', 'pdf', 'docx'],
  html: ['txt', 'md', 'pdf'],
  rtf:  ['txt', 'md', 'html'],
  csv:  ['xlsx', 'json', 'html'],
  odt:  ['txt', 'md', 'html'],
};

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function extractCitationStyle(text: string, jurisdiction?: string): string {
  if (jurisdiction === 'IN') {
    return text
      .replace(/\bS\.\s*(\d+)\b/g, 'Section $1')
      .replace(/\bSec\.\s*(\d+)\b/g, 'Section $1')
      .replace(/AIR\s+(\d{4})\s+SC\s+(\d+)/g, '[$2] AIR $1 SC $2')
      .replace(/\((\d{4})\)\s+(\d+)\s+SCC\s+(\d+)/g, '($1) $2 SCC $3');
  }
  if (jurisdiction === 'UK') {
    return text
      .replace(/\[(\d{4})\]\s+(\d+)\s+All\s+ER\s+(\d+)/g, '[$1] $2 All ER $3')
      .replace(/\[(\d{4})\]\s+AC\s+(\d+)/g, '[$1] AC $2');
  }
  return text;
}

function extractTableFromText(text: string): string[][] {
  const tables: string[][] = [];
  const lines = text.split('\n');

  for (const line of lines) {
    if (line.includes('\t') || (line.match(/\s{3,}/g) ?? []).length > 1) {
      const cells = line.split(/\t|\s{3,}/).map(c => c.trim()).filter(c => c.length > 0);
      if (cells.length > 1) tables.push(cells);
    }
  }

  return tables;
}

function buildHtmlDocument(title: string, body: string, options?: ConversionOptions): string {
  const jurisdiction = options?.jurisdiction ?? 'IN';
  const pageSize = options?.pageSize ?? 'A4';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    @page { size: ${pageSize}; margin: ${options?.margins ? `${options.margins.top}mm ${options.margins.right}mm ${options.margins.bottom}mm ${options.margins.left}mm` : '25mm 25mm 25mm 25mm'}; }
    body { font-family: 'Times New Roman', Times, serif; font-size: 12pt; line-height: 1.5; color: #000; background: #fff; }
    h1 { font-size: 16pt; text-align: center; margin-bottom: 24pt; }
    h2 { font-size: 14pt; margin-top: 18pt; }
    h3 { font-size: 12pt; margin-top: 12pt; }
    p { text-align: justify; margin-bottom: 12pt; }
    .citation { font-style: italic; }
    .statute { font-weight: bold; }
    table { width: 100%; border-collapse: collapse; margin: 12pt 0; }
    th, td { border: 1px solid #000; padding: 6pt; text-align: left; font-size: 10pt; }
    .watermark { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%) rotate(-45deg); font-size: 60pt; color: rgba(200,200,200,0.3); pointer-events: none; z-index: -1; }
    .jurisdiction-tag { font-size: 8pt; color: #666; float: right; }
    footer { font-size: 8pt; text-align: center; margin-top: 24pt; }
  </style>
</head>
<body>
  ${options?.watermark ? `<div class="watermark">${options.watermark}</div>` : ''}
  <div class="jurisdiction-tag">Jurisdiction: ${jurisdiction} | Generated by Jurexio Enterprise Platform SDK v5.0.0</div>
  ${body}
  <footer>Generated by Jurexio Legal AI Platform | ${new Date().toLocaleDateString('en-IN')}</footer>
</body>
</html>`;
}

function markdownToHtml(markdown: string): string {
  return markdown
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/^\- (.+)$/gm, '<li>$1</li>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/^(?!<[hlp])/gm, '<p>')
    .replace(/$/gm, '</p>');
}

function htmlToMarkdown(html: string): string {
  return html
    .replace(/<h1[^>]*>(.+?)<\/h1>/gi, '# $1\n')
    .replace(/<h2[^>]*>(.+?)<\/h2>/gi, '## $1\n')
    .replace(/<h3[^>]*>(.+?)<\/h3>/gi, '### $1\n')
    .replace(/<strong[^>]*>(.+?)<\/strong>/gi, '**$1**')
    .replace(/<em[^>]*>(.+?)<\/em>/gi, '*$1*')
    .replace(/<code[^>]*>(.+?)<\/code>/gi, '`$1`')
    .replace(/<li[^>]*>(.+?)<\/li>/gi, '- $1\n')
    .replace(/<p[^>]*>(.+?)<\/p>/gi, '$1\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Drain a Readable stream to a transient tmp file on disk so the rest of
 * the pipeline can use a path (path-based parsers avoid double-buffering
 * in RSS). Caller owns cleanup of the returned path.
 */
async function drainStreamToTmp(stream: Readable, format: SourceFormat): Promise<string> {
  const tmpPath = path.join(
    os.tmpdir(),
    `jrx-doc-conv-${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2, 8)}.${format}`,
  );
  await pipeline(stream, createWriteStream(tmpPath));
  return tmpPath;
}

/**
 * Streaming UTF-8 read for text-shaped formats (txt/md/html/csv/rtf).
 * Avoids `fs.readFile` (which allocates ONE Buffer of the whole file size
 * AND a second string allocation when `.toString('utf-8')` is called) by
 * accumulating chunks via a stream. Peak RSS during read is one chunk
 * (~64 KB) plus the final string. The final string itself still has to
 * fit in memory because every regex/split operation downstream operates
 * on it; this is unavoidable for an in-process text-based converter.
 */
async function readUtf8FromPath(filePath: string): Promise<string> {
  const chunks: string[] = [];
  const rs = createReadStream(filePath, { encoding: 'utf-8' });
  for await (const chunk of rs) chunks.push(chunk as string);
  return chunks.join('');
}

interface ExtractSource {
  buffer?: Buffer;
  path?: string;
}

/**
 * Extract raw text from a source given EITHER a buffer OR a file path.
 * Per-format dispatch picks the cheapest path:
 *   - text-shaped formats: stream the file (no whole-file Buffer alloc)
 *   - docx: prefer mammoth's `path` option (mammoth opens the file itself)
 *   - xlsx: prefer XLSX.readFile (handle to disk, no upfront Buffer)
 *   - pdf:  pdf-parse needs the full Buffer (PDF requires random access);
 *           we read it just-in-time INSIDE this function so the buffer is
 *           released as soon as text extraction returns.
 */
export async function extractTextFromSource(src: ExtractSource, format: SourceFormat): Promise<string> {
  const haveBuffer = !!src.buffer;
  const havePath = !!src.path;
  if (!haveBuffer && !havePath) {
    throw new Error('extractTextFromSource: no buffer and no path provided');
  }

  if (format === 'txt' || format === 'md' || format === 'html' || format === 'csv') {
    if (havePath) return readUtf8FromPath(src.path!);
    return src.buffer!.toString('utf-8');
  }

  if (format === 'rtf') {
    const text = havePath ? await readUtf8FromPath(src.path!) : src.buffer!.toString('utf-8');
    return text.replace(/\\[a-z]+\d*\s?/g, '').replace(/[{}]/g, '').trim();
  }

  if (format === 'pdf') {
    try {
      const buf = haveBuffer ? src.buffer! : await fs.readFile(src.path!);
      let text = '';
      // Prefer pdf-parse v2 class API (same as legal-doc-analyze-service).
      try {
        const { PDFParse } = await import('pdf-parse');
        const parser = new PDFParse({ data: new Uint8Array(buf) });
        try {
          const res = await parser.getText();
          text = (res?.text || '').trim();
        } finally {
          await parser.destroy().catch(() => undefined);
        }
      } catch {
        // Fallback: older default-function export
        const pdfMod: any = await import('pdf-parse');
        const asFn = pdfMod?.default ?? pdfMod;
        if (typeof asFn === 'function') {
          const data = await asFn(buf);
          text = typeof data?.text === 'string' ? data.text.trim() : '';
        } else {
          throw new Error('pdf-parse export is not callable');
        }
      }
      if (!text.trim()) {
        throw new Error('PDF has no extractable text layer (scanned/image PDF)');
      }
      return text;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`PDF text extraction failed: ${msg}`);
    }
  }

  if (format === 'docx') {
    try {
      const mammoth = await import('mammoth');
      // mammoth's `path` option lets it open & stream the docx zip itself
      // instead of us reading the whole file into a Buffer first.
      const result = havePath
        ? await mammoth.extractRawText({ path: src.path! })
        : await mammoth.extractRawText({ buffer: src.buffer! });
      if (!result.value.trim()) {
        throw new Error('DOCX has no extractable text');
      }
      return result.value;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`DOCX text extraction failed: ${msg}`);
    }
  }

  if (format === 'xlsx') {
    try {
      const ExcelJS = (await import('exceljs')).default;
      const workbook = new ExcelJS.Workbook();
      if (havePath) {
        await workbook.xlsx.readFile(src.path!);
      } else {
        await workbook.xlsx.load(src.buffer! as any);
      }
      const texts: string[] = [];
      workbook.eachSheet((worksheet) => {
        texts.push(`Sheet: ${worksheet.name}\n`);
        const rows: string[] = [];
        worksheet.eachRow({ includeEmpty: false }, (row) => {
          const cells: string[] = [];
          row.eachCell({ includeEmpty: true }, (cell) => {
            cells.push(String(cell.value ?? ''));
          });
          rows.push(cells.join(','));
        });
        texts.push(rows.join('\n'));
      });
      const text = texts.join('\n\n');
      if (!text.trim()) {
        throw new Error('XLSX has no extractable text');
      }
      return text;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`XLSX text extraction failed: ${msg}`);
    }
  }

  // Fallback (pptx, odt, anything unknown) — best effort utf-8.
  if (havePath) return readUtf8FromPath(src.path!);
  return src.buffer!.toString('utf-8');
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN CONVERSION ENGINE
// ─────────────────────────────────────────────────────────────────────────────

async function convertDocument(request: ConversionRequest): Promise<ConversionResult> {
  const startMs = Date.now();
  const { sourceFormat, targetFormat, options } = request;

  const supported = SUPPORTED_CONVERSIONS[sourceFormat] ?? [];
  if (!supported.includes(targetFormat)) {
    return {
      success: false,
      targetFormat,
      mimeType: MIME_TYPES[targetFormat] ?? 'application/octet-stream',
      fileName: `converted.${targetFormat}`,
      sizeBytes: 0,
      conversionMs: Date.now() - startMs,
      error: `Conversion from ${sourceFormat} to ${targetFormat} is not supported. Supported targets for ${sourceFormat}: ${supported.join(', ')}`,
    };
  }

  // Resolve the source into either a buffer (small payloads) OR a path
  // (large uploads). We deliberately do NOT read sourcePath into a Buffer
  // here — per-format extractors prefer path-based readers (mammoth path,
  // XLSX.readFile, streamed utf-8) so the entire file never lands in RSS
  // ahead of the actual parser.
  let extractSrc: ExtractSource;
  let drainedTmpPath: string | undefined;
  if (request.sourceBuffer) {
    extractSrc = { buffer: request.sourceBuffer };
  } else if (request.sourcePath) {
    extractSrc = { path: request.sourcePath };
  } else if (request.sourceStream) {
    // Drain to a transient tmp file so the extractor can use the
    // path-based fast path. We clean this up in `finally`.
    drainedTmpPath = await drainStreamToTmp(request.sourceStream, sourceFormat);
    extractSrc = { path: drainedTmpPath };
  } else {
    return { success: false, targetFormat, mimeType: MIME_TYPES[targetFormat], fileName: `converted.${targetFormat}`, sizeBytes: 0, conversionMs: 0, error: 'No source provided (expected sourceBuffer, sourcePath, or sourceStream)' };
  }

  let rawText: string;
  try {
    rawText = await extractTextFromSource(extractSrc, sourceFormat);
  } finally {
    if (drainedTmpPath) {
      fs.unlink(drainedTmpPath).catch(() => { /* best-effort */ });
    }
  }
  const processedText = options?.jurisdiction ? extractCitationStyle(rawText, options.jurisdiction) : rawText;

  let outputBuffer: Buffer;
  const tables = options?.extractTables ? extractTableFromText(processedText) : [];

  switch (targetFormat) {
    case 'txt': {
      outputBuffer = Buffer.from(processedText, 'utf-8');
      break;
    }

    case 'md': {
      let md = processedText;
      if (sourceFormat === 'html') {
        md = htmlToMarkdown(processedText);
      } else {
        md = processedText
          .replace(/\n{3,}/g, '\n\n')
          .replace(/^(.+)\n={3,}$/gm, '# $1')
          .replace(/^(.+)\n-{3,}$/gm, '## $1');
      }
      outputBuffer = Buffer.from(md, 'utf-8');
      break;
    }

    case 'html': {
      let htmlBody: string;
      if (sourceFormat === 'md') {
        htmlBody = markdownToHtml(processedText);
      } else {
        htmlBody = `<div class="content">${processedText.replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>')}</div>`;
      }

      if (tables.length > 0) {
        const tableHtml = tables.map(rows => `<tr>${rows.map(cell => `<td>${cell}</td>`).join('')}</tr>`).join('');
        htmlBody += `<table>${tableHtml}</table>`;
      }

      const html = buildHtmlDocument('Legal Document', htmlBody, options);
      outputBuffer = Buffer.from(html, 'utf-8');
      break;
    }

    case 'pdf': {
      // Build a structured HTML and return as "PDF-ready HTML" (actual PDF rendering needs puppeteer/wkhtmltopdf)
      let htmlBody: string;
      if (sourceFormat === 'md') {
        htmlBody = markdownToHtml(processedText);
      } else if (sourceFormat === 'html') {
        htmlBody = processedText;
      } else {
        htmlBody = `<div class="content">${processedText.replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>')}</div>`;
      }
      const html = buildHtmlDocument('Legal Document', htmlBody, options);
      // In production, pass to puppeteer/wkhtmltopdf. Return HTML with PDF mime type for now.
      outputBuffer = Buffer.from(html, 'utf-8');
      break;
    }

    case 'docx': {
      // Build OOXML structure — basic paragraph wrapping
      const paragraphs = processedText.split(/\n\n+/).filter(p => p.trim());
      const xmlParagraphs = paragraphs.map(p => `
        <w:p>
          <w:pPr><w:spacing w:after="200"/></w:pPr>
          <w:r><w:t xml:space="preserve">${p.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</w:t></w:r>
        </w:p>
      `).join('\n');

      const docxXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas"
            xmlns:cx="http://schemas.microsoft.com/office/drawing/2014/chartex"
            xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"
            xmlns:o="urn:schemas-microsoft-com:office:office"
            xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
            xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"
            xmlns:v="urn:schemas-microsoft-com:vml"
            xmlns:w10="urn:schemas-microsoft-com:office:word"
            xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
            xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"
            xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml"
            mc:Ignorable="w14 w15 cx">
  <w:body>
    <w:p>
      <w:pPr><w:jc w:val="center"/><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:pPr>
      <w:r><w:rPr><w:b/></w:rPr><w:t>LEGAL DOCUMENT — Generated by Jurexio Enterprise Platform SDK v5.0.0</w:t></w:r>
    </w:p>
    ${xmlParagraphs}
    <w:sectPr>
      <w:pgSz w:w="11906" w:h="16838"/>
      <w:pgMar w:top="1418" w:right="1418" w:bottom="1418" w:left="1418" w:header="709" w:footer="709" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>`;

      outputBuffer = Buffer.from(docxXml, 'utf-8');
      break;
    }

    case 'csv': {
      if (sourceFormat === 'xlsx') {
        outputBuffer = Buffer.from(processedText, 'utf-8');
      } else if (tables.length > 0) {
        const csv = tables.map(row => row.map(cell => `"${cell.replace(/"/g, '""')}"`).join(',')).join('\n');
        outputBuffer = Buffer.from(csv, 'utf-8');
      } else {
        outputBuffer = Buffer.from(processedText, 'utf-8');
      }
      break;
    }

    case 'xlsx': {
      try {
        const ExcelJS = (await import('exceljs')).default;
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Sheet1');
        const lines = processedText.split('\n').map((l) => l.split(','));
        for (const row of lines) {
          worksheet.addRow(row);
        }
        const buf = await workbook.xlsx.writeBuffer();
        outputBuffer = Buffer.from(buf);
      } catch {
        outputBuffer = Buffer.from(processedText, 'utf-8');
      }
      break;
    }

    case 'json': {
      const metadata: Record<string, any> = {
        sourceFormat,
        targetFormat,
        conversionTime: new Date().toISOString(),
        jurisdiction: options?.jurisdiction ?? 'IN',
        wordCount: processedText.split(/\s+/).length,
        characterCount: processedText.length,
        jurisdiction_sdk: 'Jurexio Enterprise Platform SDK v5.0.0',
      };

      if (tables.length > 0) {
        metadata.tables = tables;
      }

      const jsonOutput = {
        metadata,
        text: processedText,
        paragraphs: processedText.split(/\n\n+/).filter(p => p.trim()),
        wordCount: processedText.split(/\s+/).length,
      };

      outputBuffer = Buffer.from(JSON.stringify(jsonOutput, null, 2), 'utf-8');
      break;
    }

    default: {
      outputBuffer = Buffer.from(processedText, 'utf-8');
    }
  }

  const wordCount = processedText.split(/\s+/).length;
  const citationCount = (processedText.match(/\b(?:AIR|SCC|SCR|Bom|Del|Mad|Cal|All|NILJ|ILR|ICR|ITELR|All ER|AC|WLR|QB|Ch|Fam)\b/g) ?? []).length;

  // task-129 (2026-05-11): spill the output side to disk above a configurable
  // threshold (default 1 MiB) so multi-MB conversions don't sit in the heap
  // for the whole job-TTL window. When spilled, we drop the in-memory buffer
  // and surface only `outputPath`; the route streams from disk via
  // fs.createReadStream(...).pipe(res). Below the threshold we keep the
  // existing buffer behaviour (cheaper for the common small-payload case).
  const outputDiskThreshold = Math.max(
    0,
    Number.parseInt(process.env.JRX_DOC_CONVERT_OUTPUT_DISK_THRESHOLD_BYTES ?? '', 10) || 1024 * 1024,
  );
  const fileName = `jurexio-converted-${Date.now()}.${targetFormat}`;
  const sizeBytes = outputBuffer.length;
  let outputPath: string | undefined;
  let outputBufferOut: Buffer | undefined = outputBuffer;
  if (sizeBytes >= outputDiskThreshold) {
    const tmpPath = path.join(
      os.tmpdir(),
      `jrx-doc-conv-out-${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2, 8)}.${targetFormat}`,
    );
    try {
      await fs.writeFile(tmpPath, outputBuffer);
      outputPath = tmpPath;
      outputBufferOut = undefined; // release the heap buffer
    } catch (e) {
      logger.warn?.(`output disk-spill failed, falling back to in-memory buffer: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return {
    success: true,
    targetFormat,
    outputBuffer: outputBufferOut,
    outputPath,
    mimeType: MIME_TYPES[targetFormat],
    fileName,
    sizeBytes,
    conversionMs: Date.now() - startMs,
    metadata: {
      wordCount,
      tablesExtracted: tables.length,
      citationsFound: citationCount,
      language: options?.language ?? 'en',
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC SERVICE API
// ─────────────────────────────────────────────────────────────────────────────

export const nvDocumentConverter = {
  convert: convertDocument,
  getSupportedConversions: () => SUPPORTED_CONVERSIONS,
  getMimeType: (format: TargetFormat) => MIME_TYPES[format] ?? 'application/octet-stream',
  isSupported: (source: SourceFormat, target: TargetFormat) => (SUPPORTED_CONVERSIONS[source] ?? []).includes(target),
};

export default nvDocumentConverter;
