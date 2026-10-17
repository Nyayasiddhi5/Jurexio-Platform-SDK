/**
 * Document Processor — REAL DELEGATION SEAM
 * NYV-ORCH-SEAM-004 (Task #32)
 *
 * Re-exports the canonical NyayavignyaDocumentProcessor implementation living
 * under src/services/document-pipeline/. Legacy imports of the form
 * `import { DocumentProcessor, ProcessedDocument, DocumentProcessingRequest }`
 * continue to work — `DocumentProcessor` is aliased to
 * `NyayavignyaDocumentProcessor`.
 */

export {
  NyayavignyaDocumentProcessor,
  NyayavignyaDocumentProcessor as DocumentProcessor,
  type DocumentProcessingRequest,
  type DocumentProcessingOptions,
  type ProcessedDocument,
  type DocumentChunk,
  type DocumentMetadata,
  type DocumentStatistics,
  type DocumentType,
  type NyayavignyaDatabaseSystem as DocumentProcessorDatabaseSystem,
} from './document-pipeline/document-processor.js';

import { NyayavignyaDocumentProcessor } from './document-pipeline/document-processor.js';
import { databaseSystem } from './database-system.js';

/**
 * Default singleton — wired to the canonical `databaseSystem` (drizzle +
 * pg/neon) so that any caller importing `documentProcessor` from this
 * seam gets a fully production-ready, persistence-backed instance.
 *
 * Callers that need a different DB (multi-tenant, custom pool) can still
 * construct their own `new NyayavignyaDocumentProcessor(customDbSystem)`.
 */
export const documentProcessor = new NyayavignyaDocumentProcessor(databaseSystem);
export default documentProcessor;
