/**
 * PDF Generator Tool
 * Generate PDF documents from HTML/Markdown
 */

import { Tool, ToolExecutor } from '../../protocols/mcp/index.js';

/**
 * PDF Generator Tool Definition
 */
export const pdfGeneratorTool: Tool = {
  id: 'pdf_generator',
  name: 'PDF Generator',
  description: 'Generate PDFs from HTML/Markdown: headers, footers, page numbers, styling',
  parameters: [
    {
      name: 'content',
      type: 'string',
      description: 'Content to convert (HTML or Markdown)',
      required: true,
    },
    {
      name: 'options',
      type: 'object',
      description: 'PDF options (format, margins, header, footer, etc.)',
      required: false,
    },
  ],
  returns: {
    type: 'object',
    description: 'Generated PDF file data',
  },
  examples: [
    {
      input: {
        content: '<h1>Hello World</h1><p>This is a PDF</p>',
        options: { format: 'A4', margin: '1in' },
      },
      output: {
        success: true,
        pdfData: 'base64EncodedPDFData...',
        pages: 1,
      },
    },
  ],
};

/**
 * PDF Generator Executor
 * Note: This is a thin client that returns configuration for the host to execute
 */
export const pdfGeneratorExecutor: ToolExecutor = async (params) => {
  const { content, options = {} } = params;

  if (typeof content !== 'string' || !content.trim()) {
    return {
      success: false,
      error: 'content must be a non-empty string',
    };
  }

  // Return PDF configuration for host to execute
  return {
    success: true,
    action: 'pdf_generate',
    config: {
      content: content.trim(),
      format: options.format || 'A4',
      margin: options.margin || '1cm',
      header: options.header,
      footer: options.footer,
      displayHeaderFooter: options.displayHeaderFooter || false,
      landscape: options.landscape || false,
      printBackground: options.printBackground || true,
      scale: options.scale || 1,
    },
    note: 'PDF generation requires Puppeteer/Playwright and execution by host environment',
  };
};
