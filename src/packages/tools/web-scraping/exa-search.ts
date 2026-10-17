/**
 * Exa Search Tool
 * AI-powered semantic web search with content extraction
 */

import { Tool, ToolExecutor } from '../../protocols/mcp/index.js';

/**
 * Exa Search Tool Definition
 */
export const exaSearchTool: Tool = {
  id: 'exa_search',
  name: 'Exa Search',
  description: 'AI-powered semantic search: find relevant web pages, extract content, similarity search',
  parameters: [
    {
      name: 'query',
      type: 'string',
      description: 'Search query',
      required: true,
    },
    {
      name: 'options',
      type: 'object',
      description: 'Search options (numResults, category, extractContent, etc.)',
      required: false,
    },
  ],
  returns: {
    type: 'object',
    description: 'Search results with URLs, titles, and optional content',
  },
  examples: [
    {
      input: {
        query: 'Latest AI developments 2024',
        options: { numResults: 10, category: 'research paper' },
      },
      output: {
        success: true,
        query: 'Latest AI developments 2024',
        results: [
          {
            url: 'https://example.com/ai-2024',
            title: 'AI Developments in 2024',
            publishedDate: '2024-01-15',
          },
        ],
      },
    },
  ],
};

/**
 * Exa Search Executor
 * Note: This is a thin client that returns configuration for the host to execute
 */
export const exaSearchExecutor: ToolExecutor = async (params) => {
  const { query, options = {} } = params;

  if (typeof query !== 'string' || !query.trim()) {
    return {
      success: false,
      error: 'query must be a non-empty string',
    };
  }

  // Return search configuration for host to execute
  return {
    success: true,
    action: 'exa_search',
    config: {
      query: query.trim(),
      numResults: options.numResults || 10,
      category: options.category,
      startPublishedDate: options.startPublishedDate,
      endPublishedDate: options.endPublishedDate,
      includeDomains: options.includeDomains,
      excludeDomains: options.excludeDomains,
      extractContent: options.extractContent || false,
      type: options.type || 'neural', // neural or keyword
      useAutoprompt: options.useAutoprompt !== false,
    },
    note: 'Exa search requires EXA_API_KEY and execution by host environment',
  };
};
