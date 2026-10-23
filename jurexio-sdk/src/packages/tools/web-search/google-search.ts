/**
 * Google Search Tool
 * Web search using Google Custom Search API
 */

import { Tool, ToolExecutor } from '../../protocols/mcp/index.js';

/**
 * Google Search Tool Definition
 */
export const googleSearchTool: Tool = {
  id: 'google_search',
  name: 'Google Search',
  description: 'Web search using Google Custom Search API: get search results with URLs, snippets, images',
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
      description: 'Search options (num, start, searchType, fileType, siteSearch, etc.)',
      required: false,
    },
  ],
  returns: {
    type: 'object',
    description: 'Search results with URLs, titles, snippets',
  },
  examples: [
    {
      input: {
        query: 'TypeScript best practices',
        options: { num: 10 },
      },
      output: {
        success: true,
        items: [
          {
            title: 'TypeScript Best Practices',
            link: 'https://example.com/ts-best-practices',
            snippet: 'Learn TypeScript best practices...',
          },
        ],
      },
    },
  ],
};

/**
 * Google Search Executor
 * Note: This is a thin client that returns configuration for the host to execute
 */
export const googleSearchExecutor: ToolExecutor = async (params) => {
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
    action: 'google_search',
    config: {
      q: query.trim(),
      num: options.num || 10,
      start: options.start || 1,
      searchType: options.searchType, // 'image' for image search
      fileType: options.fileType,
      siteSearch: options.siteSearch,
      siteSearchFilter: options.siteSearchFilter,
      dateRestrict: options.dateRestrict,
      safe: options.safe || 'off',
      lr: options.lr, // language restrict
      cr: options.cr, // country restrict
    },
    note: 'Google Search requires GOOGLE_SEARCH_API_KEY, GOOGLE_SEARCH_ENGINE_ID and execution by host environment',
  };
};
