/**
 * Bing Search Tool
 * Web search using Bing Search API
 */

import { Tool, ToolExecutor } from '../../protocols/mcp/index.js';

/**
 * Bing Search Tool Definition
 */
export const bingSearchTool: Tool = {
  id: 'bing_search',
  name: 'Bing Search',
  description: 'Web search using Bing Search API: comprehensive results with web pages, images, videos, news',
  parameters: [
    {
      name: 'query',
      type: 'string',
      description: 'Search query',
      required: true,
    },
    {
      name: 'searchType',
      type: 'string',
      description: 'Type of search',
      required: false,
      enum: ['web', 'image', 'video', 'news'],
      default: 'web',
    },
    {
      name: 'options',
      type: 'object',
      description: 'Search options (count, offset, market, safeSearch, etc.)',
      required: false,
    },
  ],
  returns: {
    type: 'object',
    description: 'Search results based on search type',
  },
  examples: [
    {
      input: {
        query: 'climate change',
        searchType: 'web',
        options: { count: 10 },
      },
      output: {
        success: true,
        webPages: {
          value: [
            {
              name: 'Climate Change Facts',
              url: 'https://example.com/climate',
              snippet: 'Climate change is...',
            },
          ],
        },
      },
    },
  ],
};

/**
 * Bing Search Executor
 * Note: This is a thin client that returns configuration for the host to execute
 */
export const bingSearchExecutor: ToolExecutor = async (params) => {
  const { query, searchType = 'web', options = {} } = params;

  if (typeof query !== 'string' || !query.trim()) {
    return {
      success: false,
      error: 'query must be a non-empty string',
    };
  }

  // Return search configuration for host to execute
  return {
    success: true,
    action: 'bing_search',
    config: {
      searchType,
      q: query.trim(),
      count: options.count || 10,
      offset: options.offset || 0,
      market: options.market || 'en-US',
      safeSearch: options.safeSearch || 'Moderate',
      freshness: options.freshness, // 'Day', 'Week', 'Month'
      textDecorations: options.textDecorations !== false,
      textFormat: options.textFormat || 'Raw',
    },
    note: 'Bing Search requires BING_SEARCH_API_KEY and execution by host environment',
  };
};
