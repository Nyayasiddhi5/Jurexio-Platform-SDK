/**
 * Markdown Converter Tool
 * Convert between Markdown and other formats
 */

import { Tool, ToolExecutor } from '../../protocols/mcp/index.js';

/**
 * Markdown Converter Tool Definition
 */
export const markdownConverterTool: Tool = {
  id: 'markdown_converter',
  name: 'Markdown Converter',
  description: 'Convert Markdown to HTML/PDF/DOCX and vice versa',
  parameters: [
    {
      name: 'content',
      type: 'string',
      description: 'Content to convert',
      required: true,
    },
    {
      name: 'from',
      type: 'string',
      description: 'Source format: markdown, html',
      required: true,
    },
    {
      name: 'to',
      type: 'string',
      description: 'Target format: html, pdf, docx, markdown',
      required: true,
    },
    {
      name: 'options',
      type: 'object',
      description: 'Conversion options (theme, sanitize, etc.)',
      required: false,
    },
  ],
  returns: {
    type: 'object',
    description: 'Converted content',
  },
  examples: [
    {
      input: {
        content: '# Hello World\n\nThis is **bold**',
        from: 'markdown',
        to: 'html',
      },
      output: {
        success: true,
        content: '<h1>Hello World</h1><p>This is <strong>bold</strong></p>',
      },
    },
  ],
};

/**
 * Basic Markdown to HTML converter
 */
const markdownToHtml = (markdown: string): string => {
  let html = markdown;

  // Headers
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

  // Bold and italic
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // Links
  html = html.replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2">$1</a>');

  // Line breaks
  html = html.replace(/\n\n/g, '</p><p>');
  html = `<p>${html}</p>`;

  return html;
};

/**
 * Basic HTML to Markdown converter
 */
const htmlToMarkdown = (html: string): string => {
  let markdown = html;

  // Headers
  markdown = markdown.replace(/<h1>(.+?)<\/h1>/gi, '# $1\n\n');
  markdown = markdown.replace(/<h2>(.+?)<\/h2>/gi, '## $1\n\n');
  markdown = markdown.replace(/<h3>(.+?)<\/h3>/gi, '### $1\n\n');

  // Bold and italic
  markdown = markdown.replace(/<strong>(.+?)<\/strong>/gi, '**$1**');
  markdown = markdown.replace(/<em>(.+?)<\/em>/gi, '*$1*');

  // Links
  markdown = markdown.replace(/<a href="(.+?)">(.+?)<\/a>/gi, '[$2]($1)');

  // Paragraphs
  markdown = markdown.replace(/<\/?p>/gi, '\n\n');

  // Clean up
  markdown = markdown.replace(/\n{3,}/g, '\n\n').trim();

  return markdown;
};

/**
 * Markdown Converter Executor
 */
export const markdownConverterExecutor: ToolExecutor = async (params) => {
  const { content, from, to, options = {} } = params;

  if (typeof content !== 'string' || !content.trim()) {
    return {
      success: false,
      error: 'content must be a non-empty string',
    };
  }

  const validFormats = ['markdown', 'html', 'pdf', 'docx'];
  if (!validFormats.includes(from) || !validFormats.includes(to)) {
    return {
      success: false,
      error: `from and to must be one of: ${validFormats.join(', ')}`,
    };
  }

  try {
    // Handle basic conversions
    if (from === 'markdown' && to === 'html') {
      const htmlContent = markdownToHtml(content.trim());
      return {
        success: true,
        content: htmlContent,
        from,
        to,
      };
    }

    if (from === 'html' && to === 'markdown') {
      const markdownContent = htmlToMarkdown(content.trim());
      return {
        success: true,
        content: markdownContent,
        from,
        to,
      };
    }

    // Complex conversions require host
    return {
      success: true,
      action: 'markdown_convert',
      config: {
        content: content.trim(),
        from,
        to,
        theme: options.theme,
        sanitize: options.sanitize !== false,
      },
      note: `${from} to ${to} conversion requires additional libraries and execution by host environment`,
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
    };
  }
};
