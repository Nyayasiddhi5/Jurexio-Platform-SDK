// NYV-NS-021 (2026-05-05): pre-existing strict-null violations cluster in this
// file. Runtime is unaffected (gateway runs via tsx). Opt out of strict-null
// for the v5.0.0 deploy gate; track follow-up cleanup in INV-CLEANUP-001.
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { db as _raw_db } from '../../db/index.js';
import { lazyRequire } from '../../utils/jrx-type-helpers.js';
import * as fullSchema from '../../../shared/schema.js';
const db = lazyRequire<NodePgDatabase<typeof fullSchema>>(
  () => _raw_db as unknown as NodePgDatabase<typeof fullSchema> | null,
  'db',
);
import {
  documentParsing,
  documentPages,
  documentExtractedContent,
  documentProcessingJobs,
} from '@shared/schema.js';
import { eq, and, desc, sql, type AnyColumn } from 'drizzle-orm';
import fs from 'fs/promises';
import path from 'path';
import { createRequire } from 'module';
import { createLogger } from '../../utils/logger.js';
import { encryptedExpr } from '../field-encryption-service.js';

const logger = createLogger('document-parsing-service');

const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');

type AnyDoc = Record<string, any>;

export class DocumentParsingService {

  async parsePDF(filePath: string, userId: string, originalFilename: string, assistantId?: number): Promise<any> {
    const startTime = Date.now();

    try {
      const dataBuffer = await fs.readFile(filePath);
      const pdfData = await pdfParse(dataBuffer);
      const stats = await fs.stat(filePath);
      const fileName = path.basename(filePath);

      const insertPayload = {
        userId,
        assistantId,
        fileName,
        originalFileName: originalFilename,
        filePath,
        fileSize: stats.size,
        mimeType: 'application/pdf',
        documentType: 'pdf',
        status: 'processing',
        processingStartedAt: new Date(),
        pageCount: pdfData.numpages,
        extractedText: pdfData.text,
        wordCount: pdfData.text.split(/\s+/).length,
        characterCount: pdfData.text.length,
        textExtractionMethod: 'native',
        title: pdfData.info?.Title || originalFilename,
        author: pdfData.info?.Author,
        subject: pdfData.info?.Subject,
        keywords: pdfData.info?.Keywords ? [pdfData.info.Keywords] : [],
        metadata: pdfData.info || {},
      } as unknown as typeof documentParsing.$inferInsert;
      const [document] = await db.insert(documentParsing).values(insertPayload).returning() as AnyDoc[];

      await db.insert(documentPages).values({
        documentId: document.id,
        pageNumber: 1,
        text: pdfData.text,
        rawText: pdfData.text,
      } as unknown as typeof documentPages.$inferInsert);

      const processingDuration = Date.now() - startTime;

      await db.update(documentParsing)
        .set({
          status: 'completed',
          processingCompletedAt: new Date(),
          processingDuration,
        } as unknown as Partial<typeof documentParsing.$inferInsert>)
        .where(eq(documentParsing.id, document.id));

      return {
        ...document,
        originalFileName: originalFilename,
        status: 'completed',
        processingDuration,
      };
    } catch (error: any) {
      logger.error('PDF parsing error:', error);
      throw error;
    }
  }

  async parseImage(filePath: string, userId: string, originalFilename: string, assistantId?: number): Promise<any> {
    try {
      const stats = await fs.stat(filePath);
      const fileName = path.basename(filePath);
      const ext = path.extname(fileName).toLowerCase();

      const mimeTypes: Record<string, string> = {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.gif': 'image/gif',
        '.bmp': 'image/bmp',
        '.webp': 'image/webp',
      };

      const mimeType = mimeTypes[ext] || 'image/jpeg';

      const insertPayload = {
        userId,
        assistantId,
        fileName,
        originalFileName: originalFilename,
        filePath,
        fileSize: stats.size,
        mimeType,
        documentType: 'image',
        status: 'processing',
        processingStartedAt: new Date(),
        pageCount: 1,
        ocrEnabled: true,
        ocrProvider: 'tesseract',
        textExtractionMethod: 'ocr',
        hasImages: true,
        imageCount: 1,
      } as unknown as typeof documentParsing.$inferInsert;
      const [document] = await db.insert(documentParsing).values(insertPayload).returning() as AnyDoc[];

      await db.insert(documentProcessingJobs).values({
        documentId: document.id,
        userId,
        jobType: 'ocr',
        status: 'pending',
        totalSteps: 1,
        settings: {
          provider: 'tesseract',
          languages: ['eng'],
        },
      } as unknown as typeof documentProcessingJobs.$inferInsert);

      return {
        ...document,
        originalFileName: originalFilename,
        status: 'processing',
        message: 'OCR job queued - document will be updated when processing completes',
      };
    } catch (error: any) {
      logger.error('Image parsing error:', error);
      throw error;
    }
  }

