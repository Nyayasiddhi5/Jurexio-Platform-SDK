/**
 * Cheerio HTML Parser Tool
 * Fast HTML parsing and extraction using tag names
 * 
 * CURRENT LIMITATION (Phase 1): Supports tag-name-only selectors (h1, p, div, table)
 * Full CSS selector support (classes, IDs, attributes) planned for Phase 2
 */

import { Tool, ToolExecutor } from '../../protocols/mcp/index.js';

/**
 * Cheerio Parser Tool Definition
 */
export const cheerioParserTool: Tool = {
  id: 'cheerio_parser',
  name: 'Cheerio HTML Parser',
  description: 'Parse HTML and extract data using tag names: text, tables, links, images, metadata (Phase 1: tag names only, full CSS selectors in Phase 2)',
  parameters: [
    {
      name: 'html',
      type: 'string',
      description: 'HTML content to parse',
      required: true,
    },
    {
      name: 'action',
      type: 'string',
      description: 'Parsing action',
      required: true,
      enum: ['extract', 'find_all', 'table', 'links', 'images', 'metadata'],
    },
    {
      name: 'selector',
      type: 'string',
      description: 'Tag name selector (h1, p, div, table, etc.) - Phase 1 supports tag names only',
      required: false,
    },
    {
      name: 'options',
      type: 'object',
      description: 'Parsing options (attribute, limit, etc.)',
      required: false,
    },
  ],
  returns: {
    type: 'object',
    description: 'Parsed data based on action',
  },
  examples: [
    {
      input: {
        html: '<html><body><h1>Title</h1><p>Content</p></body></html>',
        action: 'extract',
        selector: 'h1',
      },
      output: {
        success: true,
        data: 'Title',
      },
    },
  ],
};

/**
 * Extract text from selector
 */
const extractText = (html: string, selector: string): string => {
  // Simple regex-based extraction for Phase 1
  // Phase 2 will use actual Cheerio library
  const match = html.match(new RegExp(`<${selector}[^>]*>([^<]+)</${selector}>`, 'i'));
  return match ? match[1].trim() : '';
};

/**
 * Find all elements matching selector
 */
const findAll = (html: string, selector: string): string[] => {
  const results: string[] = [];
  const regex = new RegExp(`<${selector}[^>]*>([^<]+)</${selector}>`, 'gi');
  let match;

  while ((match = regex.exec(html)) !== null) {
    results.push(match[1].trim());
  }

  return results;
};

/**
 * Extract links
 */
const extractLinks = (html: string): any[] => {
  const links: any[] = [];
  const regex = /<a[^>]*href=["']([^"']+)["'][^>]*>([^<]*)<\/a>/gi;
  let match;

  while ((match = regex.exec(html)) !== null) {
    links.push({
      href: match[1],
      text: match[2].trim(),
    });
  }

  return links;
};

/**
 * Extract images
 */
const extractImages = (html: string): any[] => {
  const images: any[] = [];
  const regex = /<img[^>]*src=["']([^"']+)["'][^>]*(?:alt=["']([^"']*)["'])?[^>]*>/gi;
  let match;

  while ((match = regex.exec(html)) !== null) {
    images.push({
      src: match[1],
      alt: match[2] || '',
    });
  }

  return images;
};

/**
 * Extract metadata
 */
const extractMetadata = (html: string): any => {
  const metadata: any = {};

  // Title
  const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
  if (titleMatch) metadata.title = titleMatch[1].trim();

  // Meta description
  const descMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["'][^>]*>/i);
  if (descMatch) metadata.description = descMatch[1];

  // Meta keywords
  const keywordsMatch = html.match(/<meta[^>]*name=["']keywords["'][^>]*content=["']([^"']*)["'][^>]*>/i);
  if (keywordsMatch) metadata.keywords = keywordsMatch[1];

  // OG tags
  const ogTitleMatch = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']*)["'][^>]*>/i);
  if (ogTitleMatch) metadata.ogTitle = ogTitleMatch[1];

  const ogDescMatch = html.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']*)["'][^>]*>/i);
  if (ogDescMatch) metadata.ogDescription = ogDescMatch[1];

  const ogImageMatch = html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']*)["'][^>]*>/i);
  if (ogImageMatch) metadata.ogImage = ogImageMatch[1];

  return metadata;
};

/**
 * Parse HTML table
 */
const parseTable = (html: string, selector?: string): any[] => {
  const rows: any[] = [];

  // Find table
  const tableRegex = selector
    ? new RegExp(`<table[^>]*${selector}[^>]*>(.*?)<\/table>`, 'is')
    : /<table[^>]*>(.*?)<\/table>/is;

  const tableMatch = html.match(tableRegex);
  if (!tableMatch) return rows;

  const tableContent = tableMatch[1];

  // Extract rows
  const rowRegex = /<tr[^>]*>(.*?)<\/tr>/gis;
  let rowMatch;

  while ((rowMatch = rowRegex.exec(tableContent)) !== null) {
    const rowContent = rowMatch[1];
    const cells: string[] = [];

    // Extract cells (th or td)
    const cellRegex = /<t[hd][^>]*>(.*?)<\/t[hd]>/gis;
    let cellMatch;

    while ((cellMatch = cellRegex.exec(rowContent)) !== null) {
      cells.push(cellMatch[1].replace(/<[^>]*>/g, '').trim());
    }

    if (cells.length > 0) {
      rows.push(cells);
    }
  }

  return rows;
};

/**
 * Cheerio Parser Executor
 */
export const cheerioParserExecutor: ToolExecutor = async (params) => {
  const { html, action, selector, options = {} } = params;

  if (typeof html !== 'string' || !html.trim()) {
    return {
      success: false,
      error: 'html must be a non-empty string',
    };
  }

  try {
    let data: any;

    switch (action) {
      case 'extract': {
        if (!selector) {
          return { success: false, error: 'selector is required for extract action' };
        }
        data = extractText(html, selector);
        break;
      }

      case 'find_all': {
        if (!selector) {
          return { success: false, error: 'selector is required for find_all action' };
        }
        data = findAll(html, selector);
        break;
      }

      case 'links': {
        data = extractLinks(html);
        if (options.limit) {
          data = data.slice(0, options.limit);
        }
        break;
      }

      case 'images': {
        data = extractImages(html);
        if (options.limit) {
          data = data.slice(0, options.limit);
        }
        break;
      }

      case 'metadata': {
        data = extractMetadata(html);
        break;
      }

      case 'table': {
        data = parseTable(html, selector);
        break;
      }

      default:
        return {
          success: false,
          error: `Unknown action: ${action}`,
        };
    }

    return {
      success: true,
      action,
      data,
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
    };
  }
};
