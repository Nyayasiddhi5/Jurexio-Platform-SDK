/**
 * Document Merger Tool
 * Merge multiple documents into one
 */

import { Tool, ToolExecutor } from '../../protocols/mcp/index.js';

/**
 * Document Merger Tool Definition
 */
export const docMergerTool: Tool = {
  id: 'doc_merger',
  name: 'Document Merger',
  description: 'Merge PDFs, combine documents, concatenate files',
  parameters: [
    {
      name: 'documents',
      type: 'array',
      description: 'Array of document paths or data to merge',
      required: true,
    },
    {
      name: 'options',
      type: 'object',
      description: 'Merge options (format, pageNumbers, toc, etc.)',
      required: false,
    },
  ],
  returns: {
    type: 'object',
    description: 'Merged document',
  },
  examples: [
    {
      input: {
        documents: ['doc1.pdf', 'doc2.pdf', 'doc3.pdf'],
        options: { addPageNumbers: true },
      },
      output: {
        success: true,
        mergedDocument: 'base64EncodedPDFData...',
        totalPages: 45,
      },
    },
  ],
};

/**
 * Document Merger Executor
 * Note: This is a thin client that returns configuration for the host to execute
 */
export const docMergerExecutor: ToolExecutor = async (params) => {
  const { documents, options = {} } = params;

  if (!Array.isArray(documents) || documents.length === 0) {
    return {
      success: false,
      error: 'documents must be a non-empty array',
    };
  }

  if (documents.length < 2) {
    return {
      success: false,
      error: 'At least 2 documents are required to merge',
    };
  }

  // Return merger configuration for host to execute
  return {
    success: true,
    action: 'doc_merge',
    config: {
      documents,
      format: options.format || 'pdf',
      addPageNumbers: options.addPageNumbers || false,
      addTableOfContents: options.addTableOfContents || false,
      preserveBookmarks: options.preserveBookmarks !== false,
      outputPath: options.outputPath,
    },
    note: 'Document merging requires PDF library (pdf-lib/PDFKit) and execution by host environment',
  };
};