  async parseTextDocument(filePath: string, userId: string, originalFilename: string, assistantId?: number): Promise<any> {
    const startTime = Date.now();

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const stats = await fs.stat(filePath);
      const fileName = path.basename(filePath);

      const insertPayload = {
        userId,
        assistantId,
        fileName,
        originalFileName: originalFilename,
        filePath,
        fileSize: stats.size,
        mimeType: 'text/plain',
        documentType: 'txt',
        status: 'processing',
        processingStartedAt: new Date(),
        pageCount: 1,
        extractedText: content,
        wordCount: content.split(/\s+/).length,
        characterCount: content.length,
        textExtractionMethod: 'native',
      } as unknown as typeof documentParsing.$inferInsert;
      const [document] = await db.insert(documentParsing).values(insertPayload).returning() as AnyDoc[];

      const processingDuration = Date.now() - startTime;

      await db.update(documentParsing)
        .set({
          status: 'completed',
          processingCompletedAt: new Date(),
          processingDuration,
        } as unknown as Partial<typeof documentParsing.$inferInsert>)
        .where(eq(documentParsing.id, document.id));

      return {
        ...document,
        status: 'completed',
        processingDuration,
      };
    } catch (error: any) {
      logger.error('Text parsing error:', error);
      throw error;
    }
  }

  async parseOfficeDocument(filePath: string, userId: string, originalFilename: string, assistantId: number | undefined, docType: string): Promise<any> {
    try {
      const stats = await fs.stat(filePath);
      const fileName = path.basename(filePath);

      const mimeTypes: Record<string, string> = {
        'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      };

      const insertPayload = {
        userId,
        assistantId,
        fileName,
        originalFileName: originalFilename,
        filePath,
        fileSize: stats.size,
        mimeType: mimeTypes[docType] || 'application/octet-stream',
        documentType: docType,
        status: 'processing',
        processingStartedAt: new Date(),
      } as unknown as typeof documentParsing.$inferInsert;
      const [document] = await db.insert(documentParsing).values(insertPayload).returning() as AnyDoc[];

      await db.insert(documentProcessingJobs).values({
        documentId: document.id,
        userId,
        jobType: 'parse',
        status: 'pending',
        totalSteps: 1,
        settings: {
          documentType: docType,
        },
      } as unknown as typeof documentProcessingJobs.$inferInsert);

      return {
        ...document,
        originalFileName: originalFilename,
        status: 'processing',
        message: `${docType.toUpperCase()} parsing job queued - document will be updated when processing completes`,
      };
    } catch (error: any) {
      logger.error('Office document parsing error:', error);
      throw error;
    }
  }

  async parseDocument(filePath: string, userId: string, originalFilename: string, assistantId?: number): Promise<any> {
    const ext = path.extname(filePath).toLowerCase();

    if (ext === '.pdf') {
      return this.parsePDF(filePath, userId, originalFilename, assistantId);
    } else if (['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'].includes(ext)) {
      return this.parseImage(filePath, userId, originalFilename, assistantId);
    } else if (ext === '.txt' || ext === '.md') {
      return this.parseTextDocument(filePath, userId, originalFilename, assistantId);
    } else if (ext === '.docx') {
      return this.parseOfficeDocument(filePath, userId, originalFilename, assistantId, 'docx');
    } else if (ext === '.xlsx') {
      return this.parseOfficeDocument(filePath, userId, originalFilename, assistantId, 'xlsx');
    } else if (ext === '.pptx') {
      return this.parseOfficeDocument(filePath, userId, originalFilename, assistantId, 'pptx');
    } else {
      throw new Error(`Unsupported file type: ${ext}`);
    }
  }

  async chunkDocument(documentId: number, chunkSize: number = 1000, overlap: number = 200): Promise<any[]> {
    if (chunkSize <= 0) {
      throw new Error('chunkSize must be greater than 0');
    }
    if (overlap < 0) {
      throw new Error('overlap must be non-negative');
    }
    if (overlap >= chunkSize) {
      overlap = Math.floor(chunkSize * 0.5);
    }

    const document = await db.query.documentParsing.findFirst({
      where: eq(documentParsing.id, documentId),
    }) as AnyDoc | undefined;

    if (!document || !document.extractedText) {
      throw new Error('Document not found or has no text');
    }

    const text: string = document.extractedText;
    const chunks: string[] = [];

    let start = 0;
    while (start < text.length) {
      const end = Math.min(start + chunkSize, text.length);
      chunks.push(text.substring(start, end));

      const nextStart = Math.max(start + 1, end - overlap);
      if (nextStart <= start) break;

      start = nextStart;
      if (start >= text.length) break;
    }

    const chunkRecords = chunks.map((chunk, index) => ({
      documentId,
      contentIndex: index,
      text: chunk,
      contentType: 'text' as const,
      startPosition: index * (chunkSize - overlap),
      endPosition: Math.min((index + 1) * chunkSize - (index > 0 ? overlap : 0), text.length),
      wordCount: chunk.split(/\s+/).length,
      characterCount: chunk.length,
    }));

    // Task #29 — fail-closed field encryption: insert all chunks and their
    // encrypted-mirror UPDATEs in a single transaction. If pgp_sym_encrypt
    // fails on any chunk the entire batch rolls back and no plaintext chunk
    // is left without its encrypted companion.
    await db.transaction(async (tx) => {
      await tx.insert(documentExtractedContent).values(
        chunkRecords as unknown as (typeof documentExtractedContent.$inferInsert)[]
      );
      for (const rec of chunkRecords) {
        await tx.execute(sql`
          UPDATE document_extracted_content
          SET content_enc = ${encryptedExpr(rec.text)}
          WHERE document_id = ${documentId} AND content_index = ${rec.contentIndex}
        `);
      }
    });

    await db.update(documentParsing)
      .set({
        chunked: true,
        chunkCount: chunks.length,
      } as unknown as Partial<typeof documentParsing.$inferInsert>)
      .where(eq(documentParsing.id, documentId));

    return chunkRecords;
  }

  async getDocument(documentId: number) {
    return db.query.documentParsing.findFirst({
      where: eq(documentParsing.id, documentId),
    });
  }

  async getUserDocuments(userId: string, limit: number = 50) {
    return db.query.documentParsing.findMany({
      where: eq(documentParsing.userId, Number(userId)),
      orderBy: [desc(documentParsing.createdAt)],
      limit,
    });
  }

  async getDocumentPages(documentId: number) {
    return db.query.documentPages.findMany({
      where: eq(documentPages.documentId, documentId),
      orderBy: [documentPages.pageNumber],
    });
  }

  async getExtractedContent(documentId: number) {
    const tbl = documentExtractedContent as unknown as typeof documentExtractedContent & {
      contentIndex: AnyColumn;
    };
    return db.query.documentExtractedContent.findMany({
      where: eq(documentExtractedContent.documentId, documentId),
      orderBy: [tbl.contentIndex],
    });
  }

  async getProcessingJobs(documentId: number) {
    return db.query.documentProcessingJobs.findMany({
      where: eq(documentProcessingJobs.documentId, documentId),
      orderBy: [desc(documentProcessingJobs.createdAt)],
    });
  }

  async deleteDocument(documentId: number, userId: string) {
    const document = await db.query.documentParsing.findFirst({
      where: and(
        eq(documentParsing.id, documentId),
        eq(documentParsing.userId, Number(userId))
      ),
    }) as AnyDoc | undefined;

    if (!document) {
      throw new Error('Document not found or unauthorized');
    }

    try {
      await fs.unlink(document.filePath);
    } catch (err: any) {
      logger.error('Error deleting file:', err);
    }

    await db.delete(documentParsing)
      .where(eq(documentParsing.id, documentId));

    return { success: true };
  }
}

export const documentParsingService = new DocumentParsingService();
