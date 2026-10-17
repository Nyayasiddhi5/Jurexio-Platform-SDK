/**
 * Firecrawl Scraper Tool
 * Web scraping using Firecrawl API (markdown output, JavaScript rendering)
 */

import { Tool, ToolExecutor } from '../../protocols/mcp/index.js';

/**
 * Firecrawl Scraper Tool Definition
 */
export const firecrawlScraperTool: Tool = {
  id: 'firecrawl_scraper',
  name: 'Firecrawl Scraper',
  description: 'Scrape web pages using Firecrawl API: returns markdown, handles JavaScript, extracts structured data',
  parameters: [
    {
      name: 'url',
      type: 'string',
      description: 'URL to scrape',
      required: true,
    },
    {
      name: 'options',
      type: 'object',
      description: 'Scraping options (formats, waitFor, extractSchema, etc.)',
      required: false,
    },
  ],
  returns: {
    type: 'object',
    description: 'Scraped content in markdown format with metadata',
  },
  examples: [
    {
      input: {
        url: 'https://example.com',
        options: { formats: ['markdown', 'html'] },
      },
      output: {
        success: true,
        markdown: '# Example Domain\n\nThis domain is for use in illustrative examples...',
        html: '<html>...</html>',
        metadata: { title: 'Example Domain', statusCode: 200 },
      },
    },
  ],
};

/**
 * Firecrawl Scraper Executor
 * Note: This is a thin client that returns configuration for the host to execute
 */
export const firecrawlScraperExecutor: ToolExecutor = async (params) => {
  const { url, options = {} } = params;

  if (typeof url !== 'string' || !url.trim()) {
    return {
      success: false,
      error: 'url must be a non-empty string',
    };
  }

  // Validate URL format
  try {
    new URL(url);
  } catch (error: any) {
    return {
      success: false,
      error: 'Invalid URL format',
    };
  }

  // Return scraping configuration for host to execute
  return {
    success: true,
    action: 'firecrawl_scrape',
    config: {
      url,
      formats: options.formats || ['markdown'],
      waitFor: options.waitFor || 0,
      timeout: options.timeout || 30000,
      onlyMainContent: options.onlyMainContent !== false,
      extractSchema: options.extractSchema,
    },
    note: 'Firecrawl scraping requires FIRECRAWL_API_KEY and execution by host environment',
  };
};
